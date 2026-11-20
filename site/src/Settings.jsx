import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getLine, lineLabel, clearHistory } from "./line.js";
import { useAccount, signOut, displayName, setDisplayName, handle, username } from "./account.js";
import { clearAll } from "./lists.jsx";
import { useTracker } from "./trackers.js";
import AuthForm from "./AuthForm.jsx";
import { ORDER, SIDE, LABELS, ICON, fullOrder } from "./playerButtons.jsx";
import { THEMES, useTheme, setTheme, useAlwaysTitles, setAlwaysTitles, useContinueRows, setContinueRows, useParticles, setParticles } from "./themes.jsx";
import { loadPrefs, savePrefs, FONTS } from "./subs.js";

/* atlantic.bz's Settings: the gear and title, a row of tabs, the section in a
   card — each tab in the site's markup. Account is the site's: the Log In /
   Sign Up form, or, signed in, your name, sign-in methods, display name,
   Log Out and the Danger Zone; then the Connect cards — your source (in
   Febbox's place: Aurora plays from your own line or playlist), Trakt and
   Simkl. Passkeys are left out (the account server has none). */

const TAB = "flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2.5 text-sm transition-colors";
const TAB_ON = "border-atlantic-400 font-semibold text-white";
const TAB_OFF = "border-transparent font-normal text-white/50 hover:text-white";
const ic = (children) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
const TABS = [
  ["account", "Account", ic(<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>)],
  ["appearance", "Appearance", ic(<><circle cx="13.5" cy="6.5" r=".5" /><circle cx="17.5" cy="10.5" r=".5" /><circle cx="8.5" cy="7.5" r=".5" /><circle cx="6.5" cy="12.5" r=".5" /><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" /></>)],
  ["playback", "Playback", ic(<><circle cx="12" cy="12" r="10" /><path d="m10 8 6 4-6 4Z" /></>)],
  ["subtitles", "Subtitles", ic(<><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M7 13h3M13 13h4M7 9h4" /></>)],
  ["experimental", "Experimental", ic(<><path d="M10 2v7.31" /><path d="M14 9.3V1.99" /><path d="M8.5 2h7" /><path d="M14 9.3a6.5 6.5 0 1 1-4 0" /><path d="M5.52 16h12.96" /></>)],
  ["about", "About", ic(<><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></>)],
];

/* atlantic.bz's two-click button: the first click asks, the second does it */
function ConfirmButton({ label, confirmLabel, onConfirm }) {
  const [asking, setAsking] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const click = () => {
    if (asking) { clearTimeout(timer.current); setAsking(false); onConfirm(); return; }
    setAsking(true); timer.current = setTimeout(() => setAsking(false), 4000);
  };
  return <button type="button" onClick={click} className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${asking ? "border-red-500/60 bg-red-500/20 text-red-300" : "border-white/10 text-white/70 hover:border-red-500/40 hover:text-red-300"}`}>{asking ? confirmLabel : label}</button>;
}

/* signed in: atlantic.bz's account card, sign-in methods, display name, Log Out and Danger Zone */
function SignedIn() {
  const [name, setName] = useState(displayName());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const changed = name.trim() && name.trim() !== displayName();
  const save = async () => { setSaving(true); setError(null); try { await setDisplayName(name); } catch (e) { setError(e.message); } finally { setSaving(false); } };
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-white/10 bg-black/20 p-4"><p className="text-sm text-white/40">Signed in as</p><p className="text-lg font-semibold text-white">{handle()}</p></div>
      <div className="rounded-lg border border-white/10 bg-black/20 p-4">
        <p className="mb-3 text-sm font-semibold text-white/90">Sign-in methods</p>
        <div className="space-y-2 text-sm text-white/60">
          <div className="flex items-center justify-between gap-3"><span>{username() ? `Username and password (@${username()})` : "Email and password"}</span><span className="text-atlantic-300">On</span></div>
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-white/50">Display Name</label>
        <div className="flex gap-2">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={255} className="w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-atlantic-400/50" />
          <button type="button" onClick={save} disabled={!changed || saving} className="shrink-0 rounded-lg bg-atlantic-500 px-4 py-2 text-sm font-bold text-abyss-950 transition-colors hover:bg-atlantic-400 disabled:opacity-40">{saving ? "Saving..." : "Save"}</button>
        </div>
        {error ? <p className="mt-1 text-sm text-red-400">{error}</p> : null}
      </div>
      <button type="button" onClick={() => signOut()} className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-white/70 transition-colors hover:border-white/20 hover:text-white">Log Out</button>
      <div className="border-t border-white/10 pt-4">
        <p className="mb-3 text-sm font-semibold text-white/90">Danger Zone</p>
        <div className="flex flex-wrap gap-3">
          <ConfirmButton label="Clear Watch History" confirmLabel="Confirm Clear?" onConfirm={clearHistory} />
          <ConfirmButton label="Clear All Lists" confirmLabel="Confirm Clear?" onConfirm={clearAll} />
        </div>
      </div>
    </div>
  );
}

/* a "Connect" card, as atlantic.bz's Febbox, Trakt and Simkl cards are drawn */
const ConnectCard = ({ first, title, line, button, onClick, children }) => (
  <div className={`${first ? "mt-8" : "mt-4"} rounded-lg border border-white/10 bg-black/20 p-4`}>
    <div className="flex items-center justify-between gap-3">
      <div><p className="text-sm font-semibold text-white">{title}</p><p className="text-xs text-white/40">{line}</p></div>
      {button ? <button type="button" onClick={onClick} className="shrink-0 rounded-lg bg-atlantic-500 px-4 py-2 text-sm font-bold text-abyss-950 transition-colors hover:bg-atlantic-400">{button}</button> : null}
    </div>
    {children}
  </div>
);

/* Trakt and Simkl: sign in on their site, then your watchlist and history sync (trackers.js) */
function TrackerCard({ id, title, line }) {
  const t = useTracker(id);
  if (!t.configured) return <ConnectCard title={title} line={line} button="Connect" onClick={() => t.connect()}>{t.note ? <p className="mt-3 text-xs text-amber-200/80">{t.note}</p> : null}</ConnectCard>;
  if (!t.connected) return <ConnectCard title={title} line={line} button="Connect" onClick={() => t.connect()}>{t.note ? <p className="mt-3 text-xs text-white/60">{t.note}</p> : null}</ConnectCard>;
  return (
    <ConnectCard title={title} line={t.user ? `Connected as ${t.user}. ${t.status || "Syncing in the background."}` : t.status || "Connected."}>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={t.busy} onClick={() => t.sync()} className="rounded-md border border-white/10 px-3 py-1 text-xs font-medium text-white/70 hover:border-atlantic-400/40 hover:text-white disabled:opacity-50">{t.busy ? "Syncing..." : "Sync now"}</button>
        <button type="button" onClick={() => t.disconnect()} className="rounded-md border border-white/10 px-3 py-1 text-xs font-medium text-white/70 hover:border-red-500/40 hover:text-red-300">Disconnect</button>
      </div>
    </ConnectCard>
  );
}

const Head = ({ title, line }) => <><h2 className="mb-1 text-xl font-semibold text-white/90 drop-shadow-md transition-colors duration-300">{title}</h2><p className="mb-4 text-sm text-white/40">{line}</p></>;
const Row = ({ title, line, wide, children }) => (
  <div className="flex flex-col gap-3 border-b border-white/10 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
    <div className={wide ? "sm:max-w-md" : undefined}><p className="text-sm font-medium text-white">{title}</p>{line ? <p className="mt-0.5 text-xs text-white/40">{line}</p> : null}</div>
    <div className="sm:w-64">{children}</div>
  </div>
);
const Toggle = ({ on, onChange }) => (
  <div className="flex justify-end sm:justify-end"><button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-atlantic-400" : "bg-white/15"}`}><span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${on ? "translate-x-[20px]" : "translate-x-0"}`} /></button></div>
);
function usePrefs() {
  const [prefs, set] = useState(loadPrefs);
  const setPref = (k, v) => set((p) => { const n = { ...p, [k]: v }; savePrefs(n); return n; });
  return [prefs, setPref];
}

function Account() {
  const { user } = useAccount();
  const nav = useNavigate();
  const line = getLine();
  return (
    <div>
      {user ? <Head title="Account" line="Manage your account and synced data." /> : <Head title="Account" line="Sign in to sync your settings and watch progress across devices." />}
      {user ? <SignedIn /> : <AuthForm />}
      <ConnectCard first title="Your source" line={line ? lineLabel(line) : "Connect an Xtream Codes login or an M3U playlist, or play a single link or your own files."} button={line ? "Change" : "Connect"} onClick={() => nav("/sources")} />
      <TrackerCard id="trakt" title="Trakt" line="Sync your watchlist, lists and continue watching." />
      <TrackerCard id="simkl" title="Simkl" line="Sync your watchlist, watch history and continue watching." />
    </div>
  );
}

function Appearance() {
  const current = useTheme();
  const always = useAlwaysTitles();
  const rows = useContinueRows();
  const moving = useParticles();
  return (
    <div>
      <Head title="Appearance" line="Pick an ambient theme for the site's background and accent color." />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {THEMES.map((t) => <button key={t.id} type="button" onClick={() => setTheme(t.id)} className={`${t.tile.base} ${current === t.id ? "border-atlantic-400" : "border-white/10 hover:border-white/30"}`} style={t.tile.style ? Object.fromEntries(t.tile.style.split(";").filter(Boolean).map((d) => { const i = d.indexOf(":"); return [d.slice(0, i).trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase()), d.slice(i + 1).trim()]; })) : undefined} dangerouslySetInnerHTML={{ __html: t.tile.inner }} />)}
      </div>
      <div className="mt-6 flex flex-col gap-3 border-t border-white/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-sm font-medium text-white">Continue Watching Rows</p><p className="mt-0.5 text-xs text-white/40">How many rows the Continue Watching section splits into on Home.</p></div>
        <div className="flex gap-1.5">{[1, 2, 3, 4].map((n) => <button key={n} type="button" onClick={() => setContinueRows(n)} className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${rows === n ? "border-atlantic-400/50 bg-atlantic-400/15 text-atlantic-300" : "border-white/10 text-white/60 hover:border-white/20 hover:text-white"}`}>{n}</button>)}</div>
      </div>
      <div className="mt-4 flex flex-col gap-3 border-t border-white/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-sm font-medium text-white">Always Show Titles</p><p className="mt-0.5 text-xs text-white/40">Show each card's title and rating without hovering.</p></div>
        <button type="button" role="switch" aria-checked={always} onClick={() => setAlwaysTitles(!always)} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${always ? "bg-atlantic-400" : "bg-white/15"}`}><span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${always ? "translate-x-[20px]" : "translate-x-0"}`} /></button>
      </div>
      <div className="mt-4 flex flex-col gap-3 border-t border-white/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-sm font-medium text-white">Background Particles</p><p className="mt-0.5 text-xs text-white/40">Turn off drifting particles (stars, petals, embers, leaves) for a calmer, static background.</p></div>
        <button type="button" role="switch" aria-checked={moving} onClick={() => setParticles(!moving)} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${moving ? "bg-atlantic-400" : "bg-white/15"}`}><span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${moving ? "translate-x-[20px]" : "translate-x-0"}`} /></button>
      </div>
    </div>
  );
}

