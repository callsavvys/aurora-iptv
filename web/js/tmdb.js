/* Everything TMDB knows about a title, for any source.

   A demo item is already a TMDB title. A provider's item is only a name like
   "AR| Dune Part Two (2024) 4K", so it is matched first: the provider's own
   TMDB id when it sends one (many panels do), otherwise a search on the
   cleaned title and year. A match has to actually resemble the title — a wrong
   logo and a stranger's cast are worse than none — and every answer, a miss
   included, is cached so each title is looked up once.

   enrich() returns one shape for the title page: logo, backdrop, tagline, age
   rating, scores (TMDB, and IMDb / Rotten Tomatoes / Metacritic via OMDb), the
   people, networks, status and next episode, trailer, collection,
   recommendations, keywords, studios, and where it streams. */
import { prefs, tmdbMatches, omdbBudget } from "./store.js";

const CFG = window.AURORA_CONFIG || {};
const API = "https://api.themoviedb.org/3";
export const img = (size, p) => (p ? `https://image.tmdb.org/t/p/${size}${p}` : "");

// ---------- requests: at most four at once, the rest wait their turn ----------
const queue = [];
let running = 0;
function pump() {
  while (running < 4 && queue.length) {
    const job = queue.shift(); running += 1;
    job().finally(() => { running -= 1; pump(); });
  }
}
const enqueue = (fn) => new Promise((resolve, reject) => { queue.push(() => fn().then(resolve, reject)); pump(); });

const cache = new Map();
const langCode = () => (prefs.lang === "ar" ? "ar-SA" : "en-US");
export function tmdb(path, q = "", { lang = true } = {}) {
  const url = `${API}${path}?api_key=${CFG.tmdb}${lang ? `&language=${langCode()}` : ""}${q}`;
  if (cache.has(url)) return cache.get(url);
  const p = enqueue(() => fetch(url).then((r) => { if (!r.ok) throw new Error(`TMDB ${r.status}`); return r.json(); }));
  cache.set(url, p);
  p.catch(() => cache.delete(url));
  return p;
}

// ---------- cleaning a provider's title (from the Mac app's searchTitle) ----------
// "AR| Dune" is a language tag; "Troy: The Odyssey" is a title. The shapes are
// the same, so the tag is stripped for one search and kept for another, and the
// resemblance check decides which reading was right.
const LEAD_TAG = /^\s*[\[|(]?\s*[A-Za-z]{2,4}\s*[\]|)]?\s*[|:\-–]\s*/u;
export function cleanTitle(name, { keepPrefix = false } = {}) {
  let s = String(name || "");
  if (!keepPrefix) for (let i = 0; i < 2; i++) s = s.replace(LEAD_TAG, "");   // "AR-OSN- " is two tags
  return s.replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/\b(4k|uhd|fhd|hd|sd|hevc|x26[45]|h\.?26[45]|multi|vf|vo|vostfr|dub(bed)?|sub(bed)?|imax|remux|blu-?ray|web-?dl|\d{3,4}p|s\d{1,2}(e\d{1,3})?)\b/gi, " ")
    .replace(/[_.]+/g, " ").replace(/\s{2,}/g, " ").trim()
    .replace(/\s+\b((?:19|20)\d{2})\b$/, (m, y) => (Number(y) <= new Date().getFullYear() + 2 ? "" : m)).trim();
}
/* The name to show on a card. Stricter than cleanTitle(): only an all-capitals
   tag comes off the front ("EN|", "AR-OSN-", "|AR|", "4K -"), so a title that
   genuinely starts "Troy: " keeps it, and the year and quality flags go,
   because the line under the poster already says the year. */
/* What real lines put in front of a name: "EN|", "AR-OSN-", "MULTI-SUB |",
   "D+ -", "4k |", "NF:". An all-capitals token (letters, digits, "+", one
   hyphenated part) or a quality flag, then a separator. "Troy: The Odyssey"
   and "MAD MAX: Fury Road" do not fit it and keep their names. */
