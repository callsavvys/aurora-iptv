/* The keys the app already ships, read out of app/renderer.js so there is one
   copy of each: TMDB and OMDb for artwork and ratings, and Supabase's URL and
   publishable key for accounts. web/server.cjs serves them to the browser
   build; build-android.sh writes them into the TV build's config.js.

     node scripts/extract-keys.cjs --config-js [--trace]   prints config.js
     require("./scripts/extract-keys.cjs").extractKeys()  { tmdb, omdb, supabaseUrl, supabaseKey }

   A key that cannot be found fails loudly (exit 3, E_KEYS_MISSING) rather than
   shipping an app that silently has no artwork or no accounts. No key value is
   ever printed in an error. */
const fs = require("node:fs");
const path = require("node:path");

const SOURCE = path.join(__dirname, "..", "app", "renderer.js");
const PATTERNS = {
  tmdb: /tmdb: "([0-9a-f]{32})"/,
  omdb: /omdb: "([0-9a-f]+)"/,
  supabaseUrl: /const SUPABASE_URL = "(https:\/\/[^"]+)"/,
  supabaseKey: /const SUPABASE_KEY = "([^"]+)"/,
};

class MissingKeyError extends Error {
  constructor(name, file) {
    super(`E_KEYS_MISSING: ${name} not found in ${path.relative(process.cwd(), file) || file} (searched for ${PATTERNS[name]}); restore it there, then re-run the build`);
    this.code = "E_KEYS_MISSING";
    this.key = name;
  }
}

function extractKeys(file = SOURCE) {
  const text = fs.readFileSync(file, "utf8");
  const keys = {};
  for (const [name, pattern] of Object.entries(PATTERNS)) {
    const value = text.match(pattern)?.[1] || "";
    if (!value) throw new MissingKeyError(name, file);
    keys[name] = value;
  }
  return keys;
}

const configJs = (keys, { trace = false } = {}) =>
  `window.AURORA_CONFIG = ${JSON.stringify({ ...keys, ...(trace ? { trace: true } : {}) })};\n`;

module.exports = { extractKeys, configJs, PATTERNS, MissingKeyError };

if (require.main === module) {
  const args = process.argv.slice(2);
  const fileArg = args.indexOf("--from");
  const file = fileArg !== -1 ? path.resolve(args[fileArg + 1]) : SOURCE;
  try {
    const keys = extractKeys(file);
    if (args.includes("--config-js")) process.stdout.write(configJs(keys, { trace: args.includes("--trace") }));
    else console.log(`ok: ${Object.keys(keys).join(", ")} found in ${path.relative(process.cwd(), file)}`);
  } catch (error) {
    console.error(error.message);
    process.exit(error.code === "E_KEYS_MISSING" ? 3 : 1);
  }
}
