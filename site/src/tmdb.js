/* TMDB, the way atlantic.bz uses it: its home page is built from TMDB's lists
   (Top 10 today, trending, popular, in cinemas, genres, a provider's catalogue),
   and every card can carry the title's own logo. Answers are cached for the
   session, so moving around the site does not ask twice. */
const KEY = __TMDB_KEY__;
const API = "https://api.themoviedb.org/3";
export const IMG = (size, path) => (path ? `https://image.tmdb.org/t/p/${size}${path}` : "");

const cache = new Map();
export function tmdb(path, params = {}) {
  const q = new URLSearchParams({ api_key: KEY, language: "en-US", ...params });
  const url = `${API}${path}?${q}`;
  if (!cache.has(url)) cache.set(url, fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`TMDB ${r.status}`)))).catch((e) => { cache.delete(url); throw e; }));
  return cache.get(url);
}

const GENRES = {};
async function genreNames() {
  if (GENRES.ready) return GENRES;
  const [m, t] = await Promise.all([tmdb("/genre/movie/list"), tmdb("/genre/tv/list")]);
  for (const g of [...m.genres, ...t.genres]) GENRES[g.id] = g.name.replace("Science Fiction", "Science Fiction").replace("Action & Adventure", "Action & Adventure");
  GENRES.ready = true;
  return GENRES;
}

/* one shape for films and series */
export function item(x, type) {
  const kind = x.media_type || type || (x.first_air_date !== undefined ? "tv" : "movie");
  return {
    id: x.id, type: kind === "tv" ? "tv" : "movie",
    title: x.title || x.name || "",
    year: (x.release_date || x.first_air_date || "").slice(0, 4),
    rating: x.vote_average ? Number(x.vote_average).toFixed(1) : "",
    overview: x.overview || "",
    poster: x.poster_path, backdrop: x.backdrop_path,
    genreIds: x.genre_ids || (x.genres || []).map((g) => g.id),
  };
}
export const list = (r, type) => (r.results || []).filter((x) => x.media_type !== "person").map((x) => item(x, type));

export async function genresOf(it) {
  const g = await genreNames();
  return it.genreIds.map((id) => g[id]).filter(Boolean);
}

/* the title's logo (a transparent PNG of its name) and age rating */
export function extras(it) {
  const path = `/${it.type}/${it.id}`;
  return tmdb(path, { append_to_response: it.type === "tv" ? "images,content_ratings" : "images,release_dates", include_image_language: "en,null" }).then((d) => {
    // as the site does: an English PNG logo first (SVG ones draw differently), then any logo
    const logos = d.images?.logos || [];
    const png = (l) => !/\.svg$/i.test(l.file_path);
    const logo = logos.find((l) => l.iso_639_1 === "en" && png(l)) || logos.find(png) || logos[0];
    let cert = "";
    if (it.type === "tv") cert = (d.content_ratings?.results || []).find((r) => r.iso_3166_1 === "US")?.rating || "";
    else cert = ((d.release_dates?.results || []).find((r) => r.iso_3166_1 === "US")?.release_dates || []).map((r) => r.certification).find(Boolean) || "";
    return { logo: logo ? IMG("w500", logo.file_path) : "", cert, genres: (d.genres || []).map((g) => g.name), detail: d };
  });
}

/* How the site builds each row, found by matching its order exactly against
   TMDB queries: Popular uses TMDB's own popular lists; the genre rows take the
   most popular with at least 200 votes; In Cinemas is what opened in cinemas
   (theatrical or limited) in the last 21 days, most popular first. */
export const GENRE = { sort_by: "popularity.desc", "vote_count.gte": "200" };
export function inCinemas() {
  // in local time, as the site does: toISOString would roll over to tomorrow in the evening
  const day = (d) => { const t = new Date(); t.setDate(t.getDate() + d); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };
  return { sort_by: "popularity.desc", with_release_type: "2|3", "release_date.gte": day(-21), "release_date.lte": day(0) };
}

