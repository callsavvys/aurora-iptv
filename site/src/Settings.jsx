import { useEffect, useState } from "react";
import { getLine, setLine, clearLine, testLine } from "./line.js";
import { useAccount, signIn, signOut, displayName } from "./account.js";
import { THEMES, useTheme, setTheme, useAlwaysTitles, setAlwaysTitles } from "./themes.jsx";
import { loadPrefs, savePrefs, FONTS } from "./subs.js";

/* atlantic.bz's Settings: the gear and title, a row of tabs, the section in a
   card — each tab in the site's markup. Account signs in to your Aurora
   account (the apps' account) in the site's Log In / Sign Up form, and its
   "Connect" box is your IPTV line (kept in this browser, sent only to your
   provider). Appearance has the site's themes; Playback and Subtitles are the
   player's own settings. Atlantic's Febbox, Trakt, Simkl, passkeys, server
   order and advanced streams belong to its own sources and are left out. */

const TAB = "flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2.5 text-sm transition-colors";
const TAB_ON = "border-atlantic-400 font-semibold text-white";
const TAB_OFF = "border-transparent font-normal text-white/50 hover:text-white";
const INPUT = "w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-atlantic-400/50";
const LABEL = "mb-1 block text-xs font-medium text-white/50";
const CONNECT = "shrink-0 rounded-lg bg-atlantic-500 px-4 py-2 text-sm font-bold text-abyss-950 transition-colors hover:bg-atlantic-400";
const ic = (children) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
const TABS = [
  ["account", "Account", ic(<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>)],
  ["appearance", "Appearance", ic(<><circle cx="13.5" cy="6.5" r=".5" /><circle cx="17.5" cy="10.5" r=".5" /><circle cx="8.5" cy="7.5" r=".5" /><circle cx="6.5" cy="12.5" r=".5" /><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" /></>)],
  ["playback", "Playback", ic(<><circle cx="12" cy="12" r="10" /><path d="m10 8 6 4-6 4Z" /></>)],
  ["subtitles", "Subtitles", ic(<><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M7 13h3M13 13h4M7 9h4" /></>)],
  ["experimental", "Experimental", ic(<><path d="M10 2v7.31" /><path d="M14 9.3V1.99" /><path d="M8.5 2h7" /><path d="M14 9.3a6.5 6.5 0 1 1-4 0" /><path d="M5.52 16h12.96" /></>)],
  ["about", "About", ic(<><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></>)],
];

/* your IPTV line, as a "Connect" box that opens into its form */
function LineBox() {
  const saved = getLine();
  const [open, setOpen] = useState(!saved);
  const [form, setForm] = useState({ name: saved?.name || "My IPTV", server: saved?.server || "", username: saved?.username || "", password: saved?.password || "" });
  const [state, setState] = useState({ busy: false, error: "", ok: saved ? `Connected to ${saved.name || "your line"}` : "" });
  const field = (k, label, type = "text", auto = "off") => (
    <div><label className={LABEL}>{label}</label><input type={type} autoComplete={auto} spellCheck="false" className={INPUT} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></div>
  );
  const connect = async (e) => {
    e.preventDefault();
    if (!form.server || !form.username || !form.password) return setState({ busy: false, error: "Server, username and password are all needed.", ok: "" });
    setState({ busy: true, error: "", ok: "" });
    try {
      await testLine(form);
      setLine({ kind: "xtream", ...form });
      setState({ busy: false, error: "", ok: `Connected to ${form.name || "your line"}` });
      setOpen(false);
    } catch (err) { setState({ busy: false, error: err.message || "Could not connect", ok: "" }); }
  };
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">Your IPTV line</p>
          <p className="text-xs text-white/40">{state.ok || "Connect your Xtream account so Play finds each title on your line."}</p>
        </div>
        {open ? null : <button type="button" onClick={() => setOpen(true)} className={CONNECT}>{saved ? "Change" : "Connect"}</button>}
      </div>
      {open ? (
        <form className="mt-4 space-y-3" onSubmit={connect}>
          {field("name", "Name")}
          {field("server", "Server address")}
          <div className="grid grid-cols-2 gap-3">{field("username", "Username", "text", "username")}{field("password", "Password", "password", "current-password")}</div>
          {state.error ? <p className="text-xs text-red-300">{state.error}</p> : null}
          <div className="flex gap-3">
            <button type="submit" disabled={state.busy} className="w-full rounded-lg bg-atlantic-500 py-2 text-sm font-bold text-abyss-950 transition-colors hover:bg-atlantic-400 disabled:opacity-50">{state.busy ? "Connecting…" : "Connect"}</button>
            {saved ? <button type="button" onClick={() => { clearLine(); setState({ busy: false, error: "", ok: "" }); setForm({ name: "My IPTV", server: "", username: "", password: "" }); }} className="w-full rounded-lg border border-white/10 py-2 text-sm font-semibold text-white/80 transition-colors hover:border-atlantic-400/40 hover:text-white">Disconnect</button> : null}
          </div>
          <p className="text-xs text-white/40">Kept in this browser only, and sent only to your provider.</p>
        </form>
      ) : null}
    </div>
  );
}

/* your Aurora account, in the site's Log In / Sign Up form */
function AccountForm() {
  const { user, profile } = useAccount();
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ email: "", password: "" });
  const [state, setState] = useState({ busy: false, error: "", note: "" });
  const submit = async (e) => {
    e.preventDefault();
    if (!form.email || !form.password) return setState({ busy: false, error: "Email and password are both needed.", note: "" });
    setState({ busy: true, error: "", note: "" });
    try {
      const r = await signIn(form.email.trim(), form.password, { create: mode === "signup" });
      setForm({ email: "", password: "" });
      setState({ busy: false, error: "", note: r.confirm ? "Check your email for a confirmation link, then log in here." : "" });
    } catch (err) { setState({ busy: false, error: err.message || "Could not sign in", note: "" }); }
  };
  if (user) {
    return (
      <div className="rounded-lg border border-white/10 bg-black/20 p-4">
        <div className="flex items-center justify-between gap-3">
          <div><p className="text-sm font-semibold text-white">Signed in as {displayName()}</p><p className="text-xs text-white/40">{profile?.friend_code ? `Friend code ${profile.friend_code} · ` : ""}the same account as the Aurora apps</p></div>
          <button type="button" onClick={() => signOut()} className="shrink-0 rounded-lg border border-white/10 px-4 py-2 text-sm font-semibold text-white/80 transition-colors hover:border-atlantic-400/40 hover:text-white">Log Out</button>
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="mb-4 flex gap-1 rounded-lg bg-black/20 p-1">
        {[["login", "Log In"], ["signup", "Sign Up"]].map(([k, label]) => <button key={k} type="button" onClick={() => setMode(k)} className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${mode === k ? "bg-atlantic-500 text-abyss-950" : "text-white/60 hover:text-white"}`}>{label}</button>)}
      </div>
      <form className="space-y-3" onSubmit={submit}>
        <div><label className={LABEL}>Email</label><input type="email" autoComplete="username" className={INPUT} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        <div><label className={LABEL}>Password</label><input type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} className={INPUT} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
        {state.error ? <p className="text-xs text-red-300">{state.error}</p> : null}
        {state.note ? <p className="text-xs text-white/60">{state.note}</p> : null}
        <button type="submit" disabled={state.busy} className="w-full rounded-lg bg-atlantic-500 py-2 text-sm font-bold text-abyss-950 transition-colors hover:bg-atlantic-400 disabled:opacity-50">{state.busy ? "One moment…" : mode === "signup" ? "Sign Up" : "Log In"}</button>
      </form>
    </div>
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
  return (
    <div>
      <Head title="Account" line="Sign in to sync your settings and watch progress across devices." />
      <AccountForm />
      <div className="mt-8"><LineBox /></div>
    </div>
  );
}

function Appearance() {
  const current = useTheme();
  const always = useAlwaysTitles();
  return (
    <div>
      <Head title="Appearance" line="Pick an ambient theme for the site's background and accent color." />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {THEMES.map((t) => <button key={t.id} type="button" onClick={() => setTheme(t.id)} className={`${t.tile.base} ${current === t.id ? "border-atlantic-400" : "border-white/10 hover:border-white/30"}`} style={t.tile.style ? Object.fromEntries(t.tile.style.split(";").filter(Boolean).map((d) => { const i = d.indexOf(":"); return [d.slice(0, i).trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase()), d.slice(i + 1).trim()]; })) : undefined} dangerouslySetInnerHTML={{ __html: t.tile.inner }} />)}
      </div>
      <div className="mt-6 flex flex-col gap-3 border-t border-white/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-sm font-medium text-white">Always Show Titles</p><p className="mt-0.5 text-xs text-white/40">Show each card's title and rating without hovering.</p></div>
        <button type="button" role="switch" aria-checked={always} onClick={() => setAlwaysTitles(!always)} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${always ? "bg-atlantic-400" : "bg-white/15"}`}><span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${always ? "translate-x-[20px]" : "translate-x-0"}`} /></button>
      </div>
    </div>
  );
}

function Playback() {
  const [prefs, setPref] = usePrefs();
  return (
    <div>
      <Head title="Playback" line="Control how videos play by default." />
      <Row title="Auto Next Episode" line="Automatically play the next episode when one ends."><Toggle on={prefs.autoplayNext} onChange={(v) => setPref("autoplayNext", v)} /></Row>
      <Row title="Auto-Enable Subtitles" line="Turn on the first available subtitle track automatically."><Toggle on={prefs.autoSubs} onChange={(v) => setPref("autoSubs", v)} /></Row>
      <Row title="Seek Amount" line={`${prefs.seek}s per skip`}>
        <div className="flex justify-end gap-1.5 sm:justify-end">{[5, 10, 15, 30].map((n) => <button key={n} type="button" onClick={() => setPref("seek", n)} className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${prefs.seek === n ? "border-atlantic-400/50 bg-atlantic-400/15 text-atlantic-300" : "border-white/10 text-white/60 hover:border-white/20 hover:text-white"}`}>{n}s</button>)}</div>
      </Row>
      <Row title="Double tap to seek" line={`Double tap the left or right side of the video to skip ${prefs.seek}s back or forward. The middle still goes fullscreen.`}><Toggle on={prefs.doubleTap} onChange={(v) => setPref("doubleTap", v)} /></Row>
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
          <p>If you sign in, your Aurora account (the one the apps use) keeps your name, friend code, friends and watch parties.</p>
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
