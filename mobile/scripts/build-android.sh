#!/bin/bash
# Build Aurora for a Google TV / Android TV box.
#   bash scripts/build-android.sh          -> signed release APK in dist/, old interface (app/)
#   bash scripts/build-android.sh --help   -> every AURORA_* setting
# The signing key is made once, on this Mac, and never leaves it: Android only
# upgrades an app in place when the new build carries the same signature, so
# losing this key means uninstalling the TV app to update it.
set -euo pipefail
cd "$(dirname "$0")/.."

usage() {
  cat <<'HELP'
Build the Android TV app.

  bash mobile/scripts/build-android.sh                 release build of the old interface (app/)

Settings, as environment variables:
  AURORA_TV_UI=app|web        which interface goes in the APK (default app)
  AURORA_TEST_VERSION=0.38.9N a build for sideloading on the real TV before a release.
                              Its versionCode stays below the next release's, so the
                              release still installs over it. Every code is used once:
                              mobile/test-codes.log records them.
  AURORA_TRACE=1              a test build the Mac can inspect (chrome://inspect) and
                              that never writes the old app's saved data. Needs
                              AURORA_TEST_VERSION.
  AURORA_APP_ID_SUFFIX=.test  installs beside the real app (com.callsavvys.aurora.test),
                              with its own storage. Any test version; its own ledger,
                              mobile/test-codes.test.log. Needs AURORA_TEST_VERSION.
  AURORA_STAGE_ONLY=1         stop after staging mobile/www (no Android SDK needed);
                              what `npm run tv:web` and `npm run tv` preview.

Examples:
  AURORA_STAGE_ONLY=1 AURORA_TV_UI=web bash mobile/scripts/build-android.sh
  AURORA_TV_UI=web AURORA_TRACE=1 AURORA_TEST_VERSION=0.38.90 bash mobile/scripts/build-android.sh
HELP
}
case "${1:-}" in -h|--help) usage; exit 0 ;; "") ;; *) echo "build-android.sh: unknown argument '$1' (try --help)" >&2; exit 2 ;; esac

fail() { echo "build-android.sh: $1" >&2; [ -n "${2:-}" ] && echo "  fix: $2" >&2; exit 2; }

UI="${AURORA_TV_UI:-app}"
TEST_VERSION="${AURORA_TEST_VERSION:-}"
TRACE="${AURORA_TRACE:-}"
SUFFIX="${AURORA_APP_ID_SUFFIX:-}"
STAGE_ONLY="${AURORA_STAGE_ONLY:-}"
RELEASE_VERSION="$(node -p 'require("../package.json").version')"
code_of() { node -e 'const [a,b,c]=process.argv[1].split(".").map(Number); console.log(a*10000+b*100+c)' "$1"; }

