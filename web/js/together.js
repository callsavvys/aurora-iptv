/* Your Aurora account, friends, and watching together.

   The same accounts, friends and parties as the old app (app/renderer.js),
   over the same Supabase tables, RPCs and realtime channels, so a party can
   have one person on the Mac app and the other on this web app:

   - accounts: email and password (supabase auth); the session is kept in
     this browser under "aurora-auth";
   - you: claim_profile gives your name and friend code;
   - friends: my_friends, friend_by_code, the friends table; a request or an
     answer is nudged on the other person's channel, aurora-user-<id>;
   - the library filter: a Bloom filter of the titles on your line
     (library_filter), so a friend can see what you both have without either
     library leaving its device;
   - a party: a parties row and two party_members rows; the invitation goes on
     the friend's channel ("invite"); on aurora-party-<id> the host broadcasts
     {position, paused, at, title} every 2 s ("state") and "ended" at the end;
     each person plays their own copy, found by fingerprint (sync-core.js).

   This app does not open the sealed vault (sources stay on the device they
   were entered on), so signing in here never touches anyone's sources. */
const Sync = globalThis.AuroraSync;
const PARTY_TICK = 2000;
const PARTY_SEEK_DRIFT = 2.5;   // past this, catch up by seeking rather than by speed
const PARTY_EASE_DRIFT = 0.4;   // under this, leave it alone
const OFFSETS = "aurora-party-offsets";

let client = null, user = null;
const listeners = new Set();
const changed = () => { for (const fn of listeners) { try { fn(); } catch { /* a screen went away */ } } };
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export const social = { profile: null, friends: [], error: "", notice: "", busy: false };
export const party = { id: null, hosting: false, friend: null, title: "", offset: 0, drift: 0, here: [], channel: null, last: 0, video: null };

const friendly = (error) => (/fetch|network|load failed/i.test(error?.message || "") ? "Could not reach the account server" : error?.message || "That did not work");

// ---------- the client ----------

function loadLibrary() {
  if (window.supabase?.createClient) return Promise.resolve(true);
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "vendor/supabase.js";
    s.onload = () => resolve(!!window.supabase?.createClient);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}

export async function start() {
  if (client) return client;
  const cfg = window.AURORA_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabaseKey || !(await loadLibrary())) return null;
  client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { storageKey: "aurora-auth", persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  client.auth.onAuthStateChange((event, session) => {
    const next = session?.user || null;
    if (next?.id !== user?.id) { user = next; if (user) afterSignIn(); else { social.profile = null; social.friends = []; } changed(); }
  });
  const { data } = await client.auth.getSession();
  user = data.session?.user || null;
  if (user) await afterSignIn();
  return client;
}

export const signedIn = () => !!user;
export const email = () => user?.email || "";

export async function signIn(address, password, { create = false } = {}) {
  if (!(await start())) throw new Error("Accounts are not available here");
  if (password.length < 8) throw new Error("Use at least 8 characters");
  const auth = client.auth;
  const { data, error } = create ? await auth.signUp({ email: address, password }) : await auth.signInWithPassword({ email: address, password });
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
  await claimProfile();
  await loadFriends();
  listen();
  changed();
}

// ---------- you, and friends ----------

export async function claimProfile(name = "") {
  if (!user) return null;
  const { data, error } = await client.rpc("claim_profile", { name: name || social.profile?.display_name || user.email?.split("@")[0] || "Someone" });
  if (error) { social.error = friendly(error); return null; }
  social.profile = Array.isArray(data) ? data[0] : data;
  return social.profile;
}

export async function loadFriends() {
  if (!user) return;
  const { data, error } = await client.rpc("my_friends");
  if (error) { social.error = friendly(error); return; }
  social.friends = data || [];
}

function nudge(userId, what) {
  if (!userId) return;
  client.channel(`aurora-user-${userId}`).send({ type: "broadcast", event: what, payload: { from: user?.id } }).catch(() => {});
}

