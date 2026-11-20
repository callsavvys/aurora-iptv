import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { IMG, tmdb, list, GENRE, inCinemas, PROVIDERS, providerLogos, providerRow } from "./tmdb.js";
import { WideCard, Scroller } from "./Home.jsx";
import { LoadMoreGrid } from "./Browse.jsx";

/* atlantic.bz's Discover page: a hero of this week's trending, a sticky bar
   (Movies or TV Shows, the genres, Filters), rows, and a grid to browse with
   Load More. Every row is the TMDB query that reproduces the site's own row,
   title for title (Popular on and Browse all: at least 50 votes; Genre: 200). */

const CHIP = "shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors";
const PILL = "flex items-center gap-2.5 rounded-full border py-1.5 pl-1.5 pr-3.5 text-sm font-semibold text-white shadow-[0_6px_18px_-8px_rgba(0,0,0,0.7)] backdrop-blur-md transition-all duration-200 border-white/15 bg-white/10 hover:border-white/30 hover:bg-white/15";
const Caret = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-white/60 transition-transform duration-200 "><path d="m6 9 6 6 6-6" /></svg>;

const ROWS = {
  movie: [
    { title: "Trending This Week", load: () => tmdb("/trending/all/week"), all: "/browse?type=trending&title=Trending+This+Week" },
    { title: "In Cinemas", load: () => tmdb("/discover/movie", inCinemas()), type: "movie", all: "/browse?type=nowPlaying&title=In+Cinemas" },
    { title: "Top Rated Movies", load: () => tmdb("/movie/top_rated"), type: "movie", all: "/browse?type=topRated&mediaType=movie&title=Top+Rated+Movies" },
    { title: "Upcoming Movies", load: () => tmdb("/movie/upcoming"), type: "movie", all: "/browse?type=upcoming&title=Upcoming+Movies" },
  ],
  tv: [
    { title: "Trending Today", load: () => tmdb("/trending/tv/day"), type: "tv", all: "/browse?type=trending&mediaType=tv&title=Trending+Today" },
    { title: "Popular TV Shows", load: () => tmdb("/tv/popular"), type: "tv", all: "/browse?type=popular&mediaType=tv&title=Popular+TV+Shows" },
    { title: "Top Rated TV", load: () => tmdb("/tv/top_rated"), type: "tv", all: "/browse?type=topRated&mediaType=tv&title=Top+Rated+TV" },
    { title: "Airing Today", load: () => tmdb("/tv/airing_today"), type: "tv", all: "/browse?type=airingToday&title=Airing+Today" },
    { title: "On The Air", load: () => tmdb("/tv/on_the_air"), type: "tv", all: "/browse?type=onTheAir&title=On+The+Air" },
  ],
};

