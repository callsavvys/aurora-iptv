#!/bin/bash
# Build Aurora for a Google TV / Android TV box from the same app/ renderer the
# Mac and iPhone builds ship.
#   bash scripts/build-android.sh   -> signed release APK in dist/
# The signing key is made once, on this Mac, and never leaves it: Android only
# upgrades an app in place when the new build carries the same signature, so
# losing this key means uninstalling the TV app to update it.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="$(node -p 'require("../package.json").version')"
CODE="$(node -p 'const [a,b,c]=require("../package.json").version.split(".").map(Number); a*10000+b*100+c')"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
[ -x "$JAVA_HOME/bin/java" ] || { echo "No JDK at $JAVA_HOME — brew install openjdk@21"; exit 1; }
[ -d "$ANDROID_HOME/platforms" ] || { echo "No Android SDK at $ANDROID_HOME — sdkmanager --sdk_root=\"$ANDROID_HOME\" 'platforms;android-35' 'build-tools;35.0.0' platform-tools"; exit 1; }
export PATH="$JAVA_HOME/bin:$PATH"

echo "Staging web assets for Aurora $VERSION"
rm -rf www && cp -R ../app www
cp platform/platform-native.js platform/tv.css platform/tv-nav.js www/
sed -i '' "s/__AURORA_VERSION__/$VERSION/" www/platform-native.js
# the renderer is loaded by the platform shim once window.aurora exists
sed -i '' 's#<script src="renderer.js"></script>#<script src="platform-native.js"></script>#' www/index.html
sed -i '' 's#<link rel="stylesheet" href="series.css" />#<link rel="stylesheet" href="series.css" />\n  <link rel="stylesheet" href="tv.css" />#' www/index.html
# said before anything renders, because the shim, the renderer and the D-pad
# layer all have to know this is a television and not a phone
sed -i '' 's#<html lang="en">#<html lang="en" class="platform-tv">#' www/index.html
sed -i '' 's#Stored only on this Mac and sent directly#Stored only on this TV and sent directly#' www/index.html
sed -i '' 's#placeholder="Search channels, movies and series"#placeholder="Search"#' www/index.html
for needle in platform-native.js platform-tv tv.css; do
  grep -q "$needle" www/index.html || { echo "$needle was not injected into index.html"; exit 1; }
done

[ -d android ] || npx cap add android
npx cap sync android

# A television is not a phone: it has no touchscreen, it lives in landscape, and
# the Google TV home row only shows apps that ask for the leanback launcher.
# Xtream providers are almost always plain http, which Android blocks by default.
python3 - "$VERSION" "$CODE" <<'PY'
import re, sys, pathlib
version, code = sys.argv[1], sys.argv[2]
manifest = pathlib.Path("android/app/src/main/AndroidManifest.xml")
xml = manifest.read_text()
if "leanback" not in xml:
    xml = xml.replace("</manifest>",
        '    <uses-feature android:name="android.software.leanback" android:required="false" />\n'
        '    <uses-feature android:name="android.hardware.touchscreen" android:required="false" />\n'
        "</manifest>")
if "LEANBACK_LAUNCHER" not in xml:
    xml = xml.replace('<category android:name="android.intent.category.LAUNCHER" />',
        '<category android:name="android.intent.category.LAUNCHER" />\n'
        '                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />')
if "usesCleartextTraffic" not in xml:
    xml = xml.replace("<application", '<application\n        android:usesCleartextTraffic="true"\n        android:banner="@drawable/banner"', 1)
xml = re.sub(r'android:screenOrientation="[^"]*"', 'android:screenOrientation="landscape"', xml)
if "screenOrientation" not in xml:
    xml = xml.replace("<activity", '<activity\n            android:screenOrientation="landscape"', 1)
manifest.write_text(xml)

gradle = pathlib.Path("android/app/build.gradle")
text = gradle.read_text()
text = re.sub(r'versionCode \d+', f"versionCode {code}", text)
text = re.sub(r'versionName "[^"]*"', f'versionName "{version}"', text)
gradle.write_text(text)
print("manifest and gradle set for", version)
PY

# The Google TV home row wants a 320x180 banner, not an icon
BANNER=android/app/src/main/res/drawable/banner.png
mkdir -p "$(dirname "$BANNER")"
sips -Z 150 platform/icon/AppIcon-1024.png --out /tmp/aurora-banner-icon.png >/dev/null
sips -p 180 320 --padColor 070B0F /tmp/aurora-banner-icon.png --out "$BANNER" >/dev/null
[ -f "$BANNER" ] || { echo "no TV banner was made"; exit 1; }

KEYSTORE="$PWD/android-release.keystore"
PASSFILE="$PWD/.keystore-pass"
if [ ! -f "$KEYSTORE" ]; then
  echo "Making this Mac's signing key (kept out of git, keep it to keep updating the TV app)"
  # openssl writes once and exits: a `tr ... | head -c` pipeline here dies of
  # SIGPIPE and takes the whole build down under pipefail
  openssl rand -hex 24 > "$PASSFILE"
  chmod 600 "$PASSFILE"
  keytool -genkeypair -v -keystore "$KEYSTORE" -alias aurora -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$(cat "$PASSFILE")" -keypass "$(cat "$PASSFILE")" \
    -dname "CN=Aurora IPTV, OU=Personal, O=Aurora, L=Home, C=US" >/dev/null
  chmod 600 "$KEYSTORE"
fi

echo "Building the APK"
( cd android && ./gradlew --quiet --console=plain assembleRelease )
BUILD_TOOLS="$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)"
UNSIGNED=android/app/build/outputs/apk/release/app-release-unsigned.apk
[ -f "$UNSIGNED" ] || UNSIGNED=android/app/build/outputs/apk/release/app-release.apk
mkdir -p dist
"$BUILD_TOOLS/zipalign" -p -f 4 "$UNSIGNED" /tmp/aurora-tv-aligned.apk
"$BUILD_TOOLS/apksigner" sign --ks "$KEYSTORE" --ks-pass "pass:$(cat "$PASSFILE")" --out "dist/Aurora-TV-$VERSION.apk" /tmp/aurora-tv-aligned.apk
rm -f /tmp/aurora-tv-aligned.apk /tmp/aurora-banner-icon.png
"$BUILD_TOOLS/apksigner" verify "dist/Aurora-TV-$VERSION.apk" >/dev/null && echo "signature ok"
echo "Built mobile/dist/Aurora-TV-$VERSION.apk ($(du -h "dist/Aurora-TV-$VERSION.apk" | cut -f1))"
