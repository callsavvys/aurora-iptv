// One store, two apps: the old interface (app/renderer.js, through the real
// Mac prefs IPC) and the new one (the staged TV build of web/, with Capacitor
// stood in for) read and write the same `prefs`. Starting from one captured
// snapshot, the old app writes, the new one reads and writes, and the old app
// reads the result back. Kept in npm test for good: if either side changes a
// record, a tombstone or the list bookkeeping, this fails.
//   electron tests/shared-store.cjs
// Value: protects=the shared prefs contract (favorites, favoriteTimes, progress records for a film,
//   a channel and an episode, hidden, progressGone, syncDirty, unknown fields kept, the 5 s write
//   throttle); fails_when=either writer changes a field, an id, a merge rule or drops a field it does
//   not own; why_new=nothing ran both writers on one store; seam=none;
//   no_claim=Capacitor itself (stubbed), Supabase sync, a real provider
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), http = require("node:http");
const { spawnSync } = require("node:child_process");
const { BrowserWindow } = require("electron");
const { openAurora, ROOT } = require("./harness.cjs");
const WWW = path.join(ROOT, "mobile/www");

// what a real 0.38.8 TV holds, trimmed: fields this test never touches must survive both apps
const SNAPSHOT = {
  theme: "dark", activeSource: "src-a", syncCursor: { favorites: "2026-11-01T00:00:00Z", progress: "2026-11-01T00:00:00Z" },
  futureField: { kept: true }, favorites: ["movie-1"], favoriteTimes: { "movie-1": { saved: true, at: 1000 } },
  progress: {}, progressGone: {}, syncDirty: { favorites: {}, progress: {} },
};
const SECRETS = { sources: [{ id: "src-a", name: "Test line", server: "http://line.invalid:8080", username: "alice", password: "s3cret" }] };

const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const shape = (record) => Object.fromEntries(Object.entries(record).map(([k, v]) => [k, k === "updatedAt" ? typeof v : v]));

