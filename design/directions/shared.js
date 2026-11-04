/* Shared by the three design directions: the stage, the data and the remote.

   The stage is drawn at 1920x1080 — the television's own grid of real pixels,
   with 1px here = 0.5dp — and scaled to whatever window it is opened in, so
   every direction is judged at the size it will actually ship.

   Navigation follows the app's own rules (tv-nav.js), plus the two it was
   missing: Up from the page goes to the tab you are on, not to whatever in the
   menu happens to sit above you, and a sideways press never leaves the page
   for the menu. Arrows move, Enter opens, Backspace or Escape goes back. */
(() => {
  const stage = document.querySelector(".stage");
  const fit = () => {
    const s = Math.min(innerWidth / 1920, innerHeight / 1080);
    stage.style.transform = `translate(${(innerWidth - 1920 * s) / 2}px, ${(innerHeight - 1080 * s) / 2}px) scale(${s})`;
  };
  addEventListener("resize", fit); fit();

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  window.Direction = { esc };

  // ---------- the remote ----------
  const SLACK = 2, MISS = 3, CENTRE = 0.4;
  const inChrome = (el) => !!el.closest("[data-chrome]");
  const focusables = (root) => [...root.querySelectorAll("[data-f]")].filter((el) => {
    const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && !el.closest("[hidden]");
  });
  const layer = () => document.querySelector("[data-layer]:not([hidden])") || document;
  const spans = (r, axis) => (axis === "x" ? { near: r.left, far: r.right, lo: r.top, hi: r.bottom } : { near: r.top, far: r.bottom, lo: r.left, hi: r.right });
  function rank(a, b, move) {
    const f = spans(a, move.axis), t = spans(b, move.axis);
    const travel = move.back ? f.near - t.far : t.near - f.far;
    if (travel < -SLACK) return null;
    const miss = Math.max(0, Math.max(f.lo, t.lo) - Math.min(f.hi, t.hi));
    const centre = Math.abs((f.lo + f.hi) / 2 - (t.lo + t.hi) / 2);
    return Math.max(0, travel) + miss * MISS + centre * CENTRE;
  }
  const MOVES = { ArrowLeft: { axis: "x", back: true }, ArrowRight: { axis: "x", back: false }, ArrowUp: { axis: "y", back: true }, ArrowDown: { axis: "y", back: false } };
  const remembered = new Map(); // row -> last focused card, so coming back to a row lands where you left it

  function focus(el) {
    if (!el) return;
    el.focus({ preventScroll: true });
    const row = el.closest("[data-row]");
    if (row) {
      remembered.set(row, el);
      // the row arrives in one step and keeps the tile clear of the edge
      const r = el.getBoundingClientRect(), rr = row.getBoundingClientRect(), scale = rr.width / row.offsetWidth || 1;
      const pad = 120 * scale;
      if (r.right > rr.right - pad) row.scrollLeft += (r.right - (rr.right - pad)) / scale;
      else if (r.left < rr.left + pad) row.scrollLeft -= ((rr.left + pad) - r.left) / scale;
    }
    const page = el.closest("[data-page]");
    if (page && !inChrome(el)) {
      const r = el.getBoundingClientRect(), pr = page.getBoundingClientRect(), scale = pr.height / page.offsetHeight || 1;
      const top = (el.closest("[data-section]") || el).getBoundingClientRect();
      const keep = Number(page.dataset.keep ?? 180) * scale; // clear of a menu strip, where there is one
      if (top.top < pr.top + keep) page.scrollTop -= ((pr.top + keep) - top.top) / scale;
      else if (r.bottom > pr.bottom - 60 * scale) page.scrollTop += (r.bottom - (pr.bottom - 60 * scale)) / scale;
      if (el.closest("[data-section]") === page.querySelector("[data-section]")) page.scrollTop = 0;
    }
    document.dispatchEvent(new CustomEvent("direction:focus", { detail: el }));
  }
  window.Direction.focus = focus;

  function step(move) {
    // a top menu is entered by pressing up and a side rail by pressing left;
    // no other press crosses between the page and the menu
    const entry = document.body.dataset.menu === "left" ? "x" : "y";
    const root = layer(), current = document.activeElement;
    if (!current || current === document.body || !root.contains(current)) return focus(focusables(root)[0]);
    const from = current.getBoundingClientRect();
    let best = null, score = Infinity;
    for (const el of focusables(root)) {
      if (el === current) continue;
      if (move.axis !== entry && inChrome(el) !== inChrome(current)) continue;
      const s = rank(from, el.getBoundingClientRect(), move);
      if (s !== null && s < score) { score = s; best = el; }
    }
    // into the menu means the tab you are on, not whatever happens to be nearest
    if (best && move.axis === entry && move.back && inChrome(best) && !inChrome(current)) {
      best = document.querySelector("[data-chrome] [data-f].on") || best;
    }
    // coming down into a row lands where you left that row
    if (best && move.axis === "y") {
      const row = best.closest("[data-row]");
      if (row && row !== current.closest("[data-row]") && remembered.get(row)?.isConnected) {
        const back = remembered.get(row), b = back.getBoundingClientRect(), page = row.getBoundingClientRect();
        if (b.right > page.left && b.left < page.right) best = back;
      }
    }
    if (best) focus(best);
  }

  document.addEventListener("keydown", (e) => {
    if (MOVES[e.key]) { e.preventDefault(); step(MOVES[e.key]); }
    else if (e.key === "Enter") { e.preventDefault(); document.activeElement?.click?.(); }
    else if (e.key === "Backspace" || e.key === "Escape") { e.preventDefault(); document.dispatchEvent(new CustomEvent("direction:back")); }
  });

  // ---------- data ----------
  window.Direction.load = async () => {
    const data = await (await fetch("data.json")).json();
    return data;
  };
  window.Direction.start = () => setTimeout(() => {
    const first = document.querySelector("[data-start]") || focusables(layer())[0];
    focus(first);
  }, 50);
})();
