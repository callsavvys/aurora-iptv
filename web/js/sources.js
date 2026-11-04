/* Where the content comes from. Two sources behind one shape, so every screen
   works the same against either:

   - demo: TMDB's real catalogue, with a public test stream standing in for
     the video, so the whole app can be driven before any account is added;
   - xtream: your own IPTV line, through the local proxy (server.cjs).

   An item is { id, kind: movie|series|live, title, year, rating, overview,
   poster, backdrop, still, badge, source, category }. */

import { tmdb, img, cleanTitle, norm, yearOf } from "./tmdb.js";
// Big Buck Bunny, Blender Foundation (CC BY 3.0) — a public test stream
const TEST_STREAM = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";

const cache = new Map();
async function getJson(url) {
  if (cache.has(url)) return cache.get(url);
  const p = fetch(url).then(async (r) => {
    if (!r.ok) throw new Error(`${r.status} from ${new URL(url, location.href).hostname}`);
    return r.json();
  });
  cache.set(url, p);
  p.catch(() => cache.delete(url));
  return p;
}

// ============================== demo (TMDB) ==============================

function badgeFor(x, kind) {
  if ((x.genre_ids || []).includes(16) && (x.origin_country || []).includes("JP")) return "anime";
  if (x.original_language === "ar") return "arabic";
  if (x.original_language === "tr") return "turkish";
  return kind;
}
function fromTmdb(x, forced) {
  const kind = forced || (x.media_type === "tv" ? "series" : "movie");
  return {
    id: x.id, kind, source: "demo",
    title: x.title || x.name || "",
    year: String(x.release_date || x.first_air_date || "").slice(0, 4),
    rating: x.vote_average ? x.vote_average.toFixed(1) : "",
    overview: x.overview || "",
    poster: img("w342", x.poster_path), backdrop: img("w1280", x.backdrop_path), still: img("w780", x.backdrop_path),
    badge: badgeFor(x, kind), genreIds: x.genre_ids || [],
  };
}
const list = (r, kind) => (r.results || []).filter((x) => x.poster_path && (x.media_type !== "person")).map((x) => fromTmdb(x, kind));

const demoChannels = ["Aurora One", "News 24", "Sport Arena", "Cinema Classics", "Kids Planet", "Music Live", "Nature HD", "Docu World",
  "Al Arabiya Test", "Comedy Central Test", "Anime Station", "Tech Today"].map((name, i) => ({
  id: 9000 + i, kind: "live", source: "demo", title: name, badge: "live",
  category: ["Entertainment", "News", "Sports", "Movies", "Kids", "Music", "Documentary", "Documentary", "Arabic", "Entertainment", "Kids", "News"][i],
  number: i + 1, now: ["Morning Show", "World Report", "Champions Live", "Casablanca (1942)", "Cartoon Hour", "Top 40", "Wild Planet", "Inside Machines", "النشرة", "Stand-up Night", "Episode 112", "Daily Brief"][i],
}));

