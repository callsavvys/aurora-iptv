/* global Hls */
const $ = (selector) => document.querySelector(selector);

/* ---------- appearance ---------- */

const THEMES = ["system", "light", "dark"];
const themeChoice = () => { const stored = localStorage.getItem("aurora-theme"); return THEMES.includes(stored) ? stored : "system" };
const resolvedTheme = () => { const choice = themeChoice(); return choice === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : choice };

function applyTheme(choice) {
  const value = THEMES.includes(choice) ? choice : "system";
  localStorage.setItem("aurora-theme", value);
  if (value === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", value);
  document.querySelectorAll(".theme-switch button").forEach((button) => button.classList.toggle("active", button.dataset.themeChoice === value));
  window.aurora?.setTheme(resolvedTheme());
}

applyTheme(themeChoice());
matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => { if (themeChoice() === "system") applyTheme("system") });
const LIBRARY_SCHEMA = 2;
const state = {
  provider: null, items: [], view: "home", query: "", category: "All", limit: 120,
  favorites: new Set(JSON.parse(localStorage.getItem("aurora-favorites") || "[]")),
  progress: new Map(Object.entries(JSON.parse(localStorage.getItem("aurora-progress") || "{}"))),
  playerItem: null, playing: null, hls: null, queue: null, appVersion: "", confirmRemove: null, trending: null,
  seriesItem: null, seriesData: null, selectedSeason: null, detailItem: null, detailData: null, detailMeta: null,
};
const views = { home: "Home", live: "Live TV", movies: "Movies", series: "Series", favorites: "Favorites", history: "History", settings: "Settings" };

/* ---------- sources ----------
   Aurora used to hold exactly one account in aurora-provider. Sources are a
   list now, each with its own cached library, and the old single account is
   migrated into the list on first run rather than dropped. */

const readSources = () => { try { return JSON.parse(localStorage.getItem("aurora-sources") || "[]") } catch { return [] } };
const writeSources = (list) => localStorage.setItem("aurora-sources", JSON.stringify(list));
const activeSourceId = () => localStorage.getItem("aurora-active-source") || readSources()[0]?.id || "";
const activeSource = () => readSources().find((entry) => entry.id === activeSourceId()) || null;
const newSourceId = () => `src-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const libraryKey = (id) => `items:${id}`;

async function migrateSources() {
  // an empty list must not count as "already migrated" — a fresh install writes
  // one, and that would lock out a legacy account arriving afterwards
  if (readSources().length) return;
  let legacy = null;
  try { legacy = JSON.parse(localStorage.getItem("aurora-provider") || "null") } catch { legacy = null }
  if (!legacy?.server) return;
  const id = newSourceId();
  const existing = (await idbGet("library", "items").catch(() => null)) || [];
  if (existing.length) await idbPut("library", libraryKey(id), existing).catch(() => {});
  writeSources([{ id, name: legacy.name || "My IPTV", server: legacy.server, username: legacy.username, password: legacy.password, count: existing.length }]);
  localStorage.setItem("aurora-active-source", id);
}

function upsertSource(source) {
  const list = readSources();
  const index = list.findIndex((entry) => entry.id === source.id);
  if (index === -1) list.push(source); else list[index] = { ...list[index], ...source };
  writeSources(list);
}

async function useSource(id) {
  const source = readSources().find((entry) => entry.id === id);
  if (!source) return;
  localStorage.setItem("aurora-active-source", id);
  state.provider = source;
  state.items = await loadLibrary(id);
  libraryIndex = null; state.trending = null;
  state.view = state.items.length ? "home" : "settings";
  state.category = "All"; state.limit = 120; state.query = "";
  render();
  if (!state.items.length) showToast(`${source.name} has no cached library yet — refresh it to load`);
}

async function removeSource(id) {
  const list = readSources().filter((entry) => entry.id !== id);
  writeSources(list);
  await idbPut("library", libraryKey(id), []).catch(() => {});
  if (activeSourceId() === id) {
    localStorage.removeItem("aurora-active-source");
    const next = list[0];
    if (next) return useSource(next.id);
    state.provider = null; state.items = []; libraryIndex = null; state.trending = null;
  }
  render();
}

const cleanServer = (value) => { const clean = value.trim().replace(/\/$/, ""); return /^https?:\/\//i.test(clean) ? clean : `http://${clean}` };
const relay = (url) => `/proxy?src=${encodeURIComponent(url)}`;
const escapeHtml = (value = "") => String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
const rating = (value) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n.toFixed(1) : "" };
const clock = (value) => {
  const total = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60), seconds = total % 60;
  return hours ? `${hours}h ${String(minutes).padStart(2, "0")}m` : `${minutes}:${String(seconds).padStart(2, "0")}`;
};
const credentials = () => ({ server: state.provider.server, user: encodeURIComponent(state.provider.username), pass: encodeURIComponent(state.provider.password) });
const apiUrl = (action = "", extra = "") => { const { server, user, pass } = credentials(); return `${server}/player_api.php?username=${user}&password=${pass}${action ? `&action=${action}` : ""}${extra}` };

let connection;

