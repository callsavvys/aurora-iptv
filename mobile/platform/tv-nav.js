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

  // a guide row is a place the remote must be able to stand: its programme
  // blocks are buttons, but a channel with no guide has none of them
  const CARD = "article.card, .guide-row[data-guide-for]";
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
    if (best) return focus(best);

    /* The menu is a strip fixed to the top of the window, so as soon as the
       page scrolls, whatever is nearest the top sits underneath it and no
       geometry points at the menu any more — it is behind you, not above you.
       Up from the topmost thing on the page always means the menu. */
    if (move.axis === "y" && move.back && !current.closest("aside")) {
      const nav = activeNav();
      if (nav && reachable(nav)) focus(nav);
    }
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
/* ---------- typing on a remote ----------
   The system keyboard on a television is a thing you drive with a D-pad
   anyway, and it covers the results while you do it. A grid of letters on the
   page is the same number of presses and leaves the results visible, which is
   the whole point of searching on a sofa: you stop as soon as you see it.

   The field itself never takes text here, so the system keyboard never opens. */
(function remoteKeyboard() {
  const field = document.getElementById("search");
  if (!field) return;
  field.setAttribute("readonly", "readonly");
  field.setAttribute("inputmode", "none");

  const ROWS = ["abcdef", "ghijkl", "mnopqr", "stuvwx", "yz0123", "456789"];
  const pad = document.createElement("div");
  pad.className = "remote-keys hidden";
  pad.innerHTML = ROWS.map((row) => `<div class="key-row">${[...row]
    .map((ch) => `<button class="key" data-key="${ch}">${ch}</button>`).join("")}</div>`).join("") +
    `<div class="key-row wide">
       <button class="key key-space" data-key=" ">space</button>
       <button class="key key-back" data-back>&#9003;</button>
       <button class="key key-clear" data-clear>clear</button>
     </div>`;

  const type = (text) => {
    field.value = text;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  };

  pad.addEventListener("click", (event) => {
    const key = event.target.closest("[data-key]");
    if (key) return type(field.value + key.dataset.key);
    if (event.target.closest("[data-back]")) return type(field.value.slice(0, -1));
    if (event.target.closest("[data-clear]")) return type("");
  });

  // it belongs beside the results, not inside the top strip
  const place = () => {
    const content = document.getElementById("content");
    if (!content || pad.isConnected) return;
    content.prepend(pad);
  };

  const show = (on) => {
    place();
    pad.classList.toggle("hidden", !on);
    document.querySelector(".workspace")?.classList.toggle("typing", on);
  };

  field.addEventListener("focus", () => show(true));
  // blur fires no focusin, so without this the keys stay up over whatever the
  // remote moved on to
  field.addEventListener("blur", () => setTimeout(() => {
    if (!pad.contains(document.activeElement)) show(false);
  }, 0));
  document.addEventListener("focusin", (event) => {
    const node = event.target;
    if (!(node instanceof Element)) return;
    // stays up while the remote is on the keys or the field, closes elsewhere
    if (node === field || pad.contains(node)) return show(true);
    show(false);
  });
})();

/* ---------- the spotlight ----------
   Netflix's TV app has no billboard. The tile the remote is sitting on is the
   spotlight: it widens into its landscape artwork, wears its title, and its
   details are written underneath the row it belongs to — so the screen only
   ever describes one thing, and never the same thing twice.

   A tile with no landscape artwork does not widen. Cropping a portrait poster
   to 16:9 cuts the face out of it, and a row that jumps without showing
   anything new is worse than a row that stays still. */
(() => {
  const SPOTLIT = "spotlit";
  const library = () => (typeof state === "undefined" ? [] : state.items || []);
  const meta = (id) => (typeof metaCache === "undefined" ? null : metaCache.get(id));
  const byId = (id) => library().find((item) => item.id === id);
  const text = (value) => {
    const node = document.createElement("span");
    node.textContent = value;
    return node;
  };

  const detailFor = (shelf) => {
    let box = shelf.querySelector(":scope > .row-detail");
    if (!box) {
      box = document.createElement("div");
      box.className = "row-detail";
      shelf.append(box);
    }
    return box;
  };

  const clear = () => {
    for (const card of document.querySelectorAll("." + SPOTLIT)) {
      card.classList.remove(SPOTLIT);
      card.querySelector(".focus-art")?.remove();
      card.querySelector(".spotlight-title")?.remove();
    }
    for (const box of document.querySelectorAll(".row-detail")) box.replaceChildren();
    // every row keeps its own space, so moving between rows does not shove the
    // ones below up and down as the detail appears and disappears
    for (const shelf of document.querySelectorAll(".shelf")) detailFor(shelf);
  };

  const describe = (item) => {
    const extra = meta(item.id);
    const bits = [];
    if (item.type === "live") bits.push("Live");
    else if (item.type === "series") bits.push("Series");
    const score = extra?.ratings?.imdb || extra?.score || item.rating;
    if (score) bits.push("★ " + score);
    if (item.year || extra?.year) bits.push(String(item.year || extra.year));
    if (extra?.runtime) bits.push(extra.runtime);
    if (item.category) bits.push(item.category);
    return { bits, overview: extra?.overview || item.description || "" };
  };

  function spotlight(card) {
    clear();
    if (!card || !card.matches("article.card")) return;
    const item = byId(card.dataset.id);
    if (!item) return;

    const shelf = card.closest(".shelf");
    if (shelf) {
      const { bits, overview } = describe(item);
      const box = detailFor(shelf);
      const line = document.createElement("div");
      line.className = "line";
      for (const bit of bits) line.append(text(bit));
      const title = document.createElement("p");
      title.textContent = overview || item.name;
      box.replaceChildren(line, title);
    }

    // the landscape artwork is what lets it widen; without it, it stays put
    const art = card.querySelector(".art");
    const wide = item.backdrop || meta(item.id)?.backdrop;
    if (!art || !wide) return;
    const img = document.createElement("img");
    img.className = "focus-art";
    img.src = wide;
    img.addEventListener("error", () => {
      card.classList.remove(SPOTLIT);
      img.remove();
      card.querySelector(".spotlight-title")?.remove();
    });
    const name = document.createElement("b");
    name.className = "spotlight-title";
    name.textContent = item.name;
    art.append(img, name);
    card.classList.add(SPOTLIT);
    // focusin scrolled the tile into view at its old width; it is wider now,
    // so at the end of a row it would otherwise sit half off the screen
    card.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  document.addEventListener("focusin", (event) => {
    const node = event.target;
    if (!(node instanceof Element)) return;
    spotlight(node.closest("article.card"));
  });
})();
