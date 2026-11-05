// The TV build script: what it refuses before doing any work, the keys it
// writes, and what each interface's staged www/ contains. Everything here runs
// the real script with AURORA_STAGE_ONLY=1 or fails before staging, so no
// Android SDK is needed and no APK is built.
//   node tests/tv-build.cjs
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { spawnSync } = require("node:child_process");
const ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(ROOT, "mobile/scripts/build-android.sh");
const WWW = path.join(ROOT, "mobile/www");
const LEDGER = path.join(ROOT, "mobile/test-codes.log");

let failed = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(`${ok ? "  ok  " : "FAIL  "}${label}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};
const CLEAN = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("AURORA_")));
const build = (env = {}, args = []) => {
  const r = spawnSync("bash", [SCRIPT, ...args], { env: { ...CLEAN, ...env }, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const read = (rel) => fs.readFileSync(path.join(WWW, rel), "utf8");

console.log("— settings are checked before anything is copied —");
const marker = path.join(WWW, ".untouched");
fs.mkdirSync(WWW, { recursive: true });
fs.writeFileSync(marker, "");
for (const [label, env, says] of [
  ["an unknown interface", { AURORA_TV_UI: "Web" }, "AURORA_TV_UI='Web' is not an interface"],
  ["a trace build on a release code", { AURORA_TRACE: "1" }, "AURORA_TRACE=1 needs AURORA_TEST_VERSION"],
  ["a test version outside 0.38.90–99", { AURORA_TEST_VERSION: "0.39.0" }, "outside 0.38.90–0.38.99"],
  ["a test version that is not a version", { AURORA_TEST_VERSION: "latest" }, "is not a version"],
  ["the side-by-side app as a release", { AURORA_APP_ID_SUFFIX: ".test" }, "AURORA_APP_ID_SUFFIX needs AURORA_TEST_VERSION"],
  ["an unknown suffix", { AURORA_APP_ID_SUFFIX: ".beta", AURORA_TEST_VERSION: "0.38.95" }, "must be .test or unset"],
]) {
  const r = build(env);
  check(`refuses ${label} (exit 2, says why)`, [r.code, r.err.includes(says)], [2, true]);
}
check("…and none of them touched mobile/www", fs.existsSync(marker), true);
fs.rmSync(marker, { force: true });
check("--help lists every setting", ["AURORA_TV_UI", "AURORA_TEST_VERSION", "AURORA_TRACE", "AURORA_APP_ID_SUFFIX", "AURORA_STAGE_ONLY"].every((k) => build({}, ["--help"]).out.includes(k)), true);

console.log("— a test code is used once, and Android never sees an older one —");
const before = fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER, "utf8") : null;
try {
  fs.writeFileSync(LEDGER, (before || "") + "0.38.93 web test-fixture 2026-11-05\n");
  const r = build({ AURORA_TEST_VERSION: "0.38.92", AURORA_STAGE_ONLY: "1" });
  check("an older code than the last one built is refused", [r.code, r.err.includes("already used or older"), r.err.includes("AURORA_TEST_VERSION=0.38.94")], [2, true, true]);
  check("so is the same code again", build({ AURORA_TEST_VERSION: "0.38.93", AURORA_STAGE_ONLY: "1" }).code, 2);
} finally {
  if (before === null) fs.rmSync(LEDGER, { force: true }); else fs.writeFileSync(LEDGER, before);
}

console.log("— the keys come from one place, and a missing one stops the build —");
const keys = require(path.join(ROOT, "scripts/extract-keys.cjs")).extractKeys();
check("all four keys are found in app/renderer.js", Object.keys(keys).filter((k) => keys[k]), ["tmdb", "omdb", "supabaseUrl", "supabaseKey"]);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aurora-keys-"));
const renderer = fs.readFileSync(path.join(ROOT, "app/renderer.js"), "utf8");
for (const [name, gone] of [["tmdb", renderer.replace(/tmdb: "[0-9a-f]{32}"/, 'tmdb: ""')], ["supabaseKey", renderer.replace(/const SUPABASE_KEY = "[^"]+"/, 'const SUPABASE_KEY = ""')]]) {
  fs.writeFileSync(path.join(tmp, "renderer.js"), gone);
  const r = spawnSync("node", [path.join(ROOT, "scripts/extract-keys.cjs"), "--config-js", "--from", path.join(tmp, "renderer.js")], { encoding: "utf8" });
  const leaked = Object.values(keys).some((v) => r.stderr.includes(v) || r.stdout.includes(v));
  check(`a blank ${name} exits 3 with E_KEYS_MISSING and leaks no key`, [r.status, r.stderr.includes(`E_KEYS_MISSING: ${name}`), leaked], [3, true, false]);
}
fs.rmSync(tmp, { recursive: true, force: true });

console.log("— the new interface, staged —");
{
  const r = build({ AURORA_TV_UI: "web", AURORA_STAGE_ONLY: "1" });
  check("stages without the Android SDK", r.code, 0);
  check("the banner says what is being built", /Aurora TV \| stage only \(no APK\) \| interface web \| version [\d.]+ \(code \d+\) \| trace off \| com\.callsavvys\.aurora$/m.test(r.out), true);
  const html = read("index.html");
  const appCsp = fs.readFileSync(path.join(ROOT, "app/index.html"), "utf8").match(/<meta http-equiv="Content-Security-Policy"[^>]*>/)[0];
  check("its CSP is app/'s, byte for byte", html.match(/<meta http-equiv="Content-Security-Policy"[^>]*>/)?.[0], appCsp);
  check("order: config.js, platform-core.js, then boot.js", html.indexOf("config.js") < html.indexOf("platform-core.js") && html.indexOf("platform-core.js") < html.indexOf("js/boot.js"), true);
  check("it knows it is the new interface on a television", /class="platform-tv ui-web"/.test(html), true);
  check("no request to Google Fonts", /fonts\.googleapis\.com/.test(html) || /fonts\.googleapis\.com/.test(read("css/app.css")), false);
  check("Inter is bundled", fs.existsSync(path.join(WWW, "fonts/inter-variable.woff2")), true);
  check("hls.js and Supabase are where web/ loads them", ["vendor/hls.js", "vendor/supabase.js", "vendor/SUPABASE-LICENSE.txt"].every((f) => fs.existsSync(path.join(WWW, f))), true);
  check("the old interface is not in it", ["renderer.js", "platform-boot-app.js", "tv-nav.js"].some((f) => fs.existsSync(path.join(WWW, f))), false);
  const config = read("config.js");
  check("config.js carries the four keys and no trace flag", [Object.values(keys).every((v) => config.includes(v)), config.includes('"trace"')], [true, false]);
  check("the version is written into platform-core.js", read("platform-core.js").includes("__AURORA_VERSION__"), false);
}
{
  const r = build({ AURORA_TV_UI: "web", AURORA_STAGE_ONLY: "1", AURORA_TRACE: "1", AURORA_TEST_VERSION: "0.38.99" });
  check("a trace stage is a test build with trace on", [r.code, /test build|stage only/.test(r.out), / trace on /.test(r.out)], [0, true, true]);
  check("its config.js says trace", read("config.js").includes('"trace":true'), true);
  check("a stage-only run records no test code", fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER, "utf8").includes("0.38.99") : false, false);
}

console.log("— the old interface, staged as before —");
{
  const r = build({ AURORA_STAGE_ONLY: "1" });
  check("stages", r.code, 0);
  const html = read("index.html");
  check("loads platform-core.js then platform-boot-app.js where renderer.js was", /<script src="platform-core\.js"><\/script><script src="platform-boot-app\.js"><\/script>/.test(html) && !/<script src="renderer\.js">/.test(html), true);
  check("platform-boot-app.js loads renderer.js, then tv-nav.js on a television", /renderer\.src = "renderer\.js"/.test(read("platform-boot-app.js")) && /nav\.src = "tv-nav\.js"/.test(read("platform-boot-app.js")), true);
  check("tv.css and the television class are injected", html.includes("tv.css") && html.includes('class="platform-tv"'), true);
  check("renderer.js and tv-nav.js are there", ["renderer.js", "tv-nav.js"].every((f) => fs.existsSync(path.join(WWW, f))), true);
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