function openDb() {
  connection = connection || new Promise((resolve, reject) => {
    const request = indexedDB.open("aurora-mac", 2);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("library")) database.createObjectStore("library");
      if (!database.objectStoreNames.contains("meta")) database.createObjectStore("meta");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return connection;
}

async function idbGet(store, key) {
  const database = await openDb();
  return new Promise((resolve, reject) => {
    const request = database.transaction(store, "readonly").objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbPut(store, key, value) {
  const database = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(store, "readwrite");
    transaction.objectStore(store).put(value, key);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

async function saveLibrary(items, id = activeSourceId()) {
  await idbPut("library", libraryKey(id), items);
  upsertSource({ id, count: items.length });
  localStorage.setItem("aurora-library-schema", String(LIBRARY_SCHEMA));
}

const loadLibrary = async (id = activeSourceId()) => (id ? (await idbGet("library", libraryKey(id))) || [] : []);

function showToast(message) {
  const toast = $("#toast"); toast.textContent = message; toast.classList.add("show");
  clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove("show"), 4500);
}

function setLoading(show, title = "Connecting", detail = "Checking your account…") {
  $("#loading").classList.toggle("hidden", !show); $("#loading-title").textContent = title; $("#loading-detail").textContent = detail;
}

async function fetchJson(url) {
  const response = await fetch(relay(url));
  const text = await response.text();
  if (!response.ok) { try { throw new Error(JSON.parse(text).error || `Provider returned ${response.status}`) } catch (error) { if (error instanceof SyntaxError) throw new Error(`Provider returned ${response.status}`); throw error } }
  if (text.trim() === "FORCED_COUNTRY") throw new Error("This account is locked to another country");
  try { return JSON.parse(text) } catch { throw new Error(text.trim() || "The provider returned an invalid response") }
}

function categoryMap(categories) {
  const map = new Map(); for (const item of categories || []) map.set(String(item.category_id), item.category_name); return map;
}

/* ---------- artwork and ratings ----------
   Providers give covers for series and rarely a backdrop for films, so most of
   the library arrives with nothing to look at. TMDB fills the gap; OMDb adds
   the IMDb and Rotten Tomatoes numbers. Keys live on this Mac, never in the
   build, and every answer is cached so a title is only ever looked up once. */

const TMDB = "https://api.themoviedb.org/3";
const artUrl = (path, size) => (path ? `https://image.tmdb.org/t/p/${size}${path}` : "");
const apiKeys = () => { try { return JSON.parse(localStorage.getItem("aurora-keys") || "{}") } catch { return {} } };
const hasTmdb = () => Boolean(apiKeys().tmdb);

// provider titles carry language tags, quality flags and the year
function searchTitle(name) {
  return String(name || "")
    .replace(/^\s*[\[|(]?\s*[A-Za-z]{2,4}\s*[\]|)]?\s*[|:\-–]\s*/u, "")
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/\b(4k|uhd|fhd|hd|sd|hevc|x26[45]|h\.?26[45]|multi|vf|vo|vostfr|dub(bed)?|sub(bed)?|imax|remux|blu-?ray|web-?dl|\d{3,4}p)\b/gi, " ")
    .replace(/[_.]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/\s+\b((?:19|20)\d{2})\b$/, (match, year) => (Number(year) <= new Date().getFullYear() + 2 ? "" : match))
    .trim();
}

// providers often bury the year in the title when the year field is empty
function releaseYear(item) {
  if (item.year) return String(item.year);
  const limit = new Date().getFullYear() + 2;
  const years = (String(item.name || "").match(/\b(?:19|20)\d{2}\b/g) || []).map(Number).filter((y) => y <= limit);
  return years.length ? String(years[years.length - 1]) : "";
}

const queue = [];
const slowQueue = [];
let running = 0;

function enqueue(task, { slow = false } = {}) {
  return new Promise((resolve) => {
    (slow ? slowQueue : queue).push(async () => { resolve(await task().catch(() => null)) });
    pump();
  });
}

function pump() {
  while (running < 4 && (queue.length || (slowQueue.length && running < 2))) {
    const task = queue.length ? queue.shift() : slowQueue.shift();
    running += 1;
    task().finally(() => { running -= 1; pump() });
  }
}

const metaCache = new Map();

// OMDb allows 1,000 calls a day. Spend them on what is actually on screen and
// keep a local tally so browsing can never exhaust the quota in one sitting.
const OMDB_DAILY = 700;

function omdbBudget() {
  const today = new Date().toISOString().slice(0, 10);
  let usage = { date: today, used: 0 };
  try { const stored = JSON.parse(localStorage.getItem("aurora-omdb-usage") || "null"); if (stored?.date === today) usage = stored } catch { /* start fresh */ }
  return {
    left: OMDB_DAILY - usage.used,
    spend: () => localStorage.setItem("aurora-omdb-usage", JSON.stringify({ date: today, used: usage.used + 1 })),
  };
}

async function cachedMeta(id) {
  if (metaCache.has(id)) return metaCache.get(id);
  const stored = await idbGet("meta", id).catch(() => null);
  if (stored) metaCache.set(id, stored);
  return stored || null;
}

async function storeMeta(id, value) {
  metaCache.set(id, value);
  await idbPut("meta", id, value).catch(() => {});
  return value;
}

async function tmdbSearch(item) {
  const key = apiKeys().tmdb;
  const query = searchTitle(item.name);
  if (!key || !query) return { miss: true, at: Date.now() };
  const kind = item.type === "series" ? "tv" : "movie";
  const yearField = kind === "tv" ? "first_air_date_year" : "year";
  const base = `${TMDB}/search/${kind}?api_key=${key}&include_adult=false&query=${encodeURIComponent(query)}`;
  const year = releaseYear(item);
  let results = (await fetchJson(year ? `${base}&${yearField}=${encodeURIComponent(year)}` : base))?.results;
  if (!results?.length && year) results = (await fetchJson(base))?.results;
  const hit = results?.[0];
  if (!hit) return { miss: true, at: Date.now() };
  return {
    kind,
    tmdbId: hit.id,
    title: hit.title || hit.name || "",
    poster: hit.poster_path || "",
    backdrop: hit.backdrop_path || "",
    overview: hit.overview || "",
    score: hit.vote_average ? Number(hit.vote_average).toFixed(1) : "",
    year: String(hit.release_date || hit.first_air_date || "").slice(0, 4),
    at: Date.now(),
  };
}

// only look a title up when the provider gave us nothing, so the API is not
// hammered for a hundred thousand items that already have covers
async function metaFor(item, { force = false } = {}) {
  if (!hasTmdb()) return null;
  const cached = await cachedMeta(item.id);
  if (cached && (!force || cached.tmdbId)) return cached;
  return enqueue(async () => storeMeta(item.id, await tmdbSearch(item)));
}

async function fullMeta(item) {
  const key = apiKeys().tmdb;
  const base = await metaFor(item, { force: true });
  if (!key || !base?.tmdbId || base.details) return base;
  const data = await fetchJson(`${TMDB}/${base.kind}/${base.tmdbId}?api_key=${key}&append_to_response=credits,videos,external_ids`).catch(() => null);
  if (!data) return base;
  const trailer = (data.videos?.results || []).find((v) => v.site === "YouTube" && /trailer/i.test(v.type || ""));
  const details = {
    genres: (data.genres || []).map((g) => g.name).join(", "),
    runtime: data.runtime ? `${Math.floor(data.runtime / 60)}h ${String(data.runtime % 60).padStart(2, "0")}m` : "",
    cast: (data.credits?.cast || []).slice(0, 6).map((c) => c.name).join(", "),
    director: (data.credits?.crew || []).filter((c) => c.job === "Director").map((c) => c.name).join(", "),
    trailer: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : "",
    imdbId: data.external_ids?.imdb_id || data.imdb_id || "",
    tagline: data.tagline || "",
  };
  const merged = { ...base, overview: data.overview || base.overview, backdrop: data.backdrop_path || base.backdrop, poster: data.poster_path || base.poster, details };
  if (merged.details.imdbId && apiKeys().omdb) merged.ratings = await omdbRatings(merged.details.imdbId);
  return storeMeta(item.id, merged);
}

async function omdbRatings(imdbId) {
  const key = apiKeys().omdb;
  if (!key || !imdbId) return null;
  const data = await fetchJson(`https://www.omdbapi.com/?apikey=${key}&i=${encodeURIComponent(imdbId)}`).catch(() => null);
  if (!data || data.Response === "False") return null;
  const find = (source) => (data.Ratings || []).find((r) => r.Source === source)?.Value || "";
  return { imdb: find("Internet Movie Database").split("/")[0], rt: find("Rotten Tomatoes"), metacritic: find("Metacritic").split("/")[0], imdbId };
}

// Text marks rather than the IMDb and Rotten Tomatoes logos: both are
// trademarks that need written permission, and RT has no non-commercial
// exemption at all. The numbers are the useful part; the marks name the source.
function ratingSet(item, meta) {
  const cached = meta || metaCache.get(item.id);
  const set = [];
  if (cached?.ratings?.imdb) set.push({ mark: "IMDb", value: cached.ratings.imdb, tone: "imdb" });
  if (cached?.ratings?.rt) set.push({ mark: "RT", value: cached.ratings.rt, tone: Number.parseInt(cached.ratings.rt, 10) >= 60 ? "fresh" : "rotten" });
  if (cached?.ratings?.metacritic) set.push({ mark: "MC", value: cached.ratings.metacritic, tone: "critic" });
  if (!set.length && cached?.score) set.push({ mark: "TMDB", value: cached.score, tone: "imdb" });
  if (!set.length && item.rating) set.push({ mark: "", value: item.rating, tone: "imdb" });
  return set;
}

function scoreMarkup(item, meta) {
  const [primary, ...rest] = ratingSet(item, meta);
  if (!primary) return "";
  const cell = (entry) => `<b>${escapeHtml(entry.value)}</b>${entry.mark ? `<em>${escapeHtml(entry.mark)}</em>` : ""}`;
  return `<span class="tone-${primary.tone}">${cell(primary)}</span>${rest.length ? `<span class="score-more">${rest.map((entry) => `<i class="tone-${entry.tone}">${cell(entry)}</i>`).join("")}</span>` : ""}`;
}

// the ratings that need a second and third call, fetched only for what is
// rendered and only while the OMDb budget lasts
async function deepEnrich(item) {
  if (!hasTmdb() || !apiKeys().omdb) return null;
  const cached = await cachedMeta(item.id);
  if (!cached?.tmdbId || cached.ratings || cached.ratingsMiss) return cached;
  if (omdbBudget().left <= 0) return cached;
  return enqueue(async () => {
    const budget = omdbBudget();
    if (budget.left <= 0) return cached;
    budget.spend();
    const full = await fullMeta(item).catch(() => null);
    if (full && !full.ratings) return storeMeta(item.id, { ...full, ratingsMiss: true });
    return full;
  }, { slow: true });
}

function paintScore(item, meta) {
  const markup = scoreMarkup(item, meta);
  const holder = document.querySelector(`.score[data-score-for="${CSS.escape(item.id)}"]`);
  if (!holder || !markup) return;
  holder.innerHTML = markup;
  holder.hidden = false;
}

/* Fills artwork in place, without re-rendering. This deliberately does not use
   IntersectionObserver: it delivers nothing while the window is occluded or in
   the background, so artwork would silently never arrive. Only what is already
   rendered gets queued, and the queue caps concurrency. */
async function hydrateArt(node) {
  const item = state.items.find((entry) => entry.id === node.dataset.artFor);
  if (!item || node.querySelector("img")) return;
  const meta = await metaFor(item);
  if (!meta || !node.isConnected) return;
  // the provider's title carries language tags and quality flags; once TMDB has
  // matched it, show the name the film actually has
  if (meta.title) {
    const card = node.closest(".card");
    const heading = card?.querySelector(".card-copy h3");
    if (heading && heading.textContent !== meta.title) { heading.textContent = meta.title; heading.title = item.name }
    const subtitle = card?.querySelector(".card-copy p");
    if (subtitle && meta.year) subtitle.textContent = [meta.year, item.category].filter(Boolean).join(" • ");
  }
  paintScore(item, meta);
  deepEnrich(item).then((full) => { if (full?.ratings) paintScore(item, full) });
  if (!meta.poster) return;
  const image = new Image();
  image.src = artUrl(meta.poster, "w342");
  image.decoding = "async";
  image.addEventListener("load", () => {
    if (!node.isConnected || node.querySelector("img")) return;
    node.insertBefore(image, node.firstChild);
    node.classList.add("has-art");
  });
}

function watchArtwork() {
  if (!hasTmdb()) return;
  for (const node of document.querySelectorAll(".art[data-art-for]")) {
    if (node.dataset.artQueued || node.querySelector("img")) continue;
    node.dataset.artQueued = "1";
    hydrateArt(node);
  }
}

/* ---------- library index ----------
   Built once when the library changes. Ranking and trending both need to look
   items up by title and by type, and doing that across 101,102 items on every
   render is what made the old home page expensive. */

let libraryIndex = null;

const indexKey = (name) => searchTitle(name).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function buildIndex() {
  const byTitle = new Map(), byType = { live: [], movie: [], series: [] };
  for (const item of state.items) {
    (byType[item.type] ||= []).push(item);
    const key = indexKey(item.name);
    if (!key) continue;
    const bucket = byTitle.get(key);
    if (bucket) bucket.push(item); else byTitle.set(key, [item]);
  }
  libraryIndex = { byTitle, byType };
  return libraryIndex;
}

const index = () => libraryIndex || buildIndex();
const ofType = (type) => index().byType[type] || [];

/* ---------- trending ----------
   TMDB publishes a global weekly list. On its own that is a list of films you
   may not have, so it is matched against the library and only what is actually
   playable is shown. Cached per ISO week. */

function weekStamp() {
  const now = new Date();
  const target = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  target.setUTCDate(target.getUTCDate() + 4 - (target.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target - yearStart) / 86400000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

async function trendingList(kind) {
  const key = apiKeys().tmdb;
  if (!key) return [];
  const cacheKey = `trending:${kind}:${weekStamp()}`;
  const cached = await idbGet("meta", cacheKey).catch(() => null);
  if (cached) return cached;
  const pages = await Promise.all([1, 2].map((page) =>
    fetchJson(`${TMDB}/trending/${kind}/week?api_key=${key}&page=${page}`).catch(() => null)));
  const results = pages.flatMap((page) => page?.results || []);
  if (results.length) await idbPut("meta", cacheKey, results).catch(() => {});
  return results;
}

// a trending entry already carries poster, backdrop and score, so a match is
// also a free metadata record for that item
function matchTrending(results, type) {
  const matched = [], seen = new Set();
  for (const entry of results) {
    const key = indexKey(entry.title || entry.name || "");
    if (!key) continue;
    const item = (index().byTitle.get(key) || []).find((candidate) => candidate.type === type && !seen.has(candidate.id));
    if (!item) continue;
    seen.add(item.id);
    matched.push(item);
    if (!metaCache.has(item.id)) {
      storeMeta(item.id, {
        kind: type === "series" ? "tv" : "movie",
        tmdbId: entry.id,
        title: entry.title || entry.name || "",
        poster: entry.poster_path || "",
        backdrop: entry.backdrop_path || "",
        overview: entry.overview || "",
        score: entry.vote_average ? Number(entry.vote_average).toFixed(1) : "",
        year: String(entry.release_date || entry.first_air_date || "").slice(0, 4),
        at: Date.now(),
      }).catch(() => {});
    }
    if (matched.length >= 20) break;
  }
  return matched;
}

async function loadTrending() {
  if (!hasTmdb() || !state.items.length) return;
  const [movies, series] = await Promise.all([trendingList("movie"), trendingList("tv")]);
  state.trending = { movie: matchTrending(movies, "movie"), series: matchTrending(series, "series"), of: movies.length + series.length };
  if (state.view === "home" && !state.query) render();
}

/* ---------- watch progress ---------- */

function persistProgress() {
  const entries = [...state.progress.entries()].sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, 400);
  state.progress = new Map(entries);
  localStorage.setItem("aurora-progress", JSON.stringify(Object.fromEntries(entries)));
}

function saveProgress(patch) {
  if (!patch?.key) return;
  const merged = { ...(state.progress.get(patch.key) || {}), ...patch, updatedAt: Date.now() };
  state.progress.set(patch.key, merged); persistProgress();
}

const progressOf = (key) => state.progress.get(key) || null;
const finished = (record) => Boolean(record && record.duration > 0 && record.position >= record.duration * 0.95);
const percent = (record) => (record && record.duration > 0 ? Math.min(100, (record.position / record.duration) * 100) : 0);
const continueWatching = () => [...state.progress.values()].filter((r) => r.type !== "live" && r.position > 20 && !finished(r)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20);
const watchHistory = () => [...state.progress.values()].sort((a, b) => b.updatedAt - a.updatedAt);

/* ---------- library ---------- */

async function loadEverything() {
  setLoading(true, "Loading live TV", "Downloading channels and categories…");
  const [liveCategories, live] = await Promise.all([fetchJson(apiUrl("get_live_categories")), fetchJson(apiUrl("get_live_streams"))]);
  const liveMap = categoryMap(liveCategories);
  const items = live.map((x) => ({ id: `live-${x.stream_id}`, type: "live", streamId: Number(x.stream_id), name: x.name, category: liveMap.get(String(x.category_id)) || "Uncategorized", logo: x.stream_icon || "", ext: "m3u8", added: Number(x.added) || 0 }));

  setLoading(true, "Loading movies", `${items.length.toLocaleString()} live channels ready…`);
  const [movieCategories, movies] = await Promise.all([fetchJson(apiUrl("get_vod_categories")), fetchJson(apiUrl("get_vod_streams"))]);
  const movieMap = categoryMap(movieCategories);
  for (const x of movies) items.push({ id: `movie-${x.stream_id}`, type: "movie", streamId: Number(x.stream_id), name: x.name, category: movieMap.get(String(x.category_id)) || "Uncategorized", logo: x.stream_icon || "", ext: x.container_extension || "mp4", rating: rating(x.rating), year: x.year || String(x.releaseDate || "").slice(0, 4), duration: x.duration || "", added: Number(x.added) || 0 });

  setLoading(true, "Loading series", `${items.length.toLocaleString()} channels and movies ready…`);
  const [seriesCategories, series] = await Promise.all([fetchJson(apiUrl("get_series_categories")), fetchJson(apiUrl("get_series"))]);
  const seriesMap = categoryMap(seriesCategories);
  for (const x of series) items.push({ id: `series-${x.series_id}`, type: "series", streamId: Number(x.series_id), name: x.name, category: seriesMap.get(String(x.category_id)) || "Uncategorized", logo: x.cover || "", backdrop: Array.isArray(x.backdrop_path) ? x.backdrop_path[0] || "" : "", rating: rating(x.rating), year: String(x.releaseDate || "").slice(0, 4), description: x.plot || "", added: Number(x.last_modified) || 0 });
  return items;
}

async function connectProvider(event) {
  event.preventDefault(); $("#form-error").classList.add("hidden");
  const provider = { id: newSourceId(), name: $("#provider-name").value.trim() || "My IPTV", server: cleanServer($("#server").value), username: $("#username").value.trim(), password: $("#password").value };
  const previous = state.provider;
  try {
    setLoading(true, "Connecting", "Checking the Xtream account from your Mac…");
    state.provider = provider;
    const auth = await fetchJson(apiUrl());
    if (Number(auth?.user_info?.auth) !== 1 || auth?.user_info?.status !== "Active") throw new Error("The provider rejected this login or the account is inactive");
    const items = await loadEverything();
    setLoading(true, "Saving your library", `${items.length.toLocaleString()} total items loaded…`);
    upsertSource(provider);
    localStorage.setItem("aurora-active-source", provider.id);
    await saveLibrary(items, provider.id);
    libraryIndex = null; state.trending = null;
    state.items = items; state.view = "home"; state.category = "All"; state.limit = 120;
    closeModal("source-modal"); render();
    $("#source-form").reset();
    showToast(`${items.length.toLocaleString()} items loaded successfully`);
  } catch (error) {
    state.provider = previous;
    const box = $("#form-error"); box.textContent = error.message || "Could not connect"; box.classList.remove("hidden");
    $("#source-modal").classList.remove("hidden");
  } finally { setLoading(false) }
}

async function refreshLibrary(quiet = false, id = activeSourceId()) {
  if (refreshLibrary.busy) return;
  const source = readSources().find((entry) => entry.id === id) || state.provider;
  if (!source) return;
  refreshLibrary.busy = true;
  const previous = state.provider;
  state.provider = source;
  try {
    if (!quiet) setLoading(true, "Refreshing library", `Asking ${source.name} for the latest content…`);
    const items = await loadEverything();
    await saveLibrary(items, source.id);
    libraryIndex = null; state.trending = null;
    if (activeSourceId() === source.id) { state.items = items } else { state.provider = previous }
    render();
    showToast(`Library refreshed • ${items.length.toLocaleString()} items`);
  } catch (error) { state.provider = previous; showToast(error.message || "Could not refresh the library") }
  finally { refreshLibrary.busy = false; setLoading(false) }
}

function updateSource() {
  const others = readSources().length - 1;
  $("#source-name").textContent = state.provider?.name || "No source";
  $("#source-status").textContent = state.provider
    ? `${state.items.length.toLocaleString()} items${others > 0 ? ` · ${others} more` : ""}`
    : "Not connected";
  const count = state.favorites.size, badge = $("#favorite-count");
  badge.textContent = count; badge.style.display = count ? "grid" : "none";
}

function itemsForView(ignoreCategory = false) {
  let result = state.items;
  if (state.view === "live") result = result.filter((item) => item.type === "live");
  if (state.view === "movies") result = result.filter((item) => item.type === "movie");
  if (state.view === "series") result = result.filter((item) => item.type === "series");
  if (state.view === "favorites") result = result.filter((item) => state.favorites.has(item.id));
  if (!ignoreCategory && state.category !== "All") result = result.filter((item) => item.category === state.category);
  if (state.query) { const query = state.query.toLowerCase(); result = result.filter((item) => `${item.name} ${item.category}`.toLowerCase().includes(query)) }
  return result;
}

/* ---------- cards and shelves ---------- */

const icon = (name, extra = "") => `<svg class="icon ${extra}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

// artwork is missing for a lot of provider items; initials read as a deliberate
// placeholder where a repeated glyph reads as a broken image
const initials = (name) => {
  const words = String(name || "").replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
};

function card(item, wide = false, rank = 0) {
  const art = item.logo || item.backdrop;
  const bar = item.type === "movie" ? percent(progressOf(item.id)) : 0;
  const opens = item.type === "live" ? "play-item" : "open-detail";
  return `<article class="card ${wide ? "wide" : ""} ${rank ? "ranked" : ""}" data-id="${escapeHtml(item.id)}">${rank ? `<span class="rank">${rank}</span>` : ""}<div class="art ${opens}"${art ? "" : ` data-art-for="${escapeHtml(item.id)}"`}>${art ? `<img loading="lazy" src="${escapeHtml(art)}" onerror="this.style.display='none'">` : ""}<div class="fallback">${escapeHtml(initials(item.name))}</div>${item.type === "live" ? '<span class="live">Live</span>' : ""}${(() => { const markup = scoreMarkup(item); return `<span class="score" data-score-for="${escapeHtml(item.id)}"${markup ? "" : " hidden"}>${markup}</span>` })()}<span class="play-bubble">${icon("play")}</span>${bar > 1 ? `<span class="resume-bar"><i style="width:${bar.toFixed(1)}%"></i></span>` : ""}</div><div class="card-copy"><div><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml([item.year, item.category].filter(Boolean).join(" • ") || item.type)}</p></div><button class="heart ${state.favorites.has(item.id) ? "saved" : ""}" title="My list">${icon(state.favorites.has(item.id) ? "heart-fill" : "heart")}</button></div></article>`;
}

function resumeCard(record) {
  const bar = percent(record), left = record.duration > record.position ? `${clock(record.duration - record.position)} left` : "Ready";
  return `<article class="card wide" data-resume="${escapeHtml(record.key)}"><div class="art play-resume">${record.poster ? `<img loading="lazy" src="${escapeHtml(record.poster)}" onerror="this.style.display='none'">` : ""}<div class="fallback">${escapeHtml(initials(record.title))}</div><span class="play-bubble">${icon("play")}</span><span class="resume-bar"><i style="width:${bar.toFixed(1)}%"></i></span></div><div class="card-copy"><div><h3>${escapeHtml(record.title)}</h3><p>${escapeHtml([record.subtitle, left].filter(Boolean).join(" • "))}</p></div><button class="forget" title="Remove from Continue watching">${icon("close")}</button></div></article>`;
}

function rail(scroller) {
  return `<div class="rail"><button class="rail-nav prev" aria-label="Scroll left" disabled>${icon("chev-left")}</button>${scroller}<button class="rail-nav next" aria-label="Scroll right" disabled>${icon("chev-right")}</button></div>`;
}

function updateRails() {
  for (const box of document.querySelectorAll(".rail")) {
    const scroller = box.querySelector(".rail-scroller");
    if (!scroller) continue;
    const max = scroller.scrollWidth - scroller.clientWidth;
    box.classList.toggle("scrollable", max > 1);
    box.querySelector(".rail-nav.prev").disabled = scroller.scrollLeft <= 1;
    box.querySelector(".rail-nav.next").disabled = scroller.scrollLeft >= max - 1;
  }
}

function rankedShelf(title, items, subtitle) {
  if (!items?.length) return "";
  return `<section class="shelf"><div class="shelf-head"><div><span>${escapeHtml(subtitle)}</span><h2>${escapeHtml(title)}</h2></div></div>${rail(`<div class="shelf-row rail-scroller ranked-row">${items.map((item, position) => card(item, false, position + 1)).join("")}</div>`)}</section>`;
}

function shelf(title, items, wide = false, subtitle = "") {
  if (!items.length) return "";
  return `<section class="shelf"><div class="shelf-head"><div>${subtitle ? `<span>${escapeHtml(subtitle)}</span>` : ""}<h2>${escapeHtml(title)}</h2></div></div>${rail(`<div class="shelf-row rail-scroller ${wide ? "wide" : ""}">${items.slice(0, 20).map((item) => card(item, wide)).join("")}</div>`)}</section>`;
}

function resumeShelf() {
  const records = continueWatching();
  if (!records.length) return "";
  return `<section class="shelf"><div class="shelf-head"><div><span>Pick up where you left off</span><h2>Continue watching</h2></div></div>${rail(`<div class="shelf-row rail-scroller wide">${records.slice(0, 20).map(resumeCard).join("")}</div>`)}</section>`;
}

function recentlyAdded(type, title) {
  const cache = (index().cache ||= {});
  const key = `new:${type}`;
  if (!cache[key]) cache[key] = ofType(type).filter((item) => item.added).sort((a, b) => b.added - a.added).slice(0, 24);
  return shelf(title, cache[key], false, "New for you");
}

function ratedItems(type, limit = 24) {
  const cache = (index().cache ||= {});
  const key = `rated:${type}`;
  if (!cache[key]) {
    cache[key] = ofType(type)
      .filter((item) => Number(item.rating) > 0)
      .sort((a, b) => Number(b.rating) - Number(a.rating))
      .slice(0, limit);
  }
  return cache[key];
}

function watchedCategories() {
  const counts = new Map();
  for (const record of [...state.progress.values()].slice(0, 60)) {
    const item = state.items.find((entry) => entry.id === record.id);
    if (!item?.category) continue;
    counts.set(item.category, (counts.get(item.category) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

function becauseYouWatched() {
  const recent = [...state.progress.values()].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (!recent) return "";
  const seed = state.items.find((entry) => entry.id === recent.id);
  if (!seed?.category) return "";
  const watched = new Set([...state.progress.values()].map((record) => record.id));
  const picks = [...ofType(seed.type), ...(seed.type === "movie" ? ofType("series") : [])]
    .filter((item) => item.category === seed.category && !watched.has(item.id))
    .sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0))
    .slice(0, 20);
  return shelf(`More ${seed.category}`, picks, false, `Because you watched ${metaCache.get(seed.id)?.title || seed.name}`);
}

function unfinishedSeries() {
  const ids = new Set();
  for (const record of [...state.progress.values()].sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (record.type === "episode" && !finished(record)) ids.add(record.id);
  }
  const picks = [...ids].map((id) => state.items.find((entry) => entry.id === id)).filter(Boolean).slice(0, 20);
  return shelf("Carry on with", picks, false, "Series you started");
}

function heroPick() {
  const cache = (index().cache ||= {});
  if (cache.hero !== undefined) return cache.hero;
  const candidates = [...ratedItems("movie", 60), ...ratedItems("series", 60)]
    .filter((item) => !finished(progressOf(item.id)));
  const withArt = candidates.find((item) => metaCache.get(item.id)?.backdrop || item.backdrop);
  cache.hero = withArt || candidates[0] || state.items.find((item) => item.type === "movie") || state.items[0] || null;
  return cache.hero;
}

function renderHome() {
  const featured = heroPick();
  if (!featured) return renderWelcome();
  const meta = metaCache.get(featured.id);
  const image = artUrl(meta?.backdrop, "w1280") || featured.backdrop || featured.logo;
  const score = meta?.ratings?.imdb || meta?.score || featured.rating;
  const missing = state.trending && !state.trending.movie.length && !state.trending.series.length && state.trending.of > 0;
  $("#content").innerHTML = `<section class="hero">${image ? `<img src="${escapeHtml(image)}">` : ""}<div class="hero-copy"><span class="eyebrow">${escapeHtml(featured.type === "series" ? "Series worth starting" : "Worth your evening")}</span><h1>${escapeHtml(meta?.title || featured.name)}</h1><div class="meta">${score ? `<span>${icon("star")}${escapeHtml(score)}</span>` : ""}${featured.year || meta?.year ? `<span>${escapeHtml(featured.year || meta.year)}</span>` : ""}${featured.category ? `<span>${escapeHtml(featured.category)}</span>` : ""}</div><p>${escapeHtml(meta?.overview || featured.description || "Ready to watch from your connected source.")}</p><div class="actions"><button class="primary play-featured" data-id="${escapeHtml(featured.id)}">${featured.type === "series" ? "View episodes" : `${icon("play")}Play`}</button><button class="secondary" id="play-something">${icon("shuffle")}Play something</button><button class="secondary favorite-featured" data-id="${escapeHtml(featured.id)}">${state.favorites.has(featured.id) ? `${icon("heart-fill")}Saved` : `${icon("heart")}My list`}</button></div></div></section>${resumeShelf()}${rankedShelf("Top 20 movies this week", state.trending?.movie, "Most watched worldwide, that you have")}${rankedShelf("Top 20 series this week", state.trending?.series, "Most watched worldwide, that you have")}${missing ? '<p class="row-note">None of this week\u2019s trending titles matched your library by name.</p>' : ""}${unfinishedSeries()}${becauseYouWatched()}${shelf("Live now", ofType("live"), true, "Your channels")}${recentlyAdded("movie", "Recently added movies")}${recentlyAdded("series", "Recently added series")}${shelf("Highest rated films", ratedItems("movie"), false, "By rating")}${shelf("Highest rated series", ratedItems("series"), false, "By rating")}`;
  hydrateHero(featured);
}

function renderWelcome() {
  $("#content").innerHTML = `<section class="welcome"><div class="welcome-card"><div class="welcome-mark">${icon("play")}</div><h1>Your TV. Your Mac.</h1><p>Connect your Xtream account to browse live channels, movies and series directly through your own internet connection.</p><button class="primary open-source">＋ Connect source</button></div></section>`;
}

function renderHistory() {
  const records = watchHistory();
  const rows = records.map((record) => {
    const bar = percent(record);
    const when = new Date(record.updatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    const status = record.type === "live" ? "Live channel" : finished(record) ? "Finished" : `${clock(record.position)} watched`;
    return `<article class="history-row" data-resume="${escapeHtml(record.key)}"><div class="history-art">${record.poster ? `<img loading="lazy" src="${escapeHtml(record.poster)}" onerror="this.style.display='none'">` : ""}<div class="fallback">${escapeHtml(initials(record.title))}</div></div><div class="history-copy"><strong>${escapeHtml(record.title)}</strong><small>${escapeHtml([record.subtitle, status, when].filter(Boolean).join(" • "))}</small>${bar > 1 ? `<span class="history-bar"><i style="width:${bar.toFixed(1)}%"></i></span>` : ""}</div><button class="forget" title="Remove from history">${icon("close")}</button></article>`;
  }).join("");
  $("#content").innerHTML = `<section class="page"><div class="page-title"><div><span class="eyebrow">${escapeHtml(state.provider?.name || "Local library")}</span><h1>History</h1></div><span>${records.length.toLocaleString()} entries</span></div>${records.length ? `<div class="history-list">${rows}</div><div class="load-more"><button class="secondary" id="clear-history">Clear watch history</button></div>` : '<div class="empty"><div><h2>Nothing watched yet</h2><p>Everything you play shows up here.</p></div></div>'}</section>`;
}

function renderSettings() {
  const list = readSources(), active = activeSourceId(), keys = apiKeys(), choice = themeChoice();
  const rows = list.map((source) => {
    const current = source.id === active;
    const confirming = state.confirmRemove === source.id;
    return `<div class="source-row ${current ? "current" : ""}">
      <span class="source-icon">${icon("source")}</span>
      <div class="source-meta">
        <input class="rename" value="${escapeHtml(source.name)}" data-rename="${escapeHtml(source.id)}" aria-label="Source name" spellcheck="false" />
        <small>${escapeHtml(String(source.server || "").replace(/^https?:\/\//, ""))} · ${escapeHtml(source.username || "")} · ${(source.count || 0).toLocaleString()} items</small>
      </div>
      <div class="row-actions">
        ${current ? '<span class="tag">In use</span>' : `<button class="secondary small" data-use="${escapeHtml(source.id)}">Use</button>`}
        <button class="icon-btn" data-refresh="${escapeHtml(source.id)}" title="Reload this library">${icon("refresh")}</button>
        ${confirming
          ? `<button class="secondary small danger" data-remove-confirm="${escapeHtml(source.id)}">Remove for good</button>`
          : `<button class="icon-btn danger" data-remove="${escapeHtml(source.id)}" title="Remove source">${icon("close")}</button>`}
      </div>
    </div>`;
  }).join("");

  $("#content").innerHTML = `<section class="page settings">
    <div class="page-title"><div><span class="eyebrow">Aurora</span><h1>Settings</h1></div></div>

    <section class="panel">
      <header><h2>Sources</h2><p>Xtream accounts. The one in use supplies the library you browse; the others keep their own cached copy.</p></header>
      ${rows || '<p class="panel-empty">No source yet. Add one to load a library.</p>'}
      <div class="panel-foot">
        <button class="primary small open-source">${icon("plus")}Add a source</button>
        <small>M3U playlists are not supported yet — Xtream accounts only.</small>
      </div>
    </section>

    <section class="panel">
      <header><h2>Appearance</h2><p>Auto follows macOS.</p></header>
      <div class="theme-switch wide">
        ${["system", "light", "dark"].map((value) => `<button data-theme-choice="${value}" class="${choice === value ? "active" : ""}">${value === "system" ? "Auto" : value[0].toUpperCase() + value.slice(1)}</button>`).join("")}
      </div>
    </section>

    <section class="panel">
      <header><h2>Artwork and ratings</h2><p>Posters, backdrops, cast and trailers come from TMDB. IMDb and Rotten Tomatoes scores need an OMDb key as well. Both are free, and both stay on this Mac.</p></header>
      <form id="keys-form" class="keys">
        <label>TMDB API key<input id="tmdb-key" value="${escapeHtml(keys.tmdb || "")}" spellcheck="false" autocomplete="off" placeholder="Required for artwork" /></label>
        <label>OMDb API key<input id="omdb-key" value="${escapeHtml(keys.omdb || "")}" spellcheck="false" autocomplete="off" placeholder="Optional — IMDb and Rotten Tomatoes" /></label>
        <button class="primary small" type="submit">Save keys</button>
      </form>
    </section>

    <section class="panel">
      <header><h2>About</h2></header>
      <div class="about">
        <span class="version">Aurora <b id="app-version">${escapeHtml(state.appVersion || "")}</b></span>
        ${window.aurora ? `<button class="secondary small" id="check-updates"><i id="update-check-icon">${icon("refresh")}</i><span id="update-check-label">Check for updates</span></button>` : ""}
        <a class="secondary small" href="https://github.com/callsavvys/aurora-iptv" target="_blank" rel="noreferrer">Source on GitHub</a>
      </div>
    </section>
  </section>`;
}

function renderCollection() {
  const base = itemsForView(true), categories = ["All", ...new Set(base.map((item) => item.category).filter(Boolean))], items = itemsForView();
  $("#content").innerHTML = `<section class="page"><div class="page-title"><div><span class="eyebrow">${escapeHtml(state.provider?.name || "Local library")}</span><h1>${state.query ? "Search results" : views[state.view]}</h1></div><span>${items.length.toLocaleString()} items</span></div><div class="rail chips-rail"><button class="rail-nav prev" aria-label="Scroll left" disabled>${icon("chev-left")}</button><div class="chips rail-scroller">${categories.slice(0, 80).map((name) => `<button class="chip ${state.category === name ? "active" : ""}" data-category="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join("")}</div><button class="rail-nav next" aria-label="Scroll right" disabled>${icon("chev-right")}</button></div>${items.length ? `<div class="grid">${items.slice(0, state.limit).map((item) => card(item, item.type === "live")).join("")}</div>${items.length > state.limit ? `<div class="load-more"><button class="secondary" id="load-more">Show 120 more • ${(items.length - state.limit).toLocaleString()} remaining</button></div>` : ""}` : '<div class="empty"><div><h2>Nothing found</h2><p>Try another category or search.</p></div></div>'}</section>`;
  updateRails();
  watchArtwork();
}

function render() {
  if (state.view === "settings") renderSettings();
  else if (!state.provider || !state.items.length) renderWelcome();
  else if (state.view === "history") renderHistory();
  else if (state.view === "home" && !state.query) renderHome();
  else renderCollection();
  document.querySelectorAll("nav button").forEach((button) => button.classList.toggle("active", button.dataset.view === state.view));
  updateRails();
  watchArtwork();
  updateSource();
  document.documentElement.classList.toggle("artwork-on", hasTmdb());
  if (state.view === "home" && !state.trending && hasTmdb() && state.items.length) { state.trending = { movie: [], series: [], of: 0 }; loadTrending() }
  if (render.lastView !== state.view) {
    const content = $("#content");
    content.classList.remove("enter");
    void content.offsetWidth;
    content.classList.add("enter");
    render.lastView = state.view;
  }
}

function playSomething() {
  if (!state.items.length) return showToast("Add a source first");
  const unfinished = continueWatching();
  if (unfinished.length && Math.random() < 0.35) {
    const record = unfinished[Math.floor(Math.random() * Math.min(5, unfinished.length))];
    showToast(`Picking up ${record.title}`);
    return resumeRecord(record.key);
  }
  const watched = new Set([...state.progress.values()].map((record) => record.id));
  const genres = watchedCategories().slice(0, 3);
  const rated = ofType("movie").filter((item) => Number(item.rating) >= 6.5 && !watched.has(item.id));
  const inGenre = genres.length ? rated.filter((item) => genres.includes(item.category)) : [];
  const pool = inGenre.length >= 12 ? inGenre : (rated.length ? rated : ofType("movie"));
  if (!pool.length) return showToast("Nothing to play in this library yet");
  const pick = pool[Math.floor(Math.random() * pool.length)];
  showToast(`${metaCache.get(pick.id)?.title || pick.name}${inGenre.length >= 12 ? ` — ${pick.category}` : ""}`);
  play(pick);
}

function toggleFavorite(item) {
  if (!item) return;
  if (state.favorites.has(item.id)) state.favorites.delete(item.id); else state.favorites.add(item.id);
  localStorage.setItem("aurora-favorites", JSON.stringify([...state.favorites]));
  if (!$("#series-modal").classList.contains("hidden")) renderDetail(); else render();
  updatePlayerFavorite();
  updateSource();
}

/* ---------- detail sheet ---------- */

function seriesSeasons() {
  return Object.entries(state.seriesData?.episodes || {})
    .filter(([, episodes]) => Array.isArray(episodes) && episodes.length)
    .sort(([a], [b]) => String(a).localeCompare(String(b), undefined, { numeric: true }));
}

const episodeTitle = (episode, index) => episode.title || episode.info?.name || `Episode ${episode.episode_num || episode.info?.episode_num || index + 1}`;
const episodeNumber = (episode, index) => episode.episode_num || episode.info?.episode_num || index + 1;

function detailHero({ backdrop, poster, eyebrow, name, meta, description, actions }) {
  return `<section class="series-hero">${backdrop ? `<img class="series-backdrop" src="${escapeHtml(backdrop)}" onerror="this.style.display='none'">` : ""}${poster ? `<img class="series-poster" src="${escapeHtml(poster)}" onerror="this.style.visibility='hidden'">` : '<div class="series-poster"></div>'}<div class="series-info"><span class="eyebrow">${escapeHtml(eyebrow)}</span><h2>${escapeHtml(name)}</h2><div class="series-meta">${meta.filter(Boolean).map((entry) => (entry.icon ? `<span>${icon(entry.icon)}${escapeHtml(entry.text)}</span>` : `<span>${escapeHtml(entry)}</span>`)).join("")}</div><p>${escapeHtml(description)}</p><div class="series-actions">${actions}</div></div></section>`;
}

function mergedInfo(info, meta) {
  const details = meta?.details || {};
  return { ...info, cast: details.cast || info.cast, director: details.director || info.director, genre: details.genres || info.genre };
}

function trailerButton(meta) {
  return meta?.details?.trailer ? `<a class="secondary trailer" href="${escapeHtml(meta.details.trailer)}" target="_blank" rel="noreferrer">${icon("play")}Trailer</a>` : "";
}

function creditsBlock(info) {
  const rows = [["Cast", info.cast], ["Director", info.director], ["Genre", info.genre], ["Released", info.releasedate || info.releaseDate]].filter(([, value]) => value);
  if (!rows.length) return "";
  return `<section class="credits">${rows.map(([label, value]) => `<div><small>${escapeHtml(label)}</small><p>${escapeHtml(String(value))}</p></div>`).join("")}</section>`;
}

function renderSeriesDetail() {
  const item = state.seriesItem, data = state.seriesData || {}, info = data.info || {};
  if (!item) return;
  const seasons = seriesSeasons();
  if (!state.selectedSeason || !seasons.some(([number]) => number === state.selectedSeason)) state.selectedSeason = seasons[0]?.[0] || null;
  const episodes = seasons.find(([number]) => number === state.selectedSeason)?.[1] || [];
  const backdropValue = Array.isArray(info.backdrop_path) ? info.backdrop_path[0] : info.backdrop_path;
  const next = nextUnwatchedEpisode(seasons);
  const episodeRows = episodes.map((episode, index) => {
    const record = progressOf(`episode-${episode.id}`), bar = percent(record);
    const duration = episode.info?.duration || episode.duration || "Ready to play";
    return `<button class="episode ${finished(record) ? "watched" : ""}" data-episode-index="${index}"><span class="episode-number">E${escapeHtml(episodeNumber(episode, index))}</span><span class="episode-copy"><strong>${escapeHtml(episodeTitle(episode, index))}</strong><small>Season ${escapeHtml(state.selectedSeason)} • ${escapeHtml(duration)}${finished(record) ? " • Watched" : record ? ` • ${clock(record.position)} in` : ""}</small>${bar > 1 && !finished(record) ? `<span class="episode-bar"><i style="width:${bar.toFixed(1)}%"></i></span>` : ""}</span><span class="episode-play">${icon("play")}</span></button>`;
  }).join("");
  const actions = `${next ? `<button class="primary detail-play-next">${icon("play")}${escapeHtml(next.label)}</button>` : ""}${trailerButton(state.detailMeta)}<button class="secondary series-favorite">${state.favorites.has(item.id) ? `${icon("heart-fill")}Saved` : `${icon("heart")}My list`}</button>`;
  const meta = state.detailMeta;
  $("#series-detail").innerHTML = detailHero({
    backdrop: artUrl(meta?.backdrop, "w1280") || backdropValue || item.backdrop || item.logo,
    poster: artUrl(meta?.poster, "w342") || info.cover || info.movie_image || item.logo,
    eyebrow: "Series", name: state.detailMeta?.title || item.name,
    meta: [rating(info.rating || item.rating) ? { icon: "star", text: rating(info.rating || item.rating) } : "", String(info.releaseDate || info.releasedate || item.year || meta?.year || "").slice(0, 4), meta?.details?.genres || info.genre || item.category, `${seasons.length} season${seasons.length === 1 ? "" : "s"}`],
    description: meta?.overview || info.plot || item.description || "Choose a season and episode to start watching.",
    actions,
  }) + ratingsRow(meta) + creditsBlock(mergedInfo(info, meta)) + `<section class="episodes-pane"><div class="episodes-head"><h3>Episodes</h3>${rail(`<div class="season-tabs rail-scroller">${seasons.map(([number]) => `<button class="season-tab ${number === state.selectedSeason ? "active" : ""}" data-season="${escapeHtml(number)}">Season ${escapeHtml(number)}</button>`).join("")}</div>`)}</div>${episodeRows ? `<div class="episode-list">${episodeRows}</div>` : '<div class="episodes-empty">No episodes were returned for this season.</div>'}</section>`;
}

function nextUnwatchedEpisode(seasons) {
  for (const [season, episodes] of seasons) {
    for (let index = 0; index < episodes.length; index += 1) {
      const record = progressOf(`episode-${episodes[index].id}`);
      if (finished(record)) continue;
      const label = record ? `Resume S${season} E${episodeNumber(episodes[index], index)}` : `Play S${season} E${episodeNumber(episodes[index], index)}`;
      return { season, index, label };
    }
  }
  return null;
}

function renderMovieDetail() {
  const item = state.detailItem, info = state.detailData?.info || {};
  if (!item) return;
  const record = progressOf(item.id), bar = percent(record);
  const meta = state.detailMeta;
  const backdropValue = Array.isArray(info.backdrop_path) ? info.backdrop_path[0] : info.backdrop_path;
  const actions = `<button class="primary detail-play">${record && !finished(record) ? `${icon("play")}Resume • ${clock(record.duration - record.position)} left` : `${icon("play")}Play`}</button>${record ? '<button class="secondary detail-restart">Start over</button>' : ""}${trailerButton(meta)}<button class="secondary detail-favorite">${state.favorites.has(item.id) ? `${icon("heart-fill")}Saved` : `${icon("heart")}My list`}</button>`;
  $("#series-detail").innerHTML = detailHero({
    backdrop: artUrl(meta?.backdrop, "w1280") || backdropValue || item.backdrop || item.logo,
    poster: artUrl(meta?.poster, "w342") || info.movie_image || info.cover_big || item.logo,
    eyebrow: "Movie", name: state.detailMeta?.title || item.name,
    meta: [rating(info.rating || item.rating) ? { icon: "star", text: rating(info.rating || item.rating) } : "", String(info.releasedate || info.releaseDate || item.year || meta?.year || "").slice(0, 4), meta?.details?.runtime || info.duration || item.duration, item.category],
    description: meta?.overview || info.plot || info.description || "Ready to watch from your connected IPTV source.",
    actions,
  }) + ratingsRow(meta) + creditsBlock(mergedInfo(info, meta)) + (bar > 1 ? `<section class="detail-progress"><span><i style="width:${bar.toFixed(1)}%"></i></span><small>${escapeHtml(`${clock(record.position)} of ${clock(record.duration)} watched`)}</small></section>` : "");
}

function renderDetail() {
  if (state.seriesItem) renderSeriesDetail(); else if (state.detailItem) renderMovieDetail();
  updateRails();
}

function ratingsRow(meta) {
  const cells = [
    meta?.ratings?.imdb && { label: "IMDb", value: meta.ratings.imdb },
    meta?.ratings?.rt && { label: "Rotten Tomatoes", value: meta.ratings.rt },
    meta?.ratings?.metacritic && { label: "Metacritic", value: meta.ratings.metacritic },
    meta?.score && { label: "TMDB", value: meta.score },
  ].filter(Boolean);
  const hint = !apiKeys().omdb ? '<button class="ratings-hint" id="open-settings-hint">Add an OMDb key for IMDb and Rotten Tomatoes</button>' : "";
  if (!cells.length && !hint) return "";
  return `<section class="ratings">${cells.map((cell) => `<div><small>${escapeHtml(cell.label)}</small><strong>${escapeHtml(cell.value)}</strong></div>`).join("")}${hint}</section>`;
}

async function hydrateDetail(item) {
  if (!hasTmdb()) return;
  const meta = await fullMeta(item).catch(() => null);
  if (!meta || (state.detailItem?.id !== item.id && state.seriesItem?.id !== item.id)) return;
  state.detailMeta = meta;
  renderDetail();
}

async function hydrateHero(item) {
  if (!hasTmdb() || !item) return;
  const meta = await metaFor(item, { force: true }).catch(() => null);
  if (!meta?.backdrop) return;
  const hero = document.querySelector(".hero");
  if (!hero) return;
  const url = artUrl(meta.backdrop, "w1280");
  const existing = hero.querySelector("img");
  if (existing) { existing.src = url; return }
  const image = new Image();
  image.src = url;
  image.addEventListener("load", () => { if (hero.isConnected && !hero.querySelector("img")) hero.insertBefore(image, hero.firstChild) });
}

async function openSeries(item) {
  if (!state.provider) return;
  try {
    setLoading(true, "Loading episodes", item.name);
    const data = await fetchJson(apiUrl("get_series_info", `&series_id=${item.streamId}`));
    if (!seriesHasEpisodes(data)) throw new Error("No episodes were returned for this series");
    state.detailItem = null; state.detailData = null; state.detailMeta = null;
    state.seriesItem = item; state.seriesData = data; state.selectedSeason = null;
    renderDetail(); $("#series-modal").classList.remove("hidden");
    hydrateDetail(item);
  } catch (error) { showToast(error.message || "Could not load this series") }
  finally { setLoading(false) }
}

async function openMovie(item) {
  if (!state.provider) return;
  state.seriesItem = null; state.seriesData = null;
  state.detailItem = item; state.detailData = null; state.detailMeta = null;
  renderDetail(); $("#series-modal").classList.remove("hidden");
  hydrateDetail(item);
  try {
    const data = await fetchJson(apiUrl("get_vod_info", `&vod_id=${item.streamId}`));
    if (state.detailItem?.id === item.id) { state.detailData = data; renderDetail() }
  } catch { /* the basic details from the library are already on screen */ }
}

function openDetail(item) {
  if (!item) return;
  if (item.type === "series") return openSeries(item);
  if (item.type === "movie") return openMovie(item);
  return play(item);
}

function seriesHasEpisodes(data) {
  return Object.values(data?.episodes || {}).some((episodes) => Array.isArray(episodes) && episodes.length);
}

/* ---------- playback ---------- */

function startPlayback({ url, title, subtitle = "", isLive = false, resumeAt = 0, record }) {
  state.playerItem = record?.id ? state.items.find((item) => item.id === record.id) || null : null;
  state.playing = { ...record, position: resumeAt, duration: progressOf(record.key)?.duration || 0 };
  $("#player-title").textContent = title;
  $("#player-subtitle").textContent = subtitle;
  updatePlayerFavorite();
  $("#player-modal").classList.remove("hidden");
  const video = $("#video"), source = relay(url), message = $("#video-message");
  message.classList.add("hidden");
  resetPlayerUi();
  state.hls?.destroy(); state.hls = null;
  video.removeAttribute("src"); video.load();
  startPlayback.resumeAt = resumeAt;
  if (isLive && Hls.isSupported()) {
    state.hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 30 });
    state.hls.loadSource(source); state.hls.attachMedia(video);
    state.hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); refreshTrackMenus() });
    state.hls.on(Hls.Events.ERROR, (_, data) => {
      if (!data.fatal) return;
      message.textContent = "This channel could not be played. Close any other IPTV player because your account allows only one connection.";
      message.classList.remove("hidden");
    });
  } else {
    video.src = source; video.play().catch(() => {});
  }
  updatePlayerNav();
  saveProgress(state.playing);
}

function updatePlayerFavorite() {
  const button = $("#favorite-player"), item = state.playerItem;
  button.hidden = !item;
  const saved = item && state.favorites.has(item.id);
  button.innerHTML = icon(saved ? "heart-fill" : "heart");
  button.title = saved ? "In my list" : "Add to my list";
}

function play(item, { startOver = false } = {}) {
  if (!state.provider || !item) return;
  if (item.type === "series") return openSeries(item);
  const { server, user, pass } = credentials();
  if (item.type === "live") {
    state.queue = null;
    return startPlayback({ url: `${server}/live/${user}/${pass}/${item.streamId}.m3u8`, title: item.name, subtitle: item.category, isLive: true, record: { key: item.id, id: item.id, type: "live", title: item.name, subtitle: item.category, poster: item.logo } });
  }
  if (item.type !== "movie") return;
  state.queue = null;
  const saved = startOver ? null : progressOf(item.id);
  const resumeAt = saved && !finished(saved) ? saved.position : 0;
  startPlayback({ url: `${server}/movie/${user}/${pass}/${item.streamId}.${item.ext || "mp4"}`, title: item.name, subtitle: item.category, resumeAt, record: { key: item.id, id: item.id, type: "movie", title: item.name, subtitle: item.category, poster: item.logo } });
}

function playEpisode(item, season, episodes, index, { startOver = false } = {}) {
  const episode = episodes[index];
  if (!episode || !state.provider) return;
  const { server, user, pass } = credentials();
  const number = episodeNumber(episode, index), title = episodeTitle(episode, index);
  const key = `episode-${episode.id}`;
  const saved = startOver ? null : progressOf(key);
  state.queue = { item, season, episodes, index };
  startPlayback({
    url: `${server}/series/${user}/${pass}/${episode.id}.${episode.container_extension || "mp4"}`,
    title: `${item.name} • S${season} E${number}`, subtitle: title,
    resumeAt: saved && !finished(saved) ? saved.position : 0,
    record: { key, id: item.id, type: "episode", title: item.name, subtitle: `S${season} E${number} • ${title}`, poster: item.logo, seriesId: item.streamId, season: String(season), episodeId: episode.id, container: episode.container_extension || "mp4" },
  });
}

function playSeriesEpisode(index) {
  const item = state.seriesItem, episodes = seriesSeasons().find(([number]) => number === state.selectedSeason)?.[1] || [];
  if (!item || !episodes[index]) return;
  closeModal("series-modal");
  playEpisode(item, state.selectedSeason, episodes, index);
}

function resumeRecord(key) {
  const record = progressOf(key);
  if (!record || !state.provider) return;
  if (record.type === "movie" || record.type === "live") {
    const item = state.items.find((entry) => entry.id === record.id);
    if (!item) return showToast("That title is no longer in your library — refresh the source");
    return play(item);
  }
  const { server, user, pass } = credentials();
  const item = state.items.find((entry) => entry.id === record.id) || { id: record.id, name: record.title, logo: record.poster, streamId: record.seriesId };
  state.queue = null;
  startPlayback({
    url: `${server}/series/${user}/${pass}/${record.episodeId}.${record.container || "mp4"}`,
    title: record.title, subtitle: record.subtitle,
    resumeAt: finished(record) ? 0 : record.position,
    record: { ...record },
  });
  loadQueueForEpisode(item, record);
}

async function loadQueueForEpisode(item, record) {
  if (!item?.streamId) return;
  try {
    const data = await fetchJson(apiUrl("get_series_info", `&series_id=${item.streamId}`));
    const episodes = Object.entries(data.episodes || {}).find(([number]) => String(number) === String(record.season))?.[1] || [];
    const index = episodes.findIndex((episode) => String(episode.id) === String(record.episodeId));
    if (index < 0) return;
    state.queue = { item, season: String(record.season), episodes, index };
    updatePlayerNav();
  } catch { /* next-episode navigation stays hidden */ }
}

function stepEpisode(delta) {
  const queue = state.queue;
  if (!queue) return;
  const index = queue.index + delta;
  if (index < 0 || index >= queue.episodes.length) return;
  playEpisode(queue.item, queue.season, queue.episodes, index);
}

function updatePlayerNav() {
  const queue = state.queue;
  $("#player-prev").hidden = !queue || queue.index <= 0;
  $("#player-next").hidden = !queue || queue.index >= queue.episodes.length - 1;
}

function refreshTrackMenus() {
  const video = $("#video");
  const audio = state.hls ? state.hls.audioTracks.map((track, index) => ({ value: index, label: track.name || track.lang || `Audio ${index + 1}` })) : [];
  const subtitles = [{ value: -1, label: "Off" }];
  if (state.hls) state.hls.subtitleTracks.forEach((track, index) => subtitles.push({ value: index, label: track.name || track.lang || `Subtitle ${index + 1}` }));
  else [...video.textTracks].forEach((track, index) => subtitles.push({ value: index, label: track.label || track.language || `Subtitle ${index + 1}` }));
  fillSelect($("#audio-track"), audio, state.hls ? state.hls.audioTrack : -1);
  fillSelect($("#subtitle-track"), subtitles.length > 1 ? subtitles : [], state.hls ? state.hls.subtitleTrack : -1);
  $("#audio-wrap").hidden = audio.length < 2;
  $("#subtitle-wrap").hidden = subtitles.length < 2;
}

function fillSelect(select, options, current) {
  select.innerHTML = options.map((option) => `<option value="${option.value}" ${option.value === current ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("");
}

function closeModal(id) {
  $("#" + id).classList.add("hidden");
  if (id === "player-modal") {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    recordPosition(true);
    state.hls?.destroy(); state.hls = null;
    const video = $("#video"); video.pause(); video.removeAttribute("src"); video.load();
    state.playing = null; state.playerItem = null; state.queue = null;
    if (state.view === "home" || state.view === "history") render();
  }
  if (id === "series-modal") { state.seriesItem = null; state.seriesData = null; state.selectedSeason = null; state.detailItem = null; state.detailData = null; state.detailMeta = null }
}

function recordPosition(force = false) {
  const video = $("#video");
  if (!state.playing || !Number.isFinite(video.currentTime)) return;
  if (state.playing.type === "live") { if (force) saveProgress({ ...state.playing, position: 0, duration: 0 }); return }
  if (!Number.isFinite(video.duration) || video.duration <= 0) return;
  const now = Date.now();
  if (!force && now - (recordPosition.last || 0) < 5000) return;
  recordPosition.last = now;
  saveProgress({ ...state.playing, position: video.currentTime, duration: Number.isFinite(video.duration) ? video.duration : state.playing.duration || 0 });
}

/* ---------- events ---------- */

const video = $("#video");
video.addEventListener("loadedmetadata", () => {
  const resumeAt = startPlayback.resumeAt || 0;
  if (resumeAt > 5 && Number.isFinite(video.duration) && resumeAt < video.duration - 10) {
    video.currentTime = resumeAt;
    showToast(`Resuming from ${clock(resumeAt)}`);
  }
  startPlayback.resumeAt = 0;
  refreshTrackMenus();
});
video.addEventListener("timeupdate", () => recordPosition());
video.addEventListener("pause", () => recordPosition(true));
video.addEventListener("ended", () => {
  recordPosition(true);
  if (state.queue && state.queue.index < state.queue.episodes.length - 1) { showToast("Playing the next episode…"); stepEpisode(1) }
});

document.addEventListener("click", (event) => {
  const target = event.target;
  const close = target.closest("[data-close]"); if (close) return closeModal(close.dataset.close);
  if (target.closest("#add-source,.open-source")) return $("#source-modal").classList.remove("hidden");
  if (target.closest("#open-settings-hint")) { closeModal("series-modal"); state.view = "settings"; render(); return }
  if (target.closest("#check-updates")) {
    if (renderUpdateBanner.state?.state === "ready") return window.aurora?.installUpdate();
    renderUpdateBanner.hold = Date.now() + 700;
    renderUpdateBanner({ state: "checking" });
    return window.aurora?.checkForUpdates();
  }
    const nav = target.closest("nav button");
  if (nav) { state.view = nav.dataset.view; state.category = "All"; state.limit = 120; state.query = ""; $("#search").value = ""; render(); return }
  const use = target.closest("[data-use]"); if (use) return useSource(use.dataset.use);
  const reload = target.closest("[data-refresh]"); if (reload) return refreshLibrary(false, reload.dataset.refresh);
  const remove = target.closest("[data-remove]"); if (remove) { state.confirmRemove = remove.dataset.remove; renderSettings(); return }
  const confirmRemove = target.closest("[data-remove-confirm]");
  if (confirmRemove) { state.confirmRemove = null; return removeSource(confirmRemove.dataset.removeConfirm) }
  const pill = target.closest("#source-pill"); if (pill) { state.view = "settings"; state.confirmRemove = null; render(); return }
  if (target.closest("#play-something")) return playSomething();
  const themeButton = target.closest(".theme-switch button");
  if (themeButton) return applyTheme(themeButton.dataset.themeChoice);
  const arrow = target.closest(".rail-nav");
  if (arrow) {
    const scroller = arrow.closest(".rail").querySelector(".rail-scroller");
    const step = Math.max(240, scroller.clientWidth * 0.8);
    scroller.scrollBy({ left: arrow.classList.contains("next") ? step : -step, behavior: "smooth" });
    return;
  }
  const chip = target.closest(".chip"); if (chip) { state.category = chip.dataset.category; state.limit = 120; renderCollection(); return }
  if (target.closest("#load-more")) { state.limit += 120; renderCollection(); return }
  if (target.closest("#clear-history")) { state.progress.clear(); persistProgress(); render(); return }
  const featuredPlay = target.closest(".play-featured"); if (featuredPlay) return openDetail(state.items.find((item) => item.id === featuredPlay.dataset.id));
  const featuredFavorite = target.closest(".favorite-featured"); if (featuredFavorite) return toggleFavorite(state.items.find((item) => item.id === featuredFavorite.dataset.id));
  const season = target.closest(".season-tab"); if (season) { state.selectedSeason = season.dataset.season; renderDetail(); return }
  const episode = target.closest(".episode"); if (episode) return playSeriesEpisode(Number(episode.dataset.episodeIndex));
  if (target.closest(".detail-play-next")) {
    const next = nextUnwatchedEpisode(seriesSeasons());
    if (!next) return;
    const item = state.seriesItem, episodes = seriesSeasons().find(([number]) => number === next.season)?.[1] || [];
    closeModal("series-modal"); return playEpisode(item, next.season, episodes, next.index);
  }
  if (target.closest(".detail-play")) { const item = state.detailItem; closeModal("series-modal"); return play(item) }
  if (target.closest(".detail-restart")) { const item = state.detailItem; closeModal("series-modal"); return play(item, { startOver: true }) }
  if (target.closest(".series-favorite,.detail-favorite")) return toggleFavorite(state.seriesItem || state.detailItem);
  if (target.closest("#player-prev")) return stepEpisode(-1);
  if (target.closest("#player-next")) return stepEpisode(1);
  if (target.closest("#player-pip")) return video.requestPictureInPicture?.().catch(() => showToast("Picture in Picture is not available for this stream"));
  const resume = target.closest("[data-resume]");
  if (resume) {
    if (target.closest(".forget")) { state.progress.delete(resume.dataset.resume); persistProgress(); render(); return }
    return resumeRecord(resume.dataset.resume);
  }
  const media = target.closest(".card[data-id]");
  if (media) {
    const item = state.items.find((entry) => entry.id === media.dataset.id);
    if (target.closest(".heart")) return toggleFavorite(item);
    if (target.closest(".play-bubble")) return play(item);
    if (target.closest(".open-detail")) return openDetail(item);
    if (target.closest(".play-item")) return play(item);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.target instanceof Element && event.target.matches("input,select,textarea")) {
    if (event.key === "Escape") event.target.blur();
    return;
  }
  if (event.key === "Escape") {
    if (!$("#shortcuts").classList.contains("hidden")) return $("#shortcuts").classList.add("hidden");
    if (!$("#up-next").classList.contains("hidden")) { upNextDismissed = true; return $("#up-next").classList.add("hidden") }
    for (const id of ["player-modal", "series-modal", "settings-modal", "source-modal"]) {
      if (!$("#" + id).classList.contains("hidden")) return closeModal(id);
    }
    return;
  }
  if ($("#player-modal").classList.contains("hidden")) {
    if (event.key === "/") { event.preventDefault(); $("#search").focus() }
    return;
  }
  const step = event.shiftKey ? 60 : 10;
  const keys = {
    " ": () => (video.paused ? video.play() : video.pause()),
    ArrowRight: () => { video.currentTime = Math.min(video.duration || Infinity, video.currentTime + step) },
    ArrowLeft: () => { video.currentTime = Math.max(0, video.currentTime - step) },
    ArrowUp: () => { video.volume = Math.min(1, video.volume + 0.1) },
    ArrowDown: () => { video.volume = Math.max(0, video.volume - 0.1) },
    f: () => (document.fullscreenElement ? document.exitFullscreen() : $("#player-shell").requestFullscreen()),
    m: () => { video.muted = !video.muted },
    n: () => stepEpisode(1),
    p: () => stepEpisode(-1),
    "?": () => { $("#shortcuts").classList.toggle("hidden"); wakeChrome() },
  };
  const action = keys[event.key] || keys[event.key.toLowerCase()];
  if (!action) return;
  event.preventDefault();
  action();
});

/* ---------- player controls ---------- */

const shell = $("#player-shell");
const timeline = $("#timeline");
let upNextDismissed = false;
let idleTimer;

const liveStream = () => !Number.isFinite(video.duration) || video.duration <= 0;
const setIcon = (id, name) => $(id).querySelector("use").setAttribute("href", `#i-${name}`);

function resetPlayerUi() {
  upNextDismissed = false;
  $("#up-next").classList.add("hidden");
  $("#shortcuts").classList.add("hidden");
  $("#buffering").classList.add("hidden");
  $("#played").style.width = "0%";
  $("#buffered").style.width = "0%";
  $("#knob").style.left = "0%";
  $("#time-now").textContent = "0:00";
  $("#time-total").textContent = "";
  wakeChrome();
}

function wakeChrome() {
  shell.classList.remove("idle");
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!video.paused && $("#shortcuts").classList.contains("hidden") && $("#up-next").classList.contains("hidden")) shell.classList.add("idle");
  }, 2600);
}

function flash(name) {
  const badge = $("#tap-flash");
  badge.querySelector("use").setAttribute("href", `#i-${name}`);
  badge.classList.remove("show");
  void badge.offsetWidth;
  badge.classList.add("show");
}

function togglePlay() {
  if (video.paused) { video.play().catch(() => {}); flash("play") } else { video.pause(); flash("pause") }
}

function syncTransport() {
  setIcon("#player-toggle", video.paused ? "play" : "pause");
  $("#player-toggle").title = video.paused ? "Play" : "Pause";
  if (video.paused) { shell.classList.remove("idle"); clearTimeout(idleTimer) } else wakeChrome();
}

function syncTime() {
  const live = liveStream();
  $("#live-pill").hidden = !live;
  timeline.classList.toggle("live", live);
  $("#time-now").textContent = clock(video.currentTime || 0);
  $("#time-total").textContent = live ? "" : clock(video.duration);
  const played = live ? 0 : Math.min(100, (video.currentTime / video.duration) * 100);
  $("#played").style.width = `${played}%`;
  $("#knob").style.left = `${played}%`;
  let ahead = 0;
  if (!live) {
    for (let i = 0; i < video.buffered.length; i += 1) {
      if (video.buffered.start(i) <= video.currentTime && video.buffered.end(i) >= video.currentTime) ahead = (video.buffered.end(i) / video.duration) * 100;
    }
  }
  $("#buffered").style.width = `${ahead}%`;
  maybeUpNext();
}

function maybeUpNext() {
  const card = $("#up-next"), queue = state.queue;
  const due = queue && queue.index < queue.episodes.length - 1 && !liveStream()
    && video.duration > 90 && video.duration - video.currentTime <= 25;
  if (!due || upNextDismissed) { if (!due) card.classList.add("hidden"); return }
  if (!card.classList.contains("hidden")) return;
  $("#up-next-title").textContent = episodeTitle(queue.episodes[queue.index + 1], queue.index + 1);
  card.classList.remove("hidden");
  wakeChrome();
}

const ratioAt = (event) => {
  const rect = timeline.getBoundingClientRect();
  return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
};

timeline.addEventListener("pointerdown", (event) => {
  if (liveStream()) return;
  // seek first: setPointerCapture throws on an id the element does not own, and
  // a failed capture must not cost the user the seek they asked for
  video.currentTime = ratioAt(event) * video.duration;
  timeline.classList.add("scrubbing");
  try { timeline.setPointerCapture(event.pointerId) } catch { /* scrubbing still works without capture */ }
});

timeline.addEventListener("pointermove", (event) => {
  if (liveStream()) return;
  const ratio = ratioAt(event), bubble = $("#bubble");
  bubble.hidden = false;
  bubble.textContent = clock(ratio * video.duration);
  bubble.style.left = `${ratio * 100}%`;
  if (timeline.classList.contains("scrubbing")) video.currentTime = ratio * video.duration;
});

const endScrub = (event) => {
  timeline.classList.remove("scrubbing");
  try { timeline.releasePointerCapture(event.pointerId) } catch { /* already released */ }
};
timeline.addEventListener("pointerup", endScrub);
timeline.addEventListener("pointercancel", endScrub);
timeline.addEventListener("pointerleave", () => { $("#bubble").hidden = true });

video.addEventListener("click", togglePlay);
video.addEventListener("play", syncTransport);
video.addEventListener("pause", syncTransport);
video.addEventListener("timeupdate", syncTime);
video.addEventListener("durationchange", syncTime);
video.addEventListener("progress", syncTime);
video.addEventListener("waiting", () => $("#buffering").classList.remove("hidden"));
for (const settled of ["playing", "canplay", "seeked", "error", "pause"]) {
  video.addEventListener(settled, () => $("#buffering").classList.add("hidden"));
}
video.addEventListener("volumechange", () => {
  $("#volume").value = video.muted ? 0 : video.volume;
  setIcon("#player-mute", video.muted || video.volume === 0 ? "mute" : "volume");
});

shell.addEventListener("pointermove", wakeChrome);
shell.addEventListener("pointerleave", () => { if (!video.paused) shell.classList.add("idle") });

$("#player-toggle").addEventListener("click", togglePlay);
$("#player-back").addEventListener("click", () => { video.currentTime = Math.max(0, video.currentTime - 10) });
$("#player-forward").addEventListener("click", () => { video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10) });
$("#player-mute").addEventListener("click", () => { video.muted = !video.muted });
$("#volume").addEventListener("input", (event) => { video.volume = Number(event.target.value); video.muted = video.volume === 0 });
$("#player-full").addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else shell.requestFullscreen().catch(() => showToast("Full screen is not available here"));
});
document.addEventListener("fullscreenchange", () => setIcon("#player-full", document.fullscreenElement ? "fullscreen-exit" : "fullscreen"));
$("#player-help").addEventListener("click", () => { $("#shortcuts").classList.toggle("hidden"); wakeChrome() });
$("#shortcuts").addEventListener("click", () => $("#shortcuts").classList.add("hidden"));
$("#up-next-play").addEventListener("click", () => { $("#up-next").classList.add("hidden"); stepEpisode(1) });
$("#up-next-dismiss").addEventListener("click", () => { upNextDismissed = true; $("#up-next").classList.add("hidden") });

