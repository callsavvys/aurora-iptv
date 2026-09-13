#!/bin/bash
# Build Aurora for iPhone from the same app/ renderer the Mac build ships.
#   bash scripts/build-ios.sh            -> unsigned release IPA in dist/
#   bash scripts/build-ios.sh simulator  -> debug .app for the iOS Simulator
set -euo pipefail
cd "$(dirname "$0")/.."
TARGET="${1:-device}"
VERSION="$(node -p 'require("../package.json").version')"

echo "Staging web assets for Aurora $VERSION"
rm -rf www && cp -R ../app www
cp platform/platform-ios.js platform/mobile.css www/
sed -i '' "s/__AURORA_VERSION__/$VERSION/" www/platform-ios.js
# the renderer is loaded by the platform shim once window.aurora exists
sed -i '' 's#<script src="renderer.js"></script>#<script src="platform-ios.js"></script>#' www/index.html
sed -i '' 's#<link rel="stylesheet" href="series.css" />#<link rel="stylesheet" href="series.css" />\n  <link rel="stylesheet" href="mobile.css" />#' www/index.html
sed -i '' 's#content="width=device-width,initial-scale=1"#content="width=device-width,initial-scale=1,viewport-fit=cover"#' www/index.html
# the desktop placeholder is cut off at phone width
sed -i '' 's#placeholder="Search channels, movies and series"#placeholder="Search"#' www/index.html
# "Normal" does not fit the phone's speed control
sed -i '' 's#<option value="1" selected>Normal</option>#<option value="1" selected>1\&times;</option>#' www/index.html
sed -i '' 's#Stored only on this Mac and sent directly#Stored only on this iPhone and sent directly#' www/index.html
grep -q 'platform-ios.js' www/index.html || { echo "shim was not injected"; exit 1; }
grep -q 'mobile.css' www/index.html || { echo "mobile.css was not injected"; exit 1; }

[ -d ios ] || npx cap add ios
npx cap sync ios

# Aurora's own mark instead of Capacitor's placeholder; one 1024px image covers every size
cp platform/icon/AppIcon-1024.png ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png
for f in splash-2732x2732.png splash-2732x2732-1.png splash-2732x2732-2.png; do
  cp platform/icon/splash-2732.png "ios/App/App/Assets.xcassets/Splash.imageset/$f"
done

PLIST=ios/App/App/Info.plist
set_plist() { /usr/libexec/PlistBuddy -c "Delete :$1" "$PLIST" >/dev/null 2>&1 || true; /usr/libexec/PlistBuddy -c "Add :$1 $2 $3" "$PLIST"; }
# Xtream providers are plain http almost without exception
set_plist NSAppTransportSecurity dict ""
/usr/libexec/PlistBuddy -c "Add :NSAppTransportSecurity:NSAllowsArbitraryLoads bool true" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :NSAppTransportSecurity:NSAllowsArbitraryLoadsForMedia bool true" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :NSAppTransportSecurity:NSAllowsArbitraryLoadsInWebContent bool true" "$PLIST"
set_plist CFBundleShortVersionString string "$VERSION"
set_plist CFBundleDisplayName string "Aurora"
set_plist UIBackgroundModes array ""
/usr/libexec/PlistBuddy -c "Add :UIBackgroundModes:0 string audio" "$PLIST"

DERIVED="$PWD/build"
if [ "$TARGET" = "simulator" ]; then
  xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
    -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath "$DERIVED" IPHONEOS_DEPLOYMENT_TARGET=15.0 build -quiet
  echo "Built $DERIVED/Build/Products/Debug-iphonesimulator/App.app"
  exit 0
fi

xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -sdk iphoneos -destination 'generic/platform=iOS' -derivedDataPath "$DERIVED" \
  IPHONEOS_DEPLOYMENT_TARGET=15.0 CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" \
  build -quiet

APP="$DERIVED/Build/Products/Release-iphoneos/App.app"
[ -d "$APP" ] || { echo "no App.app produced"; exit 1; }
rm -rf dist/Payload && mkdir -p dist/Payload
cp -R "$APP" dist/Payload/Aurora.app
( cd dist && rm -f "Aurora-$VERSION.ipa" && zip -qry "Aurora-$VERSION.ipa" Payload && rm -rf Payload )
echo "Built mobile/dist/Aurora-$VERSION.ipa ($(du -h "dist/Aurora-$VERSION.ipa" | cut -f1))"