export async function addFriendByCode(code) {
  social.error = ""; social.notice = "";
  const clean = String(code || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (clean.length !== 8) { social.error = "A friend code is eight characters."; return changed(); }
  if (clean === social.profile?.friend_code) { social.error = "That is your own code."; return changed(); }
  const { data, error } = await client.rpc("friend_by_code", { code: clean });
  if (error) { social.error = friendly(error); return changed(); }
  const found = Array.isArray(data) ? data[0] : data;
  if (!found) { social.error = "No one has that code."; return changed(); }
  const { error: asked } = await client.from("friends").insert({ requester: user.id, addressee: found.user_id, status: "pending" });
  if (asked && !/duplicate|unique/i.test(asked.message || "")) { social.error = friendly(asked); return changed(); }
  social.notice = `Asked ${found.display_name} to be friends.`;
  nudge(found.user_id, "friends");
  await loadFriends();
  changed();
}

export async function acceptFriend(userId) {
  await client.from("friends").update({ status: "accepted" }).eq("requester", userId).eq("addressee", user.id);
  nudge(userId, "friends");
  await loadFriends(); changed();
}

export async function removeFriend(userId) {
  await client.from("friends").delete().or(`and(requester.eq.${user.id},addressee.eq.${userId}),and(requester.eq.${userId},addressee.eq.${user.id})`);
  await loadFriends(); changed();
}

export const accepted = () => social.friends.filter((f) => f.status === "accepted");

// ---------- the library filter ----------

const prints = (item) => Sync.fingerprints(item.raw || item.title, item.rawYear ?? item.year);
const toBase64 = (bytes) => { let s = ""; for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]); return btoa(s); };
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/* What this device can play, for friends' "what we both have". Published when
   the line changes, not on a timer. */
export async function publishLibrary(titles, sourceId = "") {
  if (!user || !titles?.length) return;
  const { bits, count } = Sync.libraryFilter(titles.map((t) => ({ ...t, type: t.kind })), prints);
  const stamp = `${count}:${sourceId}`;
  if (localStorage.getItem("aurora-filter-stamp") === stamp) return;
  const { error } = await client.from("library_filter").upsert({ user_id: user.id, bits: toBase64(bits), items: count, hashes: Sync.FILTER_HASHES, updated_at: new Date().toISOString() });
  if (!error) try { localStorage.setItem("aurora-filter-stamp", stamp); } catch { /* private mode */ }
}