document.addEventListener("scroll", () => {
  cancelAnimationFrame(updateRails.frame);
  updateRails.frame = requestAnimationFrame(updateRails);
}, true);
window.addEventListener("resize", updateRails);

let searchTimer;
$("#search").addEventListener("input", (event) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.query = event.target.value.trim(); state.category = "All"; state.limit = 120; render() }, 180);
});
$("#source-form").addEventListener("submit", connectProvider);
document.addEventListener("submit", (event) => {
  if (event.target.id !== "keys-form") return;
  event.preventDefault();
  localStorage.setItem("aurora-keys", JSON.stringify({ tmdb: $("#tmdb-key").value.trim(), omdb: $("#omdb-key").value.trim() }));
  showToast(hasTmdb() ? "Saved — posters and ratings will fill in as you browse" : "Keys cleared");
  render();
});

document.addEventListener("change", (event) => {
  const rename = event.target.closest?.("[data-rename]");
  if (!rename) return;
  const name = rename.value.trim() || "Untitled source";
  rename.value = name;
  upsertSource({ id: rename.dataset.rename, name });
  if (state.provider?.id === rename.dataset.rename) state.provider.name = name;
  updateSource();
  showToast(`Renamed to ${name}`);
});
$("#favorite-player").addEventListener("click", () => toggleFavorite(state.playerItem));
$("#audio-track").addEventListener("change", (event) => { if (state.hls) state.hls.audioTrack = Number(event.target.value) });
$("#subtitle-track").addEventListener("change", (event) => {
  const value = Number(event.target.value);
  if (state.hls) { state.hls.subtitleTrack = value; state.hls.subtitleDisplay = value >= 0; return }
  [...video.textTracks].forEach((track, index) => { track.mode = index === value ? "showing" : "disabled" });
});
window.addEventListener("beforeunload", () => recordPosition(true));

