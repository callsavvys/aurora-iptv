import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { IMG, tmdb, item } from "./tmdb.js";
import { Fade } from "./Home.jsx";
import { PlayIcon } from "./icons.jsx";
import { SaveButton } from "./lists.jsx";
import { useRemembered, useWasRemembered } from "./memory.js";

/* atlantic.bz's Movies and TV Shows pages: a title, the genres as chips, and
   a grid of posters that keeps going as you scroll. Hovering a poster shows
   its name, year and score. The markup and classes are the site's. */

/* the site's "Load More" grid: two pages of 20 at first, then one more page
   each press — or, with auto (the View All pages), as you scroll near the end.
   pageOf(n) answers TMDB's page n; resetKey restarts it. Like the site, a
   title on two of TMDB's pages shows twice (only people are left out). */
export function LoadMoreGrid({ pageOf, type, resetKey, auto = false }) {
  // kept for Back (memory.js): coming back shows the titles already loaded, without loading them again
  const back = useRef(useWasRemembered("grid-items"));
  const [items, setItems] = useRemembered("grid-items", []);
  const [page, setPage] = useRemembered("grid-page", 1);
  const [keyed, setKeyed] = useRemembered("grid-key", resetKey);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useRemembered("grid-more", true);
  const [done, setDone] = useRemembered("grid-done", false);
  const end = useRef(null);
  const next = () => setPage((n) => (n === 1 ? 2 : n + 1));
  useEffect(() => {
    if (back.current && keyed === resetKey) return;
    setKeyed(resetKey); setItems([]); setPage(1); setMore(true); setDone(false);
  }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (back.current) { back.current = false; if (keyed === resetKey) return undefined; }
    let live = true;
    setBusy(true);
    const pages = page === 1 ? [1, 2] : [page + 1];
    Promise.all(pages.map((n) => pageOf(n)))
      .then((rs) => {
        if (!live) return;
        setItems((prev) => [...prev, ...rs.flatMap((r) => (r.results || []).filter((x) => x.media_type !== "person").map((x) => item(x, type)))]);
        const last = rs[rs.length - 1];
        setMore(last.page < last.total_pages);
      })
      .catch(() => live && setMore(false)).finally(() => { if (live) { setBusy(false); setDone(true); } });
    return () => { live = false; };
  }, [page, resetKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!auto || !more || busy || !end.current) return undefined;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { io.disconnect(); next(); } }, { rootMargin: "600px" });
    io.observe(end.current);
    return () => io.disconnect();
  }, [auto, more, busy, items.length]);
  return (
    <div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-4 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))]">{items.map((it, i) => <PosterCard key={`${it.type}-${it.id}-${i}`} it={it} />)}</div>
      {done && !items.length ? <p className="mt-10 text-center text-white/40">No results found.</p> : null}
      {more && items.length ? <div ref={end} className="mt-10 flex justify-center"><button type="button" disabled={busy} onClick={next} className="rounded bg-atlantic-500 px-8 py-3 text-sm font-bold text-abyss-950 transition-colors hover:bg-atlantic-400 disabled:opacity-50">Load More</button></div> : null}
    </div>
  );
}

const CHIP = "shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors";
const CHIP_ON = "bg-atlantic-500 text-abyss-950";
const CHIP_OFF = "bg-white/5 text-white/70 hover:bg-white/10";

export function PosterCard({ it }) {
  return (
    <div className="group relative z-0 text-left transition-transform duration-200 hover:z-20 hover:-translate-y-1 hover:scale-[1.05]">
      <Link draggable="false" className="block w-full text-left" to={`/title/${it.type}/${it.id}`} data-tv-type={it.type} data-tv-id={it.id}>
        <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-abyss-800 shadow-none transition-shadow duration-200 group-hover:shadow-2xl group-hover:shadow-black/60">
          {it.poster ? <Fade src={IMG("w342", it.poster)} alt={it.title} className="h-full w-full object-cover" />
            : <div className="flex h-full w-full items-center justify-center p-3 text-center text-xs text-white/40">{it.title}</div>}
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/90 via-black/10 to-transparent p-3 transition-opacity duration-200 opacity-100 md:opacity-0 md:group-hover:opacity-100">
            <div className="mb-2 hidden h-8 w-8 items-center justify-center rounded-full bg-white/90 transition-opacity duration-200 md:flex "><PlayIcon size={14} fill="#050b12" /></div>
            <p className="truncate text-sm font-semibold text-white">{it.title}</p>
            <div className="flex items-center gap-2 text-xs text-white/60">{it.year ? <span>{it.year}</span> : null}{it.score ? <span className="hidden text-atlantic-300 md:inline">★ {it.score}</span> : null}</div>
          </div>
        </div>
      </Link>
      <SaveButton it={it} />
    </div>
  );
}

