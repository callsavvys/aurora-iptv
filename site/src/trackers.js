/* Trakt and Simkl, as atlantic.bz connects them (Settings → Account): you
   sign in on their site with a short code, and then
   - in: your watchlist becomes the "Watchlist" list here, what you watched is
     marked watched, and Trakt's paused films and episodes join Continue Watching;
   - out: what you play here is reported (Trakt: start, pause and stop as you
     watch; Simkl: added to your history when you finish).
   They need your own free apps on trakt.tv and simkl.com; the client ids are
   read from trackers.local.json at build time, and Trakt's secret stays with
   the site's relay (relay.cjs, /api/trakt/token). Tokens are kept in this
   browser. */
import { useEffect, useState } from "react";
import { tmdb, IMG } from "./tmdb.js";
import { markWatched, saveProgress, progressKey, getProgress } from "./line.js";
import { addTo } from "./lists.jsx";

const APPS = { trakt: __TRAKT_ID__, simkl: __SIMKL_ID__ };
const NAMES = { trakt: "Trakt", simkl: "Simkl" };
const KEY = (id) => `aurora-site-${id}`;
const read = (id) => { try { return JSON.parse(localStorage.getItem(KEY(id)) || "null"); } catch { return null; } };
const write = (id, v) => { try { if (v) localStorage.setItem(KEY(id), JSON.stringify(v)); else localStorage.removeItem(KEY(id)); } catch { /* private mode */ } };

const live = { trakt: { busy: false, status: "", note: "" }, simkl: { busy: false, status: "", note: "" } };
const subs = new Set();
const ping = () => subs.forEach((fn) => fn());
const set = (id, patch) => { Object.assign(live[id], patch); ping(); };