/* ---------- updates ---------- */

function renderUpdateBanner(status) {
  const banner = $("#update-banner"), install = $("#update-install"), button = $("#check-updates");
  const busy = status?.state === "checking" || status?.state === "downloading" || status?.state === "verifying";
  renderUpdateBanner.state = status;
  if (!busy && renderUpdateBanner.hold > Date.now()) {
    clearTimeout(renderUpdateBanner.pending);
    renderUpdateBanner.pending = setTimeout(() => renderUpdateBanner(status), renderUpdateBanner.hold - Date.now());
    return;
  }
  if (button) {
    button.classList.toggle("busy", busy);
    button.disabled = busy;
    const label = $("#update-check-label");
    if (label) label.textContent = { checking: "Checking…", downloading: "Downloading…", verifying: "Checking the download…", ready: "Restart to update" }[status?.state] || "Check for updates";
  }
  const version = status?.version ? `Aurora ${status.version}` : "Aurora";
  const copy = {
    downloading: [`Downloading ${version}`, `${status?.percent || 0}% — you can keep watching`],
    verifying: [`Checking ${version}`, "Making sure the download is intact"],
    ready: [`${version} is ready`, "Aurora will restart to finish"],
    error: ["Update check failed", status?.message || ""],
    none: status?.message ? ["Aurora is up to date", `You are on ${$("#app-version").textContent}`] : null,
    skipped: status?.message ? ["Updates are off", status.message] : null,
  }[status?.state];
  renderUpdateBanner.last = status;
  if (!copy) return banner.classList.add("hidden");
  $("#update-title").textContent = copy[0];
  $("#update-detail").textContent = copy[1];
  install.hidden = status.state !== "ready";
  banner.classList.remove("hidden");
  if (status.state === "none" || status.state === "skipped") {
    clearTimeout(renderUpdateBanner.timer);
    renderUpdateBanner.timer = setTimeout(() => banner.classList.add("hidden"), 5000);
  }
}