const SHOUTED_TAG = /^\s*[\[|(]?\s*(?:[A-Z0-9+]{1,6}(?:-[A-Z0-9+]{2,6})?|4k|8k|uhd|fhd|hd|hevc)\s*[\]|)]?\s*[|:\-–]\s*/u;
const INVISIBLE = /[\u200B-\u200F\u2060\uFEFF]/g;
export function displayTitle(name) {
  let s = String(name || "").replace(INVISIBLE, "");
  for (let i = 0; i < 3 && SHOUTED_TAG.test(s); i++) s = s.replace(SHOUTED_TAG, "");
  s = s.replace(/\s*[(\[]\s*(?:19|20)\d{2}\s*[)\]]\s*$/, "")
    .replace(/\s+\b(4k|uhd|fhd|hd|sd|hevc|multi|vostfr)\b\s*$/gi, "")
    .replace(/(\w)_\s/g, "$1: ")          // "Fall 2_ Deadpoint": the colon a filename could not hold
    .replace(/\s{2,}/g, " ").trim();
  return s || String(name || "").replace(INVISIBLE, "").trim();
}

/* A provider's category name, without its decoration — the Mac app's
   tidyCategory: symbols and emoji off, "|" and "/" as a dot, and a leading
   language code dropped unless it is doing real work ("TV", "HBO", "4K"). */
// and superscripts too (\u2070-\u209F): a line writes "4K | ENGLISH ⁴↑"
const CATEGORY_FURNITURE = /[\u2000-\u209F\u2190-\u2BFF\uFE00-\uFE0F]|[\u{1F000}-\u{1FAFF}]/gu;
export function tidyCategory(name) {
  const raw = String(name || "").trim();
  let text = raw.replace(CATEGORY_FURNITURE, " ").replace(/\s*[|/]\s*/g, " \u00b7 ").replace(/\s{2,}/g, " ").trim();
  const KEEP = new Set(["TV", "HD", "4K", "ON", "MY", "NEW", "TOP", "OLD", "HBO"]);
  const words = text.split(" ");
  const lead = words[0] || "";
  const coded = /^[a-z]{2,3}$/i.test(lead) || /^[a-z]{2,3}[-:]$/i.test(lead);
  if (words.length > 1 && coded && !KEEP.has(lead.replace(/[-:]$/, "").toUpperCase())) text = words.slice(1).join(" ");
  text = text.replace(/^[-:\s]+/, "").replace(/^[\s\u00b7-]+/, "").replace(/[\s\u00b7-]+$/, "").trim();
  return text || raw;
}

export function yearOf(item) {
  if (item.year) return String(item.year);
  const limit = new Date().getFullYear() + 2;
  const ys = (String(item.title || "").match(/\b(?:19|20)\d{2}\b/g) || []).map(Number).filter((y) => y <= limit);
  return ys.length ? String(ys[ys.length - 1]) : "";
}
export const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// how alike two titles are, 0..1 (bigram overlap, so word order and small typos survive)
function alike(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grams = (s) => { const g = new Map(); const t = ` ${s} `; for (let i = 0; i < t.length - 1; i++) { const k = t.slice(i, i + 2); g.set(k, (g.get(k) || 0) + 1); } return g; };
  const A = grams(a), B = grams(b);
  let both = 0, total = 0;
  for (const [k, n] of A) { both += Math.min(n, B.get(k) || 0); total += n; }
  for (const n of B.values()) total += n;
  return (2 * both) / total;
}

const typeOf = (item) => (item.kind === "series" ? "tv" : "movie");

/* The TMDB title a provider item is. Returns { id, type } or null. */
export async function match(item) {
  if (!CFG.tmdb || item.kind === "live") return null;
  if (item.source === "demo" || !item.source) return { id: item.id, type: typeOf(item) };
  const type = typeOf(item);
  if (item.tmdb && Number(item.tmdb)) return { id: Number(item.tmdb), type };
  const key = `${item.source}:${item.kind}:${item.id}`;
  const known = tmdbMatches.get(key);
  if (known !== undefined) return known.id ? { id: known.id, type: known.type } : null;
  const year = yearOf(item);
  let best = null;
  for (const keepPrefix of [false, true]) {
    const q = cleanTitle(item.title, { keepPrefix });
    if (!q) continue;
    const yf = type === "tv" ? "first_air_date_year" : "year";
    let r = await tmdb(`/search/${type}`, `&include_adult=false&query=${encodeURIComponent(q)}${year ? `&${yf}=${year}` : ""}`, { lang: false }).catch(() => null);
    if (!r?.results?.length && year) r = await tmdb(`/search/${type}`, `&include_adult=false&query=${encodeURIComponent(q)}`, { lang: false }).catch(() => null);
    for (const x of (r?.results || []).slice(0, 8)) {
      const name = x.title || x.name, orig = x.original_title || x.original_name;
      let score = Math.max(alike(q, name), alike(q, orig));
      const y = String(x.release_date || x.first_air_date || "").slice(0, 4);
      if (year && y) score += y === year ? 0.15 : Math.abs(Number(y) - Number(year)) <= 1 ? 0.05 : -0.2;
      score += Math.min(0.05, (x.popularity || 0) / 2000);
      if (!best || score > best.score) best = { id: x.id, type, score };
    }
    if (best && best.score >= 0.9) break;
  }
  const ok = best && best.score >= 0.72;
  tmdbMatches.set(key, ok ? { id: best.id, type } : { id: 0 });
  return ok ? { id: best.id, type } : null;
}

