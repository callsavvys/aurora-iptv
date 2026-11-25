/* Touch gestures for the phone (the app and the website on a phone):
   - a swipe in from the left edge goes Back, with an arrow that follows the finger
   - useSwipe: a left or right swipe on a carousel moves it
   - the page never zooms: no pinch, no double-tap zoom, no zoom on a text box */
import { useRef } from "react";

const touch = () => typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0);

/* left/right: called on a swipe that way (a mostly sideways move of 50px or more) */
export function useSwipe({ left, right }) {
  const start = useRef(null);
  return {
    onTouchStart: (e) => { const p = e.touches[0]; start.current = e.touches.length === 1 && p.clientX > 30 ? { x: p.clientX, y: p.clientY } : null; },
    onTouchEnd: (e) => {
      const s = start.current; start.current = null; if (!s) return;
      const p = e.changedTouches[0], dx = p.clientX - s.x, dy = p.clientY - s.y;
      if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx) * 0.7) return;
      if (dx < 0) left?.(); else right?.();
    },
  };
}

/* Back from the left edge, like an iPhone app */
function edgeBack() {
  const EDGE = 28, GO = 80;
  let s = null, arrow = null;
  const show = (dx) => {
    if (!arrow) {
      arrow = document.createElement("div");
      arrow.setAttribute("aria-hidden", "true");
      arrow.style.cssText = "position:fixed;left:0;top:50%;z-index:200;width:44px;height:44px;margin-top:-22px;border-radius:9999px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.14);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);color:#fff;pointer-events:none;transition:background-color .15s";
      arrow.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';
      document.body.appendChild(arrow);
    }
    const x = Math.min(dx, GO * 1.4);
    arrow.style.transform = `translateX(${x * 0.6 - 30}px)`;
    arrow.style.opacity = String(Math.min(1, x / GO));
    arrow.style.backgroundColor = dx >= GO ? "rgba(30,203,236,.55)" : "rgba(255,255,255,.14)";
  };
  const hide = () => { arrow?.remove(); arrow = null; };
  // the first page of the app has nowhere to go back to
  const canGoBack = () => (window.history.state?.idx ?? 1) > 0 || !!window.history.state?.auroraPlayer;
  window.addEventListener("touchstart", (e) => {
    const p = e.touches[0];
    s = e.touches.length === 1 && p.clientX <= EDGE && canGoBack() ? { x: p.clientX, y: p.clientY, on: false } : null;
  }, { passive: true });
  window.addEventListener("touchmove", (e) => {
    if (!s) return;
    const p = e.touches[0], dx = p.clientX - s.x, dy = p.clientY - s.y;
    if (!s.on) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > dx) { s = null; return; }   // scrolling up or down
      if (dx < 10) return;
      s.on = true;
    }
    if (e.cancelable) e.preventDefault();   // the swipe is ours: the row under the finger does not scroll too
    show(dx);
  }, { passive: false });
  const end = (e) => {
    if (!s) return;
    const dx = (e.changedTouches?.[0]?.clientX ?? s.x) - s.x, was = s.on;
    s = null; hide();
    if (was && dx >= GO && e.type === "touchend") window.history.back();
  };
  window.addEventListener("touchend", end, { passive: true });
  window.addEventListener("touchcancel", end, { passive: true });
}

/* the app is laid out for the screen: pinching or double tapping should not zoom it */
function noZoom() {
  let m = document.querySelector('meta[name="viewport"]');
  if (!m) { m = document.createElement("meta"); m.name = "viewport"; document.head.appendChild(m); }
  // the iPhone app's page already reaches under the notch (viewport-fit=cover); keep that as it is
  const cover = /viewport-fit=cover/.test(m.content || "");
  m.content = `width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no${cover ? ", viewport-fit=cover" : ""}`;
  const stop = (e) => e.preventDefault();
  document.addEventListener("gesturestart", stop, { passive: false });
  document.addEventListener("gesturechange", stop, { passive: false });
  document.addEventListener("touchmove", (e) => { if (e.scale !== undefined && e.scale !== 1 && e.cancelable) e.preventDefault(); }, { passive: false });
}

export function startGestures() {
  if (!touch()) return;
  noZoom();
  edgeBack();
}
