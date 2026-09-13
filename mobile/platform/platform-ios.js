/* The iPhone stand-in for preload.cjs. The Mac app gets window.aurora from
   Electron; here it is built on Capacitor before the renderer runs, because the
   renderer reads the prefs snapshot synchronously on its first line of work.
   Prefs and secrets live in iOS app storage (UserDefaults) rather than
   WKWebView localStorage, which the system is allowed to clear. */
(async () => {
  document.documentElement.classList.add("platform-ios");
  const store = window.Capacitor?.Plugins?.Preferences;

  async function read(key) {
    try {
      const { value } = await store.get({ key });
      return value ? JSON.parse(value) : null;
    } catch { return null }
  }

  async function write(key, value) {
    try { await store.set({ key, value: JSON.stringify(value ?? {}) }); return true }
    catch { return false }
  }

  let secrets = await read("secrets");
  const prefs = (await read("prefs")) || {};
  const unsupported = { state: "unsupported" };

  window.aurora = {
    platform: "ios",
    prefs,
    setPrefs: async (value) => ({ saved: await write("prefs", value) }),
    getSecrets: async () => secrets,
    setSecrets: async (value) => {
      secrets = value;
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
