import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { animeRows } from "./anilist.js";
import { Scroller, Fade } from "./Home.jsx";

/* atlantic.bz/anime: a hero of this week's trending anime (its banner, score,
   year, three genres, the story, Watch), then six rows of covers from AniList.
   The markup and classes are the site's. */

function Hero({ items }) {
  const [index, setIndex] = useState(0);
  const paused = useRef(false);
  useEffect(() => {
    if (items.length < 2) return undefined;
    const t = setInterval(() => { if (!paused.current) setIndex((i) => (i + 1) % items.length); }, 8000);
    return () => clearInterval(t);
  }, [items.length]);
  const it = items[index];
  if (!it) return <div className="relative z-10 -mt-[60px] h-[calc(62vh+60px)] min-h-[520px] w-full" />;
  return (
    <div className="relative z-10 -mt-[60px] h-[calc(62vh+60px)] min-h-[520px] w-full" onMouseEnter={() => { paused.current = true; }} onMouseLeave={() => { paused.current = false; }}>
      <div className="absolute inset-0" style={{ maskImage: "linear-gradient(rgb(0, 0, 0) 0%, rgb(0, 0, 0) 45%, rgba(0, 0, 0, 0.6) 72%, transparent 100%)" }}>
        {items.map((h, i) => (
          <div key={h.id} className={`absolute inset-0 transition-opacity duration-[900ms]${i === index ? " opacity-100" : " pointer-events-none opacity-0"}`}>
            <img src={h.banner} alt="" decoding="async" loading={i === 0 ? "eager" : "lazy"} className="h-full w-full object-cover object-[center_20%]" />
          </div>
        ))}
        <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/15 to-transparent" />
        <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/35 to-transparent" />
      </div>
      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(55% 42% at 14% 58%, rgba(0, 0, 0, 0.42), transparent 100%)" }} />
      <div key={it.id} className="absolute bottom-[12%] left-6 w-[90%] max-w-xl animate-hero-in sm:left-[60px]">
        <p className="mb-2 text-xs font-bold uppercase tracking-widest text-atlantic-300">Trending now</p>
        <h1 className="text-3xl font-extrabold leading-tight text-white drop-shadow-lg sm:text-5xl">{it.title}</h1>
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm font-semibold text-white/90">
          {it.score ? <span className="text-atlantic-300">★ {it.score}</span> : null}
          {it.score && it.year ? <span className="text-white/40">·</span> : null}
          {it.year ? <span>{it.year}</span> : null}
          {it.genres.slice(0, 3).map((g) => <span key={g} className="rounded-full border border-white/25 bg-white/10 px-2.5 py-0.5 text-[11px] font-bold tracking-wide backdrop-blur-sm">{g}</span>)}
        </div>
        <p className="mt-4 line-clamp-3 text-sm text-white/80 drop-shadow sm:text-base">{it.description}</p>
        <div className="mt-6 flex items-center gap-4">
          <Link className="flex items-center gap-2 rounded-full bg-gradient-to-r from-atlantic-300 to-atlantic-500 px-6 py-3 text-sm font-bold text-abyss-950 shadow-[0_8px_24px_-6px_rgba(30,203,236,0.55)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_30px_-6px_rgba(30,203,236,0.7)] active:translate-y-0" to={`/anime/${it.id}`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>Watch
          </Link>
        </div>
      </div>
      <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2">
        {items.map((h, i) => <button key={h.id} type="button" aria-label={`Show ${h.title}`} onClick={() => setIndex(i)} className={`h-1.5 rounded-full transition-all duration-300 ${i === index ? "w-7 bg-white" : "w-3 bg-white/30 hover:bg-white/55"}`} />)}
      </div>
    </div>
  );
}

export function Card({ a }) {
  return (
    <div className="w-[140px] shrink-0 snap-start sm:w-[160px]">
      <Link draggable="false" className="group relative z-0 block w-full text-left transition-transform duration-200 hover:z-20 hover:-translate-y-1" to={`/anime/${a.id}`}>
        <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-abyss-800 transition-shadow duration-200 group-hover:shadow-2xl group-hover:shadow-black/60" style={a.color ? { backgroundColor: a.color } : undefined}>
          <Fade src={a.cover} alt={a.title} className="h-full w-full object-cover" />
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 bg-gradient-to-b from-black/60 to-transparent p-2">
            {a.format ? <span className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/80">{a.format}</span> : null}
            {a.score ? <span className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-atlantic-300">★ {a.score}</span> : null}
          </div>
        </div>
        {a.label ? <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-atlantic-300">{a.label}</p> : null}
        <p className={`${a.label ? "" : "mt-2 "}line-clamp-2 text-sm font-semibold leading-snug text-white/90`}>{a.title}</p>
        {a.line ? <p className="text-xs text-white/45">{a.line}</p> : null}
      </Link>
    </div>
  );
}

/* a row of covers, as every anime row on the site is laid out */
export function AnimeRow({ title, items }) {
  if (!items.length) return null;
  return (
    <section className="relative mb-6">
      <div className="mb-4 flex items-center justify-between px-6 sm:px-[60px] short:px-6"><h2 className="text-xl font-semibold text-white/90 drop-shadow-md transition-colors duration-300">{title}</h2></div>
      <Scroller className="no-scrollbar overflow-x-auto overflow-y-hidden flex gap-5 px-6 py-6 sm:px-[60px] short:px-6">
        {items.map((a) => <Card key={a.id} a={a} />)}
      </Scroller>
    </section>
  );
}

export default function Anime() {
  const [data, setData] = useState({ hero: [], rows: [] });
  useEffect(() => { document.title = "Anime — Aurora"; animeRows().then(setData).catch(() => {}); }, []);
  return (
    <div className="transition-opacity duration-150 opacity-100">
      <div className="relative">
        <Hero items={data.hero} />
        <div className="relative z-10 mt-4">
          {data.rows.map((r) => <AnimeRow key={r.title} title={r.title} items={r.items} />)}
        </div>
      </div>
    </div>
  );
}
