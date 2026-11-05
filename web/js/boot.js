/* Starts the app. On the television it first waits for platform-core.js to read
   the saved data, because every screen reads it synchronously; in the browser
   there is nothing to wait for.

   If the television's storage never answers, the app starts anyway, read-only:
   it saves nothing, so nothing can be overwritten, and a banner says so with a
   way to try again. */
import { BOOT_TIMEOUT_MS, BOOT_RETRIES } from "./limits.js";

const TRIES = "aurora-boot-tries";
const timeoutMs = Number(new URLSearchParams(location.search).get("bootTimeout")) || BOOT_TIMEOUT_MS;

async function waitForStorage() {
  if (!window.auroraReady) return { ok: true };
  const started = Date.now();
  let timer;
  const gaveUp = new Promise((resolve) => { timer = setTimeout(() => resolve("timeout"), timeoutMs); });
  const result = await Promise.race([window.auroraReady.then(() => "ready", () => "failed"), gaveUp]);
  clearTimeout(timer);
  return { ok: result === "ready", result, waited: Date.now() - started };
}

function readOnlyBanner(detail) {
  const tries = Number(sessionStorage.getItem(TRIES) || 0);
  const banner = document.createElement("div");
  banner.className = "boot-banner";
  banner.setAttribute("role", "alert");
  banner.innerHTML = `<p><b>Your saved lines and lists could not be opened.</b> Aurora is running without saving anything, so nothing can be overwritten.</p>
    <div class="actions"></div><p class="detail" hidden></p>`;
  const actions = banner.querySelector(".actions");
  const button = (label, fn) => { const b = document.createElement("button"); b.className = "btn"; b.setAttribute("data-f", ""); b.textContent = label; b.addEventListener("click", fn); actions.appendChild(b); return b; };
  if (tries < BOOT_RETRIES) button("Try again", () => { sessionStorage.setItem(TRIES, String(tries + 1)); location.reload(); });
  button("Continue without saving", () => banner.remove());
  button("Details", () => { const d = banner.querySelector(".detail"); d.textContent = detail; d.hidden = !d.hidden; });
  document.body.appendChild(banner);
}

const storage = await waitForStorage();
const platform = await import("./platform.js");
if (storage.ok) {
  sessionStorage.removeItem(TRIES);
  // what this build remembers, loaded before any screen asks for it
  if (window.aurora?.store) await window.aurora.store.load(platform.STORE_KEY);
} else {
  const detail = `E_BOOT_STORAGE_TIMEOUT ${storage.result === "failed" ? "storage failed" : `waited ${storage.waited}ms`} on Preferences.get(secrets, prefs); capacitor ${window.Capacitor?.version || "unknown"}; build ${document.documentElement.dataset.version || "web"}`;
  platform.setReadOnly(detail);
  readOnlyBanner(platform.redact(detail));
}
await import("./app.js");
