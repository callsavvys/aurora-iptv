/* The old interface's own start, after platform-core.js.

   The 1920-wide zoom is set before anything is painted; renderer.js and, on a
   television, the D-pad layer load once window.auroraReady has settled, because
   the renderer reads the prefs snapshot synchronously on its first line of
   work. The new interface (web/) never loads this file: it draws its own
   1920x1080 stage and scales it itself. */
(() => {
  const TV_BUILD = document.documentElement.classList.contains("platform-tv");

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

  const start = () => {
    const renderer = document.createElement("script");
    renderer.src = "renderer.js";
    // the D-pad layer reads the DOM the renderer builds, so it follows it in
    if (TV_BUILD) {
      renderer.addEventListener("load", () => {
        const nav = document.createElement("script");
        nav.src = "tv-nav.js";
        document.body.appendChild(nav);
      });
    }
    document.body.appendChild(renderer);
  };
  Promise.resolve(window.auroraReady).then(start, start);
})();
