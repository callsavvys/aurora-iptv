// Three surfaces in a row turned out never to have been brought across to the
// television: the detail page, Settings, and the category chips on Movies and
// Live TV. Each was found by looking at one screen at a time, which is how you
// find the fourth one next week. This walks every view at 1920x1080 with the
// TV stylesheet on and measures what is actually on screen.
//
//   npx electron tests/tv-sweep.cjs            report every view
//   npx electron tests/tv-sweep.cjs --strict   fail on anything still wrong
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { openAurora, ROOT } = require("./harness.cjs");

const TV_CSS = fs.readFileSync(path.join(ROOT, "mobile/platform/tv.css"), "utf8");
const TV_NAV = fs.readFileSync(path.join(ROOT, "mobile/platform/tv-nav.js"), "utf8");
const STRICT = process.argv.includes("--strict");

/* What the measurements mean.
   READABLE: this stylesheet is drawn at 1920 and the television maps it one
   to one onto 1080p, which at 320dpi is 960dp wide — so a pixel here is half
   a dp, and 16px was 8sp. Material's smallest size is 11sp and its body text
   is 14-16sp; this test passed a half-size interface for weeks because the
   line was drawn in the wrong units. 22px is Material's floor, doubled.
   SAFE: televisions crop the edges. Every other surface moved to an 88px
   margin; anything that starts inside 40px is in the part that gets thrown
   away. Artwork is meant to bleed, so it is excluded by name.
   TARGET: a thing you aim at with a D-pad needs to be visible when focused. */
const READABLE = 22;
const SAFE = 40;

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aurora-sweep-"));
  const { js, check, close } = await openAurora({ dataDir, port: 41962, width: 1920, height: 1080 });
  await js(`document.getElementById("source-modal").classList.add("hidden"); true`);
  await js(`BUILT_IN.tmdb = ""; BUILT_IN.omdb = ""; true`);
  await js(`(() => {
    document.documentElement.classList.add("platform-tv");
    const sheet = document.createElement("style");
    sheet.textContent = ${JSON.stringify(TV_CSS)};
    document.head.appendChild(sheet);
    return true;
  })()`);
  await js(`${TV_NAV}\n;true`);

  // a library shaped like the real one: the provider's decorated category
  // names, a block it has stamped 10.0 throughout, and some real ratings
  await js(`(() => {
    const cats = ["EN - NEW RELEASE", "\\u2744 NETFLIX \\u2318 ORIGINAL", "FR \\u2713 HBO", "AR - \\u064a\\u0639\\u0631\\u0636 \\u0627\\u0644\\u0627\\u0646"];
    state.provider = { id: "p", name: "Rocket", server: "http://127.0.0.1:9", username: "u", password: "p" };
    state.items = Array.from({ length: 90 }, (_, i) => ({
      id: (i % 3 === 0 ? "movie-" : i % 3 === 1 ? "series-" : "live-") + i,
      type: i % 3 === 0 ? "movie" : i % 3 === 1 ? "series" : "live",
      name: "Title " + i,
      category: cats[i % cats.length],
      year: String(2020 + (i % 6)),
      rating: i % 4 === 0 ? "10" : String(5 + (i % 40) / 10),
      added: Date.now() - i * 1000,
    }));
    return true;
  })()`);

  const settle = (ms = 260) => new Promise((r) => setTimeout(r, ms));

  /* Everything measured in one pass in the page, because a round trip per
     element on a view with two hundred of them takes longer than the test. */
  const measure = () => js(`(() => {
    const SMALL = ${READABLE}, SAFE = ${SAFE};
    /* Artwork is meant to bleed, and so is anything inside something that
       scrolls sideways: the poster rails, the chip rails and the programme
       guide, whose timeline is wider than the screen on purpose. The guide's
       own frame is still measured — it is the content inside it that runs on. */
    const bleeds = (node) => node.matches("img, video, canvas, aside, .hero, .series-hero, .series-backdrop, .hero img, .billboard, .scroll, .workspace, .app, #content, #series-detail, .detail-page, section, .shelf, .shelf-row, .ranked-row, .rail, .rail-scroller, .genre-strip, .chips, .scroll > *")
      || Boolean(node.closest(".hero, .series-hero, aside, .guide-inner"));
    const shown = (node) => {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
      const r = node.getBoundingClientRect();
      return r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < innerHeight;
    };
    const ownText = (node) => [...node.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);

    const tiny = new Map(), outside = new Map();
    for (const node of document.querySelectorAll("#content *, aside *")) {
      if (!shown(node)) continue;
      if (ownText(node)) {
        const size = Math.round(parseFloat(getComputedStyle(node).fontSize));
        if (size < SMALL) {
          const key = node.localName + "." + (node.className || "").toString().split(" ")[0] + " @" + size;
          tiny.set(key, (tiny.get(key) || 0) + 1);
        }
      }
      if (!bleeds(node)) {
        const r = node.getBoundingClientRect();
        if (r.left < SAFE || r.right > innerWidth - SAFE) {
          const key = node.localName + "." + (node.className || "").toString().split(" ")[0];
          outside.set(key, (outside.get(key) || 0) + 1);
        }
      }
    }
    const doc = document.scrollingElement;
    return {
      tiny: [...tiny.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
      outside: [...outside.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
      overflowX: Math.max(0, doc.scrollWidth - doc.clientWidth),
    };
  })()`);

  const views = [
    ["home", `navigate({ view: "home", query: "" })`],
    ["live", `navigate({ view: "live", query: "" })`],
    ["movies", `navigate({ view: "movies", query: "" })`],
    ["series", `navigate({ view: "series", query: "" })`],
    ["profile (My Aurora)", `navigate({ view: "profile", query: "" })`],
    ["history", `navigate({ view: "history", query: "" })`],
    ["settings", `navigate({ view: "settings", query: "" })`],
    ["together", `navigate({ view: "together", query: "" })`],
    /* The detail view is built straight into the page rather than through
       render(), which would go looking for the provider's own data and hang
       this with nothing on screen. What is measured is the same markup. */
    ["a title's own page", `(() => {
      state.detailItem = state.items.find((i) => i.type === "movie");
      state.detailData = { info: { plot: "A synopsis long enough that the line wraps the way a real one does, twice over if the column lets it." } };
      state.detailMeta = null;
      document.getElementById("content").innerHTML = '<section class="detail-page"><div id="series-detail"></div></section>';
      renderMovieDetail();
    })()`],
  ];

  const problems = [];
  for (const [name, go] of views) {
    await js(`(() => { ${go}; return true })()`);
    await settle();
    const got = await measure();
    const notes = [];
    if (got.tiny.length) notes.push("  type under " + READABLE + "px: " + got.tiny.map(([k, n]) => `${k} x${n}`).join(", "));
    if (got.outside.length) notes.push("  inside the cropped edge: " + got.outside.map(([k, n]) => `${k} x${n}`).join(", "));
    if (got.overflowX > 2) notes.push("  the page scrolls sideways by " + got.overflowX + "px");
    console.log(`\n${name}`);
    console.log(notes.length ? notes.join("\n") : "  nothing to report");
    if (notes.length) problems.push(name);
  }

  console.log("\n————");
  console.log(problems.length ? `${problems.length} view(s) with something to answer for: ${problems.join(", ")}` : "every view clean");
  if (STRICT) check("every view is sized and placed for a television", problems, []);
  await close();
})();
