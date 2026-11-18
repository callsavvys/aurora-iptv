# Building Aurora for the TV

Every setting is listed by:

```bash
bash mobile/scripts/build-android.sh --help
```

## Preview the new interface on this Mac (about a minute, no Android SDK)

```bash
npm run tv:web
```

This stages `mobile/www` with the new interface (`web/`) and opens it in a 960×540 window. That is the TV's own viewport, so what you see is what the TV draws. Arrows move, Enter is OK, and Backspace or Escape is the remote's Back.

## A test build for the real TV

Test builds take a version from 0.38.90 to 0.38.99. Their versionCodes stay below the 0.39.0 release, so the release still installs over them. Each code is used once. `mobile/test-codes.log` records them, and the script refuses one that is already used and names the next free one.

```bash
AURORA_TV_UI=web AURORA_TEST_VERSION=0.38.91 bash mobile/scripts/build-android.sh
```

A trace build can also be inspected from the Mac. It never writes the old app's saved data, so it is safe on a TV that still runs the old app:

```bash
AURORA_TV_UI=web AURORA_TRACE=1 AURORA_TEST_VERSION=0.38.90 bash mobile/scripts/build-android.sh
```

Install it on the TV (same Wi-Fi; turn on network debugging in the TV's Developer options):

```bash
adb connect <tv-ip>:5555
```

```bash
adb install -r mobile/dist/Aurora-TV-0.38.90.apk
```

Check which code an APK carries:

```bash
"$(ls -d ~/Library/Android/sdk/build-tools/* | sort -V | tail -1)/aapt" dump badging mobile/dist/Aurora-TV-0.38.90.apk | head -1
```

Trace it: open `chrome://inspect/#devices` in Chrome on the Mac, pick Aurora under the TV, then use **Performance** and record while you hold an arrow down Live TV.

If the 0.38.9x codes run out, build beside the real app instead. That build has its own storage and its own ledger (`mobile/test-codes.test.log`):

```bash
AURORA_APP_ID_SUFFIX=.test AURORA_TV_UI=web AURORA_TEST_VERSION=0.40.1 bash mobile/scripts/build-android.sh
```

## A release

```bash
bash mobile/scripts/build-android.sh
```

This builds the old interface (`app/`) at the version in `package.json` until the plan's flip, and refuses to build if WebView inspection is on. Upload `mobile/dist/Aurora-TV-<version>.apk` under the asset name `Aurora-TV.apk`, so Downloader code 8502133 finds it.

## Rolling back

Android will not install an older versionCode over a release, and uninstalling first wipes the saved data. A rollback is therefore always forward: a newer version built from `app/`, installed over the top. Both interfaces read the same saved data.
