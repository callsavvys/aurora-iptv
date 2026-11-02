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

console.log("\n— the menu strip takes a floor once the page has moved —");
const rule = TV.match(/\.platform-tv \.app:has\(\.workspace\.scrolled\) aside \{([^}]*)\}/);
check("the television is covered by the scrolled rule", Boolean(rule), true);
const alpha = rule && rule[1].match(/background:\s*rgba\([^)]*?,\s*\.(\d+)\)/);
check("and that floor is close to opaque", Number(alpha ? `0.${alpha[1]}` : 0) >= 0.95, true);

console.log("\n— mixed directions keep to themselves —");
check("the television isolates each part of a meta line",
  /\.platform-tv \.hero \.meta span,[\s\S]{0,200}unicode-bidi: isolate/.test(TV), true);
check("so does the row detail the remote writes",
  /\.row-detail \.line > span,[\s\S]{0,120}unicode-bidi: isolate/.test(TV), true);

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
