import { useEffect, useRef, useState } from "react";
import "./player.css";
import { useAccount, signedIn, startParty, attachPlayer, leaveParty, partyLine, party } from "./account.js";

/* The player, in Atlantic's look (its TV app's player, measured on the TV):
   a back arrow and the title at the top, one big play button in the middle,
   a hairline cyan timeline, and the time and controls along the bottom.
   Space plays or pauses, ←/→ skip 10 s, F is full screen, Esc goes back. */

const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };
const Icon = {
  back: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20z" /></svg>,
  play: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>,
  pause: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>,
  vol: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z" /></svg>,
  muted: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12A4.5 4.5 0 0 0 14 8v2.18l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12a9 9 0 0 0-7-8.77v2.06A7 7 0 0 1 19 12zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a9 9 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z" /></svg>,
  next: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>,
  full: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" /></svg>,
  back10: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12a8 8 0 1 0 2.6-5.9" /><path d="M4 4v4.5h4.5" /></svg>,
  people: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>,
  fwd10: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 4v4.5h-4.5" /></svg>,
};

/* partyItem: the title on your line, so Watch Party can start a party for it;
   a party already open (joined by code) follows its host from the start. */
/* live: a channel — no timeline or skips, LIVE in place of the time, and
   onPrev/onNext change channel (also ↑/↓ on the keyboard) */
