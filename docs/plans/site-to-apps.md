# Plan: the website (`site/`) becomes the TV and phone apps

## Goal

The Android TV app (and then the iPhone and Android phone apps) runs the website's
interface, the atlantic.bz copy in `site/`, in place of `web/`. Someone who updates the TV
with Downloader code 8502133 gets the new interface and keeps their line, account and
history.

## Where things stand (2026-11-20)

- `site/` is a React and Vite app. It has every page, the player, watch parties, account
  sign-up and the source picker. Its progress, watched marks, lists and settings sync to
  the account's `site_data` table (`site/src/cloud.js`).
- The apps are Capacitor shells. `mobile/scripts/build-android.sh` stages an interface
  into `mobile/www`, adds `mobile/platform/` (`platform-core.js`, `tv-nav.js`, `tv.css`)
  and builds with CapacitorHttp turned on.
- `site/` relies on two things only its dev server gives it:
  - `/api/proxy` (`site/relay.cjs`) for the line's API calls and streams;
  - `/api/trakt/token`, which holds Trakt's client secret.
- The site keeps the line's login in `localStorage`. On the TV it belongs in Capacitor
  Preferences, as now.
- The current TV app's data lives in the `progress` and `favorites` tables. The site's
  data lives in `site_data`.

## Steps

1. **Where it runs.** Add `site/src/platform.js`, the only file that knows browser from
   app:
   - `relay(url)` returns `/api/proxy?u=…` in a browser and the URL itself in the app,
     where CapacitorHttp gets around CORS;
   - storage for the line's login goes to Capacitor Preferences in the app;
   - every `/api/proxy` call in `line.js`, `Sources.jsx` and the relay's live-playlist
     rewriting goes through it.
2. **Build into the APK.** Run `vite build` with `base: "./"` and a hash router, since
   the app has no server to answer `/title/...` paths. Add an
   `AURORA_TV_UI=site` mode to `build-android.sh` that copies `site/dist` into
   `mobile/www`.
3. **The remote.** Arrow-key focus for every page: `mobile/platform/tv-nav.js` already
   does this for `web/`, so give the site's cards, rows, tabs, the player bar and its
   panels the same focus classes. Back closes the panel, then the player, then goes back
   a page.
4. **TV size.** The TV's viewport is 960×540. Use the site's own breakpoints, then
   measure every view (`tests/tv-sweep.cjs` already does this for `web/`; point it at
   `site/`).
5. **Moving existing users across.** On first start, copy the old app's saved line,
   progress and lists into the site's keys, so nothing is lost. The account already
   holds both tables.
6. **Trakt on the TV.** Without the relay there is nowhere safe for the secret. Use
   Simkl (no secret needed) on the TV, or a small edge function on the account server
   that holds Trakt's secret.
7. **Tests and a test build.** Stage with `npm run tv:web`-style preview, then build a
   test APK (0.38.9x codes, `mobile/test-codes.log`) and try it on the Google TV before a
   release. A release keeps the `Aurora-TV.apk` asset that the Downloader code installs.
8. **Phones.** Same `www`, without `tv-nav`, using the site's mobile layout. Build
   through `mobile/scripts/build-ios.sh`.

## Risks

- **The one-connection line.** Keep the TV idle while testing on the Mac, and the other
  way round.
- **Old data.** If step 5 misses a key, people lose Continue Watching. Test it with a
  copy of the real TV's saved data before releasing.
- **Release uploads.** The Mac zip often fails its first upload (see memory). The TV APK
  asset must keep its name.
