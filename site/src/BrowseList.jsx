import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { tmdb, GENRE, inCinemas } from "./tmdb.js";
import { LoadMoreGrid } from "./Browse.jsx";

/* atlantic.bz/browse: every row's "View All →" — the row's title and its list
   as a poster grid that loads more as you scroll (and with Load More). The
   address says which list; each one is the same TMDB query as the row it came
   from, so the grid starts with the row's own titles. (On atlantic.bz the Home page's genre and In Cinemas
   links answer "No results found."; here they show their titles.) */

function source(p) {
  const kind = p.get("type") || "";
  const media = p.get("mediaType") || "";
  const genre = p.get("genreId") || p.get("genre");
  const at = (path, extra = {}) => ({ type: media || undefined, pageOf: (n) => tmdb(path, { ...extra, page: String(n) }) });
  if (genre) return at(`/discover/${media || "movie"}`, { ...GENRE, with_genres: genre });
  switch (kind) {
    case "trending": return media === "tv" ? at("/trending/tv/day") : at("/trending/all/week");
    case "popular": return at(`/${media || "movie"}/popular`);
    case "topRated": return at(`/${media || "movie"}/top_rated`);
    case "upcoming": return { type: "movie", pageOf: (n) => tmdb("/movie/upcoming", { page: String(n) }) };
    case "nowPlaying": case "now_playing": return { type: "movie", pageOf: (n) => tmdb("/discover/movie", { ...inCinemas(), page: String(n) }) };
    case "airingToday": return { type: "tv", pageOf: (n) => tmdb("/tv/airing_today", { page: String(n) }) };
    case "onTheAir": return { type: "tv", pageOf: (n) => tmdb("/tv/on_the_air", { page: String(n) }) };
    case "discover": {
      const provider = p.get("withWatchProviders");
      return at(`/discover/${media || "movie"}`, { sort_by: "popularity.desc", ...(provider ? { with_watch_providers: provider, watch_region: "US", "vote_count.gte": "50" } : {}) });
    }
    default: return null;
  }
}

export default function BrowseList() {
  const [params] = useSearchParams();
  const title = params.get("title") || "Browse";
  const src = source(params);
  useEffect(() => { document.title = `${title} — Aurora`; }, [title]);
  return (
    <div className="transition-opacity duration-150 opacity-100">
      <div className="px-6 py-10 sm:px-[60px]">
        <h1 className="mb-8 text-3xl font-bold text-white">{title}</h1>
        {src ? <LoadMoreGrid auto type={src.type} pageOf={src.pageOf} resetKey={params.toString()} /> : <p className="mt-10 text-center text-white/40">No results found.</p>}
      </div>
    </div>
  );
}
