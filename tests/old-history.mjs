// The older app's Continue Watching, brought into the new interface (site/src/oldHistory.js):
// its title names cleaned, and only what you were partway through picked. No network.
import assert from "node:assert/strict";
const { cleanName, pickOld, findTmdb } = await import("../site/src/oldHistory.js");

assert.deepEqual(cleanName("FHD | Ballerina (2023)"), { name: "Ballerina", year: "2023" });
assert.deepEqual(cleanName("4K-AR - The Amazing Spider-Man (2012)"), { name: "The Amazing Spider-Man", year: "2012" });
assert.deepEqual(cleanName("4K-AR: Spider-Man: Across the Spider-Verse (2023)"), { name: "Spider-Man: Across the Spider-Verse", year: "2023" });
assert.deepEqual(cleanName("AMZN l Moana (2026)"), { name: "Moana", year: "2026" });
assert.deepEqual(cleanName("FR - Spider-Man : No Way Home (2021)"), { name: "Spider-Man: No Way Home", year: "2021" });
assert.deepEqual(cleanName("Coyote vs. Acme (2026)"), { name: "Coyote vs. Acme", year: "2026" });
assert.deepEqual(cleanName("Resident Evil "), { name: "Resident Evil", year: "" });

const row = (key, at, record) => ({ key, updated_at: at, deleted: false, record });
const picked = pickOld([
  row("movie-1", "2026-11-04T00:00:00Z", { type: "movie", title: "Primetime (2026)", position: 1800, duration: 6500 }),
  row("movie-2", "2026-11-03T00:00:00Z", { type: "movie", title: "Hidden (2026)", position: 100, duration: 6000, hidden: true }),
  row("movie-3", "2026-11-03T00:00:00Z", { type: "movie", title: "Never started (2026)", position: 0, duration: 6000 }),
  row("movie-4", "2026-11-03T00:00:00Z", { type: "movie", title: "Finished (2026)", position: 5900, duration: 6000 }),
  row("live-5", "2026-11-03T00:00:00Z", { type: "live", title: "A channel", position: 0, duration: 0 }),
  // a series: its latest episode only (here finished, so it is left out), another series in progress
  row("episode-6", "2026-10-18T00:00:00Z", { type: "episode", title: "MobLand (2025)", seriesId: 9, season: "2", position: 2280, duration: 2300, subtitle: "S2 E5 • MobLand" }),
  row("episode-7", "2026-10-17T00:00:00Z", { type: "episode", title: "MobLand (2025)", seriesId: 9, season: "2", position: 1600, duration: 2600, subtitle: "S2 E4 • MobLand" }),
  row("episode-8", "2026-11-02T00:00:00Z", { type: "episode", title: "4K | Lupin (2021)", seriesId: 3, season: "1", position: 4, duration: 2520, subtitle: "S1 E3 • 4K | Lupin (2021) - S01E03" }),
]);
assert.deepEqual(picked.map((c) => [c.type, c.name, c.season, c.episode]), [["movie", "Primetime", 0, 0], ["tv", "Lupin", 1, 3]]);

// a match needs the same name and a year within one; no year, no match
const search = async (path, params) => ({ results: params.year === "2016" || !params.year ? [{ id: 9, title: "Moana", release_date: "2026-11-01" }, { id: 7, title: "Moana", release_date: "2016-11-23" }] : [] });
assert.deepEqual(await findTmdb({ type: "movie", name: "Moana", year: "2016" }, search), { id: 7, title: "Moana", year: "2016" });
assert.equal(await findTmdb({ type: "movie", name: "Resident Evil", year: "" }, search), null);
assert.equal(await findTmdb({ type: "movie", name: "Moana", year: "1990" }, search), null);
console.log("old history: ok");
