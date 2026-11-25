/* The older Aurora (app/, the old Mac app and the TV's main app) keeps Continue Watching on the
   account too, in its own `progress` table, under your line's stream numbers ("movie-940632")
   with your line's name for the title ("FHD | Ballerina (2023)"). This interface keys it by
   TMDB id. These pick out what you were partway through there and find each title's TMDB id,
   so cloud.js can bring it across once per account. No imports: tests run it in Node. */

const FINISHED = 0.95;   // as line.js: past this share a title counts as watched

/* "FHD | Ballerina (2023)", "4K-AR - The Amazing Spider-Man (2012)", "AMZN l Moana (2026)",
   "FR - Spider-Man : No Way Home (2021)" → { name, year } */
export function cleanName(title) {
  let s = String(title || "").trim();
  // the line's tags in front: quality, language, store or list, then | : - – or a lone "l"
  for (let i = 0; i < 3; i++) s = s.replace(/^(?:[A-Z0-9]{2,6}(?:-[A-Z]{2})?)\s*(?:[|:\-–]|\sl\s)\s*/u, "");
  const year = (s.match(/\((19|20)\d{2}\)\s*$/) || [])[0]?.slice(1, 5) || "";
  const name = s.replace(/\((19|20)\d{2}\)\s*$/, "").replace(/\s+:\s+/g, ": ").replace(/\s{2,}/g, " ").trim();
  return { name, year };
}

/* the films and series you were partway through, newest first: one entry per title (a series'
   latest episode), skipping what you hid, finished, never started, and live channels */
export function pickOld(rows) {
  const latest = new Map();
  for (const row of rows || []) {
    const r = row.record || {};
    if (row.deleted || !r || (r.type !== "movie" && r.type !== "episode")) continue;
    const at = Date.parse(row.updated_at) || 0;
    const id = r.type === "movie" ? `movie|${row.key}` : `tv|${r.seriesId || cleanName(r.title).name}`;
    if (!latest.has(id) || at > latest.get(id).at) latest.set(id, { row, r, at });
  }
  const out = [];
  for (const { r, at } of latest.values()) {
    if (r.hidden || !(r.position > 0) || !(r.duration > 0) || r.position >= r.duration * FINISHED) continue;
    const { name, year } = cleanName(r.title);
    if (!name) continue;
    let season = 0, episode = 0;
    if (r.type === "episode") {
      const m = /S(\d+)\s*E(\d+)/i.exec(r.subtitle || "");
      season = Number(r.season) || Number(m?.[1]) || 0; episode = Number(m?.[2]) || 0;
      if (!season || !episode) continue;
    }
    out.push({ type: r.type === "movie" ? "movie" : "tv", name, year, season, episode, position: r.position, duration: r.duration, at, from: r.title });
  }
  return out.sort((a, b) => b.at - a.at);
}

/* the title's TMDB id: a search by name and year, then by name alone; null without a year, when
   nothing comes back, or when the best answer's name does not match (better left out than wrong).
   search(path, params) is tmdb.js's tmdb() in the app. */
const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export async function findTmdb(c, search) {
  const path = c.type === "movie" ? "/search/movie" : "/search/tv";
  const yearKey = c.type === "movie" ? "year" : "first_air_date_year";
  // without a year a name is a guess (a remake, a series of the same name): left out
  if (!c.year) return null;
  const tries = [{ query: c.name, [yearKey]: c.year }, { query: c.name }];
  for (const params of tries) {
    const res = await search(path, params).catch(() => null);
    const yearOf = (x) => Number((x.release_date || x.first_air_date || "").slice(0, 4)) || 0;
    const hit = (res?.results || []).find((x) => (norm(x.title || x.name) === norm(c.name) || norm(x.original_title || x.original_name) === norm(c.name))
      && Math.abs(yearOf(x) - Number(c.year)) <= 1);
    if (hit) return { id: hit.id, title: hit.title || hit.name, year: (hit.release_date || hit.first_air_date || "").slice(0, 4) };
  }
  return null;
}
