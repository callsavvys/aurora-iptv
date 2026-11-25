/* Page memory: Back takes you to the same place on the page you left.
   Each visit in the history (react-router's location.key) keeps its scroll
   position and whatever a page asks to keep with useRemembered (a grid's
   loaded titles, the genre you picked), for as long as the app is open. */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

const visits = new Map();   // location.key -> { scroll, ...values }
const entry = (key) => {
  if (!visits.has(key)) {
    visits.set(key, {});
    if (visits.size > 60) visits.delete(visits.keys().next().value);   // the oldest visit
  }
  return visits.get(key);
};

/* useState that is kept for this visit: going Back to it gives the value it had */
export function useRemembered(name, initial) {
  const { key } = useLocation();
  const [value, setValue] = useState(() => (name in entry(key) ? entry(key)[name] : typeof initial === "function" ? initial() : initial));
  useEffect(() => { entry(key)[name] = value; }, [key, name, value]);
  return [value, setValue];
}
/* whether this visit already had `name` kept, read once when a page mounts */
export function useWasRemembered(name) {
  const { key } = useLocation();
  return useRef(name in entry(key)).current;
}

/* in the Shell: a new page starts at the top; Back and Forward return to where you were */
export function useScrollMemory() {
  const loc = useLocation();
  const how = useNavigationType();
  const current = useRef(loc.key);
  const lastPath = useRef(loc.pathname);
  useEffect(() => {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    const save = () => { entry(current.current).scroll = window.scrollY; };
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
  }, []);
  useLayoutEffect(() => {
    current.current = loc.key;
    const samePage = lastPath.current === loc.pathname;
    lastPath.current = loc.pathname;
    const y = visits.get(loc.key)?.scroll;
    if (how !== "POP" || y == null) {
      // a new address on the same page (a title's ?play=1) keeps the page where it is
      if (!samePage) window.scrollTo(0, 0);
      return undefined;
    }
    // the page may still be filling in (posters, a grid's pages): keep trying for a moment,
    // and stop as soon as you touch or scroll yourself
    let stop = false, tries = 0;
    const quit = () => { stop = true; };
    const opts = { passive: true, once: true };
    window.addEventListener("touchstart", quit, opts); window.addEventListener("wheel", quit, opts); window.addEventListener("keydown", quit, opts);
    const go = () => {
      if (stop || current.current !== loc.key) return;
      window.scrollTo(0, y);
      if (Math.abs(window.scrollY - y) > 2 && ++tries < 40) setTimeout(go, 75);
      else entry(loc.key).scroll = y;
    };
    go();
    return () => { quit(); window.removeEventListener("touchstart", quit); window.removeEventListener("wheel", quit); window.removeEventListener("keydown", quit); };
  }, [loc.key]); // eslint-disable-line react-hooks/exhaustive-deps
}
