#!/bin/bash
# The web version as a Cloudflare Pages site: web/ plus what web/server.cjs
# provides locally (keys in config.js, hls.js, Supabase), with config.js saying
# cloud so the page relays only the provider's catalogue (cloud/functions).
#   bash scripts/build-cloud.sh            builds cloud/public
#   bash scripts/build-cloud.sh --deploy   builds, then deploys to Pages
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=cloud/public
rm -rf "$OUT" && mkdir -p "$OUT/vendor"
cp -R web/index.html web/css web/js web/fonts "$OUT/"
cp app/hls.min.js "$OUT/vendor/hls.js"
cp app/vendor/supabase.js app/vendor/SUPABASE-LICENSE.txt "$OUT/vendor/"
node scripts/extract-keys.cjs --config-js --cloud > "$OUT/config.js"
grep -q '"cloud":true' "$OUT/config.js" || { echo "config.js does not say cloud"; exit 1; }
echo "Built $OUT"
if [ "${1:-}" = "--deploy" ]; then
  cd cloud && npx --yes wrangler@4 pages deploy public --project-name "${AURORA_PAGES_PROJECT:-aurora-iptv}" --branch main --commit-dirty=true
fi
