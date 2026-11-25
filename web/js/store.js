/* What the web version remembers.

   Your list and how far you got in things are the records the old app keeps,
   in its own shape (web/js/sync-core.js holds the rules both apps follow): on
   the television they are the old app's `prefs`, so installing either
   interface over the other loses nothing; in a browser, the same shape under
   `aurora-web`. Every write is read-modify-write and keeps fields this app
   does not know about.

   How it looks, the language and region, and the source a browser reads from
   are this app's alone, kept under its own key. A source is a login, so the
   Xtream password is kept here too (on the television the sources are the old
   app's `secrets`, read by platform.js). */
import { storage, STORE_KEY, SHARED_KEY, legacySource, native } from "./platform.js";
import { PROGRESS_THROTTLE_MS } from "./limits.js";

const Sync = globalThis.AuroraSync;
const SHARED_FIELDS = ["favorites", "favoriteTimes", "progress", "progressGone", "syncDirty"];

let data = storage.get(STORE_KEY) || {};
/* private mode, a read-only start, a refused write: it still works, it just forgets */
const save = () => { storage.set(STORE_KEY, data).catch(() => {}); };

/* The shared records, held in memory and written back onto whatever the key
   holds now, so a field written by the old app (its theme, sync cursor, an
   update it knows about) is never dropped. */
const sharedBase = () => (SHARED_KEY === STORE_KEY ? data : storage.get(SHARED_KEY) || {});
const shared = (() => {
  const base = { ...sharedBase() };
  // a trace build starts from the owner's real list and progress, read-only
  if (SHARED_KEY === STORE_KEY && native && !base.progress) Object.assign(base, pick(storage.get("prefs") || {}));
  return {
    favorites: new Set(Array.isArray(base.favorites) ? base.favorites : []),
    favoriteTimes: base.favoriteTimes || {},
    progress: new Map(Object.entries(base.progress && typeof base.progress === "object" ? base.progress : {})),
    progressGone: base.progressGone || {},
    syncDirty: base.syncDirty || { favorites: {}, progress: {} },
  };
})();
function pick(obj) { const out = {}; for (const k of SHARED_FIELDS) if (k in obj) out[k] = obj[k]; return out; }

function writeShared() {
  shared.progress = Sync.capProgress(shared.progress);
  const fields = {
    favorites: [...shared.favorites], favoriteTimes: shared.favoriteTimes,
    progress: Object.fromEntries(shared.progress), progressGone: shared.progressGone, syncDirty: shared.syncDirty,
  };
  if (SHARED_KEY === STORE_KEY) { Object.assign(data, fields); save(); return; }
  storage.set(SHARED_KEY, { ...(storage.get(SHARED_KEY) || {}), ...fields }).catch(() => {});
}
const dirty = (kind, id) => { shared.syncDirty = Sync.markDirty(shared.syncDirty, kind, id, Date.now()); };

/* The old app's theme ids are system/light/dark; this app has dark themes only
   and never writes the old one. Every one of them lands on Ocean, the default. */
const OLD_THEME = { system: "ocean", light: "ocean", dark: "ocean" };

export const prefs = {
  get theme() { return data.theme || (native && OLD_THEME[storage.get("prefs")?.theme]) || "ocean"; },
  set theme(v) { data.theme = v; save(); },
  get motion() { return data.motion !== false; },
  set motion(v) { data.motion = v; save(); },
  get titles() { return data.titles !== false; },
  set titles(v) { data.titles = v; save(); },
  // on the television, the line the old app was playing until one is chosen here
  get source() { return data.source || legacySource() || { kind: "demo" }; },
  set source(v) { data.source = v; save(); },
  // the language TMDB answers in, for titles and plots; the country whose age
  // ratings and streaming services are shown
  get lang() { return data.lang || "en"; },
  set lang(v) { data.lang = v; save(); },
  get region() { return data.region || "EG"; },
  set region(v) { data.region = v; save(); },
};

/* What TMDB matched each provider title to, so a hundred-thousand-item line is
   only ever looked up once per title — and a title that matched nothing is
   remembered too, for a week, so it is not searched for on every visit. */
const MATCHES = "aurora-web-tmdb";
let matches = (() => { try { return JSON.parse(localStorage.getItem(MATCHES)) || {}; } catch { return {}; } })();
let matchTimer = null;
export const tmdbMatches = {
  get: (key) => {
    const m = matches[key];
    if (!m) return undefined;
    if (!m.id && Date.now() - m.at > 7 * 864e5) return undefined;
    return m;
  },
  set(key, value) {
    matches[key] = { ...value, at: Date.now() };
    clearTimeout(matchTimer);
    matchTimer = setTimeout(() => { try { localStorage.setItem(MATCHES, JSON.stringify(matches)); } catch { /* full: forget the oldest half */ matches = Object.fromEntries(Object.entries(matches).slice(-5000)); } }, 400);
  },
};

