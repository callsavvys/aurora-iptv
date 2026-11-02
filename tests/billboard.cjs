// The billboard turns over, and holds still when turning would be rude.
//   npx electron tests/billboard.cjs
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { openAurora } = require("./harness.cjs");

(async () => {
  const { js: raw, check, close } = await openAurora({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "aurora-bb-")), port: 41982 });
  const js = async (c) => { try { return await raw(c) } catch (e) { console.log(`FAIL  page threw\n        ${String(e?.message||e).slice(0,200)}`); await close(); process.exit(1) } };
  await js(`document.getElementById("source-modal").classList.add("hidden"); true`);

  /* Background work re-renders home when it lands, which destroys whatever had
     focus. That is real, and it is not what this file is about: held it would
     make every check here depend on whether a network call happened to finish
     mid-assertion. Both are silenced so the rotation is tested on its own. */
  await js(`
    window.loadTrending = async () => {};
    window.hydrateHero = async () => {};
    loadTrending = async () => {};
    hydrateHero = async () => {};
    true`);

  await js(`
    state.provider = { id: "p", name: "T", server: "x", username: "u", password: "p" };
    state.items = Array.from({ length: 10 }, (_, i) => ({
      id: "m" + i, type: "movie", name: "Film " + i, year: "2024", category: "Drama",
      rating: String(9 - i / 10), backdrop: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
    }));
    libraryIndex = null;   // the app does this whenever the library changes
    state.view = "home"; render(); true`);

  // the headline gets rewritten from TMDB once metadata lands, so which title
  // is on the billboard is its id, not its words
  const shown = () => js(`document.querySelector(".hero .play-featured")?.dataset.id || "none"`);
  const turn = () => js(`(() => { turnHero(); return true })()`);
  const settle = () => new Promise((r) => setTimeout(r, 340));

  console.log("— it has somewhere to go —");
  check("the billboard has several titles to show", await js(`heroPicks().length > 1`), true);
  const first = await shown();
  check("and starts on one of them", first !== "none", true);

  console.log("\n— it turns —");
  await turn(); await settle();
  const second = await shown();
  check("a turn shows a different title", second !== first, true);
  await turn(); await settle();
  check("and keeps going", (await shown()) !== second, true);

  console.log("\n— it holds still when turning would be rude —");
  await js(`$("#player-modal").classList.remove("hidden"); true`);
  const held = await shown();
  await turn(); await settle();
  check("not while something is playing", await shown(), held);
  await js(`$("#player-modal").classList.add("hidden"); true`);

  await js(`document.querySelector(".hero .play-featured").focus(); true`);
  const onButton = await shown();
  await turn(); await settle();
  check("not while the remote is on its buttons", await shown(), onButton);
  check("so Play still means what it said", await js(`document.activeElement.classList.contains("play-featured")`), true);
  await js(`document.activeElement.blur(); true`);

  console.log("\n— it stops when it should —");
  await js(`startHeroTurn(); true`);
  check("it is running on home", await js(`Boolean(hero.timer)`), true);
  check("and stops when you leave home", await js(`(() => {
    navigate({ view: "movies", query: "" });
    return [state.view, Boolean(hero.timer)];
  })()`), ["movies", false]);
  await js(`navigate({ view: "home", query: "" }); true`);
  check("and starts again when you come back", await js(`Boolean(hero.timer)`), true);
  await close();
})();
