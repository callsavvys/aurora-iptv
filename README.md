# Aurora IPTV

A local-first IPTV player for macOS. Everything runs on your own Mac and connects
straight to your provider from your own IP — nothing is relayed through a server.

## Running from source

```bash
npm install
npm start
```

If `npm install` leaves `node_modules/electron/dist` without a `Frameworks` folder,
its zip extractor failed. Fix it with:

```bash
rm -rf node_modules/electron/dist && mkdir -p node_modules/electron/dist
ditto -x -k ~/Library/Caches/electron/*/electron-v*-darwin-arm64.zip node_modules/electron/dist
```

`npm start` picks up edits on reload (⌘R), so you don't need to rebuild while working.

## Building the Mac app

```bash
npm run package:mac
```

Writes `release/Aurora IPTV-darwin-arm64/Aurora IPTV.app` and a zip beside it.

## Shipping a release

```bash
npm version minor          # or patch / major
npm run package:mac
gh release create "v$(node -p "require('./package.json').version")" \
  release/Aurora-IPTV-Mac-Apple-Silicon.zip \
  --title "Aurora $(node -p "require('./package.json').version")" --notes "..."
```

Installed copies check `updates.repository` in `package.json` against GitHub
Releases 15 seconds after launch and every six hours, download the asset named
in `updates.asset`, and offer **Restart to update**. Before replacing anything
the download has to come from github.com over HTTPS, pass `codesign --verify`,
carry the `com.aurora.iptv` bundle id and be newer than the running app. The
swap happens after the app exits and rolls back if it fails.

Builds are ad-hoc signed, so the updater can check that a signature is intact
but not *whose* it is. An Apple Developer ID would close that gap.

## The files

| File | What lives there |
| --- | --- |
| `app/renderer.js` | All app behaviour: library, search, playback, progress, favorites |
| `app/index.html` | Layout and the modals |
| `app/styles.css` | Main design |
| `app/series.css` | Detail sheet, seasons and episodes |
| `server.cjs` | Local HTTP server: serves the UI and proxies the provider |
| `main.cjs` | The Electron window |
| `scripts/build-mac.sh` | Builds the .app bundle |
| `package.json` | Version, dependencies, scripts |

## Where your data is kept

| Key | Contents |
| --- | --- |
| `localStorage` `aurora-provider` | Your Xtream server, username and password |
| `localStorage` `aurora-favorites` | Saved item ids |
| `localStorage` `aurora-progress` | Watch positions and history (last 400 entries) |
| IndexedDB `aurora-mac` | The cached library |

Credentials never leave your Mac except in the requests Aurora makes to your own
provider. They are not in this repository.
