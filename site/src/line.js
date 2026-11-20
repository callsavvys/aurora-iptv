/* Your IPTV line: the login you type in Settings → Source, kept in this
   browser only; the line's film and series lists; and finding a TMDB title on
   them — by the TMDB id the provider attaches when it has one, else by the
   cleaned name and year (the TV app's matcher, web/js/sources.js). Every
   request goes through the site's relay (relay.cjs). */

const KEY = "aurora-site-line";
export const getLine = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } };
export const setLine = (cfg) => { localStorage.setItem(KEY, JSON.stringify(cfg)); lib = null; loading = null; live = null; };
export const clearLine = () => { localStorage.removeItem(KEY); lib = null; loading = null; live = null; };

const relay = (url) => `/api/proxy?u=${encodeURIComponent(url)}`;
function parts(cfg = getLine()) {
  if (!cfg?.server) return null;
  const server = cfg.server.replace(/\/+$/, "").replace(/^(?!https?:\/\/)/, "http://");
  return { server, u: encodeURIComponent(cfg.username || ""), p: encodeURIComponent(cfg.password || "") };
}
async function api(action = "", extra = "", cfg) {
  const x = parts(cfg);
  if (!x) throw new Error("No line connected");
  const r = await fetch(relay(`${x.server}/player_api.php?username=${x.u}&password=${x.p}${action ? `&action=${action}` : ""}${extra}`));
  const text = await r.text();
  if (!r.ok) throw new Error(/country|not authorized|ip/i.test(text) ? "Your provider refused this connection (country, IP or connection limit), not the login" : `Your provider answered ${r.status}`);
  try { return JSON.parse(text); } catch { throw new Error("Your provider sent something that is not a list"); }
}

export async function testLine(cfg) {
  const a = await api("", "", cfg);
  if (Number(a?.user_info?.auth) !== 1) throw new Error("The provider did not accept this login");
  if (a.user_info.status && a.user_info.status !== "Active") throw new Error(`The account is ${a.user_info.status.toLowerCase()}`);
  return a.user_info;
}

/* ---- the provider's titles, cleaned (from web/js/tmdb.js) ---- */
const LEAD_TAG = /^\s*[[|(]?\s*[A-Za-z]{2,4}\s*[\]|)]?\s*[|:\-–]\s*/u;
function cleanTitle(name) {
  let s = String(name || "");
  for (let i = 0; i < 2; i++) s = s.replace(LEAD_TAG, "");
  return s.replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/\b(4k|uhd|fhd|hd|sd|hevc|x26[45]|h\.?26[45]|multi|vf|vo|vostfr|dub(bed)?|sub(bed)?|imax|remux|blu-?ray|web-?dl|\d{3,4}p|s\d{1,2}(e\d{1,3})?)\b/gi, " ")
    .replace(/[_.]+/g, " ").replace(/\s{2,}/g, " ").trim()
    .replace(/\s+\b((?:19|20)\d{2})\b$/, (m, y) => (Number(y) <= new Date().getFullYear() + 2 ? "" : m)).trim();
}
const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const yearIn = (s) => String(s || "").match(/(19|20)\d\d/)?.[0] || "";

let lib = null, loading = null;
export function loadLibrary(onProgress = () => {}) {
  if (lib) return Promise.resolve(lib);
  return (loading = loading || (async () => {
    onProgress("Loading films from your line…");
    const vs = await api("get_vod_streams");
    onProgress("Loading series from your line…");
    const ss = await api("get_series");
    const movies = (vs || []).map((x) => ({ id: x.stream_id, kind: "movie", name: x.name, year: yearIn(x.year || x.releaseDate || x.name), ext: x.container_extension || "mp4", tmdb: Number(x.tmdb || x.tmdb_id) || 0, rawYear: x.year || String(x.releaseDate || "").slice(0, 4) }));
    const series = (ss || []).map((x) => ({ id: x.series_id, kind: "series", name: x.name, year: yearIn(x.releaseDate || x.name), tmdb: Number(x.tmdb || x.tmdb_id) || 0, rawYear: String(x.releaseDate || "").slice(0, 4) }));
    // rawYear is the year exactly as the apps read it, so watch-party fingerprints agree (web/js/sources.js)
    const byTmdb = new Map(), byName = new Map();
    for (const it of [...movies, ...series]) {
      if (it.tmdb) byTmdb.set(`${it.kind}|${it.tmdb}`, byTmdb.get(`${it.kind}|${it.tmdb}`) || it);
      const k = `${it.kind}|${norm(cleanTitle(it.name))}`;
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(it);
    }
    lib = { movies, series, byTmdb, byName };
    return lib;
  })().finally(() => { loading = null; }));
}

