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
    // updates on iPhone come from reinstalling the IPA, not from the app
    updateStatus: async () => unsupported,
    checkForUpdates: async () => unsupported,
    installUpdate: async () => unsupported,
    onUpdateStatus: () => {},
    setTheme: () => {},
    onMenu: () => {},
  };

  /* On a TV this is the only way out of anything, so a back press that the app
     does not want must reach the system rather than trap the person inside. */
  window.Capacitor?.Plugins?.App?.addListener?.("backButton", () => {
    if (!onBack?.()) window.Capacitor?.Plugins?.App?.exitApp?.();
  });

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
