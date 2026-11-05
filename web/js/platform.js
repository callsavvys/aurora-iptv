/* The only module that knows where the app is running.

   In a Mac browser (npm run web) a provider refuses a page that asks it
   directly, so its requests go through the local server's /api/proxy, the keys
   come from /config.js, and what the app remembers lives in localStorage.

   On the television (the APK built with AURORA_TV_UI=web) platform-core.js has
   set up window.aurora before this runs: requests go straight out, because
   Capacitor's native HTTP has no CORS; the keys are in the config.js the build
   wrote; and what the app remembers is kept in the system's own storage through
   window.aurora.store.

   Until the shared store lands (the plan's second PR), the TV build reads the
   old app's sources but never writes the old app's keys: everything it
   remembers goes under its own key. */

/* boot.js imports this only after window.auroraReady has settled, or after it
   gave up waiting; in that case there is no window.aurora and the app runs
   read-only, but it is still on the television. */
const aurora = window.aurora?.store ? window.aurora : null;
export const native = !!aurora || !!window.Capacitor?.isNativePlatform?.();
export const config = window.AURORA_CONFIG || {};
export const trace = !!aurora?.trace;

// ---------------- network ----------------
/* The URL to fetch for a provider URL. */
export const net = {
  url: (url) => (native ? url : `/api/proxy?u=${encodeURIComponent(url)}`),
  /* true when `url` is one this module routed, so errors can name "your
     provider" instead of the local server */
  routed: (url) => native || String(url).startsWith("/api/proxy"),
};
/* hls.js segment and playlist URLs. On the TV, CapacitorHttp's patched XHR
   reaches the provider as it does for the old app, so nothing changes. */
export const streamUrl = (url) => net.url(url);

// ---------------- storage ----------------
/* The key this build keeps everything it remembers under. */
export const STORE_KEY = native ? (trace ? "web.trace" : "web.prefs") : "aurora-web";

let readOnly = native && !aurora;
export const isReadOnly = () => readOnly;
export const setReadOnly = (why) => { readOnly = true; log(`read-only: ${why}`); };

export const storage = {
  /* synchronous, from what boot loaded */
  get(key) {
    if (native) return aurora ? aurora.store.read(key) : null;
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  },
  /* resolves true when saved */
  async set(key, value) {
    if (readOnly || (native && !aurora)) return false;
    if (native) return aurora.store.write(key, value);
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  },
};

/* The line the old app was playing, read-only, for a TV build that has not
   been given one of its own. */
export function legacySource() {
  if (!aurora) return null;
  const secrets = aurora.store.read("secrets");
  const list = Array.isArray(secrets?.sources) ? secrets.sources : [];
  const activeId = aurora.store.read("prefs")?.activeSource || list[0]?.id;
  const s = list.find((x) => x.id === activeId) || list[0];
  if (!s?.server || !s.username) return null;
  return { kind: "xtream", id: s.id, name: s.name || "My IPTV", server: s.server, username: s.username, password: s.password || "" };
}

// ---------------- the rest ----------------
/* Back on the remote. The handler returns true when it used the press; false
   lets the television leave the app. */
export function onBack(handler) {
  if (aurora?.onBack) aurora.onBack(handler);
}
export const version = async () => (aurora?.version ? aurora.version() : "web");

const SECRET_QUERY = /([?&](?:username|password|token|key|api_key|apikey)=)[^&\s#"']*/gi;
const SECRET_PATH = /\/(live|movie|series|timeshift)\/[^/\s?#]+\/[^/\s?#]+\//gi;
/* Provider URLs carry the account's login; no screen, log or trace may. */
export const redact = (text) => (aurora?.redact ? aurora.redact(text)
  : String(text ?? "").replace(SECRET_PATH, "/$1/***/***/").replace(SECRET_QUERY, "$1***"));
export const log = (message) => console.log(`[aurora] ${redact(message)}`);