if (window.aurora) {
  window.aurora.version().then((value) => { state.appVersion = value; const slot = $("#app-version"); if (slot) slot.textContent = value });
  window.aurora.updateStatus().then(renderUpdateBanner).catch(() => {});
  window.aurora.onUpdateStatus(renderUpdateBanner);
  $("#update-install").addEventListener("click", () => window.aurora.installUpdate());
  $("#update-dismiss").addEventListener("click", () => $("#update-banner").classList.add("hidden"));
}

document.querySelectorAll(".theme-switch button").forEach((button) => button.classList.toggle("active", button.dataset.themeChoice === themeChoice()));

(async function init() {
  try {
    await migrateSources();
    const source = activeSource();
    if (source) {
      setLoading(true, "Opening Aurora", "Loading your saved library…");
      state.provider = source;
      state.items = await loadLibrary(source.id);
      libraryIndex = null; state.trending = null;
    }
  } catch (error) { showToast(error.message || "Could not open your library") }
  finally {
    setLoading(false); render();
    if (!state.provider) setTimeout(() => $("#source-modal").classList.remove("hidden"), 250);
    else if (Number(localStorage.getItem("aurora-library-schema") || 0) < LIBRARY_SCHEMA) {
      showToast("Updating your library in the background…");
      refreshLibrary(true);
    }
  }
})();