const SEGMENTS = [["intro", "Intro"], ["recap", "Recap"], ["credits", "Credits"], ["preview", "Preview"]];
const PILL = (on) => `rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${on ? "border-atlantic-400/50 bg-atlantic-400/15 text-atlantic-300" : "border-white/10 text-white/60 hover:border-white/20 hover:text-white"}`;
const ResetIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>;

/* Your Player: atlantic.bz's preview of the control bar; drag a button to
   move it, or down into the box below to hide it */
function YourPlayer({ prefs, setPref }) {
  const [dragging, setDragging] = useState(null);
  const [over, setOver] = useState(null);
  const [overHidden, setOverHidden] = useState(false);
  const order = fullOrder(prefs.buttonOrder), hidden = prefs.hiddenButtons || [];
  const shown = order.filter((b) => !hidden.includes(b)), off = order.filter((b) => hidden.includes(b));
  const left = shown.filter((b) => SIDE[b] === "left"), right = shown.filter((b) => SIDE[b] === "right");
  const done = () => { setDragging(null); setOver(null); setOverHidden(false); };
  const unhide = (b) => setPref("hiddenButtons", hidden.filter((x) => x !== b));
  const move = (from, to) => { if (from === to) return; const next = [...order]; next.splice(next.indexOf(from), 1); next.splice(next.indexOf(to), 0, from); setPref("buttonOrder", next); };
  const dropOn = (b) => { if (!dragging) return; if (hidden.includes(dragging)) unhide(dragging); move(dragging, b); done(); };
  const dropBar = () => { if (dragging && hidden.includes(dragging)) unhide(dragging); done(); };
  const dropHidden = () => { if (dragging && !hidden.includes(dragging)) setPref("hiddenButtons", [...hidden, dragging]); done(); };
  const btn = (b) => (
    <button key={b} type="button" draggable onDragStart={() => setDragging(b)} onDragEnter={() => setOver(b)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.stopPropagation(); dropOn(b); }} onDragEnd={done} aria-label={LABELS[b]}
      className={`inline-flex h-9 w-9 cursor-grab items-center justify-center rounded-md text-white/90 transition-colors active:cursor-grabbing ${over === b && dragging !== b ? "bg-atlantic-400/20 ring-1 ring-atlantic-400/50" : "hover:bg-white/10"} ${dragging === b ? "opacity-40" : ""}`}>{ICON[b]}</button>
  );
  return (
    <div className="pt-4">
      <div className="mb-3 flex items-center justify-between">
        <div><p className="text-sm font-medium text-white">Your Player</p><p className="mt-0.5 text-xs text-white/40">Drag buttons to reorder them, or drag one down to hide it.</p></div>
        <button type="button" onClick={() => { setPref("buttonOrder", [...ORDER]); setPref("hiddenButtons", []); }} className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-white/60 transition-colors hover:border-white/20 hover:text-white"><ResetIcon />Reset</button>
      </div>
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-abyss-800 bg-cover bg-center" style={{ backgroundImage: 'linear-gradient(180deg, rgba(5,11,18,0.35), rgba(5,11,18,0.15) 40%, rgba(5,11,18,0.85)), url("https://image.tmdb.org/t/p/w780/qNBAXBIQlnOThrVvA6mA2B5ggV6.jpg")' }}>
        <div className="absolute inset-x-0 top-0 flex items-center gap-2 p-3 text-white/80"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg><span className="text-sm">Sample Title</span></div>
        <div className="absolute inset-x-0 bottom-0 p-3">
          <div className="mb-2 h-1 rounded-full bg-white/25"><div className="h-full w-2/5 rounded-full bg-atlantic-400" /></div>
          <div onDragOver={(e) => e.preventDefault()} onDrop={dropBar} className="flex min-h-[36px] items-center gap-1 rounded-md">
            {left.map(btn)}
            {left.length > 0 ? <span className="px-2 text-sm text-white/80">0:00 / 0:00</span> : null}
            <div className="flex-1" />
            {right.map(btn)}
            {shown.length === 0 ? <span className="text-xs text-white/40">Drag actions here to add them to the player</span> : null}
          </div>
        </div>
      </div>
      <div className="mt-3">
        <div onDragOver={(e) => { e.preventDefault(); setOverHidden(true); }} onDragLeave={() => setOverHidden(false)} onDrop={dropHidden} className={`flex min-h-[52px] flex-wrap items-center gap-2 rounded-lg border border-dashed p-3 transition-colors ${overHidden ? "border-atlantic-400/50 bg-atlantic-400/5" : "border-white/10"}`}>
          {off.length === 0 ? <span className="text-xs text-white/30">Nothing hidden</span> : null}
          {off.map((b) => <div key={b} draggable onDragStart={() => setDragging(b)} onDragEnd={done} className={`flex cursor-grab items-center gap-2 rounded-full border border-white/10 bg-black/30 py-1.5 pl-3 pr-4 text-sm text-white/70 transition-colors hover:border-white/20 hover:text-white active:cursor-grabbing ${dragging === b ? "opacity-40" : ""}`}><span className="inline-flex h-5 w-5 items-center justify-center text-white/50">{ICON[b]}</span>{LABELS[b]}</div>)}
        </div>
      </div>
    </div>
  );
}

