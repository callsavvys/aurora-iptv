/* The TV remote, for every page of the site at once: the arrows move focus to
   the nearest thing you can press in that direction (by where things are on
   screen, so no page needs wiring), the page scrolls to keep it in view, OK
   presses it, and Back closes what is open (a player panel, then the
   player), else goes back a page, else leaves the app.

   In the player, the arrows keep their own meaning (skip, volume, channel)
   until Down or OK brings up the controls; from there they move between the
   buttons, and Back returns to the picture. */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
const DIRS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

const visible = (el) => {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const st = getComputedStyle(el);
  if (st.visibility === "hidden" || st.pointerEvents === "none" && el.tagName !== "A") return false;
  const hero = el.closest("[data-tv-hero]");   // faded while you are in the rows, but still where Up goes
  for (let p = el; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p); if (s.display === "none" || (s.opacity === "0" && !(hero && p === hero))) return false; }
  return true;
};
/* what the arrows move between: the open panel or dialog, else the player, else the page */
function scope() {
  const panel = document.querySelector(".pm-card, .w-\\[343px\\], [role=dialog], [role=listbox]");
  if (panel && visible(panel)) return panel;
  const player = document.querySelector(".fixed.inset-0.z-\\[60\\]");
  return player || document.body;
}
const candidates = (root) => [...root.querySelectorAll(FOCUSABLE)].filter(visible);

/* a text box the remote lands on stays shut (no keyboard) until OK opens it */
const TEXT = "input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]), textarea";
function land(el) {
  // the focus look by size: a card or tile (64px tall or more) rises with the light under it; a button turns white
  if (!el.matches(TEXT) && el.tagName !== "SELECT") {
    const big = el.getBoundingClientRect().height >= 64;
    el.classList.toggle("tv-card", big); el.classList.toggle("tv-pill", !big);
  }
  if (el.matches?.(TEXT) && !el.readOnly) {
    el.readOnly = true; el.dataset.tvShut = "1";
    el.addEventListener("blur", () => { if (el.dataset.tvShut) { el.readOnly = false; delete el.dataset.tvShut; } }, { once: true });
  }
  el.focus({ preventScroll: true });
}
function openBox(el) {
  delete el.dataset.tvShut;
  el.readOnly = false;
  el.blur(); el.focus();   // focusing it writable is what brings up the keyboard
  el.click?.();
}

/* Moving like a TV app: Up and Down go to the nearest row above or below and
   keep your column (so down then up returns to the same card); Left and Right
   stay in the row and stop at its end; the header (fixed at the top of the
   screen) is reached only from the top of the page, never over rows that
   have scrolled up under it; tiny targets (a carousel's dots) are skipped. */
let column = null;   // the x the remote is keeping while it moves up and down
const inHeader = (el) => { const h = el.closest("header"); return !!h && getComputedStyle(h).position === "fixed"; };
const big = (el) => { const r = el.getBoundingClientRect(); return r.width >= 12 && r.height >= 12; };

