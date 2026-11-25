import { useEffect, useRef, useSyncExternalStore } from "react";
import { start as startParticles } from "./particles.js";
import THEMES from "./themes.json";
import "./themes.css";

/* atlantic.bz's ambient themes (Settings → Appearance), captured from the site:
   each sets the accent scale (--atlantic-50…950) and the page colour on the
   page root, and lays its background behind everything. The stylesheet reads
   those variables, so a theme recolours the whole site. Kept in this browser. */

export { THEMES };
const KEY = "aurora-site-theme";
const listeners = new Set();
let current = null;
const read = () => { if (current) return current; try { current = localStorage.getItem(KEY) || "atlantic"; } catch { current = "atlantic"; } return current; };
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const useTheme = () => useSyncExternalStore(subscribe, read);
/* "Always Show Titles": each card's title and rating without hovering (a class on the page) */
const TKEY = "aurora-site-titles";
let titles = null;
const readTitles = () => { if (titles !== null) return titles; try { titles = localStorage.getItem(TKEY) === "1"; } catch { titles = false; } return titles; };
export const useAlwaysTitles = () => useSyncExternalStore(subscribe, readTitles);
export function setAlwaysTitles(on) { titles = on; try { localStorage.setItem(TKEY, on ? "1" : "0"); } catch { /* private mode */ } listeners.forEach((fn) => fn()); }

/* "Continue Watching Rows": how many rows Continue Watching splits into on Home */
const RKEY = "aurora-site-cw-rows";
let cwRows = null;
const readRows = () => { if (cwRows !== null) return cwRows; try { cwRows = Number(localStorage.getItem(RKEY)) || 2; } catch { cwRows = 2; } return cwRows; };
export const useContinueRows = () => useSyncExternalStore(subscribe, readRows);
export function setContinueRows(n) { cwRows = n; try { localStorage.setItem(RKEY, String(n)); } catch { /* private mode */ } listeners.forEach((fn) => fn()); }

/* "Background Particles": the drifting stars, petals, embers and leaves (on by default) */
const PKEY = "aurora-site-particles";
let particles = null;
const readParticles = () => { if (particles !== null) return particles; try { particles = localStorage.getItem(PKEY) !== "0"; } catch { particles = true; } return particles; };
export const useParticles = () => useSyncExternalStore(subscribe, readParticles);
export function setParticles(on) { particles = on; try { localStorage.setItem(PKEY, on ? "1" : "0"); } catch { /* private mode */ } listeners.forEach((fn) => fn()); }

export function setTheme(id) { current = id; try { localStorage.setItem(KEY, id); } catch { /* private mode */ } listeners.forEach((fn) => fn()); }

/* applies the chosen theme to the page and draws its background */
export function ThemeLayer() {
  const id = useTheme();
  const always = useAlwaysTitles();
  useEffect(() => { document.documentElement.classList.toggle("always-titles", always); }, [always]);
  const theme = THEMES.find((t) => t.id === id) || THEMES[0];
  useEffect(() => {
    const root = document.documentElement;
    root.removeAttribute("style");   // (the always-titles class is a class, not a style, so it stays)
    if (theme.root) root.setAttribute("style", theme.root);
    document.body.style.backgroundColor = /background-color:\s*([^;]+)/.exec(theme.body)?.[1] || "";
  }, [theme]);
  // the particles, in the theme's own accent colours (Autumn adds its reds and golds)
  const box = useRef(null);
  const moving = useParticles();
  useEffect(() => {
    const canvas = box.current?.querySelector("canvas");
    if (!canvas || !theme.particles || !moving) return undefined;
    const tone = (n) => new RegExp(`--atlantic-${n}:\\s*([^;]+)`).exec(theme.root)?.[1]?.trim();
    // petals in the soft tone, as the site draws them; the rest in both accents
    const colors = theme.particles === "petals" ? [tone(300)] : [tone(300), tone(400)];
    if (theme.particles === "maple") colors.push("#c0392b", "#e2b13c", tone(500));
    return startParticles(canvas, theme.particles, colors.filter(Boolean));
  }, [theme, moving]);
  // the background is the site's own markup, saved with the theme
  return theme.ambient ? <div ref={box} dangerouslySetInnerHTML={{ __html: theme.ambient }} /> : null;
}