function Playback() {
  const [prefs, setPref] = usePrefs();
  const types = prefs.autoSkipTypes || [];
  return (
    <div>
      <Head title="Playback" line="Control how videos play by default." />
      <Row title="Auto Next Episode" line="Automatically play the next episode when one ends."><Toggle on={prefs.autoplayNext} onChange={(v) => setPref("autoplayNext", v)} /></Row>
      <Row title="Auto-Enable Subtitles" line="Turn on the first available subtitle track automatically."><Toggle on={prefs.autoSubs} onChange={(v) => setPref("autoSubs", v)} /></Row>
      <Row title="Auto Skip Segments" line="Skip intros, recaps, credits and previews automatically."><Toggle on={prefs.autoSkip} onChange={(v) => setPref("autoSkip", v)} /></Row>
      {prefs.autoSkip ? (
        <Row title="Segments To Skip" line="Credits jump to the next episode.">
          <div className="flex flex-wrap justify-end gap-1.5 sm:justify-end">{SEGMENTS.map(([k, label]) => <button key={k} type="button" onClick={() => setPref("autoSkipTypes", types.includes(k) ? types.filter((x) => x !== k) : [...types, k])} className={PILL(types.includes(k))}>{label}</button>)}</div>
        </Row>
      ) : null}
      <Row title="Seek Amount" line={`${prefs.seek}s per skip`}>
        <div className="flex justify-end gap-1.5 sm:justify-end">{[5, 10, 15, 30].map((n) => <button key={n} type="button" onClick={() => setPref("seek", n)} className={PILL(prefs.seek === n)}>{n}s</button>)}</div>
      </Row>
      <Row title="Double tap to seek" line={`Double tap the left or right side of the video to skip ${prefs.seek}s back or forward. The middle still goes fullscreen.`}><Toggle on={prefs.doubleTap} onChange={(v) => setPref("doubleTap", v)} /></Row>
      <YourPlayer prefs={prefs} setPref={setPref} />
    </div>
  );
}