export async function homeRows() {
  const [tvDay, movieDay, week, popTv, popMovie, cinemas, anim, action, comedy, horror, scifi] = await Promise.all([
    tmdb("/trending/tv/day"), tmdb("/trending/movie/day"), tmdb("/trending/all/week"),
    tmdb("/tv/popular"), tmdb("/movie/popular"), tmdb("/discover/movie", inCinemas()),
    tmdb("/discover/movie", { ...GENRE, with_genres: "16" }),
    tmdb("/discover/movie", { ...GENRE, with_genres: "28" }),
    tmdb("/discover/movie", { ...GENRE, with_genres: "35" }),
    tmdb("/discover/movie", { ...GENRE, with_genres: "27" }),
    tmdb("/discover/movie", { ...GENRE, with_genres: "878" }),
  ]);
  const weekItems = list(week);
  return {
    hero: weekItems.filter((x) => x.backdrop).slice(0, 6),
    rows: [
      { id: "top-tv", kind: "top10", title: "Top 10 TV Shows Today", items: list(tvDay, "tv").slice(0, 10) },
      { id: "top-movie", kind: "top10", title: "Top 10 Movies Today", items: list(movieDay, "movie").slice(0, 10) },
      { id: "trending", kind: "wide", title: "What's Trending", items: weekItems, all: "/browse?type=trending&title=What%27s+Trending" },
      { id: "pop-tv", kind: "wide", title: "Popular Shows", items: list(popTv, "tv"), all: "/browse?type=popular&mediaType=tv&title=Popular+Shows" },
      { id: "pop-movie", kind: "wide", title: "Popular Movies", items: list(popMovie, "movie"), all: "/browse?type=popular&mediaType=movie&title=Popular+Movies" },
      { id: "provider", kind: "provider", title: "Popular on" },
      { id: "cinemas", kind: "wide", title: "In Cinemas", items: list(cinemas, "movie"), all: "/browse?type=now_playing&mediaType=movie&title=In+Cinemas" },
      { id: "animation", kind: "wide", title: "Animation", items: list(anim, "movie"), all: "/browse?genre=16&mediaType=movie&title=Animation" },
      { id: "action", kind: "wide", title: "Action", items: list(action, "movie"), all: "/browse?genre=28&mediaType=movie&title=Action" },
      { id: "comedy", kind: "wide", title: "Comedy", items: list(comedy, "movie"), all: "/browse?genre=35&mediaType=movie&title=Comedy" },
      { id: "horror", kind: "wide", title: "Horror", items: list(horror, "movie"), all: "/browse?genre=27&mediaType=movie&title=Horror" },
      { id: "scifi", kind: "wide", title: "Sci-Fi", items: list(scifi, "movie"), all: "/browse?genre=878&mediaType=movie&title=Sci-Fi" },
    ],
  };
}

/* "Popular on <service>": a streaming service's catalogue, films or shows */
export const PROVIDERS = [
  { id: 8, name: "Netflix" }, { id: 337, name: "Disney+" }, { id: 9, name: "Prime Video" },
  { id: 1899, name: "Max" }, { id: 350, name: "Apple TV+" }, { id: 15, name: "Hulu" }, { id: 531, name: "Paramount+" },
];
/* each service's own small logo, for the picker */
export async function providerLogos() {
  const r = await tmdb("/watch/providers/movie", { watch_region: "US" });
  return Object.fromEntries((r.results || []).map((p) => [p.provider_id, IMG("w92", p.logo_path)]));
}
export async function providerRow(providerId, type) {
  // the site's rule, matched title for title: US availability, at least 50 votes
  const r = await tmdb(`/discover/${type}`, { with_watch_providers: String(providerId), watch_region: "US", sort_by: "popularity.desc", "vote_count.gte": "50" });
  return list(r, type);
}
