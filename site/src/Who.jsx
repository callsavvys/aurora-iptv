import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { savedAccounts, switchTo } from "./account.js";
import { AuroraMark } from "./icons.jsx";
import { pickedAccount } from "./platform.js";

/* "Who's watching?", as Netflix opens: the accounts used on this device, each
   a tile; picking one switches to it (no password: each keeps its own
   session), then Choose a source. Add account signs in another. The app
   shows this every time it opens; the site from the account menu. */
const COLORS = ["#06aed4", "#e5484d", "#30a46c", "#f5a524", "#8e4ec6", "#e93d82", "#0091ff", "#ff8b3e"];
const colorOf = (id) => COLORS[[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];

export default function Who() {
  const nav = useNavigate();
  const [accounts] = useState(savedAccounts);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { document.title = "Who's watching? — Aurora"; if (!accounts.length) nav("/welcome", { replace: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = async (a) => {
    setBusy(a.id); setError("");
    try { await switchTo(a.id); pickedAccount(); nav("/choose", { replace: true }); }
    catch (e) { setError(e.message || "That account could not be opened."); setBusy(null); }
  };
  return (
    <div className="relative flex min-h-dvh w-full flex-col items-center justify-center bg-black px-6 py-12">
      <div className="absolute left-6 top-3 flex items-center gap-3"><AuroraMark size={44} /><span className="text-2xl font-bold tracking-tight text-white">Aurora</span></div>
      <h1 className="text-4xl font-bold text-white sm:text-5xl">Who's watching?</h1>
      <div className="mt-10 flex flex-wrap justify-center gap-6">
        {accounts.map((a) => (
          <button key={a.id} type="button" disabled={!!busy} onClick={() => pick(a)} className="group flex w-32 flex-col items-center gap-3 rounded-xl p-2 text-center transition-transform hover:scale-105 focus:scale-105">
            <span className="flex h-28 w-28 items-center justify-center rounded-xl text-5xl font-bold text-white shadow-lg ring-white transition-all group-hover:ring-4 group-focus:ring-4" style={{ backgroundColor: colorOf(a.id) }}>{(a.name || "?").slice(0, 1).toUpperCase()}</span>
            <span className="w-full truncate text-base font-semibold text-white/80 group-hover:text-white group-focus:text-white">{busy === a.id ? "Opening..." : a.name}</span>
            <span className="-mt-2 w-full truncate text-xs text-white/40">{a.handle}</span>
          </button>
        ))}
        <button type="button" disabled={!!busy} onClick={() => nav("/welcome?add=1")} className="group flex w-32 flex-col items-center gap-3 rounded-xl p-2 text-center transition-transform hover:scale-105 focus:scale-105">
          <span className="flex h-28 w-28 items-center justify-center rounded-xl border-2 border-white/20 text-6xl font-light text-white/50 transition-all group-hover:border-white group-hover:text-white group-focus:border-white group-focus:text-white">+</span>
          <span className="text-base font-semibold text-white/60 group-hover:text-white group-focus:text-white">Add account</span>
        </button>
      </div>
      {error ? <p className="mt-6 text-sm text-red-400">{error}</p> : null}
    </div>
  );
}
