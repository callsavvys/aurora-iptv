import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { IMG, tmdb, item, homeRows, extras, PROVIDERS, providerRow, providerLogos } from "./tmdb.js";
import { PlayIcon, InfoIcon, ChevronRight, ChevronLeft, Chevron } from "./icons.jsx";
import { SaveButton, ListRows } from "./lists.jsx";
import { titlesWatched, forgetProgress } from "./line.js";
import { useContinueRows } from "./themes.jsx";
import ForYouBlock from "./ForYou.jsx";
import { isTV } from "./platform.js";
import { useSwipe } from "./gestures.js";

/* atlantic.bz's home page, element for element: the hero that turns over by
   itself, two Top 10 rows, then rows of wide cards carrying each title's logo.
   The class names are the site's own, so its stylesheet draws them. */

const titleUrl = (it) => `/title/${it.type}/${it.id}`;

/* the score as a ring: green when good, as on the site */
export function Ring({ rating }) {
  const r = Number(rating) || 0, c = 2 * Math.PI * 16;
  const colour = r >= 7 ? "#4ade80" : r >= 5 ? "#facc15" : "#f87171";
  return (
    <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/55 backdrop-blur-sm">
      <svg width="40" height="40" viewBox="0 0 40 40" className="absolute inset-0 -rotate-90">
        <circle cx="20" cy="20" r="16" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="3" />
        <circle cx="20" cy="20" r="16" fill="none" stroke={colour} strokeWidth="3" strokeLinecap="round" strokeDasharray={`${(c * Math.min(r, 10)) / 10} ${c}`} />
      </svg>
      <span className="relative text-[11px] font-bold text-white">{rating}</span>
    </div>
  );
}

