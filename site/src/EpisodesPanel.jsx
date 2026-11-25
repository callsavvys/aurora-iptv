import { useEffect, useState } from "react";
import { tmdb, IMG } from "./tmdb.js";
import { getProgress, progressKey } from "./line.js";

/* The player's Episodes panel, in atlantic.bz's markup: the season's episodes
   (still, number and name, overview, a check on the ones you finished), and
   "Season N" opening the list of seasons. */
const Chevron = ({ d }) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
const BOX = "fixed bottom-20 right-4 z-[70] max-h-[70dvh] w-[343px] short:bottom-14 short:max-h-[calc(100dvh-4.5rem)] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl bg-black/95 shadow-2xl sm:right-6";

export default function EpisodesPanel({ tvId, seasons, season: playingSeason, episode: playingEpisode, onSelect }) {
  const [view, setView] = useState("episodes");
  const [season, setSeason] = useState(playingSeason || 1);
  const [eps, setEps] = useState(null);
  useEffect(() => { setEps(null); tmdb(`/tv/${tvId}/season/${season}`).then((s) => setEps(s.episodes || [])).catch(() => setEps([])); }, [tvId, season]);
  const watched = (n) => { const p = getProgress(progressKey("tv", tvId, season, n)); return !!p?.duration && p.position >= p.duration * 0.95; };
  if (view === "seasons") {
    return (
      <div className={`${BOX} p-3`} onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={() => setView("episodes")} className="mb-3 flex w-full items-center gap-2 text-sm font-semibold text-white hover:text-atlantic-300"><Chevron d="m15 18-6-6 6-6" />Seasons</button>
        <div className="space-y-1">
          {Array.from({ length: Math.max(seasons, season) }, (_, i) => i + 1).map((n) => (
            <button key={n} type="button" onClick={() => { setSeason(n); setView("episodes"); }} className={`flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left ${n === season ? "bg-atlantic-500/20 text-atlantic-300" : "text-white hover:bg-white/10"}`}>
              <span className={`flex h-7 w-9 shrink-0 items-center justify-center rounded text-xs font-bold ${n === season ? "bg-atlantic-500/30" : "bg-white/10"}`}>S{n}</span>
              <span className="font-medium">Season {n}</span>
              {n === playingSeason ? <span className="ml-auto text-xs text-white/40">Playing</span> : null}
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className={`${BOX} p-2`} onClick={(e) => e.stopPropagation()}>
      {seasons > 1 ? <button type="button" onClick={() => setView("seasons")} className="mb-1 flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-white hover:bg-white/10"><span className="font-semibold">Season {season}</span><Chevron d="m9 18 6-6-6-6" /></button> : null}
      {eps === null ? <p className="px-2 py-3 text-sm text-white/40">Loading episodes…</p>
        : eps.length === 0 ? <p className="px-2 py-3 text-sm text-white/40">No episodes found for this season.</p>
          : eps.map((ep) => {
            const on = season === playingSeason && ep.episode_number === playingEpisode;
            return (
              <button key={ep.id} type="button" onClick={() => onSelect(season, ep.episode_number, ep.name)} className={`flex w-full items-center gap-3 rounded-lg p-2 text-left ${on ? "bg-atlantic-500/20" : "hover:bg-white/10"}`}>
                <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded bg-abyss-800">
                  {ep.still_path ? <img src={IMG("w300", ep.still_path)} alt={ep.name} className="h-full w-full object-cover" /> : null}
                  {watched(ep.episode_number) ? <div className="absolute inset-0 flex items-center justify-center bg-black/50"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-atlantic-300"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg></div> : null}
                </div>
                <div className="min-w-0"><p className={`truncate text-sm font-semibold ${on ? "text-atlantic-300" : "text-white"}`}>{ep.episode_number}. {ep.name}</p><p className="line-clamp-2 text-xs text-white/50">{ep.overview}</p></div>
              </button>
            );
          })}
    </div>
  );
}
