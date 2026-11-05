/* What Capacitor provides on the television, for the preview window only.
   Loaded before anything else in the page, so platform-native.js finds the
   same three things it finds on the device and takes the same paths:

   - getPlatform() answers "android", as the television does.
   - Preferences is backed by localStorage, which lives in the preview's own
     profile folder and survives restarts. Without it the app reads its stored
     sources as unreadable and refuses to save anything over them.
   - App.addListener("backButton") is wired to Backspace and Escape, because a
     Mac keyboard has no Back key. On the device Back runs handleBack(true),
     which walks the whole history; the renderer's own Escape runs
     handleBack(false), which only leaves a detail page — so Escape on its own
     would test the wrong behaviour. Inside a text field that is actually
     taking text, both keys keep their ordinary meaning. */
(() => {
  const backListeners = [];
  const prefix = "capacitor-preferences:";

  window.Capacitor = {
    getPlatform: () => "android",
    isNativePlatform: () => true,
    Plugins: {
      Preferences: {
        async get({ key }) { return { value: localStorage.getItem(prefix + key) } },
        async set({ key, value }) { localStorage.setItem(prefix + key, value) },
        async remove({ key }) { localStorage.removeItem(prefix + key) },
        async keys() {
          return { keys: Object.keys(localStorage).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)) };
        },
      },
      App: {
        addListener(name, fn) {
          if (name === "backButton") backListeners.push(fn);
          return { remove() { const i = backListeners.indexOf(fn); if (i !== -1) backListeners.splice(i, 1) } };
        },
        exitApp() { console.log("[remote] Back with nothing left to shut: the television leaves the app here") },
      },
    },
  };

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Backspace" && event.key !== "Escape") return;
    const target = event.target;
    if (target instanceof Element && target.matches("input:not([readonly]), textarea, select")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    for (const fn of backListeners.slice()) fn({ canGoBack: true });
  }, true);
})();