function move(dx, dy) {
  const root = scope();
  const all = candidates(root).filter(big);
  const cur = document.activeElement && root.contains(document.activeElement) && document.activeElement !== document.body ? document.activeElement : null;
  if (!cur) {
    // start in the page itself (a title's Play, a page's first row), not the header
    const onScreen = (el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.top < window.innerHeight; };
    const first = all.find((el) => onScreen(el) && !inHeader(el) && el.getBoundingClientRect().top >= 70) || all.find(onScreen) || all[0];
    if (first) { column = null; land(first); keep(first); }
    return !!first;
  }
  const a = cur.getBoundingClientRect();
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  const others = all.filter((el) => el !== cur && !el.contains(cur) && !cur.contains(el));
  let best = null;
  if (dx) {
    // the same row: overlapping the current one top to bottom, ahead in that direction
    const row = others.filter((el) => { const b = el.getBoundingClientRect(); const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); return overlap > Math.min(a.height, b.height) * 0.4 && (dx > 0 ? b.left >= a.right - 4 : b.right <= a.left + 4); });
    best = row.sort((p, q) => { const bp = p.getBoundingClientRect(), bq = q.getBoundingClientRect(); return (dx > 0 ? bp.left - bq.left : bq.right - bp.right) || Math.abs(bp.top - a.top) - Math.abs(bq.top - a.top); })[0] || null;
    if (best) column = best.getBoundingClientRect().left + best.getBoundingClientRect().width / 2;
  } else {
    if (column == null) column = ax;
    const curHeader = inHeader(cur);
    let pool = others.filter((el) => { const b = el.getBoundingClientRect(); return dy > 0 ? b.top >= a.bottom - 4 && b.top > a.top : b.bottom <= a.top + 4 && b.bottom < a.bottom; });
    // the header only from the top of the page; from the header, only the page
    if (dy < 0 && !curHeader) { const page = pool.filter((el) => !inHeader(el)); if (page.length) pool = page; }
    if (dy > 0 && curHeader) pool = pool.filter((el) => !inHeader(el));
    if (pool.length) {
      // the nearest row: everything whose edge is within a few pixels of the closest one
      const edge = (el) => { const b = el.getBoundingClientRect(); return dy > 0 ? b.top : -b.bottom; };
      const nearest = Math.min(...pool.map(edge));
      const row = pool.filter((el) => edge(el) <= nearest + 24);
      // in it, prefer what is on screen, then the one under the kept column
      const W = window.innerWidth;
      const shown = row.filter((el) => { const b = el.getBoundingClientRect(); return b.right > 0 && b.left < W; });
      const pick = shown.length ? shown : row;
      best = pick.sort((p, q) => { const bp = p.getBoundingClientRect(), bq = q.getBoundingClientRect(); const dp = column < bp.left ? bp.left - column : column > bp.right ? column - bp.right : 0, dq = column < bq.left ? bq.left - column : column > bq.right ? column - bq.right : 0; return dp - dq || Math.abs(bp.left + bp.width / 2 - column) - Math.abs(bq.left + bq.width / 2 - column); })[0];
    }
  }
  if (!best) return false;
  land(best);
  keep(best);
  return true;
}

/* keep the focused thing on screen. On a page with a stage (Home), by sections:
   in the hero the page is at the top with the header; in a row, the header
   steps away, the stage shows the card (TvStage.jsx) and the row sits on one
   line under it. Elsewhere, just in view. */
const ANCHOR = 0.47;
function sideways(el) {
  // inside a row that scrolls sideways: keep the card in it, with room either side
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (/(auto|scroll)/.test(s.overflowX) && p.scrollWidth > p.clientWidth) {
      const r = el.getBoundingClientRect(), box = p.getBoundingClientRect(), pad = 60;
      if (r.left < box.left + pad) p.scrollBy({ left: r.left - box.left - pad, behavior: "smooth" });
      else if (r.right > box.right - pad) p.scrollBy({ left: r.right - box.right + pad, behavior: "smooth" });
      return;
    }
  }
}
function keep(el) {
  const stage = document.querySelector("[data-tv-stage]");
  const root = document.documentElement;
  if (stage && stage.contains(el) && !el.closest("header")) {
    sideways(el);
    const section = el.closest("section");
    if (!section || el.closest("[data-tv-hero]")) { root.classList.remove("tv-rows"); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    root.classList.add("tv-rows");
    // the line is the section's title for its first row; a later row of the same section comes up to it itself
    const rows = [...section.querySelectorAll('[class*="overflow-x-auto"]')];
    const unit = el.closest('[class*="overflow-x-auto"]') || section;
    const lead = rows.indexOf(unit) <= 0 ? section : unit;
    const h = window.innerHeight;
    let top = window.scrollY + lead.getBoundingClientRect().top - h * ANCHOR;
    // a tall row (posters) rises just enough to show whole, light included
    const bottom = window.scrollY + unit.getBoundingClientRect().bottom + 18;
    if (bottom - top > h) top = bottom - h;
    top = Math.max(0, top);
    // the stage ends just above the row's title, wherever that lands
    const titleY = window.scrollY + lead.getBoundingClientRect().top - top;
    root.style.setProperty("--tv-stage", `${Math.round(Math.min(h * ANCHOR, Math.max(h * 0.3, titleY - 6)))}px`);
    window.scrollTo({ top, behavior: "smooth" });
    return;
  }
  root.classList.remove("tv-rows");
  sideways(el);
  const r = el.getBoundingClientRect();
  const top = 80, bottom = window.innerHeight - 40;   // the header pill sits over the page's top
  if (r.top < top) window.scrollBy({ top: r.top - top - 20, behavior: "smooth" });
  else if (r.bottom > bottom) window.scrollBy({ top: r.bottom - bottom + 20, behavior: "smooth" });
}

function back() {
  const player = document.querySelector(".fixed.inset-0.z-\\[60\\]");
  const typing = document.activeElement?.closest?.("input, textarea, select");
  if (typing && typing.dataset.tvShut !== "1") { document.activeElement.blur(); land(typing); return; }   // close the keyboard, stay on the box
  if (player) {
    // in the controls: back to the picture first
    if (player.contains(document.activeElement) && document.activeElement !== document.body && !document.querySelector(".pm-card, .w-\\[343px\\]")) { document.activeElement.blur(); return; }
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return;
  }
  const open = document.querySelector("[role=dialog], [role=listbox]");
  if (open) { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); document.body.click(); return; }
  if (window.history.length > 1 && location.hash.replace(/^#/, "") !== "/") window.history.back();
  else window.Capacitor?.Plugins?.App?.exitApp?.();
}

/* where focus was on each page, to come back to it after Back */
const spots = new Map();
const pageKey = () => location.pathname + location.search + location.hash;
const indexOf = (el) => candidates(document.body).filter(big).indexOf(el);

/* keep the player's controls up: its mouse-move handler is on the picture layer, inside */
const wake = (player) => (player.firstElementChild || player).dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));

