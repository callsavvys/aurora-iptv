/* The focus engine. Everything the remote can do goes through here, and a
   keyboard drives it with the same keys: arrows move, Enter chooses, Backspace
   or Escape goes back. If it is right on a keyboard it is right on a remote.

   The rules, most of them Apple's (tvOS Human Interface Guidelines):
   - every control is reachable with the arrows alone; there is no pointer;
   - focus only moves when the person moves it, except when the focused thing
     disappears, and then it goes to something next to where it was;
   - focus is always visible, and never off the screen;
   - pressing gives instant feedback before the press does anything;
   - a zone (a row, the tab bar, a keyboard) remembers where you were in it,
     so going down and back up returns you to the same poster;
   - entering the tab bar lands on the tab you are on, not the one that
     happens to be nearest;
   - rows and the page move to the item, never the item to the edge. */

const SLACK = 2;
const MISS_WEIGHT = 3;      // being off the line of travel costs more than distance along it
const CENTRE_WEIGHT = 0.35;
const MOVES = {
  ArrowLeft: { axis: "x", back: true }, ArrowRight: { axis: "x", back: false },
  ArrowUp: { axis: "y", back: true }, ArrowDown: { axis: "y", back: false },
};

let stageScale = 1;
const memory = new WeakMap();          // zone element -> last focused element in it
const layers = [];                      // stack of { root, opener }
let onBack = () => false;
let lastMove = 0;
let motion = true;

export const setScale = (s) => { stageScale = s || 1; };
export const setMotion = (on) => { motion = on; document.documentElement.classList.toggle("instant", !on); };
export const setBackHandler = (fn) => { onBack = fn; };

const layerRoot = () => (layers.length ? layers[layers.length - 1].root : document.getElementById("app"));

function visible(el) {
  if (!el.isConnected || el.closest("[hidden], .is-hidden")) return false;
  const r = el.getBoundingClientRect();
  return r.width > 2 && r.height > 2;
}
export const focusables = (root = layerRoot()) => [...root.querySelectorAll("[data-f]")].filter((el) => !el.disabled && visible(el));
const zoneOf = (el) => el.closest("[data-zone]");

function spans(r, axis) {
  return axis === "x" ? { near: r.left, far: r.right, lo: r.top, hi: r.bottom } : { near: r.top, far: r.bottom, lo: r.left, hi: r.right };
}
function rank(from, to, move) {
  const f = spans(from, move.axis), t = spans(to, move.axis);
  const travel = move.back ? f.near - t.far : t.near - f.far;
  if (travel < -SLACK) return null;
  const miss = Math.max(0, Math.max(f.lo, t.lo) - Math.min(f.hi, t.hi));
  const centre = Math.abs((f.lo + f.hi) / 2 - (t.lo + t.hi) / 2);
  return Math.max(0, travel) + miss * MISS_WEIGHT + centre * CENTRE_WEIGHT;
}

// ---------- moving things into view ----------
const px = (v) => v / stageScale;

function bringRowTo(el) {
  const row = el.closest("[data-track]");
  if (!row) return;
  const track = row.querySelector(":scope > .track");
  if (!track) return;
  const vertical = row.dataset.track === "y";
  const pad = Number(row.dataset.pad ?? (vertical ? 24 : 80));
  const viewport = vertical ? row.clientHeight : row.clientWidth;
  const full = vertical ? track.scrollHeight : track.scrollWidth;
  const start = vertical ? el.offsetTop : el.offsetLeft;
  const size = vertical ? el.offsetHeight : el.offsetWidth;
  let at = Number(row.dataset.at || 0);
  if (start - at < pad) at = start - pad;
  else if (start + size - at > viewport - pad) at = start + size - viewport + pad;
  at = Math.max(0, Math.min(at, Math.max(0, full - viewport)));
  row.dataset.at = at;
  track.style.transform = vertical ? `translate3d(0, ${-at}px, 0)` : `translate3d(${-at}px, 0, 0)`;
}

function bringPageTo(el) {
  const page = el.closest("[data-page]");
  if (!page) return;
  const scroller = page.querySelector(":scope > .scroller");
  if (!scroller) return;
  let section = el.closest("[data-section]");
  while (section && section.parentElement !== scroller) section = section.parentElement?.closest("[data-section]");
  if (!section) return;
  const anchor = Number(page.dataset.anchor ?? 110);
  const first = section === scroller.firstElementChild;
  const max = Math.max(0, scroller.scrollHeight - page.clientHeight);
  let y;
  if (first) y = 0;
  else if (section.offsetHeight > page.clientHeight - anchor) {
    // a section taller than the screen (a grid): keep the focused item in view
    const top = topWithin(el, scroller);
    y = Number(page.dataset.y || 0);
    if (top - y < anchor) y = top - anchor;
    else if (top + el.offsetHeight - y > page.clientHeight - 60) y = top + el.offsetHeight - page.clientHeight + 60;
  } else y = section.offsetTop - anchor;
  y = Math.max(0, Math.min(y, max));
  page.dataset.y = y;
  scroller.style.transform = `translate3d(0, ${-y}px, 0)`;
  page.dispatchEvent(new CustomEvent("page:scroll", { detail: y, bubbles: true }));
}
// layout position inside the scroller, ignoring the transform that moves it
function topWithin(node, scroller) {
  let y = 0;
  while (node && node !== scroller) { y += node.offsetTop; node = node.offsetParent; }
  return y;
}