export default function Player({ src, title, subtitle, startAt = 0, onClose, onProgress, onEnded, onNext, onPrev, partyItem, live = false }) {
  const video = useRef(null), wrap = useRef(null), hideTimer = useRef(null);
  const [t, setT] = useState({ cur: 0, dur: 0, buf: 0, paused: false, muted: false, waiting: true });
  const [shown, setShown] = useState(true);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  useAccount();
  const unparty = useRef(() => {});
  useEffect(() => { unparty.current = attachPlayer(video.current); return () => unparty.current(); }, []);
  // closing the player leaves the party; Next episode remounts it and keeps the party
  const close = () => { leaveParty(); onClose?.(); };
  const watchParty = async () => {
    if (!signedIn()) { setNote("Sign in first, in Settings → Account, to start a watch party."); return; }
    setNote("Starting the party…");
    const r = await startParty(partyItem);
    if (r.error) { setNote(r.error); return; }
    unparty.current(); unparty.current = attachPlayer(video.current);
    setNote("");
  };
  const line = partyLine() || note;

  const poke = () => { setShown(true); clearTimeout(hideTimer.current); hideTimer.current = setTimeout(() => { if (!video.current?.paused) setShown(false); }, 3000); };
  const toggle = () => { const v = video.current; if (!v) return; if (v.paused) v.play().catch(() => {}); else v.pause(); poke(); };
  const seek = (d) => { const v = video.current; if (!v || !v.duration) return; v.currentTime = Math.max(0, Math.min(v.duration - 1, v.currentTime + d)); poke(); };
  const full = () => { const el = wrap.current; if (!document.fullscreenElement) el?.requestFullscreen?.().catch(() => {}); else document.exitFullscreen?.(); };

  useEffect(() => {
    const v = video.current; if (!v || !src) return;
    let hls = null;
    setError("");
    (async () => {
      if (/\.m3u8(\?|$)/i.test(decodeURIComponent(src))) {
        const { default: Hls } = await import("hls.js");
        if (Hls.isSupported()) { hls = new Hls({ startPosition: startAt || -1 }); hls.loadSource(src); hls.attachMedia(v); hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) setError(`This stream could not be played (${d.details}).`); }); }
        else v.src = src;
      } else {
        v.src = src;
        if (startAt) v.addEventListener("loadedmetadata", () => { v.currentTime = startAt; }, { once: true });
      }
      v.play().catch(() => {});
    })();
    return () => { hls?.destroy(); v.removeAttribute("src"); v.load(); };
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const v = video.current; if (!v) return;
    let last = 0;
    const paint = () => {
      let buf = 0; try { if (v.buffered.length) buf = v.buffered.end(v.buffered.length - 1); } catch { /* nothing yet */ }
      setT({ cur: v.currentTime, dur: v.duration || 0, buf, paused: v.paused, muted: v.muted, waiting: v.readyState < 3 && !v.paused });
      if (Date.now() - last > 5000 && v.duration) { last = Date.now(); onProgress?.(v.currentTime, v.duration); }
    };
    const events = ["timeupdate", "play", "pause", "progress", "waiting", "playing", "volumechange", "loadedmetadata"];
    events.forEach((e) => v.addEventListener(e, paint));
    const ended = () => { onProgress?.(v.duration, v.duration); onEnded?.(); };
    const failed = () => setError("This stream could not be played. Your line may not carry this format, or another device is using your connection.");
    v.addEventListener("ended", ended); v.addEventListener("error", failed);
    const pause = () => { if (v.duration) onProgress?.(v.currentTime, v.duration); };
    v.addEventListener("pause", pause);
    return () => { events.forEach((e) => v.removeEventListener(e, paint)); v.removeEventListener("ended", ended); v.removeEventListener("error", failed); v.removeEventListener("pause", pause); };
  }, [onProgress, onEnded]);

  useEffect(() => {
    const key = (e) => {
      if (e.key === " " || e.key === "k") { e.preventDefault(); toggle(); }
      else if (e.key === "ArrowLeft" && !live) { e.preventDefault(); seek(-10); }
      else if (e.key === "ArrowRight" && !live) { e.preventDefault(); seek(10); }
      else if (e.key === "ArrowUp" && live && onPrev) { e.preventDefault(); onPrev(); }
      else if (e.key === "ArrowDown" && live && onNext) { e.preventDefault(); onNext(); }
      else if (e.key === "f") full();
      else if (e.key === "m") { video.current.muted = !video.current.muted; poke(); }
      else if (e.key === "Escape" && !document.fullscreenElement) close();
      else poke();
    };
    document.addEventListener("keydown", key);
    document.body.style.overflow = "hidden";
    poke();
    return () => { document.removeEventListener("keydown", key); document.body.style.overflow = ""; clearTimeout(hideTimer.current); const v = video.current; if (v?.duration) onProgress?.(v.currentTime, v.duration); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pct = t.dur ? (t.cur / t.dur) * 100 : 0, bpct = t.dur ? (t.buf / t.dur) * 100 : 0;
  const scrub = (e) => { const r = e.currentTarget.getBoundingClientRect(); const v = video.current; if (v?.duration) v.currentTime = ((e.clientX - r.left) / r.width) * v.duration; poke(); };
  return (
    <div ref={wrap} className={`apl${shown || t.paused ? " apl-shown" : ""}`} onMouseMove={poke} onClick={(e) => { if (e.target === e.currentTarget || e.target.tagName === "VIDEO") toggle(); }}>
      <video ref={video} playsInline />
      {t.waiting && !error ? <div className="apl-spin" /> : null}
      {error ? <div className="apl-msg">{error}</div> : null}
      <div className="apl-chrome">
        <div className="apl-top">
          <button type="button" className="apl-ico" aria-label="Back" onClick={close}>{Icon.back}</button>
          <div className="apl-ttl"><b>{title}</b>{subtitle ? <small>{subtitle}</small> : null}{line ? <small className="apl-party" role="status">{line}</small> : null}</div>
        </div>
        <button type="button" className="apl-big" aria-label={t.paused ? "Play" : "Pause"} onClick={toggle}>{t.paused ? Icon.play : Icon.pause}</button>
        {live ? null : <div className="apl-line" onClick={scrub}><i className="apl-buf" style={{ width: `${bpct}%` }} /><i className="apl-pos" style={{ width: `${pct}%` }} /><i className="apl-knob" style={{ left: `${pct}%` }} /></div>}
        <div className="apl-bottom">
          <button type="button" className="apl-ico" aria-label={t.muted ? "Unmute" : "Mute"} onClick={() => { video.current.muted = !video.current.muted; }}>{t.muted ? Icon.muted : Icon.vol}</button>
          {live ? <span className="apl-live">Live</span> : <span className="apl-time">{fmt(t.cur)}{t.dur && Number.isFinite(t.dur) ? ` / ${fmt(t.dur)}` : ""}</span>}
          <span className="apl-grow" />
          {live ? <>
            {onPrev ? <button type="button" className="apl-ico apl-text" onClick={onPrev}><span>Previous channel</span></button> : null}
          </> : <>
            <button type="button" className="apl-ico" aria-label="Back 10 seconds" onClick={() => seek(-10)}>{Icon.back10}<em>10</em></button>
            <button type="button" className="apl-ico" aria-label="Forward 10 seconds" onClick={() => seek(10)}>{Icon.fwd10}<em>10</em></button>
          </>}
          {partyItem && !party.id ? <button type="button" className="apl-ico apl-text" onClick={watchParty}>{Icon.people}<span>Watch Party</span></button> : null}
          {party.id ? <button type="button" className="apl-ico apl-text" onClick={() => leaveParty()}>{Icon.people}<span>{party.hosting ? "End party" : "Leave party"}</span></button> : null}
          {onNext ? <button type="button" className="apl-ico apl-text" onClick={onNext}>{Icon.next}<span>{live ? "Next channel" : "Next episode"}</span></button> : null}
          <button type="button" className="apl-ico" aria-label="Full screen" onClick={full}>{Icon.full}</button>
        </div>
      </div>
    </div>
  );
}