# every setting is checked before anything is copied, synced or built
case "$UI" in app|web) ;; *) fail "AURORA_TV_UI='$UI' is not an interface; it is app or web" "AURORA_TV_UI=web bash mobile/scripts/build-android.sh" ;; esac
case "$TRACE" in ""|1) ;; *) fail "AURORA_TRACE='$TRACE' must be 1 or unset" ;; esac
case "$STAGE_ONLY" in ""|1) ;; *) fail "AURORA_STAGE_ONLY='$STAGE_ONLY' must be 1 or unset" ;; esac
case "$SUFFIX" in ""|.test) ;; *) fail "AURORA_APP_ID_SUFFIX='$SUFFIX' must be .test or unset" ;; esac
if [ -n "$TEST_VERSION" ]; then
  [[ "$TEST_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "AURORA_TEST_VERSION='$TEST_VERSION' is not a version like 0.38.90"
  if [ -z "$SUFFIX" ]; then
    [[ "$TEST_VERSION" =~ ^0\.38\.9[0-9]$ ]] || fail "AURORA_TEST_VERSION='$TEST_VERSION' is outside 0.38.90–0.38.99, the codes kept below the 0.39.0 release" \
      "use the next free code in mobile/test-codes.log, or AURORA_APP_ID_SUFFIX=.test once they run out"
    [ "$(code_of "$TEST_VERSION")" -lt "$(code_of "$RELEASE_VERSION")" ] && fail "AURORA_TEST_VERSION=$TEST_VERSION would be older than the version already released ($RELEASE_VERSION)"
  fi
  LEDGER="test-codes${SUFFIX}.log"
  if [ -f "$LEDGER" ]; then
    LAST="$({ grep -v '^#' "$LEDGER" || true; } | awk 'NF{print $1}' | sort -V | tail -1)"
    if [ -n "$LAST" ] && [ "$(printf '%s\n%s\n' "$TEST_VERSION" "$LAST" | sort -V | tail -1)" = "$LAST" ]; then
      NEXT="$(echo "$LAST" | awk -F. '{print $1"."$2"."$3+1}')"
      fail "AURORA_TEST_VERSION=$TEST_VERSION is already used or older ($LAST was built $(grep "^$LAST " "$LEDGER" | awk '{print $NF}')); Android would refuse it over the last test build" \
        "AURORA_TEST_VERSION=$NEXT"
    fi
  fi
else
  [ -n "$TRACE" ] && fail "AURORA_TRACE=1 needs AURORA_TEST_VERSION: a debuggable APK must never carry a release code" \
    "AURORA_TRACE=1 AURORA_TEST_VERSION=0.38.90 AURORA_TV_UI=$UI bash mobile/scripts/build-android.sh"
  [ -n "$SUFFIX" ] && fail "AURORA_APP_ID_SUFFIX needs AURORA_TEST_VERSION: a release is never built for the side-by-side app"
fi

VERSION="${TEST_VERSION:-$RELEASE_VERSION}"
CODE="$(code_of "$VERSION")"
APP_ID="com.callsavvys.aurora${SUFFIX}"
if [ -n "$STAGE_ONLY" ]; then KIND="stage only (no APK)"; elif [ -n "$TEST_VERSION" ]; then KIND="test build"; else KIND="RELEASE"; fi
echo "Aurora TV | $KIND | interface $UI | version $VERSION (code $CODE) | trace $([ -n "$TRACE" ] && echo on || echo off) | $APP_ID"

echo "Staging web assets for Aurora $VERSION"
rm -rf www
if [ "$UI" = app ]; then
  cp -R ../app www
  cp platform/platform-core.js platform/platform-boot-app.js platform/tv.css platform/tv-nav.js www/
  # the renderer is loaded by platform-boot-app.js once window.aurora exists
  sed -i '' 's#<script src="renderer.js"></script>#<script src="platform-core.js"></script><script src="platform-boot-app.js"></script>#' www/index.html
  sed -i '' 's#<link rel="stylesheet" href="series.css" />#<link rel="stylesheet" href="series.css" />\n  <link rel="stylesheet" href="tv.css" />#' www/index.html
  # said before anything renders, because the shim, the renderer and the D-pad
  # layer all have to know this is a television and not a phone
  sed -i '' 's#<html lang="en">#<html lang="en" class="platform-tv">#' www/index.html
  sed -i '' 's#Stored only on this Mac and sent directly#Stored only on this TV and sent directly#' www/index.html
  sed -i '' 's#placeholder="Search channels, movies and series"#placeholder="Search"#' www/index.html
  NEEDLES="platform-core.js platform-boot-app.js platform-tv tv.css"
else
  # the new interface: web/ as it runs in the Mac browser, minus its local
  # server, plus what that server provided (keys, hls.js, Supabase)
  mkdir -p www/vendor
  cp -R ../web/index.html ../web/css ../web/js ../web/fonts www/
  cp ../app/hls.min.js www/vendor/hls.js
  cp ../app/vendor/supabase.js ../app/vendor/SUPABASE-LICENSE.txt www/vendor/
  cp platform/platform-core.js www/
  node ../scripts/extract-keys.cjs --config-js ${TRACE:+--trace} > www/config.js
  # platform-core.js goes after config.js (it reads the trace flag) and before
  # boot.js, which waits for it
  sed -i '' 's#<script src="config.js"></script>#<script src="config.js"></script><script src="platform-core.js"></script>#' www/index.html
  sed -i '' 's#<html lang="en" data-theme="teal">#<html lang="en" data-theme="teal" class="platform-tv ui-web">#' www/index.html
  NEEDLES="platform-core.js platform-tv ui-web boot.js config.js"
fi
sed -i '' "s/__AURORA_VERSION__/$VERSION/" www/platform-core.js
grep -q "$VERSION" www/platform-core.js || { echo "the version was not written into platform-core.js"; exit 1; }
for needle in $NEEDLES; do
  grep -q "$needle" www/index.html || { echo "$needle was not injected into index.html"; exit 1; }
done

if [ -n "$STAGE_ONLY" ]; then echo "Staged mobile/www ($UI). Stopping before Capacitor and Gradle."; exit 0; fi

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
[ -x "$JAVA_HOME/bin/java" ] || { echo "No JDK at $JAVA_HOME — brew install openjdk@21"; exit 1; }
[ -d "$ANDROID_HOME/platforms" ] || { echo "No Android SDK at $ANDROID_HOME — sdkmanager --sdk_root=\"$ANDROID_HOME\" 'platforms;android-35' 'build-tools;35.0.0' platform-tools"; exit 1; }
export PATH="$JAVA_HOME/bin:$PATH"

[ -d android ] || npx cap add android
npx cap sync android

# WebView inspection is for trace builds only. It is written into the synced
# copy of the Capacitor config, never mobile/capacitor.config.json, and a build
# without AURORA_TRACE refuses to go on if the synced copy has it on.
SYNCED=android/app/src/main/assets/capacitor.config.json
node - "$SYNCED" "${TRACE:-0}" <<'JS'
const fs = require("node:fs");
const [file, trace] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(file, "utf8"));
config.android = config.android || {};
if (trace === "1") config.android.webContentsDebuggingEnabled = true;
else delete config.android.webContentsDebuggingEnabled;
fs.writeFileSync(file, JSON.stringify(config, null, "\t"));
JS
if [ -z "$TRACE" ] && node -e 'process.exit(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).android?.webContentsDebuggingEnabled === true ? 0 : 1)' "$SYNCED"; then
  echo "build-android.sh: $SYNCED has android.webContentsDebuggingEnabled=true in a build without AURORA_TRACE (AURORA_TRACE may still be set); refusing to build an inspectable APK" >&2
  exit 1
fi

# A television is not a phone: it has no touchscreen, it lives in landscape, and
# the Google TV home row only shows apps that ask for the leanback launcher.
# Xtream providers are almost always plain http, which Android blocks by default.
python3 - "$VERSION" "$CODE" "$APP_ID" <<'PY'
import re, sys, pathlib
version, code, app_id = sys.argv[1], sys.argv[2], sys.argv[3]
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
# set on every build, so a side-by-side build never leaves its id behind
text = re.sub(r'applicationId "[^"]*"', f'applicationId "{app_id}"', text)
gradle.write_text(text)
print("manifest and gradle set for", version, app_id)
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
if [ -n "$TEST_VERSION" ]; then
  echo "$TEST_VERSION $UI ${TRACE:+trace }$(date +%Y-%m-%d)" >> "$LEDGER"
  echo "Recorded $TEST_VERSION in mobile/$LEDGER"
fi