// ---------- the whole title ----------
const APPEND = {
  movie: "credits,images,videos,recommendations,similar,keywords,release_dates,external_ids,watch/providers,translations",
  tv: "aggregate_credits,credits,images,videos,recommendations,similar,keywords,content_ratings,external_ids,watch/providers,translations",
};

export function fromList(x, forcedType) {
  const type = forcedType || (x.media_type === "tv" ? "tv" : "movie");
  return {
    id: x.id, kind: type === "tv" ? "series" : "movie", source: "demo", tmdbOnly: true,
    title: x.title || x.name || "", original: x.original_title || x.original_name || "", year: String(x.release_date || x.first_air_date || "").slice(0, 4),
    rating: x.vote_average ? x.vote_average.toFixed(1) : "", overview: x.overview || "",
    poster: img("w342", x.poster_path), backdrop: img("w1280", x.backdrop_path), still: img("w780", x.backdrop_path),
  };
}

function certification(d, type) {
  const order = [prefs.region, "US", "GB"];
  if (type === "movie") {
    const all = d.release_dates?.results || [];
    for (const c of order) {
      const r = all.find((x) => x.iso_3166_1 === c);
      const cert = r?.release_dates?.map((x) => x.certification).find(Boolean);
      if (cert) return { cert, country: c };
    }
  } else {
    const all = d.content_ratings?.results || [];
    for (const c of order) { const r = all.find((x) => x.iso_3166_1 === c && x.rating); if (r) return { cert: r.rating, country: c }; }
  }
  return null;
}

function englishFallback(d, field) {
  const en = d.translations?.translations?.find((t) => t.iso_639_1 === "en");
  return en?.data?.[field] || "";
}

export async function enrich(item) {
  const m = await match(item).catch(() => null);
  if (!m) return null;
  const d = await tmdb(`/${m.type}/${m.id}`, `&append_to_response=${APPEND[m.type]}&include_image_language=${prefs.lang},en,null`).catch(() => null);
  if (!d || d.success === false) return null;
  const logos = d.images?.logos || [];
  const logo = logos.find((l) => l.iso_639_1 === prefs.lang) || logos.find((l) => l.iso_639_1 === "en") || logos[0];
  const videos = (d.videos?.results || []).filter((v) => v.site === "YouTube");
  const trailer = videos.find((v) => v.type === "Trailer" && v.official) || videos.find((v) => v.type === "Trailer") || videos.find((v) => v.type === "Teaser");
  const castSrc = m.type === "tv" && d.aggregate_credits?.cast?.length ? d.aggregate_credits.cast : d.credits?.cast || [];
  const crew = d.credits?.crew || [];
  const providers = d["watch/providers"]?.results?.[prefs.region] || null;
  const runtime = d.runtime || d.episode_run_time?.[0];
  const overview = d.overview || englishFallback(d, "overview");
  const title = d.title || d.name || englishFallback(d, m.type === "tv" ? "name" : "title");
  return {
    tmdbId: m.id, type: m.type,
    title, originalTitle: d.original_title || d.original_name || "",
    tagline: d.tagline || "", overview,
    logo: img("w500", logo?.file_path), backdrop: img("w1280", d.backdrop_path), poster: img("w342", d.poster_path),
    rating: d.vote_average ? d.vote_average.toFixed(1) : "", votes: d.vote_count || 0,
    year: String(d.release_date || d.first_air_date || "").slice(0, 4),
    released: d.release_date || d.first_air_date || "",
    runtime: runtime ? (runtime >= 60 ? `${Math.floor(runtime / 60)}h ${runtime % 60}m` : `${runtime}m`) : "",
    genres: (d.genres || []).map((g) => g.name),
    certification: certification(d, m.type),
    status: d.status || "",
    nextEpisode: d.next_episode_to_air ? { date: d.next_episode_to_air.air_date, season: d.next_episode_to_air.season_number, number: d.next_episode_to_air.episode_number, name: d.next_episode_to_air.name } : null,
    seasonsCount: d.number_of_seasons || 0,
    networks: (d.networks || []).map((n) => ({ name: n.name, logo: img("w154", n.logo_path) })),
    studios: (d.production_companies || []).slice(0, 4).map((n) => ({ name: n.name, logo: img("w154", n.logo_path) })),
    languages: (d.spoken_languages || []).map((l) => l.english_name).slice(0, 3),
    directors: [...crew.filter((c) => c.job === "Director").map((c) => c.name), ...(d.created_by || []).map((c) => c.name)].slice(0, 3),
    writers: crew.filter((c) => c.department === "Writing").map((c) => c.name).slice(0, 3),
    cast: castSrc.slice(0, 20).map((c) => ({ id: c.id, name: c.name, character: c.character || c.roles?.[0]?.character || "", photo: img("w185", c.profile_path),
      episodes: c.total_episode_count || 0 })),
    trailer: trailer ? { key: trailer.key, name: trailer.name } : null,
    collection: d.belongs_to_collection ? { id: d.belongs_to_collection.id, name: d.belongs_to_collection.name } : null,
    recommendations: (d.recommendations?.results?.length ? d.recommendations.results : d.similar?.results || []).filter((x) => x.poster_path).slice(0, 20).map((x) => fromList(x, m.type)),
    keywords: (d.keywords?.keywords || d.keywords?.results || []).slice(0, 10).map((k) => k.name),
    providers: providers ? (providers.flatrate || providers.free || providers.ads || []).slice(0, 6).map((p) => ({ name: p.provider_name, logo: img("w92", p.logo_path) })) : [],
    imdbId: d.external_ids?.imdb_id || d.imdb_id || "",
  };
}

