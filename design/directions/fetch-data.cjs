// Real artwork for the design directions, from TMDB — the same source the app
// uses, with the key the app ships. Writes data.json beside this file.
const fs = require("node:fs"), path = require("node:path");
const KEY = fs.readFileSync(path.join(__dirname, "../../app/renderer.js"), "utf8").match(/tmdb: "([0-9a-f]{32})"/)[1];
const api = (p, q = "") => fetch(`https://api.themoviedb.org/3${p}?api_key=${KEY}&language=en-US${q}`).then((r) => r.json());
const img = (size, p) => (p ? `https://image.tmdb.org/t/p/${size}${p}` : "");
const shape = (x, type) => ({
  id: x.id, type, title: x.title || x.name, year: String(x.release_date || x.first_air_date || "").slice(0, 4),
  rating: x.vote_average ? x.vote_average.toFixed(1) : "", overview: x.overview || "",
  poster: img("w342", x.poster_path), backdrop: img("w1280", x.backdrop_path), still: img("w780", x.backdrop_path),
});
(async () => {
  const [tm, tt, top, now, ar, anim] = await Promise.all([
    api("/trending/movie/week"), api("/trending/tv/week"), api("/movie/top_rated"), api("/movie/now_playing"),
    api("/discover/movie", "&with_original_language=ar&sort_by=popularity.desc"), api("/discover/tv", "&with_genres=16&sort_by=popularity.desc"),
  ]);
  const movies = tm.results.map((x) => shape(x, "movie")), shows = tt.results.map((x) => shape(x, "tv"));
  const heroes = [];
  for (const x of [...movies.slice(0, 3), ...shows.slice(0, 2)]) {
    const images = await api(`/${x.type}/${x.id}/images`, "&include_image_language=en,null");
    const logo = (images.logos || []).find((l) => l.iso_639_1 === "en") || (images.logos || [])[0];
    heroes.push({ ...x, logo: logo ? img("w500", logo.file_path) : "" });
  }
  const data = { heroes, movies, shows,
    top: top.results.map((x) => shape(x, "movie")), now: now.results.map((x) => shape(x, "movie")),
    arabic: ar.results.map((x) => shape(x, "movie")), animation: anim.results.map((x) => shape(x, "tv")) };
  fs.writeFileSync(path.join(__dirname, "data.json"), JSON.stringify(data));
  console.log("heroes", heroes.length, "with logos", heroes.filter((h) => h.logo).length,
    "| movies", movies.length, "shows", shows.length, "top", data.top.length, "arabic", data.arabic.length, "animation", data.animation.length);
})().catch((e) => { console.error("FAILED", e.message); process.exit(1); });
