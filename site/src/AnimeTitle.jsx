import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { anime } from "./anilist.js";
import { tmdb } from "./tmdb.js";
import { AnimeRow } from "./Anime.jsx";
import { getLine, findOnLine, lineEpisodes, streamUrl, getProgress, saveProgress } from "./line.js";
import Player from "./Player.jsx";

/* atlantic.bz/anime/<id>: the banner with a facts box, the title, genres,
   Play, list and watched buttons and Sub/Dub, the year, length, format and
   score, the studio and story; the episodes 20 to a page; then Seasons &
   Related and More Like This. The markup and classes are the site's.
   Play finds the anime on your IPTV line (findAnime, below); episode N is
   the Nth episode of its season there, or the Nth the line lists. */

const ROUND = "flex h-10 w-10 items-center justify-center rounded-full border transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 border-white/15 bg-white/10 text-white hover:border-white/25 hover:bg-white/20";
const PILL_ON = "rounded-full px-3.5 py-1.5 text-sm transition-colors bg-white font-semibold text-abyss-950";
const PER_PAGE = 20;
const PlayIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M5 2.69127C5 1.93067 5.81547 1.44851 6.48192 1.81506L23.4069 11.1238C24.0977 11.5037 24.0977 12.4963 23.4069 12.8762L6.48192 22.1849C5.81546 22.5515 5 22.0693 5 21.3087V2.69127Z" /></svg>;
const Plus = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>;
const Check = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>;
const chevron = (d) => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`lucide lucide-chevron-${d === "m15 18-6-6 6-6" ? "left" : "right"} size-4`} aria-hidden="true"><path d={d} /></svg>;

/* the site's pager: the first and last pages, and the pages either side of this one */
function Pager({ page, pages, onPage }) {
  if (pages < 2) return null;
  const show = [...new Set([1, page - 1, page, page + 1, pages])].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
  const BTN = "flex items-center justify-center rounded-full p-2 text-white/80 transition-colors hover:bg-white/10 hover:text-atlantic-300 disabled:pointer-events-none disabled:opacity-30";
  const out = [];
  show.forEach((p, i) => {
    if (i && p - show[i - 1] > 1) out.push(<span key={`gap${p}`} className="px-1 text-sm text-white/40">...</span>);
    const from = (p - 1) * PER_PAGE + 1;
    out.push(<button key={p} type="button" {...(p === page ? { "aria-current": "page" } : {})} title={`Episodes ${from}-${p * PER_PAGE}`} onClick={() => onPage(p)} className={p === page ? PILL_ON : "rounded-full px-3.5 py-1.5 text-sm transition-colors font-normal text-white/60 hover:text-white"}>{p}</button>);
  });
  return (
    <nav aria-label="Episode pages" className="inline-flex items-center gap-0.5 rounded-full border border-white/10 bg-pagebg/90 p-1 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.6)]">
      <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)} className={BTN}>{chevron("m15 18-6-6 6-6")}</button>
      {out}
      <button type="button" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)} className={BTN}>{chevron("m9 18 6-6-6-6")}</button>
    </nav>
  );
}

/* AniList lists each season on its own ("Attack on Titan Season 2", "Black
   Clover 2nd Season", "Final Season", "… II"); a line keeps one series with
   seasons. The base title and the season number (last for "Final") */
function seasonOf(title) {
  const t = String(title || "");
  const pats = [[/\s*[:\-–]?\s*Season\s*(\d+)\b.*$/i, 1], [/\s*[:\-–]?\s*(\d+)(?:st|nd|rd|th)\s+Season\b.*$/i, 1], [/\s*[:\-–]?\s*(?:The\s+)?Final\s+Season\b.*$/i, "last"], [/\s+(II|III|IV|V)$/, "roman"]];
  for (const [re, kind] of pats) {
    const m = re.exec(t);
    if (!m) continue;
    const season = kind === "last" ? "last" : kind === "roman" ? ({ II: 2, III: 3, IV: 4, V: 5 })[m[1]] : Number(m[1]);
    return { base: t.slice(0, m.index).trim(), season };
  }
  return { base: t, season: 0 };
}

