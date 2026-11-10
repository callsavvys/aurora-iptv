# TODOS

## Re-trace Live TV on the TV with the faster arrow keys (0.38.94)
- **What:** Install `mobile/dist/Aurora-TV-0.38.94.apk` on the Google TV and record the held-arrow Live TV trace (docs/tv-build.md, Trace it). Record press-to-frame p50/p95 and whether a held arrow keeps 60 fps.
- **Why:** PR 1's kill rule (plan decision #20) needs the numbers. 0.38.91 measured 61 ms of script per press; the focus.js change cut a press from roughly 3x908 box measurements and thousands of ancestor checks to 910 and about 40 (identical focus walks), but it has not been measured on the TV.
- **Context:** The Mac was off the home Wi-Fi when 0.38.94 was built, so it was never installed.
- **Effort:** human S / CC+gstack S
- **Priority:** P1
- **Depends on:** the Mac and the TV on the same network.

## Old-interface (main) vs web/ Live TV trace
- **What:** Install an app/ trace build (next free test code), record the same held-arrow Live TV trace, then reinstall the web/ build.
- **Why:** The plan's PR 1 trace compares old and new interleaved, so PR 2 starts with a baseline. Deferred by the owner at ship time (2026-11-06).
- **Context:** Deferred from plan: docs/plans/web-ui-to-tv.md (Eng review, perf REALITY item). Peak memory, the other deferred item, was measured on 0.38.93: 223 MB at the first library load, settling at 110 MB.
- **Effort:** human S / CC+gstack S
- **Priority:** P1
- **Depends on:** the Mac and the TV on the same network.

## TV crash and error reporter
- **What:** Record uncaught errors and stream failures on the TV build somewhere the owner can read them.
- **Why:** On the TV, a broken screen today is only known if someone reports it. There are no logs to reconstruct what happened.
- **Pros:** Problems after 0.39.0 show up without waiting for a report, and the next release can be measured against them.
- **Cons:** It needs a destination (Supabase table or similar), a privacy rule (provider URLs carry logins, so URLs must never be logged), and a size cap.
- **Context:** Deferred from the CEO review of `docs/plans/web-ui-to-tv.md` (decision #8) as new infrastructure outside that plan's blast radius. Start from `window.onerror` and hls.js `Hls.Events.ERROR` in `web/js/app.js`.
- **Effort:** human M / CC+gstack S
- **Priority:** P2
- **Depends on:** the web/ TV build shipping (0.39.0).

## Automated emulator upgrade test (0.38.8 → 0.39.0)
- **What:** A script that installs the 0.38.8 APK on an Android TV emulator, seeds a line, My List and progress, installs 0.39.0 over it, and checks that everything survived. It then installs a higher-versionCode app/ build over that and checks again. Android refuses a downgrade to 0.38.8.
- **Why:** The shared-store promise ("no data loss either way") is checked only by a manual real-TV smoke test today.
- **Pros:** It catches a store-shape regression in every future release, not only this one.
- **Cons:** It needs an emulator system image and adb in the toolchain, and runs slowly (minutes).
- **Context:** Deferred from the CEO review of `docs/plans/web-ui-to-tv.md` (decision #10). The fixture test in that plan covers the record shapes; this covers the real install path.
- **Effort:** human L / CC+gstack M
- **Priority:** P2
- **Depends on:** the platform split and shared store landing.

## DESIGN.md for web/
- **What:** Write a DESIGN.md from the tokens in `web/css/app.css` (themes, the tvOS type scale, spacing, radii, motion, focus ring) with /design-consultation.
- **Why:** The new TV screens are held to "existing tokens only", but nothing documents those tokens outside the CSS.
- **Pros:** Future design reviews calibrate against a stated system; the Mac and iPhone moves inherit it.
- **Cons:** Half a day of consultation; it must be kept in step with app.css.
- **Context:** Deferred from the design review of `docs/plans/web-ui-to-tv.md` (decision #33). Pass 5 scored 7/10 for this reason.
- **Effort:** human S / CC+gstack S
- **Priority:** P3
- **Depends on:** nothing.
