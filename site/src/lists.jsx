import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { IMG } from "./tmdb.js";
import { Scroller } from "./Home.jsx";

/* Your lists, as atlantic.bz keeps them (seen in a fresh browser on the site):
   named lists of titles in this browser; the bookmark on a poster opens "Save
   to list" (tick lists, or make a new one with the title in it); the title
   page's + opens "Add to List" (rename, delete, + Create New List); the lists
   are rows at the top of Home with Edit and View All, and each has its page
   at /list/<id>. The markup and classes are the site's. */

const KEY = "aurora-site-lists";
const listeners = new Set();
let cache = null;
// another device's changes, just synced (cloud.js)
if (typeof window !== "undefined") window.addEventListener("aurora-synced", () => { cache = null; listeners.forEach((fn) => fn()); });
const read = () => { if (cache) return cache; try { cache = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { cache = []; } return cache; };
const write = (lists) => { cache = lists; try { localStorage.setItem(KEY, JSON.stringify(lists)); } catch { /* private mode */ } listeners.forEach((fn) => fn()); };
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const useLists = () => useSyncExternalStore(subscribe, read);

/* a title as a list keeps it: from a card's item, or a title page's details */
export const entry = (it) => ({ id: String(it.id), type: it.type, title: it.title, poster: it.poster ? IMG("w342", it.poster) : "", year: it.year || "" });
const has = (list, e) => list.items.some((x) => x.id === String(e.id) && x.type === e.type);
export const savedIn = (lists, e) => lists.some((l) => has(l, e));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
export function toggle(listId, e) { write(read().map((l) => (l.id !== listId ? l : { ...l, items: has(l, e) ? l.items.filter((x) => !(x.id === e.id && x.type === e.type)) : [...l.items, e] }))); }
export function create(name, e) { write([...read(), { id: uid(), name: name.trim().slice(0, 60), items: e ? [e] : [], createdAt: Date.now() }]); }
export function rename(listId, name) { write(read().map((l) => (l.id === listId ? { ...l, name: name.trim().slice(0, 60) || l.name } : l))); }
export function remove(listId) { write(read().filter((l) => l.id !== listId)); }
export function removeItem(listId, e) { write(read().map((l) => (l.id === listId ? { ...l, items: l.items.filter((x) => !(x.id === e.id && x.type === e.type)) } : l))); }

const Bookmark = ({ filled }) => <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1Z" /></svg>;
const Tick = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>;
const Plus = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>;
const Pencil = ({ size = 14 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>;
const Bin = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6" /><path d="M10 11v6M14 11v6" /></svg>;
const Done = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round"><path d="M5 12l5 5L20 7" /></svg>;
const Cross = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>;
const count = (n) => `${n} title${n === 1 ? "" : "s"}`;

/* "Save to list", by the button that opened it */
function SaveDialog({ anchor, e, onClose }) {
  const lists = useLists();
  const box = useRef(null);
  const [pos, setPos] = useState({ left: 10, top: 10 });
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect(), w = 276, h = Math.min(420, box.current?.offsetHeight || 260);
    const left = Math.max(10, Math.min(window.innerWidth - w - 10, r.right - w));
    const below = r.bottom + 8, top = below + h > window.innerHeight - 10 ? Math.max(10, r.top - h - 8) : below;
    setPos({ left, top });
  }, [anchor, adding, lists.length]);
  useEffect(() => {
    const away = (ev) => { if (!box.current?.contains(ev.target) && !anchor.contains(ev.target)) onClose(); };
    const esc = (ev) => ev.key === "Escape" && onClose();
    const gone = () => onClose();
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc); window.addEventListener("scroll", gone, true);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); window.removeEventListener("scroll", gone, true); };
  }, [anchor, onClose]);
  const add = () => { if (!name.trim()) return; create(name, e); setName(""); setAdding(false); };
  return createPortal(
    <div ref={box} role="dialog" aria-label={`Save ${e.title} to a list`} className="fixed z-[200] flex animate-menu-in flex-col overflow-hidden rounded-2xl border border-white/10 bg-abyss-900/95 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.85)] backdrop-blur-xl" style={{ left: `${pos.left}px`, top: `${pos.top}px`, maxHeight: "420px", width: "276px" }}>
      <div className="flex items-center gap-3 border-b border-white/10 bg-gradient-to-b from-white/[0.06] to-transparent p-3">
        {e.poster ? <img src={e.poster} alt="" className="h-[54px] w-9 shrink-0 rounded-md object-cover shadow-lg shadow-black/50" /> : null}
        <div className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-wider text-atlantic-300">Save to list</p><p className="truncate text-sm font-semibold text-white">{e.title}</p>{e.year ? <p className="text-xs text-white/50">{e.year}</p> : null}</div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {lists.length ? lists.map((l) => {
          const on = has(l, e);
          return (
            <button key={l.id} type="button" role="checkbox" aria-checked={on} onClick={() => toggle(l.id, e)} className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/[0.07]">
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all duration-150 ${on ? "border-transparent bg-gradient-to-br from-atlantic-300 to-atlantic-500 text-abyss-950" : "border-white/25 text-transparent"}`}><Tick /></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-white/90">{l.name}</span><span className="block text-xs text-white/40">{count(l.items.length)}</span></span>
            </button>
          );
        }) : <p className="px-3 py-5 text-center text-sm text-white/45">No lists yet. Make your first one below.</p>}
      </div>
      <div className="border-t border-white/10 p-2">
        {adding ? (
          <div className="flex gap-2">
            <input type="text" maxLength={60} placeholder="List name" autoFocus value={name} onChange={(ev) => setName(ev.target.value)} onKeyDown={(ev) => { if (ev.key === "Enter") add(); if (ev.key === "Escape") { ev.stopPropagation(); setAdding(false); } }} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-atlantic-400/60" />
            <button type="button" disabled={!name.trim()} onClick={add} className="rounded-lg bg-atlantic-500 px-3.5 text-sm font-bold text-abyss-950 transition-colors hover:bg-atlantic-400 disabled:opacity-40">Add</button>
          </div>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-semibold text-atlantic-300 transition-colors hover:bg-white/[0.07]"><span className="flex h-5 w-5 items-center justify-center rounded-md border border-atlantic-300/40"><Plus /></span>New list</button>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* the bookmark on a poster or a wide card */
export function SaveButton({ it }) {
  const lists = useLists();
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const e = entry(it), saved = savedIn(lists, e);
  return (
    <>
      <button ref={ref} type="button" aria-label={saved ? `Edit lists for ${it.title}` : `Save ${it.title} to a list`} aria-haspopup="dialog" aria-expanded={open} onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); setOpen((v) => !v); }}
        className={`absolute right-2 top-2 z-20 flex h-8 w-8 items-center justify-center rounded-full border backdrop-blur-md transition-all duration-200 hover:scale-110 focus-visible:opacity-100 active:scale-95 opacity-100 ${saved ? "border-transparent bg-gradient-to-br from-atlantic-300 to-atlantic-500 text-abyss-950 shadow-[0_6px_16px_-4px_rgba(30,203,236,0.7)] " : "md:opacity-0 md:group-hover:opacity-100 border-white/20 bg-black/55 text-white hover:border-white/40 hover:bg-black/75 "}`}>
        <Bookmark filled={saved} />
      </button>
      {open ? <SaveDialog anchor={ref.current} e={e} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/* the title page's +: "Add to List" under the button */
export function AddToList({ e, className }) {
  const lists = useLists();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [name, setName] = useState("");
  const box = useRef(null);
  const saved = savedIn(lists, e);
  useEffect(() => {
    if (!open) return undefined;
    const away = (ev) => { if (!box.current?.contains(ev.target)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  const make = () => { if (!name.trim()) return; create(name, e); setName(""); setCreating(false); };
  const done = (id) => { rename(id, name); setEditing(null); setName(""); };
  return (
    <div ref={box} className="relative">
      <button type="button" aria-label="Add to List" onClick={() => setOpen((v) => !v)} className={saved ? "flex h-10 w-10 items-center justify-center rounded-full border transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 border-transparent bg-gradient-to-r from-atlantic-300 to-atlantic-500 text-abyss-950 shadow-[0_6px_18px_-6px_rgba(30,203,236,0.6)]" : className}>
        {saved ? <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>
          : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>}
      </button>
      {open ? (
        <div className="absolute left-0 top-12 z-30 w-72 rounded-lg border border-white/10 bg-abyss-900/95 p-3 shadow-2xl backdrop-blur-sm">
          <p className="mb-2 text-sm font-semibold text-white">Add to List</p>
          <div className="mb-3 max-h-56 space-y-1 overflow-y-auto">
            {lists.map((l) => editing === l.id ? (
              <div key={l.id} className="flex gap-2">
                <input type="text" maxLength={60} autoFocus value={name} onChange={(ev) => setName(ev.target.value)} onKeyDown={(ev) => { if (ev.key === "Enter") done(l.id); if (ev.key === "Escape") setEditing(null); }} className="min-w-0 flex-1 rounded border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white outline-none focus:border-atlantic-400/60" />
                <button type="button" onClick={() => done(l.id)} className="rounded bg-atlantic-500 px-3 text-sm font-bold text-abyss-950 hover:bg-atlantic-400">Save</button>
              </div>
            ) : (
              <div key={l.id} className="group flex items-center gap-1">
                <button type="button" onClick={() => toggle(l.id, e)} className="flex min-w-0 flex-1 items-center justify-between rounded px-2 py-1.5 text-left text-sm text-white/80 hover:bg-white/10"><span className="truncate">{l.name}</span>{has(l, e) ? <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="ml-2 shrink-0 text-atlantic-300"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg> : null}</button>
                <button type="button" aria-label="Rename list" onClick={() => { setEditing(l.id); setName(l.name); setConfirm(null); }} className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-white/40 opacity-0 transition-opacity hover:bg-white/10 hover:text-white group-hover:opacity-100"><Pencil /></button>
                <button type="button" aria-label="Delete list" onClick={() => (confirm === l.id ? (remove(l.id), setConfirm(null)) : setConfirm(l.id))} className={`flex h-7 shrink-0 items-center justify-center rounded px-1.5 transition-all duration-200 ${confirm === l.id ? "gap-1 bg-red-500/20 text-xs font-semibold text-red-400" : "w-7 text-white/40 opacity-0 hover:bg-red-500/20 hover:text-red-400 group-hover:opacity-100"}`}><Bin />{confirm === l.id ? "Delete?" : null}</button>
              </div>
            ))}
          </div>
          {creating ? (
            <div className="flex gap-2">
              <input type="text" maxLength={60} placeholder="List name" autoFocus value={name} onChange={(ev) => setName(ev.target.value)} onKeyDown={(ev) => { if (ev.key === "Enter") make(); if (ev.key === "Escape") setCreating(false); }} className="min-w-0 flex-1 rounded border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-atlantic-400/60" />
              <button type="button" disabled={!name.trim()} onClick={make} className="rounded bg-atlantic-500 px-3 text-sm font-bold text-abyss-950 hover:bg-atlantic-400 disabled:opacity-40">Add</button>
            </div>
          ) : <button type="button" onClick={() => { setCreating(true); setEditing(null); setName(""); }} className="w-full rounded px-2 py-1.5 text-left text-sm font-medium text-atlantic-300 hover:bg-white/10">+ Create New List</button>}
        </div>
      ) : null}
    </div>
  );
}

/* a title in a list: poster, name and year on hover; × while editing */
function ListCard({ x, editing, onRemove, row }) {
  return (
    <div className={row ? "w-[140px] shrink-0 snap-start sm:w-[160px]" : "w-[140px] sm:w-[160px]"}>
      <div className={`group relative z-0 text-left transition-transform duration-200 hover:z-20 hover:-translate-y-1 hover:scale-[1.05] ${editing ? "animate-jiggle" : ""}`}>
        <Link draggable="false" className="block w-full text-left" to={`/title/${x.type}/${x.id}`}>
          <div className="aspect-[2/3] w-full overflow-hidden rounded-lg bg-abyss-800 shadow-none transition-shadow duration-200 group-hover:shadow-2xl group-hover:shadow-black/60">
            {x.poster ? <img src={x.poster} alt={x.title} loading="lazy" decoding="async" className="h-full w-full object-cover transition-opacity duration-300 opacity-100" /> : null}
            <div className="pointer-events-none absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/90 via-black/10 to-transparent p-3 opacity-100 transition-opacity duration-200 md:opacity-0 md:group-hover:opacity-100">
              <p className="truncate text-sm font-semibold text-white">{x.title}</p>{x.year ? <span className="text-xs text-white/60">{x.year}</span> : null}
            </div>
          </div>
        </Link>
        {editing ? <button type="button" aria-label={`Remove ${x.title}`} onClick={onRemove} className="absolute -left-2 -top-2 z-30 flex h-7 w-7 items-center justify-center rounded-full bg-black text-white shadow-lg ring-2 ring-white/80 transition-opacity hover:bg-red-600 opacity-100"><Cross /></button> : null}
      </div>
    </div>
  );
}

/* Home: each list as a row, above Top 10 */
export function ListRows() {
  const lists = useLists();
  const [editing, setEditing] = useState(null);
  return lists.filter((l) => l.items.length).map((l) => (
    <section key={l.id} className="relative mb-6">
      <div className="mb-4 flex items-center gap-2 px-6 sm:px-[60px]">
        <h2 className="text-xl font-semibold text-white/90 drop-shadow-md transition-colors duration-300">{l.name}</h2>
        {editing === l.id
          ? <button type="button" className="flex h-7 w-7 items-center justify-center rounded-full transition-colors bg-atlantic-500 text-abyss-950" aria-label={`Done editing ${l.name}`} onClick={() => setEditing(null)}><Done /></button>
          : <button type="button" className="flex h-7 w-7 items-center justify-center rounded-full transition-colors text-white/50 hover:bg-white/10 hover:text-white" aria-label={`Edit ${l.name}`} onClick={() => setEditing(l.id)}><Pencil size={13} /></button>}
        <Link className="ml-auto text-sm font-medium text-white/50 transition-colors hover:text-atlantic-300" to={`/list/${l.id}`}>View All →</Link>
      </div>
      <Scroller className="no-scrollbar overflow-x-auto overflow-y-hidden flex gap-5 px-6 py-6 sm:px-[60px]">
        {l.items.map((x) => <ListCard key={`${x.type}-${x.id}`} x={x} row editing={editing === l.id} onRemove={() => removeItem(l.id, x)} />)}
      </Scroller>
    </section>
  ));
}

/* /list/<id> */
export function ListPage({ id }) {
  const lists = useLists();
  const l = lists.find((x) => x.id === id);
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (l) document.title = `${l.name} — Aurora`; }, [l]);
  if (!l) return null;
  return (
    <div className="transition-opacity duration-150 opacity-100">
      <div className="px-6 pb-20 pt-32 sm:px-[60px]">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-3"><h1 className="text-3xl font-bold text-white">{l.name}</h1><span className="text-sm text-white/45">{count(l.items.length)}</span></div>
          <button type="button" onClick={() => setEditing((v) => !v)} className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${editing ? "bg-atlantic-500 text-abyss-950" : "border border-white/15 bg-white/10 text-white hover:bg-white/15"}`}>{editing ? "Done" : "Edit"}</button>
        </div>
        <div className="flex flex-wrap gap-5">{l.items.map((x) => <ListCard key={`${x.type}-${x.id}`} x={x} editing={editing} onRemove={() => removeItem(l.id, x)} />)}</div>
      </div>
    </div>
  );
}
/* Settings → Account → Clear All Lists */
export function clearAll() { write([]); }
/* adds entries to the list of that name, making it if need be (Trakt's and Simkl's watchlists) */
export function addTo(name, entries) {
  let lists = read();
  if (!lists.some((l) => l.name === name)) lists = [...lists, { id: uid(), name, items: [], createdAt: Date.now() }];
  write(lists.map((l) => (l.name !== name ? l : { ...l, items: [...l.items, ...entries.filter((e) => !has(l, e))] })));
}
