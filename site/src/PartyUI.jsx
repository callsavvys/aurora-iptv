import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useParty, host, join, leave, kick, updateSettings, setOverlay, sendChat, markRead, clearNotice, consumeNav, resume, savedName, cleanCode, mediaPath, PartyError } from "./party.js";
import { useAccount, signedIn } from "./account.js";
import { Switch } from "./PlayerMenu.jsx";

/* Watch party pieces in atlantic.bz's markup (party.js runs them):
   - PartyPanel: the player's Watch Party panel (host or join; in a party,
     the code, Copy code / Copy link, Edit, who is watching, Show status
     overlay, End or Leave);
   - PartyStatus and PartyChat: the pill at the top of the player and the
     party chat at its bottom left;
   - PartyPill: "Hosting · CODE · 2 watching" with Return and leave, on every
     other page while you are in a party, and the notice when a party ends;
   - Invite: /party/<code>, the page a copied link opens. */

const L = (cls, children) => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`lucide ${cls}`} aria-hidden="true">{children}</svg>;
export const PI = {
  pencil: (c) => L(`lucide-pencil ${c}`, <><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" /></>),
  copy: (c) => L(`lucide-copy ${c}`, <><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></>),
  link: (c) => L(`lucide-link ${c}`, <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>),
  check: (c) => L(`lucide-check ${c}`, <path d="M20 6 9 17l-5-5" />),
  sparkles: (c) => L(`lucide-sparkles lucide-stars ${c}`, <><path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" /><path d="M20 2v4" /><path d="M22 4h-4" /><circle cx="4" cy="20" r="2" /></>),
  users: (c) => L(`lucide-users ${c}`, <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><path d="M16 3.128a4 4 0 0 1 0 7.744" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><circle cx="9" cy="7" r="4" /></>),
};
const X = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>;
const FIELD = "w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white/90 outline-none placeholder:text-white/30 focus:border-primary";

function Btn({ theme, disabled, onClick, children }) {
  const look = theme === "danger" ? "bg-rose-500 bg-opacity-20 text-rose-400 hover:bg-opacity-30" : theme === "muted" ? "bg-white/10 text-white/90 hover:bg-white/20" : "bg-primary text-on-primary hover:brightness-110";
  return <button type="button" disabled={disabled} onClick={onClick} className={`w-full rounded-xl py-2.5 text-center text-sm font-bold transition-all active:scale-[0.99] ${disabled ? "cursor-not-allowed opacity-50" : look}`}>{children}</button>;
}
const Privacy = ({ value, onChange }) => (
  <div className="flex gap-2 rounded-xl bg-white/5 p-1">
    {[["private", false], ["public", true]].map(([label, pub]) => <button key={label} type="button" onClick={() => onChange(pub)} className={`flex-1 rounded-lg py-1.5 text-sm font-medium capitalize transition-colors ${value === pub ? "bg-white/15 text-white" : "text-white/50 hover:text-white/80"}`}>{label}</button>)}
  </div>
);
const copy = (text) => (navigator.clipboard?.writeText ? navigator.clipboard.writeText(text).then(() => true, () => false) : Promise.resolve(false));
const errText = (e, fallback) => (e instanceof PartyError || e instanceof Error ? e.message : fallback);

/* the player's Watch Party panel; getHostPayload gives what is playing, or null */
export function PartyPanel({ getHostPayload, onClose }) {
  const s = useParty();
  useAccount();
  const account = signedIn();
  const [pub, setPub] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState(savedName());
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState("");
  const [roomPw, setRoomPw] = useState("");
  const [needPw, setNeedPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(null);
  const [editing, setEditing] = useState(false);
  const [ePub, setEPub] = useState(false);
  const [eName, setEName] = useState("");
  const [ePw, setEPw] = useState("");
  const inParty = s.phase === "in" || s.phase === "reconnecting";
  const hosting = s.role === "host";
  const guest = !account;
  const away = s.phase === "reconnecting" || s.hostAway;
  const startHost = async () => {
    const p = getHostPayload?.();
    if (!p) { setError("Start a title first, then host from the player."); return; }
    if (pub && !account) { setError("Sign in to host a public party."); return; }
    if (guest && !name.trim()) { setError("Pick a display name first."); return; }
    setBusy(true); setError(null);
    try { await host({ public: pub, password: pub ? password : "", roomName: pub ? roomName : "", media: p.media, playing: p.playing, time: p.time, rate: p.rate, guestName: guest ? name : undefined }); }
    catch (e) { setError(errText(e, "Couldn't start the party.")); } finally { setBusy(false); }
  };
  const startJoin = async () => {
    const c = cleanCode(code);
    if (c.length !== 6) { setError("Codes are 6 letters or numbers."); return; }
    if (guest && !name.trim()) { setError("Pick a display name first."); return; }
    setBusy(true); setError(null);
    try { await join(c, needPw ? roomPw : null, guest ? name : undefined); onClose?.(); }
    catch (e) { if (e instanceof PartyError && e.code === "bad_password") setNeedPw(true); setError(errText(e, "Couldn't join that party.")); }
    finally { setBusy(false); }
  };
  const copyIt = async (what) => {
    if (!s.code) return;
    if (await copy(what === "code" ? s.code : `${window.location.origin}/party/${s.code}`)) { setCopied(what); setTimeout(() => setCopied(null), 1500); }
  };
  if (inParty && s.code) {
    return (
      <div className="flex flex-col gap-3 pb-1">
        <div className="rounded-xl bg-white/10 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="relative flex size-2"><span className={`absolute inline-flex size-full animate-ping rounded-full opacity-75 ${away ? "bg-rose-500" : "bg-green-500"}`} /><span className={`relative inline-flex size-2 rounded-full ${away ? "bg-rose-500" : "bg-green-500"}`} /></span>
              <span className="text-xs font-semibold uppercase tracking-wider text-white/50">{s.phase === "reconnecting" ? "Offline" : hosting ? "Hosting" : s.hostAway ? "Host away" : "Watching"}</span>
            </div>
            {hosting && !editing ? <button type="button" onClick={() => { setEPub(s.info.public); setEName(s.info.name); setEPw(""); setEditing(true); }} className="flex items-center gap-1 text-xs text-white/50 transition-colors hover:text-white/90">{PI.pencil("size-3")}Edit</button> : null}
          </div>
          <button type="button" onClick={() => copyIt("code")} className="w-full cursor-pointer py-1 text-center font-mono text-2xl uppercase tracking-[0.3em] text-white/90 transition-opacity hover:opacity-80">{copied === "code" ? "Copied" : s.code}</button>
          <p className="mt-1 text-center text-[11px] font-medium text-white/40">{s.info.public ? "Public" : "Private"}{s.info.locked ? " · password protected" : ""}{s.info.name ? ` · ${s.info.name}` : ""}</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => copyIt("code")} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white/10 px-2 py-1.5 text-xs text-white/50 transition-colors hover:bg-white/20 hover:text-white/90">{copied === "code" ? PI.check("size-3") : PI.copy("size-3")}{copied === "code" ? "Copied" : "Copy code"}</button>
            <button type="button" onClick={() => copyIt("link")} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white/10 px-2 py-1.5 text-xs text-white/50 transition-colors hover:bg-white/20 hover:text-white/90">{copied === "link" ? PI.check("size-3") : PI.link("size-3")}{copied === "link" ? "Copied" : "Copy link"}</button>
          </div>
        </div>
        {hosting && editing ? (
          <div className="flex flex-col gap-2 rounded-xl bg-white/10 p-3">
            <Privacy value={ePub} onChange={setEPub} />
            {ePub && !account ? <p className="text-xs text-amber-200/80">Sign in to make this party public.</p> : null}
            {ePub ? <>
              <input className={FIELD} value={eName} maxLength={40} onChange={(e) => setEName(e.target.value)} placeholder="Room name (optional)" />
              <input className={FIELD} type="text" autoComplete="off" value={ePw} maxLength={64} onChange={(e) => setEPw(e.target.value)} placeholder={s.info.locked ? "New password (blank removes it)" : "Optional room password"} />
            </> : null}
            <div className="flex gap-2"><Btn theme="muted" onClick={() => setEditing(false)}>Cancel</Btn><Btn onClick={() => { updateSettings({ public: ePub, roomName: ePub ? eName : "", password: ePub ? ePw : "" }); setEditing(false); }}>Save</Btn></div>
          </div>
        ) : null}
        {s.members.length > 1 ? (
          <div className="rounded-xl bg-white/10 p-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-white/50">{s.members.length} watching</span>
            <div className="mt-2 flex max-h-32 flex-col gap-1.5 overflow-y-auto">
              {s.members.map((m) => {
                const me = m.id === s.meId;
                return (
                  <div key={m.id} className="flex items-center justify-between text-sm">
                    <span className="flex min-w-0 items-center gap-1.5">{m.host ? PI.sparkles("size-3 shrink-0 text-atlantic-300") : PI.users("size-3 shrink-0 text-white/50")}<span className={`truncate ${m.host ? "font-medium text-atlantic-300" : me ? "text-white/90" : "text-white/50"}`}>{m.name}{me ? " · you" : ""}</span></span>
                    {hosting && !m.host ? <button type="button" onClick={() => kick(m.id)} className="ml-2 shrink-0 text-xs text-white/40 transition-colors hover:text-rose-400" aria-label={`Remove ${m.name}`}>Remove</button> : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
        <div className="flex items-center justify-between rounded-xl bg-white/10 p-3"><span className="text-sm text-white/90">Show status overlay</span><Switch on={s.overlay} onChange={() => setOverlay(!s.overlay)} label="Show status overlay" /></div>
        <Btn theme="danger" onClick={() => { leave(); onClose?.(); }}>{hosting ? "End Watch Party" : "Leave Watch Party"}</Btn>
      </div>
    );
  }
  const canHost = !!getHostPayload;
  return (
    <div className="flex flex-col gap-3 pb-1">
      {guest ? <input className={FIELD} value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="Your display name" /> : null}
      {canHost && !joining ? (
        <div className="flex flex-col gap-2">
          <Privacy value={pub} onChange={setPub} />
          <p className="px-1 text-xs text-white/40">{pub ? "Listed on the Watch Parties page for anyone to join. Needs an account." : "Only people with the code can join."}</p>
          {pub && !account ? <p className="px-1 text-xs text-amber-200/80"><Link to="/settings" className="underline hover:text-amber-100">Sign in</Link> to host a public party.</p> : null}
          {pub ? <>
            <input className={FIELD} value={roomName} maxLength={40} onChange={(e) => setRoomName(e.target.value)} placeholder="Room name (optional)" />
            <input className={FIELD} type="text" autoComplete="off" value={password} maxLength={64} onChange={(e) => setPassword(e.target.value)} placeholder="Optional room password" />
          </> : null}
          <Btn onClick={startHost} disabled={busy || s.phase === "joining"}><span className="flex items-center justify-center gap-2">{PI.sparkles("size-4")}{busy ? "Starting..." : "Host a Watch Party"}</span></Btn>
          <Btn theme="muted" onClick={() => { setJoining(true); setError(null); }}>Join a Watch Party</Btn>
        </div>
      ) : null}
      {joining || !canHost ? (
        <div className="flex flex-col gap-3">
          <input className="w-full rounded-xl border border-white/15 bg-black/80 px-3 py-3 text-center font-mono text-2xl uppercase tracking-[0.4em] text-white/90 outline-none focus:border-primary" value={code} maxLength={6} autoFocus onChange={(e) => setCode(cleanCode(e.target.value))} onKeyDown={(e) => { if (e.key === "Enter") startJoin(); }} placeholder="ABC123" autoCapitalize="characters" autoComplete="off" spellCheck={false} />
          {needPw ? <input className={FIELD} type="password" autoComplete="off" value={roomPw} maxLength={64} onChange={(e) => setRoomPw(e.target.value)} placeholder="Room password" /> : null}
          <div className="flex gap-2">
            {canHost ? <Btn theme="muted" onClick={() => { setJoining(false); setError(null); }}>Cancel</Btn> : null}
            <Btn onClick={startJoin} disabled={busy || s.phase === "joining" || code.length === 0}>{busy ? "Joining..." : "Join"}</Btn>
          </div>
        </div>
      ) : null}
      {error ? <p className="text-center text-xs text-rose-400">{error}</p> : null}
    </div>
  );
}

/* the pill at the top of the player while you are in a party */
export function PartyStatus({ controlsVisible }) {
  const s = useParty();
  if (!s.overlay || (s.phase !== "in" && s.phase !== "reconnecting") || !s.code) return null;
  const hostM = s.members.find((m) => m.host);
  const dot = s.phase === "reconnecting" || s.hostAway ? "bg-amber-400" : "bg-emerald-400";
  const label = s.phase === "reconnecting" ? "Reconnecting" : s.role === "host" ? "Hosting" : s.hostAway ? "Host disconnected" : `Watching with ${hostM?.name ?? "host"}`;
  return (
    <div className={`pointer-events-none absolute left-1/2 top-3 z-30 -translate-x-1/2 transition-opacity duration-300 ${controlsVisible ? "opacity-100" : "opacity-50"}`}>
      <div className="flex items-center gap-2 rounded-full border border-white/10 bg-pagebg/70 px-3.5 py-1.5 text-xs text-white shadow-lg backdrop-blur-xl">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        <span className="max-w-[46vw] truncate font-semibold">{label}</span>
        <span className="text-white/50">· {s.members.length}</span>
        <span className="font-mono tracking-widest text-white/60">{s.code}</span>
      </div>
    </div>
  );
}

const PREVIEW_MS = 6000, MAX_CHAT = 300;
/* the party chat, bottom left in the player: a button, the last message for a moment, and the room */
export function PartyChat({ controlsVisible }) {
  const s = useParty();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [until, setUntil] = useState(0);
  const [, tick] = useState(0);
  const list = useRef(null), input = useRef(null);
  useEffect(() => { if (!s.lastChatAt) return undefined; setUntil(Date.now() + PREVIEW_MS); const t = setTimeout(() => tick((n) => n + 1), PREVIEW_MS + 50); return () => clearTimeout(t); }, [s.lastChatAt]);
  useLayoutEffect(() => { const el = list.current; if (el) el.scrollTop = el.scrollHeight; }, [s.chat, open]);
  useEffect(() => { if (open && s.unread > 0) markRead(); }, [open, s.unread]);
  if (s.phase !== "in" && s.phase !== "reconnecting") return null;
  const fresh = Date.now() < until;
  const last = s.chat.length ? s.chat[s.chat.length - 1] : null;
  const shown = open && (controlsVisible || focused || fresh);
  const faded = open && !controlsVisible && !focused && fresh;
  const button = controlsVisible || focused;
  const submit = (e) => { e.preventDefault(); const t = text.trim(); if (t) { sendChat(t); setText(""); } };
  return (
    <div className="pointer-events-none absolute bottom-24 left-3 z-40 flex w-[min(22rem,calc(100vw-1.5rem))] flex-col items-start gap-2 sm:left-6 short:bottom-14" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <div className={`flex max-h-[min(22rem,50dvh)] w-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-pagebg/75 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.8)] backdrop-blur-2xl transition-[opacity,transform] duration-300 ${shown ? `${faded ? "opacity-60" : "opacity-100"} pointer-events-auto translate-y-0` : "pointer-events-none translate-y-2 opacity-0"}`} aria-hidden={!shown}>
        <div className="flex items-center justify-between border-b border-white/10 px-3.5 py-2.5">
          <span className="text-sm font-semibold text-white">Party chat</span>
          <button type="button" onClick={() => setOpen(false)} aria-label="Collapse chat" className="rounded-full p-1 text-white/60 transition-colors hover:bg-white/10 hover:text-white"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg></button>
        </div>
        <div ref={list} className="min-h-[7rem] flex-1 space-y-1.5 overflow-y-auto px-3.5 py-3 text-sm">
          {s.chat.length === 0 ? <p className="py-4 text-center text-xs text-white/40">No messages yet. Say hi.</p> : null}
          {s.chat.map((m) => (m.sys ? <p key={m.id} className="text-center text-xs text-white/40">{m.text}</p> : (
            <p key={m.id} className="break-words leading-snug text-white/90"><span className={`font-semibold ${m.from === s.meId ? "text-atlantic-300" : m.host ? "text-amber-300" : "text-white"}`}>{m.name || "Guest"}</span><span className="text-white/40">: </span>{m.text}</p>
          )))}
        </div>
        {s.notice ? <p className="border-t border-white/10 bg-red-500/10 px-3.5 py-1.5 text-xs text-red-200">{s.notice}</p> : null}
        <form onSubmit={submit} className="flex items-center gap-2 border-t border-white/10 p-2.5">
          <input ref={input} value={text} onChange={(e) => setText(e.target.value.slice(0, MAX_CHAT))} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} placeholder="Message the room" maxLength={MAX_CHAT} autoComplete="off" spellCheck={false} className="min-w-0 flex-1 rounded-full border border-white/10 bg-white/5 px-3.5 py-2 text-sm text-white placeholder:text-white/35 focus:border-atlantic-400/50 focus:outline-none" />
          <button type="submit" disabled={!text.trim()} className="rounded-full bg-atlantic-500 px-3.5 py-2 text-sm font-semibold text-abyss-950 transition-opacity hover:bg-atlantic-400 disabled:opacity-40">Send</button>
        </form>
      </div>
      {!open && last && !last.sys && fresh && !controlsVisible ? (
        <div className="max-w-full animate-menu-in rounded-2xl border border-white/10 bg-pagebg/70 px-3.5 py-2 text-sm text-white/80 opacity-70 shadow-lg backdrop-blur-2xl"><span className="font-semibold text-white">{last.name || "Guest"}</span><span className="text-white/40">: </span><span className="break-words">{last.text.length > 120 ? `${last.text.slice(0, 120)}...` : last.text}</span></div>
      ) : null}
      <button type="button" onClick={() => { setOpen((o) => !o); setTimeout(() => input.current?.focus(), 80); }} aria-label={open ? "Collapse chat" : "Open chat"} className={`pointer-events-auto relative flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-pagebg/75 text-white shadow-lg backdrop-blur-2xl transition-[opacity,transform,background-color] duration-300 hover:bg-pagebg/90 ${open ? "hidden" : button ? "opacity-100" : "pointer-events-none opacity-0"}`}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
        {s.unread > 0 ? <span className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-atlantic-500 px-1 text-[11px] font-bold text-abyss-950">{s.unread > 9 ? "9+" : s.unread}</span> : null}
      </button>
    </div>
  );
}

/* on every page: back into your party after a reload, a guest sent to the
   host's title, the pill to return or leave, and the notice when it ends */
export function PartyPill() {
  const s = useParty();
  const nav = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => { resume(); }, []);
  useEffect(() => { if (s.pendingNav && s.media) { consumeNav(); nav(mediaPath(s.media)); } }, [s.pendingNav, s.media, nav]);
  useEffect(() => { if (!s.notice || s.phase !== "idle") return undefined; const t = setTimeout(clearNotice, 6000); return () => clearTimeout(t); }, [s.notice, s.phase]);
  const show = (s.phase === "in" || s.phase === "reconnecting") && s.code && s.media && !s.playerOpen && !pathname.startsWith("/welcome");
  return (
    <>
      {s.notice && s.phase === "idle" ? (
        <div className="pointer-events-none fixed inset-x-0 top-20 z-[90] flex justify-center px-4">
          <div className="pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl border border-white/10 bg-pagebg/90 px-4 py-3 text-sm text-white shadow-2xl backdrop-blur-xl"><span>{s.notice}</span><button type="button" onClick={clearNotice} aria-label="Dismiss" className="text-white/50 hover:text-white"><X /></button></div>
        </div>
      ) : null}
      {show ? (
        <div className="fixed bottom-4 left-4 z-[60] flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-full border border-white/10 bg-pagebg/85 py-2 pl-4 pr-2 text-sm text-white shadow-[0_8px_24px_-8px_rgba(0,0,0,0.7)] backdrop-blur-xl">
          <span className={`h-2 w-2 shrink-0 rounded-full ${s.phase === "reconnecting" || s.hostAway ? "bg-amber-400" : "bg-emerald-400"}`} />
          <span className="truncate"><span className="font-semibold">{s.role === "host" ? "Hosting" : "In party"}</span><span className="text-white/50"> · {s.code} · {s.members.length} watching</span></span>
          <button type="button" onClick={() => nav(mediaPath(s.media))} className="shrink-0 rounded-full bg-atlantic-500 px-3 py-1 text-xs font-bold text-abyss-950 hover:bg-atlantic-400">Return</button>
          <button type="button" onClick={() => leave()} aria-label="Leave party" className="shrink-0 rounded-full p-1.5 text-white/50 hover:bg-white/10 hover:text-white"><X /></button>
        </div>
      ) : null}
    </>
  );
}

/* /party/<code>: a copied invite link */
export function Invite() {
  const params = useParams();
  const code = cleanCode(params.code || "");
  const valid = code.length === 6;
  const s = useParty();
  useAccount();
  const account = signedIn();
  const [name, setName] = useState(savedName());
  const [pw, setPw] = useState("");
  const [needPw, setNeedPw] = useState(false);
  const [needAccount, setNeedAccount] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const tried = useRef(false);
  useEffect(() => { document.title = "Join Watch Party — Aurora"; }, []);
  const go = async (password, guestName) => {
    setBusy(true); setError(null);
    try { await join(code, password, guestName); }
    catch (e) { if (e instanceof PartyError && e.code === "bad_password") setNeedPw(true); if (e instanceof PartyError && e.code === "auth_required") setNeedAccount(true); setError(errText(e, "Couldn't join that party.")); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (!valid || tried.current || s.phase !== "idle") return; if (account || savedName()) { tried.current = true; go(null, account ? undefined : savedName()); } }, [valid, s.phase]); // eslint-disable-line react-hooks/exhaustive-deps
  const INPUT = "w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder:text-white/35 focus:border-atlantic-400/50 focus:outline-none";
  return (
    <div className="mx-auto flex min-h-[60dvh] w-full max-w-md flex-col justify-center px-4 py-12">
      <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl backdrop-blur-xl">
        <p className="text-xs font-bold uppercase tracking-wider text-white/45">Watch party invite</p>
        <p className="my-3 text-center font-mono text-4xl font-semibold tracking-[0.35em] text-white">{valid ? code : "------"}</p>
        {!valid ? <p className="text-center text-sm text-red-300">That invite link isn't valid.</p> : (
          <div className="space-y-3">
            {!account ? <input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="Your display name" className={INPUT} /> : null}
            {needPw ? <input type="password" autoComplete="off" value={pw} maxLength={64} onChange={(e) => setPw(e.target.value)} placeholder="Room password" className={INPUT} /> : null}
            <button type="button" disabled={busy || s.phase === "joining" || (!account && !name.trim())} onClick={() => go(needPw ? pw : null, account ? undefined : name)} className="w-full rounded-xl bg-atlantic-500 py-3 text-sm font-bold text-abyss-950 hover:bg-atlantic-400 disabled:opacity-60">{busy ? "Joining..." : "Join party"}</button>
            {error ? <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</p> : null}
            {needAccount ? <p className="text-center text-sm text-white/60">This is a public party. <Link to="/settings" className="font-semibold text-atlantic-300 hover:text-atlantic-200">Sign in</Link> to join.</p> : null}
          </div>
        )}
      </div>
    </div>
  );
}
