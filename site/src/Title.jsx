import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import Player from "./Player.jsx";
import { getLine, findOnLine, lineEpisodes, streamUrl, progressKey, getProgress, saveProgress, toggleWatched } from "./line.js";
import { IMG, tmdb, item } from "./tmdb.js";
import { AddToList } from "./lists.jsx";
import { WideCard, Scroller } from "./Home.jsx";

/* atlantic.bz's title page, element for element: the backdrop with the facts
   box at the top right, the title art, genres, Play and the round buttons,
   year · age rating · IMDb · TMDB, who made it, the story; then the episodes
   (a series), the cast and More Like This. */

const OMDB = __OMDB_KEY__;
const ROUND = "flex h-10 w-10 items-center justify-center rounded-full border transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 border-white/15 bg-white/10 text-white hover:border-white/25 hover:bg-white/20";
const BADGE = "inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.06] px-1.5 py-1 text-sm font-semibold text-white transition-colors hover:border-white/25 hover:bg-white/[0.12]";
const money = (n) => (n ? `$${Number(n).toLocaleString("en-US")}` : "");
const runtime = (m) => (m ? `${Math.floor(m / 60) ? `${Math.floor(m / 60)}h ` : ""}${m % 60}m` : "");
const lang = (code) => { try { return new Intl.DisplayNames(["en"], { type: "language" }).of(code); } catch { return code; } };
const votes = (n) => (n >= 1000 ? `${Math.round(n / 1000)}K` : String(n || 0));

async function imdbScore(imdbId) {
  if (!imdbId || !OMDB) return "";
  try { const r = await fetch(`https://www.omdbapi.com/?apikey=${OMDB}&i=${imdbId}`).then((x) => x.json()); return r.imdbRating && r.imdbRating !== "N/A" ? r.imdbRating : ""; } catch { return ""; }
}

function Episodes({ tvId, seasons, onPlay }) {
  const real = seasons.filter((s) => s.season_number > 0);
  const [n, setN] = useState(real[0]?.season_number || 1);
  const [eps, setEps] = useState([]);
  useEffect(() => { setEps([]); tmdb(`/tv/${tvId}/season/${n}`).then((s) => setEps(s.episodes || [])).catch(() => {}); }, [tvId, n]);
  return (
    <section id="episodes" className="px-6 py-10 sm:px-[60px]">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white/90 drop-shadow-md transition-colors duration-300">Episodes</h2>
        <select value={n} onChange={(e) => setN(Number(e.target.value))} className="rounded border border-white/10 bg-abyss-900 px-3 py-1.5 text-sm text-white outline-none">
          {real.map((s) => <option key={s.season_number} value={s.season_number}>{s.name?.startsWith("Season") ? s.name : `Season ${s.season_number}`}</option>)}
        </select>
      </div>
      <div className="space-y-2">
        {eps.map((ep) => (
          <button key={ep.id} type="button" onClick={() => onPlay(ep.season_number, ep.episode_number, ep.name)} className="flex w-full items-center gap-4 rounded-lg p-2 text-left hover:bg-white/5">
            <div className="relative aspect-video w-40 shrink-0 overflow-hidden rounded bg-abyss-800">{ep.still_path ? <img src={IMG("w300", ep.still_path)} alt={ep.name} loading="lazy" decoding="async" className="h-full w-full object-cover" /> : null}</div>
            <div className="min-w-0"><p className="truncate font-semibold text-white">{ep.episode_number}. {ep.name}</p><p className="line-clamp-2 text-sm text-white/50">{ep.overview}</p></div>
          </button>
        ))}
      </div>
    </section>
  );
}

