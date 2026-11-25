/* Your source, kept in this browser only: an Xtream Codes login
   ({kind: "xtream", server, username, password}) or an M3U playlist
   ({kind: "m3u", url} for a link, {kind: "m3u", file} for a file you picked,
   kept in IndexedDB); its film, series and channel lists; and finding a TMDB
   title on them — by the TMDB id the provider attaches when it has one, else
   by the cleaned name and year (the TV app's matcher, web/js/sources.js).
   Every request goes through the site's relay (relay.cjs). */

import { relay, keepLine } from "./platform.js";

const KEY = "aurora-site-line";
// (a device left on Vidora, a source Aurora no longer has, reads as having none: Choose a source asks again)
export const getLine = () => { try { const cfg = JSON.parse(localStorage.getItem(KEY) || "null"); return cfg?.kind === "vidora" ? null : cfg; } catch { return null; } };
export const setLine = (cfg) => { localStorage.setItem(KEY, JSON.stringify(cfg)); keepLine(JSON.stringify(cfg)); lib = null; loading = null; live = null; m3u = null; };
export const clearLine = () => { localStorage.removeItem(KEY); keepLine(null); lib = null; loading = null; live = null; m3u = null; };
const isM3u = (cfg = getLine()) => cfg?.kind === "m3u";
/* what the source is, in a few words */
export function lineLabel(cfg = getLine()) {
  if (!cfg) return "";
  if (isM3u(cfg)) return `M3U playlist · ${cfg.name || (cfg.file ? cfg.file : "link")}`;
  return `Xtream Codes · ${cfg.name || cfg.server}`;
}

/* ---- an M3U playlist: kept as text (a picked file lives in IndexedDB) ---- */
function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("aurora-site", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("files");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => { const tx = open.result.transaction("files", mode); const req = fn(tx.objectStore("files")); tx.oncomplete = () => resolve(req?.result); tx.onerror = () => reject(tx.error); };
  });
}
export const savePlaylistFile = (text) => idb("readwrite", (st) => st.put(text, "m3u"));
const playlistFile = () => idb("readonly", (st) => st.get("m3u"));

