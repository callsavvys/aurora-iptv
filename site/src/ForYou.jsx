import { useEffect, useMemo, useState } from "react";
import { tmdb, item, GENRE } from "./tmdb.js";
import { allProgress, allWatched } from "./line.js";
import { BecauseRow, WideRow } from "./Home.jsx";

/* atlantic.bz's For You block, from its own recipe: the seeds are what you are
   part-way through and what you marked watched, newest first; the six newest
   give their TMDB recommendations (with "similar" when there are fewer than
   10). For You scores each recommendation by how early its seed is, its place
   in the list, how well its genres match your favourites, and its rating,
   leaving out what you have seen and the first two seeds' top picks (they
   have their own "Because you watched" rows). Then those two rows, then "Top
   picks in" your favourite genre. On Discover it keeps to films or series. */
const TOP = 6, FOR_YOU = 24;
const keyOf = (x, type) => `${x.media_type || type}:${x.id}`;

/* {seeds, seen}: unfinished progress and watched marks */
export function seedsOf(mediaType) {
  const prog = allProgress(), byTitle = new Map(), seen = new Set();
  for (const [k, p] of Object.entries(prog)) {
    const m = /^(movie|tv):(\d+)/.exec(k);
    if (!m) continue;
    const id = `${m[1]}:${m[2]}`;
    seen.add(id);
    const unfinished = p?.duration && p.position < p.duration * 0.95;
    const e = byTitle.get(id) || { key: id, type: m[1], id: Number(m[2]), at: 0, open: false };
    e.open = e.open || !!unfinished;
    e.at = Math.max(e.at, p?.at || 0);
    byTitle.set(id, e);
  }
  const seeds = new Map([...byTitle].filter(([, e]) => e.open));
  for (const w of allWatched()) {
    const id = `${w.type}:${w.id}`;
    seen.add(id);
    const e = seeds.get(id);
    if (!e || (w.at || 0) > e.at) seeds.set(id, { key: id, type: w.type, id: Number(w.id), at: Math.max(w.at || 0, e?.at || 0) });
  }
  return { seeds: [...seeds.values()].filter((s) => !mediaType || s.type === mediaType).sort((a, b) => b.at - a.at), seen };
}

async function recsOf(s) {
  let r = (await tmdb(`/${s.type}/${s.id}/recommendations`, { page: "1" })).results || [];
  if (r.length < 10) {
    const sim = (await tmdb(`/${s.type}/${s.id}/similar`, { page: "1" })).results || [];
    const have = new Set(r.map((x) => x.id));
    r = [...r, ...sim.filter((x) => !have.has(x.id))];
  }
  return r.filter((x) => x.backdrop_path).map((x) => ({ ...x, media_type: s.type }));
}
const genrePage = (g) => tmdb(`/discover/${g.mediaType}`, { ...GENRE, with_genres: String(g.genreId), page: String(g.page || 1) }).then((r) => (r.results || []).map((x) => ({ ...x, media_type: g.mediaType })));

function TopPicks({ genreId, mediaType, seen }) {
  const [name, setName] = useState("");
  const [items, setItems] = useState(null);
  useEffect(() => {
    let live = true;
    Promise.all([tmdb(`/genre/${mediaType}/list`), genrePage({ genreId, mediaType })])
      .then(([g, r]) => { if (!live) return; setName((g.genres || []).find((x) => x.id === genreId)?.name || ""); setItems(r.filter((x) => !seen.has(keyOf(x, mediaType))).slice(0, 24).map((x) => item(x, mediaType))); })
      .catch(() => live && setItems([]));
    return () => { live = false; };
  }, [genreId, mediaType, seen]);
  return <WideRow title={name ? `Top picks in ${name}` : "Top picks for you"} items={items || []} />;
}