/* a grid that loads the next page when its end comes into view */
export function PosterGrid({ load, deps }) {
  const back = useRef(useWasRemembered("grid-items"));
  const depsKey = deps.join("|");
  const [items, setItems] = useRemembered("grid-items", []);
  const [page, setPage] = useRemembered("grid-page", 1);
  const [keyed, setKeyed] = useRemembered("grid-key", depsKey);
  const [done, setDone] = useRemembered("grid-done", false);
  const busy = useRef(false);
  const end = useRef(null);
  useEffect(() => {
    if (back.current && keyed === depsKey) return;
    setKeyed(depsKey); setItems([]); setPage(1); setDone(false); busy.current = false;
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (back.current) { back.current = false; if (keyed === depsKey) return undefined; }
    let live = true;
    busy.current = true;
    load(page).then(({ results, totalPages }) => {
      if (!live) return;
      setItems((prev) => { const seen = new Set(prev.map((x) => `${x.type}-${x.id}`)); return [...prev, ...results.filter((x) => !seen.has(`${x.type}-${x.id}`))]; });
      if (page >= Math.min(totalPages, 500)) setDone(true);
      busy.current = false;
    }).catch(() => { busy.current = false; });
    return () => { live = false; };
  }, [page, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = end.current; if (!el || done) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting && !busy.current) setPage((p) => p + 1); }, { rootMargin: "800px" });
    io.observe(el); return () => io.disconnect();
  }, [done, items.length]);
  return (
    <div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-4 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))]">
        {items.map((it) => <PosterCard key={`${it.type}-${it.id}`} it={it} />)}
      </div>
      {!done ? <div ref={end} className="h-px" /> : null}
    </div>
  );
}

export default function Browse({ type }) {
  const [genres, setGenres] = useState([]);
  const [genre, setGenre] = useRemembered("genre", null);
  useEffect(() => { tmdb(`/genre/${type}/list`).then((g) => setGenres(g.genres || [])).catch(() => {}); }, [type]);
  useEffect(() => { document.title = `${type === "tv" ? "Watch Series" : "Watch Movies"} — Aurora`; }, [type]);
  // the site's list, found by matching its order exactly: TMDB's most popular
  // with at least 100 votes (genre pages add the genre)
  const load = (page) => tmdb(`/discover/${type}`, { sort_by: "popularity.desc", "vote_count.gte": "100", page: String(page), ...(genre ? { with_genres: String(genre) } : {}) })
    .then((r) => ({ results: (r.results || []).map((x) => item(x, type)), totalPages: r.total_pages || 1 }));
  return (
    <div className="transition-opacity duration-150 opacity-100">
      <div className="px-6 py-10 sm:px-[60px]">
        <h1 className="mb-6 text-3xl font-bold text-white">{type === "tv" ? "Series" : "Movies"}</h1>
        <div className="no-scrollbar mb-8 flex gap-2 overflow-x-auto pb-1">
          <button type="button" onClick={() => setGenre(null)} className={`${CHIP} ${genre === null ? CHIP_ON : CHIP_OFF}`}>All</button>
          {genres.map((g) => <button key={g.id} type="button" onClick={() => setGenre(g.id)} className={`${CHIP} ${genre === g.id ? CHIP_ON : CHIP_OFF}`}>{g.name}</button>)}
        </div>
        <PosterGrid load={load} deps={[type, genre]} />
      </div>
    </div>
  );
}
