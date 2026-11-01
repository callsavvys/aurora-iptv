/* global Hls */
const $ = (selector) => document.querySelector(selector);

/* ---------- appearance ---------- */

/* localStorage is keyed to the page origin, and the origin carries the server
   port. When 41791 is busy the server falls back to another port, the origin
   changes, and every one of these comes back empty — favourites and resume
   positions included. This machine already has two origins on disk, so it is
   not hypothetical. They live in userData now, which no port can move. */
const prefs = { ...(window.aurora?.prefs || {}) };
let prefsPending = null;

const readPref = (key, fallback) => (prefs[key] === undefined || prefs[key] === null ? fallback : prefs[key]);

function writePref(key, value) {
  if (value === undefined) delete prefs[key]; else prefs[key] = value;
  clearTimeout(prefsPending);
  // a heart click should not wait on a disk write, but a quit should not lose one
  prefsPending = setTimeout(flushPrefs, 150);
}

function flushPrefs() {
  clearTimeout(prefsPending);
  prefsPending = null;
  return window.aurora?.setPrefs?.({ ...prefs })?.catch?.(() => {});
}

addEventListener("pagehide", () => { if (prefsPending) flushPrefs() });

/* Lift whatever an older origin still holds. Per key, not all-or-nothing: a
   user can land on a fresh port, write a theme there, and only later come back
   to the origin that still holds their list. Anything userData already answers
   wins, so this can never overwrite a newer setting with a stale one, and the
   old copies are dropped once the save is confirmed. */
const LEGACY_PREFS = {
  theme: "aurora-theme", sidebar: "aurora-sidebar", activeSource: "aurora-active-source",
  librarySchema: "aurora-library-schema", favorites: "aurora-favorites",
  progress: "aurora-progress", omdbUsage: "aurora-omdb-usage",
};
const JSON_PREFS = new Set(["favorites", "progress", "omdbUsage"]);

(function liftFromLocalStorage() {
  const moved = [];
  for (const [key, legacy] of Object.entries(LEGACY_PREFS)) {
    if (prefs[key] !== undefined && prefs[key] !== null) continue; // userData already knows better
    let raw;
    try { raw = localStorage.getItem(legacy) } catch { return }
    if (raw === null) continue;
    let value = raw;
    if (JSON_PREFS.has(key)) { try { value = JSON.parse(raw) } catch { continue } }
    else if (key === "librarySchema") value = Number(raw) || 0;
    if (value === null || value === undefined) continue;
    prefs[key] = value;
    moved.push(legacy);
  }
  if (!moved.length) return;
  // the page needs these now; clearing the old copies can wait for the write
  flushPrefs()?.then?.((result) => {
    if (result?.saved) for (const legacy of moved) { try { localStorage.removeItem(legacy) } catch { /* nothing to clean */ } }
  });
})();

const THEMES = ["system", "light", "dark"];
const themeChoice = () => { const stored = readPref("theme", ""); return THEMES.includes(stored) ? stored : "system" };
const resolvedTheme = () => { const choice = themeChoice(); return choice === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : choice };

function applyTheme(choice) {
  const value = THEMES.includes(choice) ? choice : "system";
  writePref("theme", value);
  if (value === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", value);
  document.querySelectorAll(".theme-switch button").forEach((button) => button.classList.toggle("active", button.dataset.themeChoice === value));
  window.aurora?.setTheme(resolvedTheme());
}

applyTheme(themeChoice());

const sidebarHidden = () => readPref("sidebar", "") === "rail";
function applySidebar(rail) {
  writePref("sidebar", rail ? "rail" : "full");
  document.querySelector(".app")?.classList.toggle("rail", rail);
}
applySidebar(sidebarHidden());
matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => { if (themeChoice() === "system") applyTheme("system") });
const LIBRARY_SCHEMA = 2;
/* A provider adds films every day. Opening the cached library is instant and
   right, but never looking again means Aurora is quietly a week out of date, so
   anything older than a day is refreshed in the background on the next launch. */
const LIBRARY_STALE = 24 * 60 * 60 * 1000;
const libraryStale = (source) => Boolean(source) && Date.now() - Number(source.loadedAt || 0) > LIBRARY_STALE;
const state = {
  provider: null, items: [], view: "home", query: "", category: "All", limit: 120,
  favorites: new Set(readPref("favorites", [])),
  progress: new Map(Object.entries(readPref("progress", {}))),
  playerItem: null, playing: null, hls: null, queue: null, appVersion: "", confirmRemove: null, revealSource: null, historyFilter: "all", historyOpen: new Set(), confirmForget: null, trending: null, searchScope: "all", liveMode: "guide", detailId: null, history: [], historyAt: -1,
  seriesItem: null, seriesData: null, selectedSeason: null, detailItem: null, detailData: null, detailMeta: null,
};
const views = { home: "Home", live: "Live TV", movies: "Movies", series: "Series", favorites: "Favorites", history: "History", settings: "Settings", detail: "Detail" };

/* ---------- navigation ----------
   Detail used to be a modal, which meant there was nowhere to go back to. It
   is a view now, and every move through the app is an entry on a stack. */

/* The top bar floats over the billboard so the artwork runs to the top of the
   window. Once the page has moved past the hero there is no artwork under it
   any more, so it takes on a background of its own. */
let syncHeader = () => {};

function watchScroll() {
  const scroller = $("#content"), workspace = document.querySelector(".workspace");
  if (!scroller || !workspace) return;
  syncHeader = () => workspace.classList.toggle("scrolled", scroller.scrollTop > 24);
  scroller.addEventListener("scroll", syncHeader, { passive: true });
  syncHeader();
}

const entryOf = () => ({ view: state.view, query: state.query, category: state.category, scope: state.searchScope, detailId: state.detailId, limit: state.limit });
const sameEntry = (a, b) => a && b && a.view === b.view && a.query === b.query && a.detailId === b.detailId;

function applyEntry(entry) {
  state.view = entry.view;
  state.query = entry.query || "";
  state.category = entry.category || "All";
  state.searchScope = entry.scope || "all";
  state.detailId = entry.detailId || null;
  state.limit = entry.limit || (entry.view === "live" && state.liveMode !== "grid" ? GUIDE_CHANNELS : 120);
  const field = $("#search");
  if (field && field.value !== state.query) field.value = state.query;
}

function navigate(patch, { replace = false } = {}) {
  const entry = { ...entryOf(), category: "All", scope: "all", detailId: null, limit: undefined, ...patch };
  // a detail page is never a search result, so it must not inherit the query
  if (entry.view === "detail" && !("query" in patch)) entry.query = "";
  const current = state.history[state.historyAt];
  if (!replace && sameEntry(current, entry)) { applyEntry(entry); return render() }
  if (replace && current) state.history[state.historyAt] = entry;
  else {
    state.history = state.history.slice(0, state.historyAt + 1);
    state.history.push(entry);
    if (state.history.length > 80) state.history.shift();
    state.historyAt = state.history.length - 1;
  }
  applyEntry(entry);
  render();
}

const canGoBack = () => state.historyAt > 0;
const canGoForward = () => state.historyAt < state.history.length - 1;

function step(delta) {
  const next = state.historyAt + delta;
  if (next < 0 || next >= state.history.length) return;
  state.historyAt = next;
  applyEntry(state.history[next]);
  render();
}

/* ---------- sources ----------
   Aurora used to hold exactly one account in aurora-provider. Sources are a
   list now, each with its own cached library, and the old single account is
   migrated into the list on first run rather than dropped. */

const readSources = () => (Array.isArray(secrets?.sources) ? secrets.sources : []);

function writeSources(list) {
  secrets = { ...(secrets || {}), sources: list };
  saveSecrets(secrets, { quiet: true });
}
const activeSourceId = () => readPref("activeSource", "") || readSources()[0]?.id || "";
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
  writePref("activeSource", id);
}

function upsertSource(source) {
  const list = readSources();
  const index = list.findIndex((entry) => entry.id === source.id);
  // a new library count is this device's business; a name or login is the account's
  const synced = ["name", "server", "username", "password"].some((field) => field in source);
  const patch = synced ? { ...source, updatedAt: Date.now() } : source;
  if (index === -1) list.push(patch); else list[index] = { ...list[index], ...patch };
  writeSources(list);
  if (synced) scheduleSync();
}

async function useSource(id, { auto = false } = {}) {
  const source = readSources().find((entry) => entry.id === id);
  if (!source) return;
  writePref("activeSource", id);
  state.provider = source;
  state.items = await loadLibrary(id);
  libraryIndex = null; state.trending = null;
  // an empty cache normally means "go and press refresh", but not when Aurora
  // picked the source itself: ensureLibrary is about to fetch it
  state.view = state.items.length || auto ? "home" : "settings";
  state.category = "All"; state.limit = 120; state.query = "";
  render();
  // nothing cached is not a dead end: fetch it rather than tell someone to go
  // and press a button. ensureLibrary does this for the source it adopts, so it
  // only has to be done here for a source the user picked themselves
  if (!state.items.length && !auto) {
    showToast(`Loading ${source.name}'s library…`);
    refreshLibrary(true, id);
  }
}

async function testSource(id) {
  const source = readSources().find((entry) => entry.id === id);
  if (!source) return;
  const row = document.querySelector(`[data-status-for="${CSS.escape(id)}"]`);
  const say = (text, tone) => { if (row) { row.textContent = text; row.className = `row-status ${tone}` } };
  say("Checking…", "");
  const previous = state.provider;
  state.provider = source;
  try {
    const auth = await fetchJson(apiUrl());
    const info = auth?.user_info || {};
    if (Number(info.auth) !== 1) return say("The provider rejected this login", "bad");
    if (info.status && info.status !== "Active") return say(`Account is ${String(info.status).toLowerCase()}`, "bad");
    const expiry = Number(info.exp_date) ? new Date(Number(info.exp_date) * 1000).toLocaleDateString() : "";
    say(`Connected${info.max_connections ? ` · ${info.active_cons || 0}/${info.max_connections} connections` : ""}${expiry ? ` · expires ${expiry}` : ""}`, "good");
  } catch (error) {
    const raw = error?.message || "";
    say(/fetch failed|networkerror|failed to fetch/i.test(raw) ? "Could not reach that server — check the address and that you are online" : raw || "Could not reach this provider", "bad");
  } finally { state.provider = previous }
}

async function removeSource(id) {
  const gone = readSources().find((entry) => entry.id === id);
  // remembered, so another device that still has it doesn't put it back
  if (gone) { writePref("sourcesRemoved", { ...readPref("sourcesRemoved", {}), [sourceKey(gone)]: Date.now() }); scheduleSync() }
  const list = readSources().filter((entry) => entry.id !== id);
  writeSources(list);
  await idbPut("library", libraryKey(id), []).catch(() => {});
  if (activeSourceId() === id) {
    writePref("activeSource", undefined);
    const next = list[0];
    if (next) return useSource(next.id);
    state.provider = null; state.items = []; libraryIndex = null; state.trending = null;
  }
  render();
}

const cleanServer = (value) => { const clean = value.trim().replace(/\/$/, ""); return /^https?:\/\//i.test(clean) ? clean : `http://${clean}` };
/* The Mac app has a local server that fetches from the provider on the page's
   behalf. The iPhone build has none: its requests go out natively (Capacitor's
   HTTP bridge, so no CORS) and media plays straight from the provider. */
const IOS = window.aurora?.platform === "ios";
const ANDROID = window.aurora?.platform === "android";
// the Capacitor shells reach providers directly; only the Mac build has a local
// server to proxy through
const NATIVE = IOS || ANDROID;
// a TV box and a phone are one platform to Capacitor and two different rooms to
// the person holding the remote, so the TV build says so for itself
const TV = document.documentElement.classList.contains("platform-tv");
const relay = (url) => (NATIVE ? url : `/proxy?src=${encodeURIComponent(url)}`);
const DEVICE = TV ? "this TV" : IOS ? "this iPhone" : ANDROID ? "this device" : "this Mac";
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
  upsertSource({ id, count: items.length, loadedAt: Date.now() });
  writePref("librarySchema", LIBRARY_SCHEMA);
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
let secrets = null, secretsLocked = false;

/* Keys built into this build, so a fresh install has artwork and ratings
   without being asked for anything. They ship inside the app bundle and inside
   this repository, so they are public the moment either is shared — treat them
   as disposable and rotate them if that ever matters. Anything saved in
   Settings, or synced from the account, wins over these. */
const BUILT_IN = { tmdb: "f494f7209a254b1db82fa70f10332086", omdb: "85f37d73" };

const apiKeys = () => ({ ...(secrets || {}), tmdb: secrets?.tmdb || BUILT_IN.tmdb, omdb: secrets?.omdb || BUILT_IN.omdb });

const readJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback } catch { return fallback } };

async function loadSecrets() {
  let stored = await window.aurora?.getSecrets?.();
  // a keychain that is not awake yet says so and keeps the file: wait for it
  for (let attempt = 1; attempt <= 3 && stored?.unreadable && stored?.retryable; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 700 * attempt));
    stored = await window.aurora?.getSecrets?.();
  }
  secretsLocked = Boolean(stored?.unreadable && stored?.retryable);
  secrets = stored?.unreadable ? {} : stored || {};
  if (secretsLocked) showToast(`Your saved sources and keys could not be unlocked on ${DEVICE} yet, so nothing will be saved over them — restart Aurora to try again`);
  else if (stored?.unreadable) showToast(`Your saved sources and keys on ${DEVICE} could not be unlocked — sign in to your account to bring them back`);
  if (secretsLocked) return secrets; // no migration either: that writes
  // Pull anything still sitting in localStorage into the keychain. The old copy
  // is only removed once the encrypted write has actually confirmed success —
  // losing a provider password because a keychain write failed is unacceptable.
  const pending = {};
  const legacyKeys = readJson("aurora-keys", null);
  if (legacyKeys && (legacyKeys.tmdb || legacyKeys.omdb) && !secrets.tmdb && !secrets.omdb) Object.assign(pending, legacyKeys);
  const legacySources = readJson("aurora-sources", null);
  if (Array.isArray(legacySources) && legacySources.length && !secrets.sources?.length) pending.sources = legacySources;
  if (!Object.keys(pending).length) return secrets;

  secrets = { ...secrets, ...pending };
  const result = await window.aurora?.setSecrets?.(secrets);
  if (result?.saved) {
    if (pending.tmdb || pending.omdb) localStorage.removeItem("aurora-keys");
    if (pending.sources) localStorage.removeItem("aurora-sources");
  } else {
    showToast(NATIVE ? "Could not move your saved details into app storage — they stay where they were" : "Could not move your saved details into this Mac's keychain — they stay where they were");
  }
  return secrets;
}

async function saveSecrets(next, { quiet = false, force = false } = {}) {
  secrets = next;
  // kept in memory for this run, but never written: the file on disk is the only
  // copy of someone's sources and it may well be readable on the next launch
  if (secretsLocked && !force) {
    if (!quiet) showToast(`Not saved — your encrypted store on ${DEVICE} could not be unlocked. Restart Aurora and try again`);
    return { saved: false, locked: true };
  }
  const result = await window.aurora?.setSecrets?.(next);
  if (result && !result.saved) showToast(`Could not save to ${DEVICE}`);
  // the iPhone build keeps these in app storage by design; the warning is for a Mac without a keychain
  else if (result && !result.encrypted && !quiet && !NATIVE) showToast("Saved, but this Mac has no keychain available so it is stored unencrypted");
  return result;
}

const fingerprint = (value) => (value ? `${"•".repeat(Math.max(0, Math.min(12, value.length - 4)))}${value.slice(-4)}` : "");
const hasTmdb = () => Boolean(apiKeys().tmdb);

// provider titles carry language tags, quality flags and the year
// "AR| Dune" is a language tag; "Troy: The Odyssey" is a title. The shapes are
// identical, so the prefix is stripped for one key and kept for another, and
// the scoring decides which reading was right.
const LEAD_TAG = /^\s*[\[|(]?\s*[A-Za-z]{2,4}\s*[\]|)]?\s*[|:\-–]\s*/u;