export default function ForYouBlock({ mediaType }) {
  const { seeds, seen } = useMemo(() => seedsOf(mediaType), [mediaType]);
  const top = seeds.slice(0, TOP);
  const [recs, setRecs] = useState(null);
  useEffect(() => {
    let live = true;
    setRecs(null);
    Promise.allSettled(top.map(recsOf)).then((rs) => { if (live) setRecs(Object.fromEntries(rs.map((r, i) => [top[i].key, r.status === "fulfilled" ? r.value : []]))); });
    return () => { live = false; };
  }, [top.map((s) => s.key).join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  // your favourite genres: each seed's recommendations count, the newest seeds most
  const weights = useMemo(() => {
    const w = { movie: new Map(), tv: new Map() };
    if (recs) top.forEach((s, i) => (recs[s.key] || []).forEach((x) => (x.genre_ids || []).forEach((g) => w[x.media_type].set(g, (w[x.media_type].get(g) || 0) + 1 / (i + 1)))));
    return w;
  }, [recs]); // eslint-disable-line react-hooks/exhaustive-deps
  const ranked = useMemo(() => ({ movie: [...weights.movie].sort((a, b) => b[1] - a[1]).map(([g]) => g), tv: [...weights.tv].sort((a, b) => b[1] - a[1]).map(([g]) => g) }), [weights]);
  const firstType = seeds[0]?.type;
  const pick = firstType && ranked[firstType][0] != null ? { genreId: ranked[firstType][0], mediaType: firstType } : null;
  const genreAsks = useMemo(() => {
    const out = [];
    new Set(top.map((s) => s.type)).forEach((t) => { const r = ranked[t]; if (r[1] != null) out.push({ genreId: r[1], mediaType: t, page: 1 }); if (r[2] != null) out.push({ genreId: r[2], mediaType: t, page: 1 }); if (r[0] != null) out.push({ genreId: r[0], mediaType: t, page: 2 }); if (r[3] != null) out.push({ genreId: r[3], mediaType: t, page: 1 }); });
    return out;
  }, [ranked]); // eslint-disable-line react-hooks/exhaustive-deps
  const [extra, setExtra] = useState(null);
  useEffect(() => {
    if (!recs) return undefined;
    let live = true;
    setExtra(null);
    Promise.allSettled(genreAsks.map(genrePage)).then((rs) => live && setExtra(rs.flatMap((r) => (r.status === "fulfilled" ? r.value : []))));
    return () => { live = false; };
  }, [genreAsks.map((g) => `${g.mediaType}-${g.genreId}-${g.page}`).join("|"), !!recs]); // eslint-disable-line react-hooks/exhaustive-deps
  const forYou = useMemo(() => {
    if (!recs || !extra) return null;
    const skip = new Set();
    [top[0], top[1]].forEach((s) => s && (recs[s.key] || []).filter((x) => !seen.has(keyOf(x, s.type))).slice(0, 24).forEach((x) => skip.add(keyOf(x, s.type))));
    const most = { movie: Math.max(1, ...weights.movie.values()), tv: Math.max(1, ...weights.tv.values()) };
    const pool = new Map();
    const add = (x, type, base) => { const k = keyOf(x, type); if (seen.has(k) || skip.has(k)) return; const e = pool.get(k); if (e) e.base += base; else pool.set(k, { x: { ...x, media_type: x.media_type || type }, base }); };
    top.slice(2).forEach((s, i) => { const w = 1 / (i + 3); (recs[s.key] || []).forEach((x, j) => add(x, s.type, w * (1 - Math.min(j, 30) / 40))); });
    extra.forEach((x) => add(x, x.media_type || firstType || "movie", 0.25));
    return [...pool.values()].map(({ x, base }) => { const t = x.media_type || "movie"; const g = (x.genre_ids || []).reduce((a, id) => a + (weights[t].get(id) || 0) / most[t], 0); return { x, score: base + g * 0.35 + (x.vote_average || 0) / 25 }; })
      .sort((a, b) => b.score - a.score).slice(0, FOR_YOU).map(({ x }) => item(x, x.media_type));
  }, [recs, extra, weights]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!seeds.length) return null;
  return (
    <>
      <WideRow title="For You" items={forYou || []} />
      <BecauseRow history={seeds} start={0} />
      {seeds.length > 1 ? <BecauseRow history={seeds} start={1} /> : null}
      {pick ? <TopPicks genreId={pick.genreId} mediaType={pick.mediaType} seen={seen} /> : null}
    </>
  );
}
