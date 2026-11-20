/* Where the site runs: a browser (through its own server, which relays your
   provider's lists and streams, as a browser page may not fetch them itself)
   or the Aurora app on a TV or phone (Capacitor, whose native HTTP has no such
   limit, so it asks the provider directly). The app build is `vite build
   --mode app` (site/vite.config.js); in it, routes live after a # because
   there is no server to answer /title/... */
export const IS_APP = import.meta.env.MODE === "app";
export const isTV = () => (import.meta.env.DEV && new URLSearchParams(location.search).has("tv")) || IS_APP && (document.documentElement.classList.contains("platform-tv") || /\bAndroid\b.*\b(TV|AFT|BRAVIA|Streamer)\b|\bGoogleTV\b|\bLeanback/i.test(navigator.userAgent) || window.innerWidth <= 1000 && window.innerHeight <= 600 && !("ontouchstart" in window));
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
}
/* line.js calls this whenever the line changes, so the app's own storage keeps a copy */
export function keepLine(value) {
  const store = prefs();
  if (!IS_APP || !store) return;
  (value == null ? store.remove({ key: "site.line" }) : store.set({ key: "site.line", value })).catch(() => {});
}
