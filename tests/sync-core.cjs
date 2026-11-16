// web/js/sync-core.js holds the record rules the old app (app/renderer.js) and
// the new interface (web/) share on the TV. These are those rules, run in Node
// (the page's own policy forbids evaluating source in it).
//   node tests/sync-core.cjs
// Value: protects=progress merge/hide/forget/cap, Continue watching selection, My List and sync
//   bookkeeping, the vault source merge and the library filter, as one copy both apps load;
//   fails_when=any rule changes shape or meaning (both apps would then disagree on saved data);
//   why_new=the rules moved out of renderer.js, where only Electron tests reached them indirectly;
//   seam=none; no_claim=Supabase sync itself and the UI that shows these lists
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ROOT = path.resolve(__dirname, "..");

let failed = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(`${ok ? "  ok  " : "FAIL  "}${label}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};

const sandbox = { Uint8Array, Math, Object, Map, Set, JSON };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, "web/js/sync-core.js"), "utf8"), sandbox);
const S = sandbox.AuroraSync;

const movie = (id, position, duration, updatedAt, extra = {}) => ({ key: id, id, type: "movie", title: id, subtitle: "Films", poster: "", position, duration, updatedAt, ...extra });
const episode = (show, n, position, duration, updatedAt, next = null, extra = {}) => ({
  key: `episode-${show}-${n}`, id: show, type: "episode", title: show, subtitle: `S1 E${n} • Ep ${n}`, poster: `${show}.jpg`,
  seriesId: `${show}-sid`, season: "1", episodeId: `${show}-${n}`, container: "mkv", position, duration, updatedAt, next, ...extra,
});
const live = (id, updatedAt) => ({ key: id, id, type: "live", title: id, subtitle: "News", poster: "", position: 0, duration: 0, updatedAt });

console.log("— progress records —");
{
  const p = new Map();
  S.mergeProgress(p, movie("m1", 100, 6000, 0), 1000);
  S.mergeProgress(p, { key: "m1", position: 200 }, 2000);
  check("a write merges onto the record and stamps updatedAt", [p.get("m1").title, p.get("m1").position, p.get("m1").duration, p.get("m1").updatedAt], ["m1", 200, 6000, 2000]);
  check("a write without a key changes nothing", [S.mergeProgress(p, { position: 5 }, 3000), p.size], [null, 1]);
  check("hiding keeps the record, marks it hidden and restamps it", [S.hideProgress(p, ["m1", "missing"], 3000), p.get("m1").hidden, p.get("m1").updatedAt, p.get("m1").position], [["m1"], true, 3000, 200]);
  S.mergeProgress(p, { key: "m1", position: 300 }, 4000);
  check("watching again brings it back (hidden is dropped)", "hidden" in p.get("m1"), false);
  const f = S.forgetProgress(p, { old: 1 }, ["m1", "missing"], 5000);
  check("forgetting deletes the record and leaves a tombstone, keeping older ones", [p.has("m1"), f.gone, f.changed], [false, { old: 1, m1: 5000 }, ["m1"]]);
}
{
  const p = new Map();
  for (let i = 0; i < S.HISTORY_CAP - 5; i += 1) p.set(`m${i}`, movie(`m${i}`, 0, 0, 10 + i));
  for (let i = 0; i < 10; i += 1) p.set(`l${i}`, live(`l${i}`, 100000 + i));
  const capped = S.capProgress(p);
  check("over 3,000 records, live channels go first even when newest", [capped.size, [...capped.values()].filter((r) => r.type === "live").length], [3000, 5]);
  const all = new Map(); for (let i = 0; i < 3005; i += 1) all.set(`m${i}`, movie(`m${i}`, 0, 0, i));
  check("then the oldest go", [S.capProgress(all).has("m0"), S.capProgress(all).has("m5"), S.capProgress(all).size], [false, true, 3000]);
  const small = new Map([["a", movie("a", 0, 0, 1)]]);
  check("under the cap the same map comes back", S.capProgress(small) === small, true);
}

console.log("— finished, underway, percent —");
check("underway needs more than 20 s", [S.underway(movie("a", 20, 100, 0)), S.underway(movie("a", 21, 100, 0))], [false, true]);
check("finished at 95% of the duration", [S.finished(movie("a", 94, 100, 0)), S.finished(movie("a", 95, 100, 0)), S.underway(movie("a", 95, 100, 0))], [false, true, false]);
check("no duration is never finished, and percent is 0", [S.finished(movie("a", 50, 0, 0)), S.percent(movie("a", 50, 0, 0)), S.percent(null)], [false, 0, 0]);
check("percent is capped at 100", S.percent(movie("a", 150, 100, 0)), 100);

console.log("— Continue watching —");
{
  const p = new Map();
  const add = (r) => p.set(r.key, r);
  add(movie("film-underway", 600, 6000, 50));
  add(movie("film-done", 5900, 6000, 60));
  add(movie("film-barely", 10, 6000, 70));
  add(movie("film-hidden", 600, 6000, 80, { hidden: true }));
  add(live("news", 90));
  const hint = { season: "1", episodeId: "showA-3", number: "3", title: "Ep 3", container: "mkv" };
  add(episode("showA", 1, 2000, 2000, 10));
  add(episode("showA", 2, 1990, 2000, 100, hint));
  add(episode("showB", 1, 300, 2000, 20));
  add(episode("showB", 2, 300, 2000, 110, null, { hidden: true }));
  add(episode("showC", 1, 2000, 2000, 30, null));
  const rows = S.continueWatching(p);
  check("films underway and shows with something next, newest first", rows.map((r) => r.kind === "movie" ? r.record.key : `${r.show.id}:${r.record.key}`), ["showA:episode-showA-3", "film-underway"]);
  const a = rows[0];
  check("a finished episode offers the next one from its hint, unstarted", [a.fresh, a.record.position, a.record.subtitle, a.record.seriesId, a.record.season, a.record.container], [true, 0, "S1 E3 • Ep 3", "showA-sid", "1", "mkv"]);
  check("a show whose latest record is hidden stays out, and a caught-up show too", rows.some((r) => r.show && (r.show.id === "showB" || r.show.id === "showC")), false);
  add(episode("showA", 3, 500, 2000, 40));
  check("the next episode already underway is resumed, not restarted", (() => { const r = S.continueWatching(p)[0]; return [r.fresh, r.record.position]; })(), [false, 500]);
  const many = new Map(); for (let i = 0; i < 21; i += 1) many.set(`f${i}`, movie(`f${i}`, 100, 6000, i));
  check("the row stops at 20, newest first", (() => { const r = S.continueWatching(many); return [r.length, r[0].record.key, r[19].record.key]; })(), [20, "f20", "f1"]);
  const shows = S.historyShows(p);
  const showA = shows.find((s) => s.id === "showA");
  check("History groups episodes per show on the newest record", [showA.episodes.length, showA.latest.key, showA.watched, showA.poster], [3, "episode-showA-2", 2, "showA.jpg"]);
  check("History is every record, newest first", S.watchHistory(p).map((r) => r.updatedAt).slice(0, 3), [110, 100, 90]);
}

console.log("— sync bookkeeping —");
check("markDirty adds a timestamp under its kind and keeps the rest", S.markDirty({ favorites: { a: 1 }, progress: {} }, "favorites", "b", 9), { favorites: { a: 1, b: 9 }, progress: {} });
check("markDirty starts from nothing", S.markDirty(null, "progress", "k", 3), { favorites: {}, progress: { k: 3 } });
check("noteFavorite records saved and when", S.noteFavorite({ x: { saved: true, at: 1 } }, "y", false, 5), { x: { saved: true, at: 1 }, y: { saved: false, at: 5 } });

console.log("— the vault —");
{
  const sourceKey = (s) => `${s.server}|${s.username}`;
  let n = 0; const newSourceId = () => `new-${++n}`;
  const local = [
    { id: "a", name: "Home", server: "h1", username: "u1", password: "p1", updatedAt: 10, count: 5 },
    { id: "b", name: "Old", server: "h2", username: "u2", password: "p2", updatedAt: 10 },
  ];
  const remote = {
    sources: [
      { id: "ra", name: "Home renamed", server: "h1", username: "u1", password: "p1b", updatedAt: 20 },
      { name: "New", server: "h3", username: "u3", password: "p3", updatedAt: 5 },
      { id: "rc", name: "Gone", server: "h4", username: "u4", password: "p4", updatedAt: 5 },
    ],
    removed: { "h2|u2": 30, "h4|u4": 5 },
    tmdb: "T2", omdb: "O2", tmdbAt: 50,
  };
  const m = S.mergeVault({ local, removed: {}, remote, sourceKey, newSourceId, keys: { tmdb: "T1", omdb: "O1", at: 40 } });
  check("newer remote change wins, keeping the local id and count", m.sources.find((s) => s.id === "a"), { id: "a", name: "Home renamed", server: "h1", username: "u1", password: "p1b", updatedAt: 20, count: 5 });
  check("a new source arrives with a fresh id and count 0", m.sources.find((s) => s.server === "h3"), { name: "New", server: "h3", username: "u3", password: "p3", updatedAt: 5, id: "new-1", count: 0 });
  check("a removal newer than the source deletes it; one not newer blocks re-adding", [m.sources.some((s) => s.server === "h2"), m.sources.some((s) => s.server === "h4")], [false, false]);
  check("gained counts new sources only; removals are remembered", [m.gained, m.changed, m.removed], [1, true, { "h2|u2": 30, "h4|u4": 5 }]);
  check("newer keys are adopted", m.keys, { tmdb: "T2", omdb: "O2", at: 50 });
  check("same or older keys are not", S.mergeVault({ local: [], removed: {}, remote: { sources: [], tmdb: "T2", omdb: "O2", tmdbAt: 50 }, sourceKey, newSourceId, keys: { tmdb: "T2", omdb: "O2", at: 40 } }).keys, null);
  check("the payload carries sources without counts, removals and keys", S.vaultPayload({ sources: local, removed: { x: 1 }, tmdb: "T", omdb: "O", keysUpdatedAt: 7 }), {
    v: 1, sources: [{ id: "a", name: "Home", server: "h1", username: "u1", password: "p1", updatedAt: 10 }, { id: "b", name: "Old", server: "h2", username: "u2", password: "p2", updatedAt: 10 }], removed: { x: 1 }, tmdb: "T", tmdbAt: 7, omdb: "O",
  });
}

console.log("— the library filter —");
{
  const items = [{ type: "movie", name: "Dune" }, { type: "series", name: "Severance" }, { type: "live", name: "News" }];
  const { bits, count } = S.libraryFilter(items, (item) => [item.name.toLowerCase(), `${item.name.toLowerCase()}|2024`]);
  check("films and series only, in a 64 KB filter", [count, bits.length], [2, 65536]);
  check("what went in is found, what did not is not", [S.filterHas(bits, "dune"), S.filterHas(bits, "severance|2024"), S.filterHas(bits, "news"), S.filterHas(bits, "arrival")], [true, true, false, false]);
  check("the hash is stable (friends' filters were built with it)", [S.fnv("dune", 0), S.fnv("dune", 3)], [3578671843, 766298560]);
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
