// Watching together in the web app (web/js/together.js), host and guest, over
// a stand-in for Supabase that records every table write and carries realtime
// messages between the two. The messages and rows must be exactly the old
// app's (app/renderer.js startParty/joinParty/broadcastParty), so a party can
// have one person on each app.
//   node tests/web-party.cjs
// Value: protects=the party protocol (rows, invite, state payload, follow rules, end) and that both
//   sides find the same title by fingerprint; fails_when=a payload key, a row shape, the sync
//   thresholds or the fingerprint rules drift from the old app; why_new=nothing tested the web party;
//   seam=none; no_claim=real Supabase realtime and its row-level security (stubbed)
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const ROOT = path.resolve(__dirname, "..");

let failed = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(`${ok ? "  ok  " : "FAIL  "}${label}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};
const tick = () => new Promise((r) => setTimeout(r, 0));

// ---------- the page's world: window, storage, sync-core ----------
const store = new Map();
globalThis.window = globalThis;
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.AURORA_CONFIG = { supabaseUrl: "https://example.supabase.co", supabaseKey: "anon" };
vm.runInThisContext(fs.readFileSync(path.join(ROOT, "web/js/sync-core.js"), "utf8"));

// ---------- a stand-in Supabase: tables, RPCs, and one realtime bus ----------
const writes = [];                  // [who, table, op, payload]
const bus = new Map();              // channel name -> Set of subscribers
const PROFILES = { A: { user_id: "A", display_name: "Ziyad", friend_code: "AAAA1111" }, B: { user_id: "B", display_name: "Mona", friend_code: "BBBB2222" } };
let partyRow = null;
let noCodeColumn = false;          // a database without the party_codes migration

function fakeClient(me) {
  const query = (table) => {
    const q = { table, filters: [] };
    const done = (data) => Promise.resolve({ data, error: null });
    q.insert = (rows) => {
      if (table === "parties" && noCodeColumn && "code" in rows) { q.failed = { message: "column \"code\" of relation \"parties\" does not exist", code: "42703" }; return q; }
      writes.push([me, table, "insert", rows]); if (table === "parties") partyRow = { id: "P1", ...rows, ended_at: null }; q.inserted = rows; return q;
    };
    q.update = (patch) => { writes.push([me, table, "update", patch]); if (table === "parties" && partyRow) Object.assign(partyRow, patch); return q; };
    q.upsert = (row) => { writes.push([me, table, "upsert", row]); return done(null); };
    q.delete = () => { writes.push([me, table, "delete"]); return q; };
    q.select = () => q; q.eq = (k, v) => { q.filters.push([k, v]); return q; }; q.is = () => q; q.or = () => done(null);
    q.single = () => (q.failed ? Promise.resolve({ data: null, error: q.failed }) : done(table === "parties" ? { id: "P1" } : null));
    q.maybeSingle = () => done(table === "parties" ? partyRow : null);
    q.then = (ok, bad) => done(table === "party_members" ? [] : null).then(ok, bad);
    return q;
  };
  return {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: me, email: `${me}@example.com` } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({}),
    },
    rpc: async (name, args = {}) => {
      if (name === "claim_profile") return { data: [PROFILES[me]], error: null };
      if (name === "join_party_by_code") {
        if (noCodeColumn) return { data: null, error: { message: "Could not find the function public.join_party_by_code in the schema cache", code: "PGRST202" } };
        const open = partyRow && !partyRow.ended_at && partyRow.code === args.party_code;
        if (open) writes.push([me, "party_members", "join", args.party_code]);
        return { data: open ? [{ id: partyRow.id, host: partyRow.host, fingerprint: partyRow.fingerprint, title: partyRow.title, kind: partyRow.kind }] : [], error: null };
      }
      if (name === "friends_watching") return { data: partyRow && !partyRow.ended_at && partyRow.host !== me ? [{ party_id: partyRow.id, code: partyRow.code, host: partyRow.host, display_name: PROFILES[partyRow.host].display_name, title: partyRow.title, kind: partyRow.kind }] : [], error: null };
      if (name === "my_friends") { const other = me === "A" ? PROFILES.B : PROFILES.A; return { data: [{ ...other, status: "accepted", i_asked: me === "A" }], error: null }; }
      return { data: null, error: null };
    },
    from: query,
    channel(name, opts) {
      const handlers = [];
      const ch = {
        name, opts,
        on(type, filter, fn) { handlers.push({ type, event: filter.event, fn }); return ch; },
        subscribe(cb) { if (!bus.has(name)) bus.set(name, new Set()); bus.get(name).add(ch); cb?.("SUBSCRIBED"); return ch; },
        async send(msg) {
          for (const other of bus.get(name) || []) {
            if (other === ch && opts?.config?.broadcast?.self === false) continue;
            for (const h of other.handlers) if (h.type === "broadcast" && h.event === msg.event) h.fn({ payload: msg.payload });
          }
          sent.push([me, name, msg.event, msg.payload]);
          return "ok";
        },
        track() { return "ok"; }, presenceState: () => ({ A: [{}], B: [{}] }), handlers,
      };
      return ch;
    },
    removeChannel: async (ch) => { bus.get(ch.name)?.delete(ch); },
  };
}
const sent = [];

function fakeVideo(at = 0) {
  const listeners = {};
  return {
    currentTime: at, paused: true, playbackRate: 1, readyState: 4, seeking: false,
    play() { this.paused = false; (listeners.play || []).forEach((f) => f()); return Promise.resolve(); },
    pause() { this.paused = true; (listeners.pause || []).forEach((f) => f()); },
    addEventListener(e, f) { (listeners[e] ||= []).push(f); },
    removeEventListener(e, f) { listeners[e] = (listeners[e] || []).filter((x) => x !== f); },
  };
}

(async () => {
  const file = pathToFileURL(path.join(ROOT, "web/js/together.js")).href;
  window.supabase = { createClient: () => fakeClient("A") };
  const host = await import(`${file}?host`); await host.start();
  window.supabase = { createClient: () => fakeClient("B") };
  const guest = await import(`${file}?guest`); await guest.start();

  console.log("— both are signed in and friends —");
  check("each knows who they are and their friend", [host.social.profile.friend_code, guest.accepted().map((f) => f.display_name)], ["AAAA1111", ["Ziyad"]]);

  console.log("— the same film on two lines, by fingerprint —");
  const hostFilm = { id: 11, kind: "movie", source: "xtream", title: "Dune: Part Two", raw: "EN | Dune: Part Two (2024) 4K", rawYear: "2024" };
  const guestLine = [
    { id: 90, kind: "movie", source: "xtream", title: "Dune", raw: "Dune", rawYear: "2021" },
    { id: 91, kind: "movie", source: "xtream", title: "Dune Part Two", raw: "Dune Part Two", rawYear: "2024" },
  ];
  check("fingerprints match the old app's rules (tag, brackets, quality words, year)", AuroraSync.fingerprints(hostFilm.raw, hostFilm.rawYear), ["dune part two|2024", "dune part two"]);

  console.log("— the host starts a party —");
  check("it starts", await host.startParty(hostFilm, "B"), true);
  const party = writes.find(([, t, op]) => t === "parties" && op === "insert")[3];
  check("the parties row is the old app's, plus its code", { ...party, code: typeof party.code }, { host: "A", fingerprint: "dune part two|2024", kind: "movie", title: "EN | Dune: Part Two (2024) 4K", code: "string" });
  const members = writes.find(([, t, op]) => t === "party_members" && op === "insert")[3];
  check("two members, both rows with the same keys (a mixed bulk insert is refused)", [members.length, Object.keys(members[0]).sort(), Object.keys(members[1]).sort(), members[1].joined_at], [2, ["joined_at", "party_id", "user_id"], ["joined_at", "party_id", "user_id"], null]);
  const invite = sent.find(([, ch, ev]) => ch === "aurora-user-B" && ev === "invite")[3];
  check("the invitation goes on the friend's channel, as the old app sends it", invite, { party: "P1", from: "Ziyad", title: "EN | Dune: Part Two (2024) 4K", fingerprint: "dune part two|2024" });
  await tick();
  check("the guest is offered it", guest.pendingInvite()?.party, "P1");

  console.log("— the guest joins with their own copy —");
  const joined = await guest.joinParty("P1", guestLine);
  check("they get their copy (Dune Part Two, not Dune)", joined.item?.id, 91);
  check("their member row is marked joined", writes.some(([who, t, op, p]) => who === "B" && t === "party_members" && op === "update" && p.joined_at), true);
  check("both say who they are watching with", [/^Code [A-Z0-9]{6} · Watching with Mona/.test(host.partyLine()), guest.partyLine().startsWith("Following Ziyad")], [true, true]);

  console.log("— the host is the clock —");
  const hv = fakeVideo(100), gv = fakeVideo(0);
  const stopHost = host.attachPlayer(hv), stopGuest = guest.attachPlayer(gv);
  hv.play(); await tick();
  const state = sent.filter(([who, ch, ev]) => who === "A" && ch === "aurora-party-P1" && ev === "state").pop()[3];
  check("the state message has the old app's keys", Object.keys(state).sort(), ["at", "paused", "position", "title"]);
  check("far apart (100 s): the guest seeks to the host and plays", [Math.round(gv.currentTime), gv.paused, gv.playbackRate], [100, false, 1]);
  gv.currentTime = 0; gv.readyState = 0; hv.pause(); hv.play(); await tick();
  check("while the guest's film is still loading it does not seek (that restarts the load)", Math.round(gv.currentTime), 0);
  gv.readyState = 4; gv.seeking = true; hv.pause(); hv.play(); await tick();
  check("nor while its last seek is still settling", Math.round(gv.currentTime), 0);
  gv.seeking = false; hv.pause(); hv.play(); await tick();
  check("once loaded it seeks to the host", Math.round(gv.currentTime), 100);
  gv.currentTime = 101.5; hv.pause(); hv.currentTime = 100; hv.play(); await tick();
  check("1.5 s ahead: the guest eases off (0.95x) instead of jumping", [gv.playbackRate, Math.round(gv.currentTime * 10) / 10], [0.95, 101.5]);
  gv.currentTime = 100.2; hv.pause(); await tick();
  check("the host pauses: so does the guest", gv.paused, true);
  guest.nudgeParty(5);
  check("the guest can hold themselves 5 s on (remembered per friend)", [guest.party.offset, JSON.parse(localStorage.getItem("aurora-party-offsets")).A], [5, 5]);

  console.log("— the host ends it —");
  await host.leaveParty(); await tick();
  check("the party row is ended and the guest is told", [!!partyRow.ended_at, sent.some(([who, ch, ev]) => who === "A" && ch === "aurora-party-P1" && ev === "ended")], [true, true]);
  check("the guest leaves too", [guest.party.id, guest.social.notice], [null, "Your friend ended the party"]);
  stopHost(); stopGuest();

  console.log("— a title the guest's line does not have —");
  partyRow = { id: "P2", host: "A", fingerprint: "no such film|1999", title: "No Such Film", kind: "movie", ended_at: null };
  check("they are told, and nothing starts", await guest.joinParty("P2", guestLine), { error: "Your line does not seem to have No Such Film" });

  console.log("— a party with a code, no invitation —");
  writes.length = 0; sent.length = 0; partyRow = null;
  check("it starts without a friend", await host.startParty(hostFilm), true);
  const coded = writes.find(([, t, op]) => t === "parties" && op === "insert")[3];
  check("the row carries a six-character code from the unambiguous letters", /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(coded.code), true);
  check("only the host is a member, and nobody is sent an invitation", [writes.find(([, t, op]) => t === "party_members" && op === "insert")[3].length, sent.filter(([, , ev]) => ev === "invite").length], [1, 0]);
  check("the host's line shows the code", host.partyLine().startsWith(`Code ${coded.code}`), true);
  check("a friend sees it under Watching now", (await guest.friendsWatching()).map((p) => [p.display_name, p.code]), [["Ziyad", coded.code]]);
  check("a wrong code is refused plainly", await guest.joinByCode("ZZZZZZ", guestLine), { error: "No open party has that code" });
  check("a code of the wrong length is refused before asking", await guest.joinByCode("ABC", guestLine), { error: "A party code is six characters" });
  const byCode = await guest.joinByCode(coded.code.toLowerCase().replace(/(..)/, "$1 "), guestLine);
  check("the right code (typed in lower case, with a space) joins, with the guest's own copy", [byCode.item?.id, writes.some(([who, t, op]) => who === "B" && t === "party_members" && op === "join"), guest.party.code], [91, true, coded.code]);
  await host.leaveParty(); await tick();

  console.log("— a database without party codes yet —");
  noCodeColumn = true; writes.length = 0;
  check("a party still starts, without a code", [await host.startParty(hostFilm, "B"), host.party.code, "code" in writes.find(([, t, op]) => t === "parties" && op === "insert")[3]], [true, "", false]);
  check("joining by code says the database needs an update", await guest.joinByCode("ABCDEF", guestLine), { error: "Party codes need a database update" });
  await host.leaveParty(); noCodeColumn = false;

  console.log(failed ? `\n${failed} failed` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((error) => { console.log(`FAIL  ${error.stack}`); process.exit(1); });