export function startTvNav() {
  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented) return;
    const player = document.querySelector(".fixed.inset-0.z-\\[60\\]");
    const inControls = player && player.contains(document.activeElement) && document.activeElement !== document.body;
    const panelOpen = !!document.querySelector(".pm-card, .w-\\[343px\\]");
    const box = document.activeElement?.closest?.("input, textarea, select");
    const shut = box?.dataset?.tvShut === "1";
    const typing = box && !shut;
    if (e.key === "Enter" && shut) { e.preventDefault(); e.stopImmediatePropagation(); openBox(box); return; }
    if (e.key === "Escape" && !e.isTrusted) return;   // our own, for the player
    if (e.key === "Backspace" && typing) return;
    if (e.key === "Escape" || e.key === "Backspace" || e.key === "GoBack" || e.key === "BrowserBack") { e.preventDefault(); e.stopImmediatePropagation(); back(); return; }
    const dir = DIRS[e.key];
    if (player && !inControls && !panelOpen) {
      // the picture: the player's own keys, except Down and OK bring up the controls
      if (e.key === "ArrowDown" || e.key === "Enter") {
        e.preventDefault(); e.stopImmediatePropagation();
        wake(player);
        setTimeout(() => { const play = player.querySelector('button[aria-label="Play"], button[aria-label="Pause"]'); play?.focus({ preventScroll: true }); }, 50);
      }
      return;
    }
    if (dir) {
      if (typing && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return;   // moving the text cursor
      e.preventDefault(); e.stopImmediatePropagation();
      if (player) wake(player);   // keep the controls up
      move(dir[0], dir[1]);
    }
  }, true);
  // the Android remote's Back button
  window.Capacitor?.Plugins?.App?.addListener?.("backButton", () => back());
  // something to start from on every page
  // something to start from on every page: when nothing has focus for a moment (a new
  // page, a closed panel), the first thing on screen takes it; not in the player's picture
  let idle = 0, page = pageKey(), lastIndex = -1;
  setInterval(() => {
    const now = pageKey();
    if (now !== page) {
      spots.set(page, lastIndex);
      page = now; column = null;
      const back = spots.get(now);
      if (back != null && back >= 0) {
        idle = -8;   // the restore below goes first
        // the page you came back to: once its rows are there, the card you left
        let tries = 0;
        const restore = setInterval(() => {
          const el = candidates(document.body).filter(big)[back];
          if (el || ++tries > 10) { clearInterval(restore); if (el) { land(el); keep(el); idle = 0; } }
        }, 300);
      }
    } else if (document.activeElement && document.activeElement !== document.body) lastIndex = indexOf(document.activeElement);
    const none = !document.activeElement || document.activeElement === document.body || !document.body.contains(document.activeElement);
    const picture = document.querySelector(".fixed.inset-0.z-\\[60\\]") && !document.querySelector(".pm-card, .w-\\[343px\\]");
    idle = none && !picture ? idle + 1 : 0;
    if (idle >= 2) { idle = 0; move(0, 1); }
  }, 400);
}