/* ---- live channels: the categories in the line's order, and each one's channels ---- */
// category names tidied as the TV app does (web/js/tmdb.js tidyCategory): no emoji or
// box-drawing furniture, separators as " · ", and no leading country code
const CATEGORY_FURNITURE = /[\u2000-\u209F\u2190-\u2BFF\uFE00-\uFE0F]|[\u{1F000}-\u{1FAFF}]/gu;
function tidyCategory(name) {
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

let live = null;
export function loadLive() {
  return (live = live || (async () => {
    const [cats, streams] = await Promise.all([api("get_live_categories"), api("get_live_streams")]);
    const channels = (streams || []).map((x, i) => ({ id: x.stream_id, kind: "live", name: x.name, logo: x.stream_icon || "", number: x.num || i + 1, categoryId: String(x.category_id) }));
    const count = new Map();
    for (const c of channels) count.set(c.categoryId, (count.get(c.categoryId) || 0) + 1);
    return { categories: (cats || []).map((c) => ({ id: String(c.category_id), name: tidyCategory(c.category_name), count: count.get(String(c.category_id)) || 0 })).filter((c) => c.count), channels };
  })().catch((e) => { live = null; throw e; }));
}

/* what is on a channel now and next, from the line's guide (titles come base64-encoded) */
const unbase = (s) => { try { return decodeURIComponent(escape(atob(s || ""))); } catch { return s || ""; } };
export async function nowNext(ch) {
  const r = await api("get_short_epg", `&stream_id=${ch.id}&limit=2`).catch(() => null);
  return (r?.epg_listings || []).map((e) => ({ title: unbase(e.title), start: Number(e.start_timestamp) * 1000, end: Number(e.stop_timestamp) * 1000 }));
}

/* a TMDB title on your line, or null */
export async function findOnLine({ type, id, title, originalTitle, year }) {
  const L = await loadLibrary();
  const kind = type === "tv" ? "series" : "movie";
  const exact = L.byTmdb.get(`${kind}|${id}`);
  if (exact) return exact;
  const y = Number(year);
  for (const name of [title, originalTitle]) {
    if (!name) continue;
    const hits = L.byName.get(`${kind}|${norm(name)}`) || [];
    const hit = hits.find((h) => !y || !h.year || Math.abs(Number(h.year) - y) <= 1);
    if (hit) return hit;
  }
  return null;
}

/* a series' seasons and episodes as the line has them */
export async function lineEpisodes(seriesId) {
  const r = await api("get_series_info", `&series_id=${seriesId}`);
  const eps = r.episodes || {};
  const out = {};
  for (const [season, list] of Object.entries(eps)) {
    out[Number(season)] = (list || []).map((e) => ({ id: e.id, season: Number(season), number: Number(e.episode_num) || 0, title: e.title || `Episode ${e.episode_num}`, ext: e.container_extension || "mp4" }));
  }
  return out;
}

/* where to play it from, through the relay (a live channel is HLS) */
export function streamUrl(hit, episode) {
  const x = parts();
  if (!x) return "";
  if (hit.kind === "live") return relay(`${x.server}/live/${x.u}/${x.p}/${hit.id}.m3u8`);
  const raw = episode ? `${x.server}/series/${x.u}/${x.p}/${episode.id}.${episode.ext || "mp4"}` : `${x.server}/movie/${x.u}/${x.p}/${hit.id}.${hit.ext || "mp4"}`;
  return relay(raw);
}

/* ---- how far you got, per title (and per episode), in this browser ---- */
const PKEY = "aurora-site-progress";
const readAll = () => { try { return JSON.parse(localStorage.getItem(PKEY) || "{}"); } catch { return {}; } };
export const progressKey = (type, id, season, episode) => `${type}:${id}${season ? `:s${season}e${episode}` : ""}`;
export const getProgress = (key) => readAll()[key] || null;
export const allProgress = () => readAll();
const FINISHED = 0.95;   // past this share a title counts as watched (web/js/sync-core.js)
/* one entry per title, newest first: the latest film or episode position saved
   for it; unfinished only, unless all */
export function titlesWatched({ all = false } = {}) {
  const latest = new Map();
  for (const [key, p] of Object.entries(readAll())) {
    const m = /^(movie|tv):(\d+)(?::s(\d+)e(\d+))?$/.exec(key);
    if (!m || !p?.duration) continue;
    const id = `${m[1]}:${m[2]}`;
    if (!latest.has(id) || (p.at || 0) > (latest.get(id).at || 0)) latest.set(id, { type: m[1], id: Number(m[2]), season: Number(m[3]) || 0, episode: Number(m[4]) || 0, ...p });
  }
  return [...latest.values()].filter((e) => all || e.position < e.duration * FINISHED).sort((a, b) => (b.at || 0) - (a.at || 0));
}
/* forgets a title's progress (Continue Watching's Edit) */
export function forgetProgress(type, id) {
  const all = readAll();
  for (const k of Object.keys(all)) if (k === `${type}:${id}` || k.startsWith(`${type}:${id}:`)) delete all[k];
  localStorage.setItem(PKEY, JSON.stringify(all));
}
export function saveProgress(key, data) {
  const all = readAll();
  all[key] = { ...data, at: Date.now() };
  localStorage.setItem(PKEY, JSON.stringify(all));
}

/* ---- what you marked as watched (Mark as Watched on a title page), in this browser ---- */
const WKEY = "aurora-site-watched";
const readWatched = () => { try { return JSON.parse(localStorage.getItem(WKEY) || "{}"); } catch { return {}; } };
const writeWatched = (all) => { try { localStorage.setItem(WKEY, JSON.stringify(all)); } catch { /* private mode */ } };
export const allWatched = () => Object.values(readWatched()).sort((a, b) => (b.at || 0) - (a.at || 0));
/* marks a title (type, id, title, poster, year) or, if it is marked, unmarks it; returns the new state */
export function toggleWatched(t) {
  const all = readWatched(), key = `${t.type}:${t.id}`;
  if (all[key]) delete all[key]; else all[key] = { type: t.type, id: t.id, title: t.title, poster: t.poster || "", year: t.year || "", at: Date.now() };
  writeWatched(all);
  return !!all[key];
}
export function unwatch(type, id) { const all = readWatched(); delete all[`${type}:${id}`]; writeWatched(all); }
