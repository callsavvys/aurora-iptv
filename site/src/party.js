/* Watch parties, as atlantic.bz has them: a six-character code, private (the
   code is enough) or public (listed on Watch Parties, needs an account, may
   have a room name and a password), members, chat, the host's play, pause and
   seek followed by everyone, and Remove for the host.

   Atlantic runs a party server; Aurora runs on the account server's realtime
   channels, with the host's browser as the room:
   - aurora-wp-<CODE>: presence is who is here ({name, host}); broadcasts are
     hello (a guest asks in, with the password), welcome or denied (the host
     answers), state ({playing, time, rate, at}, every 2 s and on every change),
     media (the host moved to another title or episode), settings, chat, kick
     and closed;
   - aurora-wp-lobby: each public room's presence is its card on Watch Parties.
   Each person plays the title from their own line (the same TMDB title and
   episode), so a party needs no stream of its own. */
import { useSyncExternalStore } from "react";
import { start as startAccount, signedIn, displayName } from "./account.js";

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const NAME_KEY = "aurora-party-name";
const OVERLAY_KEY = "aurora-party-overlay";
const RESUME_KEY = "aurora-party-resume";
const TICK = 2000, SEEK_DRIFT = 2.5, EASE_DRIFT = 0.4, ANSWER_WAIT = 6000;

export class PartyError extends Error { constructor(code, message) { super(message); this.code = code; } }
export const cleanCode = (s) => String(s || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6);
const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const uid = () => Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 12);
const makeCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => LETTERS[b % LETTERS.length]).join("");
export function savedName() { try { return clip(localStorage.getItem(NAME_KEY), 24); } catch { return ""; } }
const keepName = (n) => { try { localStorage.setItem(NAME_KEY, n); } catch { /* private mode */ } };
const readOverlay = () => { try { return localStorage.getItem(OVERLAY_KEY) !== "0"; } catch { return true; } };

const IDLE = { phase: "idle", code: null, role: null, meId: null, info: { public: false, locked: false, name: "" }, media: null, members: [], hostAway: false, chat: [], unread: 0, lastChatAt: 0, drift: 0, pendingNav: false };
let state = { ...IDLE, notice: null, overlay: readOverlay(), playerOpen: false };
const subs = new Set();
const set = (patch) => { state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) }; subs.forEach((fn) => fn()); };
const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export const getParty = () => state;
export function useParty(pick = (s) => s) { return pick(useSyncExternalStore(subscribe, getParty)); }

/* the room, while you are in one */
let room = null;   // {channel, lobby, password, me, name, playing, time, rate, at, video, last, timers}
const client = () => startAccount();

const membersOf = (channel) => Object.entries(channel.presenceState() || {}).map(([id, metas]) => ({ id, name: metas[0]?.name || "Guest", host: !!metas[0]?.host }))
  .sort((a, b) => (b.host - a.host) || a.name.localeCompare(b.name));

function remember() {
  try {
    if (!room || !state.code) sessionStorage.removeItem(RESUME_KEY);
    else sessionStorage.setItem(RESUME_KEY, JSON.stringify({ code: state.code, role: state.role, me: room.me, name: room.name, password: room.password || null, info: state.info, media: state.media, time: room.time, playing: room.playing }));
  } catch { /* private mode */ }
}

async function openChannel(code, me, name, host) {
  const sb = await client();
  if (!sb) throw new PartyError("unavailable", "Watch parties are not available here.");
  const channel = sb.channel(`aurora-wp-${code}`, { config: { broadcast: { self: false }, presence: { key: me } } });
  channel.on("presence", { event: "sync" }, () => {
    const members = membersOf(channel);
    set({ members, hostAway: state.role === "viewer" && state.phase === "in" && !members.some((m) => m.host) });
    if (state.role === "host") lobbyTrack();
  });
  channel.on("broadcast", { event: "chat" }, ({ payload }) => gotChat(payload));
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new PartyError("closed", "Lost connection to the watch party server.")), 10000);
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") { clearTimeout(t); channel.track({ name, host, at: Date.now() }).then(resolve, resolve); }
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { clearTimeout(t); reject(new PartyError("closed", "Lost connection to the watch party server.")); }
      });
    });
  } catch (e) { sb.removeChannel(channel); throw e; }
  return channel;
}

const send = (event, payload) => room?.channel?.send({ type: "broadcast", event, payload: state.role === "host" || event === "hello" || event === "chat" ? { ...payload, from: room.me } : payload }).catch(() => {});
/* a guest acts only on what the host sent (the host named itself in its welcome) */
const fromHost = (payload) => !!room?.hostId && payload?.from === room.hostId;