/* ---- the two APIs ---- */
async function trakt(path, { method = "GET", body } = {}) {
  let tok = read("trakt");
  if (tok && tok.expires_at && Date.now() > tok.expires_at - 86400000) tok = await traktRefresh(tok);
  const r = await fetch(`https://api.trakt.tv${path}`, { method, headers: { "content-type": "application/json", "trakt-api-version": "2", "trakt-api-key": APPS.trakt, ...(tok ? { authorization: `Bearer ${tok.access_token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { write("trakt", null); throw new Error("Trakt signed you out. Connect again."); }
  if (!r.ok) throw new Error(`Trakt answered ${r.status}`);
  return r.status === 204 ? null : r.json();
}
async function traktRefresh(tok) {
  const r = await fetch("/api/trakt/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refresh_token: tok.refresh_token }) });
  if (!r.ok) return tok;
  const t = await r.json();
  const next = { ...tok, ...t, expires_at: (t.created_at + t.expires_in) * 1000 };
  write("trakt", next);
  return next;
}
async function simkl(path, { method = "GET", body } = {}) {
  const tok = read("simkl");
  const r = await fetch(`https://api.simkl.com${path}${path.includes("?") ? "&" : "?"}client_id=${APPS.simkl}`, { method, headers: { "content-type": "application/json", "simkl-api-key": APPS.simkl, ...(tok ? { authorization: `Bearer ${tok.access_token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { write("simkl", null); throw new Error("Simkl signed you out. Connect again."); }
  if (!r.ok) throw new Error(`Simkl answered ${r.status}`);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

/* ---- signing in with a code ---- */
let polling = {};
async function connect(id) {
  if (!APPS[id]) { set(id, { note: `Make a free ${NAMES[id]} app first, then put its client id in site/trackers.local.json (docs/trackers.md).` }); return; }
  clearTimeout(polling[id]);
  try {
    if (id === "trakt") {
      const r = await fetch("https://api.trakt.tv/oauth/device/code", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_id: APPS.trakt }) }).then((x) => x.json());
      window.open(r.verification_url, "_blank", "noopener");
      set(id, { note: `On ${r.verification_url.replace(/^https?:\/\//, "")}, enter ${r.user_code}. This page carries on once you allow it.` });
      const until = Date.now() + r.expires_in * 1000;
      const poll = async () => {
        if (Date.now() > until) { set(id, { note: "That code ran out. Press Connect again." }); return; }
        const t = await fetch("/api/trakt/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: r.device_code }) });
        if (t.status === 200) { const tok = await t.json(); write("trakt", { ...tok, expires_at: (tok.created_at + tok.expires_in) * 1000 }); await signedIn("trakt"); return; }
        if (t.status === 400 && (await t.clone().json().catch(() => ({}))).error === "not_configured") { set(id, { note: "Put your Trakt app's client secret in site/trackers.local.json too (docs/trackers.md)." }); return; }
        if (t.status === 418) { set(id, { note: "You said no on Trakt." }); return; }
        if (t.status === 410 || t.status === 404) { set(id, { note: "That code ran out. Press Connect again." }); return; }
        polling[id] = setTimeout(poll, (t.status === 429 ? r.interval + 1 : r.interval) * 1000);
      };
      polling[id] = setTimeout(poll, r.interval * 1000);
    } else {
      const r = await fetch(`https://api.simkl.com/oauth/pin?client_id=${APPS.simkl}`).then((x) => x.json());
      window.open(r.verification_url, "_blank", "noopener");
      set(id, { note: `On ${String(r.verification_url).replace(/^https?:\/\//, "")}, enter ${r.user_code}. This page carries on once you allow it.` });
      const until = Date.now() + r.expires_in * 1000;
      const poll = async () => {
        if (Date.now() > until) { set(id, { note: "That code ran out. Press Connect again." }); return; }
        const t = await fetch(`https://api.simkl.com/oauth/pin/${r.user_code}?client_id=${APPS.simkl}`).then((x) => x.json()).catch(() => ({}));
        if (t.result === "OK" && t.access_token) { write("simkl", { access_token: t.access_token }); await signedIn("simkl"); return; }
        polling[id] = setTimeout(poll, (r.interval || 5) * 1000);
      };
      polling[id] = setTimeout(poll, (r.interval || 5) * 1000);
    }
  } catch { set(id, { note: `Couldn't reach ${NAMES[id]}. Try again.` }); }
}
async function signedIn(id) {
  const tok = read(id);
  try {
    const me = id === "trakt" ? await trakt("/users/settings") : await simkl("/users/settings");
    write(id, { ...tok, user: me?.user?.username || me?.user?.name || me?.account?.id || "" });
  } catch { /* the name is only for show */ }
  set(id, { note: "" });
  sync(id);
}
function disconnect(id) { clearTimeout(polling[id]); write(id, null); set(id, { status: "", note: "" }); }

/* ---- in: watchlist, watched, paused ---- */
const tmdbEntry = async (type, idNum) => {
  const d = await tmdb(`/${type}/${idNum}`).catch(() => null);
  return d ? { id: String(idNum), type, title: d.title || d.name, poster: d.poster_path ? IMG("w342", d.poster_path) : "", year: (d.release_date || d.first_air_date || "").slice(0, 4) } : null;
};
async function pmap(list, fn, n = 6) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < list.length) { const k = i++; out[k] = await fn(list[k]).catch(() => null); } }));
  return out.filter(Boolean);
}
async function sync(id) {
  if (!read(id) || live[id].busy) return;
  set(id, { busy: true, status: "Syncing..." });
  try {
    let wl = [], watched = [], paused = [];
    if (id === "trakt") {
      const [w, hm, pb] = await Promise.all([trakt("/sync/watchlist"), trakt("/sync/watched/movies"), trakt("/sync/playback")]);
      wl = (w || []).map((x) => (x.movie ? ["movie", x.movie.ids?.tmdb] : x.show ? ["tv", x.show.ids?.tmdb] : null)).filter((x) => x?.[1]);
      watched = (hm || []).map((x) => ["movie", x.movie?.ids?.tmdb, Date.parse(x.last_watched_at) || Date.now()]).filter((x) => x[1]);
      paused = (pb || []).map((x) => (x.type === "movie" ? { type: "movie", tmdb: x.movie?.ids?.tmdb, progress: x.progress, at: Date.parse(x.paused_at) } : { type: "tv", tmdb: x.show?.ids?.tmdb, season: x.episode?.season, episode: x.episode?.number, progress: x.progress, at: Date.parse(x.paused_at), runtime: x.episode?.runtime })).filter((x) => x.tmdb);
    } else {
      const all = await simkl("/sync/all-items/?extended=full");
      const ids = (x) => x?.ids?.tmdb && Number(x.ids.tmdb);
      for (const m of all?.movies || []) { if (m.status === "plantowatch") wl.push(["movie", ids(m.movie)]); if (m.status === "completed") watched.push(["movie", ids(m.movie), Date.parse(m.last_watched_at) || Date.now()]); }
      for (const s of [...(all?.shows || []), ...(all?.anime || [])]) if (s.status === "plantowatch") wl.push(["tv", ids(s.show)]);
      wl = wl.filter((x) => x[1]); watched = watched.filter((x) => x[1]);
    }
    const entries = await pmap(wl.slice(0, 200), ([type, n]) => tmdbEntry(type, n));
    if (entries.length) addTo("Watchlist", entries);
    const marks = await pmap(watched.slice(0, 300), async ([type, n, at]) => { const e = await tmdbEntry(type, n); return e && { ...e, id: Number(e.id), at }; });
    marks.forEach(markWatched);
    // a paused title joins Continue Watching unless this browser has a newer position
    for (const p of paused) {
      const key = progressKey(p.type, p.tmdb, p.season, p.episode);
      const mine = getProgress(key);
      if (mine && (mine.at || 0) >= (p.at || 0)) continue;
      const d = p.type === "movie" ? await tmdb(`/movie/${p.tmdb}`).catch(() => null) : null;
      const minutes = p.type === "movie" ? d?.runtime : p.runtime;
      if (!minutes) continue;
      saveProgress(key, { position: (p.progress / 100) * minutes * 60, duration: minutes * 60, at: p.at || Date.now() });
    }
    set(id, { busy: false, status: `Synced ${entries.length} on the watchlist and ${marks.length} watched, just now.` });
  } catch (e) { set(id, { busy: false, status: e.message || "The sync did not finish." }); }
}