// ---------- focusing ----------
export function focus(el, { remember = true } = {}) {
  if (!el) return;
  const previous = document.activeElement;
  el.focus({ preventScroll: true });
  if (remember) {
    for (let z = zoneOf(el); z; z = zoneOf(z.parentElement)) memory.set(z, el);
  }
  bringRowTo(el);
  bringPageTo(el);
  document.dispatchEvent(new CustomEvent("focus:moved", { detail: { el, previous } }));
}

function preferredIn(zone, fallback) {
  // the tab bar, a row of filter chips, a channel list: entering lands on the
  // one that is selected, not the one that happens to be nearest
  if (zone.dataset.prefer) {
    const chosen = zone.querySelector(zone.dataset.prefer);
    if (chosen && visible(chosen)) return chosen;
  }
  const held = memory.get(zone);
  if (held && zone.contains(held) && visible(held) && onScreen(held)) return held;
  return fallback;
}
function onScreen(el) {
  const r = el.getBoundingClientRect();
  // the real window, not innerWidth, which a TV WebView inflates (see fit() in app.js)
  const root = document.documentElement;
  return r.right > 0 && r.left < root.clientWidth && r.bottom > 0 && r.top < root.clientHeight;
}

/* Every focusable that is drawn, each measured once. A press on the TV used to
   re-measure and re-check all of them two or three times (908 on Live TV: 61 ms
   a press on the Google TV, so a held arrow queued up and froze the screen).
   `near` keeps only boxes within a screen of the focused one; the box test runs
   first because it is cheap, and display:none ([hidden], .is-hidden) measures 0. */
function candidates(root, near) {
  const out = [];
  for (const el of root.querySelectorAll("[data-f]")) {
    if (el.disabled) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 2 || r.height <= 2 || (near && !near(r))) continue;
    out.push({ el, r, zone: zoneOf(el) });
  }
  return out;
}
// within a screen of the focused box, not of the window: a row or page that is
// still sliding (its transform animates) measures where it was, so during a
// quick run of presses the focused item can be a screen or more off the window
function nearWindow(from) {
  const w = document.documentElement.clientWidth, h = document.documentElement.clientHeight;
  return (r) => r.right > from.left - w && r.left < from.right + w && r.bottom > from.top - h && r.top < from.bottom + h;
}

function pick(items, current, from, fromZone, dir, way) {
  // a zone can close itself along an axis: the tab bar does not spill sideways
  // into the page, and a row does not spill sideways into the bar. A list can
  // still be left in one named direction once there is nothing further inside
  // it that way — up, off the top of Live TV's categories, to the tab bar.
  const locked = fromZone?.dataset.lock?.includes(dir.axis);
  const inZone = locked && items.some((c) => c.el !== current && c.zone === fromZone && rank(from, c.r, dir) !== null);
  const sealed = locked && (inZone || !fromZone.dataset.leave?.includes(way));
  let best = null, score = Infinity;
  for (const { el, r, zone } of items) {
    if (el === current) continue;
    if (sealed && zone !== fromZone) continue;
    if (zone && zone !== fromZone && zone.dataset.enter && !zone.dataset.enter.includes(way)) continue;
    const s = rank(from, r, dir);
    if (s !== null && s < score) { score = s; best = el; }
  }
  return { best, locked: !!locked, inZone: !!inZone };
}

export function move(key) {
  const dir = MOVES[key];
  const root = layerRoot();
  const current = document.activeElement;
  if (!current || current === document.body || !root.contains(current) || !visible(current)) return focusStart();
  const from = current.getBoundingClientRect();
  const fromZone = zoneOf(current);
  const way = key.replace("Arrow", "").toLowerCase();
  // the nearest target is almost always within a screen; look further only
  // when nothing near qualifies, or when a locked zone looked empty nearby
  // (its next member may sit further off, and leaving it then would be wrong)
  let found = pick(candidates(root, nearWindow(from)), current, from, fromZone, dir, way);
  if (!found.best || (found.locked && !found.inZone)) found = pick(candidates(root), current, from, fromZone, dir, way);
  let { best } = found;
  if (!best) { nudge(current, dir); return; }
  // a zone can name where leaving it lands: down out of the tab bar enters the
  // page at its start, not on whatever happens to sit under the button
  const exit = fromZone?.dataset[`exit${key.replace("Arrow", "")}`];
  if (exit && !fromZone.contains(best)) {
    const target = document.querySelector(exit);
    if (target && visible(target)) { focus(target); return; }
  }
  const toZone = zoneOf(best);
  if (toZone && toZone !== fromZone && !toZone.contains(current)) best = preferredIn(toZone, best);
  focus(best);
}