function Subtitles() {
  const [prefs, setPref] = usePrefs();
  return (
    <div>
      <Head title="Subtitles" line="Customize how subtitles look during playback." />
      <div className="mb-6 flex h-24 items-center justify-center overflow-hidden rounded-lg bg-abyss-800 bg-cover bg-center" style={{ backgroundImage: 'linear-gradient(135deg, rgba(20, 30, 45, 0.25), rgba(10, 15, 25, 0.25)), url("https://image.tmdb.org/t/p/w780/qNBAXBIQlnOThrVvA6mA2B5ggV6.jpg")' }}>
        <p className="rounded px-3 py-1 text-center" style={{ fontFamily: FONTS[prefs.font], fontSize: `${prefs.size}px`, color: prefs.textColor, backgroundColor: `rgba(0, 0, 0, ${prefs.bgOpacity / 100})`, backdropFilter: `blur(${prefs.blur}px)`, textShadow: "rgba(0, 0, 0, 0.5) 0px 2px 4px" }}>Sample subtitle text</p>
      </div>
      <Row title="Font"><select value={prefs.font} onChange={(e) => setPref("font", e.target.value)} className="w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-atlantic-400/50">{Object.keys(FONTS).map((f) => <option key={f} value={f}>{f}</option>)}</select></Row>
      <Row title="Text Size" line={`${prefs.size}px`}><input type="range" min="14" max="40" step="1" className="w-full accent-atlantic-400" value={prefs.size} onChange={(e) => setPref("size", Number(e.target.value))} /></Row>
      <Row title="Text Color"><div className="flex items-center gap-3"><input type="color" className="h-9 w-9 cursor-pointer rounded border border-white/10 bg-transparent p-0" value={prefs.textColor} onChange={(e) => setPref("textColor", e.target.value)} /><span className="font-mono text-xs uppercase text-white/50">{prefs.textColor}</span></div></Row>
      <Row title="Background Opacity" line={`${prefs.bgOpacity}%`}><input type="range" min="0" max="100" step="5" className="w-full accent-atlantic-400" value={prefs.bgOpacity} onChange={(e) => setPref("bgOpacity", Number(e.target.value))} /></Row>
      <Row title="Background Blur" line={`${prefs.blur}px`}><input type="range" min="0" max="20" step="1" className="w-full accent-atlantic-400 disabled:opacity-40" value={prefs.blur} onChange={(e) => setPref("blur", Number(e.target.value))} /></Row>
    </div>
  );
}