const demo = {
  kind: "demo", name: "Demo catalogue",
  async home() {
    const [week, movies, shows, top, air, ar, anime, now] = await Promise.all([
      tmdb("/trending/all/week"), tmdb("/trending/movie/day"), tmdb("/trending/tv/day"), tmdb("/movie/top_rated"),
      tmdb("/tv/on_the_air"), tmdb("/discover/movie", "&with_original_language=ar&sort_by=popularity.desc"),
      tmdb("/discover/tv", "&with_genres=16&with_original_language=ja&sort_by=popularity.desc"), tmdb("/movie/now_playing"),
    ]);
    const hero = (week.results || []).filter((x) => x.backdrop_path && x.media_type !== "person").slice(0, 6).map((x) => fromTmdb(x));
    return {
      hero,
      sections: [
        { id: "top10", type: "top10", title: "Top 10 today", line: "The films everyone is watching right now.", items: list(movies, "movie").slice(0, 10) },
        { id: "trending", type: "posters", title: "Trending now", line: "High-velocity picks moving across the catalogue this week.", items: list(week) },
        { id: "new-episodes", type: "wide", title: "New episodes", line: "Series with something new this week.", items: list(air, "series"), flag: "New episode" },
        { id: "live", type: "live", title: "Live now", line: "Channels on the air.", items: demoChannels.slice(0, 8) },
        { id: "series", type: "posters", title: "Series worth starting", line: "Long-form stories to begin tonight.", items: list(shows, "series") },
        { id: "genres", type: "genres", title: "Browse by genre", line: "Every film and series, sorted the way you think.", items: GENRES },
        { id: "arabic", type: "posters", title: "Arabic cinema", line: "From Cairo, Beirut, Riyadh and beyond.", items: list(ar, "movie") },
        { id: "anime", type: "posters", title: "Anime", line: "Large worlds, high energy, every episode.", items: list(anime, "series") },
        { id: "cinemas", type: "posters", title: "New in cinemas", line: "Released in the last few weeks.", items: list(now, "movie") },
        { id: "classics", type: "posters", title: "All-time greats", line: "The highest rated films, still worth the evening.", items: list(top, "movie") },
      ],
    };
  },
  async categories(kind) {
    const r = await tmdb(`/genre/${kind === "series" ? "tv" : "movie"}/list`);
    return [{ id: "", name: "Popular" }, ...(r.genres || []).map((g) => ({ id: String(g.id), name: g.name }))];
  },
  async browse(kind, { category = "", page = 1 } = {}) {
    const t = kind === "series" ? "tv" : "movie";
    const r = await tmdb(`/discover/${t}`, `&sort_by=popularity.desc&page=${page}${category ? `&with_genres=${category}` : ""}&vote_count.gte=40`);
    return { items: list(r, kind), more: page < Math.min(r.total_pages || 1, 20) };
  },
  async liveCategories() {
    return [{ id: "", name: "All channels" }, ...[...new Set(demoChannels.map((c) => c.category))].map((c) => ({ id: c, name: c }))];
  },
  async channels(category) { return demoChannels.filter((c) => !category || c.category === category); },
  async search(q) {
    if (!q.trim()) return [];
    const r = await tmdb("/search/multi", `&query=${encodeURIComponent(q)}&include_adult=false`);
    return list(r).filter((x) => x.kind === "movie" || x.kind === "series" || ["anime", "arabic", "turkish"].includes(x.badge));
  },
  async detail(item) {
    const t = item.kind === "series" ? "tv" : "movie";
    const d = await tmdb(`/${t}/${item.id}`, "&append_to_response=credits,similar,recommendations,images&include_image_language=en,null");
    const logo = (d.images?.logos || []).find((l) => l.iso_639_1 === "en") || (d.images?.logos || [])[0];
    const more = list(d.recommendations?.results?.length ? d.recommendations : d.similar || {}, item.kind);
    const out = {
      ...item, ...fromTmdb({ ...d, genre_ids: (d.genres || []).map((g) => g.id) }, item.kind),
      logo: logo ? img("w500", logo.file_path) : "",
      genres: (d.genres || []).map((g) => g.name),
      runtime: d.runtime ? `${Math.floor(d.runtime / 60)}h ${d.runtime % 60}m` : "",
      cast: (d.credits?.cast || []).slice(0, 5).map((c) => c.name).join(", "),
      more,
    };
    if (item.kind === "series") {
      out.seasons = (d.seasons || []).filter((s) => s.season_number > 0 && s.episode_count > 0)
        .map((s) => ({ number: s.season_number, name: s.name, count: s.episode_count }));
      out.runtime = `${out.seasons.length} season${out.seasons.length === 1 ? "" : "s"}`;
    }
    return out;
  },
  async episodes(item, season) {
    const s = await tmdb(`/tv/${item.id}/season/${season}`);
    return (s.episodes || []).map((e) => ({
      id: `${item.id}-s${season}e${e.episode_number}`, season, number: e.episode_number, title: e.name || `Episode ${e.episode_number}`,
      overview: e.overview || "", still: img("w780", e.still_path) || item.still, runtime: e.runtime ? `${e.runtime} min` : "",
    }));
  },
  async logo(item) {
    const t = item.kind === "series" ? "tv" : "movie";
    const r = await tmdb(`/${t}/${item.id}/images`, "&include_image_language=en,null");
    const l = (r.logos || []).find((x) => x.iso_639_1 === "en") || (r.logos || [])[0];
    return l ? img("w500", l.file_path) : "";
  },
  stream() { return { url: TEST_STREAM, hls: true, proxied: false }; },
  async locate(x) { return { ...x, source: "demo", tmdbOnly: false }; },
};

