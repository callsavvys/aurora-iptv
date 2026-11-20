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
  for (let p = el; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p); if (s.opacity === "0" || s.display === "none") return false; }
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

function move(dx, dy) {
  const root = scope();
  const all = candidates(root);
  const cur = document.activeElement && root.contains(document.activeElement) && document.activeElement !== document.body ? document.activeElement : null;
  if (!cur) {
    // start in the page itself (a title's Play, a page's first row), not the header
    const onScreen = (el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.top < window.innerHeight; };
    const first = all.find((el) => onScreen(el) && el.closest("main") && el.getBoundingClientRect().top >= 70) || all.find(onScreen) || all[0]; first?.focus({ preventScroll: true }); first && keep(first); return !!first; }
  const a = cur.getBoundingClientRect();
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best = null, bestScore = Infinity;
  for (const el of all) {
    if (el === cur || el.contains(cur) || cur.contains(el)) continue;
    const b = el.getBoundingClientRect();
    const bx = b.left + b.width / 2, by = b.top + b.height / 2;
    // ahead of the current one, edge to edge
    const ahead = dx > 0 ? b.left - a.right : dx < 0 ? a.left - b.right : dy > 0 ? b.top - a.bottom : a.top - b.bottom;
    if (ahead < -Math.min(a.width, a.height) / 3) continue;
    const along = Math.max(0, ahead);
    // how far off the line: zero when they overlap side by side
    const off = dx ? Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom)) + Math.abs(by - ay) * 0.1
      : Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right)) + Math.abs(bx - ax) * 0.1;
    const score = along + off * 3;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (!best) return false;
  best.focus({ preventScroll: true });
  keep(best);
  return true;
}
/* keep the focused thing on screen, its row too */
function keep(el) {
  el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  const r = el.getBoundingClientRect();
  const top = 80, bottom = window.innerHeight - 40;   // the header pill sits over the page's top
  if (r.top < top) window.scrollBy({ top: r.top - top - 20, behavior: "smooth" });
  else if (r.bottom > bottom) window.scrollBy({ top: r.bottom - bottom + 20, behavior: "smooth" });
}

function back() {
  const player = document.querySelector(".fixed.inset-0.z-\\[60\\]");
  const typing = document.activeElement?.closest?.("input, textarea, select");
  if (typing) { document.activeElement.blur(); return; }
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

export function startTvNav() {
  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented) return;
    const player = document.querySelector(".fixed.inset-0.z-\\[60\\]");
    const inControls = player && player.contains(document.activeElement) && document.activeElement !== document.body;
    const panelOpen = !!document.querySelector(".pm-card, .w-\\[343px\\]");
    const typing = document.activeElement?.closest?.("input, textarea, select");
    if (e.key === "Escape" && !e.isTrusted) return;   // our own, for the player
    if (e.key === "Backspace" && typing) return;
    if (e.key === "Escape" || e.key === "Backspace" || e.key === "GoBack" || e.key === "BrowserBack") { e.preventDefault(); e.stopImmediatePropagation(); back(); return; }
    const dir = DIRS[e.key];
    if (player && !inControls && !panelOpen) {
      // the picture: the player's own keys, except Down and OK bring up the controls
      if (e.key === "ArrowDown" || e.key === "Enter") {
        e.preventDefault(); e.stopImmediatePropagation();
        player.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
        setTimeout(() => { const play = player.querySelector('button[aria-label="Play"], button[aria-label="Pause"]'); play?.focus({ preventScroll: true }); }, 50);
      }
      return;
    }
    if (dir) {
      if (typing && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return;   // moving the text cursor
      e.preventDefault(); e.stopImmediatePropagation();
      if (player) player.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));   // keep the controls up
      move(dir[0], dir[1]);
    }
  }, true);
  // the Android remote's Back button
  window.Capacitor?.Plugins?.App?.addListener?.("backButton", () => back());
  // something to start from on every page
  // something to start from on every page: when nothing has focus for a moment (a new
  // page, a closed panel), the first thing on screen takes it; not in the player's picture
  let idle = 0;
  setInterval(() => {
    const none = !document.activeElement || document.activeElement === document.body || !document.body.contains(document.activeElement);
    const picture = document.querySelector(".fixed.inset-0.z-\\[60\\]") && !document.querySelector(".pm-card, .w-\\[343px\\]");
    idle = none && !picture ? idle + 1 : 0;
    if (idle >= 2) { idle = 0; move(0, 1); }
  }, 400);
}
