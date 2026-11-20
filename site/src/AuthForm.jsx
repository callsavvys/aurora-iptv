import { useState } from "react";
import { signIn, USERNAME } from "./account.js";

/* atlantic.bz's Log In / Sign Up form (Settings → Account), with its fields,
   checks and messages: a username and a password, and Confirm Password to
   sign up. Its passkey button is left out: the account server has no
   passkeys. onDone runs once you are in, with "signup" or "login". */
const INPUT = "w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-atlantic-400/50";
const LABEL = "mb-1 block text-xs font-medium text-white/50";

export default function AuthForm({ start = "login", onDone }) {
  const [mode, setMode] = useState(start);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setError(null);
    if (!USERNAME.test(name) && !(mode === "login" && name.includes("@"))) { setError("Username must be 3-32 characters (letters, numbers, _ . -)."); return; }
    if (password.length < (mode === "login" && name.includes("@") ? 6 : 8)) { setError("Password must be at least 8 characters."); return; }
    if (mode === "signup" && password !== confirm) { setError("Passwords don't match."); return; }
    setBusy(true);
    try { await signIn(name, password, { create: mode === "signup" }); onDone?.(mode); }
    catch (e) { setError(e.message || "Something went wrong. Try again."); }
    finally { setBusy(false); }
  };
  return (
    <div>
      <div className="mb-4 flex gap-1 rounded-lg bg-black/20 p-1">
        <button type="button" onClick={() => { setMode("login"); setError(null); }} className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${mode === "login" ? "bg-atlantic-500 text-abyss-950" : "text-white/60 hover:text-white"}`}>Log In</button>
        <button type="button" onClick={() => { setMode("signup"); setError(null); }} className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${mode === "signup" ? "bg-atlantic-500 text-abyss-950" : "text-white/60 hover:text-white"}`}>Sign Up</button>
      </div>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div><label className={LABEL}>Username</label><input type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" className={INPUT} /></div>
        <div><label className={LABEL}>Password</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} className={INPUT} /></div>
        {mode === "signup" ? <div><label className={LABEL}>Confirm Password</label><input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" className={INPUT} /></div> : null}
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        <button type="submit" disabled={busy} className="w-full rounded-lg bg-atlantic-500 py-2 text-sm font-bold text-abyss-950 transition-colors hover:bg-atlantic-400 disabled:opacity-50">{busy ? "Please wait..." : mode === "signup" ? "Create Account" : "Log In"}</button>
      </form>
    </div>
  );
}
