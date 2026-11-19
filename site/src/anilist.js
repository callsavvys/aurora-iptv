/* AniList, the way atlantic.bz's Anime page uses it. Each row's query was
   found by matching the site's titles one for one (all six rows, 20 of 20,
   and every card's title, badges and line):
   - Trending Now: TRENDING_DESC (its first six with banners are the hero)
   - Popular This Season / Coming Next Season: POPULARITY_DESC in that season
   - Top Rated: SCORE_DESC, TV, films and ONAs only
   - All Time Popular: POPULARITY_DESC; Movies: the same, films only
   AniList's public API needs no key; answers are cached for the session. */
const API = "https://graphql.anilist.co";
const FIELDS = "id title{english romaji} format episodes seasonYear startDate{year} averageScore genres description(asHtml:false) bannerImage coverImage{large color}";
const cache = new Map();

function page(args) {
  const query = `query{Page(perPage:20){media(type:ANIME,${args}){${FIELDS}}}}`;
  if (!cache.has(query)) {
    cache.set(query, fetch(API, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ query }) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`AniList ${r.status}`))))
      .then((d) => (d.data?.Page?.media || []).map(shape))
      .catch((e) => { cache.delete(query); throw e; }));
  }
  return cache.get(query);
}

const FORMAT = { TV: "TV", TV_SHORT: "TV Short", MOVIE: "Movie", SPECIAL: "Special", OVA: "OVA", ONA: "ONA", MUSIC: "Music" };
// AniList's descriptions carry a little HTML: line breaks become new lines, the rest goes
const plain = (s) => { const el = document.createElement("textarea"); el.innerHTML = String(s || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""); return el.value.trim(); };

function shape(x) {
  const year = x.seasonYear || x.startDate?.year || "";
  return {
    id: x.id,
    title: x.title?.english || x.title?.romaji || "",
    format: FORMAT[x.format] || x.format || "",
    score: x.averageScore ? (x.averageScore / 10).toFixed(1) : "",
    year: year ? String(year) : "",
    line: [year ? String(year) : "", x.episodes ? `${x.episodes} ep` : ""].filter(Boolean).join(" • "),
    genres: x.genres || [],
    description: plain(x.description),
    banner: x.bannerImage || "",
    cover: x.coverImage?.large || "",
    color: x.coverImage?.color || "",
  };
}

/* the anime season a date falls in, and the one after it */
function seasons(d = new Date()) {
  const order = ["WINTER", "SPRING", "SUMMER", "FALL"];
  const i = Math.floor(d.getMonth() / 3), y = d.getFullYear();
  return { now: { season: order[i], year: y }, next: { season: order[(i + 1) % 4], year: i === 3 ? y + 1 : y } };
}

export async function animeRows() {
  const { now, next } = seasons();
  const defs = [
    ["Trending Now", "sort:TRENDING_DESC,isAdult:false"],
    ["Popular This Season", `sort:POPULARITY_DESC,season:${now.season},seasonYear:${now.year},isAdult:false`],
    ["Top Rated", "sort:SCORE_DESC,isAdult:false,format_in:[TV,MOVIE,ONA]"],
    ["Coming Next Season", `sort:POPULARITY_DESC,season:${next.season},seasonYear:${next.year},isAdult:false`],
    ["All Time Popular", "sort:POPULARITY_DESC,isAdult:false"],
    ["Movies", "sort:POPULARITY_DESC,format:MOVIE,isAdult:false"],
  ];
  const lists = await Promise.all(defs.map(([, args]) => page(args).catch(() => [])));
  return { hero: lists[0].filter((a) => a.banner).slice(0, 6), rows: defs.map(([title], i) => ({ title, items: lists[i] })) };
}
