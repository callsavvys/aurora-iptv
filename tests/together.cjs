// Watching together, with no network at all: how two providers agree on a
// title, what a friend's Bloom filter can tell you, and how a guest keeps step
// with the host. The Supabase client is replaced by a recorder, so every test
// that must stay local can also prove nothing was asked of it.
//   npx electron tests/together.cjs
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { openAurora } = require("./harness.cjs");

const NOW = 1_700_000_000_000; // followHost reads the clock; it is held still so travel time is exact

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aurora-together-"));
  const { js, check, close } = await openAurora({ dataDir, port: 41950 });
  await js(`document.getElementById("source-modal").classList.add("hidden"); true`);

  // a client that answers nothing and writes down everything it was asked
  await js(`
    window.__asked = [];
    window.__sent = [];
    const note = (what) => window.__asked.push(what);
    /* Awaiting a link in this chain used to hand back the proxy itself, so
       code that reads error.message off the result threw "cannot convert
       object to primitive value" rather than taking the no-error path. A
       finished call resolves to what PostgREST actually returns. */
    const chain = (what) => new Proxy(() => {}, {
      get: (_, key) => (key === "then"
        ? ((resolve) => resolve({ data: null, error: null }))
        : chain(what + "." + String(key))),
      apply: () => { note(what); return chain(what) },
    });
    window.accountClient = () => ({
      from: (table) => chain("from(" + table + ")"),
      rpc: (name) => { note("rpc(" + name + ")"); return Promise.resolve({ data: name === "friend_by_code" ? window.__foundByCode || null : null }) },
      channel: (name) => { note("channel(" + name + ")"); return { send: () => Promise.resolve(), on() { return this }, subscribe: () => Promise.resolve(), track() {} } },
      removeChannel: (channel) => { window.__removed = channel; return Promise.resolve() },
    });
    window.__fetches = 0; const realFetch = window.fetch; window.fetch = (...args) => {  window.__fetches += 1; return realFetch(...args) };
    window.__asked.length = 0;
    true`);
  const asked = () => js(`window.__asked.splice(0)`);

  // an <video> with nothing loaded cannot be told to play, seek or pause in any
  // way worth reading back, so the element's own controls are replaced
  await js(`
    const v = $("#video");
    window.__v = { time: 0, paused: true, rate: 1, seeks: [], plays: 0, pauses: 0 };
    Object.defineProperty(v, "currentTime", { configurable: true, get: () => window.__v.time, set: (x) => { window.__v.time = x; window.__v.seeks.push(x) } });
    Object.defineProperty(v, "paused", { configurable: true, get: () => window.__v.paused });
    Object.defineProperty(v, "playbackRate", { configurable: true, get: () => window.__v.rate, set: (x) => { window.__v.rate = x } });
    Object.defineProperty(v, "readyState", { configurable: true, get: () => window.__v.ready ?? 4 });
    Object.defineProperty(v, "seeking", { configurable: true, get: () => !!window.__v.seeking });
    v.pause = () => { window.__v.paused = true; window.__v.pauses += 1 };
    v.play = () => { window.__v.paused = false; window.__v.plays += 1; return Promise.resolve() };
    true`);

  console.log("— fingerprints —");
  const prints = (item) => js(`fingerprints(${JSON.stringify(item)})`);
  const amazon = await prints({ name: "AMZN | The Runner", year: "2026" });
  const plain = await prints({ name: "The Runner (2026)", year: "2026" });
  check("two providers naming one film differently share a fingerprint", [amazon[0], plain[0]], ["the runner|2026", "the runner|2026"]);
  check("and so does the bare form", [amazon[1], plain[1]], ["the runner", "the runner"]);
  check("a different film does not collide", (await prints({ name: "The Walker", year: "2026" })).some((p) => amazon.includes(p)), false);
  check("the same name in another year differs where it counts", (await prints({ name: "The Runner", year: "1990" }))[0] === amazon[0], false);
  check("a missing year still matches through the bare form", (await prints({ name: "The Runner" })), ["the runner"]);
  check("a year given as a full date is cut to the year", (await prints({ name: "The Runner", year: "2026-03-14" }))[0], "the runner|2026");
  check("a name with nothing left in it has no fingerprint", await prints({ name: "[4K]" }), []);

  console.log("\n— the Bloom filter —");
  await js(`window.__library = (from, to, tag, year) => Array.from({ length: to - from }, (_, i) => ({ id: tag + (from + i), type: "movie", name: (tag === "in" ? "Stored Feature " : "Missing Feature ") + (from + i).toString(36) + " " + ((from + i) * 7919).toString(36), year: year ? String(1950 + ((from + i) % 70)) : "" })); true`);
  await js(`state.items = __library(0, 3000, "in", true); window.__lib = libraryFilter(); true`);
  check("it counts the films and series it was built from", await js(`__lib.count`), 3000);
  check("every title that went in tests positive", await js(`state.items.every((item) => filterHas(__lib.bits, fingerprints(item)[0]))`), true);
  check("so does the bare form of each", await js(`state.items.every((item) => filterHas(__lib.bits, fingerprints(item).at(-1)))`), true);
  const falseRate = await js(`(() => {
    const absent = __library(0, 5000, "out", true);
    return absent.filter((item) => filterHas(__lib.bits, fingerprints(item)[0])).length / absent.length;
  })()`);
  check("titles that never went in are overwhelmingly negative", falseRate < 0.02, true);
  check("the empty filter says no to everything", await js(`!filterHas(new Uint8Array(FILTER_BYTES), "the runner")`), true);
  check("live channels are not part of what a friend can match", await js(`(() => {
    state.items = [{ id: "c1", type: "live", name: "Some Live Channel" }, { id: "m1", type: "movie", name: "Only Movie" }];
    return libraryFilter().count;
  })()`), 1);
  check("the filter survives base64 on the way up and back", await js(`(() => {
    state.items = __library(0, 3000, "in", true);
    const sent = libraryFilter().bits;
    const text = toBase64(sent);
    const back = toBits(text);
    return [back.length === sent.length, back.every((byte, i) => byte === sent[i]), state.items.every((item) => filterHas(back, fingerprints(item)[0]))];
  })()`), [true, true, true]);
  check("and is the size the table column expects", await js(`toBits(toBase64(libraryFilter().bits)).length`), 65536);
  check("none of that asked the account server anything", await asked(), []);

  console.log("\n— what you share with a friend —");
  await js(`window.__friendFilter = (names) => { const bits = new Uint8Array(FILTER_BYTES); for (const item of names) for (const print of fingerprints(item)) filterSet(bits, print); return { bits, items: names.length } }; true`);
  await js(`window.__theirs = __friendFilter([
    { name: "Shared Film", year: "2020" }, { name: "Shared Series", year: "2018" },
    { name: "A Live Thing", year: "" }, { name: "Their Own Film", year: "2011" }]); true`);
  await js(`state.items = [
    { id: "a", type: "movie", name: "Shared Film", year: "2020" },
    { id: "b", type: "movie", name: "Nothing Alike", year: "2020" },
    { id: "c", type: "live", name: "A Live Thing" },
    { id: "d", type: "series", name: "Shared Series", year: "2018" }]; true`);
  check("only titles in the friend's filter come back", await js(`sharedWith(__theirs).map((item) => item.id)`), ["a", "d"]);
  check("a live channel is skipped even when its name is in there", await js(`sharedWith(__theirs).some((item) => item.type === "live")`), false);
  check("a friend with no filter shares nothing", await js(`sharedWith(null)`), []);
  check("the limit is respected", await js(`(() => {
    const names = Array.from({ length: 10 }, (_, i) => ({ name: "Common Film " + String.fromCharCode(97 + i), year: "2000" }));
    state.items = names.map((n, i) => ({ id: "f" + i, type: "movie", ...n }));
    return [sharedWith(__friendFilter(names), 3).map((item) => item.id), sharedWith(__friendFilter(names)).length];
  })()`), [["f0", "f1", "f2"], 10]);
  check("a friend's copy with no year field still offers the film", await js(`(() => {
    state.items = [{ id: "mine", type: "movie", name: "AMZN | The Runner" }];
    return sharedWith(__friendFilter([{ name: "The Runner (2026)", year: "2026" }])).map((item) => item.id);
  })()`), ["mine"]);
  check("my copy with a year still finds a friend's copy that has none", await js(`(() => {
    state.items = [{ id: "mine", type: "movie", name: "AMZN | The Runner", year: "2026" }];
    return sharedWith(__friendFilter([{ name: "The Runner (2026)" }])).map((item) => item.id);
  })()`), ["mine"]);
  check("none of that asked the account server anything", await asked(), []);

  console.log("\n— following the host —");
  await js(`state.items = []; $("#player-modal").classList.remove("hidden"); $("#playback-rate").value = "1";
    Object.assign(party, { id: "p-test", hosting: false, friend: { user_id: "friend-1", display_name: "Sam" }, here: [], offset: 0, drift: 0 });
    window.__realNow = Date.now; Date.now = () => ${NOW}; true`);
  // put the guest's player in a known place, hear one message from the host, report what it did
  const follow = (video, message, { offset = 0 } = {}) => js(`(() => {
    Object.assign(__v, ${JSON.stringify({ rate: 1, paused: false, seeks: [], plays: 0, pauses: 0, ready: 4, seeking: false, ...video })});
    party.offset = ${offset};
    followHost(${JSON.stringify(message)});
    return { time: __v.time, paused: __v.paused, rate: __v.rate, seeks: __v.seeks, plays: __v.plays, pauses: __v.pauses, drift: Math.round(party.drift * 10) / 10 };
  })()`);
  const playing = (position, ago = 0) => ({ position, paused: false, at: NOW - ago * 1000 });
  const halted = (position, ago = 0) => ({ position, paused: true, at: NOW - ago * 1000 });

  let r = await follow({ time: 10 }, playing(100));
  check("far behind the host, it seeks to where the host is", [r.seeks, r.time, r.rate], [[100], 100, 1]);
  r = await follow({ time: 200 }, playing(100));
  check("far ahead of the host, it seeks back", [r.seeks, r.time], [[100], 100]);
  r = await follow({ time: 0, ready: 0 }, playing(100));
  check("while its film is still loading it does not seek (that restarts the load)", r.seeks, []);
  r = await follow({ time: 3, seeking: true }, playing(100));
  check("nor while its last seek is still settling", r.seeks, []);
  r = await follow({ time: 47.4 }, playing(50));
  check("just past the seek threshold it seeks, not eases", [r.seeks.length, r.rate], [1, 1]);
  r = await follow({ time: 47.6 }, playing(50));
  check("just inside it, it does not seek", r.seeks, []);
  check("and eases faster to catch up", r.rate, 1.05);
  r = await follow({ time: 54 }, playing(52));
  check("ahead by a little, it slows down to let the host catch up", [r.seeks, r.rate], [[], 0.95]);
  r = await follow({ time: 50.3 }, playing(50));
  check("within a third of a second it leaves the speed alone", [r.seeks, r.rate, r.drift], [[], 1, 0.3]);
  r = await follow({ time: 50, rate: 1.05 }, playing(50.2));
  check("coming back in step puts the chosen speed back", r.rate, 1);
  await js(`$("#playback-rate").value = "2"; true`);
  r = await follow({ time: 50, rate: 1 }, playing(50.1));
  check("and the chosen speed is whatever the viewer picked", r.rate, 2);
  r = await follow({ time: 10 }, playing(100));
  check("a seek keeps that speed too", r.rate, 2);
  await js(`$("#playback-rate").value = "1"; true`);
  r = await follow({ time: 50 }, playing(50.2));
  check("the drift it reports is mine minus the host's", r.drift, -0.2);

  r = await follow({ time: 50, paused: false }, halted(50));
  check("the host pausing pauses me", [r.paused, r.pauses], [true, 1]);
  r = await follow({ time: 50, paused: true }, playing(50));
  check("the host resuming resumes me", [r.paused, r.plays], [false, 1]);
  r = await follow({ time: 50, paused: false }, playing(50));
  check("already playing along, it does not restart", [r.plays, r.pauses], [0, 0]);
  r = await follow({ time: 50, paused: true }, halted(50));
  check("already paused along, it does not pause again", [r.plays, r.pauses], [0, 0]);
  r = await follow({ time: 10, paused: true }, halted(100));
  check("a host paused somewhere else still gets me there", [r.seeks, r.paused], [[100], true]);

  r = await follow({ time: 100 }, playing(100, 2));
  check("a message sent two seconds ago means the host is two seconds further on", [r.drift, r.rate], [-2, 1.05]);
  r = await follow({ time: 102 }, playing(100, 2));
  check("and being there is being in step", [r.drift, r.rate, r.seeks], [0, 1, []]);
  r = await follow({ time: 0 }, playing(100, 2));
  check("a seek lands where the host is by now, not where it was", r.seeks, [102]);
  r = await follow({ time: 100 }, halted(100, 2));
  check("a pause does not travel: a paused host has not moved", [r.drift, r.seeks, r.rate], [0, [], 1]);

  r = await follow({ time: 0 }, playing(100), { offset: 5 });
  check("a friend's offset moves the target", r.seeks, [105]);
  r = await follow({ time: 105 }, playing(100), { offset: 5 });
  check("so being at host plus offset is being in step", [r.drift, r.seeks, r.rate], [0, [], 1]);
  r = await follow({ time: 100 }, playing(100), { offset: -3 });
  check("a negative offset holds me behind", [r.drift, r.seeks, r.rate], [3, [97], 1]);

  await js(`party.hosting = true; true`);
  r = await follow({ time: 10, paused: true }, playing(100));
  check("a host never follows anyone, not even a stray message", [r.seeks, r.plays, r.time], [[], 0, 10]);
  await js(`party.hosting = false; $("#player-modal").classList.add("hidden"); true`);
  r = await follow({ time: 10, paused: true }, playing(100));
  check("with the player closed, nothing is touched", [r.seeks, r.plays, r.time], [[], 0, 10]);
  await js(`$("#player-modal").classList.remove("hidden"); true`);
  r = await follow({ time: 10 }, null);
  check("an empty message is ignored", [r.seeks, r.plays, r.pauses], [[], 0, 0]);
  check("none of that asked the account server anything", await asked(), []);

  console.log("\n— the offset nudge —");
  await js(`writePref("partyOffsets", undefined); Object.assign(party, { offset: 0, friend: { user_id: "friend-1", display_name: "Sam" } }); true`);
  await js(`nudgeParty(5); true`);
  check("nudging moves the offset", await js(`party.offset`), 5);
  check("and remembers it against that friend", await js(`readPref("partyOffsets", {})`), { "friend-1": 5 });
  await js(`nudgeParty(-2); true`);
  check("nudges add up", await js(`[party.offset, readPref("partyOffsets", {})["friend-1"]]`), [3, 3]);
  await js(`nudgeParty(0.1); nudgeParty(0.1); nudgeParty(0.1); true`);
  check("tenths of a second stay tenths", await js(`party.offset`), 3.3);
  await js(`party.friend = { user_id: "friend-2", display_name: "Alex" }; party.offset = 0; nudgeParty(-5); true`);
  check("another friend keeps their own", await js(`readPref("partyOffsets", {})`), { "friend-1": 3.3, "friend-2": -5 });
  await js(`party.friend = { user_id: "friend-1", display_name: "Sam" }; party.offset = readPref("partyOffsets", {})["friend-1"]; true`);
  r = await follow({ time: 0 }, playing(100), { offset: await js(`party.offset`) });
  check("the next message is followed with that offset", r.seeks, [103.3]);
  await js(`party.friend = null; party.offset = 0; writePref("partyOffsets", undefined); nudgeParty(5); true`);
  check("with no one to remember it for, it still moves but writes nothing", await js(`[party.offset, readPref("partyOffsets", null)]`), [5, null]);
  await js(`nudgeParty(5); true`);
  check("the toast says which way I am being held", await js(`document.querySelector("#toast").textContent`), "Holding 10s ahead of your friend");
  await js(`nudgeParty(-20); true`);
  check("and the other way", await js(`document.querySelector("#toast").textContent`), "Holding 10s behind your friend");
  check("none of that asked the account server anything", await asked(), []);

  console.log("\n— the invite banner —");
  await js(`$("#party-invite").classList.add("hidden"); party.id = null; true`);
  await js(`offerParty({ party: "party-42", from: "Sam", title: "The Runner" }); true`);
  check("an invite shows who and what", await js(`[$("#party-invite").classList.contains("hidden"), $("#party-invite strong").textContent, $("#party-invite small").textContent]`), [false, "Sam", "wants to watch The Runner"]);
  check("with a button that carries the party", await js(`$("#party-invite [data-join-party]").dataset.joinParty`), "party-42");
  check("and one to turn it down", await js(`!!$("#party-invite [data-dismiss-invite]")`), true);
  // the banner already says it, in front of whatever you were doing: a toast
  // saying the same sentence beside it is just the same news twice
  check("and is not also announced by a toast", await js(`$("#toast").textContent.includes("wants to watch")`), false);
  await js(`$("#party-invite [data-dismiss-invite]").click(); true`);
  check("turning it down hides it", await js(`$("#party-invite").classList.contains("hidden")`), true);
  check("without joining anything", await asked(), []);
  await js(`offerParty({ party: "party-43", from: "<img src=x onerror=alert(1)>", title: "<b>Bold</b>" }); true`);
  check("names and titles are text, not markup", await js(`[$("#party-invite img"), $("#party-invite b")].map(Boolean)`), [false, false]);
  await js(`$("#party-invite").classList.add("hidden"); party.id = "party-44"; offerParty({ party: "party-44", from: "Sam", title: "Again" }); true`);
  check("an invite to the party you are already in stays quiet", await js(`$("#party-invite").classList.contains("hidden")`), true);
  await js(`offerParty({ title: "No id" }); true`);
  check("and so does one with no party in it", await js(`$("#party-invite").classList.contains("hidden")`), true);
  await js(`offerParty({ party: "party-45" }); true`);
  check("a nameless invite says a friend", await js(`$("#party-invite strong").textContent`), "A friend");
  await js(`$("#party-invite").classList.add("hidden"); party.id = null; true`);

  console.log("\n— leaving —");
  await js(`Date.now = __realNow; true`);
  await js(`(() => {
    $("#playback-rate").value = "1.25";
    window.__channel = { name: "stub-channel", send: () => { window.__sent.push("left"); return Promise.resolve() } };
    Object.assign(party, { id: "p-leave", hosting: false, channel: __channel, friend: { user_id: "friend-1", display_name: "Sam" }, title: "The Runner", drift: 4, here: ["a", "b"], last: 5 });
    __v.rate = 1.05; updatePartyStrip(); return true;
  })()`);
  check("the strip shows while in a party", await js(`[$("#party-strip").classList.contains("hidden"), /Following Sam/.test($("#party-strip").textContent)]`), [false, true]);
  await js(`leaveParty().then(() => true)`);
  check("leaving clears the party", await js(`[party.id, party.hosting, party.friend, party.title, party.drift, party.here, party.channel]`), [null, false, null, "", 0, [], null]);
  check("hides the strip", await js(`$("#party-strip").classList.contains("hidden")`), true);
  check("puts the viewer's speed back", await js(`__v.rate`), 1.25);
  check("lets go of the channel", await js(`window.__removed?.name`), "stub-channel");
  check("and a guest leaving tells no one and ends nothing", [await asked(), await js(`window.__sent`)], [[], []]);
  await js(`(() => {
    Object.assign(party, { id: "p-end", hosting: true, channel: __channel, friend: { user_id: "friend-1", display_name: "Sam" } });
    return true;
  })()`);
  await js(`leaveParty().then(() => true)`);
  check("a host leaving ends the party for the other side", [await js(`window.__sent`), await js(`party.id`)], [["left"], null]);
  check("by closing the row, the one write a host makes on the way out", await asked(), ["from(parties).update", "from(parties).update.eq"]);

  console.log("\n— a guest never broadcasts —");
  await js(`window.__sent.length = 0; Date.now = () => ${NOW};
    window.__channel = { send: (message) => { window.__sent.push(message); return Promise.resolve() } };
    Object.assign(party, { id: "p-cast", hosting: false, channel: __channel, last: 0 });
    Object.assign(__v, { time: 61, paused: false }); true`);
  await js(`broadcastParty(true); broadcastParty(); true`);
  check("a guest sends nothing, forced or not", await js(`__sent.length`), 0);
  await js(`party.hosting = true; broadcastParty(true); true`);
  check("a host sends where the video is", await js(`__sent.map((m) => [m.event, m.payload.position, m.payload.paused, m.payload.at])`), [["state", 61, false, NOW]]);
  await js(`broadcastParty(); true`);
  check("but not more often than the tick unless something changed", await js(`__sent.length`), 1);
  await js(`broadcastParty(true); true`);
  check("and always when something did", await js(`__sent.length`), 2);
  await js(`window.__sent.length = 0; party.channel = null; broadcastParty(true); true`);
  check("with no channel there is nothing to send to", await js(`__sent.length`), 0);
  await js(`Date.now = __realNow; Object.assign(party, { id: null, hosting: false, channel: null }); true`);
  check("none of that asked the account server anything", await asked(), []);

  // Submitting the form re-rendered the view to show "Asking…" and only then
  // read the input, which by that point was a fresh empty one. Adding a friend
  // by code never worked at all, on any platform.
  console.log("\n— the code you typed is the code that gets sent —");
  const sent = await js(`(async () => {
    window.__asked.length = 0;
    // the form only exists for a signed-in account
    account.user = { id: "me" };
    social.friends = [];
    social.profile = { user_id: "me", display_name: "Me", friend_code: "AAAAAAAA" };
    social.error = ""; social.notice = "";
    state.view = "together"; renderTogether();
    const field = document.getElementById("friend-code");
    if (!field) return "no field";
    field.value = "7FK3QX2M";
    document.getElementById("friend-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 60));
    return social.error || "no error";
  })()`);
  // the stub client answers nothing, so "No one has that code" is the right
  // outcome here; what must never come back is the length complaint
  check("a real code is not rejected as the wrong length", String(sent).includes("eight characters"), false);
  check("and it reached the server as a lookup", await js(`window.__asked.some((what) => what.includes("friend_by_code"))`), true);

  const blank = await js(`(async () => {
    social.error = ""; renderTogether();
    document.getElementById("friend-code").value = "";
    document.getElementById("friend-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 60));
    return social.error;
  })()`);
  check("an empty box still says what a code looks like", blank, "A friend code is eight characters.");

  const mine = await js(`(async () => {
    social.error = ""; renderTogether();
    document.getElementById("friend-code").value = "aaaa aaaa";
    document.getElementById("friend-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 60));
    return social.error;
  })()`);
  check("lowercase with a space is still your own code, not a length error", mine, "That is your own code.");

  /* A party invitation arrives the moment it is sent. A friend request did
     not: it sat in the table until the other person next opened Aurora, so
     asking while they were looking at the same screen did nothing visible. */
  console.log("\n— a friend request arrives while they are looking at it —");
  const onAccept = await js(`(async () => {
    window.__asked.length = 0;
    account.user = { id: "me" };
    await acceptFriend("them");
    return window.__asked.slice();
  })()`);
  check("accepting tells the one who asked", onAccept.some((what) => what === "channel(aurora-user-them)"), true);

  const onAsk = await js(`(async () => {
    window.__asked.length = 0;
    window.__foundByCode = [{ user_id: "them", display_name: "Them" }];
    social.profile = { user_id: "me", display_name: "Me", friend_code: "AAAAAAAA" };
    social.error = ""; social.notice = "";
    await addFriendByCode("7FK3QX2M");
    window.__foundByCode = null;
    return [window.__asked.slice(), social.error, social.notice];
  })()`);
  check("and asking tells the one being asked", onAsk[0].some((what) => what === "channel(aurora-user-them)"), true);
  check("with nothing to complain about", [onAsk[1], onAsk[2]], ["", "Asked Them to be friends."]);

  const listening = await js(`(() => {
    const src = String(listenForInvites);
    return [/event: "invite"/.test(src), /event: "friends"/.test(src)];
  })()`);
  check("both kinds arrive on the same channel of your own", listening, [true, true]);

  console.log("\n— party codes —");
  // a recording client whose answers each test chooses
  await js(`
    window.__log = [];
    window.__plays = [];
    window.__insertErrors = [];   // errors to hand back to successive party inserts
    window.__rpcAnswer = { data: null, error: null };
    window.__rpcCalls = [];
    window.__realPlay = window.play;
    window.play = (item) => { window.__plays.push(item.id) };
    window.accountClient = () => ({
      from: (table) => ({
        insert: (rows) => {
          window.__log.push({ table, rows });
          const fail = table === "parties" ? window.__insertErrors.shift() : null;
          const result = { data: fail ? null : { id: "party-new" }, error: fail || null };
          return { select: () => ({ single: () => Promise.resolve(result) }), then: (resolve) => resolve({ data: null, error: null }) };
        },
        update: () => ({ eq: () => ({ eq: () => Promise.resolve({}) }) }),
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }),
      }),
      rpc: (name, args) => { window.__rpcCalls.push([name, args]); return Promise.resolve(window.__rpcAnswer) },
      channel: (name) => { window.__log.push({ channel: name }); return { send: (m) => { window.__log.push({ sent: name, event: m.event }); return Promise.resolve() }, on() { return this }, subscribe: () => Promise.resolve(), track() {} } },
      removeChannel: () => Promise.resolve(),
    });
    account.user = { id: "me" };
    social.profile = { user_id: "me", display_name: "Me" };
    social.friends = [{ user_id: "friend-1", display_name: "Sam", status: "accepted" }];
    state.items = [{ id: "m1", type: "movie", name: "The Runner", year: "2026", streamId: 1 }];
    window.__reset = () => { __log.length = 0; __plays.length = 0; __insertErrors.length = 0; __rpcCalls.length = 0; Object.assign(party, { id: null, code: "", hosting: false, channel: null, friend: null, title: "", here: [] }) };
    true`);
  const rowsOf = (table) => js(`__log.filter((e) => e.table === "${table}").map((e) => e.rows)`);

  await js(`__reset(); startParty(state.items[0], "friend-1").then(() => true)`);
  const inserted = (await rowsOf("parties"))[0];
  check("a party row carries a six-character code from the unambiguous alphabet", /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(inserted.code), true);
  check("and the party keeps it for the strip and the toast", await js(`party.code`), inserted.code);
  check("the toast shows the code", await js(`$("#toast").textContent.includes("Party code " + party.code)`), true);
  check("the strip shows it", await js(`$("#party-strip .party-code").textContent`), inserted.code);
  check("with a friend: host and friend rows, with identical keys", await js(`__log.find((e) => e.table === "party_members").rows.map((r) => Object.keys(r).join())`), ["party_id,user_id,joined_at", "party_id,user_id,joined_at"]);
  check("the friend is invited on their own channel", await js(`__log.filter((e) => e.sent).map((e) => [e.sent, e.event])`), [["aurora-user-friend-1", "invite"]]);
  check("and the film plays", await js(`__plays`), ["m1"]);

  await js(`__reset(); startParty(state.items[0]).then(() => true)`);
  check("with no friend: only the host is a member", await js(`__log.find((e) => e.table === "party_members").rows.map((r) => r.user_id)`), ["me"]);
  check("and nobody is invited", await js(`__log.some((e) => e.sent)`), false);
  check("the strip says it is a hosted party", await js(`$("#party-strip .party-who").textContent`), "Hosting a party");

  await js(`__reset(); __insertErrors.push({ code: "23505", message: "duplicate key" }, { code: "23505", message: "duplicate key" }); startParty(state.items[0]).then(() => true)`);
  const attempts = await rowsOf("parties");
  check("a code that is taken is redrawn", [attempts.length, new Set(attempts.map((r) => r.code)).size > 1 || attempts.length === 3], [3, true]);
  check("and the party still starts", await js(`party.id`), "party-new");

  await js(`__reset(); __insertErrors.push({ code: "42703", message: 'column "code" of relation "parties" does not exist' }); startParty(state.items[0], "friend-1").then(() => true)`);
  const retried = await rowsOf("parties");
  check("with no code column, the insert is retried without one", [retried.length, "code" in retried[0], "code" in retried[1]], [2, true, false]);
  check("and the party starts without a code", await js(`[party.id, party.code]`), ["party-new", ""]);
  check("the toast does not mention a code that does not exist", await js(`$("#toast").textContent.includes("Party code")`), false);

  console.log("\n— starting from the player —");
  await js(`__reset(); state.playerItem = state.items[0]; $("#player-modal").classList.remove("hidden"); updatePartyButton(); true`);
  check("a signed-in viewer sees Watch together on a film", await js(`$("#player-party").hidden`), false);
  await js(`state.playerItem = { id: "l1", type: "live", name: "Channel" }; updatePartyButton(); true`);
  check("but not on a live channel", await js(`$("#player-party").hidden`), true);
  await js(`state.playerItem = state.items[0]; account.user = null; updatePartyButton(); true`);
  check("nor when signed out", await js(`$("#player-party").hidden`), true);
  await js(`account.user = { id: "me" }; updatePartyButton(); $("#player-party").click(); true`);
  check("the button opens a chooser of friends plus a code option", await js(`[$("#party-chooser").classList.contains("hidden"), [...document.querySelectorAll("#party-chooser [data-party-with]")].map((b) => b.dataset.partyWith)]`), [false, ["friend-1", ""]]);
  await js(`Object.assign(__v, { time: 61, paused: false }); document.querySelector('#party-chooser [data-party-with=""]').click(); true`);
  await new Promise((r) => setTimeout(r, 100));
  check("starting from the player does not restart playback", await js(`__plays`), []);
  check("and the playing video is the party clock straight away", await js(`__log.filter((e) => e.sent && e.sent.startsWith("aurora-party-")).map((e) => e.event)`), ["state"]);
  check("the chooser closes and the button goes while a party runs", await js(`[$("#party-chooser").classList.contains("hidden"), $("#player-party").hidden, !!party.code]`), [true, true, true]);
  await js(`__reset(); updatePartyStrip(); state.playerItem = null; true`);

  console.log("\n— joining by code —");
  await js(`__reset(); __rpcAnswer = { data: [{ id: "party-9", host: "friend-1", fingerprint: "the runner|2026", title: "The Runner", kind: "movie" }], error: null }; joinPartyByCode(" k7p-2qx ").then(() => true)`);
  check("a typed code is cleaned up and sent to the RPC", await js(`__rpcCalls`), [["join_party_by_code", { party_code: "K7P2QX" }]]);
  check("it joins the party channel, as a guest, with the code kept", await js(`[party.id, party.hosting, party.code, party.title]`), ["party-9", false, "K7P2QX", "The Runner"]);
  check("and plays my own copy of the film", await js(`__plays`), ["m1"]);
  await js(`__reset(); __rpcAnswer = { data: [], error: null }; joinPartyByCode("ABCDEF").then(() => true)`);
  check("no row says so", await js(`$("#toast").textContent`), "No open party has that code");
  check("and joins nothing", await js(`[party.id, __plays]`), [null, []]);
  await js(`__reset(); __rpcAnswer = { data: null, error: { code: "PGRST202", message: "Could not find the function" } }; joinPartyByCode("ABCDEF").then(() => true)`);
  check("a database without the function asks for the update", await js(`$("#toast").textContent`), "Party codes need a database update");
  await js(`__reset(); joinPartyByCode("AB").then(() => true)`);
  check("a short code never reaches the server", await js(`__rpcCalls.length`), 0);
  await js(`__reset(); __rpcAnswer = { data: [{ id: "party-9", host: "friend-1", fingerprint: "nothing like it", title: "Other", kind: "movie" }], error: null }; joinPartyByCode("ABCDEF").then(() => true)`);
  check("a film this library lacks is said so, not played", await js(`[$("#toast").textContent, __plays, party.id]`), ["Your provider does not seem to have Other", [], null]);

  console.log("\n— watching now —");
  await js(`__reset(); social.watching = []; social.watchingAt = 0;
    __rpcAnswer = { data: [{ party_id: "p1", code: "K7P2QX", host: "friend-1", display_name: "Sam", title: "The <b>Runner</b>", kind: "movie" }], error: null };
    state.view = "together"; renderTogether(); true`);
  await new Promise((r) => setTimeout(r, 100));
  check("the Together view asks for the list without waiting on it", await js(`__rpcCalls.map((c) => c[0])`), ["friends_watching"]);
  check("and shows a panel with name, title and a Join button", await js(`[$("#watching-panel").classList.contains("hidden"), $("#watching-panel strong").textContent, $("#watching-panel small").textContent, $("#watching-panel [data-watch-code]").dataset.watchCode]`), [false, "Sam", "The <b>Runner</b>", "K7P2QX"]);
  check("titles are text, not markup", await js(`!!$("#watching-panel b")`), false);
  check("the code form is there", await js(`!!$("#party-code-form #party-code")`), true);
  await js(`__plays.length = 0; __rpcAnswer = { data: [{ id: "party-9", host: "friend-1", fingerprint: "the runner|2026", title: "The Runner", kind: "movie" }], error: null }; $("#watching-panel [data-watch-code]").click(); true`);
  await new Promise((r) => setTimeout(r, 100));
  check("Join goes through the code path", await js(`[__rpcCalls.at(-1), party.id]`), [["join_party_by_code", { party_code: "K7P2QX" }], "party-9"]);
  await js(`__reset(); social.watchingAt = 0; account.user = { id: "me" }; __rpcAnswer = { data: [{ party_id: "p1", code: "K7P2QX", host: "friend-1", display_name: "Sam", title: "The Runner", kind: "movie" }], error: null }; social.watching = []; const realHydrate = hydrateHero; window.hydrateHero = () => {}; renderHome(); window.hydrateHero = realHydrate; true`);
  await new Promise((r) => setTimeout(r, 100));
  check("Home carries the same list in a compact row", await js(`(() => { const bar = $("#watching-now"); return bar ? [bar.classList.contains("hidden"), bar.textContent.includes("Sam")] : "no bar" })()`), [false, true]);
  await js(`__reset(); social.watchingAt = 0; __rpcAnswer = { data: null, error: { code: "PGRST202" } }; refreshWatching({ force: true }); true`);
  await new Promise((r) => setTimeout(r, 50));
  check("a failing RPC clears the list (nothing to show) and throws nothing", await js(`social.watching.length`), 0);
  await js(`window.play = __realPlay; state.view = "home"; true`);

  console.log("\n— the page is allowed to open a party at all —");
  // connect-src with http:/https: alone does NOT cover wss: in Chromium, and a
  // party fails with nothing but "transport failure" when it is missing
  const policy = await js(`document.querySelector('meta[http-equiv="Content-Security-Policy"]').content`);
  const connect = /connect-src ([^;]+)/.exec(policy)[1].split(/\s+/);
  check("the policy lets a websocket out", connect.includes("wss:"), true);

  console.log("\n— nothing left the device —");
  check("no request went out while any of this ran", await js(`window.__fetches`), 0);
  await close();
})();
