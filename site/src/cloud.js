/* Your data on your account, as atlantic.bz keeps it (its /users/{id}/progress,
   lists, watched and settings): signed in, every browser shows the same
   Continue Watching, watched marks, lists and settings.

   The site keeps everything in localStorage, as before; this mirrors it to the
   account server's site_data table (supabase/migrations/20261120000000_site_data.sql):
   - out: every few seconds it compares what is stored with what it last saw,
     and pushes what changed, removals included;
   - in: on sign-in, when the page comes back into view and every minute, it
     pulls what other devices changed since last time and writes it here.
   The newest change wins. Your source's login is not synced: it stays in
   this browser, as the apps keep theirs in a sealed vault. */
import { start, currentUser } from "./account.js";
import { clearLine } from "./line.js";

const META = "aurora-site-sync";
// aurora-site-old-imported: the older app's Continue Watching was brought across (importOld), once per account
const SETTINGS = ["aurora-site-player", "aurora-site-theme", "aurora-site-titles", "aurora-site-cw-rows", "aurora-site-particles", "aurora-site-old-imported"];
const PUSH_EVERY = 4000, PULL_EVERY = 60000, PAGE = 500;

const json = (k, fallback) => { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } };
const put = (k, v) => { try { if (v === undefined) localStorage.removeItem(k); else localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v)); } catch { /* full or private */ } };

/* what this browser holds now, as {"kind|key": value} */
function snapshot() {
  const out = {};
  for (const [k, v] of Object.entries(json("aurora-site-progress", {}))) out[`progress|${k}`] = v;
  for (const [k, v] of Object.entries(json("aurora-site-watched", {}))) out[`watched|${k}`] = v;
  for (const l of json("aurora-site-lists", [])) if (l?.id) out[`lists|${l.id}`] = l;
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("aurora-site-last:")) out[`last|${k.slice(17)}`] = json(k, null);
      else if (SETTINGS.includes(k)) out[`settings|${k}`] = localStorage.getItem(k);
    }
  } catch { /* private mode */ }
  return out;
}

/* write rows from the server into this browser */
function apply(rows) {
  const progress = json("aurora-site-progress", {}), watched = json("aurora-site-watched", {});
  let lists = json("aurora-site-lists", []);
  const touched = new Set();
  for (const r of rows) {
    const v = r.deleted ? undefined : r.value;
    if (r.kind === "progress") { if (v === undefined) delete progress[r.key]; else progress[r.key] = v; touched.add("progress"); }
    else if (r.kind === "watched") { if (v === undefined) delete watched[r.key]; else watched[r.key] = v; touched.add("watched"); }
    else if (r.kind === "lists") { lists = lists.filter((l) => l.id !== r.key); if (v) lists.push(v); touched.add("lists"); }
    else if (r.kind === "last") put(`aurora-site-last:${r.key}`, v === undefined ? undefined : v);
    else if (r.kind === "settings" && SETTINGS.includes(r.key)) put(r.key, v === undefined ? undefined : String(v));
  }
  if (touched.has("progress")) put("aurora-site-progress", progress);
  if (touched.has("watched")) put("aurora-site-watched", watched);
  if (touched.has("lists")) put("aurora-site-lists", lists.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)));
  if (rows.length) window.dispatchEvent(new Event("aurora-synced"));
}

/* what this browser holds for the account that was here, before another takes over */
function wipe() {
  try {
    for (const k of Object.keys(localStorage)) if (k === "aurora-site-progress" || k === "aurora-site-watched" || k === "aurora-site-lists" || k.startsWith("aurora-site-last:") || SETTINGS.includes(k)) localStorage.removeItem(k);
    clearLine();   // the source too: the next account picks one of its own
  } catch { /* private mode */ }
  window.dispatchEvent(new Event("aurora-synced"));
}
let meta = null, seen = null, timers = [], busy = false, userId = null;
const saveMeta = () => put(META, meta);
const stamp = (id, value) => (id.startsWith("progress|") && value?.at) || 0;

