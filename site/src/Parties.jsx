import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAccount, joinByCode, friendsWatching, displayName } from "./account.js";
import { getLine, loadLibrary, lineEpisodes, streamUrl } from "./line.js";
import Player from "./Player.jsx";

/* atlantic.bz/parties: the title, a "Have a code?" box, a sign-in note, and
   the public rooms. Aurora's parties run on its accounts (account.js): Join
   takes the code a host reads out, finds the same title on your line and
   plays it in step with the host; the rooms are your friends' open parties. */

const svg = { xmlns: "http://www.w3.org/2000/svg", width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" };
const LogIn = () => <svg {...svg} className="lucide lucide-log-in size-4"><path d="m10 17 5-5-5-5" /><path d="M15 12H3" /><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /></svg>;
const Users = () => <svg {...svg} className="lucide lucide-users size-5"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><path d="M16 3.128a4 4 0 0 1 0 7.744" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><circle cx="9" cy="7" r="4" /></svg>;
const Film = () => <svg {...svg} className="lucide lucide-film size-4"><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M7 3v18" /><path d="M3 7.5h4" /><path d="M3 12h18" /><path d="M3 16.5h4" /><path d="M17 3v18" /><path d="M17 7.5h4" /><path d="M17 16.5h4" /></svg>;
const Tv = () => <svg {...svg} className="lucide lucide-tv size-4"><path d="m17 2-5 5-5-5" /><rect width="20" height="15" x="2" y="7" rx="2" /></svg>;

const field = "min-w-0 rounded-xl border border-white/10 bg-white/[0.06] px-3.5 py-2.5 text-sm text-white placeholder:text-white/35 outline-none transition-colors focus:border-white/30";

export default function Parties() {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [rooms, setRooms] = useState([]);
  const [player, setPlayer] = useState(null);
  const { user } = useAccount();
  useEffect(() => { document.title = "Watch Parties — Aurora"; }, []);
  useEffect(() => { if (user && !name) setName(displayName()); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  // your friends' open parties, checked again every 20 s while you look
  useEffect(() => {
    if (!user) { setRooms([]); return undefined; }
    let live = true;
    const load = () => friendsWatching().then((r) => live && setRooms(r));
    load();
    const t = setInterval(load, 20000);
    return () => { live = false; clearInterval(t); };
  }, [user]);
  const join = async (typed = code) => {
    const clean = typed.trim();
    if (clean.length !== 6) { setNote("Party codes are six characters."); return; }
    if (!user) { setNote("Sign in first, in Settings → Account, to join a party."); return; }
    if (!getLine()) { setNote("Connect your IPTV line first, in Settings → Account."); return; }
    setBusy(true); setNote("Finding it on your line…");
    try {
      const lib = await loadLibrary();
      const r = await joinByCode(clean, [...lib.movies, ...lib.series]);
      if (r.error) { setNote(r.error); return; }
      const it = r.item;
      if (it.kind === "movie") { setPlayer({ src: streamUrl(it), title: it.name, subtitle: "Watch party", item: it }); setNote(""); return; }
      // a series: the episode you watched last there, else its first episode
      const eps = await lineEpisodes(it.id);
      const last = it.tmdb ? JSON.parse(localStorage.getItem(`aurora-site-last:${it.tmdb}`) || "null") : null;
      const seasons = Object.keys(eps).map(Number).filter((n) => n > 0).sort((a, b) => a - b);
      const ep = (last && (eps[last.s] || []).find((x) => x.number === last.e)) || (eps[seasons[0]] || [])[0];
      if (!ep) { setNote(`Your line lists no episodes for ${it.name}.`); return; }
      setPlayer({ src: streamUrl(it, ep), title: it.name, subtitle: `S${ep.season} · E${ep.number} · Watch party`, item: it });
      setNote("");
    } catch (err) { setNote(err.message || "Your line did not answer."); } finally { setBusy(false); }
  };
  return (
    <div className="transition-opacity duration-150 opacity-100">
      <div className="mx-auto w-full max-w-6xl px-4 pb-20 pt-10 sm:px-6">
        <header className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-xl">
            <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">Watch Parties</h1>
            <p className="mt-3 text-[15px] leading-relaxed text-white/55">Public rooms you can hop into. To start your own, open any title and use Watch Party in the player settings.</p>
          </div>
          <div className="w-full rounded-2xl border border-white/10 bg-white/[0.04] p-4 lg:w-[27rem] lg:shrink-0">
            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-white/45">Have a code?</p>
            <div className="flex flex-wrap gap-2">
              <input maxLength={24} placeholder="Your display name" value={name} onChange={(e) => setName(e.target.value)} className={`${field} w-full`} />
              <input maxLength={6} placeholder="ABC123" autoCapitalize="characters" autoComplete="off" spellCheck="false" value={code} onChange={(e) => { setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "")); setNote(""); }} onKeyDown={(e) => e.key === "Enter" && join()} className={`${field} flex-1 text-center font-mono uppercase tracking-[0.3em]`} />
              <button type="button" onClick={() => join()} disabled={busy} className="rounded-xl bg-primary px-6 py-2.5 text-sm font-bold text-on-primary transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-60">Join</button>
            </div>
            {note ? <p role="status" className="mt-3 text-sm text-white/65">{note}</p> : null}
          </div>
        </header>
        {user ? null : <div className="mt-8 flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-white/65">Public parties need an account. Private parties work with just a code.</p>
          <Link className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-white/20" to="/settings"><LogIn />Sign in</Link>
        </div>}
        <section className="mt-10">
          <div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-3"><h2 className="text-lg font-semibold text-white">Public rooms</h2></div></div>
          {rooms.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {rooms.map((r) => (
                <div key={r.party_id} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="grid size-10 shrink-0 place-items-center rounded-full bg-white/10 text-white/70"><Users /></div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">{r.title}</p>
                    <p className="truncate text-xs text-white/50">{r.display_name} · {r.kind === "series" ? "Series" : "Film"}</p>
                  </div>
                  <button type="button" disabled={busy} onClick={() => { setCode(r.code); join(r.code); }} className="shrink-0 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-on-primary transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-60">Join</button>
                </div>
              ))}
            </div>
          ) : <div className="flex flex-col items-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-6 py-12 text-center">
            <div className="mb-4 grid size-12 place-items-center rounded-full bg-white/10 text-white/70"><Users /></div>
            <p className="text-lg font-semibold text-white">No public parties right now</p>
            <p className="mt-1 max-w-sm text-sm text-white/50">Be the first. Pick something to watch and start a party from the player settings.</p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Link className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-bold text-on-primary transition-all hover:brightness-110" to="/movies"><Film />Browse movies</Link>
              <Link className="inline-flex items-center gap-2 rounded-full bg-white/10 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/20" to="/tv"><Tv />Browse TV shows</Link>
            </div>
          </div>}
        </section>
      </div>
      {player ? <Player key={player.src} src={player.src} title={player.title} subtitle={player.subtitle} partyItem={player.item} onClose={() => setPlayer(null)} /> : null}
    </div>
  );
}
