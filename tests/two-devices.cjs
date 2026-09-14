// Two Aurora devices on one account, against the live account server. Each
// step is a separate launch with its own userData, run in order A1 B1 A2 B2:
//   AURORA_TEST_EMAIL=… AURORA_TEST_PASSWORD=… bash tests/two-devices.sh
// The account must already exist and be confirmed, and should be a test
// account: the run leaves synced rows behind in it.
const fs = require("node:fs"), path = require("node:path");
const { openAurora } = require("./harness.cjs");

const STEP = process.env.STEP, EMAIL = process.env.AURORA_TEST_EMAIL, PASSWORD = process.env.AURORA_TEST_PASSWORD;
const DEVICE = { A: { dir: process.env.DEVICE_A_DIR, port: 41910 }, B: { dir: process.env.DEVICE_B_DIR, port: 41920 } }[STEP[0]];
if (!EMAIL || !PASSWORD || !DEVICE?.dir) { console.log("FAIL  set AURORA_TEST_EMAIL, AURORA_TEST_PASSWORD, DEVICE_A_DIR and DEVICE_B_DIR"); process.exit(1) }
fs.mkdirSync(DEVICE.dir, { recursive: true });

(async () => {
  const { js, check, waitFor, close } = await openAurora({ dataDir: DEVICE.dir, port: DEVICE.port });
  await js(`document.getElementById("source-modal").classList.add("hidden"); true`);
  const signIn = async (password = PASSWORD) => {
    await js(`navigate({ view: "settings" }); account.mode = "signin"; account.error = ""; renderSettings();
      document.getElementById("account-email").value = ${JSON.stringify(EMAIL)};
      document.getElementById("account-password").value = ${JSON.stringify(password)};
      document.getElementById("account-form").requestSubmit(); true`);
  };

  if (STEP === "A1") {
    await signIn("not the password");
    await waitFor(`!account.busy && !!account.error`, 20000);
    check("a wrong password gets a plain message", await js(`account.error`), "That email and password don't match an account.");
    await js(`(async () => {
      upsertSource({ id: "src-a", name: "Test provider", server: "http://127.0.0.1:8765", username: "demo", password: "demo-secret-123", count: 7 });
      await saveSecrets({ ...(secrets || {}), tmdb: "tmdb-test-key-xyz", omdb: "" }); writePref("keysUpdatedAt", Date.now());
      toggleFavorite({ id: "movie-11" }); toggleFavorite({ id: "series-21" });
      saveProgress({ key: "movie-11", id: "movie-11", type: "movie", title: "Mayday", subtitle: "Action", position: 1800, duration: 6000 });
      saveProgress({ key: "episode-102", id: "series-21", type: "episode", title: "The Bear", subtitle: "S1 E2", position: 200, duration: 1860 });
      return true;
    })()`);
    await signIn();
    check("device A signs in and syncs", await waitFor(`!!account.user && !account.busy && !account.syncing && account.lastSync > 0`), true);
    check("no sync error", await js(`account.error`), "");
    check("the session is in the keychain store, not in prefs", await js(`[!!secrets.auth, JSON.stringify(window.aurora.prefs).includes("access_token")]`), [true, false]);
  }

  if (STEP === "B1") {
    check("a fresh device starts empty", await js(`[readSources().length, state.favorites.size, state.progress.size]`), [0, 0, 0]);
    await signIn();
    check("device B signs in and syncs", await waitFor(`!!account.user && !account.busy && !account.syncing && account.lastSync > 0`), true);
    check("the source arrives and unlocks", await js(`readSources().map((s) => [s.name, s.username, s.password])`), [["Test provider", "demo", "demo-secret-123"]]);
    check("the TMDB key arrives", await js(`secrets.tmdb`), "tmdb-test-key-xyz");
    check("favourites arrive", await js(`[...state.favorites].sort()`), ["movie-11", "series-21"]);
    check("resume points arrive", await js(`state.progress.get("movie-11")?.position`), 1800);
    await js(`(async () => {
      toggleFavorite({ id: "series-21" }); toggleFavorite({ id: "live-1" });
      forgetProgress(["episode-102"]);
      saveProgress({ key: "movie-11", id: "movie-11", type: "movie", title: "Mayday", subtitle: "Action", position: 3600, duration: 6000 });
      await syncNow(); return true;
    })()`);
    check("B's changes go up without error", await js(`account.error`), "");
  }

  if (STEP === "A2") {
    check("device A restores its session on launch", await waitFor(`!!account.user && account.lastSync > 0 && !account.syncing`), true);
    check("an unfavourite from B arrives", await js(`state.favorites.has("series-21")`), false);
    check("a new favourite from B arrives", await js(`state.favorites.has("live-1")`), true);
    check("a history removal from B arrives", await js(`state.progress.has("episode-102")`), false);
    check("a newer resume point from B wins", await js(`state.progress.get("movie-11")?.position`), 3600);
    await js(`(async () => { await removeSource("src-a"); await syncNow(); return true })()`);
  }

  if (STEP === "B2") {
    check("device B restores its session", await waitFor(`!!account.user && account.lastSync > 0 && !account.syncing`), true);
    check("the source removal from A arrives", await js(`readSources().length`), 0);
    check("and B does not put it back", await js(`syncNow().then(() => readSources().length)`), 0);
    await js(`signOut().then(() => true)`);
    check("signing out clears the session and vault key", await js(`[!!account.user, !!secrets.auth, !!secrets.vault]`), [false, false, false]);
    check("signing out keeps this device's data", await js(`state.favorites.has("live-1")`), true);
  }
  await close();
})();