/* ---------- the hero ---------- */
function Hero({ items }) {
  const [index, setIndex] = useState(0);
  const [meta, setMeta] = useState({});
  const nav = useNavigate();
  const paused = useRef(false);
  useEffect(() => { items.forEach((it) => extras(it).then((m) => setMeta((s) => ({ ...s, [it.id]: m }))).catch(() => {})); }, [items]);
  useEffect(() => {
    // on a TV it holds still while the remote is on its buttons, so they are not swapped under you
    const t = setInterval(() => { if (!paused.current && !document.activeElement?.closest?.("[data-hero]")) setIndex((i) => (i + 1) % items.length); }, 8000);
    return () => clearInterval(t);
  }, [items.length]);
  const swipe = useSwipe({ left: () => setIndex((i) => (i + 1) % items.length), right: () => setIndex((i) => (i - 1 + items.length) % items.length) });
  const it = items[index];
  if (!it) return <div className="relative z-10 -mt-[60px] h-[calc(62vh+60px)] min-h-[520px] w-full short:h-dvh short:min-h-0" />;
  const m = meta[it.id] || {};
  const genres = (m.genres || []).slice(0, 2).join(" / ");
  return (
    <>
      {/* the hero's picture, blurred, glowing down the page behind the rows */}
      <div className="pointer-events-none absolute inset-x-0 top-[-60px] z-0 h-[1700px] overflow-hidden" aria-hidden="true">
        {items.map((x, i) => (
          <img key={x.id} src={IMG("w300", x.backdrop)} alt="" decoding="async" className="absolute inset-0 h-full w-full object-cover transition-opacity duration-[1100ms]"
            style={{ opacity: i === index ? 0.78 : 0, filter: "blur(64px) saturate(1.35)", transform: "scale(1.15)" }} />
        ))}
        <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, rgb(var(--page-bg-rgb, 5 11 18) / 0) 0%, rgb(var(--page-bg-rgb, 5 11 18) / 0.12) 25%, rgb(var(--page-bg-rgb, 5 11 18) / 0.5) 55%, rgb(var(--page-bg-rgb, 5 11 18) / 0.85) 80%, rgb(var(--page-bg-rgb, 5 11 18)) 100%)" }} />
      </div>
      <div data-tv-hero {...swipe} className="relative z-10 -mt-[60px] h-[calc(62vh+60px)] min-h-[520px] w-full short:h-dvh short:min-h-0"
        onMouseEnter={() => { paused.current = true; }} onMouseLeave={() => { paused.current = false; }}>
        <div className="absolute inset-0" style={{ maskImage: "linear-gradient(rgb(0, 0, 0) 0%, rgb(0, 0, 0) 45%, rgba(0, 0, 0, 0.6) 72%, transparent 100%)", WebkitMaskImage: "linear-gradient(rgb(0, 0, 0) 0%, rgb(0, 0, 0) 45%, rgba(0, 0, 0, 0.6) 72%, transparent 100%)" }}>
          {items.map((x, i) => (
            <div key={x.id} className={`absolute inset-0 transition-opacity duration-[900ms] ${i === index ? "opacity-100" : "pointer-events-none opacity-0"}`}>
              {Math.abs(i - index) <= 1 || i === 0 ? <img src={IMG("original", x.backdrop)} alt={i === index ? x.title : ""} fetchpriority={i === index ? "high" : "low"} decoding="async" className="h-full w-full object-cover object-[center_20%]" /> : null}
            </div>
          ))}
          <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/15 to-transparent" />
          <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/35 to-transparent" />
        </div>
        <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(55% 42% at 14% 58%, rgba(0, 0, 0, 0.42), transparent 100%)" }} />
        <div key={it.id} data-hero className="absolute bottom-[12%] left-6 w-[90%] max-w-xl animate-hero-in sm:left-[60px] short:left-6">
          <div className="mb-4 flex min-h-[72px] items-end sm:min-h-[110px] short:mb-2 short:min-h-[48px]">
            {m.logo
              ? <img src={m.logo} alt={it.title} decoding="async" className="max-h-[110px] max-w-[78vw] object-contain object-left-bottom drop-shadow-[0_4px_18px_rgba(0,0,0,0.6)] sm:max-h-[150px] sm:max-w-[520px] short:max-h-[72px] short:max-w-[78vw]" />
              : <h1 className="text-4xl font-black tracking-tight text-white drop-shadow-[0_4px_18px_rgba(0,0,0,0.6)] sm:text-6xl">{it.title}</h1>}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm font-semibold text-white/90">
            <Ring rating={it.rating || "0.0"} />
            {it.year ? <><span className="text-white/40">·</span><span>{it.year}</span></> : null}
            {genres ? <><span className="text-white/40">·</span><span>{genres}</span></> : null}
            {m.cert ? <><span className="text-white/40">·</span><span className="rounded-full border border-white/25 bg-white/10 px-2.5 py-0.5 text-[11px] font-bold tracking-wide backdrop-blur-sm">{m.cert}</span></> : null}
          </div>
          <p className="mt-4 line-clamp-3 text-sm text-white/80 drop-shadow sm:text-base short:mt-2 short:line-clamp-2 short:text-xs">{it.overview}</p>
          <div className="mt-6 flex items-center gap-4 short:mt-3">
            <button type="button" onClick={() => nav(`${titleUrl(it)}?play=1`)} className="flex items-center gap-2 rounded-full bg-gradient-to-r from-atlantic-300 to-atlantic-500 px-6 py-3 text-sm font-bold text-abyss-950 shadow-[0_8px_24px_-6px_rgba(30,203,236,0.55)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_30px_-6px_rgba(30,203,236,0.7)] active:translate-y-0"><PlayIcon />Play</button>
            <button type="button" onClick={() => nav(titleUrl(it))} className="flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-6 py-3 text-sm font-bold text-white shadow-lg backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/20 active:translate-y-0"><InfoIcon />More Info</button>
          </div>
        </div>
        <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2">
          {items.map((x, i) => (
            <button key={x.id} type="button" aria-label={`Show ${x.title}`} onClick={() => setIndex(i)}
              className={`h-1.5 rounded-full transition-all duration-300 ${i === index ? "w-6 bg-white" : "w-1.5 bg-white/40 hover:bg-white/70"}`} />
          ))}
        </div>
      </div>
    </>
  );
}

