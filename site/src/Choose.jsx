import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { savedSources } from "./vault.js";
import { confirmPassword, displayName } from "./account.js";
import { getLine, setLine, lineLabel, VIDORA, isVidora } from "./line.js";
import { AuroraMark } from "./icons.jsx";
import { pickedSource } from "./platform.js";

/* Choose a source: after you sign in, and each time the app opens, your saved
   sources (the account's sealed vault, vault.js) as tiles, and a playlist
   this device keeps; pick one to watch from. Add a source opens Connect a
   source. A device that cannot open the vault yet asks for your password once. */
const hostOf = (s) => { try { return new URL(String(s).replace(/^(?!https?:\/\/)/, "http://")).hostname; } catch { return ""; } };

export default function Choose() {
  const nav = useNavigate();
  const [sources, setSources] = useState(undefined);   // undefined loading, null locked
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const here = getLine();
  const load = () => savedSources().then(setSources).catch(() => setSources([]));
  useEffect(() => { document.title = "Choose a source — Aurora"; load(); }, []);
  const deviceOnly = here && here.kind === "m3u" ? here : null;
  // Vidora is always here, so a new account picks from it or adds its own line
  const pick = (cfg) => { setLine(cfg); pickedSource(); nav("/", { replace: true }); };
  const unlock = async (e) => {
    e.preventDefault(); setBusy(true); setError("");
    try { await confirmPassword(pw); setPw(""); await load(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const current = (s) => here && here.kind === "xtream" && here.server === s.server && here.username === s.username;
  return (
    <div className="relative flex min-h-dvh w-full flex-col items-center justify-center bg-black px-6 py-12">
      <div className="absolute left-6 top-3 flex items-center gap-3"><AuroraMark size={44} /><span className="text-2xl font-bold tracking-tight text-white">Aurora</span></div>
      <h1 className="text-4xl font-bold text-white sm:text-5xl">Choose a source</h1>
      <p className="mt-3 text-sm text-white/50">{displayName() ? `${displayName()}'s saved sources` : "Your saved sources"}</p>
      {sources === undefined ? <p className="mt-10 text-sm text-white/40">Opening your saved sources…</p> : null}
      {sources === null ? (
        <form onSubmit={unlock} className="mt-10 w-full max-w-sm space-y-3 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
          <p className="text-sm text-white/70">Your sources are sealed with your account password. Enter it once to open them on this device.</p>
          <input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" className="w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-atlantic-400/50" />
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <button type="submit" disabled={busy || !pw} className="w-full rounded-lg bg-atlantic-500 py-2 text-sm font-bold text-abyss-950 transition-colors hover:bg-atlantic-400 disabled:opacity-50">{busy ? "Opening..." : "Open my sources"}</button>
          <button type="button" onClick={() => nav("/sources?first=1")} className="w-full text-sm text-white/50 hover:text-white">Add a source instead</button>
        </form>
      ) : null}
      {sources !== undefined ? (
        <div className="mt-10 flex max-w-4xl flex-wrap justify-center gap-5">
          {(sources || []).map((s) => (
            <button key={`${s.server}|${s.username}`} type="button" onClick={() => pick({ kind: "xtream", name: s.name || "My IPTV", server: s.server, username: s.username, password: s.password })}
              className={`flex w-56 flex-col items-start gap-2 rounded-2xl border p-5 text-left transition-all hover:scale-[1.03] focus:scale-[1.03] ${current(s) ? "border-atlantic-400 bg-white/[0.08]" : "border-white/10 bg-white/[0.04] hover:border-white/30"}`}>
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-atlantic-500/20 text-atlantic-300"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" /><rect x="2" y="14" width="20" height="8" rx="2" /><path d="M6 6h.01M6 18h.01" /></svg></span>
              <span className="w-full truncate text-lg font-semibold text-white">{s.name || "My IPTV"}</span>
              <span className="w-full truncate text-xs text-white/45">Xtream Codes · {hostOf(s.server)}</span>
              {current(s) ? <span className="text-[11px] font-bold uppercase tracking-wider text-atlantic-300">Last used</span> : null}
            </button>
          ))}
          {deviceOnly ? (
            <button type="button" onClick={() => pick(deviceOnly)} className="flex w-56 flex-col items-start gap-2 rounded-2xl border border-atlantic-400 bg-white/[0.08] p-5 text-left transition-all hover:scale-[1.03] focus:scale-[1.03]">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-atlantic-500/20 text-atlantic-300"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg></span>
              <span className="w-full truncate text-lg font-semibold text-white">{deviceOnly.name || "My playlist"}</span>
              <span className="w-full truncate text-xs text-white/45">{lineLabel(deviceOnly)} · this device</span>
            </button>
          ) : null}
          <button type="button" onClick={() => pick(VIDORA)}
            className={`flex w-56 flex-col items-start gap-2 rounded-2xl border p-5 text-left transition-all hover:scale-[1.03] focus:scale-[1.03] ${isVidora(here) ? "border-atlantic-400 bg-white/[0.08]" : "border-white/10 bg-white/[0.04] hover:border-white/30"}`}>
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-atlantic-500/20 text-atlantic-300"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 5 9 15 9-15" /><path d="M7.5 5 12 13l4.5-8" /></svg></span>
            <span className="w-full truncate text-lg font-semibold text-white">Vidora</span>
            <span className="w-full truncate text-xs text-white/45">Built in · films, series and anime</span>
            {isVidora(here) ? <span className="text-[11px] font-bold uppercase tracking-wider text-atlantic-300">Last used</span> : null}
          </button>
          <button type="button" onClick={() => nav("/sources?first=1")} className="flex w-56 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-white/15 p-5 text-white/50 transition-all hover:scale-[1.03] hover:border-white/40 hover:text-white focus:scale-[1.03] focus:border-white/40 focus:text-white">
            <span className="text-4xl font-light">+</span><span className="text-sm font-semibold">Add a source</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
