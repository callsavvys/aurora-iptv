#!/bin/bash
# Builds Aurora IPTV.app straight from node_modules/electron.
# electron-packager is skipped on purpose: its zip extractor silently produces a
# broken Electron.app on recent Node versions. ditto handles the same archive fine.
set -euo pipefail
cd "$(dirname "$0")/.."

APP_NAME="Aurora IPTV"
BUNDLE_ID="com.aurora.iptv"
VERSION="$(node -p "require('./package.json').version")"
OUT="release/${APP_NAME}-darwin-arm64"
APP="${OUT}/${APP_NAME}.app"
STAGE="release/.stage"

echo "Building ${APP_NAME} ${VERSION}"

if [ ! -d node_modules/electron/dist/Electron.app/Contents/Frameworks ]; then
  echo "node_modules/electron/dist is incomplete. Re-extract it with:"
  echo "  rm -rf node_modules/electron/dist && mkdir -p node_modules/electron/dist"
  echo "  ditto -x -k ~/Library/Caches/electron/*/electron-v*-darwin-arm64.zip node_modules/electron/dist"
  exit 1
fi

rm -rf "$OUT" "$STAGE"
mkdir -p "$OUT" "$STAGE"

ditto node_modules/electron/dist/Electron.app "$APP"

mv "$APP/Contents/MacOS/Electron" "$APP/Contents/MacOS/${APP_NAME}"
PLIST="$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable ${APP_NAME}" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleName ${APP_NAME}" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName ${APP_NAME}" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string ${APP_NAME}" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier ${BUNDLE_ID}" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString ${VERSION}" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${VERSION}" "$PLIST"

# only these files are needed at runtime; hls.js ships as app/hls.min.js
cp package.json main.cjs server.cjs "$STAGE/"
cp -R app "$STAGE/app"
rm -f "$APP/Contents/Resources/default_app.asar"
node_modules/.bin/asar pack "$STAGE" "$APP/Contents/Resources/app.asar"
rm -rf "$STAGE"

# arm64 refuses to launch a bundle whose signature no longer matches
codesign --force --deep --sign - "$APP"
codesign --verify --deep "$APP" && echo "signature ok"

ditto -c -k --sequesterRsrc --keepParent "$APP" "release/Aurora-IPTV-Mac-Apple-Silicon.zip"
echo "Built $APP"
echo "Zipped release/Aurora-IPTV-Mac-Apple-Silicon.zip"