/* ---------- a row that scrolls sideways, with the site's arrow buttons ---------- */
export function Scroller({ className, children }) {
  const ref = useRef(null);
  const [edges, setEdges] = useState({ left: false, right: true });
  const update = () => { const el = ref.current; if (el) setEdges({ left: el.scrollLeft > 8, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 8 }); };
  useEffect(update, [children]);
  const by = (d) => ref.current?.scrollBy({ left: d * ref.current.clientWidth * 0.85, behavior: "smooth" });
  const ARROW = "absolute top-1/2 z-30 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/65 text-white shadow-[0_8px_24px_-6px_rgba(0,0,0,0.8)] backdrop-blur-md transition-all duration-200 hover:scale-110 hover:border-atlantic-400/60 hover:bg-black/85 md:flex md:opacity-0 md:group-hover/row:opacity-100 focus-visible:opacity-100 short:hidden";
  return (
    <div className="group/row relative">
      <div ref={ref} onScroll={update} className={className}>{children}</div>
      {edges.left ? <button type="button" aria-label="Scroll left" onClick={() => by(-1)} className={`${ARROW} left-3`}><ChevronLeft /></button> : null}
      {edges.right ? <button type="button" aria-label="Scroll right" onClick={() => by(1)} className={`${ARROW} right-3`}><ChevronRight /></button> : null}
    </div>
  );
}

/* the TV: a row's View All is the last tile of the row, so Down and Up go row to row
   without stopping on the small links beside the row titles (those are skipped, tv="skip") */
export const tvSkip = () => (isTV() ? { "data-tv-skip": "" } : {});
export function TvEndTile({ to, label = "View All" }) {
  if (!isTV()) return null;
  return (
    <Link to={to} className="flex aspect-video w-[200px] shrink-0 flex-col items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] text-white/70 sm:w-[280px] lg:w-[320px]">
      <ChevronRight /><span className="text-sm font-semibold">{label}</span>
    </Link>
  );
}

/* an image that fades in once it has loaded, as every picture on the site does */
export function Fade({ src, alt, className = "" }) {
  const [on, setOn] = useState(false);
  if (!src) return null;
  return <img src={src} alt={alt} loading="lazy" decoding="async" onLoad={() => setOn(true)} className={`${className} transition-opacity duration-300 ${on ? "opacity-100" : "opacity-0"}`} />;
}

function Top10Row({ row }) {
  const nav = useNavigate();
  return (
    <section className="relative mb-6">
      <div className="mb-2 flex items-center px-6 sm:px-[60px] short:px-6"><h2 className="text-xl font-semibold text-white/90 drop-shadow-md">{row.title}</h2></div>
      <Scroller className="no-scrollbar overflow-x-auto overflow-y-hidden flex gap-7 px-6 py-5 sm:gap-10 sm:px-[60px] short:gap-7 short:px-6">
        {row.items.map((it, i) => (
          <button key={it.id} type="button" data-tv-type={it.type} data-tv-id={it.id} onClick={() => nav(titleUrl(it))} className="group relative z-0 flex shrink-0 snap-start items-end text-left transition-transform duration-200 hover:z-20 hover:-translate-y-1 hover:scale-[1.04]">
            <span className="pointer-events-none -mr-5 select-none text-[112px] font-black leading-[0.8] tracking-tighter text-abyss-950 sm:-mr-7 sm:text-[148px] short:-mr-5 short:text-[112px]"
              style={{ WebkitTextStroke: "3px rgba(255, 255, 255, 0.55)", textShadow: "rgba(0, 0, 0, 0.6) 0px 0px 30px" }}>{i + 1}</span>
            <div className="relative aspect-[2/3] w-[112px] overflow-hidden rounded-lg bg-abyss-800 shadow-lg shadow-black/50 transition-shadow duration-200 group-hover:shadow-2xl group-hover:shadow-black/70 sm:w-[140px] short:w-[112px]">
              <Fade src={IMG("w342", it.poster)} alt={it.title} className="h-full w-full object-cover" />
            </div>
          </button>
        ))}
      </Scroller>
    </section>
  );
}

/* a wide card: the picture, a shade, the title's logo; on hover a play button and the year and score */
/* to, badge and progress are for Continue Watching (History): where Play
   resumes, the "S2 E3" tag, and how far you got as a share */