/* ---- out: what you play here ---- */
const traktBody = (meta, progress) => (meta.type === "tv"
  ? { show: { ids: { tmdb: meta.tmdb } }, episode: { season: meta.season, number: meta.episode }, progress }
  : { movie: { ids: { tmdb: meta.tmdb } }, progress });
/* the player says start, pause or stop, with how far it got (0–100) */
export function report(meta, event, progress) {
  if (!meta?.tmdb) return;
  const p = Math.max(0, Math.min(100, Number(progress) || 0));
  if (read("trakt") && APPS.trakt) trakt(`/scrobble/${event}`, { method: "POST", body: traktBody(meta, p) }).catch(() => {});
  if (read("simkl") && APPS.simkl && event === "stop" && p >= 90) {
    const at = new Date().toISOString();
    const body = meta.type === "tv" ? { shows: [{ ids: { tmdb: meta.tmdb }, seasons: [{ number: meta.season, episodes: [{ number: meta.episode, watched_at: at }] }] }] } : { movies: [{ ids: { tmdb: meta.tmdb }, watched_at: at }] };
    simkl("/sync/history", { method: "POST", body }).catch(() => {});
  }
}

/* for Settings: the card's state and buttons */
export function useTracker(id) {
  const [, tick] = useState(0);
  useEffect(() => { const fn = () => tick((n) => n + 1); subs.add(fn); return () => subs.delete(fn); }, []);
  const tok = read(id);
  return { configured: !!APPS[id], connected: !!tok, user: tok?.user || "", ...live[id], connect: () => connect(id), sync: () => sync(id), disconnect: () => disconnect(id) };
}

/* once a day, quietly, for whichever is connected */
export function syncDaily() {
  for (const id of ["trakt", "simkl"]) {
    const tok = read(id);
    if (!tok || !APPS[id]) continue;
    const last = Number(localStorage.getItem(`${KEY(id)}-synced`) || 0);
    if (Date.now() - last < 86400000) continue;
    try { localStorage.setItem(`${KEY(id)}-synced`, String(Date.now())); } catch { /* private mode */ }
    sync(id);
  }
}
