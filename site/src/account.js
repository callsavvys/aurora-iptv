/* Your Aurora account and watch parties, on the site.

   The same accounts, tables, RPCs and realtime channels as the apps
   (web/js/together.js), so a party can have one person on the TV and the
   other here:
   - accounts: email and password (Supabase auth), kept in this browser;
   - you: claim_profile gives your name and friend code; my_friends names
     the host of a friend's party;
   - a party: a parties row with a six-character code; join_party_by_code
     adds you; on aurora-party-<id> the host broadcasts
     {position, paused, at, title} every 2 s ("state") and "ended" at the end;
     each person plays their own copy, found by fingerprint (sync-core.js).
   The address and the key are the account server's public ones, read from
   the apps at build time (vite.config.js). */
import { createClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import "../../web/js/sync-core.js";

const Sync = globalThis.AuroraSync;
const PARTY_TICK = 2000;
const PARTY_SEEK_DRIFT = 2.5;
const PARTY_EASE_DRIFT = 0.4;
const OFFSETS = "aurora-party-offsets";
const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

let client = null, user = null, started = null;
const listeners = new Set();
const changed = () => { for (const fn of listeners) { try { fn(); } catch { /* a screen went away */ } } };
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export const social = { profile: null, friends: [], error: "" };
export const party = { id: null, code: "", hosting: false, host: "", title: "", offset: 0, drift: 0, here: [], channel: null, last: 0, video: null };

const friendly = (error) => (/fetch|network|load failed/i.test(error?.message || "") ? "Could not reach the account server" : error?.message || "That did not work");
export const prints = (it) => Sync.fingerprints(it.name, it.rawYear ?? it.year);

/* the screens re-render when the account or the party changes */
export function useAccount() {
  const [, tick] = useState(0);
  useEffect(() => { start(); return onChange(() => tick((n) => n + 1)); }, []);
  return { user, profile: social.profile, party };
}

export function start() {
  if (started) return started;
  return (started = (async () => {
    if (!__SUPABASE_URL__ || !__SUPABASE_KEY__) return null;
    client = createClient(__SUPABASE_URL__, __SUPABASE_KEY__, { auth: { storageKey: "aurora-auth", persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
    client.auth.onAuthStateChange((_event, session) => {
      const next = session?.user || null;
      if (next?.id !== user?.id) { user = next; if (user) afterSignIn(); else { social.profile = null; social.friends = []; } changed(); }
    });
    const { data } = await client.auth.getSession();
    user = data.session?.user || null;
    if (user) await afterSignIn();
    changed();
    return client;
  })());
}

export const signedIn = () => !!user;
export const displayName = () => social.profile?.display_name || (user?.email || "").split("@")[0] || "";

export async function signIn(address, password, { create = false } = {}) {
  if (!(await start())) throw new Error("Accounts are not available here");
  if (password.length < 8) throw new Error("Use at least 8 characters");
  const { data, error } = create ? await client.auth.signUp({ email: address, password }) : await client.auth.signInWithPassword({ email: address, password });
  if (error) throw new Error(friendly(error));
  if (create && !data.session) return { confirm: true };
  user = data.user;
  await afterSignIn();
  changed();
  return { confirm: false };
}

export async function signOut() {
  await leaveParty();
  await client?.auth.signOut({ scope: "local" }).catch(() => {});
  user = null; social.profile = null; social.friends = [];
  changed();
}

async function afterSignIn() {
  const { data, error } = await client.rpc("claim_profile", { name: social.profile?.display_name || user.email?.split("@")[0] || "Someone" });
  if (error) social.error = friendly(error); else social.profile = Array.isArray(data) ? data[0] : data;
  const { data: friends } = await client.rpc("my_friends");
  social.friends = friends || [];
  changed();
}

const hostName = (id) => social.friends.find((f) => f.user_id === id)?.display_name || "the host";
const offsets = () => { try { return JSON.parse(localStorage.getItem(OFFSETS)) || {}; } catch { return {}; } };
const makeCode = () => Array.from({ length: 6 }, () => CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)]).join("");

/* Host: start a party for a title on your line; returns its code. The film
   already playing becomes the clock. */
export async function startParty(it) {
  if (!user || !it) return { error: "Sign in first, in Settings → Account" };
  const [print] = prints(it);
  const row = { host: user.id, fingerprint: print || "", kind: it.kind === "series" ? "series" : "movie", title: it.name };
  let data = null, error = null, code = "";
  for (let attempt = 0; attempt < 3 && !data; attempt += 1) {
    code = makeCode();
    ({ data, error } = await client.from("parties").insert({ ...row, code }).select("id").single());
    if (error && !/duplicate|unique/i.test(error.message || "")) break;   // a taken code tries another
  }
  if (!data) return { error: friendly(error) };
  await client.from("party_members").insert([{ party_id: data.id, user_id: user.id, joined_at: new Date().toISOString() }]);
  Object.assign(party, { code, hosting: true, host: displayName(), title: it.name, offset: 0 });
  await openChannel(data.id);
  return { code };
}

/* Guest: join by the code the host reads out, and find your own copy among
   the line's titles. Returns the title to play, or why it cannot be. */
export async function joinByCode(code, titles) {
  if (!user) return { error: "Sign in first, in Settings → Account" };
  const clean = String(code || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (clean.length !== 6) return { error: "Party codes are six characters." };
  const { data, error } = await client.rpc("join_party_by_code", { party_code: clean });
  if (error) return { error: friendly(error) };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { error: "No open party has that code." };
  const mine = titles.find((t) => prints(t)[0] === row.fingerprint) || titles.find((t) => prints(t).includes(row.fingerprint));
  if (!mine) return { error: `Your line does not seem to have ${row.title}.` };
  Object.assign(party, { code: clean, hosting: false, host: hostName(row.host), title: row.title, offset: Number(offsets()[row.host] || 0) });
  await openChannel(row.id);
  return { item: mine };
}

/* the open parties your friends are hosting: who, what, and the code */
export async function friendsWatching() {
  if (!(await start()) || !user) return [];
  const { data, error } = await client.rpc("friends_watching");
  return error ? [] : data || [];
}

async function openChannel(id) {
  await closeChannel();
  party.id = id;
  const channel = client.channel(`aurora-party-${id}`, { config: { broadcast: { self: false }, presence: { key: user.id } } });
  channel.on("broadcast", { event: "state" }, ({ payload }) => follow(payload));
  channel.on("broadcast", { event: "ended" }, () => { social.error = "The host ended the party"; leaveParty(); });
  channel.on("presence", { event: "sync" }, () => { party.here = Object.keys(channel.presenceState() || {}); changed(); });
  await channel.subscribe((status) => { if (status === "SUBSCRIBED") channel.track({ at: Date.now(), name: displayName() }); });
  party.channel = channel;
  changed();
}

async function closeChannel() {
  if (!party.channel) return;
  try { await client.removeChannel(party.channel); } catch { /* going anyway */ }
  party.channel = null;
}

/* The player hands over its video: the host's clock goes out, the guest's
   follows. Returns a function to call when the player closes. */
export function attachPlayer(video) {
  if (!party.id || !video) return () => {};
  party.video = video;
  const send = () => broadcast(true);
  const timer = setInterval(() => broadcast(false), 500);
  for (const e of ["play", "pause", "seeked"]) video.addEventListener(e, send);
  return () => {
    clearInterval(timer);
    for (const e of ["play", "pause", "seeked"]) video.removeEventListener(e, send);
    if (party.video === video) party.video = null;
  };
}

function broadcast(force) {
  const video = party.video;
  if (!party.channel || !party.hosting || !video) return;
  if (!force && Date.now() - party.last < PARTY_TICK) return;
  party.last = Date.now();
  party.channel.send({ type: "broadcast", event: "state", payload: { position: video.currentTime, paused: video.paused, at: Date.now(), title: party.title } }).catch(() => {});
}

function follow(message) {
  const video = party.video;
  if (party.hosting || !message || !video) return;
  const travelled = message.paused ? 0 : (Date.now() - Number(message.at || Date.now())) / 1000;
  const target = Number(message.position || 0) + travelled + party.offset;
  party.drift = video.currentTime - target;
  if (message.paused && !video.paused) video.pause();
  if (!message.paused && video.paused) video.play().catch(() => {});
  const off = Math.abs(party.drift);
  // seek only once the film has loaded: an IPTV film can take longer to start than the host's 2 s tick
  if (off > PARTY_SEEK_DRIFT && (video.readyState < 1 || video.seeking)) { changed(); return; }
  if (off > PARTY_SEEK_DRIFT) { video.currentTime = target; video.playbackRate = 1; }
  else if (off > PARTY_EASE_DRIFT) video.playbackRate = party.drift > 0 ? 0.95 : 1.05;
  else video.playbackRate = 1;
  changed();
}

export async function leaveParty() {
  const id = party.id;
  if (!id) return;
  if (party.hosting) {
    await client.from("parties").update({ ended_at: new Date().toISOString() }).eq("id", id).then(() => {}, () => {});
    party.channel?.send({ type: "broadcast", event: "ended", payload: {} }).catch(() => {});
  }
  await closeChannel();
  if (party.video) party.video.playbackRate = 1;
  Object.assign(party, { id: null, code: "", hosting: false, host: "", title: "", offset: 0, drift: 0, here: [], last: 0, video: null });
  changed();
}

/* one line for the player: the code, who, and how far apart */
export function partyLine() {
  if (!party.id) return "";
  const together = party.here.length > 1;
  const drift = Math.abs(party.drift) < 1 ? "in step" : `${Math.abs(party.drift).toFixed(1)}s ${party.drift > 0 ? "ahead" : "behind"}`;
  if (party.hosting) return `Party code ${party.code} · ${together ? `${party.here.length} watching` : "waiting for someone to join…"}`;
  return `Following ${party.host} · ${together ? drift : "waiting for the host…"}`;
}
