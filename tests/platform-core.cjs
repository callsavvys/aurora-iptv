// platform-core.js is the half of the TV shim both interfaces share: it reads
// the saved data before either starts, and it is the only thing that writes it.
// These are its rules, run in Node against a stand-in for Capacitor
// Preferences (the page's own policy forbids evaluating source in it).
//   node tests/platform-core.cjs
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ROOT = path.resolve(__dirname, "..");
const CORE = fs.readFileSync(path.join(ROOT, "mobile/platform/platform-core.js"), "utf8");

let failed = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(`${ok ? "  ok  " : "FAIL  "}${label}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};

/* A Preferences store holding `initial` (raw strings, as Capacitor keeps
   them). `slowSet` lets a test hold a write open to race another. */
function boot({ initial = {}, classes = [], config = {}, getThrows = false, slowSet = null } = {}) {
  const values = { ...initial };
  const sets = [];
  const Preferences = {
    async get({ key }) { if (getThrows) throw new Error("bridge gone"); return { value: values[key] ?? null }; },
    async set({ key, value }) { sets.push(key); if (slowSet) await slowSet(key, value); values[key] = value; },
  };
  const classList = new Set(classes);
  const window = { AURORA_CONFIG: config, Capacitor: { getPlatform: () => "android", Plugins: { Preferences, App: {} } } };
  const sandbox = {
    window, URL, fetch: async () => ({ ok: false, status: 0 }), setTimeout: () => 0, console,
    document: { documentElement: { classList: { add: (c) => classList.add(c), contains: (c) => classList.has(c) } } },
  };
  vm.createContext(sandbox);
  vm.runInContext(CORE, sandbox);
  return { ready: window.auroraReady, window, values, sets };
}

const PREFS = JSON.stringify({ favorites: ["movie-1"], activeSource: "src-a", theme: "dark" });
const SECRETS = JSON.stringify({ sources: [{ id: "src-a", name: "Line", server: "http://line.example:8080", username: "alice", password: "s3cret" }] });

(async () => {
  console.log("— both interfaces wait for the saved data —");
  {
    const t = boot({ initial: { prefs: PREFS, secrets: SECRETS } });
    const aurora = await t.ready;
    check("auroraReady resolves to window.aurora", aurora === t.window.aurora, true);
    check("prefs snapshot is read", aurora.prefs.activeSource, "src-a");
    check("secrets are read", (await aurora.getSecrets()).sources[0].username, "alice");
    check("store.read answers synchronously", aurora.store.read("prefs").theme, "dark");
  }

  console.log("— a value that cannot be read is never written over —");
  {
    const t = boot({ initial: { prefs: PREFS, secrets: "{not json" } });
    const aurora = await t.ready;
    check("unreadable secrets are reported, not treated as empty", !!(await aurora.getSecrets()).unreadable, true);
    check("the only copy is kept under secrets.locked", t.values["secrets.locked"], "{not json");
    check("store.write refuses the unreadable key", await aurora.store.write("secrets", { sources: [] }), false);
    check("…and secrets are untouched", t.values.secrets, "{not json");
  }
  {
    const t = boot({ initial: { prefs: PREFS }, getThrows: true });
    const aurora = await t.ready;
    check("a get() that throws makes the key read-only", aurora.store.writable("prefs"), false);
  }

  console.log("— the new interface never writes the old app's keys (until the shared store) —");
  {
    const t = boot({ initial: { prefs: PREFS, secrets: SECRETS }, classes: ["ui-web"] });
    const aurora = await t.ready;
    check("store.write(prefs) is refused", await aurora.store.write("prefs", {}), false);
    check("setSecrets is refused", (await aurora.setSecrets({ sources: [] })).saved, false);
    check("its own key is written", await aurora.store.write("web.prefs", { list: [1] }), true);
    check("prefs are byte-identical", t.values.prefs, PREFS);
    check("secrets are byte-identical", t.values.secrets, SECRETS);
  }

  console.log("— a trace build writes nothing but web.trace, not even a .locked copy —");
  {
    const t = boot({ initial: { prefs: PREFS, secrets: "{not json" }, classes: ["ui-web"], config: { trace: true } });
    const aurora = await t.ready;
    check("trace is on", aurora.trace, true);
    check("web.prefs is refused", await aurora.store.write("web.prefs", {}), false);
    check("web.trace is written", await aurora.store.write("web.trace", { a: 1 }), true);
    check("no .locked copy was made", "secrets.locked" in t.values, false);
    check("the only keys ever set", t.sets, ["web.trace"]);
  }

  console.log("— writes go one at a time, in order —");
  {
    let release;
    const held = new Promise((r) => { release = r; });
    const t = boot({ initial: {}, slowSet: async (key, value) => { if (value.includes('"first"')) await held; } });
    const aurora = await t.ready;
    const a = aurora.store.write("web.prefs", { v: "first" });
    const b = aurora.store.write("web.prefs", { v: "second" });
    await new Promise((r) => setImmediate(r));
    check("the second write waits for the first", t.sets, ["web.prefs"]);
    release();
    await Promise.all([a, b]);
    check("the last write wins, as it was asked last", JSON.parse(t.values["web.prefs"]).v, "second");
  }

  console.log("— provider logins never reach a screen or a log —");
  {
    const t = boot({ initial: { prefs: PREFS, secrets: SECRETS } });
    const aurora = await t.ready;
    const r = aurora.redact;
    check("path credentials", r("GET http://x.example/live/alice/s3cret/123.ts failed"), "GET http://x.example/live/***/***/123.ts failed");
    check("query credentials", r("player_api.php?username=alice&password=s3cret&action=x"), "player_api.php?username=***&password=***&action=x");
    check("a configured line's URL keeps only its host", r("Error: http://line.example:8080/get.php?type=m3u&u=alice&p=s3cret"), "Error: http://line.example:8080/…");
    check("no password survives any of it", [r("http://line.example:8080/movie/alice/s3cret/9.mp4"), r("?token=abc&key=def")].join(" ").includes("s3cret") || r("?token=abc").includes("abc"), false);
  }

  console.log(failed ? `\n${failed} failed` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
