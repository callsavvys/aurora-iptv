import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { IMG, tmdb, item } from "./tmdb.js";
import { Fade } from "./Home.jsx";
import { PlayIcon, BookmarkIcon } from "./icons.jsx";

/* atlantic.bz's Movies and TV Shows pages: a title, the genres as chips, and
   a grid of posters that keeps going as you scroll. Hovering a poster shows
   its name, year and score. The markup and classes are the site's. */

const CHIP = "shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors";
const CHIP_ON = "bg-atlantic-500 text-abyss-950";
const CHIP_OFF = "bg-white/5 text-white/70 hover:bg-white/10";

export function PosterCard({ it }) {
  return (
    <div className="group relative z-0 text-left transition-transform duration-200 hover:z-20 hover:-translate-y-1 hover:scale-[1.05]">
      <Link draggable="false" className="block w-full text-left" to={`/title/${it.type}/${it.id}`}>
        <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-abyss-800 shadow-none transition-shadow duration-200 group-hover:shadow-2xl group-hover:shadow-black/60">
          <Fade src={IMG("w342", it.poster)} alt={it.title} className="h-full w-full object-cover" />
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/90 via-black/10 to-transparent p-3 transition-opacity duration-200 opacity-100 md:opacity-0 md:group-hover:opacity-100">
            <div className="mb-2 hidden h-8 w-8 items-center justify-center rounded-full bg-white/90 transition-opacity duration-200 md:flex "><PlayIcon size={14} fill="#050b12" /></div>
            <p className="truncate text-sm font-semibold text-white">{it.title}</p>
            <div className="flex items-center gap-2 text-xs text-white/60">{it.year ? <span>{it.year}</span> : null}{it.rating ? <span className="hidden text-atlantic-300 md:inline">★ {it.rating}</span> : null}</div>
          </div>
        </div>
      </Link>
      <button type="button" aria-label={`Save ${it.title} to a list`} aria-haspopup="dialog" aria-expanded="false" className="absolute right-2 top-2 z-20 flex h-8 w-8 items-center justify-center rounded-full border backdrop-blur-md transition-all duration-200 hover:scale-110 focus-visible:opacity-100 active:scale-95 opacity-100 md:opacity-0 md:group-hover:opacity-100 border-white/20 bg-black/55 text-white hover:border-white/40 hover:bg-black/75 "><BookmarkIcon /></button>
    </div>
  );
}

/* a grid that loads the next page when its end comes into view */
export function PosterGrid({ load, deps }) {
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [done, setDone] = useState(false);
  const busy = useRef(false);
  const end = useRef(null);
  useEffect(() => { setItems([]); setPage(1); setDone(false); busy.current = false; }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
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
  const [genre, setGenre] = useState(null);
  useEffect(() => { setGenre(null); tmdb(`/genre/${type}/list`).then((g) => setGenres(g.genres || [])).catch(() => {}); }, [type]);
  useEffect(() => { document.title = `${type === "tv" ? "Watch TV Shows" : "Watch Movies"} — Aurora`; }, [type]);
  // the site's list, found by matching its order exactly: TMDB's most popular
  // with at least 100 votes (genre pages add the genre)
  const load = (page) => tmdb(`/discover/${type}`, { sort_by: "popularity.desc", "vote_count.gte": "100", page: String(page), ...(genre ? { with_genres: String(genre) } : {}) })
    .then((r) => ({ results: (r.results || []).map((x) => item(x, type)), totalPages: r.total_pages || 1 }));
  return (
    <div className="transition-opacity duration-150 opacity-100">
      <div className="px-6 py-10 sm:px-[60px]">
        <h1 className="mb-6 text-3xl font-bold text-white">{type === "tv" ? "TV Shows" : "Movies"}</h1>
        <div className="no-scrollbar mb-8 flex gap-2 overflow-x-auto pb-1">
          <button type="button" onClick={() => setGenre(null)} className={`${CHIP} ${genre === null ? CHIP_ON : CHIP_OFF}`}>All</button>
          {genres.map((g) => <button key={g.id} type="button" onClick={() => setGenre(g.id)} className={`${CHIP} ${genre === g.id ? CHIP_ON : CHIP_OFF}`}>{g.name}</button>)}
        </div>
        <PosterGrid load={load} deps={[type, genre]} />
      </div>
    </div>
  );
}
