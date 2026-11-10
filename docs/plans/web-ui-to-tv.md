<!-- /autoplan restore point: "/Users/ziyadelhawarry/Documents/Aurora-IPTV/aurora-mac/.gstack/tmp/autoplan/main-autoplan-restore-20261104-215451.md" -->
# Plan: the new web interface becomes the Android TV app

## Implementation plan

### Goal

The Android TV APK ships the interface in `web/` (the streamXie-style, keyboard-driven
build the owner tested on the Mac and approved: "okay this one is close i like it")
instead of `app/renderer.js`. A person who updates the TV app with Downloader code
8502133 gets the new interface, keeps their saved line, account and history, and
loses nothing the old TV app did.

### Where things stand (2026-11-04)

- `web/` (about 2,500 lines across `app.js`, `focus.js`, `sources.js`, `tmdb.js`,
  `store.js`, `ui.js`, `app.css`) runs in a browser through `web/server.cjs`. It has
  Home, Movies, Series, Live TV, My List, Search, Settings, title pages, person pages,
  a player, trailers, TMDB enrichment and Xtream sources. It has been tested on the
  owner's real line (498 live categories).
- The TV APK is built by `mobile/scripts/build-android.sh`. It copies `app/` into
  `mobile/www`, injects `platform-native.js`, `tv.css` and `tv-nav.js`, and builds with
  Capacitor (CapacitorHttp enabled, cleartext allowed, leanback launcher).
- `app/renderer.js` (4,437 lines) has features `web/` does not: Supabase accounts and
  sync, profiles and the who-menu, watch History, friends and Together (watch party),
  the live programme guide (EPG), the update notice, and per-source secrets kept in
  Capacitor Preferences.
- `web/` depends on three things only `web/server.cjs` provides: `/api/proxy` (CORS),
  `/config.js` (TMDB and OMDb keys) and `/vendor/hls.js`. It stores everything,
  including the Xtream password, in `localStorage`.

### Steps

1. **Platform layer.** Add `web/js/platform.js`, the only module that knows where it
   runs. It exposes:
   - `net.get(url)`, which goes through `/api/proxy` in a browser and directly on the TV
     (CapacitorHttp patches `fetch`, so CORS does not apply);
   - `streamUrl(url)` for hls.js `xhrSetup`;
   - `storage`, which is `localStorage` in a browser and Capacitor Preferences on the TV,
     with secrets kept apart from prefs;
   - `config`, which reads the keys from `/config.js` in a browser and from a file the
     build writes on the TV;
   - `onBack`, the hardware Back button;
   - `version`.

   `sources.js`, `tmdb.js`, `store.js` and the player call only this layer.
2. **Build switch.** `build-android.sh` gains `AURORA_TV_UI=web`, which stages `web/`
   plus `hls.min.js`, a generated `config.js` and the Capacitor shim into `www`. The
   default stays `app/` until every row of the feature inventory
   (`docs/plans/tv-feature-inventory.md`) is present or ported and step 6 passes, so a
   release can still be cut from the old interface.
3. **Keep the user's data: one store, not an import.** On the TV the web interface
   reads and writes the old app's own Preferences keys (`prefs`, `secrets`) in their old
   shape (read-modify-write, unknown fields kept), and keeps web-only data under
   `web.prefs` and `web.tmdb`. Nothing is copied or deleted, so a rollback build of app/
   (0.39.x, installed over the top) and the next upgrade both find the same data. Record shapes, sync and the full keep-list are in
   `docs/designs/web-ui-to-tv.md` steps 4–6.
4. **Parity, in this order** (each is a screen or a module in `web/`, on the same focus
   engine):
   1. account sign-in and Supabase sync;
   2. profiles and the who-menu;
   3. History;
   4. the live guide (now and next on channels, using `get_short_epg`);
   5. the update notice, with the Downloader code;
   6. friends and Together;
   7. then every remaining row of `docs/plans/tv-feature-inventory.md` (known: audio and
      subtitle track menus, the preview's connection limits, the billboard's rotation).
5. **Television performance.**
   - Live TV lists are virtualized: render about 40 rows around the focus instead of
     every channel, because a line can have thousands of channels.
   - Posters load at TMDB `w342`.
   - No `backdrop-filter` anywhere.
   - Measure on the real TV with a CDP trace. Budget: from a press to the frame showing
     it, under 100 ms; 60 fps while a held arrow scrolls a row.