function gotChat(msg) {
  if (!msg || typeof msg.text !== "string") return;
  if (msg.to && msg.to === state.meId) return;   // your own "joined", already in the welcome
  const line = { id: clip(msg.id, 24) || uid(), from: clip(msg.from, 24), name: clip(msg.name, 24) || "Guest", host: !!msg.host, text: clip(msg.text, 300), sys: !!msg.sys };
  set((s) => ({ chat: [...s.chat, line].slice(-120), lastChatAt: Date.now(), unread: line.from === s.meId ? s.unread : s.unread + 1 }));
}

/* ---- hosting ---- */
function hostPayload() {
  const v = room?.video;
  if (v) { room.playing = !v.paused; room.time = v.currentTime; room.rate = v.playbackRate; }
  return { playing: !!room?.playing, time: Number(room?.time || 0), rate: Number(room?.rate || 1), at: Date.now() };
}
function lobbyCard() {
  const host = state.members.find((m) => m.host);
  return { code: state.code, name: state.info.name, locked: state.info.locked, host: host?.name || room?.name || "", media: state.media, playing: !!room?.playing, count: state.members.length, members: state.members.map((m) => m.name) };
}
/* The lobby: one channel for this page, shared by a public room's host (who
   puts its card there) and Watch Parties (which reads the cards); the server
   keeps one channel per name, so two would be the same one. */
const lobby = { channel: null, ready: null, users: 0, watchers: new Set(), key: uid() };
const lobbyRooms = () => Object.values(lobby.channel?.presenceState() || {}).map((metas) => metas[0]).filter((x) => x?.code && x.media);
async function lobbyOpen() {
  lobby.users += 1;
  if (!lobby.ready) {
    lobby.ready = (async () => {
      const sb = await client();
      if (!sb) throw new Error("unavailable");
      const ch = sb.channel("aurora-wp-lobby", { config: { presence: { key: lobby.key } } });
      ch.on("presence", { event: "sync" }, () => { const r = lobbyRooms(); lobby.watchers.forEach((fn) => fn(r)); });
      await new Promise((resolve, reject) => ch.subscribe((st) => { if (st === "SUBSCRIBED") resolve(); else if (st === "CHANNEL_ERROR" || st === "TIMED_OUT") reject(new Error(st)); }));
      lobby.channel = ch;
      return ch;
    })().catch((e) => { lobby.ready = null; throw e; });
  }
  return lobby.ready;
}
async function lobbyClose() {
  lobby.users = Math.max(0, lobby.users - 1);
  if (lobby.users || !lobby.channel) return;
  const ch = lobby.channel; lobby.channel = null; lobby.ready = null;
  (await client())?.removeChannel(ch);
}
async function lobbyTrack() {
  if (!room || state.role !== "host") return;
  if (!state.info.public) { if (room.lobby) { room.lobby = false; lobby.channel?.untrack().catch(() => {}); lobbyClose(); } return; }
  try {
    if (!room.lobby) { room.lobby = true; await lobbyOpen(); }
    lobby.channel?.track(lobbyCard()).catch(() => {});
  } catch { if (room) room.lobby = false; }
}

function hostListen(channel) {
  channel.on("broadcast", { event: "hello" }, ({ payload }) => {
    const to = clip(payload?.id, 24);
    if (!to) return;
    if (state.info.public && !payload.account) return send("denied", { to, code: "auth_required", message: "Sign in to join public parties." });
    if (state.info.locked && String(payload.password || "") !== room.password) return send("denied", { to, code: "bad_password", message: payload.password ? "That password is not right." : "This party has a password." });
    send("welcome", { to, info: state.info, media: state.media, state: hostPayload(), chat: [...state.chat.slice(-40), { id: uid(), sys: true, text: `${clip(payload.name, 24) || "Guest"} joined` }] });
    const line = { id: uid(), sys: true, text: `${clip(payload.name, 24) || "Guest"} joined` };
    gotChat(line); send("chat", { ...line, to });
  });
}

export async function host({ public: pub = false, password = "", roomName = "", media, playing = false, time = 0, rate = 1, guestName, code: reuse }) {
  if (state.phase !== "idle") await leave();
  if (pub && !signedIn()) throw new PartyError("auth_required", "Sign in to host a public party.");
  const name = clip(guestName || displayName() || savedName() || "Host", 24);
  if (guestName) keepName(name);
  const me = room?.me || uid();
  set({ phase: "joining", notice: null });
  const code = reuse || makeCode();
  try {
    const channel = await openChannel(code, me, name, true);
    room = { channel, lobby: null, password: pub ? clip(password, 64) : "", me, name, playing, time, rate, video: null, last: 0 };
    hostListen(channel);
    set({ ...IDLE, phase: "in", code, role: "host", meId: me, info: { public: pub, locked: pub && !!room.password, name: pub ? clip(roomName, 40) : "" }, media, members: membersOf(channel) });
    room.beat = setInterval(() => { if (state.role === "host") { send("state", hostPayload()); remember(); } }, TICK);
    lobbyTrack(); remember();
    return code;
  } catch (e) { room = null; set({ ...IDLE }); throw e; }
}