// at an edge with nowhere to go: a small shake, so the press is not ignored
function nudge(el, dir) {
  el.classList.remove("nudge-x", "nudge-y"); void el.offsetWidth;
  el.classList.add(dir.axis === "x" ? "nudge-x" : "nudge-y");
}

export function focusStart() {
  const root = layerRoot();
  const start = root.querySelector("[data-start]");
  focus(start && visible(start) ? start : focusables(root)[0]);
}

/* A screen describes what held focus rather than holding the node, because a
   re-render builds new nodes. */
export const signature = (el) => el?.dataset?.key || null;
export function restore(key) {
  const el = key && layerRoot().querySelector(`[data-key="${CSS.escape(key)}"]`);
  if (el && visible(el)) { focus(el); return true; }
  return false;
}

// ---------- layers (player, dialogs) ----------
export function pushLayer(root) {
  layers.push({ root, opener: document.activeElement });
  focusStart();
}
export function popLayer(root) {
  const i = layers.findIndex((l) => l.root === root);
  if (i === -1) return;
  const [{ opener }] = layers.splice(i, 1);
  if (opener && opener.isConnected && visible(opener)) focus(opener, { remember: false });
  else focusStart();
}
export const inLayer = () => layers.length > 0;

// focus that vanished (a row re-rendered, a dialog closed) goes somewhere near
new MutationObserver(() => {
  const a = document.activeElement;
  if (!a || a === document.body || !a.isConnected) queueMicrotask(() => {
    const now = document.activeElement;
    if (!now || now === document.body) focusStart();
  });
}).observe(document.documentElement, { childList: true, subtree: true });

// ---------- keys ----------
export const isTyping = (el = document.activeElement) => !!el && (el.matches("textarea") || (el.matches("input") && !el.readOnly && !/^(button|checkbox|radio|range)$/.test(el.type)));

document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const typing = isTyping();
  if (MOVES[e.key]) {
    if (typing && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      const el = document.activeElement;
      const atEdge = e.key === "ArrowLeft" ? el.selectionStart === 0 : el.selectionEnd === el.value.length;
      if (!atEdge) return;
    }
    if (document.activeElement?.closest("[data-keys-own]") && document.activeElement.closest("[data-keys-own]").dispatchEvent(new CustomEvent("own:key", { detail: e.key, cancelable: true })) === false) { e.preventDefault(); return; }
    e.preventDefault();
    const now = performance.now();
    if (e.repeat && now - lastMove < 70) return;     // held arrow: fast, but not faster than the screen
    lastMove = now;
    move(e.key);
    return;
  }
  if (e.key === "Enter" && !typing) {
    e.preventDefault();
    if (e.repeat) return;
    const el = document.activeElement;
    if (el && el !== document.body) el.classList.add("pressed");
    return;
  }
  if (e.key === "Escape" || (e.key === "Backspace" && !typing)) {
    e.preventDefault();
    // inside a field, Escape finishes typing and keeps focus where it is;
    // blurring would leave the remote holding nothing
    if (typing) { document.activeElement.readOnly = true; return; }
    onBack(e.key);
  }
}, true);

/* A mouse wheel or a trackpad moves the focus as the arrows do, one step per
   notch: on a laptop people scroll before they reach for the keys, and a page
   that ignores it feels broken. Small trackpad deltas add up to a step. */
let wheelX = 0, wheelY = 0, lastWheel = 0;
document.addEventListener("wheel", (e) => {
  if (e.ctrlKey) return;                         // pinch zoom stays the browser's
  e.preventDefault();
  wheelX += e.deltaX; wheelY += e.deltaY;
  const now = performance.now();
  if (now - lastWheel < 90) return;
  const STEP = 40;
  let key = null;
  if (Math.abs(wheelY) >= STEP && Math.abs(wheelY) >= Math.abs(wheelX)) key = wheelY > 0 ? "ArrowDown" : "ArrowUp";
  else if (Math.abs(wheelX) >= STEP) key = wheelX > 0 ? "ArrowRight" : "ArrowLeft";
  if (!key) return;
  wheelX = 0; wheelY = 0; lastWheel = now;
  const own = document.activeElement?.closest("[data-keys-own]");
  if (own && own.dispatchEvent(new CustomEvent("own:key", { detail: key, cancelable: true })) === false) return;
  move(key);
}, { passive: false });

document.addEventListener("keyup", (e) => {
  if (e.key !== "Enter" || isTyping()) return;
  const el = document.activeElement;
  if (!el || !el.classList.contains("pressed")) return;
  el.classList.remove("pressed");
  el.dispatchEvent(new CustomEvent("choose", { bubbles: true }));
  el.click();
}, true);