function searchTitle(name, { keepPrefix = false } = {}) {
  const raw = String(name || "");
  return (keepPrefix ? raw : raw.replace(LEAD_TAG, ""))
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
  const stored = readPref("omdbUsage", null);
  if (stored?.date === today) usage = stored;
  return {
    left: OMDB_DAILY - usage.used,
    spend: () => writePref("omdbUsage", { date: today, used: usage.used + 1 }),
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

const indexKey = (name, options) => searchTitle(name, options).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// both readings of the name, so neither interpretation of a prefix loses a match
const indexKeys = (name) => [...new Set([indexKey(name), indexKey(name, { keepPrefix: true })])].filter(Boolean);

function buildIndex() {
  const byTitle = new Map(), byType = { live: [], movie: [], series: [] }, rows = [];
  for (const item of state.items) {
    (byType[item.type] ||= []).push(item);
    const keys = indexKeys(item.name);
    rows.push({ item, name: item.name.toLowerCase(), category: (item.category || "").toLowerCase(), key: keys[0] || "", year: Number(releaseYear(item)) || 0 });
    for (const key of keys) {
      const bucket = byTitle.get(key);
      if (bucket) bucket.push(item); else byTitle.set(key, [item]);
    }
  }
  libraryIndex = { byTitle, byType, rows, cache: {} };
  return libraryIndex;
}

/* Ranked, not filtered. A plain substring match put "BBC Arabic HD" above
   "BBC One HD" for the query "bbc". Deliberately no fuzzy matching: on short
   tokens it destroys precision, and channel names are already noisy. */
const TIERS = ["Exact", "Starts with", "Word match", "Contains", "Category"];

function searchLibrary(query, limit = 600) {
  const needle = query.toLowerCase().trim();
  if (!needle) return [];
  const found = [];
  for (const row of index().rows) {
    const at = row.name.indexOf(needle);
    let tier = -1;
    if (row.name === needle) tier = 0;
    else if (at === 0) tier = 1;
    else if (at > 0) tier = /[a-z0-9]/.test(row.name[at - 1]) ? 3 : 2;
    else if (row.category.includes(needle)) tier = 4;
    if (tier === -1) continue;
    found.push({ item: row.item, tier, length: row.name.length });
  }
  found.sort((a, b) => a.tier - b.tier || a.length - b.length || a.item.name.localeCompare(b.item.name));
  return found.slice(0, limit).map((entry) => ({ ...entry, item: entry.item }));
}

const index = () => libraryIndex || buildIndex();
const ofType = (type) => index().byType[type] || [];

/* ---------- trending ----------
   TMDB publishes a global weekly list. On its own that is a list of films you
   may not have, so it is matched against the library and only what is actually
   playable is shown. Cached per ISO week. */


/* TMDB's "this week" is a rolling window that moves every day, so keying the
   cache to the ISO week froze the list until the week rolled over — a film
   that started trending on Tuesday could not appear until the next Monday.
   Both The Runner and Moana were sitting at #1 and #2 and never showed up. */
const TRENDING_TTL = 6 * 60 * 60 * 1000;

async function trendingList(kind) {
  const key = apiKeys().tmdb;
  if (!key) return [];
  const cacheKey = `trending:${kind}`;
  const cached = await idbGet("meta", cacheKey).catch(() => null);
  if (cached?.at && Date.now() - cached.at < TRENDING_TTL) return cached.list || [];
  const pages = await Promise.all([1, 2].map((page) =>
    fetchJson(`${TMDB}/trending/${kind}/week?api_key=${key}&page=${page}`).catch(() => null)));
  const results = pages.flatMap((page) => page?.results || []);
  if (!results.length) return cached?.list || []; // offline: yesterday's list beats an empty row
  await idbPut("meta", cacheKey, { at: Date.now(), list: results }).catch(() => {});
  return results;
}

/* A title alone cannot identify a film. "Dune" is two films, "Nosferatu" is
   four, and indexKey strips the year, so the old lookup put whichever one the
   provider happened to list first into "Top 20 this week". A title match now
   only nominates candidates; the year picks between them, and a TMDB id we
   already hold decides outright. */
const YEAR_SLACK = 1; // regional release dates slip a year either way

const entryYear = (entry) => Number(String(entry.release_date || entry.first_air_date || "").slice(0, 4)) || 0;

// the original title catches libraries that name films in their own language,
// and TMDB titles wear the same colon that trips the tag stripper ("IT: Chapter Two")
function entryKeys(entry) {
  const keys = new Set();
  for (const name of [entry.title, entry.name, entry.original_title, entry.original_name]) {
    if (name) for (const key of indexKeys(name)) keys.add(key);
  }
  return [...keys];
}

/* Having nothing to compare on is not the same as disagreeing. Plenty of
   providers ship no year at all, so a yearless item stays eligible — it just
   loses to one whose year lands on the nose. */
function scoreCandidate(candidate, entry, wanted) {
  const meta = metaCache.get(candidate.id);
  const year = Number(releaseYear(candidate) || 0);
  /* The item's own year came from the provider; the cached TMDB id was written
     by this matcher and earlier versions of it got plenty wrong. So the year
     is checked first and gets to veto the id, not the other way round. */
  if (wanted && year && Math.abs(year - wanted) > YEAR_SLACK) return -1; // same title, different film
  const sameId = entry.id && meta?.tmdbId ? String(meta.tmdbId) === String(entry.id) : null;
  if (sameId === true) return 100;
  let score = 40;
  if (wanted && year) score = 80 - Math.abs(year - wanted) * 10;
  else if (wanted && meta?.year) score = Math.abs(Number(meta.year) - wanted) <= YEAR_SLACK ? 50 : 30;
  return sameId === false ? Math.min(score, 20) : score; // a cached id that says otherwise
}

function pickCandidate(entry, type, seen) {
  const wanted = entryYear(entry);
  let best = null;
  const weighed = new Set();
  for (const key of entryKeys(entry)) {
    for (const candidate of index().byTitle.get(key) || []) {
      if (candidate.type !== type || seen.has(candidate.id) || weighed.has(candidate.id)) continue;
      weighed.add(candidate.id);
      const score = scoreCandidate(candidate, entry, wanted);
      if (score < 0) continue;
      // shorter names carry less provider junk, so they break ties
      if (!best || score > best.score || (score === best.score && candidate.name.length < best.item.name.length)) best = { item: candidate, score };
    }
  }
  return best?.item || null;
}

/* A provider tag is not always shaped like one. "AMZN - Backrooms (2026)"
   strips cleanly, but the same line writes "AMZN | The Runner (2026)" with a
   character Aurora does not read as a separator, so the tag survives into the
   key and the title never matches. Chasing every separator a provider might
   invent is a losing game, so an entry that matched nothing exactly gets a
   second pass: a key that ENDS WITH the wanted title, on a word boundary,
   behind a short lead-in. Requiring both years to be known and to agree is
   what keeps this safe — "The Dark Knight" ends with "Knight", but it is not
   the same year as one. */
const MAX_LEAD = 12;

function suffixCandidate(entry, type, seen, wanted) {
  if (!wanted) return null;
  const keys = entryKeys(entry).filter((key) => key.length >= 4);
  if (!keys.length) return null;
  let best = null;
  for (const row of index().rows) {
    if (row.item.type !== type || seen.has(row.item.id) || !row.key) continue;
    if (!row.year || Math.abs(row.year - wanted) > YEAR_SLACK) continue; // the year carries this on its own
    for (const key of keys) {
      if (!row.key.endsWith(` ${key}`)) continue;
      const lead = row.key.length - key.length - 1;
      if (lead > MAX_LEAD) continue; // that is half a title, not a tag
      if (!best || lead < best.lead) best = { item: row.item, lead };
    }
  }
  return best?.item || null;
}

// a trending entry already carries poster, backdrop and score, so a match is
// also a free metadata record for that item
function matchTrending(results, type) {
  const matched = [], seen = new Set();
  for (const entry of results) {
    const item = pickCandidate(entry, type, seen) || suffixCandidate(entry, type, seen, entryYear(entry));
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

/* ---------- programme guide ----------
   Xtream returns EPG titles and descriptions base64-encoded, and providers are
   inconsistent about whether timestamps come as unix seconds or as a local
   string with no offset. Both are handled; entries that survive neither are
   dropped rather than rendered as an invalid block. */

const EPG_TTL = 30 * 60 * 1000;
const epgCache = new Map();

function decodeEpgText(value) {
  if (!value) return "";
  const plain = String(value).trim();
  const compact = plain.replace(/\s/g, "");
  // a plain title can easily look like base64, so decode strictly and reject
  // anything that comes back as invalid UTF-8 or carries control characters
  if (!compact || compact.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return plain;
  try {
    const bytes = Uint8Array.from(atob(compact), (char) => char.charCodeAt(0));
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
    if (!text || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) return plain;
    return text;
  } catch { return plain }
}

function normaliseProgramme(entry) {
  const start = Number(entry.start_timestamp) * 1000 || Date.parse(String(entry.start || "").replace(" ", "T"));
  const end = Number(entry.stop_timestamp) * 1000 || Date.parse(String(entry.end || "").replace(" ", "T"));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start, end, title: decodeEpgText(entry.title) || "No title", description: decodeEpgText(entry.description) };
}

/* Providers differ in which EPG endpoint they populate, so try both, and record
   WHY a channel came back empty. Collapsing every failure into an empty list
   made "no guide" indistinguishable from "the request failed" and from
   "listings arrived but Aurora could not read them" — which are three very
   different problems, only one of which is the provider's. */
async function epgFor(item) {
  const key = `epg:${activeSourceId()}:${item.streamId}`;
  const held = epgCache.get(key);
  if (held && Date.now() - held.at < EPG_TTL) return held;
  const stored = await idbGet("meta", key).catch(() => null);
  if (stored?.reason && Date.now() - stored.at < EPG_TTL) { epgCache.set(key, stored); return stored }

  return enqueue(async () => {
    let raw = [], failed = 0, tried = [];
    for (const [action, extra] of [["get_short_epg", `&stream_id=${item.streamId}&limit=24`], ["get_simple_data_table", `&stream_id=${item.streamId}`]]) {
      tried.push(action);
      try {
        const data = await fetchJson(apiUrl(action, extra));
        const listings = data?.epg_listings || data?.epg || (Array.isArray(data) ? data : []);
        if (listings.length) { raw = listings; break }
      } catch { failed += 1 }
    }
    const list = raw.map(normaliseProgramme).filter(Boolean).sort((a, b) => a.start - b.start);
    const reason = list.length ? "ok" : raw.length ? "unreadable" : failed === tried.length ? "failed" : "empty";
    const record = { at: Date.now(), list, raw: raw.length, reason, sample: reason === "unreadable" ? raw[0] : null };
    epgCache.set(key, record);
    await idbPut("meta", key, record).catch(() => {});
    return record;
  }, { slow: true });
}

const nowPlaying = (list, at = Date.now()) => (list || []).find((entry) => entry.start <= at && entry.end > at) || null;
const upNext = (list, at = Date.now()) => (list || []).find((entry) => entry.start > at) || null;

/* ---------- watch progress ---------- */

/* History is what you watched, so it has to outlast a binge. 400 records was
   two long shows' worth of episodes before older films fell off the end. Over
   the cap, live channels go first — they carry no position or watched mark —
   and only then the oldest of everything else. */
const HISTORY_CAP = 3000;

function persistProgress() {
  if (state.progress.size > HISTORY_CAP) {
    const keep = [...state.progress.entries()]
      .sort(([, a], [, b]) => (a.type === "live") - (b.type === "live") || b.updatedAt - a.updatedAt)
      .slice(0, HISTORY_CAP);
    state.progress = new Map(keep);
  }
  writePref("progress", Object.fromEntries(state.progress));
}

function saveProgress(patch) {
  if (!patch?.key) return;
  const merged = { ...(state.progress.get(patch.key) || {}), ...patch, updatedAt: Date.now() };
  delete merged.hidden; // watching something again brings it back to Continue watching
  state.progress.set(patch.key, merged); persistProgress();
  markDirty("progress", patch.key);
}

/* Removing a card from Continue watching used to delete the record outright,
   and with it the watched mark and the history entry. It only hides it now. */
function hideFromContinue(keys) {
  for (const key of keys) {
    const record = state.progress.get(key);
    if (record) { state.progress.set(key, { ...record, hidden: true, updatedAt: Date.now() }); markDirty("progress", key) }
  }
  persistProgress();
}

const progressOf = (key) => state.progress.get(key) || null;
const finished = (record) => Boolean(record && record.duration > 0 && record.position >= record.duration * 0.95);
const percent = (record) => (record && record.duration > 0 ? Math.min(100, (record.position / record.duration) * 100) : 0);
const underway = (record) => Boolean(record) && record.position > 20 && !finished(record);

/* A record only knows its own episode, so when one is played the episode after
   it is written down with it. That is what lets a show move on to "next
   episode" after a finished one, offline, without refetching the series. */
function nextHint(queue) {
  const target = episodeAt(queue, 1);
  if (!target) return null;
  const episode = target.episodes[target.index];
  return { season: String(target.season), episodeId: episode.id, number: String(episodeNumber(episode, target.index)), title: episodeTitle(episode, target.index), container: episode.container_extension || "mp4" };
}

function recordFromHint(latest) {
  const next = latest.next;
  return { key: `episode-${next.episodeId}`, id: latest.id, type: "episode", title: latest.title, subtitle: `S${next.season} E${next.number} \u2022 ${next.title}`, poster: latest.poster, seriesId: latest.seriesId, season: next.season, episodeId: next.episodeId, container: next.container, position: 0, duration: 0 };
}

// what "continue" means for a show: the episode in progress, or the unstarted
// one after the last episode finished; nothing once it is caught up
function upNextFor(latest) {
  if (!finished(latest)) return underway(latest) ? { record: latest, fresh: false } : null;
  if (!latest.next) return null;
  const existing = progressOf(`episode-${latest.next.episodeId}`);
  if (finished(existing)) return null;
  return existing && underway(existing) ? { record: existing, fresh: false } : { record: recordFromHint(latest), fresh: true };
}

function historyShows() {
  const shows = new Map();
  for (const record of state.progress.values()) {
    if (record.type !== "episode") continue;
    const show = shows.get(record.id) || { id: record.id, episodes: [], latest: record };
    show.episodes.push(record);
    if (record.updatedAt > show.latest.updatedAt) show.latest = record;
    shows.set(record.id, show);
  }
  for (const show of shows.values()) {
    show.episodes.sort((a, b) => b.updatedAt - a.updatedAt);
    show.title = show.latest.title;
    show.poster = show.episodes.find((record) => record.poster)?.poster || "";
    show.updatedAt = show.latest.updatedAt;
    show.watched = show.episodes.filter(finished).length;
    show.upNext = upNextFor(show.latest);
  }
  return [...shows.values()];
}

function continueWatching() {
  const films = [...state.progress.values()]
    .filter((record) => record.type === "movie" && !record.hidden && underway(record))
    .map((record) => ({ kind: "movie", record, updatedAt: record.updatedAt }));
  const shows = historyShows()
    .filter((show) => show.upNext && !show.latest.hidden)
    .map((show) => ({ kind: "series", show, record: show.upNext.record, fresh: show.upNext.fresh, updatedAt: show.updatedAt }));
  return [...films, ...shows].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20);
}
const watchHistory = () => [...state.progress.values()].sort((a, b) => b.updatedAt - a.updatedAt);

/* ---------- library ---------- */

async function loadEverything(quiet = false) {
  const say = (title, detail) => { if (!quiet) setLoading(true, title, detail) };
  say("Loading live TV", "Downloading channels and categories…");
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
    writePref("activeSource", provider.id);
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
    const items = await loadEverything(quiet);
    await saveLibrary(items, source.id);
    libraryIndex = null; state.trending = null;
    if (activeSourceId() === source.id) { state.items = items } else { state.provider = previous }
    render();
    publishLibraryFilter().catch(() => {}); // what you can play is what a friend can match against
    showToast(`Library refreshed • ${items.length.toLocaleString()} items`);
  } catch (error) { state.provider = previous; showToast(error.message || "Could not refresh the library") }
  finally { refreshLibrary.busy = false; setLoading(false) }
}

/* Signing in carries your sources across, but a source is only a login: the
   library behind it still has to be fetched on this device. Do that as soon as
   there is a source with nothing cached, instead of leaving someone on an empty
   Home — or on Settings — wondering why signing in brought no content. */
function ensureLibrary() {
  return (ensureLibrary.running = ensureLibrary.running || run().finally(() => { ensureLibrary.running = null }));

  async function run() {
    if (ensureLibrary.done || refreshLibrary.busy) return;
    const sources = readSources();
    if (!sources.length) return;
    if (!state.provider) await useSource(activeSource()?.id || sources[0].id, { auto: true });
    if (!state.provider) return;
    if (state.items.length) { ensureLibrary.done = true; return }
    const waiting = state.view === "settings" || state.view === "home";
    // quietly: this is Aurora's own idea, and a blocking overlay over whatever
    // the user is doing is not what signing in asked for
    await refreshLibrary(true, state.provider.id);
    if (!state.items.length) return; // still empty: stay armed and try again next sync
    ensureLibrary.done = true;
    if (waiting && (state.view === "settings" || state.view === "home")) navigate({ view: "home" });
  }
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
  // A poster from TMDB has the title printed on it, so a caption underneath
  // says it twice and turns a row of artwork into a row of filenames. The
  // caption is kept for anything with no artwork to speak for it, and for live
  // channels, where the name is the whole point.
  const named = art && item.type !== "live";
  return `<article class="card ${wide ? "wide" : ""} ${rank ? "ranked" : ""} ${named ? "has-art" : ""}" data-id="${escapeHtml(item.id)}" title="${escapeHtml(item.name)}">${rank ? `<span class="rank">${rank}</span>` : ""}<div class="art ${opens}"${art ? "" : ` data-art-for="${escapeHtml(item.id)}"`}>${art ? `<img loading="lazy" src="${escapeHtml(art)}" onerror="this.remove()">` : ""}<div class="fallback">${escapeHtml(initials(item.name))}</div>${item.type === "live" ? '<span class="live">Live</span>' : ""}${(() => { const markup = scoreMarkup(item); return `<span class="score" data-score-for="${escapeHtml(item.id)}"${markup ? "" : " hidden"}>${markup}</span>` })()}<span class="play-bubble">${icon("play")}</span>${bar > 1 ? `<span class="resume-bar"><i style="width:${bar.toFixed(1)}%"></i></span>` : ""}</div><div class="card-copy"><div><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml([item.year, item.category].filter(Boolean).join(" • ") || item.type)}</p></div><button class="heart ${state.favorites.has(item.id) ? "saved" : ""}" title="My list">${icon(state.favorites.has(item.id) ? "heart-fill" : "heart")}</button></div></article>`;
}

function resumeCard(entry) {
  const { record, fresh } = entry;
  const bar = fresh ? 0 : percent(record);
  const left = fresh ? "Next episode" : record.duration > record.position ? `${clock(record.duration - record.position)} left` : "Ready";
  const target = entry.kind === "series" ? `data-show-play="${escapeHtml(entry.show.id)}"` : `data-resume="${escapeHtml(record.key)}"`;
  return `<article class="card wide" ${target}><div class="art play-resume">${record.poster ? `<img loading="lazy" src="${escapeHtml(record.poster)}" onerror="this.remove()">` : ""}<div class="fallback">${escapeHtml(initials(record.title))}</div><span class="play-bubble">${icon("play")}</span>${bar > 1 ? `<span class="resume-bar"><i style="width:${bar.toFixed(1)}%"></i></span>` : ""}</div><div class="card-copy"><div><h3>${escapeHtml(record.title)}</h3><p>${escapeHtml([record.subtitle, left].filter(Boolean).join(" \u2022 "))}</p></div><button class="forget" title="Remove from Continue watching">${icon("close")}</button></div></article>`;
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
  return `<section class="shelf"><div class="shelf-head"><div><h2>${escapeHtml(title)}</h2>${subtitle ? `<span>${escapeHtml(subtitle)}</span>` : ""}</div></div>${rail(`<div class="shelf-row rail-scroller ranked-row">${items.map((item, position) => card(item, false, position + 1)).join("")}</div>`)}</section>`;
}

function shelf(title, items, wide = false, subtitle = "") {
  if (!items.length) return "";
  return `<section class="shelf"><div class="shelf-head"><div><h2>${escapeHtml(title)}</h2>${subtitle ? `<span>${escapeHtml(subtitle)}</span>` : ""}</div></div>${rail(`<div class="shelf-row rail-scroller ${wide ? "wide" : ""}">${items.slice(0, 20).map((item) => card(item, wide)).join("")}</div>`)}</section>`;
}

function resumeShelf() {
  const records = continueWatching();
  if (!records.length) return "";
  return `<section class="shelf"><div class="shelf-head"><div><h2>Continue watching</h2><span>Pick up where you left off</span></div></div>${rail(`<div class="shelf-row rail-scroller wide">${records.slice(0, 20).map(resumeCard).join("")}</div>`)}</section>`;
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
  $("#content").innerHTML = `<section class="hero">${image ? `<img src="${escapeHtml(image)}">` : ""}<div class="hero-copy"><span class="eyebrow">${escapeHtml(featured.type === "series" ? "Series worth starting" : "Worth your evening")}</span><h1>${escapeHtml(meta?.title || featured.name)}</h1><div class="meta">${score ? `<span>${icon("star")}${escapeHtml(score)}</span>` : ""}${featured.year || meta?.year ? `<span>${escapeHtml(featured.year || meta.year)}</span>` : ""}${featured.category ? `<span>${escapeHtml(featured.category)}</span>` : ""}</div><p>${escapeHtml(meta?.overview || featured.description || "Ready to watch from your connected source.")}</p><div class="actions"><button class="primary play-featured" data-id="${escapeHtml(featured.id)}">${featured.type === "series" ? "View episodes" : `${icon("play")}Play`}</button><button class="secondary" id="play-something">${icon("shuffle")}Play something</button><button class="secondary favorite-featured" data-id="${escapeHtml(featured.id)}">${state.favorites.has(featured.id) ? `${icon("heart-fill")}Saved` : `${icon("heart")}My list`}</button></div></div></section>${resumeShelf()}${rankedShelf("Top 20 movies this week", state.trending?.movie, "Most watched worldwide, that you have")}${rankedShelf("Top 20 series this week", state.trending?.series, "")}${missing ? '<p class="row-note">None of this week\u2019s trending titles matched your library by name.</p>' : ""}${becauseYouWatched()}${shelf("Live now", ofType("live"), true, "Your channels")}${recentlyAdded("movie", "Recently added movies")}${recentlyAdded("series", "Recently added series")}${shelf("Highest rated films", ratedItems("movie"), false, "By rating")}${shelf("Highest rated series", ratedItems("series"), false, "By rating")}`;
  hydrateHero(featured);
}

function renderWelcome() {
  $("#content").innerHTML = `<section class="welcome"><div class="welcome-card"><div class="welcome-mark">${icon("play")}</div><h1>${TV ? "Your TV. Your channels." : "Your TV. Your Mac."}</h1><p>Connect your Xtream account to browse live channels, movies and series directly through your own internet connection.</p><button class="primary open-source">＋ Connect source</button></div></section>`;
}

/* ---------- history ----------
   Grouped the way people remember what they watched: by show, not by episode,
   and by when. A flat list put eight rows of the same series between you and
   the film you watched last Tuesday. */

function recencyGroup(time, now = new Date()) {
  const day = (value) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((day(now) - day(new Date(time))) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "Past week";
  if (days < 30) return "Past month";
  return "Earlier";
}

function whenLabel(time, now = new Date()) {
  const date = new Date(time), group = recencyGroup(time, now);
  const clockText = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (group === "Today") return clockText;
  if (group === "Yesterday") return `Yesterday, ${clockText}`;
  return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) });
}