export function updateSettings({ public: pub, roomName, password }) {
  if (state.role !== "host") return;
  if (pub && !signedIn()) return;
  room.password = pub ? clip(password, 64) : "";
  set({ info: { public: !!pub, locked: !!pub && !!room.password, name: pub ? clip(roomName, 40) : "" } });
  send("settings", state.info); lobbyTrack(); remember();
}
export function kick(id) { if (state.role === "host") send("kick", { target: id }); }

/* the host moved to another title or episode: everyone follows */
export function hostMedia(media) {
  if (state.role !== "host" || !media) return;
  const same = JSON.stringify(media) === JSON.stringify(state.media);
  if (same) return;
  set({ media }); room.time = 0; room.playing = true;
  send("media", { media, state: hostPayload() }); lobbyTrack(); remember();
}

/* ---- joining ---- */
export async function join(rawCode, password = null, guestName) {
  const code = cleanCode(rawCode);
  if (code.length !== 6) throw new PartyError("bad_code", "Codes are 6 letters or numbers.");
  if (state.phase !== "idle") await leave();
  const name = clip(guestName || displayName() || savedName() || "Guest", 24);
  if (guestName) keepName(name);
  const me = uid();
  set({ phase: "joining", notice: null });
  let channel;
  try {
    channel = await openChannel(code, me, name, false);
    const answer = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new PartyError("not_found", "No party has that code, or its host is offline.")), ANSWER_WAIT);
      channel.on("broadcast", { event: "welcome" }, ({ payload }) => { if (payload?.to === me) { clearTimeout(t); resolve(payload); } });
      channel.on("broadcast", { event: "denied" }, ({ payload }) => { if (payload?.to === me) { clearTimeout(t); reject(new PartyError(payload.code || "denied", payload.message || "Couldn't join that party.")); } });
      channel.send({ type: "broadcast", event: "hello", payload: { id: me, name, password, account: signedIn() } });
    });
    room = { channel, lobby: null, password, me, name, video: null, last: 0, hostId: answer.from, sync: answer.state && { ...answer.state, got: Date.now() } };
    viewerListen(channel);
    set({ ...IDLE, phase: "in", code, role: "viewer", meId: me, info: answer.info || IDLE.info, media: answer.media, members: membersOf(channel), chat: Array.isArray(answer.chat) ? answer.chat : [], pendingNav: true });
    remember();
    return code;
  } catch (e) {
    if (channel) (await client())?.removeChannel(channel);
    room = null; set({ ...IDLE });
    throw e;
  }
}

function viewerListen(channel) {
  channel.on("broadcast", { event: "state" }, ({ payload }) => { if (!fromHost(payload)) return; room.sync = { ...payload, got: Date.now() }; follow(); });
  channel.on("broadcast", { event: "media" }, ({ payload }) => { if (!fromHost(payload) || !payload.media) return; room.sync = payload.state && { ...payload.state, got: Date.now() }; set({ media: payload.media, pendingNav: true }); remember(); });
  channel.on("broadcast", { event: "settings" }, ({ payload }) => { if (fromHost(payload)) set({ info: { public: !!payload.public, locked: !!payload.locked, name: clip(payload.name, 40) } }); });
  channel.on("broadcast", { event: "kick" }, ({ payload }) => { if (fromHost(payload) && payload.target === state.meId) end("You were removed from the party."); });
  channel.on("broadcast", { event: "closed" }, ({ payload }) => { if (fromHost(payload)) end("The host ended the party."); });
}

/* the guest's player keeps to the host's clock: a big gap seeks, a small one eases */
function follow() {
  const v = room?.video, m = room?.sync;
  if (state.role !== "viewer" || !v || !m) return;
  // time since the message arrived (the two devices' clocks may disagree, so not since the host sent it)
  const travelled = m.playing ? (Date.now() - Number(m.got || Date.now())) / 1000 * (m.rate || 1) : 0;
  const target = Number(m.time || 0) + travelled;
  const drift = v.currentTime - target;
  if (!m.playing && !v.paused) v.pause();
  if (m.playing && v.paused) v.play().catch(() => {});
  const off = Math.abs(drift);
  if (off > SEEK_DRIFT && v.readyState >= 1 && !v.seeking) { v.currentTime = target; v.playbackRate = m.rate || 1; }
  else if (off > EASE_DRIFT && off <= SEEK_DRIFT) v.playbackRate = (m.rate || 1) * (drift > 0 ? 0.95 : 1.05);
  else if (off <= EASE_DRIFT) v.playbackRate = m.rate || 1;
  if (Math.abs(drift - state.drift) > 0.2) set({ drift });
}

