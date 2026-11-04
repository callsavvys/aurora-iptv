/* What the web version remembers, in this browser only: your list, how far
   you got in things, how it looks, and which source it reads from. A source
   is a login, so the Xtream password is kept here too — this is a local test
   build on your own machine, not something to deploy as it is. */
const KEY = "aurora-web";
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
let data = read();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* private mode: it still works, it just forgets */ } };

export const prefs = {
  get theme() { return data.theme || "teal"; },
  set theme(v) { data.theme = v; save(); },
  get motion() { return data.motion !== false; },
  set motion(v) { data.motion = v; save(); },
  get titles() { return data.titles !== false; },
  set titles(v) { data.titles = v; save(); },
  get source() { return data.source || { kind: "demo" }; },
  set source(v) { data.source = v; save(); },
};

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
