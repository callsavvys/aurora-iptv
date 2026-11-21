import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { tmdb, item } from "./tmdb.js";
import { PosterCard } from "./Browse.jsx";

/* atlantic.bz's search page: three cyan glows at the top, "What are you in
   the mood for?", a kind picker beside a round search box, four suggestions,
   then Trending Today — or the results, once you type. */

const KINDS = [
  { id: "multi", label: "Movies & TV", placeholder: "Search for movies & TV shows..." },
  { id: "movie", label: "Movies", placeholder: "Search for movies..." },
  { id: "tv", label: "TV Shows", placeholder: "Search for TV shows..." },
];
const SUGGEST = ["interstellar", "brooklyn 99", "the odyssey", "spider-man"];
const Film = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-film size-4 text-atlantic-300" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M7 3v18" /><path d="M3 7.5h4" /><path d="M3 12h18" /><path d="M3 16.5h4" /><path d="M17 3v18" /><path d="M17 7.5h4" /><path d="M17 16.5h4" /></svg>;
const Down = ({ open }) => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`lucide lucide-chevron-down size-4 text-white/50 transition-transform duration-200${open ? " rotate-180" : ""}`} aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>;

export default function Search() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") || "");
  const [kind, setKind] = useState(KINDS[0]);
  const [open, setOpen] = useState(false);
  const [trending, setTrending] = useState([]);
  const [results, setResults] = useState(null);
  const input = useRef(null);
  useEffect(() => { document.title = "Search — Aurora"; input.current?.focus(); tmdb("/trending/all/week")  /* the site titles it "Today", but it is this week's list (matched title for title) */.then((r) => setTrending((r.results || []).filter((x) => x.media_type !== "person").map((x) => item(x)))).catch(() => {}); }, []);
  useEffect(() => {
    const text = q.trim();
    setParams(text ? { q: text } : {}, { replace: true });
    if (!text) { setResults(null); return; }
    let live = true;
    const t = setTimeout(() => {
      tmdb(`/search/${kind.id}`, { query: text, include_adult: "false" })
        .then((r) => { if (live) setResults((r.results || []).filter((x) => x.media_type !== "person" && (x.poster_path || x.backdrop_path)).map((x) => item(x, kind.id === "multi" ? undefined : kind.id))); })
        .catch(() => live && setResults([]));
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = results ?? trending;
  return (
    <div className="transition-opacity duration-150 opacity-100">
      <div className="relative min-h-[calc(100vh-71px)] overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] overflow-hidden">
          <div className="absolute left-1/4 top-[-120px] h-[420px] w-[420px] rounded-full bg-atlantic-500/30 blur-[110px]" />
          <div className="absolute right-1/4 top-[-60px] h-[380px] w-[380px] rounded-full bg-atlantic-300/20 blur-[110px]" />
          <div className="absolute left-1/2 top-[80px] h-[320px] w-[320px] -translate-x-1/2 rounded-full bg-atlantic-700/30 blur-[110px]" />
        </div>
        <div className="px-6 pb-16 pt-16 sm:px-[60px]">
          <h1 className="text-center text-3xl font-bold text-white sm:text-4xl">What are you in the mood for?</h1>
          <div className="mx-auto mt-8 max-w-3xl">
            <div className="flex flex-col items-stretch gap-3 sm:flex-row">
              <div className="relative shrink-0">
                <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={`Search in ${kind.label}`} onClick={() => setOpen((v) => !v)} className="flex h-full items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-4 text-sm font-medium text-white outline-none backdrop-blur-sm transition-colors hover:border-atlantic-400/50 focus-visible:border-atlantic-400/50">
                  <Film /><span className="whitespace-nowrap">{kind.label}</span><Down open={open} />
                </button>
                {open ? (
                  <div role="listbox" className="absolute left-0 top-full z-40 mt-2 min-w-full overflow-hidden rounded-2xl border border-white/10 bg-pagebg/95 p-1 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.6)] backdrop-blur-md">
                    {KINDS.map((k) => <button key={k.id} type="button" role="option" aria-selected={k.id === kind.id} onClick={() => { setKind(k); setOpen(false); input.current?.focus(); }} className={`block w-full whitespace-nowrap rounded-xl px-4 py-2 text-left text-sm transition-colors hover:bg-white/10 ${k.id === kind.id ? "text-atlantic-300" : "text-white/80"}`}>{k.label}</button>)}
                  </div>
                ) : null}
              </div>
              <div className="relative min-w-0 flex-1">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none absolute left-5 top-1/2 z-[1] -translate-y-1/2 text-white/40"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
                <input ref={input} type="text" placeholder={kind.placeholder} value={q} onChange={(e) => setQ(e.target.value)} className="w-full rounded-full border border-white/10 bg-white/5 py-4 pl-12 pr-5 text-white placeholder:text-white/40 outline-none backdrop-blur-sm transition-colors focus:border-atlantic-400/50" />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {SUGGEST.map((s) => <button key={s} type="button" onClick={() => setQ(s)} className="rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-sm text-white/70 transition-colors hover:border-atlantic-400/50 hover:text-white">{s}</button>)}
            </div>
          </div>
          <h2 className="mt-14 text-center text-lg font-semibold text-white/80">{results ? `Results for "${q.trim()}"` : "Trending Today"}</h2>
          {results && !results.length ? <p className="mt-6 text-center text-sm text-white/50">Nothing found. Try another title.</p> : null}
          <div className="mx-auto mt-6 grid max-w-6xl grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-4">
            {shown.map((it) => <PosterCard key={`${it.type}-${it.id}`} it={it} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
