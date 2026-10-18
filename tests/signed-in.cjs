// What signing in has to do on the device: bring the library down, keep the
// session, and never mistake an unreadable store for an empty one.
//   npx electron tests/signed-in.cjs
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), http = require("node:http");
const { openAurora } = require("./harness.cjs");

const PROVIDER_PORT = 41941;
let asked = 0;
const CATEGORIES = [{ category_id: "1", category_name: "Drama" }];
const BODIES = {
  get_live_categories: CATEGORIES, get_vod_categories: CATEGORIES, get_series_categories: CATEGORIES,
  get_live_streams: [{ stream_id: 1, name: "Test One", category_id: "1", added: "1700000000" }],
  get_vod_streams: [{ stream_id: 2, name: "Test Film", category_id: "1", container_extension: "mp4", added: "1700000000" }],
  get_series: [{ series_id: 3, name: "Test Series", category_id: "1", last_modified: "1700000000" }],
};
const provider = http.createServer((request, response) => {
  const action = new URL(request.url, "http://x").searchParams.get("action") || "";
  asked += 1;
  response.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
  response.end(JSON.stringify(BODIES[action] ?? {}));
});

(async () => {
  await new Promise((done) => provider.listen(PROVIDER_PORT, "127.0.0.1", done));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aurora-signed-"));
  // a store this build cannot unlock — the keychain refusing a new signature
  // looks exactly like this from the renderer's side
  fs.writeFileSync(path.join(dataDir, "secrets.bin"), Buffer.from("v10 not a real encrypted blob"));
  const { js, check, waitFor, close } = await openAurora({ dataDir, port: 41940 });
  await js(`document.getElementById("source-modal").classList.add("hidden"); true`);

  const aside = () => fs.readdirSync(dataDir).filter((name) => name.startsWith("secrets.bin.locked"));

  console.log("— a store that cannot be unlocked at all —");
  check("the blob is set aside under one fixed name", aside(), ["secrets.bin.locked"]);
  check("so the app may start a fresh store", await js(`[Object.keys(secrets).length, secretsLocked]`), [0, false]);
  await js(`saveSecrets({ ...(secrets || {}), tmdb: "fresh-key" }).then(() => true)`);
  check("and the copy survives that write", aside().length, 1);

  console.log("\n— a store that cannot be read right now —");
  // a keychain that is not awake yet behaves like this: readable later, so the
  // file must survive. An unreadable file is easy to arrange; a sleeping
  // keychain is not, and both take the same branch in main.cjs
  fs.chmodSync(path.join(dataDir, "secrets.bin"), 0o000);
  check("the main process says to wait, not to replace it", await js(`(async () => { const r = await window.aurora.getSecrets(); return [Boolean(r && r.unreadable), r && r.retryable === true] })()`), [true, true]);
  check("and it leaves the file alone", [fs.existsSync(path.join(dataDir, "secrets.bin")), aside().length], [true, 1]);
  fs.chmodSync(path.join(dataDir, "secrets.bin"), 0o600);
  check("while locked, nothing is written over it", await js(`(async () => {
    secretsLocked = true;
    const refused = await saveSecrets({ wiped: true }, { quiet: true });
    const held = JSON.stringify(secrets).includes("wiped"); // this run only, in memory
    secretsLocked = false;
    await loadSecrets(); // whatever is actually on disk
    return [refused.saved === false, refused.locked === true, held, secrets.tmdb];
  })()`), [true, true, true, "fresh-key"]);

  console.log("\n— a source with nothing cached —");
  // the local proxy refuses private addresses on purpose, so this test reaches
  // the stand-in provider the way the iPhone build does: straight out
  await js(`window.fetchJson = async (url) => { const response = await fetch(url); return response.json() }; true`);
  await js(`(async () => {
    upsertSource({ id: "src", name: "Test provider", server: "http://127.0.0.1:${PROVIDER_PORT}", username: "demo", password: "demo" });
    writePref("activeSource", undefined); state.provider = null; state.items = []; ensureLibrary.done = false;
    return true;
  })()`);
  await js(`ensureLibrary().then(() => true)`);
  check("signing in loads the library instead of asking", await js(`[state.items.length, state.view]`), [3, "home"]);
  check("the source remembers what it holds", await js(`readSources()[0].count`), 3);
  const calls = asked;
  await js(`ensureLibrary().then(() => true)`);
  check("and it does not download it again every sync", asked, calls);

  console.log("\n— a sync that half fails —");
  await js(`(async () => {
    await saveLibrary([], "src"); state.items = []; state.provider = null; ensureLibrary.done = false;
    writePref("activeSource", undefined);
    account.user = { id: "test-user" };
    window.syncVault = async () => 1; window.pushChanges = async () => { throw new Error("network went away") }; window.pullChanges = async () => false;
    await syncNow({ quiet: true });
    return true;
  })()`);
  check("the failure is reported", await js(`account.error`), "Could not reach the sync server — it will try again");
  // the sync call does not wait for the download, so neither does the user
  check("but the library still arrives", await waitFor(`state.items.length === 3 && state.view === "home"`, 15000), true);

  console.log("\n— a sync asked for while one is running —");
  check("the second ask runs after the first instead of vanishing", await js(`(async () => {
    account.user = { id: "test-user" }; ensureLibrary.done = true;
    let started = 0;
    window.syncVault = async () => { started += 1; await new Promise((r) => setTimeout(r, 300)); return 0 };
    window.pushChanges = async () => {}; window.pullChanges = async () => false;
    const first = syncNow({ quiet: true });
    await new Promise((r) => setTimeout(r, 50));
    await syncNow({ quiet: true }); // lands while the first is still going
    await first;
    return started;
  })()`), 2);

  console.log("\n— signing in more than once —");
  check("the sync timer is wired once, not once per token", await js(`(async () => {
    const realSet = window.setInterval; let timers = 0;
    window.setInterval = (...args) => { timers += 1; return realSet(...args) };
    syncWired = false; account.user = null;
    window.syncVault = async () => 0; window.pushChanges = async () => {}; window.pullChanges = async () => false;
    for (let i = 0; i < 3; i += 1) startSync({ id: "test-user", email: "someone@example.com" }, { sync: false });
    window.setInterval = realSet;
    return timers;
  })()`), 1);

  console.log("\n— a session that will not open yet —");
  await js(`(async () => {
    account.user = null; account.offline = false; syncWired = false;
    await saveSecrets({ ...(secrets || {}), auth: { "aurora-auth": "{\\"refresh_token\\":\\"stale\\"}" } }, { quiet: true });
    account.client = { auth: { getSession: async () => ({ data: {} }), onAuthStateChange() {} } };
    startAccount();
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 600));
  check("the app says it is reconnecting, not signed out", await js(`account.offline`), true);
  await js(`navigate({ view: "settings" }); renderSettings(); true`);
  check("so Settings offers no sign-in form", await js(`[!!document.getElementById("account-form"), /Reconnecting/.test(document.body.textContent)]`), [false, true]);

  provider.close();
  await close();
})();
