/* AniList, the way atlantic.bz's Anime page uses it. Each row's query was
   found by matching the site's titles one for one (all six rows, 20 of 20,
   and every card's title, badges and line):
   - Trending Now: TRENDING_DESC (its first six with banners are the hero)
   - Popular This Season / Coming Next Season: POPULARITY_DESC in that season
   - Top Rated: SCORE_DESC, TV, films and ONAs only
   - All Time Popular: POPULARITY_DESC; Movies: the same, films only
   AniList's public API needs no key; answers are cached for the session. */
const API = "https://graphql.anilist.co";
const FIELDS = "id idMal type title{english romaji} format episodes seasonYear averageScore genres description(asHtml:false) bannerImage coverImage{large color}";
const cache = new Map();

function gql(query) {
  if (!cache.has(query)) {
    cache.set(query, fetch(API, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ query }) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`AniList ${r.status}`))))
      .then((d) => (d.errors?.length ? Promise.reject(new Error(d.errors[0].message)) : d.data))
      .catch((e) => { cache.delete(query); throw e; }));
  }
  return cache.get(query);
}

function page(args) {
  return gql(`query{Page(perPage:20){media(type:ANIME,${args}){${FIELDS}}}}`).then((d) => (d.Page?.media || []).map(shape));
}

const FORMAT = { TV: "TV", TV_SHORT: "Short", MOVIE: "Movie", SPECIAL: "Special", OVA: "OVA", ONA: "ONA", MUSIC: "Music" };
/* AniList's descriptions carry a little HTML and a source credit. As the site
   shows them (checked on four titles): a run of line breaks, with the space
   before it and a newline after it, is one blank line; the other tags go; a
   closing "(Source: …)" goes too. */
function plain(s) {
  const el = document.createElement("textarea");
  el.innerHTML = String(s || "").replace(/\s*(?:<br\s*\/?>\n?)+/gi, "\n\n").replace(/\r\n?/g, "\n").replace(/<[^>]+>/g, "");
  return el.value.replace(/\(Source:[^)]*\)\s*$/i, "").trim();
}

function shape(x) {
  // the season year only: the site shows no year for a title without one, even with a start date
  const year = x.seasonYear || "";
  return {
    id: x.id,
    mal: x.idMal || 0,
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

/* One anime, as its page shows it (matched against the site on a series, a
   film and two more): the facts box, the episodes, Seasons & Related and
   More Like This. */
const RELATION_ORDER = ["PREQUEL", "SEQUEL", "PARENT", "SIDE_STORY", "SPIN_OFF", "ALTERNATIVE", "SUMMARY", "COMPILATION", "CONTAINS", "SOURCE", "ADAPTATION", "OTHER"];
// the small label over a related title; a type without one says "Related"
const RELATION_LABEL = { PREQUEL: "Prequel", SEQUEL: "Sequel", PARENT: "Parent", SIDE_STORY: "Side story", SPIN_OFF: "Spin-off", ALTERNATIVE: "Alternative", SUMMARY: "Summary", COMPILATION: "Compilation", CONTAINS: "Contains", SOURCE: "Source", ADAPTATION: "Adaptation" };
const titleCase = (s) => String(s || "").toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export async function anime(id) {
  const d = await gql(`query{Media(id:${Number(id)},type:ANIME){${FIELDS} duration season status nextAiringEpisode{episode airingAt} studios(isMain:true){nodes{name}} streamingEpisodes{title thumbnail}
    relations{edges{relationType node{${FIELDS}}}}
    recommendations(sort:RATING_DESC,perPage:14){nodes{mediaRecommendation{${FIELDS}}}}}}`);
  const x = d.Media;
  if (!x) throw new Error("No such anime");
  const a = shape(x);
  const next = x.nextAiringEpisode;
  // a show still airing has no episode total: the aired count is the next episode's number less one
  const count = x.episodes || (next ? next.episode - 1 : 0);
  const rank = (t) => RELATION_ORDER.indexOf(t);   // a type the site does not list comes first, as it does there
  return {
    ...a,
    rawFormat: x.format || "",
    duration: x.duration || 0,
    aired: x.season && x.seasonYear ? `${titleCase(x.season)} ${x.seasonYear}` : x.seasonYear ? String(x.seasonYear) : "",
    status: titleCase(x.status),
    studio: x.studios?.nodes?.[0]?.name || "",
    count,
    countLabel: x.episodes ? String(x.episodes) : next ? `${next.episode - 1}+` : "",
    nextLine: next ? `Episode ${next.episode} airs ${new Date(next.airingAt * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "",
    // the episodes' own names and pictures, where AniList has them ("Episode 1 - To You…")
    named: Object.fromEntries((x.streamingEpisodes || []).map((e) => { const m = /^Episode\s+(\d+)\s*-\s*(.*)$/i.exec(e.title || ""); return m ? [Number(m[1]), { title: m[2], thumb: e.thumbnail || "" }] : null; }).filter(Boolean)),
    english: x.title?.english || "", romaji: x.title?.romaji || "",
    related: (x.relations?.edges || []).filter((e) => e.node?.type === "ANIME").sort((p, q) => rank(p.relationType) - rank(q.relationType)).map((e) => ({ ...shape(e.node), label: RELATION_LABEL[e.relationType] || "Related" })),
    similar: (x.recommendations?.nodes || []).map((n) => n.mediaRecommendation).filter(Boolean).map(shape),
  };
}
