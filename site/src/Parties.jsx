import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAccount, signedIn } from "./account.js";
import { useParty, join, watchLobby, cleanCode, savedName, mediaLabel, PartyError } from "./party.js";
import { IMG } from "./tmdb.js";

/* atlantic.bz/parties: the title, "Have a code?", the sign-in note, and the
   public rooms, each a card with the title's picture, Playing or Paused, who
   hosts and who is in, and Join (a password first, if the room has one).
   The rooms are the public parties' cards in the lobby (party.js). */

const svg = { xmlns: "http://www.w3.org/2000/svg", width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" };
const LogIn = () => <svg {...svg} className="lucide lucide-log-in size-4"><path d="m10 17 5-5-5-5" /><path d="M15 12H3" /><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /></svg>;
const Users = () => <svg {...svg} className="lucide lucide-users size-5"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><path d="M16 3.128a4 4 0 0 1 0 7.744" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><circle cx="9" cy="7" r="4" /></svg>;
const Film = () => <svg {...svg} className="lucide lucide-film size-4"><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M7 3v18" /><path d="M3 7.5h4" /><path d="M3 12h18" /><path d="M3 16.5h4" /><path d="M17 3v18" /><path d="M17 7.5h4" /><path d="M17 16.5h4" /></svg>;
const Tv = () => <svg {...svg} className="lucide lucide-tv size-4"><path d="m17 2-5 5-5-5" /><rect width="20" height="15" x="2" y="7" rx="2" /></svg>;
const Lock = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>;
const Crown = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5Z" /></svg>;
const People = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>;

function RoomCard({ room, onJoin, busy, error }) {
  const [asking, setAsking] = useState(false);
  const [pw, setPw] = useState("");
  const picture = room.media.backdrop ? IMG("w780", room.media.backdrop) : room.media.poster ? IMG("w500", room.media.poster) : "";
  const more = room.count - room.members.length;
  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] transition-colors hover:border-white/20 hover:bg-white/[0.06]">
      <div className="relative h-32 w-full overflow-hidden bg-abyss-800">
        {picture ? <img src={picture} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" /> : null}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
        <div className="absolute left-3 top-3 flex items-center gap-1.5">
          <span className="rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white backdrop-blur-md">{mediaLabel(room.media)}</span>
          <span className={`flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide backdrop-blur-md ${room.playing ? "text-emerald-300" : "text-white/70"}`}><span className={`h-1.5 w-1.5 rounded-full ${room.playing ? "bg-emerald-400" : "bg-white/50"}`} />{room.playing ? "Playing" : "Paused"}</span>
        </div>
        {room.locked ? <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-bold text-amber-200 backdrop-blur-md"><Lock />Password</span> : null}
        <span className="absolute bottom-2.5 right-3 flex items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-md"><People />{room.count}</span>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-white">{room.name || room.media.title}</p>
          {room.name ? <p className="truncate text-sm text-white/55">{room.media.title}</p> : null}
          <p className="mt-1 flex items-center gap-1.5 text-xs text-white/50"><span className="text-amber-300"><Crown /></span><span className="truncate">Hosted by {room.host || "someone"}</span></p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {room.members.slice(0, 6).map((m, i) => <span key={`${m}-${i}`} className="max-w-[7rem] truncate rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/80">{m}</span>)}
          {more > 0 ? <span className="rounded-full bg-white/5 px-2.5 py-1 text-xs text-white/50">+{more}</span> : null}
        </div>
        <div className="mt-auto space-y-2">
          {asking ? <input type="password" autoComplete="off" autoFocus value={pw} maxLength={64} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onJoin(room, pw); }} placeholder="Room password" className="w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-sm text-white placeholder:text-white/35 focus:border-atlantic-400/50 focus:outline-none" /> : null}
          {error ? <p className="text-xs text-red-300">{error}</p> : null}
          <button type="button" disabled={busy} onClick={() => { if (room.locked && !asking) { setAsking(true); return; } onJoin(room, room.locked ? pw : null); }} className="w-full rounded-xl bg-primary py-2.5 text-sm font-bold text-on-primary transition-all hover:brightness-110 disabled:opacity-60">{busy ? "Joining..." : "Join"}</button>
        </div>
      </div>
    </div>
  );
}

