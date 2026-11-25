/* What the player borrows from two free services, as atlantic.bz does:
   - TheIntroDB (api.theintrodb.org): community timestamps of intros, recaps,
     credits and previews, by TMDB id (and season and episode);
   - OpenSubtitles (rest.opensubtitles.org): subtitles in many languages, by
     IMDb id (and season and episode), downloaded as UTF-8 text.
   Both are public, need no key and answer the browser directly. */

const cache = new Map();
const once = (key, fn) => { if (!cache.has(key)) cache.set(key, fn().catch((e) => { cache.delete(key); throw e; })); return cache.get(key); };

/* [{kind: "intro"|"recap"|"credits"|"preview", start, end}] in seconds; end is null when it runs to the end */
export function segments({ tmdb, season, episode }) {
  if (!tmdb) return Promise.resolve([]);
  const q = new URLSearchParams({ tmdb_id: String(tmdb), ...(season ? { season: String(season), episode: String(episode) } : {}) });
  return once(`seg:${q}`, () => fetch(`https://api.theintrodb.org/v4/media?${q}`).then((r) => (r.ok ? r.json() : {})).then((d) =>
    ["intro", "recap", "credits", "preview"].flatMap((kind) => (d[kind] || []).map((s) => ({ kind, start: (s.start_ms || 0) / 1000, end: s.end_ms == null ? null : s.end_ms / 1000 })))
  )).catch(() => []);
}

/* the flag the site shows beside each language (flag-icons country codes) */
const FLAG = { en: "us", ar: "sa", bn: "bd", bg: "bg", zh: "cn", ze: "cn", zt: "tw", hr: "hr", cs: "cz", da: "dk", nl: "nl", et: "ee", fa: "ir", fi: "fi", fr: "fr", de: "de", el: "gr", he: "il", hi: "in", hu: "hu", id: "id", it: "it", ja: "jp", ko: "kr", lv: "lv", lt: "lt", ms: "my", no: "no", pl: "pl", pt: "pt", pb: "br", ro: "ro", ru: "ru", sr: "rs", sk: "sk", sl: "si", es: "es", sv: "se", th: "th", tr: "tr", uk: "ua", vi: "vn", mk: "mk", sq: "al", bs: "ba", ca: "es-ct", eu: "es-pv", gl: "es-ga", is: "is", ka: "ge", kk: "kz", ml: "in", ta: "in", te: "in", ur: "pk", tl: "ph", sw: "ke", af: "za", hy: "am", az: "az", be: "by", ku: "iq", my: "mm", km: "kh", lo: "la", mn: "mn", ne: "np", si: "lk" };
export const flagOf = (iso) => FLAG[iso] || "";

/* the subtitles for a film or an episode, by language: English first, then A–Z,
   each language's files most downloaded first */
export function subtitles({ imdb, season, episode }) {
  const id = String(imdb || "").replace(/^tt/, "");
  if (!id) return Promise.resolve([]);
  const path = season ? `episode-${episode}/imdbid-${id}/season-${season}` : `imdbid-${id}`;
  return once(`subs:${path}`, () => fetch(`https://rest.opensubtitles.org/search/${path}`).then((r) => (r.ok ? r.json() : [])).then((list) => {
    const by = new Map();
    for (const s of Array.isArray(list) ? list : []) {
      if (!/^(srt|vtt|sub)$/i.test(s.SubFormat || "")) continue;
      const key = s.LanguageName || s.ISO639;
      if (!by.has(key)) by.set(key, { name: key, iso: s.ISO639, files: [] });
      by.get(key).files.push({ id: s.IDSubtitleFile, name: s.SubFileName, downloads: Number(s.SubDownloadsCnt) || 0, link: s.SubDownloadLink });
    }
    const langs = [...by.values()];
    langs.forEach((l) => l.files.sort((a, b) => b.downloads - a.downloads));
    return langs.sort((a, b) => (a.iso === "en" ? -1 : b.iso === "en" ? 1 : a.name.localeCompare(b.name)));
  })).catch(() => []);
}

/* one subtitle file as UTF-8 text (the site's own download form) */
export function subtitleText(file) {
  const url = String(file.link || "").replace("/download/", "/download/subencoding-utf8/").replace(/\/filead\/(\d+)\.gz$/, "/file/$1");
  return once(`file:${file.id}`, () => fetch(url).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`OpenSubtitles ${r.status}`)))));
}
