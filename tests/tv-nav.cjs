// What a D-pad has to be able to do once the TV build loads tv-nav.js and
// tv.css over the real renderer: reach the renderer's cards at all, cross
// between the grid and the sidebar, keep hold of focus when a view re-renders,
// leave the search field, and stay inside the player's own controls.
//   npx electron tests/tv-nav.cjs
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { openAurora, ROOT } = require("./harness.cjs");

const TV_CSS = fs.readFileSync(path.join(ROOT, "mobile/platform/tv.css"), "utf8");
const TV_NAV = fs.readFileSync(path.join(ROOT, "mobile/platform/tv-nav.js"), "utf8");

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aurora-tv-"));
  const { js, check, close } = await openAurora({ dataDir, port: 41950 });
  await js(`document.getElementById("source-modal").classList.add("hidden"); true`);
  // the built-in keys would send this test to TMDB for artwork and trending
  await js(`BUILT_IN.tmdb = ""; BUILT_IN.omdb = ""; true`);

  console.log("— without the TV class, both files do nothing —");
  // the Mac and iPhone bundles may carry these files; loading one must not
  // start listening for anything or put a tab stop anywhere
  await js(`${TV_NAV}\n;true`);
  await js(`(() => {
    state.provider = { id: "p", name: "Test provider", server: "http://127.0.0.1:9", username: "u", password: "p" };
    state.items = [{ id: "movie-0", type: "movie", name: "Film", category: "Drama" }];
    navigate({ view: "movies", query: "" });
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 150));
  check("no namespace is published", await js(`typeof window.auroraTv`), "undefined");
  check("the cards are left as the renderer wrote them", await js(`document.querySelector("article.card").hasAttribute("tabindex")`), false);
  await js(`(() => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })); return true })()`);
  check("and an arrow key focuses nothing", await js(`document.activeElement === document.body`), true);

  console.log("\n— with it —");
  // the TV build adds the class before the renderer loads and appends both
  // files after it; here the renderer is already up, so the order is the same
  await js(`(() => {
    document.documentElement.classList.add("platform-tv");
    const sheet = document.createElement("style");
    sheet.textContent = ${JSON.stringify(TV_CSS)};
    document.head.appendChild(sheet);
    return true;
  })()`);
  await js(`${TV_NAV}\n;true`);

  const press = (key) => js(`(() => {
    (document.activeElement || document.body).dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }));
    return true;
  })()`);
  // a short name for wherever focus ended up, so a failure says something
  const where = () => js(`(() => {
    const node = document.activeElement;
    if (!node || node === document.body) return "body";
    if (node.matches("article.card")) return "card " + [...document.querySelectorAll("#vgrid-inner article.card")].indexOf(node);
    if (node.closest("aside") && node.dataset.view) return "nav " + node.dataset.view;
    return node.id ? "#" + node.id : node.localName;
  })()`);
  const settle = () => new Promise((r) => setTimeout(r, 120));

  await js(`(() => {
    state.provider = { id: "p", name: "Test provider", server: "http://127.0.0.1:9", username: "u", password: "p" };
    state.items = Array.from({ length: 20 }, (_, i) => ({ id: "movie-" + (i + 1), type: "movie", name: "Film " + (i + 1), category: "Drama" }));
    navigate({ view: "movies", query: "" });
    return true;
  })()`);
  await settle();

  console.log("— the renderer's cards become places focus can go —");
  check("every card in the grid gets a tab stop", await js(`(() => {
    const cards = [...document.querySelectorAll("#vgrid-inner article.card")];
    return [cards.length, cards.every((card) => card.getAttribute("tabindex") === "0")];
  })()`), [20, true]);
  check("and nothing already focusable was touched", await js(`[document.querySelector("aside nav button").getAttribute("tabindex"), document.getElementById("search").getAttribute("tabindex")]`), [null, null]);

  console.log("\n— walking the grid —");
  await js(`window.auroraTv.focusFirst(); true`);
  check("the first press of anything starts on the first poster", await where(), "card 0");
  await press("ArrowRight");
  check("right goes to the next poster along", await where(), "card 1");
  await press("ArrowLeft");
  check("and left comes back", await where(), "card 0");
  const columns = await js(`getComputedStyle(document.getElementById("vgrid-inner")).gridTemplateColumns.split(" ").filter(Boolean).length`);
  await press("ArrowDown");
  check("down drops a whole row, not one card", await where(), `card ${columns}`);
  await press("ArrowUp");
  check("and up returns to the one it came from", await where(), "card 0");

  // The menu used to be a column down the left, so the grid was left of it.
  // It is a strip across the top now, which puts it above the first row.
  console.log("\n— crossing between the grid and the menu —");
  await press("ArrowUp");
  check("up out of the first row leaves the grid for a control", await js(`(() => {
    const node = document.activeElement;
    return [node.matches("article.card"), node.localName];
  })()`), [false, "button"]);
  const landed = await where();

  // this view puts its category chips between the grid and the strip, so the
  // menu is a press or two further up rather than directly above
  const inMenu = () => js(`Boolean(document.activeElement.closest("aside"))`);
  let reached = await inMenu();
  for (let step = 0; step < 4 && !reached; step += 1) {
    await press("ArrowUp");
    await settle();
    reached = await inMenu();
  }
  // naming where it actually stopped, so a failure here says what went wrong
  check("and the menu is reachable by going on up", await js(`(() => {
    const node = document.activeElement;
    return node.closest("aside") ? "menu" : node.localName + " " + (node.textContent || "").trim().slice(0, 18);
  })()`), "menu");
  check("on one of its buttons", await js(`document.activeElement.localName`), "button");

  let back = false;
  for (let step = 0; step < 5 && !back; step += 1) {
    await press("ArrowDown");
    await settle();
    back = await js(`document.activeElement.matches("article.card")`);
  }
  check(`it went out to ${landed} and back to a poster`, back, true);

  // nothing sits to the left of the first poster any more, so the remote has
  // to hold still rather than throw focus somewhere unrelated
  await js(`(() => {
    const row = document.querySelector("#content .shelf-row, #content .grid");
    (row ? row.firstElementChild : document.querySelector("article.card")).focus();
    return true;
  })()`);
  await settle();
  const before = await js(`document.activeElement.dataset.id`);
  await press("ArrowLeft");
  await settle();
  check("left out of the first column stays put", await js(`document.activeElement.dataset.id`), before);

  console.log("\n— focus survives a re-render —");
  await press("ArrowRight");
  await press("ArrowRight");
  const held = await js(`document.activeElement.dataset.id`);
  await js(`render(); true`);
  await settle();
  check("the same item takes focus back", await js(`document.activeElement.dataset.id`), held);
  check("on the card, not on something inside it", await js(`document.activeElement.matches("article.card")`), true);

  console.log("\n— when the remembered item is gone —");
  await js(`(() => {
    state.items = state.items.filter((item) => item.id !== ${JSON.stringify(held)});
    document.activeElement.blur();
    render();
    return true;
  })()`);
  await settle();
  check("focus falls back to the first poster", await where(), "card 0");
  await js(`(() => { state.items = []; state.provider = null; document.activeElement.blur(); render(); return true })()`);
  await settle();
  check("and with no cards at all, to the sidebar button for this view", await js(`(() => {
    const node = document.activeElement;
    return [Boolean(node.closest("aside")), node.classList.contains("active")];
  })()`), [true, true]);

  console.log("\n— the search field keeps what it needs —");
  await js(`(() => {
    state.provider = { id: "p", name: "Test provider", server: "http://127.0.0.1:9", username: "u", password: "p" };
    state.items = Array.from({ length: 20 }, (_, i) => ({ id: "movie-" + (i + 1), type: "movie", name: "Film " + (i + 1), category: "Drama" }));
    navigate({ view: "movies", query: "" });
    const field = document.getElementById("search");
    field.value = "abc";
    field.focus();
    field.setSelectionRange(1, 1);
    return true;
  })()`);
  await settle();
  check("a caret mid-word keeps the sideways keys", await js(`(() => {
    const field = document.getElementById("search");
    const kept = field.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
    return [document.activeElement.id, kept];
  })()`), ["search", true]);
  await js(`document.getElementById("search").setSelectionRange(0, 0); true`);
  await press("ArrowLeft");
  check("at the start of the text it hands them over", await js(`document.activeElement.id !== "search"`), true);
  await js(`(() => { const field = document.getElementById("search"); field.focus(); field.setSelectionRange(1, 1); return true })()`);
  await press("ArrowDown");
  check("down always leaves, wherever the caret is", await js(`document.activeElement.id !== "search"`), true);
  check("and it leaves downwards, into the page", await js(`document.activeElement.matches("article.card, .chip")`), true);

  console.log("\n— with the player open —");
  await js(`window.__seeks = 0; window.nudge = () => { window.__seeks += 1 }; true`);
  await js(`document.getElementById("player-modal").classList.remove("hidden"); document.activeElement.blur(); true`);
  await press("ArrowRight");
  check("the first press lands inside the player, not on the page behind", await js(`(() => {
    const node = document.activeElement;
    return [Boolean(node.closest("#player-modal")), node.dataset.close || node.id];
  })()`), [true, "player-modal"]);
  await press("ArrowRight");
  check("right crosses the title to the button on the far side", await where(), "#favorite-player");
  await press("ArrowDown");
  check("down drops from the title row into the transport", await where(), "#player-help");
  await press("ArrowLeft");
  check("left walks back along the transport", await where(), "#player-full");
  await press("ArrowLeft");
  check("and keeps going", await where(), "#player-pip");
  await press("ArrowRight");
  check("right returns the way it came", await where(), "#player-full");
  check("the renderer never also seeks on those presses", await js(`window.__seeks`), 0);
  check("nothing in the library behind took focus", await js(`Boolean(document.activeElement.closest("#content"))`), false);

  console.log("\n— OK —");
  await js(`document.getElementById("player-modal").classList.add("hidden"); window.auroraTv.focusFirst(); true`);
  await js(`window.__opened = null; window.openDetail = (item) => { window.__opened = item && item.id }; true`);
  await press("Enter");
  check("OK on a card opens it, though the card itself is not clickable", await js(`window.__opened`), "movie-1");

  await close();
})();
