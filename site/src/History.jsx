import { useEffect, useState } from "react";
import { tmdb, item } from "./tmdb.js";
import { allProgress } from "./line.js";
import { WideCard } from "./Home.jsx";

/* atlantic.bz/history: "Watch History", then Continue Watching — what you
   started and did not finish, newest first, as wide cards with the episode,
   the title's logo and a bar of how far you got (the share watched, exactly).
   The progress is the site's own, kept in this browser (line.js). */

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

export default function History() {
  const [rows, setRows] = useState(null);
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
        {rows && !rows.length ? <p className="text-white/50">Nothing here yet. Anything you watch or mark as watched will show up on this page.</p> : null}
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
      </div>
    </div>
  );
}