export async function seasonEpisodes(tvId, season) {
  const s = await tmdb(`/tv/${tvId}/season/${season}`).catch(() => null);
  return new Map((s?.episodes || []).map((e) => [e.episode_number, {
    title: e.name, overview: e.overview, still: img("w780", e.still_path), runtime: e.runtime ? `${e.runtime} min` : "", aired: e.air_date || "",
  }]));
}

export async function collection(id) {
  const c = await tmdb(`/collection/${id}`).catch(() => null);
  return (c?.parts || []).filter((x) => x.poster_path).sort((a, b) => String(a.release_date).localeCompare(String(b.release_date))).map((x) => fromList(x, "movie"));
}

export async function person(id) {
  const p = await tmdb(`/person/${id}`, "&append_to_response=combined_credits").catch(() => null);
  if (!p) return null;
  const seen = new Set();
  const known = [...(p.combined_credits?.cast || []), ...(p.combined_credits?.crew || [])]
    .filter((x) => x.poster_path && (x.media_type === "movie" || x.media_type === "tv") && !seen.has(x.media_type + x.id) && seen.add(x.media_type + x.id))
    .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
    .map((x) => ({ ...fromList(x, x.media_type), role: x.character || x.job || "" }));
  let bio = p.biography;
  if (!bio && prefs.lang !== "en") bio = (await tmdb(`/person/${id}`, "", { lang: false }).catch(() => null))?.biography || "";
  return { id: p.id, name: p.name, photo: img("h632", p.profile_path), bio: bio || "", born: p.birthday || "", place: p.place_of_birth || "", dept: p.known_for_department || "", known };
}

/* IMDb, Rotten Tomatoes and Metacritic, through OMDb. It allows 1,000 calls a
   day, so it is only asked about the title you are looking at, and a local
   tally keeps browsing from spending the quota. */
const omdbCache = new Map();
export async function scores(imdbId) {
  if (!imdbId || !CFG.omdb) return null;
  if (omdbCache.has(imdbId)) return omdbCache.get(imdbId);
  const budget = omdbBudget();
  if (budget.left <= 0) return null;
  budget.spend();
  const p = fetch(`https://www.omdbapi.com/?apikey=${CFG.omdb}&i=${imdbId}`).then((r) => r.json()).then((o) => {
    if (o.Response === "False") return null;
    const get = (src) => o.Ratings?.find((r) => r.Source === src)?.Value || "";
    return { imdb: o.imdbRating && o.imdbRating !== "N/A" ? o.imdbRating : "", rt: get("Rotten Tomatoes"), mc: get("Metacritic").replace("/100", "") };
  }).catch(() => null);
  omdbCache.set(imdbId, p);
  return p;
}