6. **Tests.**
   - Port `tests/tv-nav.cjs`, `tv-sweep.cjs` and `tv-chrome.cjs` to drive the `web/`
     build at 960×540 CSS px (the TV's viewport).
   - Add a focus-room check: on every screen, the first focused card's grown artwork
     keeps at least 40px of room to its clipping box and to the heading above it.
   - Add a test that walks Live TV, Search and Settings with the keyboard alone.
7. **Release.**
   - Version 0.39.0.
   - The release keeps an `Aurora-TV.apk` asset, so Downloader code 8502133 installs it.
   - It is signed with `android-release.keystore`, so it upgrades in place.
   - Once the TV build ships from `web/`, the Mac and iPhone builds follow in a later
     plan.

### Out of scope

- Mac (Electron) and iPhone builds moving to `web/`.
- App store submission.
- CarPlay.
- New features the old app never had.


<!-- autoplan-accepted:ceo -->
- One store, not an import, per design doc step 4. On the TV, web/ reads and writes the old `prefs`/`secrets` Preferences keys in their old shape with read-modify-write, and web-only data goes under `web.prefs`/`web.tmdb`. Verified by the fixture test that runs both writers on one captured `prefs` snapshot and compares whole `favorites` and progress records after play, resume, hide and forget, then has the old renderer read the result back.
- Progress records keep the old playback-record schema, merge rule, `hidden` on hide, `progressGone` only on forget, and the 3,000 cap with live entries dropped first (design doc step 4). Verified by the same fixture test, asserting each field for a movie, a live channel and an episode.
- Continue watching ports the old rules unchanged (app/renderer.js:1067–1125):
  - a film is underway when `position > 20` s and below 95% of `duration`;
  - episodes group per show on the newest record, and a show is hidden only when that latest record is `hidden`;
  - a finished episode offers the next one from its `next` hint;
  - the row is capped at 20, newest first.
  web/js/store.js's 30 s rule and `at` field are replaced. In the browser, existing `aurora-web` progress is migrated once (`at` becomes `updatedAt`, and `item` fields are mapped onto the playback-record names), and a version marker stops it from running twice. Verified by fixture-test assertions on one underway film, one finished episode with `next`, one hidden latest episode and 21 records.
- Test builds never use up a release versionCode. Builds sideloaded on the real TV before release take `AURORA_TEST_VERSION=0.38.NN`. It overrides both VERSION and CODE in build-android.sh before the manifest/gradle python step (code = a×10000+b×100+c, build-android.sh:11) and never edits package.json. Codes only ever increase, and all stay in 3890–3899, below 0.39.0's 3900. The sequence:

  | Code | UI | Purpose | Storage |
  |---|---|---|---|
  | 0.38.90 | web/ | PR 1 baseline Live TV trace (`AURORA_TRACE=1`) | **Trace mode:** reads `secrets.sources` and `prefs.activeSource` read-only to open the owner's line; every write goes to an isolated `web.trace` key; never writes `prefs` or `secrets` |
  | 0.38.91 | web/ | PR 2 shared-store smoke test, over 0.38.90 | shared store |
  | 0.38.92 | app/ | PR 2 forward-rollback test, over 0.38.91 | shared store |
  | 0.38.93–0.38.97 | web/ | PR 3–4 parity and budget-trace builds, in order | shared store |
  | 0.38.98 | web/ (release candidate, parity complete) | final upgrade test: uninstall, reinstall the real 0.38.8 APK, sign in and seed it, then install 0.38.98 over it | shared store |
  | 0.38.99 | app/ | final forward-rollback test over 0.38.98 | shared store |

  The 0.39.0 release then installs over 0.38.99 through Downloader. Verified by `aapt dump badging` on each test APK showing its listed versionCode, and by a trace-mode test that runs the web/ boot with a captured `prefs`/`secrets` snapshot and finds both byte-identical afterwards.
- Upgraded users keep sources, active source, the Supabase session (`secrets.auth`), the vault key, My List, progress, History and the sync cursor (design doc step 5). Verified on the real TV with the 0.38.91 smoke build, with 0.38.98 installed over a freshly seeded 0.38.8 (the real user path, with parity complete), and with 0.39.0 through Downloader on release day. Each time the user lands signed in, on the same line, with My List and Continue watching intact.
- Rollback is forward, never down. Android refuses an APK with a lower versionCode over a release install (0.38.8 = 3808 < 0.39.0 = 3900; mobile/android/app/build.gradle:10), and uninstalling first wipes Preferences. So a rollback is a 0.39.x build of app/ with a higher versionCode, which reads the same store. Verified before release with 0.38.92 over 0.38.91 and 0.38.99 over 0.38.98, finding the same My List, progress and sign-in each time. After release, a real rollback ships as 0.39.1 built from app/. It carries both `Aurora-TV.apk` and the Mac zip, with the same draft-and-verify upload as 0.39.0. (This replaces the design doc's "re-installing the previous APK" success criterion, which Android cannot perform.)
- Sync ports everything the old app sends to the account, unchanged:
  - favorites and progress: per-item newest-wins, through `push_favorites` and `push_progress` (app/renderer.js:3610–3670);
  - the sealed `vault` of provider logins and keys, push and restore (app/renderer.js:3500–3560), with `sourcesRemoved` tombstones and `keysUpdatedAt`;
  - the `library_filter` that Together uses for what friends can both play (app/renderer.js:3876–3890), with `filterStamp` and `partyOffsets`.
  The first two belong to parity 4.1; `library_filter` and `partyOffsets` belong to 4.6. Verified by porting `tests/local-sync.cjs` (it covers `sourcesRemoved`, tests/local-sync.cjs:78), `tests/signed-in.cjs` and `tests/together.cjs` to the web/ build, all driven through the UI.
- `platform-native.js` splits into `platform-core.js` and `platform-boot-app.js`. The app/ TV build behaves the same, and web/ waits on `window.auroraReady` (design doc step 1). Verified by a test that the staged app/ `www/index.html` still loads the renderer and `tv-nav.js`, and a web/ boot test that no storage read happens before `auroraReady`.
- Screen model: web/ keeps its own 1920×1080 stage, scaled by `fit()` with a CSS transform (web/js/app.js:18–24). The owner approved it on the Mac as it is. On the TV's 960×540 viewport that scale is 0.5. The old app's root `zoom` (`fitToScreen`) is never loaded in the web/ build. **This is an explicit CEO override of design doc step 2** ("lays out natively at 960×540 CSS px"), audit trail #13 (taste, surfaced at the final gate). It keeps that step's one scale model and no root zoom, but not its native layout, and it avoids rewriting every pixel value in app.css.
  - Units: thresholds are stated in stage px, with CSS px at the TV's 960×540 viewport in brackets.
  - Focus room: at least 40 stage px (20 CSS px) from the first focused card's grown artwork to its clipping box and to the heading above it. Plan step 6's "40px" means stage px.
  - Type floor: every visible text node's computed size is at least 23 stage px (11.5 CSS px), the rule web/css/app.css:43 already states. A new check in the web/ variant of `tests/tv-sweep.cjs` enforces it on every screen it visits.
  Verified by the ported TV tests running in a 960×540 viewport and converting CSS px × 2 to stage px.
- The web/ staging list:
  - `web/`, `vendor/hls.js` (copied from `app/hls.min.js`, the path web/js/app.js:773 loads), `vendor/supabase.js` (with its licence), `platform-core.js`, `boot.js` and a generated `config.js`;
  - `__AURORA_VERSION__` substituted in `platform-core.js`, and `class="platform-tv"` set on the staged `index.html`, with the same grep checks the app/ build uses (mobile/scripts/build-android.sh:21–32).
  `scripts/extract-keys.cjs`, shared with `web/server.cjs`, writes TMDB, OMDb, `SUPABASE_URL` and `SUPABASE_KEY` (app/renderer.js:3442–3445) into `config.js`, and the build fails if any of the four is empty. In the browser, `web/server.cjs` emits the same four values in `/config.js` and serves `/vendor/supabase.js`, so accounts work in both builds. Verified by a node test that the extractor returns all four values from `app/renderer.js`, a test that the build exits non-zero when one is blanked, and greps of the staged `www/`.
- The feature inventory `docs/plans/tv-feature-inventory.md` is written before parity work, with each row marked present, ported or missing. The flip gate is the plan's: every row present or ported, with no exceptions (plan step 2, design doc step 7). Parity order: the six features in plan step 4, then the remaining rows. Verified by the inventory file listing every `npm test` suite, every old-TV view, every player control, every setting, and Back behaviour on each screen (including leaving the app from Home), with no row marked missing when the default flips.
- Tests during the transition: both the app/ and web/ variants of the TV tests run in `npm test` until the default flips. Each parity feature gets a web/ variant that drives the UI: `together.cjs` for friends and Together, `update-notice.cjs` for the update notice, `local-sync.cjs` and `signed-in.cjs` for accounts and sync. `tv-scale.cjs` stays app/-only because it covers `fitToScreen`. Verified by the `npm test` script listing both variants.
- Trace builds only (`AURORA_TRACE=1`) enable WebView debugging. They write `android.webContentsDebuggingEnabled: true` into the synced `android/app/src/main/assets/capacitor.config.json` after `npx cap sync`, and never edit `mobile/capacitor.config.json`. The release build asserts the flag is absent or false in that same synced file. Verified by the assertion failing a release run when the flag is forced on, and by one trace build attaching to chrome://inspect.
- Release 0.39.0 uploads `dist/Aurora-TV-0.39.0.apk` under the asset name `Aurora-TV.apk`, plus the Mac zip built from app/ at 0.39.0 (design doc step 11). The release is created as a draft, each asset is uploaded and retried until `gh release view` lists it (the 103 MB Mac zip often fails its first upload), and it is published only after that. Verified by `gh release view v0.39.0 --json assets,isDraft` listing exactly `Aurora-TV.apk` and `Aurora-IPTV-Mac-Apple-Silicon.zip` with `isDraft: false`.
- E1 accepted: web/ bundles Inter itself for both the browser and the TV. That means `web/fonts/inter-*.woff2` (the weights 400–900 that web/index.html:8 asks for) with its OFL licence, and `@font-face` rules in web/css/app.css. app/fonts has no Inter. Verified by a staging check that neither `www/index.html` nor `web/index.html` references `fonts.googleapis.com`, and that the `inter-*.woff2` files exist by name in `www/fonts/`.
- Live TV windowing: at most 48 channel rows in the DOM, whatever the category size, with focus kept on the logical channel. Verified by a test on a 3,000-channel category, using the same 40-press `activeElement` never-`body` check as E2.
- On the TV, `platform.streamUrl(url)` returns the URL unchanged: CapacitorHttp's patched XHR reaches the provider, as it does for the old app. In the browser it wraps the URL in `/api/proxy`. Verified by a unit test on both branches.
- Theme: web/ keeps its own theme id in `web.prefs.theme`. On first read it maps the old `prefs.theme` (system/light/dark, app/renderer.js:65) to teal/teal/graphite, and it never writes `prefs.theme`. Verified by the fixture test leaving `prefs.theme` unchanged after a theme change in web/.
- E2 accepted: Movies and Series grids are windowed like Live TV, with focus kept on the logical item. Verified by a test that a 5,000-item category renders at most 72 cards in the DOM, and that during a 40-press held-arrow scroll `document.activeElement` always carries the logical item id and is never `body`.
- E4 accepted: an `npm run tv:web` script previews the web/ TV build at 960×540 through `scripts/tv-preview.cjs` and `scripts/tv-preview-shim.js`. It stages `mobile/www` with `AURORA_STAGE_ONLY=1 AURORA_TV_UI=web bash mobile/scripts/build-android.sh`, which stops before `cap sync` and Gradle. The shim is extended to provide `auroraReady` and the old `prefs`/`secrets` shape. The in-flight TV preview files are committed or settled before PR 1. Verified by running it and getting a page at 960×540 with `platform-tv` set and `auroraReady` resolved.
- Delivery is ordered PRs, each leaving `npm test` green and the default TV build on app/ (audit trail #3):
  1. platform split, screen model, build switch, key extractor, plus the `AURORA_TRACE` flag and a baseline held-arrow Live TV trace on the real TV, before any parity code;
  2. shared store, fixture test, sync, plus the real-TV upgrade smoke test;
  3. feature inventory, then parity;
  4. windowing, the full budget trace, ported tests;
  5. default flip and release.
  Verified by a local `npm test` run on each PR (the repo has no CI), plus an app/ TV build from that PR still staging `renderer.js`.
- Cross-implementation contract tests, kept permanently in `npm test` and not only during the transition. A golden fixture runs round trips through both writers: app/ writes, web/ reads and writes, app/ reads; then the reverse. It covers favorites, progress, the vault seal/unseal with `sourcesRemoved` and `keysUpdatedAt`, and `library_filter`. Verified by the suite failing when either side changes a merge rule, a tombstone or the vault format (checked by mutating one field in a test-only branch).
- PR 1 gate, the TV sign-off: the owner looks at the 0.38.90 trace-mode build on the real TV, from the sofa, and says it reads and moves well, before any PR 2 work. Verified by the owner's recorded answer in the PR 1 description.
- PR 1 kill criterion for the stage override (audit trail #13): if the 0.38.90 baseline trace misses the budget (under 100 ms press to frame, 60 fps on a held arrow) or the owner finds text unreadable, stop before PR 2. Re-open the layout choice between three options: a viewport meta width of 1920 (no transform), native 960×540 CSS px, or the transform stage with fixes. Verified by the trace numbers and the sign-off recorded in the PR 1 description.
- If the 3890–3899 test codes run out before release, rehearse further builds under a separate test applicationId (`com.callsavvys.aurora.test`, with its own store, never the owner's data) rather than spending a 0.39.x code. Verified by the build script refusing an `AURORA_TEST_VERSION` at or above 0.39.0.
- web/index.html carries the same Content-Security-Policy as app/index.html:6 (`script-src 'self'`, no `unsafe-eval`). Verified by a staging grep, and by the web/ boot test running with it in place.
- `boot.js` waits at most 5 s for `auroraReady`. If it never resolves, the app starts read-only: no `prefs` or `secrets` writes, and a banner says the saved data could not be opened. Verified by a boot test with the Preferences plugin stubbed to never answer.
- `platform.storage` serializes every write through one queue (read-modify-write, one at a time), so a write never drops a field another await wrote. Verified by a test that pauses write A after its read, completes write B, and asserts both fields survive.
- Every `innerHTML` site in web/ that interpolates provider or TMDB text uses `esc()`. Verified by a test that loads a provider category named `<img src=x onerror=alert(1)>` and finds it rendered as text with no `img` element, plus a grep listing each `innerHTML` site and its escaping.
- Progress writes are throttled to one per 5 s during playback, plus one on pause, stop and exit, matching the old app (app/renderer.js:2729). The PR 1 trace times the first library load. Verified by a test counting `prefs` writes over 60 s of simulated playback (at most 13), and by the trace numbers in the PR 1 description.
<!-- /autoplan-accepted:ceo -->

<!-- autoplan-accepted:design -->
- First launch after the update: splash at once (spinner from 1 s), then Home with focus on the first Continue watching card when progress exists, otherwise the billboard. No who-menu at launch. Verified on the 0.38.98-over-0.38.8 real-TV test, and by a web/ boot test asserting the initial focused element.
- Nav map:
  - History is a Home row and a My List sub-section.
  - The who-menu is an avatar chip at the right end of the tab bar (focus order Home, Movies, Series, Live TV, My List, Search, Settings, avatar) that opens a focus-trapped sheet. Focus starts on the current account; Up/Down move; Back closes the sheet and refocuses the chip. Together lives in that sheet and in title-page actions.

  Verified by tv-nav (web/ variant) walking the bar and the sheet with keys only.
- Update notice: a non-blocking Home banner under the tab bar, reached with Down. The code 8502133 is in `--mono` at at least 48 stage px. "Later" snoozes it per version, and the notice is repeated in Settings → About. Verified by update-notice.cjs (web/ variant): the banner never takes focus at launch, and the snooze survives a relaunch.
- The states in the Design Pass 2 table are implemented as written, including:
  - read-only boot: banner with "Try again" / "Continue without saving", and every write action disabled with "Can't save right now";
  - revoked-session copy with local data still shown;
  - sync merges never moving focus;
  - EPG skeleton and blank-line rules, with fetch only for the visible window;
  - player and provider errors as plain copy with one focused action, and the raw error behind "Details";
  - empty History / Friends / one-account states, and Together invite card states.

  Verified by one test per row driving the UI to that state (the provider and Supabase stubbed), asserting the copy and the focused element.
- Text entry ports the old TV keyboard rule. Fields stay `readonly` with `inputmode=none` while focus passes over them, OK hands them to the system keyboard, and fields sit in the top half of the stage. Verified by a web/ tv-nav check that passing focus over a field never opens the keyboard, and by a real-TV keyboard check on 0.38.91 and 0.38.98.
- Back closes the frontmost overlay first (keyboard, who-menu sheet, episode panel, up-next, modals), then steps back through history, and exits from Home (ported from app/renderer.js:2701–2718). From the player, Back restores focus to the logical item id. Verified by a tv-nav sequence covering each overlay, plus the player round trip in a windowed list.
- A Together invite during playback shows as a corner card that never takes focus, times out after 15 s, and is joined with OK. Verified by together.cjs (web/ variant) asserting `document.activeElement` is unchanged when the card appears.
- Each parity screen gets a stage-px spec (layout, focus order, states, copy) in the inventory row before code, uses only existing app.css tokens with no new colours, and needs the owner's sign-off on a 960×540 `npm run tv:web` capture before merge. Verified by each parity PR carrying the spec and the signed-off capture.
- Type and focus:
  - `.card .badge` and `.wide .flag` are raised to `--t-min` (23 stage px);
  - body, row titles and EPG text are at least 29 stage px;
  - the focus-room check runs on the first, middle and last visible card and after a 40-press scroll;
  - `--ring` keeps at least 3:1 contrast against `--surface` in every theme;
  - windowed lists show "N / total" in `.head .count`.

  Verified by tv-sweep (web/ variant) checks for each, and by the PR 1 sofa sign-off naming Live TV with EPG, the title overview and Settings.
- Settings → Theme says web/ has dark themes only, and old `light` users land on teal (taste #34). Verified by the theme fixture test and a tv-sweep text check.
<!-- /autoplan-accepted:design -->

<!-- autoplan-accepted:dx -->
- Credential redaction: one `redact(text)` in `platform-core.js` (shared by web/ in the browser) replaces Xtream user/password path segments (`/live|movie|series/<user>/<pass>/`) and the `username`, `password`, `token` and `key` query values with `***`. It is applied to every "Details" string, the boot banner diagnostics, every console log line web/ writes, and every trace export attached to a PR. Verified by a test that renders a provider error for a credentialed URL and finds no password substring in Details or the console, and a grep of the saved trace JSON for the `secrets.sources` password returning nothing.
- `extract-keys.cjs` fails with code `E_KEYS_MISSING`. It prints one stderr line naming the missing key, the file and the pattern searched, and the re-run command, and never echoes the other key values. Verified by a test that blanks each key in turn and checks the message and exit code.
- `build-android.sh` validates every flag before any copying or `cap sync`:
  - `AURORA_TV_UI` is `app` or `web`;
  - `AURORA_TEST_VERSION` matches `0.38.9N`;
  - `AURORA_TRACE` requires `AURORA_TEST_VERSION`;
  - `AURORA_STAGE_ONLY` and `AURORA_APP_ID_SUFFIX` refuse release mode.

  It fails with what was given, the allowed values and a corrected command. It then prints one banner (UI, version, code, trace on/off, applicationId) before Gradle. `--help` lists every `AURORA_*` flag. Verified by a shell test table of bad flag combinations, each exiting non-zero with its message.
- The test-code ledger is a committed `mobile/test-codes.log` (code, UI, purpose, date). The script refuses a code at or below the last entry, prints the next free code, and appends the entry on success. Verified by a test that reuses a logged code and gets "already used … next free is …".
- `AURORA_APP_ID_SUFFIX=.test` is the named switch for the test applicationId fallback. It shows in the banner and is refused with a release build. Verified by the flag test table.
- The release upload is bounded:
  - at most 5 attempts per asset, with backoff;
  - before each retry, `gh release view --json isDraft,assets` checks that the draft still exists, and a vanished draft is recreated with every asset re-uploaded;
  - a listed asset whose size differs from the local file is deleted and re-uploaded;
  - on exhaustion it exits non-zero, naming the asset, the attempts made and the manual command.

  Verified by a dry-run test with `gh` stubbed to fail, drop the draft, and return a short asset.
- The release flag assertion fails with the synced config path, the value found, and "AURORA_TRACE may still be set". Verified by the flag test table.
- The boot timeout logs one redacted line, `[aurora] E_BOOT_STORAGE_TIMEOUT waited <ms> on Preferences.get(<key>); capacitor <ver>; build <ver>`. It is shown under the banner's "Details". "Try again" retries in place up to 3 times. The 5 s timeout is injectable for tests. Verified by the never-answer boot test with the timeout set to 50 ms.
- The browser `aurora-web` migration writes the migrated data to a new key and sets the version marker in the same write. It keeps the old key untouched for one release. On an exception it leaves the marker unset and logs `E_MIGRATE` with the record count. Verified by a test that throws mid-migration and finds the old data intact and the marker unset.
- `docs/tv-build.md` gives copy-paste blocks for preview (`npm run tv:web`), test build, trace build (`adb connect`, `adb install -r`, `aapt dump badging`, chrome://inspect) and release. The top of `docs/designs/web-ui-to-tv.md` carries a "Superseded by the plan" note linking audit trails #11 (forward rollback) and #13 (stage). Verified by following `docs/tv-build.md` from a clean checkout to a preview page.
- `npm run test:tv:web` and `npm run test:tv:app` run the two variants separately. The contract tests load renderer.js's writers in a headless Electron page through `tests/harness.cjs`. Pure merge logic runs in node:vm (prior learning: aurora-csp-blocks-eval-in-tests). Verified by both scripts passing on their own and `npm test` running both.
- The window sizes (48/72), the 3,000-record cap, the 5 s progress throttle and the boot timeout live in one `web/js/limits.js`. Verified by a grep finding no other literal for these values in web/js.
<!-- /autoplan-accepted:dx -->

<!-- autoplan-accepted:eng -->
- Trace mode never constructs the Supabase client and never writes `<key>.locked`. Verified by a boot test with `createClient` stubbed to throw if called, plus the existing byte-identical `prefs`/`secrets` check.
- The Supabase auth storage adapter in web/ writes `secrets.auth` only through `platform.storage`'s serialized queue. Verified by contract tests in both directions: refresh the session in web/ then boot app/ and stay signed in, and the reverse. Run under `tests/harness.cjs` against a stubbed Supabase that rotates refresh tokens.
- `platform-core.js` ports the unreadable rule from mobile/platform/platform-native.js:14–23 unchanged. A parse failure or get() error makes that key read-only for the session. Fixture cases cover corrupt `secrets`, corrupt `prefs` and a throwing get(), each asserting no write to that key and the read-only banner.
- A rejected Preferences `set()` keeps the in-memory state and shows "Can't save right now". Verified by a stubbed set() rejection test asserting both.
- `web/js/store.js` becomes an in-memory snapshot hydrated after `auroraReady`, with write-behind through the queue. Verified by a boot test asserting no store read before hydration, and the race test with a sync pull landing during a progress flush.
- Windowed zones in `focus.js` answer arrows by logical index: they re-render the window and focus by id before any geometric search. Zone memory is keyed by logical id. Verified by a test: leave a windowed row at item 2,500, go up to the tab bar, come back down, and land on item 2,500.
- The TMDB match cache lives in IndexedDB (`web.tmdb`), not Preferences. Verified by a test that 5,000 matches cause no Preferences write.
- The old app's IndexedDB library cache and `prefs.librarySchema` are never deleted or migrated by web/. Verified by the rollback rehearsals (0.38.92, 0.38.99) opening Home from cache, and a grep proving web/ never touches the `library` store.
- EPG requests are debounced until focus settles (250 ms), at most 3 in flight, results for off-window channels are dropped, and there is a 30 min per-channel cache. The values live in limits.js. Verified by a test that a held arrow across 200 channels makes at most 12 requests against a stubbed provider.
- `web/js/sync-core.js` is a classic script loaded by app/renderer.js and web/. It holds the pure logic: progress merge and cap, continue-watching selection, vault seal/unseal, library_filter. renderer.js switches to it first, in PR 2, with all existing app/ tests green. Its tests run in node:vm. The cross-writer contract tests then cover serialization round trips only (taste #39).
- When `AURORA_APP_ID_SUFFIX` is set, any test code is allowed, tracked in a separate `mobile/test-codes.test.log`. Parity iteration (PRs 3–4) uses the .test applicationId by default. The 389x codes are spent only on the baseline trace (0.38.90), the shared-store and rollback rehearsals (0.38.91, .92) and the final rehearsals (0.38.98, .99). Verified by the flag test table.
- The web/index.html CSP string equals app/index.html:6 byte for byte. Verified by a staging test comparing the two strings.
- The budget trace re-runs on every parity screen in PR 4 under the same kill rule, and the PR 1 trace records peak memory on the first library load. Verified by the PR 4 description listing every screen's p50/p95.
- `redact()` also reduces any URL whose host matches a configured source to scheme and host, including native CapacitorHttp error text. Verified by a redaction test with an M3U token URL and a native error string.
- The browser build checks `isSecureContext` before vault use and shows a clear error otherwise. Verified by a test that serves over a non-localhost http origin.
- Back from Home with the who-menu sheet open closes the sheet and does not exit. Verified by a tv-nav test.
- An APK upgrade during a queued write leaves each key either fully old or fully new. Verified by a test that kills the page mid-queue and re-reads.
- Parity 4.6 (friends and Together) starts with its own sub-plan and a real-TV test using the two known accounts. Verified by that sub-plan existing before 4.6 code.
- Replacements of earlier accepted text:
  - The CEO test-code table row "0.38.93–0.38.97 | web/ | PR 3–4 parity and budget-trace builds" is replaced. Parity and budget-trace iteration runs on the `.test` applicationId. 0.38.93–0.38.97 stay unused reserve on the real applicationId.
  - The DX line "contract tests load renderer.js's writers in a headless Electron page" is replaced by the sync-core.js rule above. The CEO contract-test bullet stays, applied to serialization round trips through sync-core.js.

  Verified by `mobile/test-codes.log` listing only 0.38.90–.92 and .98–.99 at release.
<!-- /autoplan-accepted:eng -->
## Review record

**Status: APPROVED** 2026-11-04 at the /autoplan final gate (reply `rec`: d1–d7 recommended, plan1a).

Design doc (source of truth, APPROVED 2026-11-04): `docs/designs/web-ui-to-tv.md`.
Run `main-20261104-215451`. Outside voice: Codex not installed, so there is no outside coverage. The native passes run.

### CEO — Step 0 (SELECTIVE EXPANSION)

**System audit.**
- `main` has three uncommitted TV files (`mobile/platform/tv-nav.js`, `tv.css`, `scripts/tv-preview.cjs`) and an untracked `scripts/tv-preview-shim.js`. They are in-flight work from the old renderer's TV polish.
- There are no stashes and no TODOS.md.
- The only TODO/FIXME hit is vendored `app/hls.min.js`.
- Hot files in the last 30 days: `mobile/platform/tv.css` (25), `app/renderer.js` (25), `package.json` (24), `mobile/platform/tv-nav.js` (13).
- Retrospective: the 0.38.x series fixed TV layout scale three times (half-size drawing, vh/vw, 1% screen). That is why the design doc fixes one screen model for `web/`: native 960×540, no zoom.
- Taste references:
  - good: `web/js/focus.js` (one focus engine, 286 lines) and `mobile/platform/platform-native.js` (readable/unreadable distinction on storage);
  - avoid: `app/renderer.js` wholesale `innerHTML` re-render (learning `aurora-read-input-before-rerender`).

**0A Premise challenge.**
- The real problem is shipping the approved interface to TV users who update with Downloader 8502133, with zero data loss. The plan solves it directly, not through a proxy.
- Doing nothing keeps two UIs alive, and every TV fix keeps landing in the 4,437-line renderer.
- The office-hours premises hold, with one correction. Plan step 3 ("on first run … imports … into its own store") is superseded by the approved design doc's "one store, not an import". The design doc wins, so this is recorded as a CEO obligation below.

| premise | claim | receipt | verdict |
|---|---|---|---|
| P1 | TV already plays HLS via hls.js on patched XHR | app/renderer.js:2460 | verified |
| P2 | old state lives in Preferences `prefs`/`secrets` | mobile/platform/platform-native.js:31 | verified |
| P3 | Supabase session lives in `secrets.auth` | app/renderer.js:3460 | verified |
| P4 | sync is per-item newest-wins | app/renderer.js:3650 | verified |
| P5 | web/ posters are already w342 | web/js/tmdb.js:159 | verified |
| P6 | the release must carry `Aurora-TV.apk` | mobile/dist/Aurora-TV.apk (existing asset name) | verified |

**0B Existing code leverage.**
- Native storage, back and update notice: `platform-native.js`, split rather than rewritten.
- Focus: `web/js/focus.js`.
- Sync: port `pushChanges`/`pullChanges` (app/renderer.js:3610–3670) rather than redesign.
- Key extraction: the regexes in web/server.cjs:64.
- TV tests: `tests/tv-nav.cjs`, `tv-sweep.cjs`, `tv-chrome.cjs` and `tv-scale.cjs`, ported.
- TV preview: `scripts/tv-preview.cjs`, now uncommitted.

A rebuild is chosen only for the screens, because `web/` already holds the approved versions.

```
REALITY: premise-table pass 6 claims, all receipted, unverified=0 app/renderer.js:2460
REALITY: already-done finding plan step 5 "Posters load at TMDB w342" and "No backdrop-filter" are already true in web/ web/js/tmdb.js:159
REALITY: surface-check pass npm scripts tv/web/package:tv exist; get_short_epg is already called by the old app app/renderer.js:1011
REALITY: binding-decisions pass gstack-decision-search returned no branch decisions; the approved design doc is the binding record docs/designs/web-ui-to-tv.md:51
REALITY: numbers finding "498 live categories" and "about 2,100 lines" are unreceipted; measured 2,615 lines across web/ [measured: wc -l web/js/*.js web/server.cjs web/index.html web/css/app.css] web/js/app.js:1
REALITY: deferred-asks pass no linked issue docs/plans/web-ui-to-tv.md:83
REALITY: pr-count finding no .gstack/ship-policy.json, so the default is one PR per wave; the plan is one wave of 25+ files and should split into ordered PRs package.json:10
REALITY: units pass no input changes units; the screen-model decision restates every pixel threshold in stage px with CSS px in brackets web/js/app.js:19
REALITY: perf-table finding the budget "under 100 ms; 60 fps while a held arrow scrolls a row" has no baseline; measure main's app/ TV build first [re-measure before gate] web/js/app.js:773
```

**0C Dream state.**
```
  CURRENT STATE                    THIS PLAN                           12-MONTH IDEAL
  TV runs app/renderer.js     ---> TV runs web/ on one store shared ---> Mac, iPhone and TV all run web/;
  (4.4k-line monolith); web/       with the old app; parity incl.      renderer.js deleted; one focus
  runs only in a Mac browser       Together; app/ still builds         engine; one platform layer
```
The plan moves straight toward the ideal. The platform layer is the piece the Mac and iPhone later reuse.

**0D.** No new approach choice. Approach A was chosen by the user in /office-hours, 2026-11-04.

**0E Mode.** SELECTIVE EXPANSION (autoplan override). File count is an estimated 25+, so the default rule would recommend SCOPE REDUCTION. The override holds; the size concern goes to the pr-count row and decision #3.

**0F/0G.** HOLD checks:
1. Complexity: more than 8 files and several new modules (platform, boot, account, social, guide). This is justified because each replaces a renderer region one to one, but it needs splitting into PRs (D3).
2. Minimum changes: the parity order already front-loads the risky store work.
3. Invariants kept: no data loss, in-place upgrade, Downloader 8502133.

Expansion candidates (each auto-decided, see the audit trail):
- E1 bundle the Inter font into `www/`;
- E2 window the Movies/Series grids;
- E3 a "what's new" first-run card;
- E4 an `npm run tv:web` preview on `scripts/tv-preview.cjs`;
- E5 a TV crash/error reporter;
- E6 an in-app switch back to the old UI;
- E7 an automated emulator upgrade test (0.38.8 → 0.39.0).

<!-- autoplan-baseline-edits:ceo {"sourceSha256":"c99661abfd0ff039be91c2e9d3da0cdc6e43f173d0be5aea6d7858968e02d695","replacements":[{"oldText":"3. **Keep the user's data.** On first run, the web interface reads the old app's\n   Preferences keys (`prefs`, `secrets`) and imports the saved sources, the active\n   source, My List and watch progress into its own store. It never deletes the old keys,\n   so going back to an old APK still works.","newText":"3. **Keep the user's data: one store, not an import.** On the TV the web interface\n   reads and writes the old app's own Preferences keys (`prefs`, `secrets`) in their old\n   shape (read-modify-write, unknown fields kept), and keeps web-only data under\n   `web.prefs` and `web.tmdb`. Nothing is copied or deleted, so a rollback build of app/\n   (0.39.x, installed over the top) and the next upgrade both find the same data. Record shapes, sync and the full keep-list are in\n   `docs/designs/web-ui-to-tv.md` steps 4–6."},{"oldText":"The\n   default stays `app/` until step 6 passes, so a release can still be cut from the old\n   interface.","newText":"The\n   default stays `app/` until every row of the feature inventory\n   (`docs/plans/tv-feature-inventory.md`) is present or ported and step 6 passes, so a\n   release can still be cut from the old interface."},{"oldText":"### Where things stand (2026-11-05)","newText":"### Where things stand (2026-11-04)"},{"oldText":"- `web/` (about 2,100 lines across","newText":"- `web/` (about 2,500 lines across"},{"oldText":"   6. friends and Together.\n5. **Television performance.**","newText":"   6. friends and Together;\n   7. then every remaining row of `docs/plans/tv-feature-inventory.md` (known: audio and\n      subtitle track menus, the preview's connection limits, the billboard's rotation).\n5. **Television performance.**"}]} -->

<!-- autoplan-accepted:ceo -->
- One store, not an import, per design doc step 4. On the TV, web/ reads and writes the old `prefs`/`secrets` Preferences keys in their old shape with read-modify-write, and web-only data goes under `web.prefs`/`web.tmdb`. Verified by the fixture test that runs both writers on one captured `prefs` snapshot and compares whole `favorites` and progress records after play, resume, hide and forget, then has the old renderer read the result back.
- Progress records keep the old playback-record schema, merge rule, `hidden` on hide, `progressGone` only on forget, and the 3,000 cap with live entries dropped first (design doc step 4). Verified by the same fixture test, asserting each field for a movie, a live channel and an episode.
- Continue watching ports the old rules unchanged (app/renderer.js:1067–1125):
  - a film is underway when `position > 20` s and below 95% of `duration`;
  - episodes group per show on the newest record, and a show is hidden only when that latest record is `hidden`;
  - a finished episode offers the next one from its `next` hint;
  - the row is capped at 20, newest first.
  web/js/store.js's 30 s rule and `at` field are replaced. In the browser, existing `aurora-web` progress is migrated once (`at` becomes `updatedAt`, and `item` fields are mapped onto the playback-record names), and a version marker stops it from running twice. Verified by fixture-test assertions on one underway film, one finished episode with `next`, one hidden latest episode and 21 records.
- Test builds never use up a release versionCode. Builds sideloaded on the real TV before release take `AURORA_TEST_VERSION=0.38.NN`. It overrides both VERSION and CODE in build-android.sh before the manifest/gradle python step (code = a×10000+b×100+c, build-android.sh:11) and never edits package.json. Codes only ever increase, and all stay in 3890–3899, below 0.39.0's 3900. The sequence:

  | Code | UI | Purpose | Storage |
  |---|---|---|---|
  | 0.38.90 | web/ | PR 1 baseline Live TV trace (`AURORA_TRACE=1`) | **Trace mode:** reads `secrets.sources` and `prefs.activeSource` read-only to open the owner's line; every write goes to an isolated `web.trace` key; never writes `prefs` or `secrets` |
  | 0.38.91 | web/ | PR 2 shared-store smoke test, over 0.38.90 | shared store |
  | 0.38.92 | app/ | PR 2 forward-rollback test, over 0.38.91 | shared store |
  | 0.38.93–0.38.97 | web/ | PR 3–4 parity and budget-trace builds, in order | shared store |
  | 0.38.98 | web/ (release candidate, parity complete) | final upgrade test: uninstall, reinstall the real 0.38.8 APK, sign in and seed it, then install 0.38.98 over it | shared store |
  | 0.38.99 | app/ | final forward-rollback test over 0.38.98 | shared store |

  The 0.39.0 release then installs over 0.38.99 through Downloader. Verified by `aapt dump badging` on each test APK showing its listed versionCode, and by a trace-mode test that runs the web/ boot with a captured `prefs`/`secrets` snapshot and finds both byte-identical afterwards.
- Upgraded users keep sources, active source, the Supabase session (`secrets.auth`), the vault key, My List, progress, History and the sync cursor (design doc step 5). Verified on the real TV with the 0.38.91 smoke build, with 0.38.98 installed over a freshly seeded 0.38.8 (the real user path, with parity complete), and with 0.39.0 through Downloader on release day. Each time the user lands signed in, on the same line, with My List and Continue watching intact.
- Rollback is forward, never down. Android refuses an APK with a lower versionCode over a release install (0.38.8 = 3808 < 0.39.0 = 3900; mobile/android/app/build.gradle:10), and uninstalling first wipes Preferences. So a rollback is a 0.39.x build of app/ with a higher versionCode, which reads the same store. Verified before release with 0.38.92 over 0.38.91 and 0.38.99 over 0.38.98, finding the same My List, progress and sign-in each time. After release, a real rollback ships as 0.39.1 built from app/. It carries both `Aurora-TV.apk` and the Mac zip, with the same draft-and-verify upload as 0.39.0. (This replaces the design doc's "re-installing the previous APK" success criterion, which Android cannot perform.)
- Sync ports everything the old app sends to the account, unchanged:
  - favorites and progress: per-item newest-wins, through `push_favorites` and `push_progress` (app/renderer.js:3610–3670);
  - the sealed `vault` of provider logins and keys, push and restore (app/renderer.js:3500–3560), with `sourcesRemoved` tombstones and `keysUpdatedAt`;
  - the `library_filter` that Together uses for what friends can both play (app/renderer.js:3876–3890), with `filterStamp` and `partyOffsets`.
  The first two belong to parity 4.1; `library_filter` and `partyOffsets` belong to 4.6. Verified by porting `tests/local-sync.cjs` (it covers `sourcesRemoved`, tests/local-sync.cjs:78), `tests/signed-in.cjs` and `tests/together.cjs` to the web/ build, all driven through the UI.
- `platform-native.js` splits into `platform-core.js` and `platform-boot-app.js`. The app/ TV build behaves the same, and web/ waits on `window.auroraReady` (design doc step 1). Verified by a test that the staged app/ `www/index.html` still loads the renderer and `tv-nav.js`, and a web/ boot test that no storage read happens before `auroraReady`.
- Screen model: web/ keeps its own 1920×1080 stage, scaled by `fit()` with a CSS transform (web/js/app.js:18–24). The owner approved it on the Mac as it is. On the TV's 960×540 viewport that scale is 0.5. The old app's root `zoom` (`fitToScreen`) is never loaded in the web/ build. **This is an explicit CEO override of design doc step 2** ("lays out natively at 960×540 CSS px"), audit trail #13 (taste, surfaced at the final gate). It keeps that step's one scale model and no root zoom, but not its native layout, and it avoids rewriting every pixel value in app.css.
  - Units: thresholds are stated in stage px, with CSS px at the TV's 960×540 viewport in brackets.
  - Focus room: at least 40 stage px (20 CSS px) from the first focused card's grown artwork to its clipping box and to the heading above it. Plan step 6's "40px" means stage px.
  - Type floor: every visible text node's computed size is at least 23 stage px (11.5 CSS px), the rule web/css/app.css:43 already states. A new check in the web/ variant of `tests/tv-sweep.cjs` enforces it on every screen it visits.
  Verified by the ported TV tests running in a 960×540 viewport and converting CSS px × 2 to stage px.
- The web/ staging list:
  - `web/`, `vendor/hls.js` (copied from `app/hls.min.js`, the path web/js/app.js:773 loads), `vendor/supabase.js` (with its licence), `platform-core.js`, `boot.js` and a generated `config.js`;
  - `__AURORA_VERSION__` substituted in `platform-core.js`, and `class="platform-tv"` set on the staged `index.html`, with the same grep checks the app/ build uses (mobile/scripts/build-android.sh:21–32).
  `scripts/extract-keys.cjs`, shared with `web/server.cjs`, writes TMDB, OMDb, `SUPABASE_URL` and `SUPABASE_KEY` (app/renderer.js:3442–3445) into `config.js`, and the build fails if any of the four is empty. In the browser, `web/server.cjs` emits the same four values in `/config.js` and serves `/vendor/supabase.js`, so accounts work in both builds. Verified by a node test that the extractor returns all four values from `app/renderer.js`, a test that the build exits non-zero when one is blanked, and greps of the staged `www/`.
- The feature inventory `docs/plans/tv-feature-inventory.md` is written before parity work, with each row marked present, ported or missing. The flip gate is the plan's: every row present or ported, with no exceptions (plan step 2, design doc step 7). Parity order: the six features in plan step 4, then the remaining rows. Verified by the inventory file listing every `npm test` suite, every old-TV view, every player control, every setting, and Back behaviour on each screen (including leaving the app from Home), with no row marked missing when the default flips.
- Tests during the transition: both the app/ and web/ variants of the TV tests run in `npm test` until the default flips. Each parity feature gets a web/ variant that drives the UI: `together.cjs` for friends and Together, `update-notice.cjs` for the update notice, `local-sync.cjs` and `signed-in.cjs` for accounts and sync. `tv-scale.cjs` stays app/-only because it covers `fitToScreen`. Verified by the `npm test` script listing both variants.
- Trace builds only (`AURORA_TRACE=1`) enable WebView debugging. They write `android.webContentsDebuggingEnabled: true` into the synced `android/app/src/main/assets/capacitor.config.json` after `npx cap sync`, and never edit `mobile/capacitor.config.json`. The release build asserts the flag is absent or false in that same synced file. Verified by the assertion failing a release run when the flag is forced on, and by one trace build attaching to chrome://inspect.
- Release 0.39.0 uploads `dist/Aurora-TV-0.39.0.apk` under the asset name `Aurora-TV.apk`, plus the Mac zip built from app/ at 0.39.0 (design doc step 11). The release is created as a draft, each asset is uploaded and retried until `gh release view` lists it (the 103 MB Mac zip often fails its first upload), and it is published only after that. Verified by `gh release view v0.39.0 --json assets,isDraft` listing exactly `Aurora-TV.apk` and `Aurora-IPTV-Mac-Apple-Silicon.zip` with `isDraft: false`.
- E1 accepted: web/ bundles Inter itself for both the browser and the TV. That means `web/fonts/inter-*.woff2` (the weights 400–900 that web/index.html:8 asks for) with its OFL licence, and `@font-face` rules in web/css/app.css. app/fonts has no Inter. Verified by a staging check that neither `www/index.html` nor `web/index.html` references `fonts.googleapis.com`, and that the `inter-*.woff2` files exist by name in `www/fonts/`.
- Live TV windowing: at most 48 channel rows in the DOM, whatever the category size, with focus kept on the logical channel. Verified by a test on a 3,000-channel category, using the same 40-press `activeElement` never-`body` check as E2.
- On the TV, `platform.streamUrl(url)` returns the URL unchanged: CapacitorHttp's patched XHR reaches the provider, as it does for the old app. In the browser it wraps the URL in `/api/proxy`. Verified by a unit test on both branches.
- Theme: web/ keeps its own theme id in `web.prefs.theme`. On first read it maps the old `prefs.theme` (system/light/dark, app/renderer.js:65) to teal/teal/graphite, and it never writes `prefs.theme`. Verified by the fixture test leaving `prefs.theme` unchanged after a theme change in web/.
- E2 accepted: Movies and Series grids are windowed like Live TV, with focus kept on the logical item. Verified by a test that a 5,000-item category renders at most 72 cards in the DOM, and that during a 40-press held-arrow scroll `document.activeElement` always carries the logical item id and is never `body`.
- E4 accepted: an `npm run tv:web` script previews the web/ TV build at 960×540 through `scripts/tv-preview.cjs` and `scripts/tv-preview-shim.js`. It stages `mobile/www` with `AURORA_STAGE_ONLY=1 AURORA_TV_UI=web bash mobile/scripts/build-android.sh`, which stops before `cap sync` and Gradle. The shim is extended to provide `auroraReady` and the old `prefs`/`secrets` shape. The in-flight TV preview files are committed or settled before PR 1. Verified by running it and getting a page at 960×540 with `platform-tv` set and `auroraReady` resolved.
- Delivery is ordered PRs, each leaving `npm test` green and the default TV build on app/ (audit trail #3):
  1. platform split, screen model, build switch, key extractor, plus the `AURORA_TRACE` flag and a baseline held-arrow Live TV trace on the real TV, before any parity code;
  2. shared store, fixture test, sync, plus the real-TV upgrade smoke test;
  3. feature inventory, then parity;
  4. windowing, the full budget trace, ported tests;
  5. default flip and release.
  Verified by a local `npm test` run on each PR (the repo has no CI), plus an app/ TV build from that PR still staging `renderer.js`.
- Cross-implementation contract tests, kept permanently in `npm test` and not only during the transition. A golden fixture runs round trips through both writers: app/ writes, web/ reads and writes, app/ reads; then the reverse. It covers favorites, progress, the vault seal/unseal with `sourcesRemoved` and `keysUpdatedAt`, and `library_filter`. Verified by the suite failing when either side changes a merge rule, a tombstone or the vault format (checked by mutating one field in a test-only branch).
- PR 1 gate, the TV sign-off: the owner looks at the 0.38.90 trace-mode build on the real TV, from the sofa, and says it reads and moves well, before any PR 2 work. Verified by the owner's recorded answer in the PR 1 description.
- PR 1 kill criterion for the stage override (audit trail #13): if the 0.38.90 baseline trace misses the budget (under 100 ms press to frame, 60 fps on a held arrow) or the owner finds text unreadable, stop before PR 2. Re-open the layout choice between three options: a viewport meta width of 1920 (no transform), native 960×540 CSS px, or the transform stage with fixes. Verified by the trace numbers and the sign-off recorded in the PR 1 description.
- If the 3890–3899 test codes run out before release, rehearse further builds under a separate test applicationId (`com.callsavvys.aurora.test`, with its own store, never the owner's data) rather than spending a 0.39.x code. Verified by the build script refusing an `AURORA_TEST_VERSION` at or above 0.39.0.
- web/index.html carries the same Content-Security-Policy as app/index.html:6 (`script-src 'self'`, no `unsafe-eval`). Verified by a staging grep, and by the web/ boot test running with it in place.
- `boot.js` waits at most 5 s for `auroraReady`. If it never resolves, the app starts read-only: no `prefs` or `secrets` writes, and a banner says the saved data could not be opened. Verified by a boot test with the Preferences plugin stubbed to never answer.
- `platform.storage` serializes every write through one queue (read-modify-write, one at a time), so a write never drops a field another await wrote. Verified by a test that pauses write A after its read, completes write B, and asserts both fields survive.
- Every `innerHTML` site in web/ that interpolates provider or TMDB text uses `esc()`. Verified by a test that loads a provider category named `<img src=x onerror=alert(1)>` and finds it rendered as text with no `img` element, plus a grep listing each `innerHTML` site and its escaping.
- Progress writes are throttled to one per 5 s during playback, plus one on pause, stop and exit, matching the old app (app/renderer.js:2729). The PR 1 trace times the first library load. Verified by a test counting `prefs` writes over 60 s of simulated playback (at most 13), and by the trace numbers in the PR 1 description.
<!-- /autoplan-accepted:ceo -->

**0H.** The CEO plan is at `~/.gstack/projects/callsavvys-aurora-iptv/ceo-plans/2026-11-04-web-ui-to-tv.md`.
- Spec review: 3 launches (the cap). Scores 5, then 5, then 6 out of 10. 45 findings, 0 confirmed by a later reviewer.
- Round-3 blocking fixes are applied (issues verified: 3 of 3, applied text present) and were not re-reviewed.
- The documents are approved by auto-decision (audit trail #17).

**0I. Temporal interrogation** (human team / CC+gstack):
- **HOUR 1 (foundations).** The implementer needs three things first:
  - `platform-native.js` today loads `renderer.js` itself (lines 169–179), so the split must land before web/ can boot;
  - web/ draws a 1920×1080 stage (app.js:18–24);
  - the old `prefs`/`secrets` shapes in full. Capture a real snapshot from the owner's TV (adb `run-as` cannot read Preferences on a release build, so use a trace-mode export) before writing the store.

  Human ~1 day / CC ~1 h.
- **HOUR 2–3 (core logic).** Ambiguities they will hit:
  - item-id equality between `web/js/sources.js` and the old library (`item.id` formats per kind);
  - episode `key` = `episode-<id>`;
  - which `prefs` fields web/ may touch.
  - The fixture test settles all three, and it has to exist before any store code.

  Human ~3 days / CC ~3 h.
- **HOUR 4–5 (integration).** What will surprise them:
  - CapacitorHttp patches `fetch` globally, so TMDB and GitHub calls also go native. They need a User-Agent (platform-native.js:99).
  - Supabase `persistSession` writes through `saveSecrets` on every refresh.
  - hls.js must load from `vendor/hls.js`.

  Human ~1 week (parity) / CC ~1 day.
- **HOUR 6+ (polish and tests).** What they will wish they had planned:
  - the test-build versionCode ledger, with codes only increasing;
  - a trace-mode export of `prefs`/`secrets` for fixtures;
  - the draft-and-verify release upload.

  Human ~3 days / CC ~3 h.

Feasibility blockers: none open. Pending choices: none. The theme mapping is a provisional auto-choice, and the web/ line count is cosmetic.


### CEO — Dual voices

Codex is not installed, so there is no outside voice. Mode: `[subagent-only]`. The independent Claude CEO reviewer read the full input (INPUT hash c19224a7…). Its findings and their dispositions:
- **CRITICAL: drift between two implementations of one sync protocol.** Accepted. Contract tests are now an obligation (#18). Extracting a shared core module is deferred to the later Mac/iPhone plan, because renderer.js is a classic script built on lexical globals (learning `aurora-renderer-globals-not-on-window`).
- **HIGH: the owner has not seen web/ on the real TV.** Accepted, as a PR 1 sign-off gate (#19).
- **HIGH: no kill criterion for the 0.5-scale stage.** Accepted (#20). The reviewer's viewport-meta middle path is one of the re-open options.
- **MEDIUM: the gate is all-or-nothing for a two-user app.** Not reopened. The user decided "All six first" in /office-hours on 2026-11-04. Only one model raised it, so it is not a User Challenge.
- **MEDIUM: the test versionCode budget could run out.** Accepted, with a fallback to a separate test applicationId (#21).
- **HIGH: ship both UIs in one APK.** Taste (#9 revisited). The CEO skip stands; the reviewer disagrees. It is surfaced at the final gate.
- **MEDIUM: reskin app/ instead.** Already rejected in /office-hours (Approach B).

```
CEO DUAL VOICES — CONSENSUS TABLE:  [subagent-only]
  Dimension                            Claude              Codex  Consensus
  1. Premises valid?                   partly (2a,2b)      —      N/A
  2. Right problem to solve?           yes, reframe        —      N/A
  3. Scope calibration correct?        heavy ceremony      —      N/A
  4. Alternatives sufficiently explored? no (dual-UI)      —      N/A
  5. Competitive/market risks covered? low risk, ok        —      N/A
  6. 6-month trajectory sound?         drift risk          —      N/A
Outside voice unavailable (Codex not installed): every Consensus cell is N/A.
```

### CEO — Review sections

**Current scope.**
- Mode: SELECTIVE EXPANSION (autoplan override).
- Accepted: #3, #4, #5, #7, #11, #13 (taste), #14, #15, #18–#22.
- Deferred: #8, #10. Skipped: #6, #9 (taste).
- Pending: none.

**Section 1: Architecture.**
```
            BROWSER (Mac)                              ANDROID TV (Capacitor WebView)
  web/index.html ─ boot.js ─ js/app.js            www/index.html (platform-tv, CSP)
                       │                                 │ platform-core.js → window.aurora, auroraReady
                       ▼                                 ▼ boot.js awaits auroraReady
                 js/platform.js  ◄──── the only module that knows where it runs ────►
          net: /api/proxy      storage: localStorage │ net: patched fetch/XHR (CapacitorHttp)
          config: /config.js   'aurora-web'          │ storage: Preferences prefs/secrets (SHARED with app/)
                       │                             │          + web.prefs / web.tmdb / web.trace
   sources.js  tmdb.js  store.js  account.js*  sync.js*  social.js*  guide.js*  update.js*  player
                       │                                 │
             web/server.cjs (proxy, config, vendor)   Supabase (favorites, progress, vault,
                                                        library_filter)  ◄── app/ on the Mac writes the same rows
   * = new parity modules. app/ build path is unchanged: platform-core.js + platform-boot-app.js → renderer.js → tv-nav.js
```
- Coupling: the new and deliberate coupling is the shared Preferences schema between app/ and web/. It is guarded by the fixture test and the contract tests (#18).
- Single points of failure: `platform-core.js` (every TV boot) and `extract-keys.cjs` (every build).
- Security boundary: unchanged. There are no new endpoints. web/server.cjs gains two read-only routes (`/config.js` fields and `/vendor/supabase.js`) on 127.0.0.1.
- Rollback posture: a forward 0.39.1 from app/, taking minutes to build plus a Downloader install.
- Scaling: what breaks first at 10x is a 10,000-channel line, which windowing caps (#16, Live TV at most 48 rows). At 100x, `prefs` JSON size: progress is already capped at 3,000.
- Value test: the feature inventory is consumed by the flip gate. Its owner is the implementer, and it retires at the flip. It passes.

**Section 2: Error & Rescue Map.** (method level)
```
  CODEPATH                       | WHAT CAN GO WRONG                         | CLASS
  platform-core read(key)        | Preferences unreadable / JSON corrupt     | Unreadable (existing {unreadable})
  boot.js await auroraReady      | never resolves (plugin missing)           | BootTimeout
  store write (read-modify-write)| concurrent write from another await       | LostUpdate
  extract-keys.cjs               | regex finds nothing                       | MissingKey (build fails)
  sources.connect                | 401/403, provider down, gzip length bug   | ProviderRefused / ProviderDown
  sync push/pull                 | offline, RPC error, revoked refresh token | SyncOffline / AuthRevoked
  vault unseal                   | key missing/wrong                         | VaultLocked
  hls.js                         | fatal network/media error                 | StreamError
  update check                   | GitHub 403/rate limit                     | UpdateCheckFailed

  CLASS             | RESCUED? | RESCUE ACTION                                            | USER SEES
  Unreadable        | Y        | keep the locked copy, never overwrite (platform-native.js:14) | "Your saved sources could not be read" + retry
  BootTimeout       | N ← GAP  | resolve after 5 s with an empty snapshot, read-only      | a banner, nothing written
  LostUpdate        | N ← GAP  | serialize writes through one queue in platform.storage   | nothing (prevented)
  MissingKey        | Y        | build exits non-zero                                     | build log
  ProviderRefused   | Y        | the provider's own words (commit 2c063fd)                | message naming the provider
  SyncOffline       | Y        | stay dirty, retry on next launch/focus                   | nothing; sync resumes
  AuthRevoked       | Y        | signed-out state, local data kept                        | "Signed out — sign in again" (memory: session revocation)
  VaultLocked       | Y        | as the old app does                                      | the old app's prompt
  StreamError       | Y        | `streamerror` event → player message                     | "This channel did not answer"
  UpdateCheckFailed | Y        | silent, retried next launch                              | nothing (non-blocking)
```
Two gaps (BootTimeout and LostUpdate) are accepted as obligations #23 and #24 (mechanical, P1).

**Section 3: Security & threat model.**
- Credentials: Xtream logins move from browser `localStorage` to Preferences on the TV, the same store the old app uses. No new exposure. Likelihood Low, impact High, mitigated.
- Missing CSP on web/index.html: an injected provider string (channel or category names) would run with the app's privileges. The `esc()` helper is used in ui.js, but app.js has 39 `innerHTML` sites. Likelihood Med, impact High. Mitigated by the CSP obligation (#22) and an audit of the 39 sites for `esc()` (#25).
- Trace builds are debuggable (WebView inspection exposes secrets): the release assertion and the 0.38.9x-only codes mitigate this.
- Proxy (`/api/proxy`) is browser-only on 127.0.0.1 and never logs URLs. Unchanged.
- Supabase publishable key in config.js is public by design (`sb_publishable_`). RLS is unchanged.
- No new dependencies. hls.js and supabase-js are vendored already.

**Section 4: Data flow & interaction edge cases.**
```
  INPUT(write) → VALIDATE(shape) → TRANSFORM(old schema) → PERSIST(Preferences, queued) → OUTPUT(view)
   nil item ─────► reject, no write     invalid record ─► drop field, keep record    write fails ─► keep in memory, banner
   duplicate key ► merge {...old,...patch}  stale read ─► queue serializes         partial JSON ─► {unreadable}, never overwrite
```
Async ordering. The invariant: a `prefs` write never drops a field another await wrote. Schedule: A reads `prefs`, B reads `prefs`, A writes, B writes, and B overwrites A's field. Prevented only by the single write queue (#24). Regression: a test pauses A after its read, lets B complete, and asserts both fields survive.
```
  INTERACTION             | EDGE CASE                         | HANDLED? | HOW
  Back on Home            | must exit the app                 | Y        | onBack returns false → exitApp (platform-native.js:131)
  held arrow in list      | windowed row unmounted            | Y        | logical focus (E2, #16)
  play pressed twice      | two hls instances                 | ?        | destroy previous (to verify in Eng)
  source with no login    | connect fails                     | Y        | "needs its login again"
  zero channels/category  | empty list                        | ?        | empty state (Design phase)
```

**Section 5: Code quality.** It fits existing patterns: ES modules in web/, one focus engine. There is a duplication risk with sync logic (handled by #18). Naming is fine. Over-engineering watch: no generic "adapter framework" for platform.js; six functions is enough. **No further issues.**

**Section 6: Tests.**
```
  NEW THING                      | TYPE        | HAPPY                    | FAILURE                      | EDGE
  platform split (app/ path)     | integration | renderer+tv-nav staged   | missing inject → build fails | —
  boot/auroraReady               | unit (vm)   | snapshot then app        | timeout → read-only (#23)    | browser path
  shared store fixture           | unit (vm)   | play/resume/hide/forget  | corrupt prefs → unreadable   | 3,000 cap, 21 Continue records
  contract tests app/↔web/       | integration | round trip equal         | mutated field → fail         | tombstones
  sync (web)                     | E2E (UI)    | local-sync, signed-in    | offline → stays dirty        | revoked token
  windowing                      | E2E         | ≤48 / ≤72 nodes          | focus never body             | 5,000 items
  CSP + innerHTML audit          | static+E2E  | boot under CSP           | injected <img onerror> inert | —
  extract-keys                   | unit        | 4 values                 | blank → exit≠0               | —
  release upload                 | manual      | 2 assets, not draft      | retry on failure             | —
```
- 2am-Friday test: the cross-implementation contract round trip.
- Hostile QA: a provider category named `<img src=x onerror=…>`.
- Chaos: kill the app between the read and the write of `prefs`.
- Test pyramid: unit-heavy store, few E2E. Flakiness risk is the real-TV steps, which are manual and listed.
- Prior learning applied: aurora-tests-must-drive-the-ui (9/10, 2026-11-02). Every parity test drives DOM events.

**Section 7: Performance.**
- Memory: library refetch on first web/ launch (no IndexedDB reuse) holds a 130k-title line in memory. The old app took 11 s to read it back (renderer.js:211). That needs a loading state and a measurement in the PR 1 trace.
- Posters are w342 already. `prefs` JSON with 3,000 progress records is about 1 MB, rewritten on every progress write: throttle progress writes to the old app's 5 s (renderer.js:2729).
- The top slow paths: the first library load, sync pull of 1,000 rows, and Together filter build.
- Accepted as #26: progress writes throttled to at most one per 5 s, plus library-load timing in the trace.

**Section 8: Observability.** There is no TV telemetry today (the E5 reporter is deferred). Day-1 debuggability: trace builds plus `chrome://inspect`. One gap: a bug reported three weeks after shipping cannot be reconstructed from the TV. That is accepted as deferred (E5, TODOS.md). Runbook: the rollback procedure in #11 and the release draft-and-verify.

**Section 9: Deployment & rollout.**
- No DB migrations; Supabase tables are unchanged.
- Feature flag: the `AURORA_TV_UI` build switch keeps the default on app/.
- Rollout order: PRs 1→5, real-TV gates in PRs 1, 2 and 4.
- Risk window: a Mac on app/ and a TV on web/ write the same rows at once (#18).
- Post-deploy: the first 5 minutes are the owner's own TV upgrading through Downloader, landing signed in. The first hour is the second user (watch-party friend) checking Together.
- Smoke test: the `gh release view` asset check.

**Section 10: Long-term trajectory.**
- Debt: two sync implementations until the Mac moves (#18 tests bound it), and the deferred stage-vs-native choice (#20).
- Reversibility: 4/5. A forward rollback is minutes; the shared store means no data migration to undo.
- 1-year question: yes, platform.js plus one store is obvious to a new engineer.
- Phase 2: the Mac and iPhone onto web/, extracting a shared sync core at that point.
- Retrospective: E6 (dual-UI) is the one skip that could prove load-bearing. It is surfaced at the gate.

**Section 11: Design & UX.** (UI scope yes)
```
  Downloader 8502133 → launch → [auroraReady] → Home (signed in, Continue watching)
      ├─► Live TV ─► guide (now/next) ─► player ─Back─► Live TV
      ├─► Movies/Series (windowed) ─► title page ─► player
      ├─► Search (keyboard) ─► result ─► title page
      ├─► Settings ─► sources ("needs its login again") / account / update notice
      └─ Back on Home ─► exit app
  FEATURE          | LOADING          | EMPTY           | ERROR                 | SUCCESS | PARTIAL
  first library    | "reading 130k…"  | demo source     | provider's words      | Home    | rows fill in
  Live TV guide    | skeleton         | "no guide"      | silent, retry         | now/next| some channels
  sync             | none             | —               | signed-out banner     | silent  | dirty kept
```
Interaction states for the new parity screens (sign-in, who-menu, History, guide, Together) are not designed yet. That is handed to the Design phase. Recommendation: run /plan-design-review, which this pipeline does next.

### CEO — Required outputs

REALITY lines are under Step 0 above.
```
PLAN_REALITY: see the check line recorded at phase close
```

**NOT in scope.**
- Deferred: E5 crash reporter (#8, TODOS.md); E7 emulator upgrade test (#10, TODOS.md); shared sync-core extraction (until the Mac/iPhone plan).
- Rejected: E3 "what's new" card (#6, out of scope); E6 dual-UI APK (#9, taste, at the gate); Approach B reskin and Approach C side-by-side APK (/office-hours).

**What already exists.**
- `platform-native.js` storage, back and update: split.
- `focus.js`: reused.
- `sources.js`, `tmdb.js`: reused.
- The sync/vault/filter logic in renderer.js: ported, with contract tests.
- The `server.cjs` key regexes: shared into extract-keys.
- TV tests: ported (both variants).
- `tv-preview.cjs` and the shim: extended.
- `app/vendor/supabase.js` and `hls.min.js`: staged.

**Dream state delta.** After this plan the TV runs web/ on the shared store, and the Mac and iPhone still run app/. Still missing against the 12-month ideal: the Mac and iPhone moving over, the shared sync core, renderer.js deleted, and TV telemetry.

**Error & Rescue Registry.** As the Section 2 table: 9 codepaths, 10 classes, 2 gaps (both accepted as #23 and #24).

**Failure Modes Registry.**
```
  CODEPATH            | FAILURE MODE                 | RESCUED? | TEST?        | USER SEES?            | LOGGED?
  boot                | auroraReady never resolves   | Y (#23)  | Y            | banner                | console
  store write         | lost update across awaits    | Y (#24)  | Y            | nothing               | —
  store write         | web shape breaks old app     | Y        | Y (fixture)  | nothing               | —
  sync                | drift app/ vs web/           | Y (#18)  | Y (contract) | nothing               | —
  sync                | refresh token revoked        | Y        | Y            | signed-out banner     | console
  innerHTML           | provider-string injection    | Y (#22,#25)| Y          | inert text            | —
  release             | Mac zip upload drops draft   | Y        | manual       | n/a                   | gh output
  stage scale         | misses budget / unreadable   | Y (#20)  | trace        | n/a (gate in PR 1)    | trace
  test codes          | run out                      | Y (#21)  | script guard | n/a                   | build log
  first library load  | 11 s with no feedback        | partial  | trace        | loading message       | —
```
CRITICAL GAPS: 0 (no row is RESCUED=N, TEST=N and silent at once).

**Scope expansion decisions.** Accepted: E1, E2, E4. Deferred: E5, E7. Skipped: E3, E6.

**Diagrams.** System architecture, data flow with shadow paths, error flow (Section 2), user flow and state (Section 11). The deployment sequence is the PR order plus the test-code table. The rollback flowchart is the forward-only rule in #11. Stale diagram audit: the touched files hold no ASCII diagrams besides prose comments in `platform-native.js` (fitToScreen), which remain accurate for the app/ path.

### CEO — Completion summary
```
  +====================================================================+
  |            MEGA PLAN REVIEW — COMPLETION SUMMARY                   |
  +====================================================================+
  | Mode selected        | SELECTIVE EXPANSION (autoplan override)     |
  | System Audit         | 3 uncommitted TV files; no TODOS; 0.38.x    |
  |                      | scale fixes x3; posters already w342        |
  | Step 0               | design doc adopted; PR split; 3 expansions  |
  | Section 1  (Arch)    | 1 issue (shared-schema coupling → #18)      |
  | Section 2  (Errors)  | 10 error paths mapped, 2 GAPS (→ #23, #24)  |
  | Section 3  (Security)| 2 issues found, 1 High (CSP/innerHTML)      |
  | Section 4  (Data/UX) | 5 edge cases mapped, 2 unhandled (→ Eng/Design)|
  | Section 5  (Quality) | 0 issues found                              |
  | Section 6  (Tests)   | Diagram produced, 0 gaps after obligations  |
  | Section 7  (Perf)    | 2 issues found (→ #26)                      |
  | Section 8  (Observ)  | 1 gap found (deferred E5)                   |
  | Section 9  (Deploy)  | 1 risk flagged (concurrent writers → #18)   |
  | Section 10 (Future)  | Reversibility: 4/5, debt items: 2           |
  | Section 11 (Design)  | 1 issue (parity screens undesigned → Design)|
  +--------------------------------------------------------------------+
  | NOT in scope         | written (7 items)                           |
  | What already exists  | written                                     |
  | Dream state delta    | written                                     |
  | Error/rescue registry| 10 rows, 0 CRITICAL GAPS                    |
  | Failure modes        | 10 total, 0 CRITICAL GAPS                   |
  | TODOS.md updates     | 2 items proposed                            |
  | Scope proposals      | 7 proposed, 3 accepted (SEL)                |
  | CEO plan             | written                                     |
  | Outside voice        | codex: unavailable (not installed); subagent completed |
  | Lake Score           | N/A (no scored questions; auto-decided)     |
  | Diagrams produced    | 5 (arch, data flow, error, user flow, state)|
  | Stale diagrams found | 0                                           |
  | Unresolved decisions | 0                                           |
  | Reality rows         | 9/9 rows, 0 unverified                      |
  +====================================================================+
```

### Design review (Phase 2)

**System audit.**
- UI scope: web/ screens on the TV, plus six parity screens: sign-in, who-menu, History, guide, update notice, friends/Together.
- No DESIGN.md exists. The de facto system is the tokens in web/css/app.css:15–51: five themes, a type scale from `--t-hero` 92 down to `--t-min` 23 stage px, `--safe-x` 80, `--gap` 40, radii 18/20, `--ease`. Recommend /design-consultation to turn that into a DESIGN.md (TODOS.md).
- Prior design reviews: none in reviews.jsonl. The retrospective is the 0.38.x TV scale fixes, already absorbed by the screen-model decision.

**Step 0.**
- 0A, initial rating 3/10: the plan specifies data, storage and tests precisely, but never what the user sees on the six new screens or the first launch. A 10 would give each parity screen a stage-px spec, focus order, all five states, copy, and an owner sign-off.
- 0B: no DESIGN.md (see above).
- 0C: reuse web/'s `.empty`, `.loading`, `toast()`, `.head .count`, the focus engine (`data-f`, `data-zone`), and the old TV keyboard rule (mobile/platform/tv-nav.js:211–240).
- 0D: all 7 dimensions (autoplan override).
- 0.5 mockups: the design tool is ready, but mockups are skipped (taste #29). The visual language is approved and built; each parity screen gets an owner sign-off on a real 960×540 capture instead (#31).

**Voices.** Codex is unavailable. Claude design subagent: completed (INPUT 1434900a…), 2 critical, 8 high and 9 medium findings, all dispositioned below. `[subagent-only]`.
```
DESIGN OUTSIDE VOICES — LITMUS SCORECARD:   [subagent-only]
  Check                                    Claude        Codex  Consensus
  1. Brand unmistakable in first screen?   NOT SPEC'D    —      N/A
  2. One strong visual anchor?             YES (billboard)—     N/A
  3. Scannable by headlines only?          YES (rows)    —      N/A
  4. Each section has one job?             NOT SPEC'D (new screens) — N/A
  5. Cards actually necessary?             YES (posters are the interaction) — N/A
  6. Motion improves hierarchy?            YES (focus grow) —   N/A
  7. Premium without decorative shadows?   NOT SPEC'D    —      N/A
  Hard rejections triggered:               none          —      N/A
```

**Pass 1, information architecture: 3 → 8.**
- H1, first launch: fixed (#30). The order matches the old app: splash; Home with focus on the first Continue watching card when there is progress, otherwise the billboard. No who-menu on launch, because the old app has none. The "new look" toast is skipped, as a new feature.
- H2, nav map for parity: fixed (#30).
  - History becomes a Home row and a My List sub-section.
  - The who-menu is an avatar chip at the right end of the tab bar.
  - Together lives inside the who-menu sheet and the title page's actions.
  - The update notice: see H3.
  - Left/Right order: Home, Movies, Series, Live TV, My List, Search, Settings, avatar.
- H3, update notice: fixed (#30). A non-blocking banner under the tab bar on Home, reached with Down, showing the code 8502133 in `--mono` at least 48 stage px, with a "Later" action that snoozes it per version. The same notice is repeated in Settings → About.

**Pass 2, interaction states: 2 → 8.** Every state below is accepted (#30):
```
  FEATURE            | LOADING                       | EMPTY                                  | ERROR                                         | SUCCESS            | PARTIAL
  boot (auroraReady) | splash at once; spinner at 1 s| —                                      | read-only banner: "Try again" / "Continue without saving"; write actions disabled with "Can't save right now" | Home | —
  account/session    | —                             | signed out: "Sign in to bring back your list", local list still shown | revoked: "You've been signed out. Sign in to bring back your list" (never looks like data loss) | silent | sync merges never move focus; applied when the row loses focus
  live guide         | fixed-height skeleton line    | blank second line (no per-row "No EPG")| silent, retried on refocus                    | now + bar, next muted | fetch only the visible window, cached
  player/provider    | spinner over the poster       | —                                      | plain copy plus one focused action: Retry / Back to channel / Switch source; "Your line has expired or the login changed" → source editor; the raw error behind "Details" | playback | —
  History            | —                             | "Nothing watched yet" + focus on Home  | —                                             | rows               | —
  Friends/Together   | —                             | "Share your code ABC123 to watch together" (code large) | invite declined or expired: one line + OK | party joined | partner cannot play: "Not on your friend's line" |
  who-menu           | —                             | one account: chip still shown (name + Settings) | —                                     | sheet              | —
```

**Pass 3, journey and emotional arc: 3 → 8.**
```
  STEP | USER DOES                    | USER FEELS              | PLAN SPECIFIES?
  1    | updates in Downloader        | nervous                 | yes (release, code 8502133)
  2    | first launch                 | "did I lose everything?"| yes (#30: splash → Home on Continue watching)
  3    | sees their list and progress | relief                  | yes (shared store, fixture test)
  4    | explores the new look        | delight                 | yes (approved web/)
  5    | Live TV, guide, Together     | trust                   | yes (#30 states, parity)
  6    | types (search, sign-in, source) | frustration risk     | yes (#30: the old TV keyboard rule)
  7    | presses Back                 | in control              | yes (#30 Back rules)
```
- J1, text entry: fixed by porting the old rule (mobile/tv-nav.js:211–240). Fields are held `readonly` with `inputmode=none` while focus passes over them, and OK hands them to the system keyboard. Fields sit in the top half of the stage. A real-TV keyboard check runs on 0.38.91 and 0.38.98. The device-code sign-in is skipped as a new feature.
- J2, Back: fixed, ported from app/renderer.js:2701–2718. Back closes the frontmost overlay (keyboard, who-menu sheet, episode panel, up-next, modals), then steps back through history. On Home it exits. From the player it restores focus to the logical item id and re-renders the window around it.
- J3, Together invite: fixed. A corner card that never takes focus from the player, saying "<name> invited you to <title> — press OK to join", and timing out after 15 s.

**Pass 4, AI slop risk: 7 → 8.** The classifier is OPERATE (app UI). No hard rejections. The approved web/ is specific: a tvOS type scale, theme tokens, a focus-grow motion.
- Risk: six new screens built without a brief would drift to generic sheets.
- Fix (#31): each parity screen gets a short stage-px spec (layout, focus order, states from Pass 2, copy) before code, and the owner signs off a 960×540 `npm run tv:web` capture before merge.
- Remaining slop note: `--font` leads with `-apple-system`, which on the TV falls to Inter, now bundled (E1). Accepted.

**Pass 5, design system alignment: 4 → 7.**
- No DESIGN.md. New screens must use only the existing tokens (`--t-*`, `--surface-*`, `--r-card`, `--gap`, `--ease`) with no new colours (#31).
- A2: `.card .badge` (20 px) and `.wide .flag` (21 px) break the 23 stage px floor (web/css/app.css:160, :174). Fixed: raised to `--t-min` (#32).
- DESIGN.md itself is deferred to TODOS.md (#33). That is why this pass stays at 7.

**Pass 6, responsive and accessibility: 4 → 8.** Responsive: one target, the 1920 stage scaled to the viewport; there is no phone layout in this plan.
- A1, type: two levels (#32). Badges and meta stay at the floor of 23 stage px. Body, row titles and EPG text are at least 29 stage px (`--t-body`). The PR 1 sofa sign-off names the screens it covers: Live TV rows with EPG, the title page overview, Settings.
- A2, focus room: checked on the first, middle and last visible card, and after a 40-press scroll (#32).
- A3, who-menu: a focus-trapped sheet. Focus starts on the current account; Up/Down move; Back closes it and returns focus to the chip.
- SP2: windowed lists show a position read-out in `.head .count` ("312 / 3,000"). A held arrow speeds up after 1 s, if the old app did so; the inventory checks.
- Focus ring uses `--ring` with at least 3:1 contrast against `--surface` in every theme, checked in tv-sweep.
- Screen readers: TV TalkBack is out of scope; the old app doesn't support it.

**Pass 7, unresolved design decisions.**
```
  DECISION NEEDED                     | IF DEFERRED, WHAT HAPPENS                  | RESOLUTION
  light-theme users after the update  | they get a dark UI with no explanation      | taste #34: web/ has no light theme by design; Settings → Theme row says so
  number-key jump on Live TV          | regression if the old app had it            | inventory row (checked against tv-nav.js)
  read-only semantics                 | phantom state lost on next launch           | resolved: writes blocked visibly (#30)
```
Resolved: 3. Deferred: 0.

**NOT in scope (design).** The "new look" toast (new feature), device-code / QR sign-in (new feature), TalkBack, mockups (taste #29), and DESIGN.md (TODOS.md).

**What already exists (design).**
- web/ tokens and components (`.empty`, `.loading`, `toast`, `.head .count`, `.round`);
- the focus engine (`web/js/focus.js`);
- the old TV keyboard rule (mobile/platform/tv-nav.js:211–240);
- the old Back order (app/renderer.js:2701–2718).

<!-- autoplan-accepted:design -->
- First launch after the update: splash at once (spinner from 1 s), then Home with focus on the first Continue watching card when progress exists, otherwise the billboard. No who-menu at launch. Verified on the 0.38.98-over-0.38.8 real-TV test, and by a web/ boot test asserting the initial focused element.
- Nav map:
  - History is a Home row and a My List sub-section.
  - The who-menu is an avatar chip at the right end of the tab bar (focus order Home, Movies, Series, Live TV, My List, Search, Settings, avatar) that opens a focus-trapped sheet. Focus starts on the current account; Up/Down move; Back closes the sheet and refocuses the chip. Together lives in that sheet and in title-page actions.

  Verified by tv-nav (web/ variant) walking the bar and the sheet with keys only.
- Update notice: a non-blocking Home banner under the tab bar, reached with Down. The code 8502133 is in `--mono` at at least 48 stage px. "Later" snoozes it per version, and the notice is repeated in Settings → About. Verified by update-notice.cjs (web/ variant): the banner never takes focus at launch, and the snooze survives a relaunch.
- The states in the Design Pass 2 table are implemented as written, including:
  - read-only boot: banner with "Try again" / "Continue without saving", and every write action disabled with "Can't save right now";
  - revoked-session copy with local data still shown;
  - sync merges never moving focus;
  - EPG skeleton and blank-line rules, with fetch only for the visible window;
  - player and provider errors as plain copy with one focused action, and the raw error behind "Details";
  - empty History / Friends / one-account states, and Together invite card states.

  Verified by one test per row driving the UI to that state (the provider and Supabase stubbed), asserting the copy and the focused element.
- Text entry ports the old TV keyboard rule. Fields stay `readonly` with `inputmode=none` while focus passes over them, OK hands them to the system keyboard, and fields sit in the top half of the stage. Verified by a web/ tv-nav check that passing focus over a field never opens the keyboard, and by a real-TV keyboard check on 0.38.91 and 0.38.98.
- Back closes the frontmost overlay first (keyboard, who-menu sheet, episode panel, up-next, modals), then steps back through history, and exits from Home (ported from app/renderer.js:2701–2718). From the player, Back restores focus to the logical item id. Verified by a tv-nav sequence covering each overlay, plus the player round trip in a windowed list.
- A Together invite during playback shows as a corner card that never takes focus, times out after 15 s, and is joined with OK. Verified by together.cjs (web/ variant) asserting `document.activeElement` is unchanged when the card appears.
- Each parity screen gets a stage-px spec (layout, focus order, states, copy) in the inventory row before code, uses only existing app.css tokens with no new colours, and needs the owner's sign-off on a 960×540 `npm run tv:web` capture before merge. Verified by each parity PR carrying the spec and the signed-off capture.
- Type and focus:
  - `.card .badge` and `.wide .flag` are raised to `--t-min` (23 stage px);
  - body, row titles and EPG text are at least 29 stage px;
  - the focus-room check runs on the first, middle and last visible card and after a 40-press scroll;
  - `--ring` keeps at least 3:1 contrast against `--surface` in every theme;
  - windowed lists show "N / total" in `.head .count`.

  Verified by tv-sweep (web/ variant) checks for each, and by the PR 1 sofa sign-off naming Live TV with EPG, the title overview and Settings.
- Settings → Theme says web/ has dark themes only, and old `light` users land on teal (taste #34). Verified by the theme fixture test and a tv-sweep text check.
<!-- /autoplan-accepted:design -->

### Design Review Completion Summary
```
  +====================================================================+
  |         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
  +====================================================================+
  | System Audit         | no DESIGN.md; tokens in app.css; UI scope yes|
  | Step 0               | 3/10 initial; all 7 dimensions              |
  | Pass 1  (Info Arch)  | 3/10 → 8/10 after fixes                     |
  | Pass 2  (States)     | 2/10 → 8/10 after fixes                     |
  | Pass 3  (Journey)    | 3/10 → 8/10 after fixes                     |
  | Pass 4  (AI Slop)    | 7/10 → 8/10 after fixes                     |
  | Pass 5  (Design Sys) | 4/10 → 7/10 after fixes                     |
  | Pass 6  (Responsive) | 4/10 → 8/10 after fixes                     |
  | Pass 7  (Decisions)  | 3 resolved, 0 deferred                      |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (5 items)                           |
  | What already exists  | written                                     |
  | TODOS.md updates     | 1 item proposed (DESIGN.md)                 |
  | Approved Mockups     | 0 generated (taste #29)                     |
  | Decisions made       | 10 added to plan (auto-decided)             |
  | Decisions deferred   | 0                                           |
  | Overall design score | 2/10 → 7/10                                 |
  +====================================================================+
```
Unresolved: Pass 5 stays at 7 until a DESIGN.md exists (deferred, TODOS.md).

### DX review (Phase 2.5, DX POLISH)

**Product type: CLI tool / build platform.** The surfaces are:
- `mobile/scripts/build-android.sh` and its `AURORA_*` flags;
- `npm run tv:web`;
- `scripts/extract-keys.cjs`;
- `npm test`;
- the test-code ledger;
- the release steps.

The scope check found 2 "API" terms. The real developer surface is this tooling.

```
TARGET DEVELOPER PERSONA
========================
Who:       the owner, a solo developer on a Mac, and the coding agent (Claude Code) building each PR
Context:   cutting a test build for the real TV, previewing a screen, running npm test, releasing
Tolerance: the agent cannot ask; it reads errors literally and retries. The owner abandons a step after about 10 minutes of setup
Expects:   one command per job, errors that name the fix, and no secret in any log
```
Persona auto-decided (#35): the owner plus the agent, because README.md has no third-party developer audience.

**Empathy narrative (predicted, from the plan and scripts).** I'm the agent picking up PR 1. I run `AURORA_TV_UI=web bash mobile/scripts/build-android.sh`. The script needs a JDK and the Android SDK, and checks for both at lines 12–15. Their messages are good: they name the brew or sdkmanager command. Then it runs Gradle for minutes, and I can't tell whether I built a test code or a release code until the APK exists. I need a trace build, so I add `AURORA_TRACE=1` and forget `AURORA_TEST_VERSION`. Nothing stops me, and now there is a debuggable APK on a release versionCode. The provider refuses a stream, the "Details" button shows the URL, and the owner's password is in it. On my next run I reuse 0.38.92 by mistake, and the TV says INSTALL_FAILED_VERSION_DOWNGRADE an hour later. The preview path, `npm run tv:web` with a stage-only build, is the bright spot: it shows the TV page in seconds.

**Competitive benchmark.** This is internal tooling, so the comparison is with reference tools from the gstack Hall of Fame; there was no web search.
| Tool | Start → result | Time + evidence | DX choice | Source |
|---|---|---|---|---|
| Expo `npx expo start` | clean checkout → app on device | ~2 min, reported | one command, QR to device | reference |
| Capacitor `npx cap run android` | built web → app on emulator | ~3–5 min, reported | one command, device picker | reference |
| Aurora `npm run tv:web` (planned) | checkout → TV page in a browser at 960×540 | ~1 min, estimated | stage-only, no Gradle | this plan |
| Aurora real-TV test build (planned) | checkout → APK on the TV | ~8 min, estimated (Gradle + adb, undocumented) | four flags, manual adb | this plan |

TTHW target, auto-decided (#36): Competitive, 2–5 min, for the preview path; under 10 min for a real-TV test build, with a documented copy-paste block.

**Magical moment.** `npm run tv:web` opens the real TV page at 960×540 with `platform-tv` set and the owner's line loaded, in one command. That is already accepted (E4); it is verified, not redesigned.

**Journey map.**
```
STAGE           | DEVELOPER DOES                                   | FRICTION POINTS                         | STATUS
1. Discover     | reads docs/designs + this plan                   | which doc wins when they disagree       | fixed (#37 overrides note)
2. Install      | JDK + Android SDK (script checks, build-android.sh:12–15) | good messages already           | ok
3. Hello World  | npm run tv:web                                   | none (stage-only)                       | ok
4. Real Usage   | test/trace builds, sideload, npm test            | unvalidated flags, reused codes, undocumented adb | fixed (#37)
5. Debug        | provider error Details, boot timeout, trace      | password in Details/logs; no dev signal | fixed (#37, CAP4 cleared)
6. Upgrade      | release draft-and-verify                         | unbounded retry, draft can vanish       | fixed (#37)
```

**First-time developer report.**
```
T+0:00  reads plan; runs npm run tv:web → page at 960×540 (ok)
T+0:30  wants a real-TV build; guesses flags from the plan text (no --help, no docs/tv-build.md)
T+1:00  AURORA_TRACE=1 without a test version → builds a debuggable APK on a release code (no guard)
T+5:00  sideloads; provider error → Details shows the stream URL with the password (CAP4)
T+8:00  next build reuses 0.38.92 → INSTALL_FAILED_VERSION_DOWNGRADE on the TV, with no hint why
```
Every item is addressed by #37.

**Passes.** Each score is before → after.
1. **Getting started, 7 → 8.** Preview is one command. The real-TV path needs `docs/tv-build.md` and `--help` (#37).
2. **CLI design, 6 → 8.** Flags are validated up front and a build banner prints before Gradle. `AURORA_APP_ID_SUFFIX` names the test-applicationId fallback. Window sizes, caps and throttles live in one `web/js/limits.js` (#37).
3. **Error messages, 4 → 8.** The CAP4 redaction is cleared, and the CAP6 items are each fixed. Matrix after the fixes:
```
ERROR PATH MATRIX (agent-ready-v1)
Path                         | Class      | what | fix  | recovery | code | context | trace | redaction | channel | Cap
extract-keys empty           | usage      | pass | pass | pass     | pass | pass    | N/A   | pass      | pass    | —
AURORA_TEST_VERSION reuse    | usage      | pass | pass | pass     | pass | pass    | N/A   | pass      | pass    | —
release upload failure       | dependency | pass | pass | pass     | pass | pass    | N/A   | pass      | pass    | —
boot auroraReady timeout     | unexpected | pass | pass | pass     | pass | pass    | pass  | pass      | pass    | —
player provider error        | dependency | pass | pass | pass     | pass | pass    | N/A   | pass      | pass    | —
```
   The safety model is stated: release builds can't be debuggable or use a test code, and test builds can't reach a release code.
4. **Docs, 4 → 7.** `docs/tv-build.md` gets copy-paste blocks for preview, test, trace and release. A source-of-truth note sits at the top of the design doc. There's still no search; that's acceptable for a solo repo.
5. **Upgrade path, 7 → 8.** The forward rollback, the code ledger and the bounded release are now covered.
6. **Dev environment, 6 → 7.** The repo has no CI. Subsets `npm run test:tv:web` and `test:tv:app` are added, plus an injectable boot timeout. Contract tests run renderer.js's writers in a headless Electron page through `tests/harness.cjs`, the same way existing tests do (prior learning: aurora-csp-blocks-eval-in-tests, so pure logic runs in node:vm).
7. **Community, N/A → N/A.** This is a private two-user app with no contributor surface. Not scored for adoption; recorded as 5 to keep the scorecard complete.
8. **DX measurement, 3 → 6.** The ledger records builds. PR descriptions carry the trace numbers. There's no TTHW instrumentation beyond a manual timing in `docs/tv-build.md`; acceptable.

**DX dual voices.** Codex unavailable; Claude DX subagent completed (INPUT f5702bf4…), 1 critical, 6 high, 7 medium. `[subagent-only]`.
```
DX DUAL VOICES — CONSENSUS TABLE:   [subagent-only]
  Dimension                           Claude          Codex  Consensus
  1. Getting started < 5 min?          yes (preview)   —      N/A
  2. API/CLI naming guessable?         partly          —      N/A
  3. Error messages actionable?        no → fixed      —      N/A
  4. Docs findable & complete?         no → fixed      —      N/A
  5. Upgrade path safe?                mostly          —      N/A
  6. Dev environment friction-free?    partly          —      N/A
```

<!-- autoplan-accepted:dx -->
- Credential redaction: one `redact(text)` in `platform-core.js` (shared by web/ in the browser) replaces Xtream user/password path segments (`/live|movie|series/<user>/<pass>/`) and the `username`, `password`, `token` and `key` query values with `***`. It is applied to every "Details" string, the boot banner diagnostics, every console log line web/ writes, and every trace export attached to a PR. Verified by a test that renders a provider error for a credentialed URL and finds no password substring in Details or the console, and a grep of the saved trace JSON for the `secrets.sources` password returning nothing.
- `extract-keys.cjs` fails with code `E_KEYS_MISSING`. It prints one stderr line naming the missing key, the file and the pattern searched, and the re-run command, and never echoes the other key values. Verified by a test that blanks each key in turn and checks the message and exit code.
- `build-android.sh` validates every flag before any copying or `cap sync`:
  - `AURORA_TV_UI` is `app` or `web`;
  - `AURORA_TEST_VERSION` matches `0.38.9N`;
  - `AURORA_TRACE` requires `AURORA_TEST_VERSION`;
  - `AURORA_STAGE_ONLY` and `AURORA_APP_ID_SUFFIX` refuse release mode.

  It fails with what was given, the allowed values and a corrected command. It then prints one banner (UI, version, code, trace on/off, applicationId) before Gradle. `--help` lists every `AURORA_*` flag. Verified by a shell test table of bad flag combinations, each exiting non-zero with its message.
- The test-code ledger is a committed `mobile/test-codes.log` (code, UI, purpose, date). The script refuses a code at or below the last entry, prints the next free code, and appends the entry on success. Verified by a test that reuses a logged code and gets "already used … next free is …".
- `AURORA_APP_ID_SUFFIX=.test` is the named switch for the test applicationId fallback. It shows in the banner and is refused with a release build. Verified by the flag test table.
- The release upload is bounded:
  - at most 5 attempts per asset, with backoff;
  - before each retry, `gh release view --json isDraft,assets` checks that the draft still exists, and a vanished draft is recreated with every asset re-uploaded;
  - a listed asset whose size differs from the local file is deleted and re-uploaded;
  - on exhaustion it exits non-zero, naming the asset, the attempts made and the manual command.

  Verified by a dry-run test with `gh` stubbed to fail, drop the draft, and return a short asset.
- The release flag assertion fails with the synced config path, the value found, and "AURORA_TRACE may still be set". Verified by the flag test table.
- The boot timeout logs one redacted line, `[aurora] E_BOOT_STORAGE_TIMEOUT waited <ms> on Preferences.get(<key>); capacitor <ver>; build <ver>`. It is shown under the banner's "Details". "Try again" retries in place up to 3 times. The 5 s timeout is injectable for tests. Verified by the never-answer boot test with the timeout set to 50 ms.
- The browser `aurora-web` migration writes the migrated data to a new key and sets the version marker in the same write. It keeps the old key untouched for one release. On an exception it leaves the marker unset and logs `E_MIGRATE` with the record count. Verified by a test that throws mid-migration and finds the old data intact and the marker unset.
- `docs/tv-build.md` gives copy-paste blocks for preview (`npm run tv:web`), test build, trace build (`adb connect`, `adb install -r`, `aapt dump badging`, chrome://inspect) and release. The top of `docs/designs/web-ui-to-tv.md` carries a "Superseded by the plan" note linking audit trails #11 (forward rollback) and #13 (stage). Verified by following `docs/tv-build.md` from a clean checkout to a preview page.
- `npm run test:tv:web` and `npm run test:tv:app` run the two variants separately. The contract tests load renderer.js's writers in a headless Electron page through `tests/harness.cjs`. Pure merge logic runs in node:vm (prior learning: aurora-csp-blocks-eval-in-tests). Verified by both scripts passing on their own and `npm test` running both.
- The window sizes (48/72), the 3,000-record cap, the 5 s progress throttle and the boot timeout live in one `web/js/limits.js`. Verified by a grep finding no other literal for these values in web/js.
<!-- /autoplan-accepted:dx -->

## DX Review Scorecard
```
+====================================================================+
|              DX PLAN REVIEW — SCORECARD                             |
+====================================================================+
| Dimension            | Score  | Prior  | Trend  |
|----------------------|--------|--------|--------|
| Getting Started      |  8/10  |  7/10  |  +1 ↑  |
| API/CLI/SDK          |  8/10  |  6/10  |  +2 ↑  |
| Error Messages       |  8/10  |  4/10  |  +4 ↑  |
| Documentation        |  7/10  |  4/10  |  +3 ↑  |
| Upgrade Path         |  8/10  |  7/10  |  +1 ↑  |
| Dev Environment      |  7/10  |  6/10  |  +1 ↑  |
| Community            |  5/10  |  5/10  |  n/a   |
| DX Measurement       |  6/10  |  3/10  |  +3 ↑  |
+--------------------------------------------------------------------+
| TTHW                 | ~1 min (preview) / ~8 min (TV, documented) |
| Competitive Rank     | Champion (preview), Needs Work → Competitive (TV) |
| Magical Moment       | designed via npm run tv:web                 |
| Product Type         | CLI tool / build platform                   |
| Mode                 | POLISH                                      |
| Overall DX           |  5/10 →  7/10 (lowest pass, excluding N/A community) |
+====================================================================+
| DX PRINCIPLE COVERAGE                                               |
| Zero Friction      | covered (tv:web)                               |
| Learn by Doing     | covered (copy-paste docs/tv-build.md)          |
| Fight Uncertainty  | covered (banner, coded errors)                 |
| Opinionated + Escape Hatches | covered (defaults app/, flags)       |
| Code in Context    | covered                                        |
| Magical Moments    | covered                                        |
| Agents Are Users   | covered (agent-ready errors, --help)           |
+====================================================================+
```
**DX implementation checklist.**
- [ ] tv:web preview < 2 min from checkout.
- [ ] Every build flag is validated, with a banner.
- [ ] Every error meets the agent-ready contract, with no secrets.
- [ ] The test-code ledger enforced.
- [ ] `docs/tv-build.md` followed end to end.
- [ ] The release retry is bounded, with a draft check.
- [ ] `--help` lists the flags.
- [ ] `test:tv:web` and `test:tv:app` subsets exist.

**NOT in scope (DX).** CI (the repo has none, by choice), TTHW instrumentation, and a community/contributor guide (private app).

**What already exists (DX).** The JDK/SDK checks with fix commands (build-android.sh:12–15), the signing-key generation messages, `tests/harness.cjs`, and `scripts/tv-preview.cjs`.

### Eng review (Phase 3)

**Scope challenge.**
- Existing code covers most sub-problems (see "What already exists" below).
- Complexity: an estimated 30+ changed files. The new modules are platform.js, platform-core.js, platform-boot-app.js, boot.js, limits.js, a shared sync-logic module, plus the account, social, guide and update screens. That trips the gate.
- Structure question (`plan-eng-review-structure`), auto-decided as the original arrangement. Each new module owns one region of the old renderer; no smaller arrangement keeps the parity contract. The CEO's ordered-PR split (#3) already bounds review size.
- Scope result: scope accepted as-is.
- TODOS cross-reference: none of the 3 TODOS entries blocks this plan.
- Distribution: the existing manual GitHub Release path; no CI, deferred by choice.

```
REALITY: premise-table pass 8 eng claims receipted, unverified=0; focus memory is element-keyed (WeakMap) web/js/focus.js:26
REALITY: already-done pass origin/main has no platform.js, AURORA_TV_UI or split shim yet mobile/scripts/build-android.sh:20
REALITY: surface-check pass npm scripts tv, web, package:tv exist; Preferences get/set used by the shim mobile/platform/platform-native.js:16
REALITY: binding-decisions pass no branch decisions logged; the plan's audit trail #1–#37 is the binding record docs/designs/web-ui-to-tv.md:51
REALITY: numbers finding the test-code band "all stay in 3890–3899" leaves too few codes for parity iteration; parity moves to the .test applicationId (#40) mobile/scripts/build-android.sh:11
REALITY: deferred-asks pass no linked issue docs/plans/web-ui-to-tv.md:97
REALITY: pr-count pass five ordered PRs (CEO #3), cost stated as one owner review plus one real-TV step each package.json:10
REALITY: units pass stage px versus CSS px stated for every threshold (×2) web/js/app.js:19
REALITY: perf-table finding there is no baseline; the PR 1 trace records machine (the owner's TV), data (498 categories), p50/p95 press-to-frame and memory, on app/ (main) and web/ interleaved [re-measure before gate] web/js/app.js:773
```

**Dual voices.** Codex unavailable. Claude eng subagent completed (INPUT b9c712c0…), 2 high, 8 medium, 6 low. `[subagent-only]`.
```
ENG DUAL VOICES — CONSENSUS TABLE:   [subagent-only]
  Dimension                           Claude              Codex  Consensus
  1. Architecture sound?               yes, with H1/H2     —      N/A
  2. Test coverage sufficient?         gaps (corrupt store, token, deep focus) — N/A
  3. Perf risks + budget/bench named?  partly (M3, M5, L2) —      N/A
  4. Security threats covered?         mostly (L3)         —      N/A
  5. Error paths handled?              gaps (H2, write-fail) —    N/A
  6. Deployment risk manageable?       yes, with M7/M8     —      N/A
```

**Section 1, architecture.**
```
                        ┌──────────── web/index.html (CSP = app/index.html:6 exactly) ───────────┐
                        │  boot.js ── awaits auroraReady (≤5 s, injectable) ──► js/app.js         │
                        └───────────────────────────────┬────────────────────────────────────────┘
   screens: home/movies/series/live/search/settings/title/person/player + account*/social*/guide*/update*
                        │                       │                      │
                  js/focus.js            js/store.js (in-memory snapshot, hydrated after auroraReady,
            (+ windowed zones by           write-behind) ── js/sync-core.js* (shared classic script:
             logical index/id)             progress merge+cap, continue-watching, vault seal, filter)
                        │                       │                      ▲ also loaded by app/renderer.js
                        └──────────── js/platform.js ──────────────────┘
                  net │ streamUrl │ storage(queue) │ config │ onBack │ version │ redact
        BROWSER: /api/proxy, localStorage 'aurora-web'     TV: platform-core.js → Capacitor Preferences
                 web/server.cjs + extract-keys.cjs              prefs / secrets (SHARED with app/) ·
                                                                web.prefs · web.trace · IndexedDB web.tmdb
   build: build-android.sh (flags validated, banner, ledger) → www → cap sync → (trace flag) → assembleRelease
   * new
```
Two shapes (design-twice), for the new shared-logic boundary:
- **(a)** web/ re-implements merge, cap, vault and filter, with contract tests across the two copies.
- **(b)** one `sync-core.js` classic script, loaded by both renderer.js and web/, with pure functions tested in node:vm.

Pick (b). One owner per rule hides more policy behind fewer functions (`mergeProgress`, `capProgress`, `continueWatching`, `seal`, `unseal`, `buildFilter`). It removes red flags 2 (information leakage), 5 (split ownership) and 8 (hand-synced list). Taste #39 reopens the CEO deferral of share-core (#18) on the new evidence: renderer.js's module-level side effects make the alternative contract harness brittle.

Remaining red flags:
- 6 (two ways to do one task): the old `platform-native.js` versus `platform-core.js`. Fixed by the split, which leaves one core.
- 7 (importable internals): none.

Findings and dispositions:
- [CRITICAL] (confidence 9/10) app/renderer.js:3461 "setItem: (key, value) => saveSecrets(...)". Token rotation can strand `secrets.auth` (H1). Accepted, #38.
- [CRITICAL] (confidence 9/10) mobile/platform/platform-native.js:20 "await store.set({ key: `${key}.locked`, value })". Read-modify-write without the unreadable rule wipes sources (H2). Accepted, #38.
- [INFORMATIONAL] (confidence 8/10) web/js/focus.js:26 "const memory = new WeakMap()". Windowing breaks element-keyed memory (M1). Accepted, #38.
- [INFORMATIONAL] (confidence 8/10) app/renderer.js:320 "async function idbPut". The IndexedDB library cache is missing from the keep-list (M4). Accepted, #38: it is never touched by web/ and is asserted after rollback.

**Section 2, code quality.**
- store.js reads synchronously at module load (web/js/store.js:6 "let data = read();"). M2 accepted: snapshot plus write-behind.
- The shared-code rubric for sync-core.js:
  - callers: renderer.js:1049–1065 (saveProgress, hideFromContinue), :1037 (persistProgress), :1117 (continueWatching), :3500–3560 (vault), :3876 (filter), plus proposed web/js/store.js;
  - estimate: about 250 lines moved out of renderer.js and about 0 re-written in web/, against about 250 that would otherwise be duplicated. That saves about 250 lines plus one contract-harness file.
  - Adoption order: extract with renderer.js calling it (PR 2, app/ tests stay green), then web/ adopts it.
- Error gaps: Preferences `set()` rejection (today it returns `saved:false`) has no UI. Accepted: the in-memory state is kept and "Can't save right now" is shown.

**Section 3, tests.** The framework is the existing custom harness: `electron tests/*.cjs` plus `node` for pure logic (package.json:10).
```
CODE PATHS                                              USER FLOWS
[+] platform-core.js                                    [+] Upgrade 0.38.8 → web/
  ├── read(key) ok / null / corrupt→unreadable [GAP→#38]   ├── [GAP][→E2E real TV] signed in, list intact (0.38.98)
  ├── write via queue (race) [planned CEO]                 └── [GAP][→E2E real TV] rollback 0.38.99 keeps data
  ├── set() rejects → saved:false UI [GAP→#38]          [+] Live TV
  └── redact() urls, details, traces [planned DX]          ├── [GAP] held arrow 3,000 channels, ≤48 nodes [planned]
[+] boot.js timeout / retry ×3 [planned DX]                ├── [GAP] deep index 2,500 → tab bar → back [GAP→#38]
[+] store.js snapshot hydrate / write-behind [GAP→#38]     └── [GAP] EPG ≤N requests over 200 channels [GAP→#38]
[+] sync-core.js (node:vm)                              [+] Account
  ├── mergeProgress / cap 3,000 live-first [planned]        ├── [GAP] refresh in web/ → boot app/ signed in [GAP→#38]
  ├── continueWatching 20s/95%/per-show/next/20 [planned]   └── [GAP] revoked session copy [planned design]
  ├── seal/unseal + tombstones [planned]                [+] Together invite card never steals focus [planned]
  └── buildFilter [planned]                             [+] Back from Home with sheet open → closes, no exit [GAP→#38]
[+] trace mode: no Supabase client, no .locked, byte-identical [GAP→#38]
[+] build-android.sh flags / ledger / banner [planned DX]
COVERAGE (planned after obligations): 28/28 paths have a planned ★★ or ★★★ test; 0 exist today (all new)
```
Prior learnings applied: aurora-tests-must-drive-the-ui (9/10), aurora-csp-blocks-eval-in-tests (9/10) and electron-test-unhandled-rejection-hangs (9/10). Every new electron test wraps `js()` in try/catch and exits 1.
Test plan artifact: `~/.gstack/projects/callsavvys-aurora-iptv/ziyadelhawarry-main-eng-review-test-plan-20261104-224500.md`.

**Section 4, performance.**
- M3: the TMDB match cache moves to IndexedDB `web.tmdb`, not Preferences.
- M5: EPG requests are debounced 250 ms, at most 3 in flight, dropped when off-window, and cached for 30 min. The values live in limits.js.
- L2: the budget trace re-runs on every parity screen in PR 4 under the same kill rule.
- L5: the PR 1 trace records peak memory on the first library load.
- `prefs` with 3,000 records is rewritten whole on each throttled write (about 1 MB at most once per 5 s). That's acceptable and measured in the trace.

**Failure modes registry (eng).**
```
  CODEPATH              | FAILURE                               | TEST?  | HANDLED?            | USER SEES          | CRITICAL?
  secrets read          | corrupt JSON                          | #38    | unreadable, no write| banner             | no (was yes)
  auth refresh          | rotated token not written back        | #38    | queued write        | stays signed in    | no (was yes)
  Preferences set       | rejects                               | #38    | memory kept         | "Can't save…"      | no
  windowed focus        | deep-index return lost                | #38    | logical id memory   | right card         | no
  EPG                   | request storm vs connection limit     | #38    | cap 3, debounce     | guide fills in     | no
  process kill mid-write| partial write                         | #38    | whole-key writes    | nothing            | no
```
0 critical gaps after the obligations.

**NOT in scope (eng).** CI; an emulator upgrade test (TODOS.md); TV telemetry (TODOS.md); a Together sub-plan, which is required as the first artifact of parity 4.6 rather than deferred.

**What already exists (eng).**
- `platform-native.js` read/unreadable/write (split);
- `focus.js` (extended with logical windowed zones);
- renderer.js sync, vault and filter logic (extracted to sync-core.js);
- IndexedDB helpers (renderer.js:320–335, reused for `web.tmdb`);
- `tests/harness.cjs`, `scripts/tv-preview.cjs`, and the key regexes in server.cjs:64.

**Parallelization.**
| Step | Modules touched | Depends on |
|---|---|---|
| A platform split, boot, build flags | mobile/platform, mobile/scripts, web/js (platform, boot) | — |
| B sync-core extraction | app/renderer.js, web/js/sync-core | — |
| C store snapshot + shared store | web/js/store, platform | A, B |
| D windowing + focus zones | web/js/focus, app | A |
| E parity screens | web/js screens | C, D |
| F release tooling (ledger, upload) | mobile/scripts, scripts | A |

Lanes: A → C → E; B ∥ A; D after A; F after A. Execution: launch A and B, merge both, then C, D and F in parallel, then E. Conflict flag: A and F both touch build-android.sh, so they run sequentially.

<!-- autoplan-accepted:eng -->
- Trace mode never constructs the Supabase client and never writes `<key>.locked`. Verified by a boot test with `createClient` stubbed to throw if called, plus the existing byte-identical `prefs`/`secrets` check.
- The Supabase auth storage adapter in web/ writes `secrets.auth` only through `platform.storage`'s serialized queue. Verified by contract tests in both directions: refresh the session in web/ then boot app/ and stay signed in, and the reverse. Run under `tests/harness.cjs` against a stubbed Supabase that rotates refresh tokens.
- `platform-core.js` ports the unreadable rule from mobile/platform/platform-native.js:14–23 unchanged. A parse failure or get() error makes that key read-only for the session. Fixture cases cover corrupt `secrets`, corrupt `prefs` and a throwing get(), each asserting no write to that key and the read-only banner.
- A rejected Preferences `set()` keeps the in-memory state and shows "Can't save right now". Verified by a stubbed set() rejection test asserting both.
- `web/js/store.js` becomes an in-memory snapshot hydrated after `auroraReady`, with write-behind through the queue. Verified by a boot test asserting no store read before hydration, and the race test with a sync pull landing during a progress flush.
- Windowed zones in `focus.js` answer arrows by logical index: they re-render the window and focus by id before any geometric search. Zone memory is keyed by logical id. Verified by a test: leave a windowed row at item 2,500, go up to the tab bar, come back down, and land on item 2,500.
- The TMDB match cache lives in IndexedDB (`web.tmdb`), not Preferences. Verified by a test that 5,000 matches cause no Preferences write.
- The old app's IndexedDB library cache and `prefs.librarySchema` are never deleted or migrated by web/. Verified by the rollback rehearsals (0.38.92, 0.38.99) opening Home from cache, and a grep proving web/ never touches the `library` store.
- EPG requests are debounced until focus settles (250 ms), at most 3 in flight, results for off-window channels are dropped, and there is a 30 min per-channel cache. The values live in limits.js. Verified by a test that a held arrow across 200 channels makes at most 12 requests against a stubbed provider.
- `web/js/sync-core.js` is a classic script loaded by app/renderer.js and web/. It holds the pure logic: progress merge and cap, continue-watching selection, vault seal/unseal, library_filter. renderer.js switches to it first, in PR 2, with all existing app/ tests green. Its tests run in node:vm. The cross-writer contract tests then cover serialization round trips only (taste #39).
- When `AURORA_APP_ID_SUFFIX` is set, any test code is allowed, tracked in a separate `mobile/test-codes.test.log`. Parity iteration (PRs 3–4) uses the .test applicationId by default. The 389x codes are spent only on the baseline trace (0.38.90), the shared-store and rollback rehearsals (0.38.91, .92) and the final rehearsals (0.38.98, .99). Verified by the flag test table.
- The web/index.html CSP string equals app/index.html:6 byte for byte. Verified by a staging test comparing the two strings.
- The budget trace re-runs on every parity screen in PR 4 under the same kill rule, and the PR 1 trace records peak memory on the first library load. Verified by the PR 4 description listing every screen's p50/p95.
- `redact()` also reduces any URL whose host matches a configured source to scheme and host, including native CapacitorHttp error text. Verified by a redaction test with an M3U token URL and a native error string.
- The browser build checks `isSecureContext` before vault use and shows a clear error otherwise. Verified by a test that serves over a non-localhost http origin.
- Back from Home with the who-menu sheet open closes the sheet and does not exit. Verified by a tv-nav test.
- An APK upgrade during a queued write leaves each key either fully old or fully new. Verified by a test that kills the page mid-queue and re-reads.
- Parity 4.6 (friends and Together) starts with its own sub-plan and a real-TV test using the two known accounts. Verified by that sub-plan existing before 4.6 code.
- Replacements of earlier accepted text:
  - The CEO test-code table row "0.38.93–0.38.97 | web/ | PR 3–4 parity and budget-trace builds" is replaced. Parity and budget-trace iteration runs on the `.test` applicationId. 0.38.93–0.38.97 stay unused reserve on the real applicationId.
  - The DX line "contract tests load renderer.js's writers in a headless Electron page" is replaced by the sync-core.js rule above. The CEO contract-test bullet stays, applied to serialization round trips through sync-core.js.

  Verified by `mobile/test-codes.log` listing only 0.38.90–.92 and .98–.99 at release.
<!-- /autoplan-accepted:eng -->

**Eng completion summary.**
- Step 0: scope accepted as-is.
- Reality rows: 9/9 (PLAN_REALITY below), 0 unverified.
- Architecture: 4 issues. Code quality: 3 issues. Tests: diagram produced, 9 gaps identified, all assigned. Performance: 5 issues.
- NOT in scope: written. What already exists: written.
- TODOS.md: 0 new (the 3 existing entries are kept).
- Failure modes: 0 critical gaps after the obligations.
- Unresolved decisions: 0.
- Outside voice: codex unavailable (not installed); Claude subagent completed.
- Parallelization: 3 lanes (A→C→E, B, D/F), 2 parallel, 1 sequential.
- Lake Score: N/A (auto-decided).

<!-- AUTONOMOUS DECISION LOG -->
## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|----------|
| 1 | CEO | Adopt the approved design doc's decisions as CEO obligations, superseding step 3's "first-run import" | Mechanical | P1 | The user approved the design doc after this plan was written; it closes the data-loss gaps | Keep the import |
| 2 | CEO | Mode SELECTIVE EXPANSION despite 25+ files | Mechanical | override | The autoplan CEO override fixes the mode | SCOPE REDUCTION |
| 3 | CEO | Ship as ordered PRs (platform+build → store+sync → inventory+parity → perf+tests → release) instead of one wave | Taste | P6/P5 | The default is one PR per wave, but 25+ files that touch storage shared by live TVs are safer reviewed in layers; the default build stays app/ throughout | One PR |
| 4 | CEO | E1 bundle Inter: accept | Mechanical | P2 | In the blast radius (staging), S effort, removes a startup network dependency | Defer |
| 5 | CEO | E2 window the Movies/Series grids: accept | Mechanical | P2/P1 | Same focus engine, under a day; a large line holds thousands of posters | Live TV only |
| 6 | CEO | E3 "what's new" card: skip | Mechanical | user out-of-scope | "New features the old app never had" is out of scope | Add |
| 7 | CEO | E4 `npm run tv:web` preview: accept | Mechanical | P2/P4 | Reuses `scripts/tv-preview.cjs`; S effort | Skip |
| 8 | CEO | E5 crash reporter: defer to TODOS.md | Mechanical | P3 | New infrastructure outside the blast radius | Add |
| 9 | CEO | E6 in-app switch back to the old UI: skip | Taste | P5/P3 | A forward rollback (0.39.x built from app/, same store) is lossless; two UIs in one APK doubles the test surface | Add |
| 10 | CEO | E7 automated emulator upgrade test: defer to TODOS.md | Taste | P3 | Needs emulator infrastructure the repo lacks; the manual real-TV smoke test is an obligation now | Add |
| 11 | CEO | Rollback redefined as forward (0.39.x from app/), because Android blocks a versionCode downgrade | Mechanical | P1 | Factual correction from the CEO spec review; keeps the user's no-data-loss intent | Downgrade to 0.38.8 |
| 13 | CEO | Keep web/'s 1920×1080 transform stage instead of a native 960×540 rewrite; limits in stage px | Taste | P5/P3 | The owner approved this stage as it is; a rewrite of every pixel value adds risk for no visible change. It differs from the design doc's "native 960×540" wording but keeps its intent (one scale model, no root zoom) | Native 960 CSS px rewrite |
| 14 | CEO | Flip gate stays "every row present or ported"; no accepted-gap exception | Mechanical | user direction | The user chose "all six first … loses nothing" | Gap with sign-off |
| 15 | CEO | Sideloaded test builds use 0.38.9x versionCodes | Mechanical | P1 | Keeps the release installable over the test TV | 0.39.x tests |
| 16 | CEO | Apply CEO spec-review round-3 fixes: trace-mode storage and a numbered test-build sequence, the explicit screen-model override with units, the 23 px floor defined, Live TV cap, theme, `streamUrl`, inventory breadth, rollback assets | Mechanical | P1/P5 | Final reviewer round; each fix is checked against the text | — |
| 12 | CEO | Apply all 5 blocking and 12 minor CEO spec-review round-1 findings | Mechanical | P1/P5 | Each is a verified code fact (app/index.html:215, renderer.js:1067, build.gradle:10) | Leave for Eng |
| 17 | CEO | Approve the CEO plan and scope summary after the spec-review cap, and continue to 0I | Mechanical | P6 | All blocking findings are applied and checked against the text; minor findings are recorded | Revise |
| 18 | CEO | Permanent app/↔web/ contract tests for the shared sync rows | Mechanical | P1 | Subagent CRITICAL: two implementations of one protocol drift | Share-core-now (deferred to the Mac plan) |
| 19 | CEO | Owner sign-off on the real TV in PR 1 | Mechanical | P1 | The approval was on the Mac only | Trust the Mac approval |
| 20 | CEO | Kill criterion for the stage override in PR 1 | Mechanical | P1 | A failed budget would otherwise surface after parity | None |
| 21 | CEO | Test applicationId fallback when the 3890–3899 codes run out | Mechanical | P1 | Never spend a release code on a test | Ask later |
| 22 | CEO | CSP on web/index.html, matching app/ | Mechanical | P1 | 39 innerHTML sites render provider strings | No CSP |
| 23 | CEO | boot.js resolves read-only after 5 s if auroraReady never arrives | Mechanical | P1 | Error map gap | Hang |
| 24 | CEO | One serialized write queue in platform.storage | Mechanical | P1 | Lost update across awaits | Unqueued writes |
| 25 | CEO | Audit the 39 innerHTML sites in web/js/app.js for esc() | Mechanical | P1 | Provider strings are untrusted | CSP alone |
| 26 | CEO | Throttle progress writes to one per 5 s; time the first library load in the trace | Mechanical | P1 | prefs is about 1 MB; the old app's 11 s read-back | Write every tick |
| 27 | CEO | Gate exception for Together not reopened | Mechanical | user direction | The user chose all six first; single-model concern | Let Together trail |
| 28 | CEO | Dual-UI APK (E6) stays skipped, surfaced at the gate | Taste | P5 | The subagent recommends it; it doubles the test surface vs instant switch-back | Adopt dual-UI |
| 29 | Design | Skip Step 0.5 mockups | Taste | P6/P4 | The approved web/ already sets the visual language; boards would stop the auto pipeline for picks; per-screen sign-off on real captures replaces them | Generate 15 paid variants |
| 30 | Design | Specify first launch, nav map, update banner, all states, keyboard rule, Back order, invite card | Mechanical | P5/P1 | Structural gaps (missing states, hierarchy); each ports the old app's behaviour where it exists | Leave to the implementer |
| 31 | Design | Per-parity-screen stage-px spec plus owner capture sign-off; existing tokens only | Mechanical | P1 | Six screens otherwise designed in code with no brief | PR 1 sign-off only |
| 32 | Design | Fix the 20/21 px badges; two type levels; focus room on 3 cards; ring contrast; position read-out | Mechanical | P5 | Verified violations (app.css:160, :174) | Leave as is |
| 33 | Design | DESIGN.md via /design-consultation deferred to TODOS.md | Mechanical | P3 | Outside this plan's blast radius | Write now |
| 34 | Design | No light theme in web/; old light users land on teal, and Settings says so | Taste | P5 | Adding a light theme would be a new feature | Build a light theme |
| 35 | DX | Persona: the owner plus the coding agent | Mechanical | P6 | README has no third-party audience | External developer |
| 36 | DX | TTHW target: Competitive for preview, documented under 10 min for a real-TV build | Mechanical | P5 | Gradle bounds the TV path | Champion everywhere |
| 37 | DX | Accept all DX findings: redaction (CAP4), coded errors, flag validation and banner, code ledger, bounded release, docs/tv-build.md, test subsets, limits.js | Mechanical | P1/P5 | Each is a verified gap in a surface this plan adds | Leave as is |
| 38 | Eng | Accept H1, H2 and M1–M8 and L1–L6 as obligations | Mechanical | P1/P5 | Each is verified in code (renderer.js:3461, platform-native.js:20, focus.js:26, renderer.js:320) | Leave as is |
| 39 | Eng | Extract the pure sync logic to a shared sync-core.js now (reopens the CEO #18 deferral) | Taste | P5/P4 | renderer.js side effects make a two-copy contract harness brittle; one owner per rule | Two copies plus contract tests |
| 40 | Eng | Parity iteration on the .test applicationId; spend 389x codes only on rehearsals | Mechanical | P1 | Ten codes cannot cover parity iteration | Spend codes freely |
| 41 | Eng | Structure: the original arrangement (no smaller arrangement keeps parity) | Mechanical | P5 | Each module replaces one renderer region | Merge modules |

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` (via /autoplan) | Scope & strategy | 1 | ISSUES OPEN | 7 proposals, 3 accepted, 2 deferred |
| Outside Review | codex (via /autoplan) | Independent 2nd opinion | 1 | unavailable | Codex not installed; no completed external review |
| Eng Review | `/plan-eng-review` (via /autoplan) | Architecture & tests (required) | 1 | ISSUES OPEN | 12 issues, 0 critical gaps |
| Design Review | `/plan-design-review` (via /autoplan) | UI/UX gaps | 1 | ISSUES OPEN | score: 2/10 → 7/10, 10 decisions |
| DX Review | `/plan-devex-review` (via /autoplan) | Developer experience gaps | 1 | ISSUES OPEN | score: 5/10 → 7/10, TTHW: ~8 min → <10 min (TV), ~1 min preview |

- **OUTSIDE COVERAGE:** Codex unavailable in every phase (not installed). The CEO, design, DX and eng phases each ran a native Claude subagent, which is not outside coverage. CEO spec review ran 3 rounds (scores 5, 5, 6).
- **VERDICT:** No review is CLEAR. Every phase found work that the plan now carries as accepted obligations. The status stays ISSUES OPEN until those are built, by the review-log rule; eng review required.

NO UNRESOLVED DECISIONS