function Hero() {
  const [items, setItems] = useState([]);
  const [i, setI] = useState(0);
  useEffect(() => { tmdb("/trending/all/week").then((r) => setItems(list(r).filter((x) => x.backdrop).slice(0, 6))).catch(() => {}); }, []);
  useEffect(() => { if (!items.length) return; const t = setInterval(() => setI((x) => (x + 1) % items.length), 8000); return () => clearInterval(t); }, [items.length]);
  const it = items[i];
  return (
    <section className="relative -mt-[60px] mb-2 h-[56vh] min-h-[380px] max-h-[600px] w-full overflow-hidden" aria-roledescription="carousel" aria-label="Trending this week">
      {items.map((x, k) => <img key={x.id} src={IMG("original", x.backdrop)} alt="" aria-hidden="true" decoding="async" loading={k ? "lazy" : "eager"} className={`absolute inset-0 h-full w-full object-cover object-top transition-opacity duration-700 ${k === i ? "opacity-100" : "opacity-0"}`} />)}
      <div className="absolute inset-0 bg-gradient-to-t from-pagebg via-pagebg/30 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-pagebg/85 via-pagebg/30 to-transparent" />
      {it ? (
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-4 px-6 pb-10 sm:px-[60px]">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/70"><span className="rounded-full bg-white/15 px-2.5 py-1 backdrop-blur">{it.type === "tv" ? "TV Show" : "Movie"}</span><span>Trending this week</span></div>
          <h2 className="max-w-3xl text-3xl font-extrabold leading-tight text-white drop-shadow-lg sm:text-5xl">{it.title}</h2>
          <div className="flex items-center gap-3 text-sm text-white/80">{it.year ? <span>{it.year}</span> : null}{it.rating ? <span className="flex items-center gap-1 font-semibold text-amber-300">★ {it.rating}</span> : null}</div>
          <p className="line-clamp-3 max-w-xl text-sm leading-relaxed text-white/75 sm:text-base">{it.overview}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Link className="flex items-center gap-2 rounded-full bg-white px-6 py-2.5 text-sm font-bold text-abyss-950 transition-transform hover:scale-[1.03]" to={`/title/${it.type}/${it.id}?play=1`}><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>Watch Now</Link>
            <Link className="rounded-full bg-white/15 px-6 py-2.5 text-sm font-semibold text-white backdrop-blur transition-colors hover:bg-white/25" to={`/title/${it.type}/${it.id}`}>More Info</Link>
          </div>
          <div className="mt-1 flex items-center gap-2" role="tablist" aria-label="Choose featured title">
            {items.map((x, k) => <button key={x.id} type="button" role="tab" aria-selected={k === i} aria-label={`Show ${x.title}`} onClick={() => setI(k)} className={`h-1.5 rounded-full transition-all duration-300 ${k === i ? "w-8 bg-white" : "w-3 bg-white/35 hover:bg-white/60"}`} />)}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Row({ title, items, all, head }) {
  return (
    <section className="relative mb-6">
      <div className={head ? "mb-4 flex flex-wrap items-center justify-between gap-3 px-6 sm:px-[60px]" : "mb-4 flex items-center justify-between px-6 sm:px-[60px] short:px-6"}>
        {head || <h2 className="text-xl font-semibold text-white/90 drop-shadow-md transition-colors duration-300">{title}</h2>}
        {all ? <Link className="text-sm font-medium text-white/50 transition-colors hover:text-atlantic-300" to={all}>View All →</Link> : null}
      </div>
      <Scroller className={`no-scrollbar overflow-x-auto overflow-y-hidden flex gap-5 px-6 py-6 sm:px-[60px]${head ? "" : " short:px-6"}`}>
        {items.length ? items.map((it) => <WideCard key={`${it.type}-${it.id}`} it={it} />) : Array.from({ length: 5 }, (_, k) => <div key={k} className="aspect-video w-[200px] shrink-0 rounded-lg bg-abyss-800 sm:w-[280px] lg:w-[320px]" />)}
      </Scroller>
    </section>
  );
}

/* a pill that opens a list: the genre row's and the service row's pickers */
function Picker({ value, options, onPick, render }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => { if (!open) return; const away = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); }; document.addEventListener("pointerdown", away); return () => document.removeEventListener("pointerdown", away); }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={PILL}>{render(value)}<Caret /></button>
      {open ? (
        <div role="listbox" className="absolute left-0 top-full z-40 mt-2 max-h-80 min-w-[200px] overflow-y-auto rounded-2xl border border-white/10 bg-pagebg/95 p-1 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.6)] backdrop-blur-md">
          {options.map((o) => <button key={o.id} type="button" role="option" aria-selected={o.id === value.id} onClick={() => { onPick(o); setOpen(false); }} className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-white/10 ${o.id === value.id ? "text-atlantic-300" : "text-white/80"}`}>{render(o, true)}</button>)}
        </div>
      ) : null}
    </div>
  );
}

function GenreRow({ type, genres }) {
  const [g, setG] = useState(null);
  const [items, setItems] = useState([]);
  useEffect(() => { setG(genres[0] || null); }, [genres]);
  useEffect(() => { if (!g) return; setItems([]); tmdb(`/discover/${type}`, { ...GENRE, with_genres: String(g.id) }).then((r) => setItems(list(r, type))).catch(() => {}); }, [g, type]);
  if (!g) return null;
  const head = <div className="flex flex-wrap items-center gap-3"><h2 className="text-xl font-semibold text-white/90 drop-shadow-md">Genre</h2><Picker value={g} options={genres} onPick={setG} render={(o) => o.name} /></div>;
  return <Row head={head} items={items} all={`/browse?type=genre&genreId=${g.id}&mediaType=${type}&title=${encodeURIComponent(g.name)}`} />;
}

function ProviderRowD({ type }) {
  const [p, setP] = useState(PROVIDERS[0]);
  const [logos, setLogos] = useState({});
  const [items, setItems] = useState([]);
  useEffect(() => { providerLogos().then(setLogos).catch(() => {}); }, []);
  useEffect(() => { setItems([]); providerRow(p.id, type).then(setItems).catch(() => {}); }, [p, type]);
  const render = (o) => <>{logos[o.id] ? <img src={logos[o.id]} alt="" width="26" height="26" loading="lazy" className="shrink-0 rounded-md object-cover" style={{ width: 26, height: 26 }} /> : null}{o.name}</>;
  const head = <div className="flex flex-wrap items-center gap-3"><h2 className="text-xl font-semibold text-white/90 drop-shadow-md">Popular on</h2><Picker value={p} options={PROVIDERS} onPick={setP} render={render} /></div>;
  return <Row head={head} items={items} all={`/browse?type=discover&mediaType=${type}&withWatchProviders=${p.id}&title=${encodeURIComponent(`Popular on ${p.name}`)}`} />;
}

/* "Browse all": 20 more each time Load More is pressed */
function BrowseAll({ type, genre, sort }) {
  const votes = type === "tv" ? "100" : "50";
  return (
    <div className="border-t border-white/10 px-6 pb-12 pt-8 sm:px-[60px]">
      <h2 className="mb-5 text-xl font-semibold text-white/90">Browse all {type === "tv" ? "TV Shows" : "Movies"}</h2>
      <LoadMoreGrid type={type} resetKey={`${type}|${genre}|${sort}`} pageOf={(n) => tmdb(`/discover/${type}`, { sort_by: sort, "vote_count.gte": votes, page: String(n), ...(genre ? { with_genres: String(genre) } : {}) })} />
    </div>
  );
}

const SORTS = [["popularity.desc", "Most popular"], ["vote_average.desc", "Highest rated"], ["primary_release_date.desc", "Newest"], ["revenue.desc", "Box office"]];

export default function Discover() {
  const [type, setType] = useState("movie");
  const [genres, setGenres] = useState([]);
  const [genre, setGenre] = useState(null);
  const [sort, setSort] = useState("popularity.desc");
  const [filters, setFilters] = useState(false);
  const [rows, setRows] = useState({});
  useEffect(() => { document.title = "Discover — Aurora"; }, []);
  useEffect(() => { setGenre(null); setGenres([]); tmdb(`/genre/${type}/list`).then((g) => setGenres(g.genres || [])).catch(() => {}); }, [type]);
  useEffect(() => {
    setRows({});
    ROWS[type].forEach((r) => r.load().then((x) => setRows((s) => ({ ...s, [r.title]: list(x, r.type) }))).catch(() => {}));
  }, [type]);
  const tab = (t, label) => <button type="button" role="tab" aria-selected={type === t} onClick={() => setType(t)} className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${type === t ? "bg-atlantic-500 text-abyss-950" : "text-white/60 hover:text-white"}`}>{label}</button>;
  return (
    <div className="transition-opacity duration-150 opacity-100">
      <div>
        <h1 className="sr-only">Discover</h1>
        <Hero />
        <div className="sticky top-[60px] z-30 border-b border-white/5 bg-pagebg/85 backdrop-blur-xl">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-6 py-3 sm:flex-nowrap sm:px-[60px]">
            <div className="flex shrink-0 gap-1 rounded-full bg-white/5 p-1" role="tablist" aria-label="Media type">{tab("movie", "Movies")}{tab("tv", "TV Shows")}</div>
            <div className="relative order-last min-w-0 basis-full sm:order-none sm:basis-auto sm:flex-1">
              <div className="no-scrollbar flex gap-2 overflow-x-auto py-1 [mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%-28px),transparent)]">
                {genres.map((g) => <button key={g.id} type="button" aria-pressed={genre === g.id} onClick={() => setGenre(genre === g.id ? null : g.id)} className={`${CHIP} ${genre === g.id ? "bg-atlantic-500 text-abyss-950" : "bg-white/5 text-white/70 hover:bg-white/10"}`}>{g.name}</button>)}
              </div>
            </div>
            <div className="relative ml-auto shrink-0 sm:ml-0">
              <button type="button" aria-expanded={filters} aria-haspopup="dialog" onClick={() => setFilters((v) => !v)} className={`flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors ${filters || sort !== "popularity.desc" ? "border-atlantic-400/50 bg-atlantic-500/15 text-white" : "border-white/10 bg-white/5 text-white/80 hover:bg-white/10"}`}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg><span className="hidden sm:inline">Filters</span>
              </button>
              {filters ? (
                <div role="dialog" className="absolute right-0 top-full z-40 mt-2 w-56 rounded-2xl border border-white/10 bg-pagebg/95 p-3 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.6)] backdrop-blur-md">
                  <p className="mb-2 text-xs font-medium text-white/50">Sort by</p>
                  {SORTS.map(([v, label]) => <button key={v} type="button" onClick={() => { setSort(v); setFilters(false); }} className={`block w-full rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-white/10 ${sort === v ? "text-atlantic-300" : "text-white/80"}`}>{label}</button>)}
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex flex-col pt-8">
          {genre || sort !== "popularity.desc" ? null : (
            <>
              {ROWS[type].map((r) => <Row key={r.title} title={r.title} items={rows[r.title] || []} all={r.all} />)}
              <GenreRow type={type} genres={genres} />
              <ProviderRowD type={type} />
            </>
          )}
        </div>
        <BrowseAll type={type} genre={genre} sort={sort} />
      </div>
    </div>
  );
}