function Experimental() {
  return (
    <div>
      <Head title="Experimental" line="Features that are still being tested and may change or break." />
      <Row title="Nothing to test right now" line="New features for Aurora land here first, before they reach everyone." wide><div /></Row>
    </div>
  );
}

function About() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Head title="About" line="Information about Aurora and how it handles your data." />
      <Row title="Privacy policy" line="What we collect, what stays on your device and the choices you have." wide>
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white">{open ? "Hide privacy policy" : "View privacy policy"}</button>
      </Row>
      {open ? (
        <div className="space-y-2 pt-2 text-sm leading-relaxed text-white/60">
          <p>Your IPTV line's login stays in this browser. It is sent only to your provider, through this site's relay, to play what you pick.</p>
          <p>Your progress, watched titles, lists, theme and player settings are kept in this browser too.</p>
          <p>If you sign in, your Aurora account keeps your username and display name. A watch party passes your display name, the title and the play position to the people in it, and nothing else.</p><p>If you connect Trakt or Simkl, what you watch here is sent to them, as you asked.</p>
          <p>Film and series details come from TMDB, anime from AniList, and IMDb scores from OMDb; those services see the titles you look up, not who you are.</p>
        </div>
      ) : null}
    </div>
  );
}

const SECTIONS = { account: Account, appearance: Appearance, playback: Playback, subtitles: Subtitles, experimental: Experimental, about: About };

