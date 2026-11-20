import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { tmdb, item, IMG } from "./tmdb.js";
import { allProgress, allWatched, unwatch } from "./line.js";
import { WideCard, Fade } from "./Home.jsx";

/* atlantic.bz/history: "Watch History", then Continue Watching — what you
   started and did not finish, newest first, as wide cards with the episode,
   the title's logo and a bar of how far you got (the share watched, exactly) —
   and Watched: what you marked with Mark as Watched, as posters you can
   remove. Both are the site's own, kept in this browser (line.js). */

const FINISHED = 0.95;   // past this share a title counts as watched (web/js/sync-core.js)

/* one entry per title: the newest film or episode position saved for it */
function started() {
  const latest = new Map();
  for (const [key, p] of Object.entries(allProgress())) {
    const m = /^(movie|tv):(\d+)(?::s(\d+)e(\d+))?$/.exec(key);
    if (!m || !p?.duration) continue;
    const id = `${m[1]}:${m[2]}`;
    if (!latest.has(id) || (p.at || 0) > (latest.get(id).at || 0)) latest.set(id, { type: m[1], id: Number(m[2]), season: Number(m[3]) || 0, episode: Number(m[4]) || 0, ...p });
  }
  return [...latest.values()].filter((e) => e.position < e.duration * FINISHED).sort((a, b) => (b.at || 0) - (a.at || 0));
}

/* a watched title: its poster, the name and year on hover, and × to remove it */
function WatchedCard({ w, onRemove }) {
  return (
    <div className="w-[140px] sm:w-[160px]">
      <div className="group relative z-0 text-left transition-transform duration-200 hover:z-20 hover:-translate-y-1 hover:scale-[1.05] ">
        <Link draggable="false" className="block w-full text-left" to={`/title/${w.type}/${w.id}`}>
          <div className="aspect-[2/3] w-full overflow-hidden rounded-lg bg-abyss-800 shadow-none transition-shadow duration-200 group-hover:shadow-2xl group-hover:shadow-black/60">
            <Fade src={IMG("w342", w.poster)} alt={w.title} className="h-full w-full object-cover" />
            <div className="pointer-events-none absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/90 via-black/10 to-transparent p-3 opacity-100 transition-opacity duration-200 md:opacity-0 md:group-hover:opacity-100">
              <p className="truncate text-sm font-semibold text-white">{w.title}</p>
              {w.year ? <span className="text-xs text-white/60">{w.year}</span> : null}
            </div>
          </div>
        </Link>
        <button type="button" aria-label={`Remove ${w.title}`} onClick={onRemove} className="absolute -left-2 -top-2 z-30 flex h-7 w-7 items-center justify-center rounded-full bg-black text-white shadow-lg ring-2 ring-white/80 transition-opacity hover:bg-red-600 opacity-100 md:opacity-0 md:group-hover:opacity-100">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
    </div>
  );
}

export default function History() {
  const [rows, setRows] = useState(null);
  const [watched, setWatched] = useState(allWatched);
  useEffect(() => {
    document.title = "Your Watch History — Aurora";
    const list = started();
    Promise.all(list.map((e) => tmdb(`/${e.type}/${e.id}`).then((d) => ({ e, it: { ...item(d, e.type), year: "" } })).catch(() => null)))
      .then((r) => setRows(r.filter(Boolean)));
  }, []);
  return (
    <div className="transition-opacity duration-150 opacity-100">
      <div className="px-6 pb-20 pt-32 sm:px-[60px]">
        <h1 className="mb-8 text-3xl font-bold text-white">Watch History</h1>
        {rows && !rows.length && !watched.length ? <p className="text-white/50">Nothing here yet. Anything you watch or mark as watched will show up on this page.</p> : null}
        {rows?.length ? (
          <section className="mb-10">
            <h2 className="mb-4 text-xl font-semibold text-white/90 drop-shadow-md transition-colors duration-300">Continue Watching</h2>
            <div className="flex flex-wrap gap-5">
              {rows.map(({ e, it }) => (
                <div key={`${e.type}-${e.id}`} className="w-[280px] sm:w-[320px]">
                  <WideCard it={it} to={`/title/${e.type}/${e.id}?play=1`} badge={e.season ? `S${e.season} E${e.episode}` : ""} progress={(e.position / e.duration) * 100} />
                </div>
              ))}
            </div>
          </section>
        ) : null}
        {watched.length ? (
          <section>
            <h2 className="mb-4 text-xl font-semibold text-white/90 drop-shadow-md transition-colors duration-300">Watched</h2>
            <div className="flex flex-wrap gap-5">
              {watched.map((w) => <WatchedCard key={`${w.type}-${w.id}`} w={w} onRemove={() => { unwatch(w.type, w.id); setWatched(allWatched()); }} />)}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
