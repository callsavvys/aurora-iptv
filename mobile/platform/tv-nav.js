/* D-pad navigation for the Android TV build.

   A remote has four arrows and OK, and the renderer was written for a pointer:
   cards are plain <article> elements with no tab stop, and every view is
   replaced wholesale on each render, which drops focus on the floor. Wiring
   each view up by hand was not an option — there are a dozen of them, and the
   grid views rebuild their own contents as you scroll — so this works purely
   off geometry. Whatever is on screen in the direction you pressed is where
   focus goes next, and nothing in here knows what a view is.

   Inert unless the TV shim has marked the document, so the same file can sit in
   the Mac and iPhone bundles without reaching them. */
(() => {
  if (!document.documentElement.classList.contains("platform-tv")) return;

  const CARD = "article.card";
  const FOCUSABLE = "a[href], button, input, select, textarea, [tabindex]";
  /* The modals the app puts over the page. When one of them is open the remote
     belongs to it alone: the arrows have to stay inside the player chrome
     rather than wander through the library behind it. */
  const MODALS = ["player-modal", "source-modal"];

  const MOVES = {
    ArrowLeft: { axis: "x", back: true },
    ArrowRight: { axis: "x", back: false },
    ArrowUp: { axis: "y", back: true },
    ArrowDown: { axis: "y", back: false },
  };

  /* Rounded layout never lines up exactly, and a neighbour that starts a pixel
     inside the focused element is still plainly the next thing along. */
  const SLACK = 2;
  /* Being off the line of travel costs more than distance along it, or else a
     press of Down from the last card in a row lands in the next column over. */
  const MISS_WEIGHT = 3;
  const CENTRE_WEIGHT = 0.4;

  let remembered = null;

  /* ---------- what counts as a stop ---------- */

  function reachable(node) {
    if (node.disabled || node.hasAttribute("hidden")) return false;
    const rect = node.getBoundingClientRect();
    // the renderer hides modals, rail arrows and unused controls by collapsing
    // them, so anything with no box on screen is not a place focus can go
    return rect.width > 2 && rect.height > 2;
  }

  function candidates(root) {
    const found = [];
    for (const node of root.querySelectorAll(FOCUSABLE)) {
      // a card travels as one piece: the heart tucked into its corner is too
      // small to aim at from a sofa, and stopping on it on the way past would
      // make one row of posters feel like two
      const card = node.closest(CARD);
      if (card && card !== node) continue;
      if (reachable(node)) found.push(node);
    }
    return found;
  }

  const layer = () => {
    for (const id of MODALS) {
      const modal = document.getElementById(id);
      if (modal && !modal.classList.contains("hidden")) return modal;
    }
    return document;
  };

  /* ---------- picking the neighbour ---------- */

  /* Both rects are reduced to an edge facing the way you are going and a span
     across it, so one comparison serves all four directions. */
  const spans = (rect, axis) => (axis === "x"
    ? { near: rect.left, far: rect.right, lo: rect.top, hi: rect.bottom }
    : { near: rect.top, far: rect.bottom, lo: rect.left, hi: rect.right });

  function rank(fromRect, toRect, move) {
    const from = spans(fromRect, move.axis), to = spans(toRect, move.axis);
    // measured between the facing edges, so an element the focus already sits
    // beside is never offered as its own neighbour
    const travel = move.back ? from.near - to.far : to.near - from.far;
    if (travel < -SLACK) return null;
    const miss = Math.max(0, Math.max(from.lo, to.lo) - Math.min(from.hi, to.hi));
    const centre = Math.abs((from.lo + from.hi) / 2 - (to.lo + to.hi) / 2);
    return Math.max(0, travel) + miss * MISS_WEIGHT + centre * CENTRE_WEIGHT;
  }

  function step(move) {
    const root = layer();
    const current = document.activeElement;
    // a re-render or a modal opening leaves focus on <body>; the first press
    // should put it somewhere useful rather than do nothing
    if (!(current instanceof Element) || current === document.body || !root.contains(current)) return focusFirst();
    const fromRect = current.getBoundingClientRect();
    let best = null, bestScore = Infinity;
    for (const node of candidates(root)) {
      if (node === current || current.contains(node) || node.contains(current)) continue;
      const score = rank(fromRect, node.getBoundingClientRect(), move);
      if (score !== null && score < bestScore) { bestScore = score; best = node }
    }
    if (best) focus(best);
  }

  /* ---------- holding on to focus ---------- */

  /* A re-render builds new nodes, so focus can only be restored by describing
     what held it rather than by keeping the node itself. The element name goes
     in because the same data-id is a card in one view and a hero button in
     another. */
  function signature(node) {
    for (const name of ["data-id", "data-view", "data-resume", "data-show-play"]) {
      const value = node.getAttribute(name);
      if (value) return `${node.localName}[${name}="${CSS.escape(value)}"]`;
    }
    return node.id ? `#${CSS.escape(node.id)}` : null;
  }

  const activeNav = () => document.querySelector("aside nav button.active") || document.querySelector("aside nav button");

  /* `nearest` matters: anything else yanks a horizontal shelf sideways every
     time you step down the page. The scroll is done here rather than by focus()
     itself because focus events are not delivered while the document is not the
     focused one, and the remote has to keep working either way. */
  function focus(node) {
    remembered = signature(node) || remembered;
    node.focus({ preventScroll: true });
    node.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function focusFirst() {
    const root = layer();
    if (root !== document) {
      const first = candidates(root)[0];
      if (first) focus(first);
      return;
    }
    const card = document.querySelector(`#content ${CARD}`);
    if (card && reachable(card)) return focus(card);
    const nav = activeNav();
    if (nav) focus(nav);
  }

  function refocus() {
    const root = layer();
    const held = remembered && root.querySelector(remembered);
    if (held instanceof Element && reachable(held)) return focus(held);
    focusFirst();
  }

  /* Focus the remote did not move still has to be kept and kept on screen: the
     renderer jumps to the search field on its own, and a click in a preview
     build lands wherever it lands. */
  document.addEventListener("focusin", (event) => {
    const node = event.target;
    if (!(node instanceof Element) || node === document.body) return;
    remembered = signature(node) || remembered;
    node.scrollIntoView({ block: "nearest", inline: "nearest" });
  });

  /* ---------- making the renderer's cards reachable ---------- */

  const tagCards = () => {
    for (const card of document.querySelectorAll(`${CARD}:not([tabindex])`)) card.tabIndex = 0;
  };

  /* Every view replaces #content wholesale, and the grid views go further and
     rewrite their own rows as you scroll past them, so there is no single point
     to hook. Watching the subtree covers both, and one timeout coalesces the
     burst of mutations a render produces into a single pass. */
  let pending = false;
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      tagCards();
      const active = document.activeElement;
      if (!active || active === document.body || active === document.documentElement) refocus();
    }, 0);
  }).observe(document.getElementById("content"), { childList: true, subtree: true });
  tagCards();

  /* ---------- OK ---------- */

  function activate(node) {
    /* The renderer's click delegation only recognises the artwork inside a card
       (.open-detail, .play-item, .play-resume); a click on the <article> itself
       matches none of its branches and quietly does nothing. */
    const target = node.matches(CARD) ? node.querySelector(".art") || node : node;
    target.click();
  }

  /* ---------- which keys the focused control gives up ---------- */

  const holdsValue = (node) => node.localName === "select" || (node.localName === "input" && node.type === "range");
  const takesText = (node) => node.localName === "textarea" || (node.localName === "input" && !holdsValue(node) && node.type !== "button" && node.type !== "submit");

  function caretAt(node) {
    // selectionStart is not readable on every input type, and the ones that
    // refuse it have no caret to move anyway
    try { return node.selectionStart === node.selectionEnd ? node.selectionStart : null }
    catch { return null }
  }

  function yields(node, key) {
    if (node.isContentEditable) return false;
    if (holdsValue(node)) {
      /* A control that holds a value keeps the axis that changes it. The player's
         transport runs left to right, so sideways is the natural way out of a
         track picker or the volume slider, and up and down still set them. */
      return key === "ArrowLeft" || key === "ArrowRight";
    }
    if (takesText(node)) {
      if (key === "Enter") return false; // the field's own submit
      if (key === "ArrowUp" || key === "ArrowDown") return true;
      const caret = caretAt(node);
      if (caret === null) return true;
      // sideways moves the caret until there is no more text to cross
      return key === "ArrowLeft" ? caret === 0 : caret === node.value.length;
    }
    return true;
  }

  /* Capture, not bubble: the renderer already binds the arrows to seeking and
     volume while the player is open, and it was listening first. Taking the
     event out of the chain here is what stops one press of Right from both
     skipping ten seconds and moving focus. Back is deliberately left alone —
     the shim hands that to Capacitor. */
  document.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const move = MOVES[event.key];
    if (!move && event.key !== "Enter") return;

    const player = document.getElementById("player-modal");
    // the chrome fades out while something plays, so any press has to bring it
    // back before it can be asked to land on one of its buttons
    if (player && !player.classList.contains("hidden")) window.wakeChrome?.();

    const current = document.activeElement instanceof Element ? document.activeElement : null;
    if (current && !yields(current, event.key)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    if (move) step(move); else if (current) activate(current);
  }, true);

  window.auroraTv = { focusFirst, refocus };
})();

/* Android TV throws its on-screen keyboard up the moment a text field takes
   focus, which covers half the screen for someone who was only passing through
   on the way to the button beside it. So the field is held shut — focusable,
   ringed, but not typable — until OK is pressed on it, and it closes again on
   Back or when focus leaves. */
(function deliberateTyping() {
  const field = document.getElementById("search");
  if (!field) return;
  const shut = () => { field.setAttribute("readonly", "readonly"); field.setAttribute("inputmode", "none") };
  const open = () => {
    field.removeAttribute("readonly");
    field.setAttribute("inputmode", "text");
    field.blur();
    field.focus(); // the keyboard only follows a focus that lands on a typable field
  };
  shut();
  field.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || !field.hasAttribute("readonly")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    open();
  }, true);
  field.addEventListener("blur", shut);
})();
