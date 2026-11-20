import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { tmdb, item, IMG } from "./tmdb.js";
import { WideCard, Scroller } from "./Home.jsx";
import { PosterCard } from "./Browse.jsx";

/* atlantic.bz/person/<id>: the photo, department, name, birth and birthplace,
   counts, IMDb and the biography (six lines, then Read more); Known For; up to
   14 photos; and the filmography with its filters. The markup is the site's.
   Rules found by matching the site (Timothée Chalamet, Christopher Nolan):
   - counts: every credited title, once; Movies and TV Shows split them
   - Career: the first and last year of the credits that are not talk shows
     or appearances as oneself, up to this year
   - Known For: the site's own ranking (see below)
   - Filmography: newest year first and, within a year, most popular; a
     title once, as its first credit; 24 at a time (see films below) */

const SELF = /\b(self|himself|herself|themselves)\b/i;
const TALK = new Set([10767, 10763]);   // talk and news shows
const PER_PAGE = 24;
const keyOf = (c) => `${c.media_type}/${c.id}`;
const dateOf = (c) => c.release_date || c.first_air_date || "";
const yearOf = (c) => Number(dateOf(c).slice(0, 4)) || 0;
const plain = (c) => !SELF.test(c.character || "") && !(c.genre_ids || []).some((g) => TALK.has(g));
const once = (list) => { const seen = new Map(); for (const c of list) if (!seen.has(keyOf(c))) seen.set(keyOf(c), c); return [...seen.values()]; };
const longDate = (d) => new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
const age = (from, to = new Date()) => { const b = new Date(`${from}T00:00:00`); let a = to.getFullYear() - b.getFullYear(); if (to < new Date(to.getFullYear(), b.getMonth(), b.getDate())) a -= 1; return a; };