export function WideCard({ it, to, badge, progress, editing, onRemove }) {
  const [logo, setLogo] = useState(null);
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { io.disconnect(); extras(it).then((m) => setLogo(m.logo || "")).catch(() => setLogo("")); } }, { rootMargin: "300px" });
    io.observe(el); return () => io.disconnect();
  }, [it]);
  return (
    <div ref={ref} className={`group relative z-0 w-[200px] shrink-0 snap-start transition-transform duration-200 hover:z-20 hover:-translate-y-1 hover:scale-[1.06] sm:w-[280px] lg:w-[320px] short:w-[200px] ${editing ? "animate-jiggle" : ""}`}>
      <Link draggable="false" className="block w-full text-left" to={to || titleUrl(it)} data-tv-type={it.type} data-tv-id={it.id}>
        <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-abyss-800 shadow-none transition-shadow duration-200 group-hover:shadow-2xl group-hover:shadow-black/60">
          <Fade src={IMG("w780", it.backdrop || it.poster)} alt={it.title} className="h-full w-full object-cover" />
          {badge ? <div className="pointer-events-none absolute left-2 top-2 flex items-center border-l-[3px] border-atlantic-300 bg-black/60 px-2 py-1 text-xs font-bold text-white backdrop-blur-sm">{badge}</div> : null}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3">
            <div className="flex h-[38%] min-h-[34px] max-h-[64px] min-w-0 max-w-[62%] flex-1 items-end sm:max-h-[72px] short:max-h-[64px]">
              {logo ? <Fade src={logo.replace("/w500/", "/w300/")} alt={it.title} className="max-h-full max-w-full object-contain object-left-bottom drop-shadow-[0_2px_6px_rgba(0,0,0,0.7)]" />
                : logo === "" ? <span className="line-clamp-2 text-sm font-bold text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.7)] sm:text-base">{it.title}</span> : null}
            </div>
            <div className="hidden shrink-0 flex-col items-end gap-1.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100 md:flex">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90"><PlayIcon size={14} fill="#050b12" /></div>
              <div className="flex items-center gap-2 text-xs text-white/70">{it.year ? <span>{it.year}</span> : null}{it.rating ? <span className="text-atlantic-300">★ {it.rating}</span> : null}</div>
            </div>
          </div>
          {progress != null ? <div className="absolute inset-x-0 bottom-0 h-1 bg-black/50"><div className="h-full bg-atlantic-400" style={{ width: `${progress}%` }} /></div> : null}
        </div>
      </Link>
      {editing ? <button type="button" aria-label={`Remove ${it.title}`} onClick={onRemove} className="absolute -left-2 -top-2 z-30 flex h-7 w-7 items-center justify-center rounded-full bg-black text-white shadow-lg ring-2 ring-white/80 transition-opacity hover:bg-red-600 opacity-100"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg></button> : <SaveButton it={it} />}
    </div>
  );
}

/* Continue Watching, as the site shows it on Home: what you started, split
   into rows (Settings → Appearance), with Edit and View All (History) */
function ContinueWatching() {
  const rowCount = useContinueRows();
  const [entries, setEntries] = useState(() => titlesWatched());
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    let live = true;
    Promise.all(entries.map((e) => tmdb(`/${e.type}/${e.id}`).then((d) => ({ e, it: { ...item(d, e.type), year: "" } })).catch(() => null)))
      .then((r) => live && setItems(r.filter(Boolean)));
    return () => { live = false; };
  }, [entries]);
  if (!items.length) return null;
  const rows = Array.from({ length: Math.min(rowCount, items.length) }, (_, r) => items.filter((_, i) => i % Math.min(rowCount, items.length) === r));
  return (
    <section className="relative mb-6">
      <div className="mb-4 flex items-center gap-2 px-6 sm:px-[60px]">
        <h2 className="text-xl font-semibold text-white/90 drop-shadow-md transition-colors duration-300">Continue Watching</h2>
        {editing
          ? <button type="button" className="flex h-7 w-7 items-center justify-center rounded-full transition-colors bg-atlantic-500 text-abyss-950" aria-label="Done editing Continue Watching" {...tvSkip()} onClick={() => setEditing(false)}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round"><path d="M5 12l5 5L20 7" /></svg></button>
          : <button type="button" className="flex h-7 w-7 items-center justify-center rounded-full transition-colors text-white/50 hover:bg-white/10 hover:text-white" aria-label="Edit Continue Watching" {...tvSkip()} onClick={() => setEditing(true)}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg></button>}
        <Link {...tvSkip()} className="ml-auto text-sm font-medium text-white/50 transition-colors hover:text-atlantic-300" to="/history">View All →</Link>
      </div>
      <div className="flex flex-col">
        {rows.map((row, r) => (
          <Scroller key={r} className="no-scrollbar overflow-x-auto overflow-y-hidden flex gap-5 px-6 py-3 sm:px-[60px]">
            {row.map(({ e, it }) => <WideCard key={`${e.type}-${e.id}`} it={it} to={`/title/${e.type}/${e.id}?play=1`} badge={e.season ? `S${e.season} E${e.episode}` : ""} progress={(e.position / e.duration) * 100} editing={editing} onRemove={() => { forgetProgress(e.type, e.id); setEntries(titlesWatched()); }} />)}
            {r === rows.length - 1 ? <TvEndTile to="/history" /> : null}
          </Scroller>
        ))}
      </div>
    </section>
  );
}