(async () => {
  const staged = spawnSync("bash", [path.join(ROOT, "mobile/scripts/build-android.sh")], { env: { ...process.env, AURORA_TV_UI: "web", AURORA_STAGE_ONLY: "1" }, encoding: "utf8" });
  if (staged.status !== 0) { console.error(staged.stderr); process.exit(1); }

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aurora-shared-"));
  fs.writeFileSync(path.join(dataDir, "prefs.json"), JSON.stringify(SNAPSHOT));
  const { js, check, close, win } = await openAurora({ dataDir, port: 41936 });
  let webWin = null;
  try {
    console.log("— the old app writes —");
    await js(`document.getElementById("source-modal").classList.add("hidden");
      toggleFavorite({ id: "movie-101" });
      saveProgress({ key: "movie-101", id: "movie-101", type: "movie", title: "Old Film", subtitle: "Films", poster: "old.jpg", position: 600, duration: 6000 });
      flushPrefs(); true`);
    await settle(300);
    const fromOld = await js(`JSON.parse(JSON.stringify(prefs))`);
    check("its list and record are there", [fromOld.favorites, fromOld.progress["movie-101"]?.position], [["movie-1", "movie-101"], 600]);

    console.log("— the new interface reads it, then writes —");
    let current = { prefs: JSON.stringify(fromOld), secrets: JSON.stringify(SECRETS) };
    const stub = () => `(() => {
      const values = ${JSON.stringify(current)};
      window.__values = values; window.__sets = [];
      window.fetch = () => Promise.reject(new TypeError("offline in tests"));
      window.Capacitor = { getPlatform: () => "android", isNativePlatform: () => true, Plugins: {
        Preferences: { get: ({ key }) => Promise.resolve({ value: values[key] ?? null }), set: ({ key, value }) => { window.__sets.push(key); values[key] = value; return Promise.resolve(); } },
        App: { addListener: () => {}, exitApp: () => {} } } };
    })();`;
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
      if (rel === "__stub.js") { res.writeHead(200, { "content-type": "text/javascript" }); return res.end(stub()); }
      const file = path.join(WWW, rel);
      if (!file.startsWith(WWW) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
      let body = fs.readFileSync(file);
      if (rel === "index.html") body = Buffer.from(String(body).replace("<head>", '<head>\n<script src="__stub.js"></script>'));
      res.writeHead(200, { "content-type": { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[path.extname(file)] || "application/octet-stream" });
      res.end(body);
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    webWin = new BrowserWindow({ width: 960, height: 540, show: false, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    const webErrors = [];
    webWin.webContents.on("console-message", (e) => { if (/TypeError(?!: offline)|ReferenceError|SyntaxError|Uncaught/.test(e.message || "")) webErrors.push(e.message); });
    await webWin.loadURL(`http://127.0.0.1:${server.address().port}/`);
    await settle(2500);
    const web = (code) => webWin.webContents.executeJavaScript(`(async () => { const S = await import("/js/store.js"); ${code} })()`);

    check("it sees the old app's list entry and its Continue watching film", await web(`return [S.myList.has({ source: "xtream", kind: "movie", id: 101 }), S.progress.recent("xtream").map((p) => [p.id, p.item.id, p.item.kind, p.position])];`),
      [true, [["movie-101", 101, "movie", 600]]]);
    check("the old dark theme reads as graphite here", await web(`return (await import("/js/store.js")).prefs.theme;`), "graphite");
    check("starting wrote nothing to prefs", await web(`return window.__sets.filter((k) => k === "prefs").length;`), 0);

    let wrote = await web(`
      const film = { id: 202, kind: "movie", source: "xtream", title: "Web Film", poster: "web.jpg", category: "Action" };
      const show = { id: 55, kind: "series", source: "xtream", title: "Show", poster: "show.jpg" };
      const ep = { id: "9001", season: 1, number: 4, title: "Four", ext: "mkv" }, next = { id: "9002", season: 1, number: 5, title: "Five", ext: "mkv" };
      const channel = { id: 303, kind: "live", source: "xtream", title: "News", poster: "news.png", category: "News" };
      S.myList.toggle(film);
      S.progress.save(film, null, 700, 5000, { force: true });
      S.progress.save(show, ep, 1990, 2000, { next, force: true });
      S.progress.played(channel);
      S.progress.hide({ id: "movie-101" });
      S.progress.forget({ id: "live-303" });
      await new Promise((r) => setTimeout(r, 200));
      return JSON.parse(window.__values.prefs);`);
    check("fields the new interface does not own are kept", [wrote.theme, wrote.activeSource, wrote.syncCursor, wrote.futureField], [SNAPSHOT.theme, "src-a", SNAPSHOT.syncCursor, { kept: true }]);
    check("favorites is the old id list, with the new entry", wrote.favorites, ["movie-1", "movie-101", "movie-202"]);
    check("favoriteTimes records the save", [wrote.favoriteTimes["movie-202"].saved, typeof wrote.favoriteTimes["movie-202"].at, wrote.favoriteTimes["movie-1"]], [true, "number", { saved: true, at: 1000 }]);
    check("a film record, field by field", shape(wrote.progress["movie-202"]), { key: "movie-202", id: "movie-202", type: "movie", title: "Web Film", subtitle: "Action", poster: "web.jpg", position: 700, duration: 5000, updatedAt: "number" });
    check("an episode record, field by field, with its next hint", shape(wrote.progress["episode-9001"]), {
      key: "episode-9001", id: "series-55", type: "episode", title: "Show", subtitle: "S1 E4 • Four", poster: "show.jpg", seriesId: 55, season: "1", episodeId: "9001", container: "mkv",
      next: { season: "1", episodeId: "9002", number: "5", title: "Five", container: "mkv" }, position: 1990, duration: 2000, updatedAt: "number",
    });
    check("hiding keeps the old app's record, marked hidden", [wrote.progress["movie-101"]?.hidden, wrote.progress["movie-101"]?.position, "movie-101" in wrote.progressGone], [true, 600, false]);
    check("forgetting a channel deletes it and leaves a tombstone", ["live-303" in wrote.progress, typeof wrote.progressGone["live-303"]], [false, "number"]);
    // movie-101 is still waiting from the old app's own change: kept, not replaced
    check("every change is marked for sync, beside the old app's marks", [Object.keys(wrote.syncDirty.progress).sort(), Object.keys(wrote.syncDirty.favorites).sort()], [["episode-9001", "live-303", "movie-101", "movie-202"], ["movie-101", "movie-202"]]);
    check("no record carries this app's old names (name, at, item)", Object.values(wrote.progress).some((r) => "name" in r || "at" in r || "item" in r), false);

    check("an episode resumed without its queue keeps the next hint already saved", await web(`
      const show = { id: 55, kind: "series", source: "xtream", title: "Show", poster: "show.jpg" };
      S.progress.save(show, { id: "9001", season: 1, number: 4, title: "Four", ext: "mkv" }, 1995, 2000, { next: null, force: true });
      await new Promise((r) => setTimeout(r, 100));
      return JSON.parse(window.__values.prefs).progress["episode-9001"].next;`), { season: "1", episodeId: "9002", number: "5", title: "Five", container: "mkv" });
    check("a film record keeps its file type, and a resume gets it back", await web(`
      const film = { id: 505, kind: "movie", source: "xtream", title: "MKV Film", poster: "", category: "Films", ext: "mkv" };
      S.progress.save(film, null, 900, 6000, { force: true });
      await new Promise((r) => setTimeout(r, 100));
      return [JSON.parse(window.__values.prefs).progress["movie-505"].container, S.progress.forItem(film).item.ext];`), ["mkv", "mkv"]);
    wrote = JSON.parse(await webWin.webContents.executeJavaScript("window.__values.prefs"));

    console.log("— the old app reads it back —");
    await js(`window.aurora.setPrefs(${JSON.stringify(wrote)})`);
    win.webContents.reload();
    await settle(1800);
    check("the list is the same set", await js(`[...state.favorites]`), ["movie-1", "movie-101", "movie-202"]);
    // the two were saved in the same millisecond, so their order is a tie
    check("Continue watching: the next episode and the films (the hidden one stays out)", await js(`continueWatching().map((r) => [r.record.key, r.fresh || false]).sort()`), [["episode-9002", true], ["movie-202", false], ["movie-505", false]]);
    check("History has the show and the hidden film, not the forgotten channel", await js(`[state.progress.has("movie-101"), state.progress.has("live-303"), historyShows().map((s) => [s.id, s.watched])]`), [true, false, [["series-55", 1]]]);

    console.log("— progress is saved at most once every 5 s while playing —");
    const writes = await web(`
      const film = { id: 404, kind: "movie", source: "xtream", title: "Long Film", poster: "", category: "Films" };
      const realNow = Date.now, realSet = window.setTimeout, realClear = window.clearTimeout;
      let t = realNow() + 600000; const timers = [];
      Date.now = () => t;
      window.setTimeout = (fn, ms) => { timers.push({ at: t + ms, fn }); return timers.length; };
      window.clearTimeout = (id) => { if (timers[id - 1]) timers[id - 1].fn = null; };
      const before = window.__sets.filter((k) => k === "prefs").length;
      try {
        for (let s = 1; s <= 60; s += 1) {           // a timeupdate every second for a minute
          t += 1000;
          for (const x of timers) if (x.fn && x.at <= t) { const fn = x.fn; x.fn = null; fn(); }
          S.progress.save(film, null, s, 6000);
        }
        S.progress.save(film, null, 60, 6000, { force: true });   // then stop
      } finally { Date.now = realNow; window.setTimeout = realSet; window.clearTimeout = realClear; }
      await new Promise((r) => setTimeout(r, 200));
      return [window.__sets.filter((k) => k === "prefs").length - before, JSON.parse(window.__values.prefs).progress["movie-404"].position];`);
    check("a minute of playback writes prefs at most 13 times, and the last position is kept", [writes[0] <= 13 && writes[0] >= 12, writes[1]], [true, 60]);

    for (const message of webErrors) check(`no page error in the new interface: ${message}`, false, true);
    server.close();
  } catch (error) {
    check(`the run finished: ${error.message}`, false, true);
  }
  webWin?.destroy();
  await close();
})();