function historyEntries() {
  const entries = historyShows().map((show) => ({ kind: "series", id: show.id, updatedAt: show.updatedAt, show }));
  for (const record of state.progress.values()) {
    if (record.type === "movie" || record.type === "live") entries.push({ kind: record.type, id: record.key, updatedAt: record.updatedAt, record });
  }
  return entries.sort((a, b) => b.updatedAt - a.updatedAt);
}

function historyArt(poster, title, playAttr, label) {
  return `<button class="history-art" ${playAttr} aria-label="${escapeHtml(label)}">${poster ? `<img loading="lazy" src="${escapeHtml(poster)}" alt="" onerror="this.remove()">` : ""}<span class="fallback">${escapeHtml(initials(title))}</span><span class="history-play">${icon("play")}</span></button>`;
}

function episodeStatus(record) {
  if (finished(record)) return "Watched";
  if (record.duration > 0 && record.position > 20) return `${clock(record.duration - record.position)} left`;
  return "Started";
}

function showRow(show) {
  const open = state.historyOpen.has(show.id), confirming = state.confirmForget === `show:${show.id}`;
  const latest = show.latest, next = show.upNext;
  const inLibrary = state.items.some((item) => item.id === show.id);
  const progress = next && !next.fresh ? percent(next.record) : 0;
  const status = [
    `${show.episodes.length} episode${show.episodes.length === 1 ? "" : "s"}${show.watched && show.watched !== show.episodes.length ? `, ${show.watched} finished` : ""}`,
    next ? (next.fresh ? `Up next ${next.record.subtitle.split(" \u2022 ")[0]}` : `${episodeStatus(next.record)} in ${next.record.subtitle.split(" \u2022 ")[0]}`) : "Caught up",
  ].join(" \u2022 ");
  const episodes = show.episodes.map((record) => `<div class="history-episode" data-resume="${escapeHtml(record.key)}"><span class="history-episode-title">${escapeHtml(record.subtitle || "")}</span><span class="history-episode-status ${finished(record) ? "done" : ""}">${escapeHtml(episodeStatus(record))}</span><time>${escapeHtml(whenLabel(record.updatedAt))}</time><button class="icon-btn forget-record" data-forget-key="${escapeHtml(record.key)}" title="Remove this episode from history">${icon("close")}</button></div>`).join("");
  return `<article class="history-item" data-kind="series">
    ${historyArt(show.poster, show.title, `data-show-play="${escapeHtml(show.id)}"`, next ? `Play ${show.title}` : `Open ${show.title}`)}
    <div class="history-copy" ${inLibrary ? `data-history-detail="${escapeHtml(show.id)}"` : ""}>
      <strong>${escapeHtml(show.title)}</strong>
      <small>Last watched ${escapeHtml(latest.subtitle || "")}</small>
      <span class="history-status">${escapeHtml(status)}</span>
      ${progress > 1 ? `<span class="history-bar"><i style="width:${progress.toFixed(1)}%"></i></span>` : ""}
    </div>
    <time>${escapeHtml(whenLabel(show.updatedAt))}</time>
    <div class="history-actions">
      <button class="icon-btn history-toggle ${open ? "open" : ""}" data-show-toggle="${escapeHtml(show.id)}" aria-expanded="${open}" title="${open ? "Hide" : "Show"} episodes">${icon("chev-right")}</button>
      ${confirming ? "" : `<button class="icon-btn danger" data-forget-show="${escapeHtml(show.id)}" title="Remove this show from history">${icon("close")}</button>`}
    </div>
    ${confirming ? `<div class="row-confirm"><p>Remove <b>${escapeHtml(show.title)}</b> from history? Its ${show.episodes.length} episode${show.episodes.length === 1 ? "" : "s"} lose their watched marks and resume points.</p><div><button class="secondary small danger" data-forget-show-confirm="${escapeHtml(show.id)}">Remove it</button><button class="secondary small" data-forget-cancel>Keep it</button></div></div>` : ""}
    ${open ? `<div class="history-episodes">${episodes}</div>` : ""}
  </article>`;
}

function recordRow(record) {
  const live = record.type === "live", bar = live ? 0 : percent(record);
  const inLibrary = !live && state.items.some((item) => item.id === record.id);
  const status = live ? "Live channel" : finished(record) ? "Finished \u2022 watch again" : underway(record) ? `${clock(Math.max(0, record.duration - record.position))} left` : "Started";
  return `<article class="history-item" data-kind="${escapeHtml(record.type)}">
    ${historyArt(record.poster, record.title, `data-resume="${escapeHtml(record.key)}"`, `Play ${record.title}`)}
    <div class="history-copy" ${inLibrary ? `data-history-detail="${escapeHtml(record.id)}"` : `data-resume="${escapeHtml(record.key)}"`}>
      <strong>${escapeHtml(record.title)}</strong>
      <small>${escapeHtml(live ? record.subtitle || "Channel" : record.subtitle || "Film")}</small>
      <span class="history-status ${finished(record) ? "done" : ""}">${escapeHtml(status)}</span>
      ${bar > 1 && !finished(record) ? `<span class="history-bar"><i style="width:${bar.toFixed(1)}%"></i></span>` : ""}
    </div>
    <time>${escapeHtml(whenLabel(record.updatedAt))}</time>
    <div class="history-actions"><button class="icon-btn danger" data-forget-key="${escapeHtml(record.key)}" title="Remove from history">${icon("close")}</button></div>
  </article>`;
}

function renderHistory() {
  const all = historyEntries();
  const counts = { series: 0, movie: 0, live: 0 };
  for (const entry of all) counts[entry.kind] += 1;
  if (state.historyFilter !== "all" && !counts[state.historyFilter]) state.historyFilter = "all";
  const entries = state.historyFilter === "all" ? all : all.filter((entry) => entry.kind === state.historyFilter);
  const episodeCount = [...state.progress.values()].filter((record) => record.type === "episode").length;
  const summary = [
    counts.series && `${counts.series} series (${episodeCount} episode${episodeCount === 1 ? "" : "s"})`,
    counts.movie && `${counts.movie} film${counts.movie === 1 ? "" : "s"}`,
    counts.live && `${counts.live} channel${counts.live === 1 ? "" : "s"}`,
  ].filter(Boolean).join(" \u00b7 ");
  const filters = [["all", "All", all.length], ["series", "Series", counts.series], ["movie", "Films", counts.movie], ["live", "Live", counts.live]]
    .filter(([key, , count]) => key === "all" || count)
    .map(([key, label, count]) => `<button class="chip ${state.historyFilter === key ? "active" : ""}" data-history-filter="${key}">${label} <span>${count}</span></button>`).join("");

  let body = "", group = "";
  for (const entry of entries) {
    const heading = recencyGroup(entry.updatedAt);
    if (heading !== group) { body += `${group ? "</div>" : ""}<h2 class="history-group">${heading}</h2><div class="history-list">`; group = heading }
    body += entry.kind === "series" ? showRow(entry.show) : recordRow(entry.record);
  }
  if (group) body += "</div>";

  const clearing = state.confirmForget === "all";
  const clear = clearing
    ? `<div class="row-confirm history-clear"><p>Clear all watch history? Every watched mark and resume point ${account.user ? "on every device signed in to your account" : `on ${DEVICE}`} is removed, and Continue watching empties.</p><div><button class="secondary small danger" data-clear-history-confirm>Clear everything</button><button class="secondary small" data-forget-cancel>Keep it</button></div></div>`
    : '<div class="load-more"><button class="secondary" id="clear-history">Clear watch history</button></div>';

  $("#content").innerHTML = `<section class="page"><div class="page-title"><div><span class="eyebrow">${escapeHtml(state.provider?.name || "Local library")}</span><h1>History</h1></div><span>${escapeHtml(summary)}</span></div>${all.length ? `<div class="chips history-filters">${filters}</div>${body}${clear}` : '<div class="empty"><div><h2>Nothing watched yet</h2><p>Films, episodes and channels you play show up here, grouped by show.</p></div></div>'}</section>`;
}