export default function Title() {
  const { type, id } = useParams();
  const [d, setD] = useState(null);
  const [imdb, setImdb] = useState("");
  const [player, setPlayer] = useState(null);
  const [note, setNote] = useState("");
  const [search] = useSearchParams();
  const nav = useNavigate();
  useEffect(() => {
    setD(null); setImdb("");
    tmdb(`/${type}/${id}`, { append_to_response: `images,credits,recommendations,similar,external_ids,${type === "tv" ? "content_ratings" : "release_dates"}`, include_image_language: "en,null" })
      .then((x) => { setD(x); document.title = `Watch ${x.title || x.name} (${(x.release_date || x.first_air_date || "").slice(0, 4)}) — Aurora`; imdbScore(x.external_ids?.imdb_id || x.imdb_id).then(setImdb); })
      .catch(() => setD({ error: true }));
  }, [type, id]);

  /* Play: the title is looked for on your line (by TMDB id, else by name and
     year); a series starts where you left off, or at its first episode */
  const play = useCallback(async (season, episode, epName) => {
    if (!d || d.error) return;
    if (!getLine()) { setNote("Connect your IPTV line in Settings to play."); setTimeout(() => nav("/settings"), 1200); return; }
    const name = d.title || d.name;
    setNote("Finding it on your line…");
    try {
      const hit = await findOnLine({ type, id: Number(id), title: name, originalTitle: d.original_title || d.original_name, year: (d.release_date || d.first_air_date || "").slice(0, 4) });
      if (!hit) { setNote(`${name} is not on your line.`); return; }
      if (type === "movie") {
        const key = progressKey("movie", id);
        const p = getProgress(key);
        setNote("");
        setPlayer({ src: streamUrl(hit), title: name, subtitle: "", startAt: p && p.position < p.duration - 60 ? p.position : 0, key, item: hit, meta: { type, tmdb: Number(id), imdb: d.external_ids?.imdb_id || d.imdb_id, title: name, poster: d.poster_path || "", backdrop: d.backdrop_path || "" } });
        return;
      }
      const eps = await lineEpisodes(hit.id);
      const seasonsOnLine = Object.keys(eps).map(Number).filter((n) => n > 0).sort((a, b) => a - b);
      if (!seasonsOnLine.length) { setNote(`Your line lists no episodes for ${name}.`); return; }
      let s = season, e = episode;
      if (!s) { const last = JSON.parse(localStorage.getItem(`aurora-site-last:${id}`) || "null"); s = last?.s || seasonsOnLine[0]; e = last?.e || (eps[s]?.[0]?.number ?? 1); }
      const ep = (eps[s] || []).find((x) => x.number === e);
      if (!ep) { setNote(`Season ${s}, episode ${e} is not on your line.`); return; }
      const key = progressKey("tv", id, s, e);
      const p = getProgress(key);
      const list = eps[s] || [];
      const nextEp = list[list.findIndex((x) => x.number === e) + 1] || (eps[s + 1] || [])[0];
      localStorage.setItem(`aurora-site-last:${id}`, JSON.stringify({ s, e }));
      // the episode's name from TMDB, when Play or Next started it without one
      if (!epName) epName = await tmdb(`/tv/${id}/season/${s}`).then((x) => (x.episodes || []).find((q) => q.episode_number === e)?.name || "").catch(() => "");
      setNote("");
      setPlayer({ src: streamUrl(hit, ep), title: name, subtitle: `S${s}E${e}${epName ? ` - ${epName}` : ""}`, startAt: p && p.position < p.duration - 60 ? p.position : 0, key, item: hit, meta: { type, tmdb: Number(id), imdb: d.external_ids?.imdb_id, season: s, episode: e, title: name, poster: d.poster_path || "", backdrop: d.backdrop_path || "" },
        next: nextEp ? () => play(nextEp.season, nextEp.number) : null });
    } catch (err) { setNote(err.message || "Your line did not answer."); }
  }, [d, type, id, nav]);
  // ?play=1 plays it (a watch party sends guests here, with &s=&e= for an episode)
  useEffect(() => { if (d && !d.error && search.get("play") === "1") play(Number(search.get("s")) || undefined, Number(search.get("e")) || undefined); }, [d, search.toString()]); // eslint-disable-line react-hooks/exhaustive-deps
  const onProgress = useCallback((position, duration) => { if (player?.key) saveProgress(player.key, { position, duration }); }, [player?.key]);

  if (!d) return <div className="relative z-10 -mt-[60px] h-[calc(75vh+60px)] min-h-[560px] w-full" />;
  if (d.error) return <div className="px-6 pt-32 sm:px-[60px]"><h1 className="text-3xl font-bold text-white">Not found</h1></div>;

  const title = d.title || d.name;
  const year = (d.release_date || d.first_air_date || "").slice(0, 4);
  const logos = d.images?.logos || [];
  const png = (l) => !/\.svg$/i.test(l.file_path);
  const logo = logos.find((l) => l.iso_639_1 === "en" && png(l)) || logos.find(png);
  const cert = type === "tv" ? (d.content_ratings?.results || []).find((r) => r.iso_3166_1 === "US")?.rating
    : ((d.release_dates?.results || []).find((r) => r.iso_3166_1 === "US")?.release_dates || []).map((r) => r.certification).find(Boolean);
  const makers = type === "tv" ? (d.created_by || []).map((c) => ({ id: c.id, name: c.name })) : (d.credits?.crew || []).filter((c) => c.job === "Director").map((c) => ({ id: c.id, name: c.name }));
  // the first US date (its premiere), as the site shows it
  const usDates = ((d.release_dates?.results || []).find((r) => r.iso_3166_1 === "US")?.release_dates || []);
  const usRelease = usDates.map((r) => r.release_date).filter(Boolean).sort()[0] || "";
  const facts = [
    type === "movie" && d.runtime ? ["Runtime", runtime(d.runtime)] : null,
    d.original_language ? ["Language", lang(d.original_language)] : null,
    type === "movie" && (usRelease || d.release_date) ? ["Release Date", new Date(`${(usRelease || d.release_date).slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })] : null,
    type === "movie" && d.budget ? ["Budget", money(d.budget)] : null,
    type === "movie" && d.revenue ? ["Revenue", money(d.revenue)] : null,
  ].filter(Boolean);
  const studios = (d.production_companies || []).filter((c) => c.logo_path).slice(0, 2);
  const more = (d.recommendations?.results?.length ? d.recommendations.results : d.similar?.results || []).map((x) => item(x, type));

  return (
    <div className="transition-opacity duration-150 opacity-100">
      <div className="relative">
        <div className="relative z-10 -mt-[60px] h-[calc(75vh+60px)] min-h-[560px] w-full">
          <div className="absolute inset-0" style={{ maskImage: "linear-gradient(rgb(0, 0, 0) 0%, rgb(0, 0, 0) 45%, rgba(0, 0, 0, 0.6) 72%, transparent 100%)", WebkitMaskImage: "linear-gradient(rgb(0, 0, 0) 0%, rgb(0, 0, 0) 45%, rgba(0, 0, 0, 0.6) 72%, transparent 100%)" }}>
            {d.backdrop_path ? <img src={IMG("original", d.backdrop_path)} alt={title} fetchpriority="high" decoding="async" className="h-full w-full object-cover object-[center_20%]" /> : null}
            <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/15 to-transparent" />
            <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/35 to-transparent" />
          </div>
          <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(55% 42% at 14% 58%, rgba(0, 0, 0, 0.42), transparent 100%)" }} />
          {facts.length || studios.length ? (
            <div className="absolute right-6 top-[156px] hidden w-64 space-y-2 rounded-lg border border-white/10 bg-abyss-900/80 p-4 text-sm backdrop-blur-sm md:block md:right-[60px]">
              {facts.map(([k, v]) => <div key={k} className="flex justify-between"><span className="text-white/40">{k}</span><span className="text-white">{v}</span></div>)}
              {studios.length ? <div className="flex flex-wrap gap-2 pt-2">{studios.map((c) => <div key={c.id} className="flex h-8 items-center rounded bg-white/90 px-2"><img src={IMG("w185", c.logo_path)} alt={c.name} loading="lazy" decoding="async" className="h-5 object-contain" /></div>)}</div> : null}
            </div>
          ) : null}
          <div className="absolute bottom-[10%] left-6 w-[92%] max-w-2xl sm:left-[60px]">
            {logo ? <img src={IMG("w500", logo.file_path)} alt={title} className="mb-3 max-h-28 max-w-full object-contain drop-shadow-lg" />
              : <h1 className="mb-3 text-4xl font-black tracking-tight text-white drop-shadow-lg sm:text-5xl">{title}</h1>}
            <p className="mb-4 text-sm font-medium text-white/70">{(d.genres || []).map((g) => g.name).join(" • ")}</p>
            <div className="mb-4 flex items-center gap-3">
              <button type="button" onClick={() => play()} className="flex items-center gap-2 rounded-full bg-gradient-to-r from-atlantic-300 to-atlantic-500 px-6 py-2.5 text-sm font-bold text-abyss-950 shadow-[0_8px_24px_-6px_rgba(30,203,236,0.55)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_30px_-6px_rgba(30,203,236,0.7)] active:translate-y-0">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M5 2.69127C5 1.93067 5.81547 1.44851 6.48192 1.81506L23.4069 11.1238C24.0977 11.5037 24.0977 12.4963 23.4069 12.8762L6.48192 22.1849C5.81546 22.5515 5 22.0693 5 21.3087V2.69127Z" /></svg>Play
              </button>
              <AddToList e={{ id: String(id), type, title: d.title || d.name, poster: d.poster_path ? IMG("w342", d.poster_path) : "", year: (d.release_date || d.first_air_date || "").slice(0, 4) }} className={ROUND} />
              <button type="button" aria-label="Mark as Watched" onClick={() => toggleWatched({ type, id: Number(id), title: d.title || d.name, poster: d.poster_path, year: (d.release_date || d.first_air_date || "").slice(0, 4) })} className={ROUND}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>
              </button>
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-white/70">
              {year ? <span>{year}</span> : null}
              {type === "movie" && d.runtime ? <span>{runtime(d.runtime)}</span> : null}
              {cert ? <span className="rounded border border-white/30 px-1.5 py-0.5 text-xs">{cert}</span> : null}
              {d.external_ids?.imdb_id || d.imdb_id ? (
                <a href={`https://www.imdb.com/title/${d.external_ids?.imdb_id || d.imdb_id}/`} target="_blank" rel="noopener noreferrer" className={BADGE} aria-label="Open on IMDb" title="Open on IMDb">
                  <span aria-hidden="true" className="inline-flex h-[18px] items-center rounded-[3px] bg-[#f5c518] px-1 text-[11px] font-black leading-none tracking-tight text-black">IMDb</span>
                  {imdb ? <span>{imdb}</span> : <span className="text-white/50">–</span>}
                </a>
              ) : null}
              <a href={`https://www.themoviedb.org/${type}/${id}`} target="_blank" rel="noopener noreferrer" className={BADGE} aria-label={`TMDB rating ${d.vote_average?.toFixed(1)}, open on TMDB`} title={`${votes(d.vote_count)} votes on TMDB`}>
                <span aria-hidden="true" className="inline-flex h-[18px] items-center rounded-[3px] bg-[#0d253f] px-1 text-[10px] font-black leading-none tracking-tight"><span className="bg-gradient-to-r from-[#90cea1] to-[#01b4e4] bg-clip-text text-transparent">TMDB</span></span>
                <span>{d.vote_average ? d.vote_average.toFixed(1) : "–"}</span>
              </a>
            </div>
            {makers.length ? (
              <p className="mb-3 text-sm text-white/60">{type === "tv" ? "Creator" : "Director"}: {makers.slice(0, 1).map((m, i) => <span key={m.id}>{i ? ", " : ""}<Link className="text-white/80 transition-colors hover:text-atlantic-300" to={`/person/${m.id}`}>{m.name}</Link></span>)}</p>
            ) : null}
            <p className="line-clamp-4 text-sm text-white/80 sm:text-base">{d.overview}</p>
          </div>
        </div>
        <div className="relative z-10">
          {type === "tv" && d.seasons?.length ? <Episodes tvId={id} seasons={d.seasons} onPlay={play} /> : null}
          {d.credits?.cast?.length ? (
            <section className="px-6 py-10 sm:px-[60px]">
              <h2 className="mb-4 text-xl font-semibold text-white/90 drop-shadow-md transition-colors duration-300">Cast</h2>
              <div className="no-scrollbar flex gap-4 overflow-x-auto pb-2">
                {d.credits.cast.slice(0, 20).map((c) => (
                  <Link key={c.credit_id || c.id} draggable="false" className="group w-24 shrink-0 text-center" to={`/person/${c.id}`}>
                    <div className="mx-auto mb-2 h-20 w-20 overflow-hidden rounded-full bg-abyss-800 ring-2 ring-transparent transition-all duration-200 group-hover:scale-105 group-hover:ring-atlantic-400/60">{c.profile_path ? <img src={IMG("w185", c.profile_path)} alt={c.name} loading="lazy" decoding="async" className="h-full w-full object-cover" /> : null}</div>
                    <p className="truncate text-xs text-white/80 transition-colors group-hover:text-atlantic-300">{c.name}</p>
                    <p className="truncate text-[11px] text-white/40">{c.character}</p>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
          {more.length ? (
            <section className="relative mb-6">
              <div className="mb-4 flex items-center justify-between px-6 sm:px-[60px] short:px-6"><h2 className="text-xl font-semibold text-white/90 drop-shadow-md transition-colors duration-300">More Like This</h2></div>
              <Scroller className="no-scrollbar overflow-x-auto overflow-y-hidden flex gap-5 px-6 py-6 sm:px-[60px] short:px-6">
                {more.map((it) => <WideCard key={`${it.type}-${it.id}`} it={it} />)}
              </Scroller>
            </section>
          ) : null}
        </div>
      </div>
      {note ? <div className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-2xl border border-white/10 bg-pagebg/95 px-4 py-3 text-sm text-white shadow-[0_8px_24px_-8px_rgba(0,0,0,0.6)] backdrop-blur-md">{note}</div> : null}
      {player ? <Player key={player.src} src={player.src} title={player.title} subtitle={player.subtitle} startAt={player.startAt} onProgress={onProgress} onClose={() => { setPlayer(null); if (search.get("play")) nav(`/title/${type}/${id}`, { replace: true }); }} onNext={player.next || undefined} onEnded={() => player.next?.()} meta={player.meta}
        onEpisodes={type === "tv" ? () => { setPlayer(null); setTimeout(() => document.getElementById("episodes")?.scrollIntoView({ behavior: "smooth" }), 100); } : undefined} /> : null}
    </div>
  );
}