/* the anime on your line: by its AniList names first; then as a season of its
   series; then by the TMDB title it is (lines often carry TMDB's id and name,
   as with "A Silent Voice: The Movie" for AniList's "A Silent Voice") */
export async function findAnime(a, film) {
  const type = film ? "movie" : "tv";
  const direct = await findOnLine({ type, id: 0, title: a.english || a.romaji, originalTitle: a.romaji, year: a.year });
  if (direct) return { hit: direct, season: 0, tmdb: direct.tmdb || 0 };
  const sEn = seasonOf(a.english), sRo = seasonOf(a.romaji);
  const season = sEn.season || sRo.season;
  if (!film && season) {
    const base = await findOnLine({ type, id: 0, title: sEn.base || sRo.base, originalTitle: sRo.base, year: 0 });
    if (base) return { hit: base, season, tmdb: base.tmdb || 0 };
  }
  for (const query of [sEn.base || a.english, sRo.base || a.romaji].filter(Boolean)) {
    const r = await tmdb(`/search/${type}`, { query, ...(a.year && !season ? { [film ? "year" : "first_air_date_year"]: a.year } : {}) }).catch(() => null);
    const t = r?.results?.[0];
    if (!t) continue;
    const hit = await findOnLine({ type, id: t.id, title: t.title || t.name, originalTitle: t.original_title || t.original_name, year: season ? 0 : (t.release_date || t.first_air_date || "").slice(0, 4) });
    if (hit) return { hit, season, tmdb: t.id };
  }
  return { hit: null, season: 0, tmdb: 0 };
}

