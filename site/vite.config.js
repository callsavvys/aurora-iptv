import { defineConfig, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";

// the TMDB key and the account server (its public address and publishable
// key) come from the one place the apps keep it (app/renderer.js),
// read at build time, so it is never written into this folder
const require = createRequire(import.meta.url);
const { extractKeys } = require("../scripts/extract-keys.cjs");
const keys = extractKeys();
const { relayPlugin } = require("./relay.cjs");
const { otaPlugin } = require("./ota-plugin.cjs");
// your own free Trakt and Simkl apps (Settings → Account → Trakt, Simkl), kept
// out of git in trackers.local.json; only the public client ids reach the page
const trackers = (() => { try { return require("./trackers.local.json"); } catch { return {}; } })();

// `vite build --mode app` is the TV and phone apps' copy (mobile/scripts/build-android.sh):
// relative paths, as it loads from the APK's own files
export default defineConfig(({ mode }) => ({
  base: mode === "app" ? "./" : "/",
  plugins: [react(), relayPlugin(), otaPlugin()],
  define: { __TMDB_KEY__: JSON.stringify(keys.tmdb || ""), __OMDB_KEY__: JSON.stringify(keys.omdb || ""),
    __SUPABASE_URL__: JSON.stringify(keys.supabaseUrl || ""), __SUPABASE_KEY__: JSON.stringify(keys.supabaseKey || ""),
    __TRAKT_ID__: JSON.stringify(trackers.trakt?.client_id || ""), __SIMKL_ID__: JSON.stringify(trackers.simkl?.client_id || "") },
  // web/js/sync-core.js is shared with the apps (title fingerprints for parties)
  server: { port: 5180, strictPort: true, fs: { allow: [searchForWorkspaceRoot(process.cwd()), "../web/js"] } },
}));
