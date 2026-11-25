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

## Preview the website as the TV app

```bash
npm run tv:site
```

This builds `site/` for the app (`vite build --mode app`: relative paths, routes after a `#`, the provider asked directly instead of through the relay) into `mobile/www` and opens it at 960×540. The remote is the arrows, Enter and Backspace. In the browser you can also add `?tv=1` to any page of the dev site (`http://localhost:5180/?tv=1`) to try the remote navigation there, signed in.

A test APK of it: `AURORA_TV_UI=site AURORA_TEST_VERSION=0.38.9N bash mobile/scripts/build-android.sh`. On first start it copies the old app's saved line, so the TV stays connected. See docs/plans/site-to-apps.md for what is still to do.

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

## Automatic updates (the website interface)

TV and phone apps built from the website (`AURORA_TV_UI=site` or `AURORA_UI=site`) update themselves. A few seconds after each start, they read `manifest.json` on the `app-live` pre-release, download a newer bundle in the background, and run it the next time they start. To push the current `site/` to every installed app:

```bash
bash scripts/publish-live.sh
```

Add `--dry-run` to build without uploading. How it works:

- `site/ota-plugin.cjs` puts a small loader in the app's `index.html` and makes the bundle one JS file plus one CSS file.
- `site/src/ota.js` checks for updates and downloads them, verified against the manifest's SHA-256.
- A downloaded bundle that has not started within 15 seconds is marked bad, and the app falls back to its own copy.
- A newly installed APK or IPA always wins over an older download.
- Settings shows the running build, with "updated automatically" when it came this way.

Only the JS and CSS travel this way. A new APK or IPA is still needed for native changes, a new Capacitor plugin, and new images: images stay in the installed app, and the script names any that are missing. When a bundle needs something older apps lack, raise `SHELL_API` in `site/ota-plugin.cjs`; older apps then keep their own copy. Apps built before this loader existed never update this way: install one new build first.

## A release

```bash
bash mobile/scripts/build-android.sh
```

This builds the old interface (`app/`) at the version in `package.json` until the plan's flip, and refuses to build if WebView inspection is on. Upload `mobile/dist/Aurora-TV-<version>.apk` under the asset name `Aurora-TV.apk`, so Downloader code 8502133 finds it.

## Rolling back

Android will not install an older versionCode over a release, and uninstalling first wipes the saved data. A rollback is therefore always forward: a newer version built from `app/`, installed over the top. Both interfaces read the same saved data.
