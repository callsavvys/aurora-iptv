/* Where the site runs: a browser (through its own server, which relays your
   provider's lists and streams, as a browser page may not fetch them itself)
   or the Aurora app on a TV or phone (Capacitor, whose native HTTP has no such
   limit, so it asks the provider directly). The app build is `vite build
   --mode app` (site/vite.config.js); in it, routes live after a # because
   there is no server to answer /title/... */
export const IS_APP = import.meta.env.MODE === "app";
/* a television, not a phone: a TV's own name, Android without "Mobile" (every
   Android phone says it; an Android TV does not), or no touch screen at all */
const touch = () => "ontouchstart" in window || navigator.maxTouchPoints > 0;
// dev: ?tv=1 previews the TV app, and stays on for the tab as you move between pages
const devTV = () => { if (!import.meta.env.DEV) return false; try { if (new URLSearchParams(location.search).has("tv")) sessionStorage.setItem("aurora-dev-tv", "1"); return sessionStorage.getItem("aurora-dev-tv") === "1"; } catch { return false; } };
export const isTV = () => devTV() || IS_APP && (/\bGoogleTV\b|\bLeanback|\bAFT|\bBRAVIA|Android TV|SMART-TV/i.test(navigator.userAgent) || (/Android/.test(navigator.userAgent) && !/Mobile/.test(navigator.userAgent)) || !touch());
/* the phone app (safe areas: phone.css) */
export const isPhone = () => IS_APP && !isTV();
/* a provider's address, as this page can fetch it */
export const relay = (url) => (IS_APP ? url : `/api/proxy?u=${encodeURIComponent(url)}`);
/* Trakt's token exchange needs the relay (it holds the app's secret) */
export const canTrakt = !IS_APP;

/* In the app, before the first page: your line, kept in the system's own app
   storage (Capacitor Preferences) as well as the page's, since Android may
   clear a web view's storage; and on a TV that ran the old Aurora, its saved
   line (its `secrets`), so updating keeps you connected. */
const LINE = "aurora-site-line";
const prefs = () => window.Capacitor?.Plugins?.Preferences;
export async function appStart() {
  const store = prefs();
  if (!IS_APP || !store) return;
  try {
    if (!localStorage.getItem(LINE)) {
      const mine = (await store.get({ key: "site.line" })).value;
      if (mine) localStorage.setItem(LINE, mine);
      else {
        const old = JSON.parse((await store.get({ key: "secrets" })).value || "null");
        const s = (old?.sources || []).find((x) => x?.server && x?.username);
        if (s) localStorage.setItem(LINE, JSON.stringify({ kind: "xtream", name: s.name || "My IPTV", server: s.server, username: s.username, password: s.password || "" }));
      }
    }
  } catch { /* nothing saved yet */ }
  // the old app's vault key (its sources are sealed with it): kept for vault.js to try, so no password is asked again
  try {
    const old = JSON.parse((await store.get({ key: "secrets" })).value || "null");
    if (old?.vault?.key && old?.vault?.salt) localStorage.setItem("aurora-site-oldvault", JSON.stringify({ key: old.vault.key, salt: old.vault.salt }));
  } catch { /* none */ }
}
/* line.js calls this whenever the line changes, so the app's own storage keeps a copy */
export function keepLine(value) {
  const store = prefs();
  if (!IS_APP || !store) return;
  (value == null ? store.remove({ key: "site.line" }) : store.set({ key: "site.line", value })).catch(() => {});
}

/* this run of the app: has an account and a source been picked yet? (the app
   asks both every time it opens; the page reloading is a new run) */
const run = { account: false, source: false };
export const pickedAccount = () => { run.account = true; };
export const pickedSource = () => { run.source = true; };
export const pickedThisRun = () => ({ ...run });
