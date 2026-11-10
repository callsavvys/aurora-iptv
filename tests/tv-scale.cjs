// tv.css is drawn against a 1920-wide screen. An Android TV WebView reports
// whatever it likes, and at 960 CSS pixels every fixed size in that stylesheet
// comes out twice as large. One scale factor puts it back.
//   node tests/tv-scale.cjs
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ROOT = path.resolve(__dirname, "..");
const SHIM = fs.readFileSync(path.join(ROOT, "mobile/platform/platform-boot-app.js"), "utf8");
const CSS = fs.readFileSync(path.join(ROOT, "mobile/platform/tv.css"), "utf8");

const from = SHIM.indexOf("const TV_WIDTH = 1920;");
const to = SHIM.indexOf("fitToScreen();");
if (from < 0 || to < 0) throw new Error("platform-boot-app.js no longer has the fitToScreen block");
const SOURCE = SHIM.slice(from, to);

let failed = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(`${ok ? "  ok  " : "FAIL  "}${label}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};

const screen = (width, height, isTv = true) => {
  const style = { zoom: "", _vars: {}, setProperty(name, value) { this._vars[name] = value } };
  const sandbox = {
    TV_BUILD: isTv,
    window: { innerWidth: width, innerHeight: height },
    document: { documentElement: { style } },
    exports: {},
  };
  vm.createContext(sandbox);
  vm.runInContext(`${SOURCE}; exports.fitToScreen = fitToScreen;`, sandbox);
  sandbox.exports.fitToScreen();
  return { zoom: style.zoom, height: style._vars["--tv-height"] };
};

console.log("— the stylesheet is always laid out as if the screen were 1920 wide —");
for (const [w, h] of [[960, 540], [1280, 720], [1920, 1080], [3840, 2160]]) {
  const got = screen(w, h);
  const laidOutWidth = Math.round(w / Number(got.zoom));
  check(`${w}x${h} lays out at ${laidOutWidth}px wide`, laidOutWidth, 1920);
  check(`  and keeps the full height of the screen`, got.height, `${Math.round(h / (w / 1920))}px`);
}

console.log("\n— the cases that broke it —");
check("a half-width screen is scaled by a half", screen(960, 540).zoom, "0.5");
check("and is NOT left at 100vh, which measures the unscaled screen", screen(960, 540).height, "1080px");
check("a 1920 screen is left alone", screen(1920, 1080).zoom, "1");
check("nothing is scaled when this is not the TV build", screen(960, 540, false).zoom, "");
check("a WebView reporting nothing falls back to 1920", screen(0, 0).zoom, "1");

console.log("\n— one percent of the screen is one percent of the screen —");
// the guide was three rows tall on a screen with room for eight, because its
// height is calc(100vh - 260px) and 100vh measured 540
check("the shim hands the stylesheet a real vh", /--tv-vh/.test(SHIM), true);
check("and a real vw", /--tv-vw/.test(SHIM), true);
{
  // the fallbacks inside var(--tv-vh, 1vh) are what a laptop falls back to,
  // so they are stripped before looking for the ones that are left
  const stripped = CSS
    .replace(/\/\*[\s\S]*?\*\//g, "")                                   // comments explain the units, they do not set them
    .replace(/var\(--tv-[a-z]+,\s*[0-9.]+v[hw]\)/g, "var()");
  const bare = stripped.match(/[\s(:][0-9.]+v[hw]\b/g) || [];
  check("no bare vh or vw is left in the television stylesheet", bare, []);
}
check("the guide takes its height from the variable", /\.platform-tv \.guide \{ max-height: calc\(var\(--tv-height/.test(CSS), true);

console.log("\n— the stylesheet has to co-operate —");
check("the app takes its height from the variable, not from vh", CSS.includes("height: var(--tv-height, 100vh)"), true);
check("and so does the workspace", (CSS.match(/var\(--tv-height, 100vh\)/g) || []).length >= 2, true);
check("no bare 100vh is left on the TV app", /\.platform-tv \.app \{[^}]*height: 100vh/.test(CSS), false);

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