const ATTR = /([\w-]+)="([^"]*)"/g;
const SE = /\bS(\d{1,2})\s*[._ -]?\s*E(\d{1,3})\b/i;
const FILE = /\.(mp4|mkv|avi|mov|m4v|webm|wmv|flv)(\?|$)/i;
/* each entry sorted into channels, films, and series' episodes (by its address and name) */
export function parseM3u(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const out = { live: [], movies: [], series: [] };
  const shows = new Map();
  let info = null;
  for (const raw of lines) {
    const ln = raw.trim();
    if (!ln) continue;
    if (ln.startsWith("#EXTINF")) {
      const attrs = {};
      for (const m of ln.matchAll(ATTR)) attrs[m[1].toLowerCase()] = m[2];
      const comma = ln.indexOf(",", ln.lastIndexOf('"') + 1 || 0);
      info = { name: (comma >= 0 ? ln.slice(comma + 1) : "").trim() || attrs["tvg-name"] || "Untitled", logo: attrs["tvg-logo"] || "", group: attrs["group-title"] || "", tmdb: Number(attrs["tvg-tmdb"] || attrs["tmdb"] || 0) || 0 };
      continue;
    }
    if (ln.startsWith("#")) continue;
    const it = info || { name: ln.split("/").pop() || "Untitled", logo: "", group: "", tmdb: 0 };
    info = null;
    const se = SE.exec(it.name);
    if (/\/series\//i.test(ln) || se) {
      const showName = (se ? it.name.slice(0, se.index) : it.name).replace(/[\s\-–|:]+$/, "").trim() || it.group || "Series";
      const key = norm(cleanTitle(showName));
      if (!shows.has(key)) shows.set(key, { id: `s${shows.size}`, kind: "series", name: showName, year: yearIn(showName), rawYear: yearIn(showName), tmdb: 0, episodes: {} });
      const show = shows.get(key);
      const season = se ? Number(se[1]) : 1;
      const eps = (show.episodes[season] = show.episodes[season] || []);
      eps.push({ id: `${show.id}e${season}-${eps.length}`, season, number: se ? Number(se[2]) : eps.length + 1, title: it.name, url: ln });
    } else if (/\/movie\//i.test(ln) || FILE.test(ln)) {
      out.movies.push({ id: `m${out.movies.length}`, kind: "movie", name: it.name, year: yearIn(it.name), rawYear: yearIn(it.name), tmdb: it.tmdb, url: ln, logo: it.logo });
    } else {
      out.live.push({ id: `l${out.live.length}`, kind: "live", name: it.name, logo: it.logo, number: out.live.length + 1, group: it.group || "Channels", url: ln });
    }
  }
  out.series = [...shows.values()];
  for (const s of out.series) for (const list of Object.values(s.episodes)) list.sort((a, b) => a.number - b.number);
  return out;
}
let m3u = null;
async function playlist(cfg = getLine()) {
  if (m3u) return m3u;
  let text = "";
  if (cfg?.text) text = cfg.text;   // a file being tried, before it is kept
  else if (cfg?.url) {
    const r = await fetch(relay(cfg.url));
    if (!r.ok) throw new Error(`The playlist's server answered ${r.status}`);
    text = await r.text();
  } else if (!cfg?.text) text = (await playlistFile()) || "";
  if (!/#EXTM3U|#EXTINF/i.test(text)) throw new Error("That is not an M3U playlist");
  m3u = parseM3u(text);
  return m3u;
}

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
  if (isM3u(cfg)) {
    m3u = null;
    const p = await playlist(cfg);
    const n = p.live.length + p.movies.length + p.series.length;
    if (!n) throw new Error("The playlist has nothing in it");
    return { live: p.live.length, movies: p.movies.length, series: p.series.length };
  }
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
    let movies, series;
    if (isM3u()) {
      onProgress("Loading your playlist…");
      ({ movies, series } = await playlist());
    } else {
      onProgress("Loading films from your line…");
      const vs = await api("get_vod_streams");
      onProgress("Loading series from your line…");
      const ss = await api("get_series");
      movies = (vs || []).map((x) => ({ id: x.stream_id, kind: "movie", name: x.name, year: yearIn(x.year || x.releaseDate || x.name), ext: x.container_extension || "mp4", tmdb: Number(x.tmdb || x.tmdb_id) || 0, rawYear: x.year || String(x.releaseDate || "").slice(0, 4) }));
      series = (ss || []).map((x) => ({ id: x.series_id, kind: "series", name: x.name, year: yearIn(x.releaseDate || x.name), tmdb: Number(x.tmdb || x.tmdb_id) || 0, rawYear: String(x.releaseDate || "").slice(0, 4) }));
    }
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
    if (isM3u()) {
      const { live: chans } = await playlist();
      const groups = [];
      const channels = chans.map((c) => { if (!groups.includes(c.group)) groups.push(c.group); return { ...c, categoryId: String(groups.indexOf(c.group)) }; });
      return { categories: groups.map((g, i) => ({ id: String(i), name: tidyCategory(g), count: channels.filter((c) => c.categoryId === String(i)).length })), channels };
    }
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
  if (isM3u()) return [];
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
  if (isM3u()) return (await playlist()).series.find((s) => s.id === seriesId)?.episodes || {};
  const r = await api("get_series_info", `&series_id=${seriesId}`);
  const eps = r.episodes || {};
  const out = {};
  for (const [season, list] of Object.entries(eps)) {
    out[Number(season)] = (list || []).map((e) => ({ id: e.id, season: Number(season), number: Number(e.episode_num) || 0, title: e.title || `Episode ${e.episode_num}`, ext: e.container_extension || "mp4" }));
  }
  return out;
}

/* where to play it from, through the relay (a live channel is HLS) */
/* an M3U channel as HLS: browsers cannot play MPEG-TS, and an Xtream
   server's playlist lists channels as …/user/pass/123(.ts) */
function hlsOf(url) {
  if (/\.m3u8(\?|$)/i.test(url)) return url;
  const m = /^(https?:\/\/[^/]+)\/(?:live\/)?([^/]+)\/([^/]+)\/(\d+)(?:\.ts)?$/i.exec(url);
  return m ? `${m[1]}/live/${m[2]}/${m[3]}/${m[4]}.m3u8` : url;
}
export function streamUrl(hit, episode) {
  if (episode?.url) return relay(episode.url);
  if (hit.url) return relay(hit.kind === "live" ? hlsOf(hit.url) : hit.url);
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
  all[key] = { at: Date.now(), ...data };
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

/* Settings → Account → Clear Watch History: progress, watched marks and where each series was left */
export function clearHistory() {
  try {
    for (const k of Object.keys(localStorage)) if (k === PKEY || k === WKEY || k.startsWith("aurora-site-last:")) localStorage.removeItem(k);
  } catch { /* private mode */ }
}
/* marks a title watched (Trakt and Simkl's history), leaving one already marked as it is */
export function markWatched(t) {
  const all = readWatched(), key = `${t.type}:${t.id}`;
  if (all[key]) return;
  all[key] = { type: t.type, id: t.id, title: t.title, poster: t.poster || "", year: t.year || "", at: t.at || Date.now() };
  writeWatched(all);
}