const icon = (cls, children) => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`lucide ${cls}`} aria-hidden="true">{children}</svg>;
const Calendar = () => icon("lucide-calendar size-4", <><path d="M8 2v3" /><path d="M16 2v3" /><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /></>);
const Pin = () => icon("lucide-map-pin size-4", <><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" /><circle cx="12" cy="10" r="3" /></>);
const External = () => icon("lucide-external-link size-3.5", <><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>);
const Film = () => icon("lucide-film size-3.5", <><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M7 3v18" /><path d="M3 7.5h4" /><path d="M3 12h18" /><path d="M3 16.5h4" /><path d="M17 3v18" /><path d="M17 7.5h4" /><path d="M17 16.5h4" /></>);
const Tv = () => icon("lucide-tv size-3.5", <><path d="m17 2-5 5-5-5" /><rect width="20" height="15" x="2" y="7" rx="2" /></>);

const Stat = ({ value, label }) => <div className="min-w-[88px] rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-sm"><p className="text-xl font-bold text-white">{value}</p><p className="text-xs uppercase tracking-wide text-white/40">{label}</p></div>;

export default function Person() {
  const { id } = useParams();
  const [p, setP] = useState(null);
  const [error, setError] = useState(false);
  const [more, setMore] = useState(false);
  const [media, setMedia] = useState("all");
  const [role, setRole] = useState("all");
  const [hideSelf, setHideSelf] = useState(true);
  const [sort, setSort] = useState("newest");
  const [shown, setShown] = useState(PER_PAGE);
  useEffect(() => {
    setP(null); setError(false); setMore(false); setMedia("all"); setRole("all"); setHideSelf(true); setSort("newest"); setShown(PER_PAGE);
    tmdb(`/person/${id}`, { append_to_response: "combined_credits,images,external_ids" }).then((x) => { setP(x); document.title = `${x.name} — Aurora`; }).catch(() => setError(true));
  }, [id]);

  const d = useMemo(() => {
    if (!p) return null;
    const cast = p.combined_credits?.cast || [], crew = p.combined_credits?.crew || [];
    const all = once([...cast, ...crew]);
    const years = [...cast, ...crew].filter(plain).map(yearOf).filter((y) => y && y <= new Date().getFullYear());
    // Known For, as atlantic.bz picks it: one entry per title (its departments, episodes, and
    // whether every credit is a self appearance); titles with a poster and 20+ votes, from the
    // person's own department when it has 4 or more; ranked by log10(votes + 1) × 2 + rating +
    // popularity / 200, less 3 for a series they were in for only one or two episodes
    const titles = new Map();
    for (const c of [...cast.map((x) => ({ ...x, department: "Acting" })), ...crew]) {
      const k = keyOf(c);
      const e = titles.get(k) || { c, departments: new Set(), episodes: 0, self: true };
      e.departments.add(c.department);
      if (c.department === "Acting") e.episodes += c.episode_count || 0;
      if (c.department !== "Acting" || plain(c)) e.self = false;
      titles.set(k, e);
    }
    const score = (e) => Math.log10((e.c.vote_count || 0) + 1) * 2 + (e.c.vote_average || 0) + (e.c.popularity || 0) / 200 - (e.c.media_type === "tv" && e.episodes > 0 && e.episodes < 3 ? 3 : 0);
    const eligible = [...titles.values()].filter((e) => !e.self && e.c.poster_path && (e.c.vote_count || 0) >= 20);
    const dept = p.known_for_department || "Acting";
    const ownDept = eligible.filter((e) => e.departments.has(dept));
    const known = (ownDept.length >= 4 ? ownDept : eligible).sort((a, b) => score(b) - score(a)).slice(0, 12).map((e) => e.c);
    const roles = [["Acting", once(cast).length], ...Object.entries(crew.reduce((m, c) => { (m[c.department] ||= new Set()).add(keyOf(c)); return m; }, {})).map(([k, v]) => [k, v.size]).sort((a, b) => b[1] - a[1])].filter(([, n]) => n);
    return { cast, crew, all, known, roles, career: years.length ? (Math.min(...years) === Math.max(...years) ? String(years[0]) : `${Math.min(...years)} - ${Math.max(...years)}`) : "" };
  }, [p]);

  /* the filmography, as the site builds it: credits grouped by title (acting
     first); with "Hide talk shows…" a title goes only if every credit on it is
     a talk show or an appearance as oneself; the line under a card is the
     title's first credit; the count includes titles without a poster, which
     the grid leaves out */
  const films = useMemo(() => {
    if (!d) return { count: 0, list: [] };
    let credits = role === "all" ? [...d.cast, ...d.crew] : role === "Acting" ? d.cast : d.crew.filter((c) => c.department === role);
    if (media !== "all") credits = credits.filter((c) => c.media_type === media);
    const groups = new Map();
    for (const c of credits) { if (!groups.has(keyOf(c))) groups.set(keyOf(c), []); groups.get(keyOf(c)).push(c); }
    let titles = [...groups.values()].filter((g) => !hideSelf || g.some(plain)).map((g) => g[0]);
    const by = {
      newest: (a, b) => yearOf(b) - yearOf(a) || b.popularity - a.popularity,
      oldest: (a, b) => (yearOf(a) || 9999) - (yearOf(b) || 9999) || b.popularity - a.popularity,
      popular: (a, b) => b.popularity - a.popularity,
      rated: (a, b) => (b.vote_average || 0) - (a.vote_average || 0),
    }[sort];
    titles = titles.sort(by);
    return { count: titles.length, list: titles.filter((c) => c.poster_path) };
  }, [d, role, hideSelf, media, sort]);

  if (error) return <div className="px-6 pt-32 sm:px-[60px]"><h1 className="text-3xl font-bold text-white">Not found</h1></div>;
  if (!p || !d) return <div className="h-[560px]" />;
  const bio = (p.biography || "").split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  const long = (p.biography || "").length > 700;
  const backdrop = d.known[0]?.backdrop_path;
  const movies = d.all.filter((c) => c.media_type === "movie").length, shows = d.all.filter((c) => c.media_type === "tv").length;
  const TAB = "flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors";
  const CHIP = "rounded-full border px-3.5 py-1 text-xs font-medium transition-colors";
  const tab = (k, label, count, ic) => <button key={k} type="button" onClick={() => { setMedia(k); setShown(PER_PAGE); }} className={`${TAB} ${media === k ? "bg-atlantic-500 text-white" : "text-white/60 hover:text-white"}`}>{ic}{label}<span className={media === k ? "text-white/80" : "text-white/30"}>{count}</span></button>;
  return (
    <div className="transition-opacity duration-150 opacity-100">
      <div className="relative -mt-[60px] overflow-hidden pb-24">
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[1040px] overflow-hidden" style={{ maskImage: "linear-gradient(black 62%, transparent 100%)" }}>
          {backdrop ? <img src={IMG("w1280", backdrop)} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full scale-105 object-cover object-top opacity-45 blur-[3px]" /> : null}
          <div className="absolute left-1/4 top-[-120px] h-[420px] w-[420px] rounded-full bg-atlantic-500/25 blur-[110px]" />
          <div className="absolute right-1/4 top-[-60px] h-[380px] w-[380px] rounded-full bg-atlantic-300/15 blur-[110px]" />
        </div>
        <section className="px-6 pt-[172px] sm:px-[60px]">
          <div className="flex flex-col items-center gap-8 md:flex-row md:items-start">
            <div className="w-52 shrink-0 overflow-hidden rounded-2xl bg-abyss-800 shadow-2xl shadow-black/60 ring-1 ring-white/10 md:w-64">
              {p.profile_path ? <img src={IMG("h632", p.profile_path)} alt={p.name} decoding="async" className="aspect-[2/3] w-full object-cover" /> : <div className="aspect-[2/3] w-full" />}
            </div>
            <div className="min-w-0 flex-1 text-center md:text-left">
              {p.known_for_department ? <span className="inline-block rounded-full border border-atlantic-400/30 bg-atlantic-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-atlantic-300">{p.known_for_department}</span> : null}
              <h1 className="mt-3 text-4xl font-bold text-white drop-shadow-md sm:text-5xl">{p.name}</h1>
              <div className="mt-4 flex flex-col items-center gap-2 md:items-start">
                {p.birthday ? <div className="flex items-start gap-2 text-sm text-white/70"><span className="mt-0.5 shrink-0 text-atlantic-300"><Calendar /></span><span>Born {longDate(p.birthday)}{p.deathday ? "" : ` (${age(p.birthday)} years old)`}</span></div> : null}
                {p.deathday ? <div className="flex items-start gap-2 text-sm text-white/70"><span className="mt-0.5 shrink-0 text-atlantic-300"><Calendar /></span><span>Died {longDate(p.deathday)}{p.birthday ? ` (aged ${age(p.birthday, new Date(`${p.deathday}T00:00:00`))})` : ""}</span></div> : null}
                {p.place_of_birth ? <div className="flex items-start gap-2 text-sm text-white/70"><span className="mt-0.5 shrink-0 text-atlantic-300"><Pin /></span><span>{p.place_of_birth}</span></div> : null}
              </div>
              <div className="mt-6 flex flex-wrap justify-center gap-3 md:justify-start">
                <Stat value={d.all.length} label="Credits" />
                <Stat value={movies} label="Movies" />
                <Stat value={shows} label="TV Shows" />
                {d.career ? <Stat value={d.career} label="Career" /> : null}
              </div>
              {p.external_ids?.imdb_id ? <div className="mt-6 flex flex-wrap justify-center gap-3 md:justify-start"><a href={`https://www.imdb.com/name/${p.external_ids.imdb_id}/`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 transition-colors hover:border-atlantic-400/50 hover:text-white">IMDb<External /></a></div> : null}
              {bio.length || p.also_known_as?.length ? (
                <div className="mt-6 max-w-3xl text-left">
                  {bio.length ? <div className={`space-y-3 text-sm leading-relaxed text-white/75 sm:text-base ${long && !more ? "line-clamp-6" : ""}`}>{bio.map((t, i) => <p key={i}>{t}</p>)}</div> : null}
                  {long ? <button type="button" onClick={() => setMore((v) => !v)} className="mt-2 text-sm font-medium text-atlantic-300 transition-colors hover:text-atlantic-200">{more ? "Show less" : "Read more"}</button> : null}
                  {p.also_known_as?.length ? <p className="mt-4 text-xs text-white/40">Also known as {p.also_known_as.slice(0, 4).join(", ")}</p> : null}
                </div>
              ) : null}
            </div>
          </div>
        </section>
        {d.known.length ? (
          <div className="mt-12">
            <section className="relative mb-6">
              <div className="mb-4 flex items-center justify-between px-6 sm:px-[60px] short:px-6"><h2 className="text-xl font-semibold text-white/90 drop-shadow-md transition-colors duration-300">Known For</h2></div>
              <Scroller className="no-scrollbar overflow-x-auto overflow-y-hidden flex gap-5 px-6 py-6 sm:px-[60px] short:px-6">
                {d.known.map((c) => <WideCard key={keyOf(c)} it={item(c, c.media_type)} />)}
              </Scroller>
            </section>
          </div>
        ) : null}
        {p.images?.profiles?.length ? (
          <section className="px-6 pb-4 sm:px-[60px]">
            <h2 className="mb-4 text-xl font-semibold text-white/90 drop-shadow-md">Photos</h2>
            <div className="no-scrollbar flex gap-3 overflow-x-auto pb-2">
              {p.images.profiles.slice(0, 14).map((ph) => (
                <a key={ph.file_path} href={IMG("original", ph.file_path)} target="_blank" rel="noopener noreferrer" className="group block h-52 shrink-0 overflow-hidden rounded-xl bg-abyss-800 ring-1 ring-white/10 transition-transform duration-200 hover:-translate-y-1 hover:ring-atlantic-400/40">
                  <img src={IMG("w342", ph.file_path)} alt={`${p.name} photo`} loading="lazy" decoding="async" className="h-full w-auto object-cover" />
                </a>
              ))}
            </div>
          </section>
        ) : null}
        <section className="px-6 pt-10 sm:px-[60px]">
          <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div><h2 className="text-2xl font-semibold text-white/90 drop-shadow-md">Filmography</h2><p className="mt-1 text-sm text-white/40">{films.count} titles</p></div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-full border border-white/10 bg-white/5 p-1">
                {tab("all", "All", d.all.length)}{tab("movie", "Movies", movies, <Film />)}{tab("tv", "TV Shows", shows, <Tv />)}
              </div>
              <select aria-label="Sort filmography" value={sort} onChange={(e) => { setSort(e.target.value); setShown(PER_PAGE); }} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 outline-none transition-colors hover:border-atlantic-400/50 focus:border-atlantic-400/50">
                {[["newest", "Newest first"], ["oldest", "Oldest first"], ["popular", "Most popular"], ["rated", "Top rated"]].map(([v, l]) => <option key={v} value={v} className="bg-abyss-900 text-white">{l}</option>)}
              </select>
            </div>
          </div>
          <div className="mb-6 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => { setRole("all"); setShown(PER_PAGE); }} className={`${CHIP} ${role === "all" ? "border-atlantic-400/50 bg-atlantic-500/20 text-white" : "border-white/10 bg-white/5 text-white/60 hover:text-white"}`}>All roles</button>
            {d.roles.map(([r, n]) => <button key={r} type="button" onClick={() => { setRole(r); setShown(PER_PAGE); }} className={`${CHIP} ${role === r ? "border-atlantic-400/50 bg-atlantic-500/20 text-white" : "border-white/10 bg-white/5 text-white/60 hover:text-white"}`}>{r} <span className="text-white/30">{n}</span></button>)}
            <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-white/50"><input type="checkbox" className="size-3.5 accent-atlantic-500" checked={hideSelf} onChange={(e) => { setHideSelf(e.target.checked); setShown(PER_PAGE); }} />Hide talk shows and appearances as self</label>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-x-4 gap-y-6">
            {films.list.slice(0, shown).map((c) => {
              const it = item(c, c.media_type);
              return (
                <div key={keyOf(c)} className="min-w-0">
                  <PosterCard it={it} />
                  <div className="mt-2 px-0.5"><p className="truncate text-sm font-medium text-white/85">{it.title}</p><p className="truncate text-xs text-white/40">{[yearOf(c) || "", c.character != null ? (c.character ? `as ${c.character}` : "") : c.job || ""].filter(Boolean).join(" · ")}</p></div>
                </div>
              );
            })}
          </div>
          {films.count > shown ? <div className="mt-8 flex justify-center"><button type="button" onClick={() => setShown((n) => n + PER_PAGE)} className="rounded-full border border-white/10 bg-white/5 px-6 py-2.5 text-sm font-medium text-white/80 transition-colors hover:border-atlantic-400/50 hover:text-white">Show more ({films.count - shown} remaining)</button></div> : null}
        </section>
      </div>
    </div>
  );
}