/* The films and series both of you have: yours, tested against their filter. */
export async function sharedWith(friendId, titles, limit = 120) {
  const { data } = await client.from("library_filter").select("bits, items").eq("user_id", friendId).maybeSingle();
  if (!data?.bits) return null;
  const bits = fromBase64(data.bits), out = [];
  for (const t of titles) {
    if (prints(t).some((p) => Sync.filterHas(bits, p))) out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

// ---------- invitations ----------

let invite = null;
export const pendingInvite = () => invite;
export const dismissInvite = () => { invite = null; changed(); };

function listen() {
  if (!user || listen.on === user.id) return;
  listen.on = user.id;
  client.channel(`aurora-user-${user.id}`)
    .on("broadcast", { event: "invite" }, ({ payload }) => { if (payload?.party && payload.party !== party.id) { invite = payload; changed(); } })
    .on("broadcast", { event: "friends" }, () => { loadFriends().then(changed).catch(() => {}); })
    .subscribe();
  // an invitation sent while this app was closed, from the last six hours
  client.from("party_members").select("party_id, parties!inner(id, host, title, fingerprint, ended_at, created_at)")
    .is("joined_at", null).is("parties.ended_at", null)
    .then(({ data }) => {
      const row = (data || []).find((r) => Date.now() - Date.parse(r.parties.created_at) < 6 * 3600e3);
      if (row && !invite) {
        const host = social.friends.find((f) => f.user_id === row.parties.host);
        invite = { party: row.party_id, from: host?.display_name || "A friend", title: row.parties.title, fingerprint: row.parties.fingerprint };
        changed();
      }
    }).catch(() => {});
}

// ---------- the party ----------

const member = (id) => social.friends.find((f) => f.user_id === id) || null;
const offsets = () => { try { return JSON.parse(localStorage.getItem(OFFSETS)) || {}; } catch { return {}; } };

/* Host: start a party for `item` with a friend; the caller then plays it. */
export async function startParty(item, friendId) {
  if (!user || !item) return false;
  const [print] = prints(item);
  const { data, error } = await client.from("parties")
    .insert({ host: user.id, fingerprint: print || "", kind: item.kind === "series" ? "series" : "movie", title: item.raw || item.title })
    .select("id").single();
  if (error) { social.error = friendly(error); changed(); return false; }
  await client.from("party_members").insert([
    { party_id: data.id, user_id: user.id, joined_at: new Date().toISOString() },
    { party_id: data.id, user_id: friendId, joined_at: null },
  ]);
  Object.assign(party, { hosting: true, friend: member(friendId), title: item.raw || item.title, offset: 0 });
  await openChannel(data.id);
  client.channel(`aurora-user-${friendId}`).send({
    type: "broadcast", event: "invite",
    payload: { party: data.id, from: social.profile?.display_name || "A friend", title: item.raw || item.title, fingerprint: print },
  }).catch(() => {});
  return true;
}

/* Guest: join, and find your own copy among `titles`. Returns the item to
   play, or a reason it cannot be played. */
export async function joinParty(partyId, titles) {
  const { data: row } = await client.from("parties").select("id, host, fingerprint, title, kind, ended_at").eq("id", partyId).maybeSingle();
  invite = null;
  if (!row || row.ended_at) { changed(); return { error: "That party has ended" }; }
  const mine = titles.find((t) => prints(t)[0] === row.fingerprint) || titles.find((t) => prints(t).includes(row.fingerprint));
  if (!mine) { changed(); return { error: `Your line does not seem to have ${row.title}` }; }
  await client.from("party_members").update({ joined_at: new Date().toISOString() }).eq("party_id", partyId).eq("user_id", user.id);
  Object.assign(party, { hosting: false, friend: member(row.host), title: row.title, offset: Number(offsets()[row.host] || 0) });
  await openChannel(partyId);
  return { item: mine };
}

async function openChannel(id) {
  await closeChannel();
  party.id = id;
  const channel = client.channel(`aurora-party-${id}`, { config: { broadcast: { self: false }, presence: { key: user.id } } });
  channel.on("broadcast", { event: "state" }, ({ payload }) => follow(payload));
  channel.on("broadcast", { event: "ended" }, () => { social.notice = "Your friend ended the party"; leaveParty(); });
  channel.on("presence", { event: "sync" }, () => { party.here = Object.keys(channel.presenceState() || {}); changed(); });
  await channel.subscribe((status) => { if (status === "SUBSCRIBED") channel.track({ at: Date.now(), name: social.profile?.display_name || "" }); });
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
  if (!party.id) return () => {};
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

/* The host is the clock: position plus the time it was sent, because the
   message takes however long it takes to arrive. */
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
  /* A seek while the film is still loading, or while the last seek settles,
     restarts the download; the host speaks every 2 s and an IPTV film can
     take longer than that to start, so seeking on every message left the
     guest loading forever (seen on an iPhone). Seek once it has loaded. */
  if (off > PARTY_SEEK_DRIFT && (video.readyState < 1 || video.seeking)) { changed(); return; }
  if (off > PARTY_SEEK_DRIFT) { video.currentTime = target; video.playbackRate = 1; }
  else if (off > PARTY_EASE_DRIFT) video.playbackRate = party.drift > 0 ? 0.95 : 1.05;
  else video.playbackRate = 1;
  changed();
}

/* Two providers' copies of one film do not start at the same moment; this is
   remembered per friend, because the difference belongs to their copy. */
export function nudgeParty(seconds) {
  party.offset = Math.round((party.offset + seconds) * 10) / 10;
  if (party.friend) { const o = offsets(); o[party.friend.user_id] = party.offset; try { localStorage.setItem(OFFSETS, JSON.stringify(o)); } catch { /* fine */ } }
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
  Object.assign(party, { id: null, hosting: false, friend: null, title: "", offset: 0, drift: 0, here: [], last: 0, video: null });
  changed();
}

/* One line for the player: who, and how far apart. */
export function partyLine() {
  if (!party.id) return "";
  const name = party.friend?.display_name || "your friend";
  const together = party.here.length > 1;
  const drift = Math.abs(party.drift) < 1 ? "in step" : `${Math.abs(party.drift).toFixed(1)}s ${party.drift > 0 ? "ahead" : "behind"}`;
  return `${party.hosting ? `Watching with ${name}` : `Following ${name}`} · ${together ? drift : "waiting for them to join…"}`;
}
