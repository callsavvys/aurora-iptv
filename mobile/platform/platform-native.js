/* The iPhone and Android stand-in for preload.cjs. The Mac app gets
   window.aurora from Electron; here it is built on Capacitor before the
   renderer runs, because the renderer reads the prefs snapshot synchronously on
   its first line of work. Prefs and secrets live in the system's own app
   storage rather than in the web view's localStorage, which the OS may clear. */
(async () => {
  const platform = window.Capacitor?.getPlatform?.() || "ios";
  document.documentElement.classList.add(`platform-${platform}`);
  const store = window.Capacitor?.Plugins?.Preferences;

  /* Same rule as the Mac keychain: a value that is there but cannot be read is
     not the same as nothing ever being saved, because the next write would
     replace the only copy of the sources and keys. */
  async function read(key) {
    let value = null;
    try { ({ value } = await store.get({ key })) }
    catch (error) { return { unreadable: error.message || "could not be read", retryable: true } }
    if (!value) return null;
    try { return JSON.parse(value) }
    catch (error) {
      try { await store.set({ key: `${key}.locked`, value }) } catch { /* then the next write replaces it */ }
      return { unreadable: error.message || "could not be read" };
    }
  }

  async function write(key, value) {
    try { await store.set({ key, value: JSON.stringify(value ?? {}) }); return true }
    catch { return false }
  }

  const storedSecrets = await read("secrets");
  let secretsLock = storedSecrets?.unreadable ? storedSecrets : null;
  let secrets = secretsLock ? null : storedSecrets;
  const storedPrefs = await read("prefs");
  const prefs = !storedPrefs || storedPrefs.unreadable ? {} : storedPrefs;
  const unsupported = { state: "unsupported" };

  let onBack = null;
  let updateHandler = null;
  let updatePending = null;   // an answer that arrived before anyone was listening
  // the TV build is the one that carries a Downloader code to quote
  const TV_BUILD = document.documentElement.classList.contains("platform-tv");

  window.aurora = {
    platform,
    prefs,
    // the renderer owns what Back means; the shell only needs to know whether
    // it was wanted, so it can leave the app when it was not
    onBack: (handler) => { onBack = handler },
    setPrefs: async (value) => ({ saved: await write("prefs", value) }),
    getSecrets: async () => secretsLock || secrets,
    setSecrets: async (value) => {
      secrets = value; secretsLock = null;
      const saved = await write("secrets", value);
      return { saved, encrypted: false };
    },
    version: async () => "__AURORA_VERSION__",

    /* A sideloaded build has no update channel: Android will not update an APK
       that did not come from a store, and an IPA is the same. It can still find
       out that a new one exists and say where, which is the whole gap — without
       this, the only way anyone learns there is an update is being told.

       Nothing is downloaded or installed here. It reads the release list and
       compares version numbers. */
    updateStatus: async () => latestRelease(),
    checkForUpdates: async () => latestRelease(),
    installUpdate: async () => unsupported,
    onUpdateStatus: (handler) => {
      updateHandler = handler;
      // the check can finish before the renderer has got this far, and dropping
      // the answer there loses the notice for the whole run
      if (updatePending) { handler(updatePending); updatePending = null }
    },
    // the way out of a television app, which has no window to close
    exit: () => { window.Capacitor?.Plugins?.App?.exitApp?.(); return true },
    setTheme: () => {},
    onMenu: () => {},
  };

  /* ---- is there a newer Aurora than this one? ---- */

  const RELEASES = "https://api.github.com/repos/callsavvys/aurora-iptv/releases/latest";
  const DOWNLOADER_CODE = "8502133";

  // "0.31.0" vs "0.9.0": compared as numbers, part by part, never as text
  const newer = (candidate, current) => {
    const parts = (value) => String(value || "").replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
    const [a, b] = [parts(candidate), parts(current)];
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
    }
    return false;
  };

  async function latestRelease() {
    const current = "__AURORA_VERSION__";
    try {
      /* CapacitorHttp is enabled, so this goes out through native HTTP rather
         than the WebView, and a native client sends no browser User-Agent.
         GitHub refuses requests without one. */
      const response = await fetch(RELEASES, { headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Aurora-IPTV",
      } });
      if (!response.ok) return { state: "error", message: `The release list answered ${response.status}` };
      const version = String((await response.json()).tag_name || "").replace(/^v/, "");
      if (!version) return { state: "error", message: "The release list named no version" };
      if (!newer(version, current)) return { state: "none", message: "up to date" };
      return {
        state: "manual",
        version,
        how: TV_BUILD
          ? `Open Downloader and enter ${DOWNLOADER_CODE}`
          : "Reinstall Aurora from the latest release to update",
      };
    } catch (error) {
      return { state: "error", message: error?.message || "Could not reach the release list" };
    }
  }

  /* On a TV this is the only way out of anything, so a back press that the app
     does not want must reach the system rather than trap the person inside. */
  window.Capacitor?.Plugins?.App?.addListener?.("backButton", () => {
    if (!onBack?.()) window.Capacitor?.Plugins?.App?.exitApp?.();
  });

  /* Asked once a little after launch: the answer is a banner, not a blocker,
     and the library matters more than the release list in the first seconds. */
  setTimeout(() => {
    latestRelease().then((status) => {
      if (status.state !== "manual") return;
      if (updateHandler) updateHandler(status); else updatePending = status;
    }).catch(() => {});
  }, 4000);

  /* ---- one television pixel is not another television pixel ----
     tv.css is written against a 1920-wide screen, but an Android TV WebView
     reports whatever it likes: 960 CSS pixels at double density is common, and
     there every fixed size in the stylesheet comes out twice as large as it was
     drawn. That is not a stylesheet bug to be chased rule by rule, it is one
     scale factor: lay the page out as if it were 1920 wide and let the screen
     put it back. Set before the renderer loads, so nothing is painted at the
     wrong size first. */
  const TV_WIDTH = 1920;
  const fitToScreen = () => {
    if (!TV_BUILD) return;
    const width = window.innerWidth || TV_WIDTH;
    const height = window.innerHeight || 1080;
    const scale = width / TV_WIDTH;
    const root = document.documentElement;
    root.style.zoom = String(scale);
    /* vh does not compensate for the scale: on a 540-tall screen scaled by a
       half, 100vh still measures 540 and the page ends up covering a quarter
       of the television. The real height has to be handed to the stylesheet.

       And not only the height. Every vh and vw in the stylesheets is half what
       it should be for the same reason, which is how the programme guide ended
       up three rows tall on a screen with room for eight. One percent of the
       real screen, in each direction, so the stylesheet can do the arithmetic
       itself. */
    root.style.setProperty("--tv-height", `${Math.round(height / scale)}px`);
    root.style.setProperty("--tv-vh", `${(height / scale / 100).toFixed(2)}px`);
    root.style.setProperty("--tv-vw", `${(width / scale / 100).toFixed(2)}px`);
  };
  fitToScreen();
  window.addEventListener("resize", fitToScreen);

  const renderer = document.createElement("script");
  renderer.src = "renderer.js";
  // the D-pad layer reads the DOM the renderer builds, so it follows it in
  if (document.documentElement.classList.contains("platform-tv")) {
    renderer.addEventListener("load", () => {
      const nav = document.createElement("script");
      nav.src = "tv-nav.js";
      document.body.appendChild(nav);
    });
  }
  document.body.appendChild(renderer);
})();
