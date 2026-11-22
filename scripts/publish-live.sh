#!/bin/bash
# Publish the website (site/) as an automatic update for the installed TV and
# phone apps. They check the app-live pre-release a few seconds after starting,
# download a newer bundle and run it the next time they start
# (site/ota-plugin.cjs, site/src/ota.js).
#   bash scripts/publish-live.sh            build and publish
#   bash scripts/publish-live.sh --dry-run  build and show what would be uploaded
#
# Only the JS and CSS travel this way. A change to native code, a new Capacitor
# plugin, or new images still needs a new APK or IPA (raise SHELL_API in
# site/ota-plugin.cjs when a bundle needs something older apps lack).
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="callsavvys/aurora-iptv"
TAG="app-live"
KEEP=2   # bundles left on the release (the newest, and the one before for apps mid-download)
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1

VERSION="$(node -p 'require("./package.json").version')"
OUT="$(mktemp -d)"; trap 'rm -rf "$OUT"' EXIT
(cd site && npx vite build --mode app --outDir "$OUT/www" --emptyOutDir --logLevel warn)
V="$(node -p "require('$OUT/www/ota.json').v")"
API="$(node -p "require('$OUT/www/ota.json').api")"
mkdir "$OUT/up"
cp "$OUT/www/$(node -p "require('$OUT/www/ota.json').js")" "$OUT/up/aurora-app-$V.js"
cp "$OUT/www/$(node -p "require('$OUT/www/ota.json').css")" "$OUT/up/aurora-app-$V.css"
JS_SHA="$(shasum -a 256 "$OUT/up/aurora-app-$V.js" | cut -d' ' -f1)"
CSS_SHA="$(shasum -a 256 "$OUT/up/aurora-app-$V.css" | cut -d' ' -f1)"
cat > "$OUT/up/manifest.json" <<EOF
{ "v": $V, "api": $API, "version": "$VERSION", "js": "aurora-app-$V.js", "css": "aurora-app-$V.css", "jsSha": "$JS_SHA", "cssSha": "$CSS_SHA" }
EOF
echo "Aurora $VERSION, build $V ($(date -r $((V / 1000)) '+%Y-%m-%d %H:%M'))"
ls -lh "$OUT/up" | tail -n +2

# images the bundle uses must already be in the installed apps (they are not uploaded)
missing="$( { grep -oE 'url\(\.?/?[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8}\.(svg|png|jpg|webp|woff2?)' "$OUT/up/aurora-app-$V.css" | sed -E 's/url\(\.?\/?//' | sort -u || true; } | while read -r f; do [ -f mobile/www/assets/"$f" ] || echo "$f"; done)"
if [ -n "$missing" ]; then echo "note: these images are new since the last app build and will not show until the next APK/IPA: $missing"; fi

if [ "$DRY" = 1 ]; then echo "dry run: nothing uploaded"; exit 0; fi

gh release view "$TAG" -R "$REPO" >/dev/null 2>&1 || gh release create "$TAG" -R "$REPO" --prerelease --target main \
  --title "Aurora app updates (automatic)" \
  --notes "The TV and phone apps download their updates from here by themselves. Nothing to install by hand: the APK and IPA are on the other releases."

up() { for i in 1 2 3; do gh release upload "$TAG" -R "$REPO" --clobber "$@" && return 0; echo "upload failed, trying again ($i)"; sleep 5; done; return 1; }
up "$OUT/up/aurora-app-$V.js" "$OUT/up/aurora-app-$V.css"
up "$OUT/up/manifest.json"   # last, so an app never reads a manifest whose files are not there yet

# keep the newest $KEEP bundles
gh release view "$TAG" -R "$REPO" --json assets -q '.assets[].name' | grep -oE '^aurora-app-[0-9]+' | sort -u | sort -t- -k3 -n | awk -v k="$KEEP" '{ a[NR] = $0 } END { for (i = 1; i <= NR - k; i++) print a[i] }' | while read -r old; do
  gh release delete-asset "$TAG" -R "$REPO" "$old.js" -y || true
  gh release delete-asset "$TAG" -R "$REPO" "$old.css" -y || true
done

# the apps read the manifest from here
url="https://github.com/$REPO/releases/download/$TAG/manifest.json"
for i in $(seq 1 12); do
  got="$(curl -sL "$url?t=$(date +%s)" || true)"
  echo "$got" | grep -q "\"v\": $V" && { echo "Published: apps pick up build $V on their next start after it downloads"; exit 0; }
  sleep 10
done
echo "uploaded, but $url does not show build $V yet (GitHub may still be updating)"; exit 1