export default function Parties() {
  useAccount();
  const account = signedIn();
  const s = useParty();
  const [rooms, setRooms] = useState(null);
  const [failed, setFailed] = useState(false);
  const [joiningCode, setJoiningCode] = useState(null);
  const [roomError, setRoomError] = useState(null);
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [needPw, setNeedPw] = useState(false);
  const [name, setName] = useState(savedName());
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { document.title = "Watch Parties — Aurora"; }, []);
  useEffect(() => watchLobby((r) => { if (r === null) setFailed(true); else { setRooms(r); setFailed(false); } }), [attempt]);
  const retry = useCallback(() => { setFailed(false); setRooms(null); setAttempt((n) => n + 1); }, []);
  const joinRoom = async (room, password) => {
    if (!account) { setRoomError({ code: room.code, message: "Sign in to join public parties." }); return; }
    setJoiningCode(room.code); setRoomError(null);
    try { await join(room.code, password); }
    catch (e) { setRoomError({ code: room.code, message: e instanceof Error ? e.message : "Couldn't join." }); }
    finally { setJoiningCode(null); }
  };
  const joinCode = async () => {
    const c = cleanCode(code);
    if (c.length !== 6) { setError("Codes are 6 letters or numbers."); return; }
    if (!account && !name.trim()) { setError("Pick a display name first."); return; }
    setBusy(true); setError(null);
    try { await join(c, needPw ? pw : null, account ? undefined : name); }
    catch (e) { if (e instanceof PartyError && e.code === "bad_password") setNeedPw(true); setError(e instanceof Error ? e.message : "Couldn't join that party."); }
    finally { setBusy(false); }
  };
  const inParty = (s.phase === "in" || s.phase === "reconnecting") && s.code;
  const FIELD = "min-w-0 rounded-xl border border-white/10 bg-white/[0.06] px-3.5 py-2.5 text-sm text-white placeholder:text-white/35 outline-none transition-colors focus:border-white/30";
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
              {!account ? <input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="Your display name" className={`${FIELD} w-full`} /> : null}
              <input value={code} maxLength={6} onChange={(e) => setCode(cleanCode(e.target.value))} onKeyDown={(e) => { if (e.key === "Enter") joinCode(); }} placeholder="ABC123" autoCapitalize="characters" autoComplete="off" spellCheck={false} className={`${FIELD} flex-1 text-center font-mono uppercase tracking-[0.3em]`} />
              <button type="button" disabled={busy || s.phase === "joining"} onClick={joinCode} className="rounded-xl bg-primary px-6 py-2.5 text-sm font-bold text-on-primary transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-60">{busy ? "Joining..." : "Join"}</button>
            </div>
            {needPw ? <input type="password" autoComplete="off" value={pw} maxLength={64} onChange={(e) => setPw(e.target.value)} placeholder="Room password" className={`${FIELD} mt-2 w-full`} /> : null}
            {error ? <p className="mt-2 text-xs text-rose-300">{error}</p> : null}
          </div>
        </header>
        {inParty ? <div className="mt-8 flex items-center gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100"><span className="size-2 shrink-0 rounded-full bg-emerald-400" /><span>You're in party {s.code}. Use the pill at the bottom left to return or leave.</span></div> : null}
        {!account ? (
          <div className="mt-8 flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-white/65">Public parties need an account. Private parties work with just a code.</p>
            <Link to="/settings" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-white/20"><LogIn />Sign in</Link>
          </div>
        ) : null}
        <section className="mt-10">
          <div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-3"><h2 className="text-lg font-semibold text-white">Public rooms</h2>{rooms && rooms.length > 0 ? <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-semibold text-white/70">{rooms.length}</span> : null}</div></div>
          {rooms === null && !failed ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="h-72 animate-pulse rounded-2xl bg-white/[0.05]" />)}</div> : null}
          {failed && rooms === null ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-6 py-12 text-center">
              <p className="text-lg font-semibold text-white">Couldn't load parties.</p>
              <p className="mt-1 text-sm text-white/50">The watch party service isn't answering right now.</p>
              <button type="button" onClick={retry} className="mt-4 rounded-full bg-white/10 px-5 py-2 text-sm font-semibold text-white hover:bg-white/20">Try again</button>
            </div>
          ) : null}
          {rooms !== null && rooms.length === 0 ? (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-6 py-12 text-center">
              <div className="mb-4 grid size-12 place-items-center rounded-full bg-white/10 text-white/70"><Users /></div>
              <p className="text-lg font-semibold text-white">No public parties right now</p>
              <p className="mt-1 max-w-sm text-sm text-white/50">Be the first. Pick something to watch and start a party from the player settings.</p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                <Link to="/movies" className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-bold text-on-primary transition-all hover:brightness-110"><Film />Browse movies</Link>
                <Link to="/series" className="inline-flex items-center gap-2 rounded-full bg-white/10 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/20"><Tv />Browse TV shows</Link>
              </div>
            </div>
          ) : null}
          {rooms && rooms.length > 0 ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{rooms.map((r) => <RoomCard key={r.code} room={r} onJoin={joinRoom} busy={joiningCode === r.code} error={roomError && roomError.code === r.code ? roomError.message : null} />)}</div> : null}
        </section>
      </div>
    </div>
  );
}
