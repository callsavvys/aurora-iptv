import { useEffect, useRef, useState } from "react";
import { extras, IMG } from "./tmdb.js";

/* The TV's stage: on Home, once the remote is in the rows, the top of the
   screen shows the card you are on (its picture, logo or name, year, score,
   genres and a few lines about it), as Netflix and Apple TV do; the row you
   are in sits just below (tvnav.js). It follows focus: any card carrying
   data-tv-type and data-tv-id. */
const cache = new Map();
const load = (type, id) => {
  const k = `${type}:${id}`;
  if (!cache.has(k)) cache.set(k, extras({ type, id }).then((m) => ({ ...m, type, id })).catch(() => null));
  return cache.get(k);
};

export default function TvStage() {
  const [on, setOn] = useState(false);
  const [m, setM] = useState(null);
  const timer = useRef(null);
  useEffect(() => {
    const root = document.documentElement;
    const watch = new MutationObserver(() => setOn(root.classList.contains("tv-rows")));
    watch.observe(root, { attributes: true, attributeFilter: ["class"] });
    const focus = (e) => {
      const card = e.target.closest?.("[data-tv-id]");
      if (!card) return;
      clearTimeout(timer.current);
      // a moment's pause, so holding an arrow down a row does not fetch every card
      timer.current = setTimeout(() => load(card.dataset.tvType, card.dataset.tvId).then((x) => x && setM(x)), 140);
    };
    document.addEventListener("focusin", focus);
    return () => { watch.disconnect(); document.removeEventListener("focusin", focus); clearTimeout(timer.current); };
  }, []);
  const d = m?.detail;
  const year = (d?.release_date || d?.first_air_date || "").slice(0, 4);
  const score = d?.vote_average ? Number(d.vote_average).toFixed(1) : "";
  return (
    <div aria-hidden={!on} className={`pointer-events-none fixed inset-x-0 top-0 overflow-hidden transition-opacity duration-300 ${on ? "opacity-100" : "opacity-0"}`} style={{ zIndex: 15, height: "var(--tv-stage, 47vh)", transition: "height 240ms ease-out, opacity 300ms ease-out", background: "linear-gradient(to bottom, rgb(var(--page-bg-rgb, 5 11 18)) 80%, rgb(var(--page-bg-rgb, 5 11 18) / 0))" }}>
      {d?.backdrop_path ? <img key={d.backdrop_path} src={IMG("w1280", d.backdrop_path)} alt="" className="absolute right-0 top-0 h-full object-cover animate-hero-in" style={{ width: "68%", maskImage: "linear-gradient(to right, transparent, black 38%)", WebkitMaskImage: "linear-gradient(to right, transparent, black 38%)" }} /> : null}
      <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgb(var(--page-bg-rgb, 5 11 18)) 2%, transparent 45%)" }} />
      {d ? (
        <div key={`${m.type}${m.id}`} className="absolute animate-hero-in" style={{ left: 60, bottom: 22, maxWidth: "46%" }}>
          <div className="mb-3 flex items-end" style={{ minHeight: 56 }}>
            {m.logo ? <img src={m.logo} alt={d.title || d.name} className="object-contain object-left-bottom" style={{ maxHeight: 72, maxWidth: 340 }} />
              : <p className="text-3xl font-extrabold leading-tight text-white">{d.title || d.name}</p>}
          </div>
          <p className="flex items-center gap-2 text-sm font-semibold text-white/85">
            {year ? <span>{year}</span> : null}
            {score ? <><span className="text-white/35">·</span><span className="text-amber-300">★ {score}</span></> : null}
            {m.genres?.length ? <><span className="text-white/35">·</span><span>{m.genres.slice(0, 2).join(" / ")}</span></> : null}
            {m.cert ? <><span className="text-white/35">·</span><span className="rounded border border-white/25 px-1.5 text-[11px]">{m.cert}</span></> : null}
          </p>
          {d.overview ? <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-white/70">{d.overview}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