export default function AnimeTitle() {
  const { id, ep } = useParams();
  const [search] = useSearchParams();
  const nav = useNavigate();
  const [a, setA] = useState(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [lang, setLang] = useState(search.get("lang") === "dub" ? "dub" : "sub");
  const [saved, setSaved] = useState(false);
  const [watched, setWatched] = useState(false);
  const [player, setPlayer] = useState(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    setA(null); setError(""); setPage(1); setPlayer(null);
    anime(id).then((d) => { setA(d); document.title = `${d.title} — Aurora`; }).catch((e) => setError(e.message || "AniList did not answer"));
  }, [id]);

  const key = (n) => `anime:${id}${n ? `:e${n}` : ""}`;
  const onProgress = useCallback((position, duration) => { if (player?.key) saveProgress(player.key, { position, duration }); }, [player]);

  /* play the film, or episode n (the one you watched last, else the first) */
  const play = useCallback(async (n) => {
    if (!a) return;
    if (!getLine()) { setNote("Connect your IPTV line in Settings → Account to play."); return; }
    setNote("Finding it on your line…");
    try {
      const film = a.rawFormat === "MOVIE";
      const { hit, season, tmdb: tmdbId } = await findAnime(a, film);
      if (!hit) { setNote(`${a.title} is not on your line.`); return; }
      if (film) {
        const p = getProgress(key());
        setPlayer({ src: streamUrl(hit), title: a.title, subtitle: "", startAt: p && p.position < p.duration - 60 ? p.position : 0, key: key(), item: hit, meta: { type: "movie", tmdb: tmdbId } });
        setNote(""); return;
      }
      const eps = await lineEpisodes(hit.id);
      // a season of a longer series plays from that season; otherwise episode N is the Nth the line lists
      const seasons = Object.keys(eps).map(Number).filter((n) => n > 0).sort((x, y) => x - y);
      const which = season === "last" ? seasons[seasons.length - 1] : season;
      const flat = which && eps[which]?.length ? eps[which] : seasons.flatMap((n) => eps[n]);
      if (!flat.length) { setNote(`Your line lists no episodes for ${a.title}.`); return; }
      const last = Number(localStorage.getItem(`aurora-site-last:anime:${id}`) || 0);
      const num = n || last || 1;
      const e = flat[num - 1];
      if (!e) { setNote(`Episode ${num} is not on your line yet.`); return; }
      localStorage.setItem(`aurora-site-last:anime:${id}`, String(num));
      const p = getProgress(key(num));
      setPlayer({ src: streamUrl(hit, e), title: a.title, subtitle: `Episode ${num}`, startAt: p && p.position < p.duration - 60 ? p.position : 0, key: key(num), item: hit, meta: { type: "tv", tmdb: tmdbId, season: e.season, episode: e.number },
        next: flat[num] ? () => play(num + 1) : null });
      setNote("");
    } catch (err) { setNote(err.message || "Your line did not answer."); }
  }, [a, id]); // eslint-disable-line react-hooks/exhaustive-deps

  // /anime/watch/<id>/<episode> plays that episode once the page has loaded
  useEffect(() => { if (a && ep) play(Number(ep)); }, [a, ep]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="px-6 pt-32 sm:px-[60px]"><h1 className="text-3xl font-bold text-white">Not found</h1><p className="mt-2 text-sm text-white/50">{error}</p></div>;
  if (!a) return <div className="relative z-10 -mt-[60px] h-[calc(75vh+60px)] min-h-[560px] w-full" />;
  const film = a.rawFormat === "MOVIE";
  const pages = Math.ceil(a.count / PER_PAGE);
  const first = (page - 1) * PER_PAGE + 1;
  const episodes = film ? [] : Array.from({ length: Math.max(0, Math.min(PER_PAGE, a.count - first + 1)) }, (_, i) => first + i);
  const fact = (label, value, gap) => (value ? <div className={`flex justify-between${gap ? " gap-3" : ""}`}><span className="text-white/40">{label}</span><span className={gap ? "truncate text-white" : "text-white"}>{value}</span></div> : null);
  return (
    <div className="transition-opacity duration-150 opacity-100">
      <div className="relative">
        <div className="relative z-10 -mt-[60px] h-[calc(75vh+60px)] min-h-[560px] w-full">
          <div className="absolute inset-0" style={{ maskImage: "linear-gradient(rgb(0, 0, 0) 0%, rgb(0, 0, 0) 45%, rgba(0, 0, 0, 0.6) 72%, transparent 100%)" }}>
            <img src={a.banner || a.cover} alt={a.title} fetchpriority="high" decoding="async" className="h-full w-full object-cover object-[center_20%]" />
            <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/15 to-transparent" />
            <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/35 to-transparent" />
          </div>
          <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(55% 42% at 14% 58%, rgba(0, 0, 0, 0.42), transparent 100%)" }} />
          <div className="absolute right-6 top-[156px] hidden w-64 space-y-2 rounded-lg border border-white/10 bg-abyss-900/80 p-4 text-sm backdrop-blur-sm md:block md:right-[60px]">
            {fact("Format", a.rawFormat)}
            {film ? null : fact("Episodes", a.countLabel)}
            {fact("Duration", a.duration ? `${a.duration} min` : "")}
            {fact("Aired", a.aired)}
            {fact("Studio", a.studio, true)}
            {fact("Status", a.status)}
            {a.nextLine ? <p className="pt-1 text-xs text-atlantic-300">{a.nextLine}</p> : null}
          </div>
          <div className="absolute bottom-[10%] left-6 w-[92%] max-w-2xl sm:left-[60px]">
            <h1 className="mb-3 text-4xl font-extrabold text-white drop-shadow-lg sm:text-5xl">{a.title}</h1>
            {a.genres.length ? <p className="mb-4 text-sm font-medium text-white/70">{a.genres.join(" • ")}</p> : null}
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => play()} className="flex items-center gap-2 rounded-full bg-gradient-to-r from-atlantic-300 to-atlantic-500 px-6 py-2.5 text-sm font-bold text-abyss-950 shadow-[0_8px_24px_-6px_rgba(30,203,236,0.55)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_30px_-6px_rgba(30,203,236,0.7)] active:translate-y-0"><PlayIcon />Play</button>
              <div className="relative"><button type="button" aria-label="Add to List" onClick={() => setSaved((v) => !v)} className={`${ROUND}${saved ? " text-atlantic-300" : ""}`}><Plus /></button></div>
              <button type="button" aria-label="Mark as Watched" onClick={() => setWatched((v) => !v)} className={`${ROUND}${watched ? " text-atlantic-300" : ""}`}><Check /></button>
              <div className="flex items-center rounded-full border border-white/15 bg-white/10 p-0.5">
                {[["sub", "Japanese (Sub)"], ["dub", "English (Dub)"]].map(([k, label]) => <button key={k} type="button" onClick={() => setLang(k)} className={lang === k ? PILL_ON : "rounded-full px-3.5 py-1.5 text-sm transition-colors font-normal text-white/70 hover:text-white"}>{label}</button>)}
              </div>
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-white/70">
              {a.year ? <span>{a.year}</span> : null}
              {a.duration ? <span>{a.duration} min</span> : null}
              {a.rawFormat ? <span className="rounded border border-white/30 px-1.5 py-0.5 text-xs">{a.rawFormat}</span> : null}
              {a.score ? <span className="font-semibold text-atlantic-300">★ {a.score}</span> : null}
            </div>
            {a.studio ? <p className="mb-3 text-sm text-white/60">Studio: <span className="text-white/80">{a.studio}</span></p> : null}
            <p className="line-clamp-4 text-sm text-white/80 sm:text-base">{a.description}</p>
          </div>
        </div>
        <div className="relative z-10">
          {episodes.length ? (
            <section className="px-6 py-10 sm:px-[60px]">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-semibold text-white/90 drop-shadow-md transition-colors duration-300">Episodes</h2>
                <Pager page={page} pages={pages} onPage={setPage} />
              </div>
              <div className="space-y-2">
                {episodes.map((n) => { const named = a.named[n]; return (
                  <Link key={n} className="flex w-full items-center gap-4 rounded-lg p-2 text-left hover:bg-white/5" to={`/anime/watch/${a.id}/${n}?lang=${lang}`} onClick={(e) => { e.preventDefault(); play(n); }}>
                    <div className="relative aspect-video w-40 shrink-0 overflow-hidden rounded bg-abyss-800">
                      {named?.thumb ? <img src={named.thumb} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" /> : <>
                        <img src={a.banner || a.cover} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover opacity-40" />
                        <span className="absolute inset-0 flex items-center justify-center text-2xl font-bold text-white/70">{n}</span>
                      </>}
                    </div>
                    <div className="min-w-0"><p className="truncate font-semibold text-white">{n}. {named?.title || `Episode ${n}`}</p>{a.duration ? <p className="text-sm text-white/50">{a.duration} min</p> : null}</div>
                  </Link>
                ); })}
              </div>
              {pages > 1 ? <div className="mt-6 flex justify-center"><Pager page={page} pages={pages} onPage={(p) => { setPage(p); window.scrollTo({ top: document.querySelector('nav[aria-label="Episode pages"]')?.getBoundingClientRect().top + window.scrollY - 120, behavior: "smooth" }); }} /></div> : null}
            </section>
          ) : null}
          <AnimeRow title="Seasons & Related" items={a.related} />
          <AnimeRow title="More Like This" items={a.similar} />
        </div>
      </div>
      {note ? <div role="status" className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-white/10 bg-abyss-900/90 px-5 py-2.5 text-sm text-white/90 shadow-lg backdrop-blur-md">{note}</div> : null}
      {player ? <Player key={player.src} src={player.src} title={player.title} subtitle={player.subtitle} startAt={player.startAt} onProgress={onProgress} onClose={() => { setPlayer(null); if (ep) nav(`/anime/${id}`, { replace: true }); }} onNext={player.next || undefined} onEnded={() => player.next?.()} partyItem={player.item} meta={player.meta} /> : null}
    </div>
  );
}