async function pull(sb) {
  let from = 0;
  const rows = [];
  let newest = meta.since || "1970-01-01T00:00:00Z";
  for (;;) {
    const { data, error } = await sb.from("site_data").select("kind,key,value,deleted,updated_at,synced_at").gt("synced_at", meta.since || "1970-01-01T00:00:00Z")
      .order("synced_at", { ascending: true }).order("kind").order("key").range(from, from + PAGE - 1);
    if (error) throw error;
    for (const r of data) {
      const id = `${r.kind}|${r.key}`, at = Date.parse(r.updated_at);
      if (r.synced_at > newest) newest = r.synced_at;
      if ((meta.times[id] || 0) >= at) continue;   // this browser changed it later
      meta.times[id] = at;
      rows.push(r);
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  apply(rows);
  meta.since = newest;
  seen = snapshot();
  saveMeta();
}

async function push(sb) {
  const now = snapshot(), items = [];
  const t = Date.now();
  for (const [id, v] of Object.entries(now)) {
    if (seen && JSON.stringify(seen[id]) === JSON.stringify(v)) continue;
    const at = seen ? t : (stamp(id, v) || meta.times[id] || 1);   // first time: keep what the server has unless ours is dated
    meta.times[id] = at;
    const [kind, key] = [id.slice(0, id.indexOf("|")), id.slice(id.indexOf("|") + 1)];
    items.push({ kind, key, value: v, deleted: false, updated_at: new Date(at).toISOString() });
  }
  for (const id of Object.keys(seen || {})) {
    if (id in now) continue;
    meta.times[id] = t;
    const [kind, key] = [id.slice(0, id.indexOf("|")), id.slice(id.indexOf("|") + 1)];
    items.push({ kind, key, value: null, deleted: true, updated_at: new Date(t).toISOString() });
  }
  for (let i = 0; i < items.length; i += PAGE) {
    const { error } = await sb.rpc("push_site_data", { items: items.slice(i, i + PAGE) });
    if (error) throw error;
  }
  seen = now;
  saveMeta();
}

async function cycle(withPull) {
  if (busy || !userId) return;
  busy = true;
  try {
    const sb = await start();
    if (!sb || currentUser()?.id !== userId) return;
    if (withPull) await pull(sb);
    await push(sb);
  } catch { /* offline: the next round tries again */ } finally { busy = false; }
}

/* The older Aurora (app/) kept its Continue Watching in the account's `progress` table, under
   your line's stream numbers: once per account, what you were partway through there is added
   here by TMDB id (oldHistory.js), unless this interface already has that title. Its old
   records are only read. The mark syncs, so another device does not do it again. */
const OLD_DONE = "aurora-site-old-imported";
async function importOld(sb) {
  if (localStorage.getItem(OLD_DONE)) return;
  const { data, error } = await sb.from("progress").select("key,record,deleted,updated_at").eq("deleted", false).limit(1000);
  if (error) return;   // offline: the next sign-in tries again
  const [{ pickOld, findTmdb }, { tmdb }] = await Promise.all([import("./oldHistory.js"), import("./tmdb.js")]);
  const progress = json("aurora-site-progress", {});
  const have = new Set(Object.keys(progress).map((k) => k.split(":").slice(0, 2).join(":")));
  let added = 0;
  for (const c of pickOld(data)) {
    const hit = await findTmdb(c, tmdb);
    if (!hit || have.has(`${c.type}:${hit.id}`)) continue;
    have.add(`${c.type}:${hit.id}`);
    progress[c.type === "tv" ? `tv:${hit.id}:s${c.season}e${c.episode}` : `movie:${hit.id}`] = { at: c.at, position: c.position, duration: c.duration };
    if (c.type === "tv" && localStorage.getItem(`aurora-site-last:${hit.id}`) == null) put(`aurora-site-last:${hit.id}`, { s: c.season, e: c.episode });
    added += 1;
  }
  if (added) put("aurora-site-progress", progress);
  put(OLD_DONE, "1");
  if (added) window.dispatchEvent(new Event("aurora-synced"));
}

/* signed in: the first pull, then the rounds; signed out: stop */
let first = null;
export function startSync() {
  const u = currentUser();
  if (!u) { stopSync(); return Promise.resolve(); }
  if (userId === u.id && first) return first;
  stopSync();
  userId = u.id;
  meta = json(META, null);
  if (meta && meta.user !== u.id) wipe();   // another account was here: its data is on its account, not this one's
  if (!meta || meta.user !== u.id) meta = { user: u.id, since: null, times: {} };
  seen = null;
  first = (async () => {
    busy = true;
    try { const sb = await start(); await pull(sb); await importOld(sb).catch(() => {}); seen = null; await push(sb); }
    catch { /* offline */ } finally { busy = false; }
    seen = seen || snapshot();
  })();
  timers.push(setInterval(() => cycle(false), PUSH_EVERY));
  timers.push(setInterval(() => cycle(true), PULL_EVERY));
  const back = () => { if (document.visibilityState === "visible") cycle(true); };
  document.addEventListener("visibilitychange", back);
  timers.push(() => document.removeEventListener("visibilitychange", back));
  window.addEventListener("pagehide", flush);
  return first;
}
export function stopSync() {
  timers.forEach((t) => (typeof t === "function" ? t() : clearInterval(t)));
  timers = []; userId = null; first = null;
  window.removeEventListener("pagehide", flush);
}
/* push now (before leaving, or after a big change like Clear Watch History) */
export function flush() { cycle(false); }