const OMDB_USE = "aurora-web-omdb";
export function omdbBudget(perDay = 700) {
  const today = new Date().toISOString().slice(0, 10);
  let u = { date: today, used: 0 };
  try { const s = JSON.parse(localStorage.getItem(OMDB_USE)); if (s?.date === today) u = s; } catch { /* first use */ }
  return { left: perDay - u.used, spend() { u.used += 1; try { localStorage.setItem(OMDB_USE, JSON.stringify(u)); } catch { /* fine */ } } };
}

// ---------- ids: the old app's, so both apps name the same thing the same way ----------

/* An Xtream film is `movie-<stream_id>` in the old app, a series
   `series-<series_id>`, a channel `live-<stream_id>`. The demo catalogue has
   no old-app equivalent and keeps its own prefix. */
export const sharedId = (item) => (item.source === "xtream" ? `${item.kind}-${item.id}` : `${item.source || "demo"}-${item.kind}-${item.id}`);
function fromSharedId(id) {
  const m = /^(?:(demo)-)?(movie|series|live)-(.+)$/.exec(String(id));
  if (!m) return null;
  const raw = m[3], num = Number(raw);
  return { source: m[1] || "xtream", kind: m[2], id: Number.isFinite(num) && String(num) === raw ? num : raw };
}
const episodeKey = (ep) => `episode-${ep.id}`;

/* A progress record in the old app's shape, from this app's item and episode. */
function recordOf(item, episode, next) {
  if (!episode) {
    const record = { key: sharedId(item), id: sharedId(item), type: item.kind === "live" ? "live" : "movie", title: item.title, subtitle: item.category || "", poster: item.poster || "" };
    // a film's file type, so resuming asks the provider for the right file (the old app ignores it)
    if (item.kind === "movie" && item.ext) record.container = item.ext;
    return record;
  }
  return {
    key: episodeKey(episode), id: sharedId(item), type: "episode", title: item.title,
    subtitle: `S${episode.season} E${episode.number} • ${episode.title || `Episode ${episode.number}`}`, poster: item.poster || "",
    seriesId: item.id, season: String(episode.season), episodeId: episode.id, container: episode.ext || "mp4",
    // only when known: the merge keeps the hint the old app (or an earlier save) wrote
    ...(next ? { next: { season: String(next.season), episodeId: next.id, number: String(next.number), title: next.title || `Episode ${next.number}`, container: next.ext || "mp4" } } : {}),
  };
}

/* And back: what this app's screens and player need from a record. */
function entryOf(record) {
  const ref = fromSharedId(record.id) || { source: "xtream", kind: record.type === "episode" ? "series" : record.type, id: record.id };
  const item = { id: ref.id, kind: ref.kind, source: ref.source, title: record.title, poster: record.poster || "", category: record.type === "episode" ? "" : record.subtitle || "" };
  if (record.type === "movie" && record.container) item.ext = record.container;
  let episode = null;
  if (record.type === "episode") {
    const m = /^S(\S+) E(\S+) • (.*)$/.exec(record.subtitle || "");
    episode = { id: record.episodeId, season: Number(record.season), number: Number(m?.[2]) || 0, title: m?.[3] || "", ext: record.container || "mp4" };
  }
  return { id: record.key, item, episode, position: record.position || 0, duration: record.duration || 0, updatedAt: record.updatedAt || 0 };
}

// ---------- My List ----------

/* `favorites` holds ids, as in the old app; what a card needs to draw is kept
   beside it in this app's own key, and a list entry the old app added is
   looked up in the library (see `items`). */
export const myList = {
  ids: () => [...shared.favorites],
  has: (item) => shared.favorites.has(sharedId(item)),
  toggle(item) {
    const id = sharedId(item);
    const added = !shared.favorites.has(id);
    if (added) shared.favorites.add(id); else shared.favorites.delete(id);
    shared.favoriteTimes = Sync.noteFavorite(shared.favoriteTimes, id, added, Date.now());
    dirty("favorites", id);
    data.listItems = { ...(data.listItems || {}) };
    if (added) data.listItems[id] = slim(item); else delete data.listItems[id];
    save(); writeShared();
    return added;
  },
  /* The list as cards, newest first, for one source. `lookup(refs)` finds
     items the old app added (resolves to items with the same id and kind). */
  async items(sourceKind, lookup) {
    const saved = data.listItems || {};
    const times = shared.favoriteTimes;
    const ids = [...shared.favorites].sort((a, b) => (times[b]?.at || 0) - (times[a]?.at || 0));
    const missing = ids.filter((id) => !saved[id]).map(fromSharedId).filter((r) => r && r.source === sourceKind);
    const found = missing.length && lookup ? await lookup(missing).catch(() => []) : [];
    const byId = new Map(found.map((x) => [sharedId(x), x]));
    return ids.map((id) => saved[id] || byId.get(id)).filter((x) => x && (x.source || "demo") === sourceKind);
  },
};

