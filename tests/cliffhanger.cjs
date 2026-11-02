// The preview opens a real connection to the provider, and the line allows a
// handful at once. These are the rules that keep it from spending them all.
//   npx electron tests/cliffhanger.cjs
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { openAurora } = require("./harness.cjs");

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aurora-cliff-"));
  const { js: raw, check, close } = await openAurora({ dataDir, port: 41955 });
  // without this, anything the page throws rejects silently and the run hangs
  // with no output instead of saying what went wrong
  const js = async (code) => {
    try { return await raw(code) }
    catch (error) {
      console.log(`FAIL  page threw\n        ${String(error?.message || error).slice(0, 300)}`);
      await close();
      process.exit(1);
    }
  };
  await js(`document.getElementById("source-modal").classList.add("hidden"); true`);

  // nothing may actually leave the device during this test
  await js(`
    window.__opened = [];
    const realSrc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src");
    Object.defineProperty(HTMLMediaElement.prototype, "src", {
      configurable: true,
      get() { return realSrc.get.call(this) },
      set(value) { if (this.classList.contains("preview-video")) { window.__opened.push(value); return } realSrc.set.call(this, value) },
    });
    HTMLMediaElement.prototype.play = function () { return Promise.resolve() };
    HTMLMediaElement.prototype.load = function () {};
    state.provider = { id: "p", name: "T", server: "http://127.0.0.1:9", username: "u", password: "p" };
    state.items = [
      { id: "half", type: "movie", name: "Half watched", streamId: "11", ext: "mp4", category: "Drama" },
      { id: "fresh", type: "movie", name: "Never opened", streamId: "12", ext: "mp4", category: "Drama" },
      { id: "done", type: "movie", name: "Finished", streamId: "13", ext: "mp4", category: "Drama" },
      { id: "early", type: "movie", name: "Barely started", streamId: "14", ext: "mp4", category: "Drama" },
      { id: "chan", type: "live", name: "A channel", streamId: "15", category: "News" },
    ];
    state.progress = new Map([
      ["half", { position: 2400, duration: 7200 }],
      ["done", { position: 7000, duration: 7200 }],
      ["early", { position: 12, duration: 7200 }],
      ["chan", { position: 300, duration: 0 }],
    ]);
    navigate({ view: "movies", query: "" });
    true`);

  const cardFor = (id) => `document.querySelector('article.card[data-id="${id}"]')`;
  const hover = async (id) => js(`(() => { startPreview(${cardFor(id)}); return true })()`);
  const opened = () => js(`window.__opened.length`);
  const reset = () => js(`(() => { stopPreview(); window.__opened.length = 0; return true })()`);

  console.log("— which films have a moment of yours to show —");
  await reset(); await hover("half");
  check("a part-watched film previews", await js(`Boolean(preview.video)`), true);
  check("and it is that film's own stream", await js(`decodeURIComponent(window.__opened[0] || "").includes("/movie/u/p/11.mp4")`), true);

  await reset(); await hover("fresh");
  check("one you never opened does not", await js(`Boolean(preview.video)`), false);
  await reset(); await hover("done");
  check("nor one you finished", await js(`Boolean(preview.video)`), false);
  await reset(); await hover("early");
  check("nor one you stopped 12 seconds in", await js(`Boolean(preview.video)`), false);
  await reset();
  check("a live channel has no moment to resume", await js(`cliffhanger(state.items.find((i) => i.id === "chan")) === null`), true);
  check("and a card that has gone away is simply ignored", await js(`(() => { startPreview(null); return Boolean(preview.video) })()`), false);

  console.log("\n— the line only allows a handful of connections —");
  await reset();
  await js(`(() => { startPreview(${cardFor("half")}); startPreview(${cardFor("half")}); startPreview(${cardFor("half")}); return true })()`);
  check("three hovers leave exactly one stream open", await js(`document.querySelectorAll("video.preview-video").length`), 1);

  await reset(); await hover("half");
  await js(`stopPreview(); true`);
  check("leaving drops the element", await js(`document.querySelectorAll("video.preview-video").length`), 0);
  check("and lets go of the source, which is what closes the connection", await js(`!preview.video`), true);

  console.log("\n— never while you are actually watching —");
  await reset();
  await js(`$("#player-modal").classList.remove("hidden"); true`);
  await hover("half");
  check("a preview does not open behind the player", await js(`Boolean(preview.video)`), false);
  check("so it cannot take the connection the film is using", await opened(), 0);
  await js(`$("#player-modal").classList.add("hidden"); true`);

  console.log("\n— drifting across a row costs nothing —");
  await reset();
  await js(`(() => { queuePreview(${cardFor("half")}); queuePreview(${cardFor("fresh")}); queuePreview(${cardFor("half")}); return true })()`);
  check("nothing opens while the pointer is still moving", await opened(), 0);
  check("only a pending timer is left", await js(`Boolean(preview.timer)`), true);

  console.log("\n— a render tears it down —");
  await reset(); await hover("half");
  await js(`render(); true`);
  check("re-rendering closes the stream it left behind", await js(`document.querySelectorAll("video.preview-video").length`), 0);

  await close();
})();
