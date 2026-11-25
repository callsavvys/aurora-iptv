/* Automatic updates, the app's side (site/ota-plugin.cjs has the loader).
   A while after the app starts, it reads manifest.json from the app-live
   pre-release on GitHub; when that bundle is newer than the one running, it
   downloads the JS and CSS, checks them against the manifest's SHA-256, and
   keeps them in IndexedDB. The next time the app starts, the loader runs it. */
import { IS_APP } from "./platform.js";

export const LIVE = "https://github.com/callsavvys/aurora-iptv/releases/download/app-live/";

function db() {
  return new Promise((ok, no) => {
    const rq = indexedDB.open("aurora-ota", 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore("b");
    rq.onsuccess = () => ok(rq.result);
    rq.onerror = () => no(rq.error);
  });
}
async function stored() {
  const d = await db();
  return new Promise((ok) => { const g = d.transaction("b").objectStore("b").get("current"); g.onsuccess = () => ok(g.result || null); g.onerror = () => ok(null); });
}
async function keep(rec) {
  const d = await db();
  return new Promise((ok, no) => { const t = d.transaction("b", "readwrite"); t.objectStore("b").put(rec, "current"); t.oncomplete = () => ok(); t.onerror = () => no(t.error); });
}
async function sha256(text) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function text(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.text();
}

/* returns what happened, for the console and tests */
export async function checkForUpdate() {
  const shell = window.__AURORA_SHELL__, run = window.__AURORA_RUN__;
  if (!shell || !run) return "no loader";
  const m = JSON.parse(await text(`${LIVE}manifest.json?t=${Date.now()}`));
  if (!(m.v > run.build)) return "up to date";
  if (!(m.api <= shell.api)) return "needs a newer app";
  let bad = 0; try { bad = Number(localStorage.getItem("aurora-ota-bad")) || 0; } catch { /* private mode */ }
  if (m.v === bad) return "that update failed before";
  const have = await stored().catch(() => null);
  if (have && have.v >= m.v) return "already downloaded";
  const [js, css] = await Promise.all([text(LIVE + m.js), text(LIVE + m.css)]);
  if ((await sha256(js)) !== m.jsSha || (await sha256(css)) !== m.cssSha) return "download did not match";
  await keep({ v: m.v, api: m.api, version: m.version, js, css });
  return `downloaded ${m.version || ""} (${m.v}), runs on the next start`;
}

export function startUpdates() {
  if (!IS_APP || !window.__AURORA_SHELL__) return;
  const run = window.__AURORA_RUN__ || {};
  console.info("[aurora update] running build", run.build, run.ota ? "(downloaded update)" : "(the app's own copy)");
  setTimeout(() => { checkForUpdate().then((r) => console.info("[aurora update]", r), (e) => console.info("[aurora update] not checked:", e?.message || e)); }, 8000);
}
