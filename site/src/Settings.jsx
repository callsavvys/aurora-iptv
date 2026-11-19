import { useEffect, useState } from "react";
import { getLine, setLine, clearLine, testLine } from "./line.js";
import { useAccount, signIn, signOut, displayName } from "./account.js";

/* atlantic.bz's Settings: the gear and title, a row of tabs, the section in a
   card. Its Account tab's "Connect" boxes are where your IPTV line goes: the
   login you type here stays in this browser, and is only ever sent to your
   provider, through the site's relay. */

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

/* your Aurora account: the one the apps use, for watch parties and friends */
function AccountBox() {
  const { user, profile } = useAccount();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: "", password: "" });
  const [state, setState] = useState({ busy: false, error: "", note: "" });
  const go = async (create) => {
    if (!form.email || !form.password) return setState({ busy: false, error: "Email and password are both needed.", note: "" });
    setState({ busy: true, error: "", note: "" });
    try {
      const r = await signIn(form.email.trim(), form.password, { create });
      setForm({ email: "", password: "" });
      setState({ busy: false, error: "", note: r.confirm ? "Check your email for a confirmation link, then sign in here." : "" });
      if (!r.confirm) setOpen(false);
    } catch (err) { setState({ busy: false, error: err.message || "Could not sign in", note: "" }); }
  };
  return (
    <div className="mb-3 rounded-lg border border-white/10 bg-black/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">Your Aurora account</p>
          <p className="text-xs text-white/40">{user ? `Signed in as ${displayName()}${profile?.friend_code ? ` · friend code ${profile.friend_code}` : ""}` : "Sign in to join and start watch parties with the apps."}</p>
        </div>
        {user ? <button type="button" onClick={() => signOut()} className="shrink-0 rounded-lg border border-white/10 px-4 py-2 text-sm font-semibold text-white/80 transition-colors hover:border-atlantic-400/40 hover:text-white">Sign out</button>
          : open ? null : <button type="button" onClick={() => setOpen(true)} className={CONNECT}>Sign in</button>}
      </div>
      {!user && open ? (
        <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); go(false); }}>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={LABEL}>Email</label><input type="email" autoComplete="username" spellCheck="false" className={INPUT} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><label className={LABEL}>Password</label><input type="password" autoComplete="current-password" className={INPUT} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
          </div>
          {state.error ? <p className="text-xs text-red-300">{state.error}</p> : null}
          <div className="flex gap-3">
            <button type="submit" disabled={state.busy} className="w-full rounded-lg bg-atlantic-500 py-2 text-sm font-bold text-abyss-950 transition-colors hover:bg-atlantic-400 disabled:opacity-50">{state.busy ? "Signing in…" : "Sign in"}</button>
            <button type="button" disabled={state.busy} onClick={() => go(true)} className="w-full rounded-lg border border-white/10 py-2 text-sm font-semibold text-white/80 transition-colors hover:border-atlantic-400/40 hover:text-white disabled:opacity-50">Create account</button>
          </div>
          <p className="text-xs text-white/40">The same account as the Aurora apps.</p>
        </form>
      ) : null}
      {state.note ? <p className="mt-3 text-xs text-white/60">{state.note}</p> : null}
    </div>
  );
}

function Account() {
  return (
    <div>
      <h2 className="mb-1 text-xl font-semibold text-white/90 drop-shadow-md transition-colors duration-300">Account</h2>
      <p className="mb-4 text-sm text-white/40">Your line, and the services that sync your lists.</p>
      <AccountBox />
      <LineBox />
    </div>
  );
}

function Later({ title }) {
  return (
    <div>
      <h2 className="mb-1 text-xl font-semibold text-white/90 drop-shadow-md transition-colors duration-300">{title}</h2>
      <p className="mb-4 text-sm text-white/40">Coming next, copied from atlantic.bz.</p>
    </div>
  );
}

export default function Settings() {
  const [tab, setTab] = useState("account");
  useEffect(() => { document.title = "Settings — Aurora"; }, []);
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
        <section className="rounded-xl border border-white/10 bg-abyss-900/60 p-5">
          {tab === "account" ? <Account /> : <Later title={TABS.find((t) => t[0] === tab)[1]} />}
        </section>
      </div>
    </div>
  );
}
