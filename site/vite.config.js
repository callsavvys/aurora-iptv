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

export default defineConfig({
  plugins: [react(), relayPlugin()],
  define: { __TMDB_KEY__: JSON.stringify(keys.tmdb || ""), __OMDB_KEY__: JSON.stringify(keys.omdb || ""),
    __SUPABASE_URL__: JSON.stringify(keys.supabaseUrl || ""), __SUPABASE_KEY__: JSON.stringify(keys.supabaseKey || "") },
  // web/js/sync-core.js is shared with the apps (title fingerprints for parties)
  server: { port: 5180, strictPort: true, fs: { allow: [searchForWorkspaceRoot(process.cwd()), "../web/js"] } },
});