function renderSettings() {
  const list = readSources(), active = activeSourceId(), keys = apiKeys(), choice = themeChoice();
  const rows = list.map((source) => {
    const current = source.id === active;
    const confirming = state.confirmRemove === source.id;
    // the login has to be readable somewhere: it is needed to set the same
    // provider up on another device, and nothing else in Aurora ever shows it
    const shown = state.revealSource === source.id;
    return `<div class="source-row ${current ? "current" : ""}">
      <span class="source-icon">${icon("source")}</span>
      <div class="source-meta">
        <input class="rename" value="${escapeHtml(source.name)}" data-rename="${escapeHtml(source.id)}" aria-label="Source name" spellcheck="false" />
        <small>${escapeHtml(String(source.server || "").replace(/^https?:\/\//, ""))} · ${escapeHtml(source.username || "")} · ${(source.count || 0).toLocaleString()} items</small>
      </div>
      <div class="row-actions">
        ${current ? '<span class="tag">In use</span>' : `<button class="secondary small" data-use="${escapeHtml(source.id)}">Use</button>`}
        <button class="secondary small" data-test="${escapeHtml(source.id)}">Test</button>
        <button class="icon-btn" data-show-login="${escapeHtml(source.id)}" aria-pressed="${shown}" title="${shown ? "Hide login" : "Show login"}">${icon(shown ? "eye-off" : "eye")}</button>
        <button class="icon-btn" data-refresh="${escapeHtml(source.id)}" title="Reload this library">${icon("refresh")}</button>
        ${confirming ? "" : `<button class="icon-btn danger" data-remove="${escapeHtml(source.id)}" title="Remove source">${icon("close")}</button>`}
      </div>
      ${shown ? `<div class="row-login"><div><small>Server</small><code>${escapeHtml(source.server || "")}</code></div><div><small>Username</small><code>${escapeHtml(source.username || "")}</code></div><div><small>Password</small><code>${escapeHtml(source.password || "")}</code></div><p>Use these to add the same provider on another device. They are stored encrypted on ${DEVICE} and shown only here.</p></div>` : ""}
      <p class="row-status" data-status-for="${escapeHtml(source.id)}"></p>
      ${confirming ? `<div class="row-confirm"><p>Remove <b>${escapeHtml(source.name)}</b>? Its cached library of ${(source.count || 0).toLocaleString()} item${source.count === 1 ? "" : "s"} and any artwork are deleted from ${DEVICE}. Your account with the provider is untouched.</p><div><button class="secondary small danger" data-remove-confirm="${escapeHtml(source.id)}">Remove it</button><button class="secondary small" data-remove-cancel>Keep it</button></div></div>` : ""}
    </div>`;
  }).join("");

  $("#content").innerHTML = `<section class="page settings">
    <div class="page-title"><div><span class="eyebrow">Aurora</span><h1>Settings</h1></div></div>

    ${accountPanel()}

    <section class="panel">
      <header><h2>Sources</h2><p>Xtream accounts. The one in use supplies the library you browse; the others keep their own cached copy.</p></header>
      ${rows || '<p class="panel-empty">No source yet. Add one to load a library.</p>'}
      <div class="panel-foot">
        <button class="primary small open-source">${icon("plus")}Add a source</button>
        <small>M3U playlists are not supported yet — Xtream accounts only.</small>
      </div>
    </section>

    <section class="panel">
      <header><h2>Appearance</h2><p>Auto follows ${IOS ? "iOS" : ANDROID ? "Android" : "macOS"}.</p></header>
      <div class="theme-switch wide">
        ${["system", "light", "dark"].map((value) => `<button data-theme-choice="${value}" class="${choice === value ? "active" : ""}">${value === "system" ? "Auto" : value[0].toUpperCase() + value.slice(1)}</button>`).join("")}
      </div>
    </section>

    <section class="panel">
      <header><h2>Artwork and ratings</h2><p>Posters, backdrops, cast and trailers come from TMDB. IMDb and Rotten Tomatoes scores need an OMDb key as well. Both are free, and both stay on ${DEVICE}.</p></header>
      <form id="keys-form" class="keys">
        <label>TMDB API key<span class="field"><input id="tmdb-key" type="password" value="${escapeHtml(keys.tmdb || "")}" spellcheck="false" autocomplete="off" autocapitalize="off" autocorrect="off" placeholder="Required for artwork" /><button type="button" class="icon-btn" data-reveal="tmdb-key" aria-pressed="false" title="Show">${icon("eye")}</button></span>${keys.tmdb ? `<small>${secrets?.tmdb ? `Saved as ${escapeHtml(fingerprint(keys.tmdb))}` : "Built into this build — save your own to replace it"}</small>` : ""}</label>
        <label>OMDb API key<span class="field"><input id="omdb-key" type="password" value="${escapeHtml(keys.omdb || "")}" spellcheck="false" autocomplete="off" autocapitalize="off" autocorrect="off" placeholder="Optional — IMDb and Rotten Tomatoes" /><button type="button" class="icon-btn" data-reveal="omdb-key" aria-pressed="false" title="Show">${icon("eye")}</button></span>${keys.omdb ? `<small>${secrets?.omdb ? `Saved as ${escapeHtml(fingerprint(keys.omdb))}` : "Built into this build — save your own to replace it"}</small>` : ""}</label>
        <button class="primary small" type="submit">Save keys</button>
        <small class="keys-note">${NATIVE ? `Stored in this app's storage on ${DEVICE}, not in the app you downloaded.` : "Stored in this Mac's keychain, not in the app you downloaded."}</small>
      </form>
    </section>

    <section class="panel">
      <header><h2>About</h2></header>
      <div class="about">
        <span class="version">Aurora <b id="app-version">${escapeHtml(state.appVersion || "")}</b></span>
        ${window.aurora && !NATIVE ? `<button class="secondary small" id="check-updates"><i id="update-check-icon">${icon("refresh")}</i><span id="update-check-label">Check for updates</span></button>` : ""}
        <a class="secondary small" href="https://github.com/callsavvys/aurora-iptv" target="_blank" rel="noreferrer">Source on GitHub</a>
      </div>
    </section>
  </section>`;
}

const SCOPES = [["all", "Everything"], ["live", "Channels"], ["movie", "Films"], ["series", "Series"]];
const TYPE_LABEL = { live: "Channels", movie: "Films", series: "Series" };

function renderSearch() {
  const ranked = searchLibrary(state.query);
  const scope = state.searchScope || "all";
  const counts = { all: ranked.length, live: 0, movie: 0, series: 0 };
  for (const entry of ranked) counts[entry.item.type] = (counts[entry.item.type] || 0) + 1;

  if (!ranked.length) {
    $("#content").innerHTML = `<section class="page"><div class="page-title"><div><span class="eyebrow">Search</span><h1>No match for “${escapeHtml(state.query)}”</h1></div></div><div class="empty"><div><h2>Nothing in this library matches that</h2><p>Check the spelling, try fewer words, or search for the channel or studio name instead.</p><button class="secondary" id="clear-search">Clear search</button></div></div></section>`;
    return;
  }

  const chips = SCOPES.filter(([key]) => key === "all" || counts[key])
    .map(([key, label]) => `<button class="chip ${scope === key ? "active" : ""}" data-scope="${key}">${escapeHtml(label)}<em>${counts[key].toLocaleString()}</em></button>`).join("");

  const best = ranked[0];
  const showBest = scope === "all" && best.tier <= 1;
  const bestBlock = showBest
    ? `<section class="best-match"><span class="eyebrow">Best match</span><div class="best-row">${card(best.item, best.item.type === "live")}<div class="best-copy"><h2>${escapeHtml(metaCache.get(best.item.id)?.title || best.item.name)}</h2><p>${escapeHtml([TYPE_LABEL[best.item.type], best.item.category, best.item.year].filter(Boolean).join(" · "))}</p><small>${escapeHtml(TIERS[best.tier])} on the title</small></div></div></section>`
    : "";

  let body;
  if (scope === "all") {
    const groups = ["live", "movie", "series"].map((type) => {
      const trimmed = ranked
        .filter((entry) => entry.item.type === type && !(showBest && entry.item.id === best.item.id))
        .slice(0, 12);
      if (!trimmed.length) return "";
      return `<section class="shelf"><div class="shelf-head"><div><h2>${TYPE_LABEL[type]}</h2><span>${counts[type].toLocaleString()} found</span></div>${counts[type] > trimmed.length ? `<button data-scope="${type}">Show all</button>` : ""}</div>${rail(`<div class="shelf-row rail-scroller ${type === "live" ? "wide" : ""}">${trimmed.map((entry) => card(entry.item, type === "live")).join("")}</div>`)}</section>`;
    }).join("");
    body = groups;
  } else {
    const list = ranked.filter((entry) => entry.item.type === scope);
    body = gridMarkup();
  }

  $("#content").innerHTML = `<section class="page"><div class="page-title"><div><span class="eyebrow">Search</span><h1>“${escapeHtml(state.query)}”</h1></div><span>${ranked.length.toLocaleString()} result${ranked.length === 1 ? "" : "s"}</span></div><div class="rail chips-rail"><button class="rail-nav prev" aria-label="Scroll left" disabled>${icon("chev-left")}</button><div class="chips rail-scroller">${chips}</div><button class="rail-nav next" aria-label="Scroll right" disabled>${icon("chev-right")}</button></div>${bestBlock}${body}</section>`;
  updateRails();
  if (scope === "all") grid = null;
  else mountGrid(ranked.filter((entry) => entry.item.type === scope).map((entry) => entry.item), scope === "live");
  watchArtwork();
}

/* ---------- the guide ----------
   Channels down, time across, a line on the current moment. Pure CSS sticky
   for both axes, so there is no scroll syncing to get wrong. */

const PX_PER_MIN = 5;
const GUIDE_HOURS = 8;
const GUIDE_CHANNELS = 60;

const halfHourFloor = (at) => Math.floor(at / 1800000) * 1800000;
const clockTime = (at) => new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });

function renderGuide() {
  const base = itemsForView(true);
  const categories = ["All", ...new Set(base.map((item) => item.category).filter(Boolean))];
  const channels = itemsForView().slice(0, state.limit);
  const windowStart = halfHourFloor(Date.now()) - 1800000;
  const windowEnd = windowStart + GUIDE_HOURS * 3600000;
  const width = ((windowEnd - windowStart) / 60000) * PX_PER_MIN;

  const ticks = [];
  for (let at = windowStart; at < windowEnd; at += 1800000) {
    ticks.push(`<i style="left:${((at - windowStart) / 60000) * PX_PER_MIN}px">${escapeHtml(clockTime(at))}</i>`);
  }

  const rows = channels.map((item) => `<div class="guide-row" data-guide-for="${escapeHtml(item.id)}">
      <div class="guide-channel"><span class="guide-logo">${item.logo ? `<img loading="lazy" src="${escapeHtml(item.logo)}" onerror="this.remove()">` : ""}<b>${escapeHtml(initials(item.name))}</b></span><span class="guide-name">${escapeHtml(item.name)}</span></div>
      <div class="guide-progs" style="width:${width}px"><span class="prog loading"><span>Loading guide…</span></span></div>
    </div>`).join("");

  const total = itemsForView().length;
  $("#content").innerHTML = `<section class="page guide-page">
    <div class="page-title">
      <div><span class="eyebrow">${escapeHtml(state.provider?.name || "Live TV")}</span><h1>Guide</h1></div>
      <div class="seg"><button data-live-mode="guide" class="active">Guide</button><button data-live-mode="grid">Channels</button></div>
    </div>
    <div class="rail chips-rail"><button class="rail-nav prev" aria-label="Scroll left" disabled>${icon("chev-left")}</button><div class="chips rail-scroller">${categories.slice(0, 80).map((name) => `<button class="chip ${state.category === name ? "active" : ""}" data-category="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join("")}</div><button class="rail-nav next" aria-label="Scroll right" disabled>${icon("chev-right")}</button></div>
    <p class="guide-note" id="guide-note" hidden></p>
    <div class="guide" id="guide">
      <div class="guide-inner" style="--track:${width}px">
        <div class="guide-times"><div class="guide-corner"><button class="chip" id="guide-now">Now</button></div><div class="guide-ticks" style="width:${width}px">${ticks.join("")}</div></div>
        <div class="guide-rows">${rows || '<p class="panel-empty">No channels in this category.</p>'}</div>
        <span class="now-line" id="now-line"></span>
      </div>
    </div>
    ${total > state.limit ? `<div class="load-more"><button class="secondary" id="load-more">Show 60 more · ${(total - state.limit).toLocaleString()} remaining</button></div>` : ""}
  </section>`;

  guideWindow = { start: windowStart, end: windowEnd, width };
  guideCounts = { seen: 0, total: channels.length };
  positionNow();
  updateRails();
  for (const node of document.querySelectorAll(".guide-row[data-guide-for]")) paintGuideRow(node);
  scrollGuideToNow();
}

let guideWindow = null;
let guideCounts = null;

function guideTally(reason) {
  if (!guideCounts) return;
  guideCounts[reason] = (guideCounts[reason] || 0) + 1;
  guideCounts.seen += 1;
  clearTimeout(guideTally.timer);
  guideTally.timer = setTimeout(showGuideVerdict, 400);
}

function showGuideVerdict() {
  const note = $("#guide-note");
  if (!note || !guideCounts || guideCounts.seen < guideCounts.total) return;
  const { ok = 0, empty = 0, failed = 0, unreadable = 0, total } = guideCounts;
  if (ok) { note.hidden = true; return }
  note.hidden = false;
  if (unreadable) note.innerHTML = `All ${total} channels returned listings Aurora could not read. That is a bug on my side, not your provider's — tell me and I will fix the parsing.`;
  else if (failed) note.innerHTML = `The guide request failed for ${failed} of ${total} channels. Check the source is reachable under Settings, then reload the library.`;
  else note.innerHTML = `Your provider returned no guide for any of these ${total} channels. Many lines only carry EPG for some categories — try another category above. If none have it, the line simply does not supply a guide.`;
}

function positionNow() {
  const line = $("#now-line");
  if (!line || !guideWindow) return;
  const offset = ((Date.now() - guideWindow.start) / 60000) * PX_PER_MIN;
  const inside = offset >= 0 && offset <= guideWindow.width;
  line.hidden = !inside;
  line.style.left = `${offset}px`;
}

function scrollGuideToNow() {
  const guide = $("#guide");
  if (!guide || !guideWindow) return;
  guide.scrollLeft = Math.max(0, ((Date.now() - guideWindow.start) / 60000) * PX_PER_MIN - 120);
}

const EPG_REASON = {
  empty: "Provider has no guide for this channel",
  failed: "Guide request failed",
  unreadable: "Guide arrived in a format Aurora could not read",
  ok: "Nothing scheduled in this window",
};

async function paintGuideRow(node) {
  const item = state.items.find((entry) => entry.id === node.dataset.guideFor);
  if (!item) return;
  const record = await epgFor(item).catch(() => ({ list: [], reason: "failed" }));
  const track = node.querySelector(".guide-progs");
  if (!node.isConnected || !track || !guideWindow) return;
  guideTally(record.reason);
  const { start, end } = guideWindow;
  const visible = (record.list || []).filter((programme) => programme.end > start && programme.start < end);
  if (!visible.length) { track.innerHTML = `<span class="prog blank"><span>${escapeHtml(EPG_REASON[record.reason] || EPG_REASON.empty)}</span></span>`; return }
  track.innerHTML = visible.map((programme) => {
    const left = Math.max(0, ((programme.start - start) / 60000) * PX_PER_MIN);
    const right = Math.min(guideWindow.width, ((programme.end - start) / 60000) * PX_PER_MIN);
    const live = programme.start <= Date.now() && programme.end > Date.now();
    return `<button class="prog ${live ? "on-air" : ""}" style="left:${left}px;width:${Math.max(2, right - left)}px" data-play="${escapeHtml(item.id)}" title="${escapeHtml(`${clockTime(programme.start)}–${clockTime(programme.end)}  ${programme.title}`)}"><b>${escapeHtml(programme.title)}</b><small>${escapeHtml(clockTime(programme.start))}</small></button>`;
  }).join("");
}

/* ---------- virtualised grid ----------
   The grid used to render 120 cards and offer a Show more button. At 101,102
   items that is a treadmill. Only the rows inside the viewport are in the DOM;
   the container is padded to full height so the scrollbar tells the truth. Row
   height is measured rather than assumed, because card height follows column
   width, which follows the window. */

const GRID_GAP = 24;
/* Rows outside this window are not in the DOM at all. A mouse does not care,
   but the D-pad aims at geometry and walks row by row, so a television keeps
   more of the grid alive than it strictly needs to see. */
const OVERSCAN = TV ? 4 : 2;
let grid = null;

const gridMarkup = () => '<div class="vgrid" id="vgrid"><div class="vgrid-inner" id="vgrid-inner"></div></div>';

function mountGrid(items, wide) {
  const host = $("#vgrid"), inner = $("#vgrid-inner");
  if (!host || !inner) { grid = null; return }
  grid = { items, wide, host, inner, rowHeight: 0, columns: 0, from: -1, to: -1 };
  inner.classList.toggle("wide", Boolean(wide));
  measureGrid();
}

function measureGrid() {
  if (!grid || !grid.inner.isConnected) return;
  const { inner, items } = grid;
  inner.style.transform = "translateY(0px)";
  inner.innerHTML = items.slice(0, 12).map((item) => card(item, grid.wide)).join("");
  const columns = getComputedStyle(inner).gridTemplateColumns.split(" ").filter(Boolean).length || 1;
  const first = inner.firstElementChild;
  grid.columns = columns;
  grid.rowHeight = (first ? first.getBoundingClientRect().height : 240) + GRID_GAP;
  grid.from = grid.to = -1;
  const rows = Math.ceil(items.length / columns);
  grid.host.style.height = `${Math.max(0, rows * grid.rowHeight - GRID_GAP)}px`;
  paintGrid();
}

function paintGrid() {
  if (!grid || !grid.inner.isConnected || !grid.rowHeight) return;
  const { host, inner, items, columns, rowHeight } = grid;
  const scroller = $("#content");
  const top = host.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  const firstRow = Math.max(0, Math.floor((scroller.scrollTop - top) / rowHeight) - OVERSCAN);
  const rows = Math.ceil(scroller.clientHeight / rowHeight) + OVERSCAN * 2;
  const from = firstRow * columns;
  const to = Math.min(items.length, from + rows * columns);
  if (grid.from === from && grid.to === to) return;
  grid.from = from; grid.to = to;
  inner.style.transform = `translateY(${firstRow * rowHeight}px)`;
  inner.innerHTML = items.slice(from, to).map((item) => card(item, grid.wide)).join("");
  watchArtwork();
}

function renderCollection() {
  if (state.view === "live" && state.liveMode !== "grid") return renderGuide();
  const base = itemsForView(true), categories = ["All", ...new Set(base.map((item) => item.category).filter(Boolean))], items = itemsForView();
  $("#content").innerHTML = `<section class="page"><div class="page-title"><div><span class="eyebrow">${escapeHtml(state.provider?.name || "Local library")}</span><h1>${state.query ? "Search results" : views[state.view]}</h1></div><span>${items.length.toLocaleString()} items</span></div><div class="rail chips-rail"><button class="rail-nav prev" aria-label="Scroll left" disabled>${icon("chev-left")}</button><div class="chips rail-scroller">${categories.slice(0, 80).map((name) => `<button class="chip ${state.category === name ? "active" : ""}" data-category="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join("")}</div><button class="rail-nav next" aria-label="Scroll right" disabled>${icon("chev-right")}</button></div>${items.length ? gridMarkup() : '<div class="empty"><div><h2>Nothing found</h2><p>Try another category or search.</p></div></div>'}</section>`;
  updateRails();
  if (items.length) mountGrid(items, state.view === "live"); else grid = null;
  watchArtwork();
}

function render() {
  if (state.view === "settings") renderSettings();
  else if (state.view === "together") renderTogether();
  else if (!state.provider || !state.items.length) renderWelcome();
  else if (state.view === "detail") renderDetailView();
  else if (state.query) renderSearch();
  else if (state.view === "history") renderHistory();
  else if (state.view === "together") renderTogether();
  else if (state.view === "home") renderHome();
  else renderCollection();
  document.querySelectorAll("nav button").forEach((button) => button.classList.toggle("active", !state.query && button.dataset.view === state.view));
  updateRails();
  watchArtwork();
  updateSource();
  $("#go-back").disabled = !canGoBack();
  $("#go-forward").disabled = !canGoForward();
  document.documentElement.classList.toggle("artwork-on", hasTmdb());
  if (state.view === "home" && !state.trending && hasTmdb() && state.items.length) { state.trending = { movie: [], series: [], of: 0 }; loadTrending() }
  if (render.lastView !== state.view) {
    const content = $("#content");
    content.classList.remove("enter");
    void content.offsetWidth;
    content.classList.add("enter");
    render.lastView = state.view;
  }
  syncHeader();
}

function playSomething() {
  if (!state.items.length) return showToast("Add a source first");
  const unfinished = continueWatching();
  if (unfinished.length && Math.random() < 0.35) {
    const entry = unfinished[Math.floor(Math.random() * Math.min(5, unfinished.length))];
    showToast(`Picking up ${entry.record.title}`);
    return playRecord(entry.record);
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
  writePref("favorites", [...state.favorites]);
  noteFavorite(item.id, state.favorites.has(item.id));
  if (state.view === "detail") renderDetail(); else render();
  updatePlayerFavorite();
  updateSource();
}

/* ---------- detail sheet ---------- */

function seriesSeasons(data = state.seriesData) {
  return Object.entries(data?.episodes || {})
    .filter(([, episodes]) => Array.isArray(episodes) && episodes.length)
    .sort(([a], [b]) => String(a).localeCompare(String(b), undefined, { numeric: true }));
}

const episodeTitle = (episode, index) => episode.title || episode.info?.name || `Episode ${episode.episode_num || episode.info?.episode_num || index + 1}`;
function shortDuration(info = {}) {
  let minutes = Number(info.duration_secs) > 0 ? Math.round(Number(info.duration_secs) / 60) : 0;
  if (!minutes && info.duration) {
    const parts = String(info.duration).split(":").map(Number);
    if (parts.length >= 2 && parts.every(Number.isFinite)) {
      const [hours, mins, secs = 0] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
      minutes = hours * 60 + mins + (secs >= 30 ? 1 : 0);
    } else return String(info.duration);
  }
  if (!minutes) return "";
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
}

const episodeNumber = (episode, index) => episode.episode_num || episode.info?.episode_num || index + 1;

function detailHero({ backdrop, poster, eyebrow, name, meta, description, actions }) {
  return `<section class="series-hero">${backdrop ? `<img class="series-backdrop" src="${escapeHtml(backdrop)}" onerror="this.remove()">` : ""}${poster ? `<img class="series-poster" src="${escapeHtml(poster)}" onerror="this.style.visibility='hidden'">` : '<div class="series-poster"></div>'}<div class="series-info"><span class="eyebrow">${escapeHtml(eyebrow)}</span><h2>${escapeHtml(name)}</h2><div class="series-meta">${meta.filter(Boolean).map((entry) => (entry.icon ? `<span>${icon(entry.icon)}${escapeHtml(entry.text)}</span>` : `<span>${escapeHtml(entry)}</span>`)).join("")}</div><p>${escapeHtml(description)}</p><div class="series-actions">${actions}</div></div></section>`;
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
    const duration = shortDuration(episode.info) || (episode.duration ? shortDuration({ duration: episode.duration }) : "") || "Ready to play";
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
  const actions = `<button class="primary detail-play">${underway(record) ? `${icon("play")}Resume • ${clock(record.duration - record.position)} left` : `${icon("play")}Play`}</button>${underway(record) ? '<button class="secondary detail-restart">Start over</button>' : ""}${trailerButton(meta)}<button class="secondary detail-favorite">${state.favorites.has(item.id) ? `${icon("heart-fill")}Saved` : `${icon("heart")}My list`}</button>`;
  $("#series-detail").innerHTML = detailHero({
    backdrop: artUrl(meta?.backdrop, "w1280") || backdropValue || item.backdrop || item.logo,
    poster: artUrl(meta?.poster, "w342") || info.movie_image || info.cover_big || item.logo,
    eyebrow: "Movie", name: state.detailMeta?.title || item.name,
    meta: [rating(info.rating || item.rating) ? { icon: "star", text: rating(info.rating || item.rating) } : "", String(info.releasedate || info.releaseDate || item.year || meta?.year || "").slice(0, 4), meta?.details?.runtime || shortDuration(info) || (item.duration ? shortDuration({ duration: item.duration }) : ""), item.category],
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

async function loadDetail(id) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item || loadDetail.current === id) return;
  loadDetail.current = id;
  state.seriesItem = null; state.seriesData = null; state.selectedSeason = null;
  state.detailItem = null; state.detailData = null; state.detailMeta = null;

  if (item.type === "series") {
    try {
      setLoading(true, "Loading episodes", metaCache.get(item.id)?.title || item.name);
      const data = await fetchJson(apiUrl("get_series_info", `&series_id=${item.streamId}`));
      if (!seriesHasEpisodes(data)) throw new Error("No episodes were returned for this series");
      if (state.detailId !== id) return;
      state.seriesItem = item; state.seriesData = data;
    } catch (error) {
      showToast(error.message || "Could not load this series");
      state.detailItem = item;
    } finally { setLoading(false) }
  } else {
    state.detailItem = item;
  }
  if (state.detailId !== id) return;
  renderDetail();
  hydrateDetail(item);
  if (item.type === "movie") {
    try {
      const data = await fetchJson(apiUrl("get_vod_info", `&vod_id=${item.streamId}`));
      if (state.detailId === id) { state.detailData = data; renderDetail() }
    } catch { /* the library already gave us enough to show */ }
  }
}

function openDetail(item) {
  if (!item) return;
  if (item.type === "live") return play(item);
  navigate({ view: "detail", detailId: item.id, query: "" });
}

function renderDetailView() {
  const item = state.items.find((entry) => entry.id === state.detailId);
  if (!item) return renderWelcome();
  $("#content").innerHTML = '<section class="detail-page"><div id="series-detail"></div></section>';
  if (state.seriesItem?.id === item.id || state.detailItem?.id === item.id) renderDetail();
  else {
    $("#series-detail").innerHTML = `<section class="series-hero"><div class="series-poster"></div><div class="series-info"><span class="eyebrow">${escapeHtml(item.type === "series" ? "Series" : "Movie")}</span><h2>${escapeHtml(metaCache.get(item.id)?.title || item.name)}</h2></div></section>`;
    loadDetail(item.id);
  }
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
  clearLoadedSubtitle(); // it belonged to the last file, not this one
  video.removeAttribute("src"); video.load();
  video.playbackRate = Number($("#playback-rate").value) || 1; // survives into the next episode
  startPlayback.resumeAt = resumeAt;
  // iOS plays HLS natively and fetching segments through the HTTP bridge would
  // be far slower, so hls.js is a desktop-only path
  // iOS plays HLS natively and better; every other WebView, Android's included, needs hls.js
  if (isLive && !IOS && Hls.isSupported()) {
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
  // carry every season along, so the next episode after a finale is the next
  // season's first rather than nothing at all
  const seasons = (state.queue?.item?.id === item.id && state.queue.seasons)
    || (state.seriesItem?.id === item.id ? seriesSeasons() : null);
  state.queue = { item, season: String(season), episodes, index, seasons };
  startPlayback({
    url: `${server}/series/${user}/${pass}/${episode.id}.${episode.container_extension || "mp4"}`,
    title: `${item.name} • S${season} E${number}`, subtitle: title,
    resumeAt: saved && !finished(saved) ? saved.position : 0,
    record: { key, id: item.id, type: "episode", title: item.name, subtitle: `S${season} E${number} • ${title}`, poster: item.logo, seriesId: item.streamId, season: String(season), episodeId: episode.id, container: episode.container_extension || "mp4", next: nextHint(state.queue) },
  });
}

function playSeriesEpisode(index) {
  const item = state.seriesItem, episodes = seriesSeasons().find(([number]) => number === state.selectedSeason)?.[1] || [];
  if (!item || !episodes[index]) return;
  playEpisode(item, state.selectedSeason, episodes, index);
}

const resumeRecord = (key) => playRecord(progressOf(key));

function playRecord(record) {
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
    resumeAt: finished(record) ? 0 : record.position || 0,
    record: { ...record },
  });
  loadQueueForEpisode(item, record);
}

async function loadQueueForEpisode(item, record) {
  if (!item?.streamId) return;
  try {
    const data = await fetchJson(apiUrl("get_series_info", `&series_id=${item.streamId}`));
    // the viewer may have moved on while this was loading; a late queue would
    // attach another show's episodes to whatever is playing now
    if (state.playing?.key !== record.key) return;
    const seasons = seriesSeasons(data);
    const episodes = seasons.find(([number]) => String(number) === String(record.season))?.[1] || [];
    const index = episodes.findIndex((episode) => String(episode.id) === String(record.episodeId));
    if (index < 0) return;
    state.queue = { item, season: String(record.season), episodes, index, seasons };
    state.playing.next = nextHint(state.queue);
    updatePlayerNav();
  } catch { /* next-episode navigation stays hidden */ }
}

/* The episode `delta` away from the one playing, crossing into the neighbouring
   season when this one runs out. Stopping at the season boundary meant a
   finale ended in silence: no up-next card, no auto-advance, N did nothing. */
function episodeAt(queue, delta) {
  if (!queue || !delta) return null;
  const index = queue.index + delta;
  if (index >= 0 && index < queue.episodes.length) return { season: queue.season, episodes: queue.episodes, index };
  const seasons = queue.seasons || [];
  const at = seasons.findIndex(([number]) => String(number) === String(queue.season));
  const neighbour = at < 0 ? null : seasons[at + Math.sign(delta)];
  if (!neighbour?.[1]?.length) return null;
  return { season: String(neighbour[0]), episodes: neighbour[1], index: delta > 0 ? 0 : neighbour[1].length - 1 };
}

function stepEpisode(delta) {
  const queue = state.queue, target = episodeAt(queue, delta);
  if (!target) return;
  playEpisode(queue.item, target.season, target.episodes, target.index);
}

function updatePlayerNav() {
  const queue = state.queue;
  $("#player-prev").hidden = !episodeAt(queue, -1);
  $("#player-next").hidden = !episodeAt(queue, 1);
  $("#player-episodes").hidden = !queue;
  if (!queue) closeEpisodesPanel();
  else if (!$("#episodes-panel").classList.contains("hidden")) renderEpisodesPanel();
}

/* ---------- episodes panel ---------- */

let panelSeason = null;

const panelOpen = () => !$("#episodes-panel").classList.contains("hidden");

function openEpisodesPanel() {
  if (!state.queue) return;
  panelSeason = state.queue.season;
  renderEpisodesPanel();
  $("#episodes-panel").classList.remove("hidden");
  wakeChrome();
  $("#episodes-list .playing")?.scrollIntoView({ block: "center" });
}

function closeEpisodesPanel() {
  const panel = $("#episodes-panel");
  if (panel.classList.contains("hidden")) return;
  panel.classList.add("hidden");
  wakeChrome();
}

const toggleEpisodesPanel = () => (panelOpen() ? closeEpisodesPanel() : openEpisodesPanel());

function panelSeasons() {
  const queue = state.queue;
  return queue.seasons?.length ? queue.seasons : [[queue.season, queue.episodes]];
}

function renderEpisodesPanel() {
  const queue = state.queue;
  if (!queue) return;
  const seasons = panelSeasons();
  if (!seasons.some(([number]) => String(number) === String(panelSeason))) panelSeason = queue.season;
  const episodes = seasons.find(([number]) => String(number) === String(panelSeason))?.[1] || [];
  $("#episodes-series").textContent = metaCache.get(queue.item.id)?.title || queue.item.name || "";
  $("#episodes-season").innerHTML = seasons.map(([number]) => `<option value="${escapeHtml(number)}" ${String(number) === String(panelSeason) ? "selected" : ""}>Season ${escapeHtml(number)}</option>`).join("");
  $("#episodes-season-wrap").hidden = seasons.length < 2;
  $("#episodes-list").innerHTML = episodes.map((episode, index) => {
    const playing = String(panelSeason) === String(queue.season) && index === queue.index;
    const record = progressOf(`episode-${episode.id}`), bar = percent(record);
    const number = episodeNumber(episode, index), title = episodeTitle(episode, index);
    // "Episode 4" already carries its number; "4. Episode 4" reads as a stutter
    const label = /^episode\s+\d+$/i.test(title) ? title : `${number}. ${title}`;
    const still = episode.info?.movie_image || episode.info?.cover_big || "";
    const plot = episode.info?.plot || episode.info?.overview || "";
    const duration = shortDuration(episode.info);
    const status = finished(record) ? "Watched" : record && bar > 1 ? `${clock(record.duration - record.position)} left` : "";
    return `<button class="panel-episode ${playing ? "playing" : ""} ${finished(record) ? "watched" : ""}" data-panel-index="${index}"><span class="panel-still">${still ? `<img loading="lazy" src="${escapeHtml(still)}" alt="" onerror="this.remove()">` : ""}<span class="panel-num">${escapeHtml(number)}</span>${playing ? '<span class="panel-now">Now playing</span>' : ""}${bar > 1 && !finished(record) ? `<span class="panel-bar"><i style="width:${bar.toFixed(1)}%"></i></span>` : ""}</span><span class="panel-copy"><strong>${escapeHtml(label)}</strong><small>${escapeHtml([duration, status].filter(Boolean).join(" \u2022 ") || `Season ${panelSeason}`)}</small>${plot ? `<p>${escapeHtml(plot)}</p>` : ""}</span></button>`;
  }).join("") || '<p class="episodes-empty">No episodes were returned for this season.</p>';
}

function pickPanelEpisode(index) {
  const queue = state.queue;
  if (!queue) return;
  const episodes = panelSeasons().find(([number]) => String(number) === String(panelSeason))?.[1] || [];
  closeEpisodesPanel();
  if (String(panelSeason) === String(queue.season) && index === queue.index) return; // already watching it
  playEpisode(queue.item, panelSeason, episodes, index);
}

/* Two independent sources of subtitles — the ones inside the manifest and any
   file the viewer loaded onto the element — share one menu, so the values are
   namespaced. Plain indices collided: picking "1" could mean either. */
function refreshTrackMenus() {
  const video = $("#video");
  const audio = state.hls ? state.hls.audioTracks.map((track, index) => ({ value: String(index), label: track.name || track.lang || `Audio ${index + 1}` })) : [];
  const subtitles = [{ value: "off", label: "Off" }];
  if (state.hls) state.hls.subtitleTracks.forEach((track, index) => subtitles.push({ value: `hls:${index}`, label: track.name || track.lang || `Subtitle ${index + 1}` }));
  [...video.textTracks].forEach((track, index) => subtitles.push({ value: `el:${index}`, label: track.label || track.language || `Subtitle ${index + 1}` }));
  // one track is the common case; requiring two meant most streams looked like
  // they had no subtitles at all
  subtitles.push({ value: "file", label: "Load subtitle file\u2026" });
  fillSelect($("#audio-track"), audio, String(state.hls ? state.hls.audioTrack : -1));
  fillSelect($("#subtitle-track"), subtitles, currentSubtitleValue());
  $("#audio-wrap").hidden = audio.length < 2;
  // a live channel with nothing to offer gets no menu; loading a file onto a live feed is not a real use
  $("#subtitle-wrap").hidden = liveStream() && subtitles.length <= 2;
}

function currentSubtitleValue() {
  const showing = [...$("#video").textTracks].findIndex((track) => track.mode === "showing");
  if (showing >= 0) return `el:${showing}`;
  if (state.hls && state.hls.subtitleTrack >= 0) return `hls:${state.hls.subtitleTrack}`;
  return "off";
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
    if (party.id) leaveParty();
    closeEpisodesPanel();
    if (state.view === "home" || state.view === "history") render();
  }
}

/* Escape on a Mac, Back on a TV remote and Android's own back button are the
   same gesture: shut the frontmost thing. It reports whether it found anything
   to shut, because the Android shell has to know when back means "leave".
   The system back walks the whole history; Escape keeps to its old habit of
   only stepping out of a detail page. */
function handleBack(fromSystem = false) {
  if (!$("#shortcuts").classList.contains("hidden")) { $("#shortcuts").classList.add("hidden"); return true }
  if (!$("#player-modal").classList.contains("hidden") && panelOpen()) { closeEpisodesPanel(); return true }
  if (!$("#up-next").classList.contains("hidden")) { upNextDismissed = true; $("#up-next").classList.add("hidden"); return true }
  for (const id of ["player-modal", "source-modal"]) {
    if (!$("#" + id).classList.contains("hidden")) { closeModal(id); return true }
  }
  if ((fromSystem || state.view === "detail") && canGoBack()) { step(-1); return true }
  return false;
}

window.aurora?.onBack?.(() => handleBack(true));

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
  // a new source can reset the rate back to 1, so it is reapplied once the
  // media is actually there rather than only before it loads
  const chosen = Number($("#playback-rate").value) || 1;
  if (video.playbackRate !== chosen) video.playbackRate = chosen;
  $("#rate-wrap").hidden = liveStream(); // speed means nothing on a live feed
  refreshTrackMenus();
});
video.addEventListener("timeupdate", () => recordPosition());
video.addEventListener("pause", () => recordPosition(true));
/* A stream that could not play left a black screen and nothing else — no
   message, no reason. hls.js reports its own failures; this covers everything
   the video element plays directly, which on iPhone is every stream. */
