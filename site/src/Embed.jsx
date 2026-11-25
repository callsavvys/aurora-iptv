import { useEffect, useRef } from "react";
import { isTV } from "./platform.js";

/* Vidora's own player, full screen over the page (the source Vidora, line.js).
   It plays inside a frame, so Aurora's player controls, subtitles and watch
   party are not there; Vidora tells us where it got to, which keeps your
   progress and Continue Watching, and Back closes it like the Player does. */
export default function Embed({ src, title, subtitle, onClose, onProgress }) {
  const closer = useRef(onClose); closer.current = onClose;
  const saver = useRef(onProgress); saver.current = onProgress;
  const step = useRef(null), closed = useRef(false), leaving = useRef(false);
  useEffect(() => {
    // an open player is its own step in the history: Back (phone, browser, remote) closes it
    const id = Math.random().toString(36).slice(2);
    window.history.pushState({ ...window.history.state, auroraPlayer: id }, "");
    step.current = id;
    const pop = () => { if (window.history.state?.auroraPlayer !== id && !closed.current) { closed.current = true; closer.current?.(); } };
    let last = 0;
    const message = (e) => {
      if (e.origin !== "https://vidora.ac" || e.data?.type !== "PLAYER_EVENT") return;
      const { event, currentTime, duration } = e.data.data || {};
      if (!duration) return;
      if (event === "ended") saver.current?.(duration, duration);
      else if (event === "pause" || Date.now() - last > 5000) { last = Date.now(); saver.current?.(currentTime, duration); }
    };
    // the remote's Back (tvnav.js sends Escape) and a keyboard's Escape close it
    const key = (e) => { if (e.key === "Escape") closeRef.current(); };
    window.addEventListener("popstate", pop);
    window.addEventListener("message", message);
    document.addEventListener("keydown", key);
    return () => { window.removeEventListener("popstate", pop); window.removeEventListener("message", message); document.removeEventListener("keydown", key); };
  }, []);
  const close = () => {
    if (closed.current || leaving.current) return;
    // once only: Back can arrive twice (the remote's key and its Escape), and two steps back would leave the page too
    if (window.history.state?.auroraPlayer === step.current) { leaving.current = true; window.history.back(); }
    else { closed.current = true; onClose?.(); }
  };
  const closeRef = useRef(close); closeRef.current = close;
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="flex items-center gap-3 px-4 py-2 text-white sm:px-6">
        <button type="button" onClick={close} className="flex shrink-0 items-center gap-2 text-white/80 hover:text-white">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>Back
        </button>
        <p className="min-w-0 truncate text-sm font-semibold">{title}{subtitle ? <span className="font-normal text-white/60"> · {subtitle}</span> : null}</p>
        <span className="ml-auto shrink-0 text-xs text-white/40">Vidora</span>
      </div>
      <div className="relative w-full flex-1">
        <iframe title={title || "Vidora"} src={src} className="absolute inset-0 h-full w-full border-0 outline-none"
          // on a TV the remote's keys go to whatever has focus: give it to Vidora's player, so OK and the arrows work its controls
          onLoad={(e) => { if (isTV()) e.currentTarget.focus(); }} allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="origin" />
        {/* the frame keeps its touches to itself: a thin strip on the left edge lets the swipe back (gestures.js) through */}
        <div aria-hidden="true" className="absolute inset-y-0 left-0 w-4" />
      </div>
    </div>
  );
}
