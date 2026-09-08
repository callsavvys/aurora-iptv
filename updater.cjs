const { app, ipcMain } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");

const FIRST_CHECK_DELAY = 15000;
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
const BUNDLE_ID = "com.aurora.iptv";
const ALLOWED_HOSTS = ["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"];

const run = (command, args) => new Promise((resolve, reject) => {
  execFile(command, args, { maxBuffer: 1 << 20 }, (error, stdout) => (error ? reject(error) : resolve(String(stdout))));
});

const quote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

function compareVersions(left, right) {
  const a = String(left).replace(/^v/, "").split(".").map(Number);
  const b = String(right).replace(/^v/, "").split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const x = a[index] || 0, y = b[index] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

function bundlePath() {
  const marker = `${path.sep}Contents${path.sep}MacOS${path.sep}`;
  const index = app.getPath("exe").indexOf(marker);
  return index === -1 ? null : app.getPath("exe").slice(0, index);
}

function createUpdater(getWindow, config) {
  const { repository, asset } = config || {};
  let status = { state: "idle" };
  let staged = null;
  let timer = null;

  const publish = (next) => {
    status = { ...next };
    getWindow()?.webContents.send("updater:status", status);
  };

  async function fetchLatest() {
    const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": `Aurora-IPTV/${app.getVersion()}` },
    });
    if (response.status === 404) throw new Error("No release has been published yet");
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
    return response.json();
  }

  async function download(url, destination) {
    if (!ALLOWED_HOSTS.includes(new URL(url).hostname)) throw new Error("The update is not hosted on GitHub");
    const response = await fetch(url, { headers: { "User-Agent": `Aurora-IPTV/${app.getVersion()}`, Accept: "application/octet-stream" }, redirect: "follow" });
    if (!response.ok) throw new Error(`Download failed with ${response.status}`);
    if (!ALLOWED_HOSTS.includes(new URL(response.url).hostname)) throw new Error("The update redirected off GitHub");
    const total = Number(response.headers.get("content-length")) || 0;
    const file = fs.createWriteStream(destination);
    const reader = response.body.getReader();
    let received = 0, lastReported = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (!file.write(Buffer.from(value))) await new Promise((resolve) => file.once("drain", resolve));
      const percent = total ? Math.round((received / total) * 100) : 0;
      if (percent >= lastReported + 5) { lastReported = percent; publish({ ...status, state: "downloading", percent }) }
    }
    await new Promise((resolve) => file.end(resolve));
  }

  async function verify(directory, expectedVersion) {
    const bundle = fs.readdirSync(directory).find((name) => name.endsWith(".app"));
    if (!bundle) throw new Error("The download did not contain an app");
    const target = path.join(directory, bundle);
    await run("/usr/bin/codesign", ["--verify", "--deep", target]);
    const identifier = await run("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIdentifier", path.join(target, "Contents/Info.plist")]);
    if (identifier.trim() !== BUNDLE_ID) throw new Error("The download is not Aurora");
    const version = await run("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleShortVersionString", path.join(target, "Contents/Info.plist")]);
    if (compareVersions(version.trim(), app.getVersion()) <= 0) throw new Error("The download is not newer than the installed app");
    if (expectedVersion && compareVersions(version.trim(), expectedVersion) !== 0) throw new Error("The download does not match the announced version");
    return target;
  }

  async function check({ manual = false } = {}) {
    if (!repository || !asset) return;
    if (!app.isPackaged) { if (manual) publish({ state: "skipped", message: "Updates are off while running from source" }); return }
    if (status.state === "downloading" || status.state === "ready") return;
    try {
      publish({ state: "checking" });
      const release = await fetchLatest();
      const version = String(release.tag_name || "").replace(/^v/, "");
      if (!version || compareVersions(version, app.getVersion()) <= 0) {
        publish({ state: "none", message: manual ? "Aurora is up to date" : "" });
        return;
      }
      const file = (release.assets || []).find((entry) => entry.name === asset);
      if (!file) throw new Error(`Release ${version} has no ${asset}`);
      publish({ state: "downloading", version, percent: 0 });
      const work = path.join(app.getPath("temp"), `aurora-update-${version}`);
      fs.rmSync(work, { recursive: true, force: true });
      fs.mkdirSync(work, { recursive: true });
      const archive = path.join(work, asset);
      await download(file.browser_download_url, archive);
      publish({ state: "verifying", version });
      const unpacked = path.join(work, "unpacked");
      await run("/usr/bin/ditto", ["-x", "-k", archive, unpacked]);
      staged = await verify(unpacked, version);
      publish({ state: "ready", version, notes: release.body || "" });
    } catch (error) {
      staged = null;
      publish({ state: "error", message: error.message || "The update check failed" });
    }
  }

  function install() {
    const target = bundlePath();
    if (!staged || !target) return false;
    const backup = `${target}.aurora-old`;
    const script = path.join(app.getPath("temp"), "aurora-apply-update.sh");
    fs.writeFileSync(script, [
      "#!/bin/sh",
      `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.2; done`,
      `rm -rf ${quote(backup)}`,
      `mv ${quote(target)} ${quote(backup)} || exit 1`,
      `if /usr/bin/ditto ${quote(staged)} ${quote(target)}; then`,
      `  rm -rf ${quote(backup)}`,
      "else",
      `  rm -rf ${quote(target)}`,
      `  mv ${quote(backup)} ${quote(target)}`,
      "fi",
      `/usr/bin/open ${quote(target)}`,
      "",
    ].join("\n"), { mode: 0o755 });
    spawn("/bin/sh", [script], { detached: true, stdio: "ignore" }).unref();
    app.quit();
    return true;
  }

  ipcMain.handle("updater:check", () => check({ manual: true }));
  ipcMain.handle("updater:status", () => status);
  ipcMain.handle("updater:install", () => install());
  ipcMain.handle("app:version", () => app.getVersion());

  timer = setInterval(() => check(), CHECK_INTERVAL);
  setTimeout(() => check(), FIRST_CHECK_DELAY);

  return { check, stop: () => clearInterval(timer) };
}

module.exports = { createUpdater, compareVersions };