export default function Settings() {
  const [tab, setTab] = useState("account");
  useEffect(() => { document.title = "Settings — Aurora"; }, []);
  const Section = SECTIONS[tab];
  return (
    <div className="transition-opacity duration-150 opacity-100">
      <div className="mx-auto max-w-4xl px-6 pb-20 pt-32 lg:px-[60px]">
        <div className="mb-6 flex items-center gap-3">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" className="text-white"><path d="M9.25 22l-.4-3.2q-.325-.125-.612-.3q-.288-.175-.563-.375L4.7 19.375l-2.75-4.75l2.575-1.95Q4.5 12.5 4.5 12.337v-.675q0-.162.025-.337L1.95 9.375l2.75-4.75l2.975 1.25q.275-.2.575-.375q.3-.175.6-.3l.4-3.2h5.5l.4 3.2q.325.125.613.3q.287.175.562.375l2.975-1.25l2.75 4.75l-2.575 1.95q.025.175.025.337v.675q0 .163-.05.338l2.575 1.95l-2.75 4.75l-2.95-1.25q-.275.2-.575.375q-.3.175-.6.3l-.4 3.2h-5.5Zm2.8-6.5q1.45 0 2.475-1.025Q15.55 13.45 15.55 12q0-1.45-1.025-2.475Q13.5 8.5 12.05 8.5q-1.475 0-2.488 1.025Q8.55 10.55 8.55 12q0 1.45 1.012 2.475Q10.575 15.5 12.05 15.5Z" /></svg>
          <h1 className="text-3xl font-bold text-white">Settings</h1>
        </div>
        <div className="mb-6 flex items-center gap-0.5 overflow-x-auto border-b border-white/10">
          {TABS.map(([id, label, icon]) => <button key={id} type="button" onClick={() => setTab(id)} className={`${TAB} ${tab === id ? TAB_ON : TAB_OFF}`}>{icon}{label}</button>)}
        </div>
        <section className="rounded-xl border border-white/10 bg-abyss-900/60 p-5"><Section /></section>
      </div>
    </div>
  );
}