$("#video-message").addEventListener("click", () => wakeChrome());

video.addEventListener("error", () => {
  if (state.hls || !state.playing || !video.getAttribute("src")) return; // not ours, or the src was just cleared
  const ext = String(state.playing.container || state.playerItem?.ext || "").toLowerCase();
  const mkv = ext === "mkv" || /\.mkv(\?|$)/i.test(video.currentSrc || "");
  const text = NATIVE && mkv
    ? `This film is an MKV file, which ${DEVICE} cannot play. It plays in Aurora on a Mac.`
    : video.error?.code === 4
      ? "This stream is in a format this device cannot play."
      : state.playing.type === "live"
        ? "This channel could not be played. Close any other IPTV player because your account allows only one connection."
        : "This could not be played. The provider may be busy, or your account may allow only one connection at a time.";
  const message = $("#video-message");
  message.textContent = text;
  message.classList.remove("hidden");
  $("#buffering").classList.add("hidden");
  wakeChrome();
});

video.addEventListener("ended", () => {
  recordPosition(true);
  const target = episodeAt(state.queue, 1);
  if (target) { showToast(target.season === state.queue.season ? "Playing the next episode…" : `Starting season ${target.season}…`); stepEpisode(1) }
});

document.addEventListener("click", (event) => {
  const target = event.target;
  const close = target.closest("[data-close]"); if (close) return closeModal(close.dataset.close);

  const joinBtn = target.closest("[data-join-party]");
  if (joinBtn) { $("#party-invite").classList.add("hidden"); return joinParty(joinBtn.dataset.joinParty) }
  if (target.closest("[data-dismiss-invite]")) return $("#party-invite").classList.add("hidden");
  const shift = target.closest("[data-party-nudge]");
  if (shift) return nudgeParty(Number(shift.dataset.partyNudge));
  if (target.closest("[data-party-leave]")) return leaveParty();
  const pick = target.closest("[data-pick-friend]");
  if (pick) return pickFriend(pick.dataset.pickFriend);
  const accept = target.closest("[data-accept-friend]");
  if (accept) return acceptFriend(accept.dataset.acceptFriend).then(renderTogether);
  const drop = target.closest("[data-remove-friend]");
  if (drop) return removeFriend(drop.dataset.removeFriend).then(() => { social.picking = null; renderTogether() });
  const invite = target.closest("[data-invite-item]");
  if (invite) return startParty(state.items.find((item) => item.id === invite.dataset.inviteItem), invite.dataset.inviteFriend);
  if (target.closest("[data-rename-me]")) { social.renaming = true; return renderTogether() }
  const saveName = target.closest("[data-save-name]");
  if (saveName) {
    const value = $("#my-name")?.value || "";
    social.renaming = false;
    return claimProfile(value).then(renderTogether);
  }
  if (target.closest("#add-source,.open-source")) return $("#source-modal").classList.remove("hidden");
  if (target.closest("#open-settings-hint")) return navigate({ view: "settings" });
  const reveal = target.closest("[data-reveal]");
  if (reveal) {
    const field = $(`#${reveal.dataset.reveal}`);
    const shown = field.type === "text";
    field.type = shown ? "password" : "text";
    reveal.setAttribute("aria-pressed", String(!shown));
    reveal.title = shown ? "Show" : "Hide";
    reveal.querySelector("use").setAttribute("href", shown ? "#i-eye" : "#i-eye-off");
    return;
  }
  const test = target.closest("[data-test]");
  if (test) return testSource(test.dataset.test);
  if (target.closest("#check-updates")) {
    if (renderUpdateBanner.state?.state === "ready") return window.aurora?.installUpdate();
    renderUpdateBanner.hold = Date.now() + 700;
    renderUpdateBanner({ state: "checking" });
    return window.aurora?.checkForUpdates();
  }
    const nav = target.closest("nav button");
  if (nav) return navigate({ view: nav.dataset.view, query: "" });
  const use = target.closest("[data-use]"); if (use) return useSource(use.dataset.use);
  const reload = target.closest("[data-refresh]"); if (reload) return refreshLibrary(false, reload.dataset.refresh);
  const showLogin = target.closest("[data-show-login]");
  if (showLogin) { state.revealSource = state.revealSource === showLogin.dataset.showLogin ? null : showLogin.dataset.showLogin; renderSettings(); return }
  const remove = target.closest("[data-remove]"); if (remove) { state.confirmRemove = remove.dataset.remove; renderSettings(); return }
  if (target.closest("[data-remove-cancel]")) { state.confirmRemove = null; renderSettings(); return }
  const confirmRemove = target.closest("[data-remove-confirm]");
  if (confirmRemove) { state.confirmRemove = null; return removeSource(confirmRemove.dataset.removeConfirm) }
  if (target.closest("#source-pill")) { state.confirmRemove = null; return navigate({ view: "settings" }) }
  const mode = target.closest("[data-live-mode]");
  if (mode) { state.liveMode = mode.dataset.liveMode; return navigate({ limit: state.liveMode === "grid" ? 120 : GUIDE_CHANNELS }, { replace: true }) }
  if (target.closest("#guide-now")) return scrollGuideToNow();
  const programme = target.closest("[data-play]");
  if (programme) return play(state.items.find((entry) => entry.id === programme.dataset.play));
  // only the programme blocks were ever clickable, so a channel the provider
  // publishes no guide for could not be played from the guide at all — and a
  // remote has nothing else to aim at in that row
  const guideRow = target.closest(".guide-row[data-guide-for]");
  if (guideRow) {
    const channel = state.items.find((entry) => entry.id === guideRow.dataset.guideFor);
    if (channel) return play(channel);
  }
  if (target.closest("#go-back")) return step(-1);
  if (target.closest("#go-forward")) return step(1);
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
  const scope = target.closest("[data-scope]");
  if (scope) return navigate({ scope: scope.dataset.scope, limit: 120 }, { replace: true });
  if (target.closest("#clear-search")) return navigate({ query: "" });
  const chip = target.closest(".chip"); if (chip && chip.dataset.category) return navigate({ category: chip.dataset.category, limit: 120 }, { replace: true });
  if (target.closest("#load-more")) return navigate({ limit: state.limit + (state.view === "live" && state.liveMode !== "grid" ? GUIDE_CHANNELS : 120) }, { replace: true });
  if (target.closest("#clear-history")) { state.confirmForget = "all"; renderHistory(); return }
  if (target.closest("[data-clear-history-confirm]")) { forgetProgress([...state.progress.keys()]); state.confirmForget = null; state.historyOpen.clear(); persistProgress(); render(); showToast("Watch history cleared"); return }
  if (target.closest("[data-forget-cancel]")) { state.confirmForget = null; renderHistory(); return }
  const historyFilter = target.closest("[data-history-filter]");
  if (historyFilter) { state.historyFilter = historyFilter.dataset.historyFilter; state.confirmForget = null; renderHistory(); return }
  const showToggle = target.closest("[data-show-toggle]");
  if (showToggle) {
    const id = showToggle.dataset.showToggle;
    if (state.historyOpen.has(id)) state.historyOpen.delete(id); else state.historyOpen.add(id);
    renderHistory(); return;
  }
  const forgetShow = target.closest("[data-forget-show]");
  if (forgetShow) { state.confirmForget = `show:${forgetShow.dataset.forgetShow}`; renderHistory(); return }
  const forgetShowConfirm = target.closest("[data-forget-show-confirm]");
  if (forgetShowConfirm) {
    const id = forgetShowConfirm.dataset.forgetShowConfirm;
    forgetProgress([...state.progress].filter(([, record]) => record.type === "episode" && record.id === id).map(([key]) => key));
    state.confirmForget = null; state.historyOpen.delete(id); persistProgress(); render(); return;
  }
  const forgetKey = target.closest("[data-forget-key]");
  if (forgetKey) { forgetProgress([forgetKey.dataset.forgetKey]); render(); return }
  const historyDetail = target.closest("[data-history-detail]");
  if (historyDetail) return openDetail(state.items.find((item) => item.id === historyDetail.dataset.historyDetail));
  const showPlay = target.closest("[data-show-play]");
  if (showPlay) {
    const show = historyShows().find((entry) => entry.id === showPlay.dataset.showPlay);
    if (!show) return;
    if (target.closest(".forget")) { hideFromContinue(show.episodes.map((record) => record.key)); render(); return }
    if (show.upNext) return playRecord(show.upNext.record);
    const item = state.items.find((entry) => entry.id === show.id);
    return item ? openDetail(item) : showToast("That show is no longer in your library — refresh the source");
  }
  const featuredPlay = target.closest(".play-featured"); if (featuredPlay) return openDetail(state.items.find((item) => item.id === featuredPlay.dataset.id));
  const featuredFavorite = target.closest(".favorite-featured"); if (featuredFavorite) return toggleFavorite(state.items.find((item) => item.id === featuredFavorite.dataset.id));
  const season = target.closest(".season-tab"); if (season) { state.selectedSeason = season.dataset.season; renderDetail(); return }
  const episode = target.closest(".episode"); if (episode) return playSeriesEpisode(Number(episode.dataset.episodeIndex));
  if (target.closest(".detail-play-next")) {
    const next = nextUnwatchedEpisode(seriesSeasons());
    if (!next) return;
    const item = state.seriesItem, episodes = seriesSeasons().find(([number]) => number === next.season)?.[1] || [];
    return playEpisode(item, next.season, episodes, next.index);
  }
  if (target.closest(".detail-play")) return play(state.detailItem);
  if (target.closest(".detail-restart")) return play(state.detailItem, { startOver: true });
  if (target.closest(".series-favorite,.detail-favorite")) return toggleFavorite(state.seriesItem || state.detailItem);
  if (target.closest("#player-episodes")) return toggleEpisodesPanel();
  if (target.closest("#episodes-close")) return closeEpisodesPanel();
  const panelPick = target.closest("[data-panel-index]");
  if (panelPick) return pickPanelEpisode(Number(panelPick.dataset.panelIndex));
  if (target.closest("#player-prev")) return stepEpisode(-1);
  if (target.closest("#player-next")) return stepEpisode(1);
  if (target.closest("#player-pip")) return video.requestPictureInPicture?.().catch(() => showToast("Picture in Picture is not available for this stream"));
  const resume = target.closest("[data-resume]");
  if (resume) {
    if (target.closest(".forget")) { hideFromContinue([resume.dataset.resume]); render(); return }
    return resumeRecord(resume.dataset.resume);
  }
  const media = target.closest(".card[data-id]");
  if (media) {
    const item = state.items.find((entry) => entry.id === media.dataset.id);
    if (target.closest(".heart")) return toggleFavorite(item);
    if (target.closest(".play-bubble")) return play(item);
    if (target.closest(".open-detail")) return openDetail(item);
    if (target.closest(".play-item")) return play(item);
    // a remote presses the card itself, not the artwork inside it: without this
    // OK on a focused poster does nothing at all
    if (item) return item.type === "live" ? play(item) : openDetail(item);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.target instanceof Element && event.target.matches("input,select,textarea")) {
    if (event.key === "Escape") {
      if (event.target.id === "search" && event.target.value) {
        event.target.value = "";
        state.query = ""; state.searchScope = "all";
        render();
      } else event.target.blur();
    }
    return;
  }
  if (event.key === "Escape") { handleBack(); return }
  if ($("#player-modal").classList.contains("hidden")) {
    if ((event.metaKey || event.ctrlKey) && event.key === "[") { event.preventDefault(); return step(-1) }
    if ((event.metaKey || event.ctrlKey) && event.key === "]") { event.preventDefault(); return step(1) }
    if (event.key === "/" || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f")) {
      event.preventDefault();
      $("#search").focus();
      $("#search").select();
    }
    return;
  }
  // named `seconds`, not `step`: a `const step` here would shadow the step()
  // navigation function for this entire handler and put it in the temporal
  // dead zone, which silently broke Escape, Cmd-[ and Cmd-]
  const seconds = event.shiftKey ? 60 : 10;
  const louder = (by) => { video.volume = Math.min(1, Math.max(0, video.volume + by)) };
  const keys = {
    " ": () => (video.paused ? video.play() : video.pause()),
    // on a television the arrows move focus between the player's own controls,
    // so skipping and volume live on the keys the remote actually has for them
    ...(TV ? {} : {
      ArrowRight: () => nudge(1, seconds),
      ArrowLeft: () => nudge(-1, seconds),
      ArrowUp: () => louder(0.1),
      ArrowDown: () => louder(-0.1),
    }),
    MediaFastForward: () => nudge(1, seconds),
    MediaRewind: () => nudge(-1, seconds),
    MediaTrackNext: () => stepEpisode(1),
    MediaTrackPrevious: () => stepEpisode(-1),
    MediaPlayPause: () => (video.paused ? video.play() : video.pause()),
    AudioVolumeUp: () => louder(0.1),
    AudioVolumeDown: () => louder(-0.1),
    f: () => (document.fullscreenElement ? document.exitFullscreen() : $("#player-shell").requestFullscreen()),
    m: () => { video.muted = !video.muted },
    n: () => stepEpisode(1),
    p: () => stepEpisode(-1),
    e: () => toggleEpisodesPanel(),
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

/* Live is a property of what is playing, not of a missing duration. Deciding it
   from duration alone put a red LIVE pill on every film and episode for as long
   as the provider took to send metadata — seconds, on a slow line. */
const durationKnown = () => Number.isFinite(video.duration) && video.duration > 0;
const liveStream = () => (state.playing ? state.playing.type === "live" : !durationKnown());
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
    // never fade out over an error: the message covers the video, so a tap could not bring the controls back
    if (!video.paused && $("#shortcuts").classList.contains("hidden") && $("#up-next").classList.contains("hidden") && !panelOpen() && $("#video-message").classList.contains("hidden")) shell.classList.add("idle");
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
  // "is-live", not "live": .live is the LIVE badge on cards, and the timeline
  // was picking up its background, padding and corners — a white pill in light mode
  timeline.classList.toggle("is-live", live);
  $("#time-now").textContent = clock(video.currentTime || 0);
  $("#time-total").textContent = live || !durationKnown() ? "" : clock(video.duration);
  const played = live || !durationKnown() ? 0 : Math.min(100, (video.currentTime / video.duration) * 100);
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
  const card = $("#up-next"), target = episodeAt(state.queue, 1);
  const due = target && !liveStream() && video.duration > 90 && video.duration - video.currentTime <= 25;
  if (!due || upNextDismissed) { if (!due) card.classList.add("hidden"); return }
  if (!card.classList.contains("hidden")) return;
  const title = episodeTitle(target.episodes[target.index], target.index);
  $("#up-next-title").textContent = target.season === state.queue.season ? title : `Season ${target.season} \u2022 ${title}`;
  card.classList.remove("hidden");
  wakeChrome();
}

const ratioAt = (event) => {
  const rect = timeline.getBoundingClientRect();
  return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
};

timeline.addEventListener("pointerdown", (event) => {
  if (liveStream() || !durationKnown()) return;
  // seek first: setPointerCapture throws on an id the element does not own, and
  // a failed capture must not cost the user the seek they asked for
  video.currentTime = ratioAt(event) * video.duration;
  timeline.classList.add("scrubbing");
  try { timeline.setPointerCapture(event.pointerId) } catch { /* scrubbing still works without capture */ }
});

timeline.addEventListener("pointermove", (event) => {
  if (liveStream() || !durationKnown()) return;
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

/* On a phone: a tap shows or hides the controls, and a double tap on the left or
   right third skips back or forward, adding up on further taps — the gesture
   every phone video player uses. A single tap waits a moment so a double tap is
   not also read as two toggles. Pausing is the play button's job. */
let tapTimer = null, lastTap = 0;
video.addEventListener("click", (event) => {
  if (!IOS) return togglePlay();
  const now = Date.now(), box = video.getBoundingClientRect(), third = box.width / 3, x = event.clientX - box.left;
  const side = x < third ? -1 : x > third * 2 ? 1 : 0;
  if (side && now - lastTap < 320 && !liveStream()) {
    clearTimeout(tapTimer);
    lastTap = now; // keep the run going: tap-tap-tap reads 20, then 30 seconds
    return nudge(side);
  }
  lastTap = now;
  clearTimeout(tapTimer);
  tapTimer = setTimeout(() => {
    if (shell.classList.contains("idle")) wakeChrome();
    else if (!video.paused && !panelOpen()) { clearTimeout(idleTimer); shell.classList.add("idle") }
    else wakeChrome();
  }, 260);
});
video.addEventListener("play", () => { syncTransport(); broadcastParty(true) });
video.addEventListener("pause", () => { syncTransport(); broadcastParty(true) });
video.addEventListener("seeked", () => broadcastParty(true));
video.addEventListener("timeupdate", () => broadcastParty());
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
// a finger "leaves" at the end of every tap, which hid the controls it had just shown
shell.addEventListener("pointerleave", () => { if (!NATIVE && !video.paused && !panelOpen()) shell.classList.add("idle") });

$("#player-toggle").addEventListener("click", togglePlay);
/* Seeking used to happen in silence — the picture jumped and nothing said why.
   Repeated taps inside the window accumulate, so a triple tap reads "30
   seconds" and skips thirty, the way every other player behaves. */
const SEEK_WINDOW = 900;
let seekRun = { direction: 0, seconds: 0, at: 0 };

function nudge(direction, amount = 10) {
  const now = Date.now();
  const continuing = seekRun.direction === direction && now - seekRun.at < SEEK_WINDOW;
  seekRun = { direction, seconds: (continuing ? seekRun.seconds : 0) + amount, at: now };
  const target = video.currentTime + direction * amount;
  video.currentTime = Math.max(0, Math.min(video.duration || Infinity, target));
  const flash = $(direction < 0 ? "#seek-back" : "#seek-fwd");
  const total = seekRun.seconds;
  flash.querySelector("b").textContent = total >= 60 && total % 60 === 0 ? `${total / 60} minute${total === 60 ? "" : "s"}` : `${total} seconds`;
  flash.classList.remove("show");
  void flash.offsetWidth; // restart the animation on a rapid second tap
  flash.classList.add("show");
  wakeChrome();
}

// once the fade has run, nothing of it stays behind — not even at opacity 0
for (const flash of [$("#seek-back"), $("#seek-fwd")]) flash.addEventListener("animationend", () => flash.classList.remove("show"));

$("#player-back").addEventListener("click", () => nudge(-1));
$("#player-forward").addEventListener("click", () => nudge(1));

$("#playback-rate").addEventListener("change", (event) => {
  const rate = Number(event.target.value) || 1;
  video.playbackRate = rate;
  showToast(rate === 1 ? "Normal speed" : `Playing at ${rate}\u00d7`);
});

/* Providers ship subtitles inconsistently, so a file the viewer already has
   should work. SRT is converted rather than rejected — it is the format that
   actually turns up, and WebVTT only needs a header and dotted timestamps. */
function srtToVtt(text) {
  const body = text.replace(/\r+/g, "").replace(/^\uFEFF/, "")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  return /^WEBVTT/.test(body.trim()) ? body : `WEBVTT\n\n${body}`;
}

let loadedSubtitle = null;

function clearLoadedSubtitle() {
  if (!loadedSubtitle) return;
  URL.revokeObjectURL(loadedSubtitle.src);
  loadedSubtitle.element.remove();
  loadedSubtitle = null;
}

$("#subtitle-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    const vtt = srtToVtt(await file.text());
    if (loadedSubtitle) URL.revokeObjectURL(loadedSubtitle.src);
    const url = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
    const track = document.createElement("track");
    track.kind = "subtitles";
    track.label = file.name.replace(/\.[^.]+$/, "");
    track.src = url;
    track.default = true;
    video.appendChild(track);
    loadedSubtitle = { src: url, element: track };
    track.addEventListener("load", () => { track.track.mode = "showing"; refreshTrackMenus() }, { once: true });
    showToast(`Subtitles loaded from ${file.name}`);
  } catch { showToast("Could not read that subtitle file") }
});
$("#player-mute").addEventListener("click", () => { video.muted = !video.muted });
$("#volume").addEventListener("input", (event) => { video.volume = Number(event.target.value); video.muted = video.volume === 0 });
$("#player-full").addEventListener("click", () => {
  // iPhone Safari cannot put an element full screen, only a video, in its own player
  if (IOS && video.webkitEnterFullscreen) { try { video.webkitEnterFullscreen() } catch { showToast("Full screen is not available here") } return }
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
  updateRails.frame = requestAnimationFrame(() => { updateRails(); paintGrid() });
}, true);
window.addEventListener("resize", () => {
  updateRails();
  clearTimeout(measureGrid.timer);
  measureGrid.timer = setTimeout(measureGrid, 120);
});

let searchTimer;
$("#search").addEventListener("input", (event) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const next = event.target.value.trim();
    if (next === state.query) return;
    const typing = Boolean(state.query) && Boolean(next);
    navigate({ view: state.view === "detail" ? "home" : state.view, query: next, limit: 120 }, { replace: typing });
  }, 180);
});
$("#source-form").addEventListener("submit", connectProvider);
document.addEventListener("submit", async (event) => {
  if (event.target.id !== "keys-form") return;
  event.preventDefault();
  await saveSecrets({ ...(secrets || {}), tmdb: $("#tmdb-key").value.trim(), omdb: $("#omdb-key").value.trim() });
  writePref("keysUpdatedAt", Date.now());
  scheduleSync();
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
$("#episodes-season").addEventListener("change", (event) => { panelSeason = event.target.value; renderEpisodesPanel(); $("#episodes-list").scrollTop = 0 });
$("#audio-track").addEventListener("change", (event) => { if (state.hls) state.hls.audioTrack = Number(event.target.value) });
$("#subtitle-track").addEventListener("change", (event) => {
  const value = event.target.value;
  if (value === "file") { refreshTrackMenus(); return $("#subtitle-file").click() }
  const element = value.startsWith("el:") ? Number(value.slice(3)) : -1;
  [...video.textTracks].forEach((track, index) => { track.mode = index === element ? "showing" : "disabled" });
  if (state.hls) {
    const hls = value.startsWith("hls:") ? Number(value.slice(4)) : -1;
    state.hls.subtitleTrack = hls;
    state.hls.subtitleDisplay = hls >= 0;
  }
});
window.addEventListener("beforeunload", () => recordPosition(true));

/* ---------- account and sync ----------
   An Aurora account carries favourites, watch history and saved sources between
   devices. Favourites and history go up as rows the server can read, because it
   needs to merge them. Provider logins and API keys never do: they are sealed on
   the device with AES-GCM under a key derived from the account password, so the
   server only ever stores ciphertext it cannot open. The cost is honest and
   stated in the UI — a reset password cannot unlock what the old one sealed. */

const SUPABASE_URL = "https://dslcmbkdzukyvuzggjjc.supabase.co";
// publishable by design: it names the project. Row level security, not the
// secrecy of this string, is what keeps one account's rows from another
const SUPABASE_KEY = "sb_publishable_5Bftg7AySqFvxRfzWbHZnw_vZdhndy7";
const KDF_ITERATIONS = 600000;
const SYNC_DEBOUNCE = 12000;
const SYNC_INTERVAL = 5 * 60 * 1000;
const PAGE = 1000;

const account = { client: null, user: null, key: null, busy: false, syncing: false, lastSync: 0, error: "", mode: "signin", notice: "", confirmDelete: false, offline: false };
let syncTimer = null;

const iso = (ms) => new Date(ms).toISOString();
const toBase64 = (bytes) => { let text = ""; for (const byte of new Uint8Array(bytes)) text += String.fromCharCode(byte); return btoa(text) };
const fromBase64 = (text) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
const sourceKey = (source) => `${cleanServer(String(source.server || "")).toLowerCase()}|${source.username || ""}`;

// session tokens sit beside the provider logins: the keychain on a Mac, app storage on an iPhone
const authStorage = {
  getItem: (key) => secrets?.auth?.[key] ?? null,
  setItem: (key, value) => saveSecrets({ ...(secrets || {}), auth: { ...(secrets?.auth || {}), [key]: value } }, { quiet: true }),
  removeItem: (key) => { const auth = { ...(secrets?.auth || {}) }; delete auth[key]; return saveSecrets({ ...(secrets || {}), auth }, { quiet: true }) },
};

function accountClient() {
  if (account.client || !window.supabase?.createClient) return account.client;
  account.client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { storage: authStorage, storageKey: "aurora-auth", persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  account.client.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" && account.user) { account.user = null; account.key = null; if (state.view === "settings") renderSettings() }
    // a token that only refreshes later still has to start sync — but a sign-in
    // in flight syncs itself once it holds the vault key, and starting one here
    // would take the lock and make that merge a no-op
    if (session?.user) setTimeout(() => startSync(session.user, { sync: !account.busy }), 0);
  });
  return account.client;
}

/* ---- the sealed vault ---- */

async function deriveVaultKey(password, salt, iterations = KDF_ITERATIONS) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

async function rememberVaultKey(key, salt) {
  account.key = key;
  const raw = toBase64(await crypto.subtle.exportKey("raw", key));
  await saveSecrets({ ...(secrets || {}), vault: { key: raw, salt } }, { quiet: true });
}

async function restoreVaultKey() {
  if (account.key || !secrets?.vault?.key) return account.key;
  account.key = await crypto.subtle.importKey("raw", fromBase64(secrets.vault.key), { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
  return account.key;
}

function vaultPayload() {
  const removed = readPref("sourcesRemoved", {});
  return {
    v: 1,
    sources: readSources().map(({ id, name, server, username, password, updatedAt }) => ({ id, name, server, username, password, updatedAt: updatedAt || 0 })),
    removed,
    tmdb: secrets?.tmdb || "", tmdbAt: readPref("keysUpdatedAt", 0),
    omdb: secrets?.omdb || "",
  };
}

async function pushVault() {
  if (!account.user || !(await restoreVaultKey())) return;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, account.key, new TextEncoder().encode(JSON.stringify(vaultPayload())));
  const { error } = await accountClient().from("vault").upsert({
    user_id: account.user.id, kdf_salt: secrets.vault.salt, kdf_iterations: KDF_ITERATIONS,
    iv: toBase64(iv), ciphertext: toBase64(sealed), updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

async function openVault(row) {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(row.iv) }, account.key, fromBase64(row.ciphertext));
  return JSON.parse(new TextDecoder().decode(plain));
}

/* Sources merge per provider login, newest change wins, and a removal is
   remembered — otherwise a device that still had the source would put it back
   on the next sync. Returns how many sources this device gained. */
async function mergeVault(remote) {
  const local = readSources();
  const removed = { ...readPref("sourcesRemoved", {}), };
  for (const [key, at] of Object.entries(remote.removed || {})) if (!removed[key] || removed[key] < at) removed[key] = at;
  const byKey = new Map(local.map((source) => [sourceKey(source), source]));
  let gained = 0, changed = false;
  for (const source of remote.sources || []) {
    const key = sourceKey(source), mine = byKey.get(key);
    if (removed[key] && removed[key] >= (source.updatedAt || 0)) continue;
    if (!mine) { byKey.set(key, { ...source, id: source.id || newSourceId(), count: 0 }); gained += 1; changed = true }
    else if ((source.updatedAt || 0) > (mine.updatedAt || 0)) { byKey.set(key, { ...mine, name: source.name, password: source.password, updatedAt: source.updatedAt }); changed = true }
  }
  for (const [key, at] of Object.entries(removed)) {
    const mine = byKey.get(key);
    if (mine && at > (mine.updatedAt || 0)) { byKey.delete(key); changed = true }
  }
  writePref("sourcesRemoved", removed);
  if (changed) writeSources([...byKey.values()]);
  const keysChanged = (remote.tmdbAt || 0) > readPref("keysUpdatedAt", 0) && (remote.tmdb !== secrets?.tmdb || remote.omdb !== secrets?.omdb);
  if (keysChanged) {
    await saveSecrets({ ...(secrets || {}), tmdb: remote.tmdb || "", omdb: remote.omdb || "" }, { quiet: true });
    writePref("keysUpdatedAt", remote.tmdbAt);
  }
  return gained;
}

async function syncVault() {
  if (!account.user || !(await restoreVaultKey())) return 0;
  const { data, error } = await accountClient().from("vault").select("*").maybeSingle();
  if (error) throw error;
  if (!data) { await pushVault(); return 0 }
  if (data.kdf_salt !== secrets.vault.salt) { account.notice = "Your saved sources were sealed on another device after a password change. Sign out and back in here to unlock them."; return 0 }
  const gained = await mergeVault(await openVault(data));
  await pushVault();
  return gained;
}

/* ---- favourites and history ---- */

function scheduleSync() {
  if (!account.user) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow({ quiet: true }), SYNC_DEBOUNCE);
}

function markDirty(kind, id) {
  const dirty = readPref("syncDirty", { favorites: {}, progress: {} });
  dirty[kind] = { ...(dirty[kind] || {}), [id]: Date.now() };
  writePref("syncDirty", dirty);
  scheduleSync();
}

function noteFavorite(id, saved) {
  writePref("favoriteTimes", { ...readPref("favoriteTimes", {}), [id]: { saved, at: Date.now() } });
  markDirty("favorites", id);
}

function forgetProgress(keys) {
  const gone = { ...readPref("progressGone", {}) };
  for (const key of keys) {
    if (!state.progress.has(key)) continue;
    state.progress.delete(key);
    gone[key] = Date.now();
    markDirty("progress", key);
  }
  writePref("progressGone", gone);
  persistProgress();
}

// the first time this device meets this account, everything it holds goes up
function markEverythingDirty() {
  const now = Date.now(), times = readPref("favoriteTimes", {});
  const favorites = {}, progress = {};
  for (const id of state.favorites) { favorites[id] = now; if (!times[id]) times[id] = { saved: true, at: now } }
  for (const [id, entry] of Object.entries(times)) if (!entry.saved) favorites[id] = now;
  for (const key of state.progress.keys()) progress[key] = now;
  for (const key of Object.keys(readPref("progressGone", {}))) progress[key] = now;
  writePref("favoriteTimes", times);
  writePref("syncDirty", { favorites, progress });
}

async function pushChanges() {
  const client = accountClient(), dirty = readPref("syncDirty", { favorites: {}, progress: {} });
  const times = readPref("favoriteTimes", {}), gone = readPref("progressGone", {});
  const favoriteRows = Object.keys(dirty.favorites || {}).map((id) => ({ item_id: id, saved: state.favorites.has(id), updated_at: iso(times[id]?.at || Date.now()) }));
  const progressRows = Object.keys(dirty.progress || {}).map((key) => {
    const record = state.progress.get(key);
    return record ? { key, record, deleted: false, updated_at: iso(record.updatedAt || Date.now()) } : { key, deleted: true, updated_at: iso(gone[key] || Date.now()) };
  });
  for (let at = 0; at < favoriteRows.length; at += 500) {
    const { error } = await client.rpc("push_favorites", { items: favoriteRows.slice(at, at + 500) });
    if (error) throw error;
  }
  for (let at = 0; at < progressRows.length; at += 500) {
    const { error } = await client.rpc("push_progress", { items: progressRows.slice(at, at + 500) });
    if (error) throw error;
  }
  // only clear what went up unchanged: anything touched during the push stays dirty
  const after = readPref("syncDirty", { favorites: {}, progress: {} });
  for (const kind of ["favorites", "progress"]) {
    for (const [id, at] of Object.entries(dirty[kind] || {})) if (after[kind]?.[id] === at) delete after[kind][id];
  }
  writePref("syncDirty", after);
}

async function pullTable(table, apply) {
  const cursor = readPref("syncCursor", {});
  const since = cursor[table] || "1970-01-01T00:00:00Z";
  let newest = since, from = 0;
  for (;;) {
    const { data, error } = await accountClient().from(table).select("*").gt("synced_at", since)
      .order("synced_at", { ascending: true }).order(table === "favorites" ? "item_id" : "key", { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw error;
    for (const row of data) { apply(row); if (row.synced_at > newest) newest = row.synced_at }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  writePref("syncCursor", { ...readPref("syncCursor", {}), [table]: newest });
}

async function pullChanges() {
  let changed = false;
  const times = { ...readPref("favoriteTimes", {}) }, gone = { ...readPref("progressGone", {}) };
  await pullTable("favorites", (row) => {
    const at = Date.parse(row.updated_at);
    if ((times[row.item_id]?.at || 0) >= at) return;
    times[row.item_id] = { saved: row.saved, at };
    if (row.saved) state.favorites.add(row.item_id); else state.favorites.delete(row.item_id);
    changed = true;
  });
  await pullTable("progress", (row) => {
    const at = Date.parse(row.updated_at), mine = state.progress.get(row.key);
    if (Math.max(mine?.updatedAt || 0, gone[row.key] || 0) >= at) return;
    if (row.deleted) { state.progress.delete(row.key); gone[row.key] = at }
    else { state.progress.set(row.key, { ...row.record, updatedAt: at }); delete gone[row.key] }
    changed = true;
  });
  writePref("favoriteTimes", times);
  writePref("progressGone", gone);
  if (changed) { writePref("favorites", [...state.favorites]); persistProgress() }
  return changed;
}

async function syncNow({ quiet = false } = {}) {
  if (!account.user) return;
  // dropping this would silently skip whatever the caller had just changed —
  // which is how a sign-in could finish without its sources ever merging
  if (account.syncing) { syncNow.again = { quiet: quiet && (syncNow.again?.quiet ?? true) }; return }
  account.syncing = true; account.error = "";
  if (state.view === "settings") renderSettings();
  let gained = 0;
  try {
    const cursor = readPref("syncCursor", {});
    if (cursor.user !== account.user.id) { writePref("syncCursor", { user: account.user.id }); markEverythingDirty() }
    // favourites and history can sync without it; sources and keys cannot, and
    // saying nothing would leave someone assuming they had
    if (!(await restoreVaultKey())) account.notice = "Favourites and history are syncing, but your saved sources aren't — sign in again on this device to unlock them.";
    gained = await syncVault();
    await pushChanges();
    const changed = await pullChanges();
    account.lastSync = Date.now();
    if (changed || gained) {
      updateSource();
      if (["home", "history", "favorites", "settings"].includes(state.view)) render();
    }
    if (!quiet && gained) showToast(`${gained} source${gained === 1 ? "" : "s"} arrived from your account`);
  } catch (error) {
    account.error = /fetch|network|load failed/i.test(error?.message || "") ? "Could not reach the sync server — it will try again" : error?.message || "Sync failed";
    if (!quiet) showToast(account.error);
  } finally {
    account.syncing = false;
    if (state.view === "settings") renderSettings();
    // outside the try: a source that arrived is worth loading even if pushing
    // or pulling the rest of the sync then failed
    if (gained) ensureLibrary.done = false;
    if (syncNow.again) { const next = syncNow.again; syncNow.again = null; await syncNow(next) }
    else if (account.user) ensureLibrary().catch(() => {});
  }
}

/* ---- signing in and out ---- */

const AUTH_ERRORS = [
  [/invalid login credentials/i, "That email and password don't match an account."],
  [/email not confirmed/i, "Confirm your email first — the link is in your inbox — then sign in."],
  [/already registered|already been registered/i, "There's already an account with that email. Sign in instead."],
  [/rate limit|too many/i, "Too many attempts. Wait a minute and try again."],
  [/password should be|weak password/i, "Choose a longer password."],
  [/fetch|network|load failed/i, "Could not reach the account server. Check your connection."],
];
const authMessage = (error) => AUTH_ERRORS.find(([pattern]) => pattern.test(error?.message || ""))?.[1] || error?.message || "Something went wrong.";

async function unlockAfterSignIn(user, password) {
  account.user = user;
  const { data, error } = await accountClient().from("vault").select("kdf_salt, kdf_iterations, iv, ciphertext").maybeSingle();
  if (error) throw error;
  if (data) {
    const key = await deriveVaultKey(password, fromBase64(data.kdf_salt), data.kdf_iterations);
    try {
      account.key = key;
      await openVault(data);
      await rememberVaultKey(key, data.kdf_salt);
      return;
    } catch {
      // sealed under a password this account no longer has: nobody can open it,
      // so this device's sources take its place under the current password
      account.notice = "Sources saved under your old password couldn't be unlocked, so this device's sources replaced them. Favourites and history are unaffected.";
    }
  }
  const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)));
  await rememberVaultKey(await deriveVaultKey(password, fromBase64(salt)), salt);
  await pushVault();
}

async function submitAccount(form) {
  const email = form.querySelector("#account-email").value.trim();
  const password = form.querySelector("#account-password").value;
  if (!crypto?.subtle) { account.error = "This device can't encrypt your sources, so sync isn't available here."; return renderSettings() }
  if (password.length < 8) { account.error = "Use at least 8 characters — this password also seals your saved sources."; return renderSettings() }
  account.busy = true; account.error = ""; account.notice = "";
  renderSettings();
  try {
    const client = accountClient();
    if (account.mode === "signup") {
      const { data, error } = await client.auth.signUp({ email, password });
      if (error) throw error;
      if (!data.session) { account.mode = "signin"; account.notice = `Check ${email} for a confirmation link, then sign in here.`; return }
      await unlockAfterSignIn(data.user, password);
    } else {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await unlockAfterSignIn(data.user, password);
    }
    showToast(`Signed in as ${email}`);
    startSync(account.user); // signing in mid-session must also start the timers
    await syncNow({ quiet: false });
  } catch (error) {
    account.error = authMessage(error);
    // signed in with supabase but the vault never opened: favourites would sync
    // and sources silently would not, which reads as success. It is not.
    if (!account.key) { account.user = null; account.offline = false }
  } finally {
    account.busy = false;
    renderSettings();
  }
}

async function signOut() {
  clearTimeout(syncTimer);
  try { await pushChanges() } catch { /* whatever didn't go up stays on this device */ }
  await accountClient()?.auth.signOut({ scope: "local" }).catch(() => {});
  const next = { ...(secrets || {}) };
  delete next.auth; delete next.vault;
  await saveSecrets(next, { quiet: true });
  account.user = null; account.key = null; account.confirmDelete = false; account.notice = ""; account.error = ""; account.offline = false;
  ensureLibrary.done = false;
  writePref("syncCursor", undefined); writePref("syncDirty", undefined); writePref("accountEmail", undefined);
  showToast("Signed out — everything stays on this device");
  renderSettings();
}

async function deleteAccount() {
  account.busy = true; renderSettings();
  try {
    const { error } = await accountClient().rpc("delete_my_account");
    if (error) throw error;
    await signOut();
    showToast("Your account and everything synced to it have been deleted");
  } catch (error) {
    account.error = authMessage(error);
  } finally { account.busy = false; account.confirmDelete = false; renderSettings() }
}

/* ---------- watching together ----------

   The two of you are not on the same provider, so you are not playing the same
   file: different rips, different intros, different ad breaks. Aurora therefore
   agrees on *which title* and *roughly where in it* you both are, and leaves
   each person's own copy alone.

   A title's identity is a fingerprint of its normalised name and year, because
   that is the only thing two providers reliably share — one calls a film
   `AMZN | The Runner` and the other `The Runner (2026)`.

   What a friend can learn is deliberately small: your display name, and whether
   a title they already know about is probably in your library too. The library
   itself never leaves the device; what goes up is a Bloom filter, which answers
   "could this be in there?" and cannot be read back as a list. */

const FILTER_BYTES = 1 << 16; // 64 KB covers a six-figure library at a low false-positive rate
const FILTER_HASHES = 4;
const PARTY_TICK = 2000;
const PARTY_SEEK_DRIFT = 2.5; // past this, catch up by seeking rather than by speed
const PARTY_EASE_DRIFT = 0.4; // under this, leave it alone

const social = { profile: null, friends: [], filters: new Map(), busy: false, error: "", notice: "", picking: null };
const party = { id: null, hosting: false, channel: null, friend: null, title: "", offset: 0, drift: 0, here: [], last: 0 };

/* Both readings, because a provider that omits the year must still match one
   that includes it — the year-qualified form is tried first when testing. */
function fingerprints(item) {
  const [key] = indexKeys(item.name);
  if (!key) return [];
  const year = String(releaseYear(item) || "").slice(0, 4);
  return year ? [`${key}|${year}`, key] : [key];
}

const fnv = (text, seed) => {
  let hash = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
};

function filterSet(bits, value) {
  for (let i = 0; i < FILTER_HASHES; i += 1) {
    const at = fnv(value, i) % (bits.length * 8);
    bits[at >> 3] |= 1 << (at & 7);
  }
}

function filterHas(bits, value) {
  for (let i = 0; i < FILTER_HASHES; i += 1) {
    const at = fnv(value, i) % (bits.length * 8);
    if (!(bits[at >> 3] & (1 << (at & 7)))) return false;
  }
  return true;
}

const toBits = (text) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

function libraryFilter() {
  const bits = new Uint8Array(FILTER_BYTES);
  let count = 0;
  for (const item of state.items) {
    if (item.type !== "movie" && item.type !== "series") continue;
    for (const print of fingerprints(item)) filterSet(bits, print);
    count += 1;
  }
  return { bits, count };
}

/* Published when the library changes, not on a timer: it is a snapshot of what
   this device can play, and it only moves when that does. */
async function publishLibraryFilter() {
  if (!account.user || !state.items.length) return;
  const { bits, count } = libraryFilter();
  const stamp = `${count}:${state.provider?.id || ""}`;
  if (readPref("filterStamp", "") === stamp) return;
  const { error } = await accountClient().from("library_filter").upsert({
    user_id: account.user.id, bits: toBase64(bits), items: count, hashes: FILTER_HASHES, updated_at: new Date().toISOString(),
  });
  if (!error) writePref("filterStamp", stamp);
}

async function friendFilter(userId) {
  if (social.filters.has(userId)) return social.filters.get(userId);
  const { data } = await accountClient().from("library_filter").select("bits, items, updated_at").eq("user_id", userId).maybeSingle();
  const filter = data?.bits ? { bits: toBits(data.bits), items: data.items, at: data.updated_at } : null;
  social.filters.set(userId, filter);
  return filter;
}

/* What the two of you could both play. The Bloom filter can say yes when the
   answer is no — about one title in a hundred — so this is an offer, not a
   promise, and the invite confirms it for real against the other library. */
function sharedWith(filter, limit = 120) {
  if (!filter) return [];
  const out = [];
  for (const item of state.items) {
    if (item.type !== "movie" && item.type !== "series") continue;
    const prints = fingerprints(item);
    // the year-qualified print first, then the bare one, because the other
    // library may not know the year — joinParty matches the same way round
    if (prints.some((print) => filterHas(filter.bits, print))) out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

/* ---- being someone a friend can find ---- */

async function claimProfile(name = "") {
  if (!account.user) return null;
  const { data, error } = await accountClient().rpc("claim_profile", { name: name || social.profile?.display_name || account.user.email?.split("@")[0] || "Someone" });
  if (error) { social.error = friendlyError(error); return null }
  social.profile = Array.isArray(data) ? data[0] : data;
  return social.profile;
}

async function loadFriends() {
  if (!account.user) return;
  const { data, error } = await accountClient().rpc("my_friends");
  if (error) { social.error = friendlyError(error); return }
  social.friends = data || [];
}

async function addFriendByCode(code) {
  social.error = ""; social.notice = "";
  const clean = String(code || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (clean.length !== 8) { social.error = "A friend code is eight characters."; return }
  if (clean === social.profile?.friend_code) { social.error = "That is your own code."; return }
  const { data, error } = await accountClient().rpc("friend_by_code", { code: clean });
  if (error) { social.error = friendlyError(error); return }
  const found = Array.isArray(data) ? data[0] : data;
  if (!found) { social.error = "No one has that code."; return }
  const { error: asked } = await accountClient().from("friends").insert({ requester: account.user.id, addressee: found.user_id, status: "pending" });
  if (asked && !/duplicate|unique/i.test(asked.message || "")) { social.error = friendlyError(asked); return }
  social.notice = `Asked ${found.display_name} to be friends.`;
  await loadFriends();
}

async function acceptFriend(userId) {
  await accountClient().from("friends").update({ status: "accepted" }).eq("requester", userId).eq("addressee", account.user.id);
  await loadFriends();
}

async function removeFriend(userId) {
  await accountClient().from("friends").delete().or(`and(requester.eq.${account.user.id},addressee.eq.${userId}),and(requester.eq.${userId},addressee.eq.${account.user.id})`);
  social.filters.delete(userId);
  await loadFriends();
}

const friendlyError = (error) => (/fetch|network|load failed/i.test(error?.message || "") ? "Could not reach the account server" : error?.message || "That did not work");

/* ---- the party itself ---- */

const partyMember = (id) => social.friends.find((friend) => friend.user_id === id);

async function startParty(item, friendId) {
  if (!account.user || !item) return;
  const [print] = fingerprints(item);
  const { data, error } = await accountClient().from("parties")
    .insert({ host: account.user.id, fingerprint: print || "", kind: item.type === "series" ? "series" : "movie", title: item.name })
    .select("id").single();
  if (error) { showToast(friendlyError(error)); return }
  // both rows must carry the same keys: a bulk insert whose objects differ is
  // refused outright, which left a party with nobody in it and no invitation
  await accountClient().from("party_members").insert([
    { party_id: data.id, user_id: account.user.id, joined_at: new Date().toISOString() },
    { party_id: data.id, user_id: friendId, joined_at: null },
  ]);
  party.hosting = true;
  party.friend = partyMember(friendId);
  party.title = item.name;
  await openPartyChannel(data.id);
  // tell them now; the row is there for whenever they next open Aurora
  accountClient().channel(`aurora-user-${friendId}`).send({
    type: "broadcast", event: "invite",
    payload: { party: data.id, from: social.profile?.display_name || "A friend", title: item.name, fingerprint: print },
  }).catch(() => {});
  play(item);
  showToast(`Invited ${party.friend?.display_name || "your friend"} to watch`);
}

/* The invitee's side: find the title in *their* library, by fingerprint, and
   play their own copy of it. */
async function joinParty(partyId) {
  const { data: row } = await accountClient().from("parties").select("id, host, fingerprint, title, kind, ended_at").eq("id", partyId).maybeSingle();
  if (!row || row.ended_at) { showToast("That party has ended"); return }
  const mine = state.items.find((item) => (item.type === "movie" || item.type === "series") && fingerprints(item)[0] === row.fingerprint)
    || state.items.find((item) => (item.type === "movie" || item.type === "series") && fingerprints(item).includes(row.fingerprint));
  if (!mine) { showToast(`Your provider does not seem to have ${row.title}`); return }
  await accountClient().from("party_members").update({ joined_at: new Date().toISOString() }).eq("party_id", partyId).eq("user_id", account.user.id);
  party.hosting = false;
  party.friend = partyMember(row.host);
  party.title = row.title;
  party.offset = Number(readPref("partyOffsets", {})[row.host] || 0);
  await openPartyChannel(partyId);
  play(mine);
}

async function openPartyChannel(id) {
  await closePartyChannel();
  party.id = id;
  const channel = accountClient().channel(`aurora-party-${id}`, { config: { broadcast: { self: false }, presence: { key: account.user.id } } });
  channel.on("broadcast", { event: "state" }, ({ payload }) => followHost(payload));
  channel.on("broadcast", { event: "ended" }, () => { showToast("Your friend ended the party"); leaveParty() });
  channel.on("presence", { event: "sync" }, () => {
    party.here = Object.keys(channel.presenceState() || {});
    updatePartyStrip();
  });
  await channel.subscribe((status) => {
    if (status === "SUBSCRIBED") channel.track({ at: Date.now(), name: social.profile?.display_name || "" });
  });
  party.channel = channel;
  updatePartyStrip();
}

async function closePartyChannel() {
  if (!party.channel) return;
  try { await accountClient().removeChannel(party.channel) } catch { /* it is going away anyway */ }
  party.channel = null;
}

/* The host is the clock. Position plus the time it was sent beats sending a
   position alone, because the message takes however long it takes to arrive. */
function broadcastParty(force = false) {
  if (!party.channel || !party.hosting) return;
  const video = $("#video");
  if (!force && Date.now() - party.last < PARTY_TICK) return;
  party.last = Date.now();
  party.channel.send({
    type: "broadcast", event: "state",
    payload: { position: video.currentTime, paused: video.paused, at: Date.now(), title: party.title },
  }).catch(() => {});
}

function followHost(message) {
  if (party.hosting || !message || $("#player-modal").classList.contains("hidden")) return;
  const video = $("#video");
  const travelled = message.paused ? 0 : (Date.now() - Number(message.at || Date.now())) / 1000;
  const target = Number(message.position || 0) + travelled + party.offset;
  party.drift = video.currentTime - target;
  if (message.paused && !video.paused) video.pause();
  if (!message.paused && video.paused) video.play().catch(() => {});
  const off = Math.abs(party.drift);
  if (off > PARTY_SEEK_DRIFT) { video.currentTime = target; video.playbackRate = speedChoice() }
  else if (off > PARTY_EASE_DRIFT) video.playbackRate = speedChoice() * (party.drift > 0 ? 0.95 : 1.05);
  else video.playbackRate = speedChoice();
  updatePartyStrip();
}

/* Two providers' copies of one film do not start at the same moment. This is
   the fix for that, and it is remembered per friend because the difference
   belongs to their copy, not to tonight. */
function nudgeParty(seconds) {
  party.offset = Math.round((party.offset + seconds) * 10) / 10;
  if (party.friend) {
    const offsets = { ...readPref("partyOffsets", {}) };
    offsets[party.friend.user_id] = party.offset;
    writePref("partyOffsets", offsets);
  }
  showToast(party.offset === 0 ? "Playing level with your friend"
    : `Holding ${Math.abs(party.offset)}s ${party.offset > 0 ? "ahead of" : "behind"} your friend`);
  updatePartyStrip();
}

async function leaveParty() {
  const id = party.id;
  if (id && party.hosting) {
    await accountClient().from("parties").update({ ended_at: new Date().toISOString() }).eq("id", id);
    party.channel?.send({ type: "broadcast", event: "ended", payload: {} }).catch(() => {});
  }
  await closePartyChannel();
  Object.assign(party, { id: null, hosting: false, friend: null, title: "", offset: 0, drift: 0, here: [], last: 0 });
  $("#video").playbackRate = speedChoice();
  updatePartyStrip();
}

/* Invitations arrive on a channel of your own, and are also sitting in the
   database for whenever you next open Aurora. */
function listenForInvites() {
  if (!account.user || listenForInvites.on) return;
  listenForInvites.on = true;
  accountClient().channel(`aurora-user-${account.user.id}`)
    .on("broadcast", { event: "invite" }, ({ payload }) => offerParty(payload))
    .subscribe();
}

async function pendingInvites() {
  if (!account.user) return [];
  const { data } = await accountClient().from("party_members")
    .select("party_id, parties!inner(id, host, title, fingerprint, ended_at, created_at)")
    .is("joined_at", null).is("parties.ended_at", null);
  return (data || []).filter((row) => Date.now() - Date.parse(row.parties.created_at) < 6 * 60 * 60 * 1000);
}

function offerParty(invite) {
  if (!invite?.party || party.id === invite.party) return;
  social.notice = "";
  const banner = $("#party-invite");
  banner.innerHTML = `<div><strong>${escapeHtml(invite.from || "A friend")}</strong><small>wants to watch ${escapeHtml(invite.title || "something")}</small></div>
    <div class="party-invite-actions"><button class="primary small" data-join-party="${escapeHtml(invite.party)}">Watch together</button>
    <button class="secondary small" data-dismiss-invite>Not now</button></div>`;
  banner.classList.remove("hidden");
}

function updatePartyStrip() {
  const strip = $("#party-strip");
  if (!strip) return;
  if (!party.id) { strip.classList.add("hidden"); return }
  const name = party.friend?.display_name || "your friend";
  const together = party.here.length > 1;
  const drift = Math.abs(party.drift) < 1 ? "in step" : `${Math.abs(party.drift).toFixed(1)}s ${party.drift > 0 ? "ahead" : "behind"}`;
  strip.innerHTML = `<span class="party-who">${escapeHtml(party.hosting ? `Watching with ${name}` : `Following ${name}`)}</span>
    <span class="party-state">${together ? escapeHtml(drift) : "waiting for them to join…"}</span>
    ${party.hosting ? "" : `<button class="ghost" data-party-nudge="-5" title="Hold me further back">−5s</button><button class="ghost" data-party-nudge="5" title="Push me further on">+5s</button>`}
    <button class="ghost" data-party-leave>${party.hosting ? "End" : "Leave"}</button>`;
  strip.classList.remove("hidden");
}


const speedChoice = () => Number($("#playback-rate")?.value) || 1;

async function pickFriend(userId) {
  social.picking = { userId, loading: true, items: [] };
  renderTogether();
  const filter = await friendFilter(userId);
  const items = sharedWith(filter);
  social.picking = { userId, loading: false, items, items_count: filter?.items || 0 };
  renderTogether();
}

function renderTogether() {
  if (!window.supabase) return;
  const me = social.profile;
  const accepted = social.friends.filter((friend) => friend.status === "accepted");
  const toAnswer = social.friends.filter((friend) => friend.status === "pending" && !friend.i_asked);
  const asked = social.friends.filter((friend) => friend.status === "pending" && friend.i_asked);
  const picked = social.picking && accepted.find((friend) => friend.user_id === social.picking.userId);

  const row = (friend, actions) => `<div class="friend-row">
      <span class="account-avatar">${escapeHtml((friend.display_name || "?")[0].toUpperCase())}</span>
      <div><strong>${escapeHtml(friend.display_name || "Someone")}</strong><small>${escapeHtml(friend.friend_code || "")}</small></div>
      <div class="row-actions">${actions}</div>
    </div>`;

  $("#content").innerHTML = !account.user
    ? `<section class="settings"><section class="panel"><header><h2>Watching together</h2>
        <p>Sign in to your Aurora account first — friends are attached to the account, not to ${DEVICE}.</p></header>
        <div class="panel-foot"><button class="primary small" data-view="settings">Open Settings</button></div></section></section>`
    : `<section class="settings">
      <section class="panel">
        <header><h2>You</h2><p>Give this code to a friend and they can add you. Nobody can find you any other way.</p></header>
        <div class="friend-row">
          <span class="account-avatar">${escapeHtml((me?.display_name || "?")[0].toUpperCase())}</span>
          <div>${social.renaming
            ? `<input id="my-name" value="${escapeHtml(me?.display_name || "")}" maxlength="40" autocorrect="off" />`
            : `<strong>${escapeHtml(me?.display_name || "…")}</strong>`}<small class="friend-code">${escapeHtml(me?.friend_code || "")}</small></div>
          <div class="row-actions">${social.renaming
            ? '<button class="primary small" data-save-name>Save</button>'
            : '<button class="secondary small" data-rename-me>Change name</button>'}</div>
        </div>
        <form id="friend-form" class="keys">
          <label>Add a friend by code<input id="friend-code" placeholder="e.g. 7FK3QX2M" maxlength="9" autocapitalize="characters" autocorrect="off" spellcheck="false" /></label>
          ${social.error ? `<p class="form-error">${escapeHtml(social.error)}</p>` : ""}${social.notice ? `<p class="account-notice">${escapeHtml(social.notice)}</p>` : ""}
          <button class="primary small" type="submit" ${social.busy ? "disabled" : ""}>${social.busy ? "Asking…" : "Send request"}</button>
        </form>
      </section>

      ${toAnswer.length ? `<section class="panel"><header><h2>Wants to be your friend</h2></header>
        ${toAnswer.map((friend) => row(friend, `<button class="primary small" data-accept-friend="${friend.user_id}">Accept</button><button class="secondary small" data-remove-friend="${friend.user_id}">Decline</button>`)).join("")}
      </section>` : ""}

      <section class="panel">
        <header><h2>Friends</h2><p>Pick someone to see the films and series you both have. Your library never leaves this device — only a check of whether a title you already know about is in theirs.</p></header>
        ${accepted.length ? accepted.map((friend) => row(friend, `<button class="primary small" data-pick-friend="${friend.user_id}">What we both have</button><button class="secondary small" data-remove-friend="${friend.user_id}">Remove</button>`)).join("") : `<p class="row-note">No friends yet. Send someone your code.</p>`}
        ${asked.length ? `<p class="row-note">Waiting on ${asked.map((friend) => escapeHtml(friend.display_name)).join(", ")}.</p>` : ""}
      </section>

      ${picked ? `<section class="panel">
        <header><h2>You and ${escapeHtml(picked.display_name)}</h2>
          <p>${social.picking.loading ? "Checking their library…" : social.picking.items.length ? `${social.picking.items.length} you can both play. Pick one and Aurora will ask them to watch it with you — each of you plays your own copy.` : "Nothing in common yet, or they have not opened Aurora since connecting their source."}</p></header>
        <div class="shared-grid">${social.picking.items.map((item) => `<button class="shared-title" data-invite-item="${escapeHtml(item.id)}" data-invite-friend="${picked.user_id}">
            <span class="shared-name">${escapeHtml(item.name)}</span><small>${escapeHtml(item.year || "")} ${item.type === "series" ? "· Series" : ""}</small>
          </button>`).join("")}</div>
      </section>` : ""}
    </section>`;
}

function accountPanel() {
  if (!window.supabase) return "";
  if (account.user) {
    const synced = account.syncing ? "Syncing…" : account.lastSync ? `Synced ${whenLabel(account.lastSync)}` : "Not synced yet";
    return `<section class="panel account-panel">
      <header><h2>Account</h2><p>Favourites, history and your saved sources follow you to every device you sign in on. Provider logins are encrypted on ${DEVICE} before they are uploaded.</p></header>
      <div class="account-row"><span class="account-avatar">${escapeHtml((account.user.email || "?")[0].toUpperCase())}</span><div><strong>${escapeHtml(account.user.email || "")}</strong><small>${escapeHtml(synced)}</small></div></div>
      ${account.error ? `<p class="form-error">${escapeHtml(account.error)}</p>` : ""}${account.notice ? `<p class="account-notice">${escapeHtml(account.notice)}</p>` : ""}
      <div class="panel-foot account-actions">
        <button class="secondary small" data-account="sync" ${account.syncing ? "disabled" : ""}>${icon("refresh")}Sync now</button>
        <button class="secondary small" data-account="signout">Sign out</button>
        ${account.confirmDelete ? "" : '<button class="secondary small danger" data-account="delete">Delete account</button>'}
      </div>
      ${account.confirmDelete ? `<div class="row-confirm"><p>Delete your Aurora account? Everything synced to it — favourites, history and sealed sources — is erased from the server. What's on ${DEVICE} stays.</p><div><button class="secondary small danger" data-account="delete-confirm" ${account.busy ? "disabled" : ""}>Delete it</button><button class="secondary small" data-account="delete-cancel">Keep it</button></div></div>` : ""}
    </section>`;
  }
  if (account.offline) {
    const last = String(secrets?.accountEmail || "");
    return `<section class="panel account-panel">
    <header><h2>Account</h2><p>You are still signed in on ${DEVICE}. Aurora could not reach the account server just now and keeps trying — favourites and history are safe here meanwhile.</p></header>
    <div class="account-row"><span class="account-avatar">${escapeHtml((last || "?")[0].toUpperCase())}</span><div><strong>${escapeHtml(last || "Signed in")}</strong><small>Reconnecting… nothing syncs until it does, and nothing is lost</small></div></div>
    ${account.error ? `<p class="form-error">${escapeHtml(account.error)}</p>` : ""}${account.notice ? `<p class="account-notice">${escapeHtml(account.notice)}</p>` : ""}
    <div class="panel-foot account-actions">
      <button class="secondary small" data-account="retry">${icon("refresh")}Try now</button>
      <button class="secondary small" data-account="signout">Sign out</button>
    </div>
  </section>`;
  }
  const signup = account.mode === "signup";
  return `<section class="panel account-panel">
    <header><h2>Account</h2><p>Sign in to keep favourites, history and your saved sources on every device. Provider logins are encrypted on ${DEVICE} with your password before they leave it.</p></header>
    <form id="account-form" class="keys">
      <label>Email<input id="account-email" type="email" autocomplete="email" autocapitalize="off" autocorrect="off" spellcheck="false" required /></label>
      <label>Password<input id="account-password" type="password" autocomplete="${signup ? "new-password" : "current-password"}" autocapitalize="off" autocorrect="off" minlength="8" required /></label>
      ${account.error ? `<p class="form-error">${escapeHtml(account.error)}</p>` : ""}${account.notice ? `<p class="account-notice">${escapeHtml(account.notice)}</p>` : ""}
      <div class="account-actions">
        <button class="primary small" type="submit" ${account.busy ? "disabled" : ""}>${account.busy ? "Working…" : signup ? "Create account" : "Sign in"}</button>
        <button class="secondary small" type="button" data-account="${signup ? "mode-signin" : "mode-signup"}">${signup ? "I have an account" : "Create an account"}</button>
      </div>
      ${signup ? '<small class="keys-note">Your password seals your saved sources. If you ever reset it, they can\'t be unlocked and you add them again — favourites and history are unaffected.</small>' : ""}
    </form>
  </section>`;
}

/* Everything that has to happen once Aurora knows who is signed in. It runs
   after a launch, after a sign-in, and again if a token only comes back later —
   so a session that was slow to open does not leave the app looking signed out
   with syncing switched off until the next relaunch. */
let syncWired = false;
function startSync(user, { sync = true } = {}) {
  if (!user) return;
  const first = !account.user, wasOffline = account.offline;
  account.user = user;
  account.offline = false;
  if (first || wasOffline) account.notice = ""; // whatever it said about being disconnected is over
  // so the reconnecting state can still say who, without putting the address in
  // plain prefs: it belongs with the rest of the account's details
  if (user.email && secrets?.accountEmail !== user.email) saveSecrets({ ...(secrets || {}), accountEmail: user.email }, { quiet: true });
  if (!syncWired) {
    syncWired = true;
    setInterval(() => syncNow({ quiet: true }), SYNC_INTERVAL);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") syncNow({ quiet: true });
      else if (account.user) pushChanges().catch(() => {});
    });
  }
  // tokens refresh hourly and on every focus; rebuilding Settings each time
  // would wipe a half-typed source name or API key out from under the user
  if ((first || wasOffline) && state.view === "settings") renderSettings();
  if (first && sync) {
    restoreVaultKey().catch(() => {}).then(() => syncNow({ quiet: true }));
    claimProfile().then(loadFriends).then(() => {
      listenForInvites();
      publishLibraryFilter().catch(() => {});
      return pendingInvites();
    }).then((waiting) => {
      const [first] = waiting || [];
      if (first) offerParty({ party: first.parties.id, title: first.parties.title, from: partyMember(first.parties.host)?.display_name });
    }).catch(() => {});
  }
}

const SESSION_RETRY = 6000;

async function startAccount() {
  if (startAccount.running) return;
  startAccount.running = true;
  try { await openSession() } finally { startAccount.running = false }
}

async function openSession() {
  const client = accountClient();
  if (!client) return;
  const { data } = await client.auth.getSession().catch(() => ({ data: {} }));
  if (data?.session?.user) return startSync(data.session.user);
  if (!secrets?.auth?.["aurora-auth"]) return;
  /* There is a session here, it just would not open: almost always the network
     not being up yet — a Mac still logging in, an iPhone waking. Showing the
     sign-in form to someone who never signed out is the wrong answer, so say
     Aurora is reconnecting and keep asking. */
  account.offline = true;
  if (state.view === "settings") renderSettings();
  for (let attempt = 1; attempt <= 6 && !account.user; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, SESSION_RETRY * attempt));
    // supabase clears the stored session itself when a refresh is refused
    // outright rather than unreachable: that is a real sign-out, so stop
    if (!secrets?.auth?.["aurora-auth"]) break;
    const { data: retry } = await client.auth.getSession().catch(() => ({ data: {} }));
    if (retry?.session?.user) return startSync(retry.session.user);
  }
  // signing out during those two minutes is a decision, not a failure to report
  if (account.user || !account.offline) return;
  account.offline = false;
  account.notice = "Your session ended, so sync is paused. Sign in again to carry on — nothing on this device was touched.";
  if (state.view === "settings") renderSettings();
}

document.addEventListener("submit", (event) => {
  if (event.target.id === "friend-form") {
    event.preventDefault();
    social.busy = true; renderTogether();
    addFriendByCode($("#friend-code")?.value).finally(() => { social.busy = false; renderTogether() });
    return;
  }
  if (event.target.id !== "account-form") return;
  event.preventDefault();
  submitAccount(event.target);
});

document.addEventListener("click", (event) => {
  const action = event.target.closest?.("[data-account]")?.dataset.account;
  if (!action) return;
  if (action === "mode-signup" || action === "mode-signin") { account.mode = action === "mode-signup" ? "signup" : "signin"; account.error = ""; account.notice = ""; return renderSettings() }
  if (action === "sync") return syncNow();
  if (action === "retry") return startAccount();
  if (action === "signout") return signOut();
  if (action === "delete") { account.confirmDelete = true; return renderSettings() }
  if (action === "delete-cancel") { account.confirmDelete = false; return renderSettings() }
  if (action === "delete-confirm") return deleteAccount();
});

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
  window.aurora.onMenu("settings", () => navigate({ view: "settings", query: "" }));
  window.aurora.onMenu("sidebar", () => applySidebar(!sidebarHidden()));
  window.aurora.version().then((value) => { state.appVersion = value; const slot = $("#app-version"); if (slot) slot.textContent = value });
  window.aurora.updateStatus().then(renderUpdateBanner).catch(() => {});
  window.aurora.onUpdateStatus(renderUpdateBanner);
  $("#update-install").addEventListener("click", () => window.aurora.installUpdate());
  $("#update-dismiss").addEventListener("click", () => $("#update-banner").classList.add("hidden"));
}

document.querySelectorAll(".theme-switch button").forEach((button) => button.classList.toggle("active", button.dataset.themeChoice === themeChoice()));

(async function init() {
  try {
    await loadSecrets();
    await migrateSources();
    startAccount().catch(() => {}); // never let the account server hold up opening the library
    const source = activeSource();
    if (source) {
      setLoading(true, "Opening Aurora", "Loading your saved library…");
      state.provider = source;
      state.items = await loadLibrary(source.id);
      libraryIndex = null; state.trending = null;
    }
  } catch (error) { showToast(error.message || "Could not open your library") }
  finally {
    setLoading(false);
    if (state.history.length) render(); else navigate({ view: "home" });
    watchScroll();
    if (!state.provider) setTimeout(() => $("#source-modal").classList.remove("hidden"), 250);
    else if (!state.items.length || Number(readPref("librarySchema", 0)) < LIBRARY_SCHEMA || libraryStale(state.provider)) {
      showToast(state.items.length ? "Updating your library in the background…" : "Loading your library…");
      refreshLibrary(true);
    }
  }
})();
