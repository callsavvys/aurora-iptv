// An older "Aurora" with a previous download of the latest release left in the
// temp folder — the leftover contains Contents/Resources/app.asar, which is
// what made the updater fail with ENOTDIR before it used original-fs.
// Downloads the real latest release from GitHub, so it needs network.
//   npm run test:updater
const { app } = require("electron");
const path = require("node:path"), ofs = require("original-fs");
Object.defineProperty(app, "isPackaged", { get: () => true, configurable: true }); // behave as the installed app

app.whenReady().then(async () => {
  const { createUpdater } = require(path.resolve(__dirname, "../../updater.cjs"));
  const latest = await fetch("https://api.github.com/repos/callsavvys/aurora-iptv/releases/latest", { headers: { Accept: "application/vnd.github+json", "User-Agent": "aurora-updater-test" } }).then((r) => r.json());
  const version = String(latest.tag_name || "").replace(/^v/, "");
  const leftover = path.join(app.getPath("temp"), `aurora-update-${version}`, "unpacked", "Aurora IPTV.app", "Contents", "Resources");
  ofs.mkdirSync(leftover, { recursive: true });
  ofs.writeFileSync(path.join(leftover, "app.asar"), Buffer.alloc(64)); // any file named .asar trips node:fs

  const states = [];
  let message = "";
  const updater = createUpdater(() => ({ webContents: { send: (_c, s) => { states.push(s.state); if (s.message) message = s.message } } }),
    { repository: "callsavvys/aurora-iptv", asset: "Aurora-IPTV-Mac-Apple-Silicon.zip" });
  await updater.check({ manual: true });
  updater.stop();
  ofs.rmSync(path.join(app.getPath("temp"), `aurora-update-${version}`), { recursive: true, force: true });

  const ok = states.at(-1) === "ready";
  console.log(`${ok ? "  ok  " : "FAIL  "}update to ${version} with a leftover download present: ${[...new Set(states)].join(" -> ")}${ok ? "" : ` (${message})`}`);
  console.log(ok ? "\nall passed" : "\n1 failed");
  app.exit(ok ? 0 : 1);
});
