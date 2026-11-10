/* What the web version remembers: your list, how far you got in things, how it
   looks, and which source it reads from. Where it is kept is platform.js's
   business: localStorage in a browser, the system's own storage on the
   television (under this build's own key, never the old app's). A source is a
   login, so the Xtream password is kept here too. */
import { storage, STORE_KEY, legacySource } from "./platform.js";

let data = storage.get(STORE_KEY) || {};
/* private mode, a read-only start, a refused write: it still works, it just forgets */
const save = () => { storage.set(STORE_KEY, data).catch(() => {}); };

export const prefs = {
  get theme() { return data.theme || "teal"; },
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

const itemKey = (item) => `${item.source || "demo"}:${item.kind}:${item.id}`;

export const myList = {
  all: () => data.list || [],
  has: (item) => (data.list || []).some((x) => itemKey(x) === itemKey(item)),
  toggle(item) {
    const list = data.list || [];
    const i = list.findIndex((x) => itemKey(x) === itemKey(item));
    if (i === -1) list.unshift(slim(item)); else list.splice(i, 1);
    data.list = list; save();
    return i === -1;
  },
};

/* Progress is kept per playable thing (a film, or one episode) and points at
   the title it belongs to, so Continue watching can show the series and
   resume the right episode. */
export const progress = {
  get: (id) => (data.progress || {})[id] || null,
  set(id, value) {
    data.progress = data.progress || {};
    if (!value) delete data.progress[id];
    else data.progress[id] = { ...value, at: Date.now() };
    save();
  },
  recent() {
    const seen = new Set();
    return Object.entries(data.progress || {})
      .map(([id, p]) => ({ id, ...p }))
      .filter((p) => p.position > 30 && p.duration && p.position / p.duration < 0.95)
      .sort((a, b) => b.at - a.at)
      .filter((p) => { const k = itemKey(p.item); if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, 20);
  },
};

export function slim(item) {
  const { id, kind, title, year, rating, poster, backdrop, still, overview, badge, source, category } = item;
  return { id, kind, title, year, rating, poster, backdrop, still, overview, badge, source, category };
}
