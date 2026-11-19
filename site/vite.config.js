import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";

// the TMDB key comes from the one place the apps keep it (app/renderer.js),
// read at build time, so it is never written into this folder
const require = createRequire(import.meta.url);
const { extractKeys } = require("../scripts/extract-keys.cjs");
const keys = extractKeys();
const { relayPlugin } = require("./relay.cjs");

export default defineConfig({
  plugins: [react(), relayPlugin()],
  define: { __TMDB_KEY__: JSON.stringify(keys.tmdb || ""), __OMDB_KEY__: JSON.stringify(keys.omdb || "") },
  server: { port: 5180, strictPort: true },
});
