/* Automatic updates for the TV and phone apps (`vite build --mode app`).

   The app's index.html does not load the bundle directly: a small loader looks
   in IndexedDB for a newer bundle the app downloaded earlier (src/ota.js) and
   runs that one, or the bundle shipped inside the app when there is none, when
   the shipped one is newer (a fresh install), or when the downloaded one failed
   to start before. A downloaded bundle that has not started within 15 seconds
   is marked bad and the app reloads with its own copy.

   The bundle is one JS file and one CSS file (no split chunks), so it can run
   from memory. Its images stay in the app (assets/); scripts/publish-live.sh
   uploads the JS and CSS and a manifest.json to the app-live pre-release. */
const fs = require("node:fs");
const path = require("node:path");

// raise only when a bundle needs something the installed app does not have
// (a new native plugin); older apps then keep their own copy until reinstalled
const SHELL_API = 1;

function loader({ js, css, build }) {
  return `(function () {
  var LOCAL = { js: ${JSON.stringify(js)}, css: ${JSON.stringify(css)} }, BUILD = ${build}, API = ${SHELL_API};
  window.__AURORA_SHELL__ = { build: BUILD, api: API };
  window.__AURORA_META__ = new URL(LOCAL.js, location.href).href;
  var started = false;
  function local() {
    window.__AURORA_RUN__ = { build: BUILD, ota: false };
    var l = document.createElement("link"); l.rel = "stylesheet"; l.href = LOCAL.css; document.head.appendChild(l);
    var s = document.createElement("script"); s.type = "module"; s.src = LOCAL.js; document.head.appendChild(s);
  }
  function bad() { try { return Number(localStorage.getItem("aurora-ota-bad")) || 0; } catch (e) { return 0; } }
  function go(rec) {
    if (started) return; started = true;
    if (!rec || !(rec.v > BUILD) || rec.v === bad() || !(rec.api <= API) || !rec.js || !rec.css) return local();
    window.__AURORA_RUN__ = { build: rec.v, ota: true };
    if (rec.version) window.AURORA_VERSION = rec.version;
    function fail() {
      if (window.__auroraBooted) return;
      try { localStorage.setItem("aurora-ota-bad", String(rec.v)); } catch (e) {}
      location.reload();
    }
    var st = document.createElement("style");
    st.textContent = rec.css.replace(/url\\((["']?)\\.\\//g, "url($1./assets/");
    document.head.appendChild(st);
    var code = rec.js.split("import.meta.url").join("window.__AURORA_META__");
    var s = document.createElement("script"); s.type = "module";
    s.src = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    s.onerror = fail;
    document.head.appendChild(s);
    setTimeout(fail, 15000);
  }
  try {
    var rq = indexedDB.open("aurora-ota", 1);
    rq.onupgradeneeded = function () { rq.result.createObjectStore("b"); };
    rq.onsuccess = function () {
      try { var g = rq.result.transaction("b").objectStore("b").get("current"); g.onsuccess = function () { go(g.result); }; g.onerror = function () { go(null); }; }
      catch (e) { go(null); }
    };
    rq.onerror = function () { go(null); };
    setTimeout(function () { go(null); }, 3000);
  } catch (e) { go(null); }
})();`;
}

function otaPlugin() {
  let app = false, outDir = "dist", root = process.cwd();
  const build = Date.now();
  return {
    name: "aurora-ota",
    config(_, { mode }) {
      app = mode === "app";
      if (app) return { define: { __APP_BUILD__: String(build) }, build: { chunkSizeWarningLimit: 4000, rollupOptions: { output: { inlineDynamicImports: true } } } };
      return { define: { __APP_BUILD__: "0" } };
    },
    configResolved(c) { outDir = path.resolve(c.root, c.build.outDir); root = c.root; },
    writeBundle(_, bundle) {
      if (!app) return;
      const files = Object.values(bundle);
      const entry = files.find((f) => f.type === "chunk" && f.isEntry);
      const css = files.find((f) => f.type === "asset" && /^assets\/index-.*\.css$/.test(f.fileName));
      const extra = files.filter((f) => f.type === "chunk" && f !== entry);
      if (!entry || !css) throw new Error("aurora-ota: no entry script or stylesheet in the app build");
      if (extra.length) throw new Error(`aurora-ota: the app build must be one script, found ${extra.map((f) => f.fileName).join(", ")}`);
      const file = path.join(outDir, "index.html");
      let html = fs.readFileSync(file, "utf8");
      const tags = [new RegExp(`\\s*<script type="module" crossorigin src="\\./${entry.fileName}"></script>`), new RegExp(`\\s*<link rel="stylesheet" crossorigin href="\\./${css.fileName}">`)];
      for (const t of tags) { if (!t.test(html)) throw new Error(`aurora-ota: ${t} is not in index.html`); html = html.replace(t, ""); }
      html = html.replace("</head>", `    <script>${loader({ js: `./${entry.fileName}`, css: `./${css.fileName}`, build })}</script>\n  </head>`);
      fs.writeFileSync(file, html);
      fs.writeFileSync(path.join(outDir, "ota.json"), JSON.stringify({ v: build, api: SHELL_API, js: entry.fileName, css: css.fileName }, null, 2));
    },
  };
}

module.exports = { otaPlugin, SHELL_API };
