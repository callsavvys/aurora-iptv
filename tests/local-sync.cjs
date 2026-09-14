// What account sync changed in the app while signed out: nothing may reach the
// network, and every local change must still be recorded so it can sync later.
//   npx electron tests/local-sync.cjs
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { openAurora } = require("./harness.cjs");

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aurora-local-"));
  const { js, check, close } = await openAurora({ dataDir, port: 41930 });
  await js(`document.getElementById("source-modal").classList.add("hidden");
    window.__calls = 0; const realClient = accountClient; window.accountClient = () => { window.__calls += 1; return realClient() }; true`);

  console.log("— favourites —");
  await js(`toggleFavorite({ id: "movie-1" }); toggleFavorite({ id: "movie-2" }); toggleFavorite({ id: "movie-2" }); true`);
  check("toggling keeps the right set", await js(`[...state.favorites]`), ["movie-1"]);
  check("each favourite remembers which way it last went", await js(`Object.entries(readPref("favoriteTimes", {})).map(([id, t]) => [id, t.saved, typeof t.at])`), [["movie-1", true, "number"], ["movie-2", false, "number"]]);
  check("both wait to sync, including the removal", await js(`Object.keys(readPref("syncDirty", {}).favorites).sort()`), ["movie-1", "movie-2"]);

  console.log("\n— history —");
  // with no provider, render() shows the welcome screen instead of any page
  await js(`state.provider = { id: "p", name: "Test", server: "http://127.0.0.1:9", username: "u", password: "p" }; state.items = [{ id: "movie-1", type: "movie", name: "x" }]; true`);
  await js(`for (const [key, id, type] of [["movie-1", "movie-1", "movie"], ["episode-11", "series-1", "episode"], ["episode-12", "series-1", "episode"], ["episode-21", "series-2", "episode"]])
      saveProgress({ key, id, type, title: id, subtitle: key, position: 300, duration: 3000 }); true`);
  check("saving progress marks it for sync", await js(`Object.keys(readPref("syncDirty", {}).progress).sort()`), ["episode-11", "episode-12", "episode-21", "movie-1"]);
  await js(`state.view = "history"; renderHistory(); document.querySelector('[data-forget-show="series-1"]').click(); document.querySelector("[data-forget-show-confirm]").click(); true`);
  check("removing a show removes only its episodes", await js(`[...state.progress.keys()].sort()`), ["episode-21", "movie-1"]);
  check("and remembers those removals", await js(`Object.keys(readPref("progressGone", {})).sort()`), ["episode-11", "episode-12"]);
  await js(`renderHistory(); document.querySelector('[data-forget-key="movie-1"]').click(); true`);
  check("removing one entry works", await js(`state.progress.has("movie-1")`), false);
  await js(`renderHistory(); document.getElementById("clear-history").click(); true`);
  check("clearing still asks first", await js(`[!!document.querySelector("[data-clear-history-confirm]"), state.progress.size]`), [true, 1]);
  await js(`document.querySelector("[data-clear-history-confirm]").click(); true`);
  check("clearing empties history", await js(`[state.progress.size, document.querySelector(".empty h2")?.textContent]`), [0, "Nothing watched yet"]);
  check("and remembers every removal", await js(`Object.keys(readPref("progressGone", {})).sort()`), ["episode-11", "episode-12", "episode-21", "movie-1"]);
  await js(`saveProgress({ key: "movie-9", id: "movie-9", type: "movie", title: "x", position: 100, duration: 1000 }); hideFromContinue(["movie-9"]); true`);
  check("hiding from Continue watching keeps history", await js(`[state.progress.has("movie-9"), state.progress.get("movie-9").hidden]`), [true, true]);

  console.log("\n— sources —");
  await js(`upsertSource({ id: "s1", name: "One", server: "http://a.example", username: "u", password: "p" }); true`);
  const stamped = await js(`readSources()[0].updatedAt`);
  check("a real edit is stamped", typeof stamped, "number");
  await new Promise((r) => setTimeout(r, 20));
  await js(`upsertSource({ id: "s1", count: 500 }); true`);
  check("a new library count is not an account change", await js(`readSources()[0].updatedAt`), stamped);
  await js(`removeSource("s1").then(() => true)`);
  check("a removed source is remembered by its login", await js(`Object.keys(readPref("sourcesRemoved", {}))`), ["http://a.example|u"]);

  console.log("\n— signed out —");
  check("no account session", await js(`account.user`), null);
  await js(`navigate({ view: "settings" }); renderSettings(); true`);
  check("settings offers sign in", await js(`[!!document.getElementById("account-form"), document.querySelector("#account-form button[type=submit]").textContent]`), [true, "Sign in"]);
  await js(`document.querySelector('[data-account="mode-signup"]').click(); true`);
  check("and account creation, with the password warning", await js(`[document.querySelector("#account-form button[type=submit]").textContent, /can't be unlocked/.test(document.querySelector("#account-form .keys-note")?.textContent || "")]`), ["Create account", true]);
  await js(`document.getElementById("account-email").value = "someone@example.com"; document.getElementById("account-password").value = "short"; document.getElementById("account-form").requestSubmit(); true`);
  check("a short password is refused before any request", await js(`account.error`), "Use at least 8 characters — this password also seals your saved sources.");
  check("nothing talked to the account server", await js(`window.__calls`), 0);
  await close();
})();