/* The player hands over its video while it plays the party's title. Returns
   the function to call when it closes. */
const sameMedia = (a, b) => !!a && !!b && Number(a.tmdb) === Number(b.tmdb) && a.type === b.type && Number(a.season || 0) === Number(b.season || 0) && Number(a.episode || 0) === Number(b.episode || 0);
export function attachPlayer(video, media) {
  if (!room || !video) return () => {};
  // a host's player is the party's (moving to another title takes the room along); a guest's only while it plays the party's title
  if (state.role === "host" ? !media : !sameMedia(media, state.media)) return () => {};
  room.video = video;
  set({ playerOpen: true });
  const onChange = () => { if (state.role === "host") { const p = hostPayload(); send("state", p); remember(); } };
  const events = ["play", "pause", "seeked", "ratechange"];
  if (state.role === "host") events.forEach((e) => video.addEventListener(e, onChange));
  const loaded = () => follow();
  video.addEventListener("loadedmetadata", loaded);
  if (state.role === "viewer") setTimeout(follow, 300);
  return () => {
    events.forEach((e) => video.removeEventListener(e, onChange));
    video.removeEventListener("loadedmetadata", loaded);
    if (room?.video === video) { if (state.role === "host") hostPayload(); room.video = null; }
    if (state.role === "host") send("state", hostPayload());
    set({ playerOpen: false });
  };
}
export function playerClosed() { set({ playerOpen: false }); }

/* ---- chat, overlay, leaving ---- */
export function sendChat(text) {
  const t = clip(text, 300);
  if (!t || !room) return;
  const msg = { id: uid(), from: state.meId, name: room.name, host: state.role === "host", text: t };
  send("chat", msg); gotChat(msg);
}
export const markRead = () => set({ unread: 0 });
export function setOverlay(on) { try { localStorage.setItem(OVERLAY_KEY, on ? "1" : "0"); } catch { /* private mode */ } set({ overlay: on }); }
export const clearNotice = () => set({ notice: null });
export const consumeNav = () => set({ pendingNav: false });

async function end(notice) {
  const r = room; room = null;
  if (r) {
    clearInterval(r.beat);
    if (r.video) r.video.playbackRate = 1;
    const sb = await client();
    if (r.lobby) { lobby.channel?.untrack().catch(() => {}); lobbyClose(); }
    if (r.channel) sb?.removeChannel(r.channel);
  }
  set({ ...IDLE, notice: notice || null });
  remember();
}
export async function leave() {
  if (state.role === "host") await send("closed", { reason: "host_left" });
  await end(null);
}

/* after a reload: back into the party you were in (a host opens the room again) */
export async function resume() {
  if (state.phase !== "idle") return;
  await client();   // the account first: a public room's host must be signed in
  let r = null;
  try { r = JSON.parse(sessionStorage.getItem(RESUME_KEY) || "null"); } catch { /* none */ }
  if (!r?.code) return;
  try {
    if (r.role === "host") { room = { me: r.me }; await host({ public: r.info?.public, password: r.password || "", roomName: r.info?.name, media: r.media, playing: r.playing, time: r.time, code: r.code, guestName: r.name }); }
    else await join(r.code, r.password, r.name);
  } catch { set({ ...IDLE, notice: "Couldn't reconnect to your party." }); try { sessionStorage.removeItem(RESUME_KEY); } catch { /* none */ } }
}

/* ---- Watch Parties: the public rooms ---- */
export function watchLobby(onRooms) {
  let gone = false;
  const fn = (r) => { if (!gone) onRooms(r); };
  lobby.watchers.add(fn);
  lobbyOpen().then(() => fn(lobbyRooms())).catch(() => { fn(null); lobbyClose(); gone = true; });
  return () => { if (gone) { lobby.watchers.delete(fn); return; } gone = true; lobby.watchers.delete(fn); lobbyClose(); };
}

/* where a party's title plays on this site */
export function mediaPath(m) {
  if (!m?.tmdb) return "/parties";
  return m.type === "tv" ? `/title/tv/${m.tmdb}?play=1&s=${m.season || 1}&e=${m.episode || 1}` : `/title/movie/${m.tmdb}?play=1`;
}
export const mediaLabel = (m) => (m?.type === "tv" ? `S${m.season} E${m.episode}` : "Movie");
