/* The iPhone stand-in for preload.cjs. The Mac app gets window.aurora from
   Electron; here it is built on Capacitor before the renderer runs, because the
   renderer reads the prefs snapshot synchronously on its first line of work.
   Prefs and secrets live in iOS app storage (UserDefaults) rather than
   WKWebView localStorage, which the system is allowed to clear. */
(async () => {
  document.documentElement.classList.add("platform-ios");
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

  window.aurora = {
    platform: "ios",
    prefs,
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

  const renderer = document.createElement("script");
  renderer.src = "renderer.js";
  document.body.appendChild(renderer);
})();
