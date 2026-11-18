/* The iPhone and Android stand-in for preload.cjs. The Mac app gets
   window.aurora from Electron; here it is built on Capacitor before either
   interface runs, because both read the prefs snapshot synchronously on their
   first line of work. Prefs and secrets live in the system's own app storage
   rather than in the web view's localStorage, which the OS may clear.

   This file is the half both interfaces share. The old interface's own start
   (the 1920-wide zoom, then renderer.js and tv-nav.js) is in
   platform-boot-app.js; the new one starts from web/js/boot.js. Neither starts
   before window.auroraReady has settled, so nothing reads storage early. */
window.auroraReady = (async () => {
  const platform = window.Capacitor?.getPlatform?.() || "ios";
  const root = document.documentElement;
  root.classList.add(`platform-${platform}`);
  const store = window.Capacitor?.Plugins?.Preferences;
  const config = window.AURORA_CONFIG || {};

  /* The new interface, until it owns the store (the plan's second PR), never
     writes the old app's keys: a build of it can go on the television and come
     off again without touching anyone's sources, list or sign-in. A trace build
     goes further and writes nothing outside its own key, not even the
     .locked copy below. */
  const WEB_UI = root.classList.contains("ui-web");
  const TRACE = !!config.trace;
  const LEGACY_KEYS = new Set(["prefs", "secrets"]);
  const writable = (key) => !(WEB_UI && LEGACY_KEYS.has(key)) && !(TRACE && key !== "web.trace");

  /* Every write goes through one queue, one at a time, so two writes that
     overlap across an await can never leave one of them half-applied. */
  let queue = Promise.resolve();
  const enqueue = (job) => {
    const run = queue.then(job, job);
    queue = run.catch(() => {});
    return run;
  };

  /* Same rule as the Mac keychain: a value that is there but cannot be read is
     not the same as nothing ever being saved, because the next write would
     replace the only copy of the sources and keys. Such a key is read-only for
     the rest of the session. */
  const unreadableKeys = new Set();
  async function read(key) {
    let value = null;
    try { ({ value } = await store.get({ key })) }
    catch (error) { unreadableKeys.add(key); return { unreadable: error.message || "could not be read", retryable: true } }
    if (!value) return null;
    try { return JSON.parse(value) }
    catch (error) {
      unreadableKeys.add(key);
      if (writable(`${key}.locked`)) {
        try { await store.set({ key: `${key}.locked`, value }) } catch { /* then the next write replaces it */ }
      }
      return { unreadable: error.message || "could not be read" };
    }
  }

  function write(key, value) {
    if (!writable(key)) return Promise.resolve(false);
    return enqueue(async () => {
      try { await store.set({ key, value: JSON.stringify(value ?? {}) }); unreadableKeys.delete(key); return true }
      catch { return false }
    });
  }

  /* A provider URL carries the account's username and password, in the path
     (/live/USER/PASS/123.ts) or the query (?username=&password=). Nothing that
     reaches a screen, a log or a trace file may carry them. */
  const sourceHosts = () => {
    const hosts = new Set();
    for (const s of (cache.secrets && Array.isArray(cache.secrets.sources) ? cache.secrets.sources : [])) {
      try { hosts.add(new URL(String(s.server).replace(/^(?!https?:\/\/)/, "http://")).host) } catch { /* not a URL */ }
    }
    return hosts;
  };
  function redact(text) {
    let out = String(text ?? "");
    out = out.replace(/\/(live|movie|series|timeshift)\/[^/\s?#]+\/[^/\s?#]+\//gi, "/$1/***/***/");
    out = out.replace(/([?&](?:username|password|token|key|api_key|apikey)=)[^&\s#"']*/gi, "$1***");
    for (const host of sourceHosts()) {
      const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out = out.replace(new RegExp(`(https?://${escaped})[^\\s"'<>]*`, "g"), "$1/…");
    }
    return out;
  }

  const cache = {};
  const storedSecrets = await read("secrets");
  cache.secrets = storedSecrets && !storedSecrets.unreadable ? storedSecrets : null;
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

    /* What the new interface uses. `read` answers from what was loaded at
       start, so a screen can ask synchronously; `write` goes through the queue
       and resolves false when the key is not this build's to write, or when
       the system refused it. A key that could not be read stays read-only. */
    store: {
      async load(key) { if (!(key in cache)) cache[key] = await read(key); return cache[key] },
      read: (key) => (key === "prefs" ? prefs : key === "secrets" ? secretsLock || secrets : cache[key] ?? null),
      async write(key, value) {
        if (unreadableKeys.has(key)) return false;
        cache[key] = value;
        return write(key, value);
      },
      writable: (key) => writable(key) && !unreadableKeys.has(key),
      unreadable: (key) => unreadableKeys.has(key),
    },
    redact,
    trace: TRACE,

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

  return window.aurora;
})();