export const GENRES = [
  { id: "28", name: "Action", hue: 8 }, { id: "35", name: "Comedy", hue: 45 }, { id: "18", name: "Drama", hue: 280 },
  { id: "27", name: "Horror", hue: 350 }, { id: "878", name: "Sci-Fi", hue: 200 }, { id: "10749", name: "Romance", hue: 330 },
  { id: "16", name: "Animation", hue: 25 }, { id: "99", name: "Documentary", hue: 150 }, { id: "53", name: "Thriller", hue: 230 },
  { id: "10751", name: "Family", hue: 100 },
];

// ============================== xtream ==============================
function xtream(cfg) {
  const server = cfg.server.replace(/\/+$/, "").replace(/^(?!https?:\/\/)/, "http://");
  const u = encodeURIComponent(cfg.username), p = encodeURIComponent(cfg.password);
  const through = (url) => `/api/proxy?u=${encodeURIComponent(url)}`;
  const api = (action = "", extra = "") => getJson(through(`${server}/player_api.php?username=${u}&password=${p}${action ? `&action=${action}` : ""}${extra}`));
  let lib = null;

  const rate = (v) => { const n = Number(v); return n ? (n > 10 ? n / 10 : n).toFixed(1) : ""; };
  const yearOf = (s) => String(s || "").match(/(19|20)\d\d/)?.[0] || "";
  const badgeOf = (category, kind) => /arab|عرب/i.test(category) ? "arabic" : /anime|انمي/i.test(category) ? "anime" : /turk|ترك/i.test(category) ? "turkish" : kind;

  let loading = null;
  const say = (text) => document.dispatchEvent(new CustomEvent("library:progress", { detail: text }));
  async function load() {
    if (lib) return lib;
    return (loading = loading || fetchAll().finally(() => { loading = null; }));
  }
  async function fetchAll() {
    // a big line is tens of megabytes of lists; say which part is arriving
    const step = async (label, p) => { say(label); return p; };
    const [lc, ls] = await step("Loading live channels…", Promise.all([api("get_live_categories"), api("get_live_streams")]));
    const [vc, vs] = await step(`Loading films… (${(ls || []).length.toLocaleString()} channels ready)`, Promise.all([api("get_vod_categories"), api("get_vod_streams")]));
    const [sc, ss] = await step(`Loading series… (${((ls || []).length + (vs || []).length).toLocaleString()} items ready)`, Promise.all([api("get_series_categories"), api("get_series")]));
    say(`Arranging ${((ls || []).length + (vs || []).length + (ss || []).length).toLocaleString()} items…`);
    const names = (cats) => new Map((cats || []).map((c) => [String(c.category_id), c.category_name]));
    const lm = names(lc), vm = names(vc), sm = names(sc);
    const live = (ls || []).map((x, i) => ({ id: x.stream_id, kind: "live", source: "xtream", title: x.name, poster: x.stream_icon || "", badge: "live",
      category: lm.get(String(x.category_id)) || "Other", categoryId: String(x.category_id), number: x.num || i + 1, now: "" }));
    const movies = (vs || []).map((x) => {
      const category = vm.get(String(x.category_id)) || "Other";
      return { id: x.stream_id, kind: "movie", source: "xtream", title: x.name, year: yearOf(x.year || x.releaseDate || x.name), rating: rate(x.rating),
        poster: x.stream_icon || "", backdrop: "", still: "", overview: "", category, categoryId: String(x.category_id), ext: x.container_extension || "mp4",
        added: Number(x.added) || 0, badge: badgeOf(category, "movie"), tmdb: Number(x.tmdb || x.tmdb_id) || 0 };
    });
    const series = (ss || []).map((x) => {
      const category = sm.get(String(x.category_id)) || "Other";
      const bd = Array.isArray(x.backdrop_path) ? x.backdrop_path[0] || "" : "";
      return { id: x.series_id, kind: "series", source: "xtream", title: x.name, year: yearOf(x.releaseDate || x.name), rating: rate(x.rating),
        poster: x.cover || "", backdrop: bd, still: bd, overview: x.plot || "", category, categoryId: String(x.category_id),
        added: Number(x.last_modified) || 0, badge: badgeOf(category, "series"), tmdb: Number(x.tmdb || x.tmdb_id) || 0 };
    });
    const count = (items) => { const m = new Map(); for (const x of items) m.set(x.categoryId, (m.get(x.categoryId) || 0) + 1); return m; };
    lib = { live, movies, series, lc: lc || [], vc: vc || [], sc: sc || [], vcount: count(movies), scount: count(series), lcount: count(live) };
    return lib;
  }
  const recent = (items) => items.slice().sort((a, b) => b.added - a.added);
  const withArt = (items) => items.filter((x) => x.poster);

  return {
    kind: "xtream", name: cfg.name || "My IPTV",
    async connect() {
      const a = await api();
      if (Number(a?.user_info?.auth) !== 1) throw new Error("The provider did not accept this login");
      if (a.user_info.status && a.user_info.status !== "Active") throw new Error(`The account is ${a.user_info.status.toLowerCase()}`);
      return a.user_info;
    },
    async home() {
      const L = await load();
      const films = withArt(recent(L.movies)), shows = withArt(recent(L.series));
      const heroPool = [...shows.filter((x) => x.backdrop).slice(0, 4), ...films.slice(0, 4)].slice(0, 6);
      const bigCats = (cats, counts, items, kind, n) => cats.map((c) => ({ c, n: counts.get(String(c.category_id)) || 0 }))
        .sort((a, b) => b.n - a.n).slice(0, n)
        .map(({ c }) => ({ id: `${kind}-${c.category_id}`, type: "posters", title: c.category_name, line: `${kind === "series" ? "Series" : "Films"} from this category on your line.`,
          items: withArt(recent(items.filter((x) => x.categoryId === String(c.category_id)))).slice(0, 30), browse: { kind, category: String(c.category_id) } }));
      const best = withArt(L.movies.filter((x) => Number(x.rating) >= 7)).sort((a, b) => b.added - a.added).slice(0, 10);
      return {
        hero: heroPool,
        sections: [
          { id: "top10", type: "top10", title: "Top 10 on your line", line: "Highly rated and newly added.", items: best.length >= 5 ? best : films.slice(0, 10) },
          { id: "new-films", type: "posters", title: "Recently added films", line: "The newest films on your line.", items: films.slice(0, 30), browse: { kind: "movie" } },
          { id: "new-series", type: "posters", title: "Recently updated series", line: "Series with new episodes.", items: shows.slice(0, 30), browse: { kind: "series" } },
          { id: "live", type: "live", title: "Live now", line: "Channels on your line.", items: L.live.slice(0, 16) },
          ...bigCats(L.vc, L.vcount, L.movies, "movie", 4),
          ...bigCats(L.sc, L.scount, L.series, "series", 3),
        ],
      };
    },
    async categories(kind) {
      const L = await load();
      const cats = kind === "series" ? L.sc : L.vc, counts = kind === "series" ? L.scount : L.vcount;
      return [{ id: "", name: "Recently added" }, ...cats.filter((c) => counts.get(String(c.category_id))).map((c) => ({ id: String(c.category_id), name: c.category_name }))];
    },
    async browse(kind, { category = "", page = 1 } = {}) {
      const L = await load();
      const all = recent((kind === "series" ? L.series : L.movies).filter((x) => !category || x.categoryId === category));
      const per = 60;
      return { items: all.slice((page - 1) * per, page * per), more: page * per < all.length };
    },
    async liveCategories() {
      const L = await load();
      return [{ id: "", name: "All channels" }, ...L.lc.filter((c) => L.lcount.get(String(c.category_id))).map((c) => ({ id: String(c.category_id), name: c.category_name }))];
    },
    async channels(category) { const L = await load(); return L.live.filter((c) => !category || c.categoryId === category).slice(0, 400); },
    async search(q) {
      const L = await load();
      const n = q.trim().toLowerCase();
      if (!n) return [];
      const hits = [];
      for (const x of [...L.series, ...L.movies]) {
        const t = x.title.toLowerCase(), at = t.indexOf(n);
        if (at !== -1) hits.push({ x, score: (at === 0 ? 0 : 1) + t.length / 200 });
        if (hits.length > 600) break;
      }
      return hits.sort((a, b) => a.score - b.score).slice(0, 60).map((h) => h.x);
    },
    async detail(item) {
      if (item.kind === "movie") {
        const r = await api("get_vod_info", `&vod_id=${item.id}`);
        const i = r.info || {};
        const bd = Array.isArray(i.backdrop_path) ? i.backdrop_path[0] : i.backdrop_path;
        const L = await load();
        return { ...item, overview: i.plot || i.description || item.overview, backdrop: bd || item.backdrop || "", still: bd || "",
          runtime: i.duration || "", genres: String(i.genre || "").split(/[,/]/).map((s) => s.trim()).filter(Boolean).slice(0, 3),
          cast: i.cast || i.actors || "", rating: rate(i.rating) || item.rating, year: yearOf(i.releasedate || i.release_date) || item.year,
          ext: r.movie_data?.container_extension || item.ext, tmdb: Number(i.tmdb_id || i.tmdb) || item.tmdb || 0, more: withArt(L.movies.filter((x) => x.categoryId === item.categoryId && x.id !== item.id)).slice(0, 20) };
      }
      const r = await api("get_series_info", `&series_id=${item.id}`);
      const i = r.info || {};
      const bd = Array.isArray(i.backdrop_path) ? i.backdrop_path[0] : i.backdrop_path;
      const eps = r.episodes || {};
      const seasons = Object.keys(eps).map(Number).filter((n) => n > 0).sort((a, b) => a - b)
        .map((n) => ({ number: n, name: `Season ${n}`, count: eps[n].length }));
      const L = await load();
      return { ...item, overview: i.plot || item.overview, backdrop: bd || item.backdrop, still: bd || item.still, cast: i.cast || "",
        genres: String(i.genre || "").split(/[,/]/).map((s) => s.trim()).filter(Boolean).slice(0, 3), rating: rate(i.rating) || item.rating,
        runtime: `${seasons.length} season${seasons.length === 1 ? "" : "s"}`, seasons, rawEpisodes: eps, tmdb: Number(i.tmdb || i.tmdb_id) || item.tmdb || 0,
        more: withArt(L.series.filter((x) => x.categoryId === item.categoryId && x.id !== item.id)).slice(0, 20) };
    },
    async episodes(item, season) {
      const eps = item.rawEpisodes?.[season] || [];
      return eps.map((e) => ({ id: e.id, season, number: Number(e.episode_num) || 0, title: e.title || `Episode ${e.episode_num}`,
        overview: e.info?.plot || "", still: e.info?.movie_image || item.still, runtime: e.info?.duration ? String(e.info.duration).replace(/^00:/, "") : "",
        ext: e.container_extension || "mp4" }));
    },
    async logo() { return ""; },
    /* A title TMDB knows — a recommendation, a film an actor was in — found on
       this line, by its cleaned name and year. Null when the line does not
       have it, so the screen can say so instead of offering Play. */
    async locate(x) {
      const L = await load();
      if (!L.index) {
        L.index = new Map();
        for (const it of [...L.movies, ...L.series]) {
          const k = `${it.kind}|${norm(cleanTitle(it.title))}`;
          if (!L.index.has(k)) L.index.set(k, []);
          L.index.get(k).push(it);
        }
      }
      const hits = L.index.get(`${x.kind}|${norm(x.title)}`) || [];
      if (!hits.length) return null;
      const y = Number(x.year);
      return hits.find((h) => !y || !yearOf(h) || Math.abs(Number(yearOf(h)) - y) <= 1) || null;
    },
    stream(item, episode) {
      if (item.kind === "live") return { url: `${server}/live/${u}/${p}/${item.id}.m3u8`, hls: true, proxied: true, live: true };
      if (episode) return { url: `${server}/series/${u}/${p}/${episode.id}.${episode.ext || "mp4"}`, hls: false };
      return { url: `${server}/movie/${u}/${p}/${item.id}.${item.ext || "mp4"}`, hls: false };
    },
  };
}

export function makeSource(cfg) {
  return cfg?.kind === "xtream" && cfg.server ? xtream(cfg) : demo;
}
export const testXtream = (cfg) => xtream(cfg).connect();
