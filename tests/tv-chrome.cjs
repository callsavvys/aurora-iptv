// Four things the television showed that no screenshot of mine had caught:
// the menu strip let posters scroll straight through it, the provider's
// category names arrived wearing decoration, a line of Arabic dragged the
// numbers beside it out of order, and every title in the library claimed a
// rating of 10.0.
//   node tests/tv-chrome.cjs
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ROOT = path.resolve(__dirname, "..");
const RENDERER = fs.readFileSync(path.join(ROOT, "app/renderer.js"), "utf8");
const TV = fs.readFileSync(path.join(ROOT, "mobile/platform/tv.css"), "utf8");

let failed = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(`${ok ? "  ok  " : "FAIL  "}${label}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};

// lift the helpers out of the renderer rather than loading the whole of it
const slice = (start, end) => {
  const from = RENDERER.indexOf(start), to = RENDERER.indexOf(end);
  if (from < 0 || to < 0) throw new Error(`renderer.js no longer has ${start}`);
  return RENDERER.slice(from, to);
};
const sandbox = { state: { items: [] }, exports: {} };
vm.createContext(sandbox);
vm.runInContext(
  `${slice("const CATEGORY_FURNITURE", "function ratingSet(")}
   exports.tidyCategory = tidyCategory;
   exports.captionOf = captionOf;
   exports.meaning = providerRatingsCarryMeaning;
   exports.placeholder = ratingIsPlaceholder;
   exports.forget = forgetProviderRatings;`,
  sandbox,
);
const { tidyCategory, captionOf, meaning, forget, placeholder } = sandbox.exports;

console.log("— the provider's names, with the furniture taken off —");
for (const [raw, want] of [
  ["EN - NEW RELEASE", "NEW RELEASE"],
  ["❄ NETFLIX ⌘ ORIGINAL", "NETFLIX ORIGINAL"],
  ["FR ✓ HBO", "HBO"],
  ["ES ✓ SPAIN MOVIES", "SPAIN MOVIES"],
  ["4K ENGLISH | مسلسلات", "4K ENGLISH · مسلسلات"],
  ["IND - INDIAN \u0623\u0641\u0644\u0627\u0645", "INDIAN \u0623\u0641\u0644\u0627\u0645"],
  ["HBO MAX", "HBO MAX"],             // a three-letter name is not a country code
  ["AR", "AR"],                       // never strip the only word there is
  ["✓", "✓"],               // nothing left but furniture: keep it
]) check(`${JSON.stringify(raw)} reads as ${JSON.stringify(want)}`, tidyCategory(raw), want);

check("the category filter chips are tidied too, and All is left alone",
  (require("node:fs").readFileSync(require("node:path").join(ROOT, "app/renderer.js"), "utf8")
    .match(/data-category="\$\{escapeHtml\(name\)\}">\$\{escapeHtml\(name === "All" \? name : tidyCategory\(name\)\)\}/g) || []).length, 2);

console.log("\n— the year is printed once —");
check("a category carrying the year does not get it twice",
  captionOf({ year: "2026", category: "ENGLISH 2026", type: "movie" }), "ENGLISH 2026");
check("a category without it still gets the year",
  captionOf({ year: "2026", category: "DRAMA", type: "movie" }), "2026 • DRAMA");

console.log("\n— a rating every title shares is not a rating —");
const library = (ratings) => { sandbox.state.items = ratings.map((rating, i) => ({ id: String(i), rating })); forget() };
library(Array.from({ length: 200 }, () => "10"));
check("200 titles all rated 10.0 are not believed", meaning(), false);
library(Array.from({ length: 200 }, (_, i) => String(4 + (i % 60) / 10)));
check("a spread of real ratings is believed", meaning(), true);
library(Array.from({ length: 200 }, (_, i) => (i < 110 ? "10" : String(4 + i % 50))));
check("one value over more than half the library is not believed", meaning(), false);
library(["7.1", "8.4", "6.0"]);
check("too few to judge, so taken at their word", meaning(), true);
sandbox.state.items = [];
forget();

console.log("\n— the ends of the scale are where a provider writes 'unset' —");
for (const [value, want] of [["10", true], ["10.0", true], ["0", true], ["0.0", true],
                             ["9.9", false], ["7.3", false], ["1", false]])
  check(`${value} ${want ? "is" : "is not"} a placeholder`, placeholder(value), want);

console.log("\n— and nothing is ranked on one —");
check("ratedItems leaves placeholders out of the ordering",
  /ratedItems[\s\S]{0,600}!ratingIsPlaceholder\(item\.rating\)/.test(
    require("node:fs").readFileSync(require("node:path").join(ROOT, "app/renderer.js"), "utf8")), true);

console.log("\n— one entry per title —");
const SRC = require("node:fs").readFileSync(require("node:path").join(ROOT, "app/renderer.js"), "utf8");
check("ratedItems is deduplicated", /cache\[key\] = oncePerTitle\(ofType\(type\)[\s\S]{0,260}ratingIsPlaceholder/.test(SRC), true);
check("recentlyAdded is deduplicated", /cache\[key\] = oncePerTitle\(ofType\(type\)\.filter\(\(item\) => item\.added\)/.test(SRC), true);

console.log("\n— thirty-three thousand channels, and a remote —");
{
  const SRC2 = require("node:fs").readFileSync(require("node:path").join(ROOT, "app/renderer.js"), "utf8");
  check("reaching the end of the guide asks for the next page",
    /function watchGuideEnd[\s\S]{0,700}scrollHeight - 320[\s\S]{0,600}navigate\(\{ limit: state\.limit \+ GUIDE_CHANNELS/.test(SRC2), true);
  check("and where you were survives the next page arriving",
    /guideResumeAt = guide\.scrollTop;[\s\S]{0,200}navigate\(\{ limit/.test(SRC2)
    && /if \(guideResumeAt\) \{ \$\("#guide"\)\.scrollTop = guideResumeAt/.test(SRC2), true);
  check("a guide row is something the remote can be put back on",
    /\["data-id", "data-view", "data-resume", "data-show-play", "data-play", "data-guide-for"\]/
      .test(require("node:fs").readFileSync(require("node:path").join(ROOT, "mobile/platform/tv-nav.js"), "utf8")), true);
  check("and it is armed when the guide is drawn",
    /scrollGuideToNow\(\);[\s\S]{0,160}watchGuideEnd\(total\);/.test(SRC2), true);
}

console.log("\n— the highlight stays on its own poster —");
{
  const gap = Number((TV.match(/\.platform-tv \.shelf-row, \.platform-tv \.ranked-row \{[\s\S]*?gap: (\d+)px/) || [])[1] || 0);
  const ring = TV.match(/\.platform-tv \.card:focus \.art \{[\s\S]*?outline: (\d+)px[\s\S]*?outline-offset: (\d+)px[\s\S]*?box-shadow: 0 0 0 (\d+)px/) || [];
  const reach = Number(ring[1] || 0) + Number(ring[2] || 0) + Number(ring[3] || 0);
  check(`the ring reaches ${reach}px and half the gap is ${gap / 2}px`, reach <= gap / 2, true);
}
check("a numbered row keeps its shape, every tile the same",
  /if \(card\.closest\("\.ranked-row"\)\) return;/
    .test(require("node:fs").readFileSync(require("node:path").join(ROOT, "mobile/platform/tv-nav.js"), "utf8")), true);
check("a ranked tile grows at the same pace as every other one",
  /\.platform-tv \.ranked-row > \.card \{[^}]*transition: flex-basis \.2s ease/.test(TV), true);
check("and its shape follows its width rather than jumping first",
  /\.platform-tv \.card \.art \{ transition: aspect-ratio \.2s ease; \}/.test(TV), true);

console.log("\n— the menu strip takes a floor once the page has moved —");
const rule = TV.match(/\.platform-tv \.app:has\(\.workspace\.scrolled\) aside \{([^}]*)\}/);
check("the television is covered by the scrolled rule", Boolean(rule), true);
const alpha = rule && rule[1].match(/background:\s*rgba\([^)]*?,\s*\.(\d+)\)/);
check("and that floor is close to opaque", Number(alpha ? `0.${alpha[1]}` : 0) >= 0.95, true);

console.log("\n— every page built out of panels is read from the same sofa —");
check("the settings sizing is not gated to the together page",
  /\.platform-tv \.settings:has\(\.friend-row\) \{/.test(TV), false);
check("and settings itself is sized for a television",
  /\.platform-tv \.settings \.panel h2 \{ font-size: 28px/.test(TV), true);

console.log("\n— mixed directions keep to themselves —");
check("the television isolates each part of a meta line",
  /\.platform-tv \.hero \.meta span,[\s\S]{0,200}unicode-bidi: isolate/.test(TV), true);
check("so does the row detail the remote writes",
  /\.row-detail \.line > span,[\s\S]{0,120}unicode-bidi: isolate/.test(TV), true);

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