/* "Because you watched …": TMDB's recommendations for a title you watched
   (matched with the site, title for title); the title is a menu of your history */
export function BecauseRow({ history, start }) {
  const [pick, setPick] = useState(history[start]);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [name, setName] = useState("");
  useEffect(() => {
    let live = true;
    tmdb(`/${pick.type}/${pick.id}`).then((d) => { if (live) setName(d.title || d.name); }).catch(() => {});
    tmdb(`/${pick.type}/${pick.id}/recommendations`).then((r) => live && setItems((r.results || []).map((x) => item(x, pick.type)))).catch(() => {});
    return () => { live = false; };
  }, [pick]);
  const [labels, setLabels] = useState({});
  useEffect(() => { if (!open) return; Promise.all(history.map((h) => tmdb(`/${h.type}/${h.id}`).then((d) => [`${h.type}:${h.id}`, d.title || d.name]).catch(() => null))).then((r) => setLabels(Object.fromEntries(r.filter(Boolean)))); }, [open, history]);
  if (!items.length) return null;
  return (
    <section className="relative mb-6">
      <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 px-6 sm:px-[60px] short:px-6">
        <h2 className="text-xl font-semibold text-white/90 drop-shadow-md">Because you watched</h2>
        <div className="relative">
          <button type="button" {...tvSkip()} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 text-xl font-semibold text-white underline decoration-white/30 decoration-1 underline-offset-4 transition-colors hover:decoration-atlantic-300">{name}<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`text-white/60 transition-transform duration-200${open ? " rotate-180" : ""}`}><path d="m6 15 6-6 6 6" /></svg></button>
          {open ? (
            <div role="listbox" className="absolute left-0 top-full z-30 mt-3 max-h-80 w-72 animate-menu-in overflow-y-auto rounded-2xl border border-white/10 bg-abyss-900/95 p-1.5 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.85)] backdrop-blur-xl">
              {history.map((h) => { const on = h.type === pick.type && h.id === pick.id; return (
                <button key={`${h.type}-${h.id}`} type="button" role="option" aria-selected={on} onClick={() => { setPick(h); setOpen(false); }} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${on ? "bg-white/15 font-semibold text-white" : "text-white/75 hover:bg-white/10 hover:text-white"}`}><span className="flex-1 truncate">{labels[`${h.type}:${h.id}`] || ""}</span><span className="shrink-0 text-xs font-semibold text-white/40">{h.type === "tv" ? "Show" : "Movie"}</span></button>
              ); })}
            </div>
          ) : null}
        </div>
      </div>
      <Scroller className="no-scrollbar overflow-x-auto overflow-y-hidden flex gap-5 px-6 py-6 sm:px-[60px] short:px-6">
        {items.map((it) => <WideCard key={`${it.type}-${it.id}`} it={it} />)}
      </Scroller>
    </section>
  );
}

export function WideRow({ title, all, items, head }) {
  return (
    <section className="relative mb-6">
      <div className="mb-4 flex items-center justify-between px-6 sm:px-[60px] short:px-6">
        {head || <h2 className="text-xl font-semibold text-white/90 drop-shadow-md transition-colors duration-300">{title}</h2>}
        {all ? <Link {...tvSkip()} className="text-sm font-medium text-white/50 transition-colors hover:text-atlantic-300" to={all}>View All →</Link> : null}
      </div>
      <Scroller className="no-scrollbar overflow-x-auto overflow-y-hidden flex gap-5 px-6 py-6 sm:px-[60px] short:px-6">
        {items.length ? items.map((it) => <WideCard key={`${it.type}-${it.id}`} it={it} />)
          : Array.from({ length: 5 }, (_, i) => <div key={i} className="aspect-video w-[200px] shrink-0 rounded-lg bg-abyss-800 sm:w-[280px] lg:w-[320px]" />)}
        {all && items.length ? <TvEndTile to={all} /> : null}
      </Scroller>
    </section>
  );
}

/* "Popular on Netflix": a service picker and a Movies / Shows switch */
function ProviderRow() {
  const [provider, setProvider] = useState(PROVIDERS[0]);
  const [type, setType] = useState("movie");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [logos, setLogos] = useState({});
  useEffect(() => { providerLogos().then(setLogos).catch(() => {}); }, []);
  useEffect(() => { setItems([]); providerRow(provider.id, type).then(setItems).catch(() => {}); }, [provider, type]);
  const pill = (t, label) => (
    <button type="button" onClick={() => setType(t)} className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${type === t ? "bg-white text-abyss-950" : "text-white/60 hover:text-white"}`}>{label}</button>
  );
  const head = (
    <div className="flex items-center gap-3">
      <h2 className="text-xl font-semibold text-white/90 drop-shadow-md">Popular on</h2>
      <div className="relative">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] py-1.5 pl-1.5 pr-4 text-sm font-semibold text-white transition-colors hover:border-white/25 hover:bg-white/[0.12]">{logos[provider.id] ? <img src={logos[provider.id]} alt="" className="h-6 w-6 rounded-full object-cover" /> : null}{provider.name}<Chevron className="" size={14} /></button>
        {open ? (
          <div className="absolute left-0 top-full z-40 mt-2 min-w-[180px] overflow-hidden rounded-xl border border-white/10 bg-pagebg/95 p-1 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.6)] backdrop-blur-md">
            {PROVIDERS.map((p) => <button key={p.id} type="button" onClick={() => { setProvider(p); setOpen(false); }} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-white/10 ${p.id === provider.id ? "text-atlantic-300" : "text-white/80"}`}>{logos[p.id] ? <img src={logos[p.id]} alt="" className="h-6 w-6 rounded-full object-cover" /> : null}{p.name}</button>)}
          </div>
        ) : null}
      </div>
      <div className="flex items-center rounded-full border border-white/10 bg-white/[0.04] p-0.5">{pill("movie", "Movies")}{pill("tv", "Shows")}</div>
    </div>
  );
  return <WideRow head={head} items={items} />;
}

export default function Home() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { homeRows().then(setData).catch((e) => setError(e.message)); }, []);
  useEffect(() => { document.title = "Aurora — Watch Movies and TV Shows"; }, []);
  return (
    <div className="transition-opacity duration-150 opacity-100" data-tv-stage>
      <div className="relative">
        <Hero items={data?.hero || []} />
        <div className="relative z-10 mt-4">
          {error ? <p className="px-6 text-white/60 sm:px-[60px]">Could not reach TMDB: {error}</p> : null}
          <ContinueWatching />
          <ListRows />
          {(data?.rows || []).map((row, i, all) => [
            row.kind === "top10" ? <Top10Row key={row.id} row={row} />
            : row.kind === "provider" ? <ProviderRow key={row.id} />
            : <WideRow key={row.id} title={row.title} all={row.all} items={row.items} />,
            // after the Top 10s: For You, "Because you watched" your two latest titles, and Top picks (ForYou.jsx)
            row.kind === "top10" && all[i + 1]?.kind !== "top10" ? <ForYouBlock key="for-you" /> : null,
          ])}
        </div>
      </div>
    </div>
  );
}