// ---------- watch progress ----------

let lastProgressWrite = 0, progressTimer = null;
function writeProgressSoon(force) {
  clearTimeout(progressTimer); progressTimer = null;
  const wait = lastProgressWrite + PROGRESS_THROTTLE_MS - Date.now();
  if (force || wait <= 0) { lastProgressWrite = Date.now(); writeShared(); return; }
  progressTimer = setTimeout(() => writeProgressSoon(true), wait);
}

export const progress = {
  forItem: (item) => { const r = shared.progress.get(sharedId(item)); return r ? entryOf(r) : null; },
  forEpisode: (episode) => { const r = shared.progress.get(episodeKey(episode)); return r ? entryOf(r) : null; },
  /* Where playback is: at most one write per PROGRESS_THROTTLE_MS unless
     `force` (pause, stop, the end, leaving the player). A finished record is
     kept, as the old app keeps it: it is the watched mark and the History. */
  save(item, episode, position, duration, { next = null, force = false } = {}) {
    const record = { ...recordOf(item, episode, next), position, duration };
    Sync.mergeProgress(shared.progress, record, Date.now());
    dirty("progress", record.key);
    writeProgressSoon(force);
  },
  /* A channel is remembered when it is played, with no position. */
  played(channel) {
    const record = { ...recordOf(channel, null), position: 0, duration: 0 };
    Sync.mergeProgress(shared.progress, record, Date.now());
    dirty("progress", record.key);
    writeProgressSoon(true);
  },
  /* Continue watching, in the old app's rules: films past 20 s and short of
     95%, shows on their newest episode or the next one after a finished one. */
  recent(sourceKind) {
    return Sync.continueWatching(shared.progress)
      .map((row) => ({ ...entryOf(row.record), fresh: !!row.fresh }))
      .filter((p) => !sourceKind || p.item.source === sourceKind);
  },
  hide(entry) {
    for (const key of Sync.hideProgress(shared.progress, [entry.id], Date.now())) dirty("progress", key);
    writeShared();
  },
  forget(entry) {
    const { gone, changed } = Sync.forgetProgress(shared.progress, shared.progressGone, [entry.id], Date.now());
    shared.progressGone = gone;
    for (const key of changed) dirty("progress", key);
    writeShared();
  },
  history: () => Sync.watchHistory(shared.progress).map(entryOf),
};

// ---------- the browser's old web-only shape, converted once ----------

/* Before the shared store, a browser kept `list` (whole items) and
   `progress` keyed `<source>:<kind>:<id>` / `<source>:ep:<episodeId>` with
   `at`. They become the shared records once; `v` stops it running again. */
(function migrate() {
  if (SHARED_KEY !== STORE_KEY || native || (data.v || 0) >= 2) return;
  const list = Array.isArray(data.list) ? data.list : [];
  const oldProgress = data.progress && typeof data.progress === "object" && !Array.isArray(data.progress) ? data.progress : {};
  const looksOld = list.length || Object.values(oldProgress).some((p) => p && p.item && "at" in p);
  if (looksOld) {
    data.listItems = { ...(data.listItems || {}) };
    list.slice().reverse().forEach((item, i) => {
      const id = sharedId(item);
      shared.favorites.add(id);
      shared.favoriteTimes = Sync.noteFavorite(shared.favoriteTimes, id, true, i + 1);
      data.listItems[id] = slim(item);
    });
    const records = new Map();
    for (const p of Object.values(oldProgress)) {
      if (!p || !p.item || !("at" in p)) continue;
      const record = { ...recordOf(p.item, p.episode || null, null), position: p.position || 0, duration: p.duration || 0, updatedAt: p.at || 0 };
      records.set(record.key, record);
    }
    shared.progress = records;
    delete data.list;
  }
  data.v = 2;
  writeShared();
})();

export function slim(item) {
  const { id, kind, title, year, rating, poster, backdrop, still, overview, badge, source, category } = item;
  return { id, kind, title, year, rating, poster, backdrop, still, overview, badge, source, category };
}
