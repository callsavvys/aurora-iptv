// A sideloaded build cannot update itself, so the one thing it must get right
// is noticing that a newer one exists and saying where to get it.
//
// Pure logic lifted out of the shipped shim and run in Node: the page's own
// policy forbids evaluating source, which is as it should be.
//   node tests/update-notice.cjs
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ROOT = path.resolve(__dirname, "..");
const SHIM = fs.readFileSync(path.join(ROOT, "mobile/platform/platform-native.js"), "utf8");

const VERSION = "0.31.0";
const between = (from, to) => {
  const a = SHIM.indexOf(from), b = SHIM.indexOf(to);
  if (a < 0 || b < 0 || b <= a) throw new Error(`platform-native.js no longer has the block from "${from}"`);
  return SHIM.slice(a, b);
};
const SOURCE = (between("const newer =", "async function latestRelease") +
  between("async function latestRelease", "/* On a TV this is")).replace(/__AURORA_VERSION__/g, VERSION);

let failed = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(`${ok ? "  ok  " : "FAIL  "}${label}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};

const asked = [];
const build = (reply, isTv) => {
  const sandbox = {
    TV_BUILD: isTv,
    RELEASES: "https://example.invalid/releases",
    DOWNLOADER_CODE: "8502133",
    fetch: (url) => { asked.push(url); return Promise.resolve(reply) },
    exports: {},
  };
  vm.createContext(sandbox);
  vm.runInContext(`${SOURCE}; exports.newer = newer; exports.latestRelease = latestRelease;`, sandbox);
  return sandbox.exports;
};
const ok = (tag) => ({ ok: true, json: () => Promise.resolve({ tag_name: tag }) });
const ask = (reply, isTv = true) => build(reply, isTv).latestRelease();
const cmp = (a, b) => build(ok("v0.0.1"), true).newer(a, b);

(async () => {
  console.log("— comparing versions as numbers, not as text —");
  check("0.31.0 is newer than 0.30.0", cmp("0.31.0", "0.30.0"), true);
  check("0.9.0 is NOT newer than 0.31.0, though it sorts later as text", cmp("0.9.0", "0.31.0"), false);
  check("0.31.0 is newer than 0.9.0", cmp("0.31.0", "0.9.0"), true);
  check("the same version is not newer than itself", cmp("0.31.0", "0.31.0"), false);
  check("a leading v is ignored", cmp("v1.0.0", "0.31.0"), true);
  check("1.0.0 beats 0.99.99", cmp("1.0.0", "0.99.99"), true);
  check("a missing patch part counts as zero", cmp("0.32", "0.31.9"), true);

  console.log("\n— what the banner is told —");
  const newer = await ask(ok("v0.32.0"));
  check("a newer release asks for a manual install", newer.state, "manual");
  check("naming the version", newer.version, "0.32.0");
  check("and, on a television, the Downloader code", newer.how, "Open Downloader and enter 8502133");
  check("off a television it says to reinstall instead", (await ask(ok("v0.32.0"), false)).how.includes("Downloader"), false);
  check("the same version says nothing is needed", (await ask(ok("v0.31.0"))).state, "none");
  check("an older release says nothing is needed", (await ask(ok("v0.30.0"))).state, "none");

  console.log("\n— when the release list will not answer —");
  check("a refusal is an error, not an update", (await ask({ ok: false, status: 403 })).state, "error");
  check("saying what happened", (await ask({ ok: false, status: 403 })).message.includes("403"), true);
  check("a reply with no version is an error", (await ask({ ok: true, json: () => Promise.resolve({}) })).state, "error");
  check("a network failure is an error", (await ask(Promise.reject(new Error("offline")))).state, "error");

  console.log("\n— nothing is downloaded —");
  check("only the release list was ever asked for", asked.every((url) => url === "https://example.invalid/releases"), true);
  check("and it was asked for, at least once", asked.length > 0, true);

  console.log(failed ? `\n${failed} failed` : "\nall passed");
  process.exit(failed ? 1 : 0);
})();
