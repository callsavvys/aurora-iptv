// Does a party actually carry across the internet? Two accounts, one channel,
// against the live account server — the half of watching together that no
// offline test can prove.
//   AURORA_PARTY_A=… AURORA_PARTY_A_PASS=… AURORA_PARTY_B=… AURORA_PARTY_B_PASS=… \
//     npx electron tests/party-live.cjs
// Both accounts must already exist and be confirmed, and should be throwaways.
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { openAurora } = require("./harness.cjs");

const A = { email: process.env.AURORA_PARTY_A, pass: process.env.AURORA_PARTY_A_PASS };
const B = { email: process.env.AURORA_PARTY_B, pass: process.env.AURORA_PARTY_B_PASS };
if (!A.email || !A.pass || !B.email || !B.pass) {
  console.log("FAIL  set AURORA_PARTY_A, AURORA_PARTY_A_PASS, AURORA_PARTY_B and AURORA_PARTY_B_PASS");
  process.exit(1);
}

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aurora-party-"));
  const { js, check, waitFor, close } = await openAurora({ dataDir, port: 41960 });
  // without this, anything the page throws rejects silently and the run hangs
  // instead of telling you what went wrong
  const guard = async (label, work) => {
    try { return await work() }
    catch (error) { console.log(`FAIL  ${label}\n        ${error?.message || error}`); await close(); process.exit(1) }
  };
  await js(`document.getElementById("source-modal").classList.add("hidden"); true`);

  // two signed-in clients in one page: each gets its own storage key, so one
  // session cannot stand on the other's
  const ready = await guard("signing both accounts in", () => js(`(async () => {
    const make = async (email, pass, key) => {
      const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { storageKey: key, persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { data, error } = await client.auth.signInWithPassword({ email, password: pass });
      if (error) throw new Error(email + ": " + error.message);
      return { client, id: data.user.id };
    };
    window.__a = await make(${JSON.stringify(A.email)}, ${JSON.stringify(A.pass)}, "party-a");
    window.__b = await make(${JSON.stringify(B.email)}, ${JSON.stringify(B.pass)}, "party-b");
    return [!!window.__a.id, !!window.__b.id];
  })()`));
  check("both accounts sign in", ready, [true, true]);

  console.log("\n— finding each other by code —");
  const codes = await js(`(async () => {
    const a = await window.__a.client.rpc("claim_profile", { name: "Host" });
    const b = await window.__b.client.rpc("claim_profile", { name: "Guest" });
    window.__codes = { a: a.data[0].friend_code, b: b.data[0].friend_code };
    return [window.__codes.a.length, window.__codes.b.length, window.__codes.a !== window.__codes.b];
  })()`);
  check("each account gets its own code", codes, [8, 8, true]);

  const befriended = await js(`(async () => {
    const found = await window.__a.client.rpc("friend_by_code", { code: window.__codes.b });
    const them = found.data[0];
    await window.__a.client.from("friends").insert({ requester: window.__a.id, addressee: them.user_id, status: "pending" });
    await window.__b.client.from("friends").update({ status: "accepted" }).eq("requester", window.__a.id).eq("addressee", window.__b.id);
    const mine = await window.__a.client.rpc("my_friends");
    return mine.data.map((friend) => [friend.display_name, friend.status]);
  })()`);
  check("the code turns into a friendship", befriended, [["Guest", "accepted"]]);

  console.log("\n— what we both have —");
  const shared = await js(`(async () => {
    // a library each: one film in common, one only the guest has
    state.items = [
      { id: "m1", type: "movie", name: "AMZN | The Runner", year: "2026" },
      { id: "m2", type: "movie", name: "Only Mine (2019)", year: "2019" },
      { id: "l1", type: "live", name: "The Runner", year: "" },
    ];
    const guest = new Uint8Array(1 << 16);
    for (const print of fingerprints({ name: "The Runner (2026)", year: "" })) filterSet(guest, print);
    for (const print of fingerprints({ name: "Theirs Alone", year: "2001" })) filterSet(guest, print);
    await window.__b.client.from("library_filter").upsert({ user_id: window.__b.id, bits: toBase64(guest), items: 2, hashes: 4 });
    const read = await window.__a.client.from("library_filter").select("bits, items").eq("user_id", window.__b.id).maybeSingle();
    const filter = { bits: Uint8Array.from(atob(read.data.bits), (c) => c.charCodeAt(0)), items: read.data.items };
    return sharedWith(filter).map((item) => item.name);
  })()`);
  check("a friend's filter crosses the wire and matches by name and year", shared, ["AMZN | The Runner"]);

  console.log("\n— the party itself —");
  // a run that died before its cleanup leaves an invitation standing, and the
  // guest would then see two
  await js(`(async () => {
    await window.__a.client.from("parties")
      .update({ ended_at: new Date().toISOString() }).eq("host", window.__a.id).is("ended_at", null);
    return true;
  })()`);
  const party = await js(`(async () => {
    const made = await window.__a.client.from("parties")
      .insert({ host: window.__a.id, fingerprint: fingerprints({ name: "The Runner", year: "2026" })[0], kind: "movie", title: "The Runner" })
      .select("id").single();
    if (made.error) throw new Error(made.error.message);
    const seated = await window.__a.client.from("party_members").insert([
      { party_id: made.data.id, user_id: window.__a.id, joined_at: new Date().toISOString() },
      { party_id: made.data.id, user_id: window.__b.id, joined_at: null },
    ]);
    if (seated.error) throw new Error(seated.error.message);
    window.__party = made.data.id;
    return made.data.id.length;
  })()`);
  check("the host opens one and seats them both", party, 36);

  const invited = await js(`(async () => {
    const waiting = await window.__b.client.from("party_members")
      .select("party_id, parties!inner(title, ended_at)").is("joined_at", null).is("parties.ended_at", null);
    return (waiting.data || []).map((row) => row.parties.title);
  })()`);
  check("the guest finds the invitation waiting", invited, ["The Runner"]);

  // the real question: does a broadcast sent by one client reach the other
  const delivered = await js(`(async () => {
    window.__heard = [];
    const guest = window.__b.client.channel("aurora-party-" + window.__party, { config: { broadcast: { self: false } } });
    guest.on("broadcast", { event: "state" }, ({ payload }) => window.__heard.push(payload));
    await new Promise((resolve) => guest.subscribe((status) => status === "SUBSCRIBED" && resolve()));
    const host = window.__a.client.channel("aurora-party-" + window.__party, { config: { broadcast: { self: false } } });
    await new Promise((resolve) => host.subscribe((status) => status === "SUBSCRIBED" && resolve()));
    window.__host = host; window.__guest = guest;
    await host.send({ type: "broadcast", event: "state", payload: { position: 212.5, paused: false, at: Date.now() } });
    return true;
  })()`);
  check("both ends join the channel", delivered, true);
  check("and what the host sends arrives", await waitFor(`window.__heard.length > 0`, 15000), true);
  check("with the position it was sent with", await js(`window.__heard[0].position`), 212.5);

  // and that the guest's own player follows it
  const followed = await js(`(async () => {
    const video = $("#video");
    Object.defineProperty(video, "paused", { value: false, configurable: true });
    video.currentTime = 0;
    $("#player-modal").classList.remove("hidden");
    party.id = window.__party; party.hosting = false; party.offset = 0;
    followHost(window.__heard[0]);
    const seeked = video.currentTime;
    $("#player-modal").classList.add("hidden");
    party.id = null;
    return Math.abs(seeked - 212.5) < 3;
  })()`);
  check("the guest's player seeks to where the host is", followed, true);

  await js(`(async () => {
    await window.__a.client.from("parties").update({ ended_at: new Date().toISOString() }).eq("id", window.__party);
    await window.__a.client.removeChannel(window.__host);
    await window.__b.client.removeChannel(window.__guest);
    return true;
  })()`);
  await close();
})();
