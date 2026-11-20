import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAccount, signedIn, startParty, attachPlayer, leaveParty, partyLine, party } from "./account.js";
import { getLine } from "./line.js";
import { parseSubtitles, cueAt, loadPrefs, savePrefs, DEFAULTS } from "./subs.js";
import PlayerMenu from "./PlayerMenu.jsx";

/* The player, in atlantic.bz's markup (its /watch page): Back and the title at
   the top; the timeline and the controls at the bottom (play, skip ±10 s,
   volume, time, captions, settings, full screen), hidden after a moment
   without the mouse. The settings panel is PlayerMenu. Keys: space or K plays
   and pauses, ←/→ skip 10 s (↑/↓ change channel when live), F is full screen,
   M mutes, C toggles subtitles, Esc closes the panel, then the player.

   live: a channel — no timeline or skips, LIVE in place of the time.
   partyItem: the title on your line, so Watch Party can start a party. */

const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };
const Svg = {
  back: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>,
  play: <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l12.5-7.5z" /></svg>,
  pause: <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg>,
  skipBack: <svg width="25" height="24" viewBox="0 0 25 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13.6667 12.3333L9 7.66667M9 7.66667L13.6667 3M9 7.66667H18.3333C19.571 7.66667 20.758 8.15833 21.6332 9.0335C22.5083 9.90867 23 11.0957 23 12.3333C23 13.571 22.5083 14.758 21.6332 15.6332C20.758 16.5083 19.571 17 18.3333 17H16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M4.50426 14.2727V23H2.65909V16.0241H2.60795L0.609375 17.277V15.6406L2.76989 14.2727H4.50426ZM10.0004 23.1918C9.2674 23.1889 8.63672 23.0085 8.10831 22.6506C7.58274 22.2926 7.17791 21.7741 6.89382 21.0952C6.61257 20.4162 6.47337 19.5994 6.47621 18.6449C6.47621 17.6932 6.61683 16.8821 6.89808 16.2116C7.18217 15.5412 7.587 15.0312 8.11257 14.6818C8.64098 14.3295 9.27024 14.1534 10.0004 14.1534C10.7305 14.1534 11.3583 14.3295 11.8839 14.6818C12.4123 15.0341 12.8185 15.5455 13.1026 16.2159C13.3867 16.8835 13.5273 17.6932 13.5245 18.6449C13.5245 19.6023 13.3825 20.4205 13.0984 21.0994C12.8171 21.7784 12.4137 22.2969 11.8881 22.6548C11.3626 23.0128 10.7333 23.1918 10.0004 23.1918ZM10.0004 21.6619C10.5004 21.6619 10.8995 21.4105 11.1978 20.9077C11.4961 20.4048 11.6438 19.6506 11.641 18.6449C11.641 17.983 11.5728 17.4318 11.4364 16.9915C11.3029 16.5511 11.1126 16.2202 10.8654 15.9986C10.6211 15.777 10.3327 15.6662 10.0004 15.6662C9.5032 15.6662 9.10547 15.9148 8.80717 16.4119C8.50888 16.9091 8.35831 17.6534 8.35547 18.6449C8.35547 19.3153 8.42223 19.875 8.55575 20.3239C8.69212 20.7699 8.88388 21.1051 9.13104 21.3295C9.3782 21.5511 9.66797 21.6619 10.0004 21.6619Z" fill="currentColor" /></svg>,
  skipFwd: <svg width="26" height="24" viewBox="0 0 26 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11.3333 12.3333L16 7.66667M16 7.66667L11.3333 3M16 7.66667H6.66667C5.42899 7.66667 4.242 8.15833 3.36684 9.0335C2.49167 9.90867 2 11.0957 2 12.3333C2 13.571 2.49167 14.758 3.36684 15.6332C4.242 16.5083 5.42899 17 6.66667 17H9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M16.5043 14.2727V23H14.6591V16.0241H14.608L12.6094 17.277V15.6406L14.7699 14.2727H16.5043ZM22.0004 23.1918C21.2674 23.1889 20.6367 23.0085 20.1083 22.6506C19.5827 22.2926 19.1779 21.7741 18.8938 21.0952C18.6126 20.4162 18.4734 19.5994 18.4762 18.6449C18.4762 17.6932 18.6168 16.8821 18.8981 16.2116C19.1822 15.5412 19.587 15.0312 20.1126 14.6818C20.641 14.3295 21.2702 14.1534 22.0004 14.1534C22.7305 14.1534 23.3583 14.3295 23.8839 14.6818C24.4123 15.0341 24.8185 15.5455 25.1026 16.2159C25.3867 16.8835 25.5273 17.6932 25.5245 18.6449C25.5245 19.6023 25.3825 20.4205 25.0984 21.0994C24.8171 21.7784 24.4137 22.2969 23.8881 22.6548C23.3626 23.0128 22.7333 23.1918 22.0004 23.1918ZM22.0004 21.6619C22.5004 21.6619 22.8995 21.4105 23.1978 20.9077C23.4961 20.4048 23.6438 19.6506 23.641 18.6449C23.641 17.983 23.5728 17.4318 23.4364 16.9915C23.3029 16.5511 23.1126 16.2202 22.8654 15.9986C22.6211 15.777 22.3327 15.6662 22.0004 15.6662C21.5032 15.6662 21.1055 15.9148 20.8072 16.4119C20.5089 16.9091 20.3583 17.6534 20.3555 18.6449C20.3555 19.3153 20.4222 19.875 20.5558 20.3239C20.6921 20.7699 20.8839 21.1051 21.131 21.3295C21.3782 21.5511 21.668 21.6619 22.0004 21.6619Z" fill="currentColor" /></svg>,
  volume: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></svg>,
  muted: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></svg>,
  captions: <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M7 13h3M13 13h4M7 9h4" /></svg>,
  settings: <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M9.25 22l-.4-3.2q-.325-.125-.612-.3q-.288-.175-.563-.375L4.7 19.375l-2.75-4.75l2.575-1.95Q4.5 12.5 4.5 12.337v-.675q0-.162.025-.337L1.95 9.375l2.75-4.75l2.975 1.25q.275-.2.575-.375q.3-.175.6-.3l.4-3.2h5.5l.4 3.2q.325.125.613.3q.287.175.562.375l2.975-1.25l2.75 4.75l-2.575 1.95q.025.175.025.337v.675q0 .163-.05.338l2.575 1.95l-2.75 4.75l-2.95-1.25q-.275.2-.575.375q-.3.175-.6.3l-.4 3.2h-5.5Zm2.8-6.5q1.45 0 2.475-1.025Q15.55 13.45 15.55 12q0-1.45-1.025-2.475Q13.5 8.5 12.05 8.5q-1.475 0-2.488 1.025Q8.55 10.55 8.55 12q0 1.45 1.012 2.475Q10.575 15.5 12.05 15.5Z" /></svg>,
  full: <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" /></svg>,
  next: <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>,
  prev: <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" /></svg>,
};
const BTN = "inline-flex shrink-0 items-center justify-center p-1.5 text-white/80 hover:text-white sm:p-2";
const FONT = { Default: "inherit", Serif: "Georgia, 'Times New Roman', serif", Monospace: "ui-monospace, Menlo, monospace", "Trebuchet MS": "'Trebuchet MS', sans-serif", Verdana: "Verdana, sans-serif", "Comic Sans MS": "'Comic Sans MS', cursive" };
const RATIO = { "16:9": 16 / 9, "4:3": 4 / 3, "21:9": 21 / 9 };

export default function Player({ src, title, subtitle, startAt = 0, onClose, onProgress, onEnded, onNext, onPrev, partyItem, live = false }) {
  const nav = useNavigate();
  const video = useRef(null), wrap = useRef(null), hlsRef = useRef(null), hideTimer = useRef(null), audioCtx = useRef(null);
  const [t, setT] = useState({ cur: 0, dur: 0, buf: 0, paused: false, muted: false, volume: 1, waiting: true });
  const [shown, setShown] = useState(true);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState(null);
  const [volOpen, setVolOpen] = useState(false);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [levels, setLevels] = useState([]);
  const [level, setLevel] = useState({ current: -1, auto: true });
  const [audios, setAudios] = useState({ tracks: [], current: 0 });
  const [tracks, setTracks] = useState([]);       // {id, label, kind: "hls"|"text"|"file", index?, cues?}
  const [sub, setSub] = useState(null);
  const [cue, setCue] = useState("");
  const [box, setBox] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [note, setNote] = useState("");
  useAccount();
  const unparty = useRef(() => {});

  const setPref = useCallback((k, v) => setPrefs((p) => { const n = { ...p, [k]: v }; savePrefs(n); return n; }), []);
  const poke = useCallback(() => { setShown(true); clearTimeout(hideTimer.current); hideTimer.current = setTimeout(() => { if (!video.current?.paused) setShown(false); }, 3000); }, []);
  const toggle = () => { const v = video.current; if (!v) return; if (v.paused) v.play().catch(() => {}); else v.pause(); poke(); };
  const seek = (d) => { const v = video.current; if (!v || !v.duration || live) return; v.currentTime = Math.max(0, Math.min(v.duration - 1, v.currentTime + d)); poke(); };
  const full = () => { const el = wrap.current; if (!document.fullscreenElement) el?.requestFullscreen?.().catch(() => {}); else document.exitFullscreen?.(); };
  const close = () => { leaveParty(); onClose?.(); };

  // the stream
  useEffect(() => {
    const v = video.current; if (!v || !src) return undefined;
    let hls = null, gone = false;
    setError(""); setLevels([]); setTracks((ts) => ts.filter((x) => x.kind === "file"));
    (async () => {
      if (/\.m3u8(\?|$)/i.test(decodeURIComponent(src))) {
        const { default: Hls } = await import("hls.js");
        if (gone) return;
        if (Hls.isSupported()) {
          hls = new Hls({ startPosition: startAt || -1 }); hlsRef.current = hls;
          hls.loadSource(src); hls.attachMedia(v);
          hls.on(Hls.Events.MANIFEST_PARSED, () => setLevels(hls.levels.map((l, i) => ({ id: i, height: l.height || 0 })).filter((l) => l.height).sort((a, b) => b.height - a.height)));
          hls.on(Hls.Events.LEVEL_SWITCHED, (_, d) => setLevel((s) => ({ ...s, current: d.level })));
          hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => setAudios({ tracks: hls.audioTracks.map((a, i) => ({ id: i, label: a.name || a.lang || `Track ${i + 1}` })), current: hls.audioTrack }));
          hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => setTracks((ts) => [...ts.filter((x) => x.kind === "file"), ...hls.subtitleTracks.map((s, i) => ({ id: `hls-${i}`, kind: "hls", index: i, label: s.name || s.lang || `Subtitles ${i + 1}` }))]));
          hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) setError(`This stream could not be played (${d.details}).`); });
        } else v.src = src;
      } else {
        v.src = src;
        if (startAt) v.addEventListener("loadedmetadata", () => { v.currentTime = startAt; }, { once: true });
      }
      v.play().catch(() => {});
    })();
    return () => { gone = true; hls?.destroy(); hlsRef.current = null; v.removeAttribute("src"); v.load(); };
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps

  // a progressive file's own text and audio tracks, once it has loaded
  useEffect(() => {
    const v = video.current; if (!v) return undefined;
    const read = () => {
      if (hlsRef.current) return;
      const tt = [...(v.textTracks || [])].filter((x) => x.kind === "subtitles" || x.kind === "captions");
      if (tt.length) setTracks((ts) => [...ts.filter((x) => x.kind === "file"), ...tt.map((x, i) => ({ id: `text-${i}`, kind: "text", index: i, label: x.label || x.language || `Subtitles ${i + 1}` }))]);
      const at = v.audioTracks ? [...v.audioTracks] : [];
      if (at.length) setAudios({ tracks: at.map((a, i) => ({ id: i, label: a.label || a.language || `Track ${i + 1}` })), current: Math.max(0, at.findIndex((a) => a.enabled)) });
    };
    v.addEventListener("loadedmetadata", read);
    return () => v.removeEventListener("loadedmetadata", read);
  }, []);

  // time, buffering, volume
  useEffect(() => {
    const v = video.current; if (!v) return undefined;
    let last = 0;
    const paint = () => {
      let buf = 0; try { if (v.buffered.length) buf = v.buffered.end(v.buffered.length - 1); } catch { /* nothing yet */ }
      setT({ cur: v.currentTime, dur: Number.isFinite(v.duration) ? v.duration : 0, buf, paused: v.paused, muted: v.muted, volume: v.volume, waiting: v.readyState < 3 && !v.paused });
      if (!live && Date.now() - last > 5000 && v.duration) { last = Date.now(); onProgress?.(v.currentTime, v.duration); }
    };
    const events = ["timeupdate", "play", "pause", "progress", "waiting", "playing", "volumechange", "loadedmetadata"];
    events.forEach((e) => v.addEventListener(e, paint));
    const ended = () => { if (!live) onProgress?.(v.duration, v.duration); if (prefs.autoplayNext) onEnded?.(); };
    const failed = () => setError("This stream could not be played. Your line may not carry this format, or another device is using your connection.");
    const pause = () => { if (!live && v.duration) onProgress?.(v.currentTime, v.duration); };
    v.addEventListener("ended", ended); v.addEventListener("error", failed); v.addEventListener("pause", pause);
    return () => { events.forEach((e) => v.removeEventListener(e, paint)); v.removeEventListener("ended", ended); v.removeEventListener("error", failed); v.removeEventListener("pause", pause); };
  }, [onProgress, onEnded, live, prefs.autoplayNext]);

  // speed, the volume booster, the window's size (for fixed picture shapes)
  useEffect(() => { const v = video.current; if (v && !live && !party.id) v.playbackRate = prefs.speed; }, [prefs.speed, live]);
  useEffect(() => {
    const v = video.current; if (!v || (prefs.boost <= 100 && !audioCtx.current)) return;
    try {
      if (!audioCtx.current) { const ctx = new AudioContext(); const node = ctx.createMediaElementSource(v); const gain = ctx.createGain(); node.connect(gain).connect(ctx.destination); audioCtx.current = { ctx, gain }; }
      audioCtx.current.gain.gain.value = prefs.boost / 100;
      audioCtx.current.ctx.resume?.();
    } catch { /* the booster needs the stream to come through the site, which it does */ }
  }, [prefs.boost]);
  useEffect(() => { const r = () => setBox({ w: window.innerWidth, h: window.innerHeight }); window.addEventListener("resize", r); return () => window.removeEventListener("resize", r); }, []);

  // subtitles: the chosen track's cue, drawn by the player (or by the browser, with native subtitles)
  useEffect(() => {
    const v = video.current; if (!v) return undefined;
    const tr = tracks.find((x) => x.id === sub);
    const hls = hlsRef.current;
    if (hls) hls.subtitleTrack = tr?.kind === "hls" ? tr.index : -1;
    const text = [...(v.textTracks || [])];
    text.forEach((x) => { x.mode = "disabled"; });
    setCue("");
    if (!tr) return undefined;
    if (tr.kind === "file") {
      const tick = () => setCue(cueAt(tr.cues, v.currentTime, prefs.delay)?.text || "");
      v.addEventListener("timeupdate", tick); tick();
      return () => v.removeEventListener("timeupdate", tick);
    }
    const pick = () => (tr.kind === "hls" ? text.find((x) => x.kind === "subtitles" && (x.label === tr.label || x.language === tr.label)) || text.filter((x) => x.kind === "subtitles")[tr.index] : text.filter((x) => x.kind === "subtitles" || x.kind === "captions")[tr.index]);
    let track = null;
    const show = () => setCue(track?.activeCues?.length ? [...track.activeCues].map((c) => c.text).join("\n").replace(/<[^>]+>/g, "") : "");
    const bind = () => { track = pick(); if (!track) return; track.mode = prefs.native ? "showing" : "hidden"; track.oncuechange = prefs.native ? null : show; };
    bind();
    const later = setTimeout(bind, 1200);   // HLS adds its text track a moment after switching
    return () => { clearTimeout(later); if (track) track.oncuechange = null; };
  }, [sub, tracks, prefs.native, prefs.delay]);

  const chooseSub = (id) => {
    if (id === "auto") { const lang = (navigator.language || "en").slice(0, 2).toLowerCase(); const hit = tracks.find((x) => x.label.toLowerCase().startsWith(lang) || x.label.toLowerCase().includes("english")) || tracks[0]; id = hit?.id || null; if (!hit) setNote("This stream has no subtitles of its own."); }
    setSub(id); setPref("subsOn", !!id); if (id) setPref("lastSub", id);
  };
  const addFile = (label, text) => {
    const cues = parseSubtitles(text);
    if (!cues.length) { setNote("Those subtitles could not be read. Use .srt or .vtt."); return; }
    const id = `file-${Date.now()}`;
    setTracks((ts) => [{ id, kind: "file", label, cues }, ...ts]);
    setSub(id); setPref("subsOn", true);
  };

  // the watch party: a party already open (joined by code) follows its host from the start
  useEffect(() => { unparty.current = attachPlayer(video.current); return () => unparty.current(); }, []);
  const hostParty = async () => {
    if (!signedIn()) { setNote("Sign in first, in Settings → Account, to start a watch party."); return; }
    if (!partyItem) { setNote("Start a watch party from a film or an episode."); return; }
    setNote("Starting the party…");
    const r = await startParty(partyItem);
    if (r.error) { setNote(r.error); return; }
    unparty.current(); unparty.current = attachPlayer(video.current);
    setNote("");
  };

  // keys
  useEffect(() => {
    const key = (e) => {
      if (e.target.closest?.("input, textarea")) return;
      if (e.key === " " || e.key === "k") { e.preventDefault(); toggle(); }
      else if (e.key === "ArrowLeft" && !live) { e.preventDefault(); seek(-10); }
      else if (e.key === "ArrowRight" && !live) { e.preventDefault(); seek(10); }
      else if (e.key === "ArrowUp") { e.preventDefault(); if (live && onPrev) onPrev(); else if (video.current) video.current.volume = Math.min(1, video.current.volume + 0.1); poke(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); if (live && onNext) onNext(); else if (video.current) video.current.volume = Math.max(0, video.current.volume - 0.1); poke(); }
      else if (e.key === "f") full();
      else if (e.key === "m") { video.current.muted = !video.current.muted; poke(); }
      else if (e.key === "c") chooseSub(sub ? null : prefs.lastSub && tracks.some((x) => x.id === prefs.lastSub) ? prefs.lastSub : "auto");
      else if (e.key === "Escape" && !document.fullscreenElement) { if (menu) setMenu(null); else close(); }
      else poke();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  });
  useEffect(() => {
    document.body.style.overflow = "hidden"; poke();
    return () => { document.body.style.overflow = ""; clearTimeout(hideTimer.current); const v = video.current; if (!live && v?.duration) onProgress?.(v.currentTime, v.duration); audioCtx.current?.ctx.close?.(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!note) return undefined; const x = setTimeout(() => setNote(""), 4000); return () => clearTimeout(x); }, [note]);

  // the timeline and the volume: click or drag
  const drag = (apply) => (e) => {
    const el = e.currentTarget;
    const go = (ev) => { const r = el.getBoundingClientRect(); apply(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width))); poke(); };
    go(e); const up = () => { window.removeEventListener("pointermove", go); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", go); window.addEventListener("pointerup", up);
  };
  const scrub = drag((f) => { const v = video.current; if (v?.duration) v.currentTime = f * v.duration; });
  const volume = drag((f) => { const v = video.current; if (v) { v.volume = f; v.muted = f === 0; } });

  const visible = shown || t.paused || !!menu;
  const pct = t.dur ? (t.cur / t.dur) * 100 : 0, bpct = t.dur ? (t.buf / t.dur) * 100 : 0;
  // the picture: fit, fill, stretch, or a fixed shape centred in the window
  const ratio = RATIO[prefs.picture];
  const frame = ratio ? (box.w / box.h > ratio ? { width: box.h * ratio, height: box.h } : { width: box.w, height: box.w / ratio }) : { width: box.w, height: box.h };
  const frameStyle = { left: `${(box.w - frame.width) / 2}px`, top: `${(box.h - frame.height) / 2}px`, width: `${frame.width}px`, height: `${frame.height}px` };
  const fit = prefs.picture === "Fill" ? "cover" : prefs.picture === "Fit" ? "contain" : "fill";
  const filter = [prefs.brightness !== 100 && `brightness(${prefs.brightness}%)`, prefs.contrast !== 100 && `contrast(${prefs.contrast}%)`, prefs.color !== 100 && `saturate(${prefs.color}%)`].filter(Boolean).join(" ");
  const chosen = levels.find((l) => l.id === level.current);
  const qualityLabel = levels.length ? (level.auto ? `Auto${chosen ? ` (${chosen.height}p)` : ""}` : `${chosen?.height || ""}p`) : (video.current?.videoHeight ? `${video.current.videoHeight}p` : "Original");
  const line = partyLine() || note;
  const lastSub = () => (prefs.lastSub && tracks.some((x) => x.id === prefs.lastSub) ? prefs.lastSub : "auto");

  return (
    <div ref={wrap} className="fixed inset-0 z-[60]">
      <div className={`relative h-dvh w-full select-none overflow-hidden bg-black${visible ? "" : " cursor-none"}`} onMouseMove={poke} onClick={(e) => { if (menu) { setMenu(null); return; } if (e.target === e.currentTarget || e.target.tagName === "VIDEO") toggle(); }}>
        <div className="absolute inset-0 overflow-hidden bg-black">
          <div className="absolute overflow-hidden" style={frameStyle}>
            <video ref={video} autoPlay playsInline className="h-full w-full" style={{ objectFit: fit, transform: prefs.noBars ? "scale(1.25)" : "none", transformOrigin: "50% 50%", transition: "transform 250ms ease-out", filter: filter || undefined }} />
          </div>
        </div>
        {t.waiting && !error ? <div className="pointer-events-none absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 animate-spin rounded-full border-4 border-white/20 border-t-atlantic-400" /> : null}
        {error ? <div className="absolute left-1/2 top-1/2 max-w-md -translate-x-1/2 -translate-y-1/2 px-6 text-center text-sm text-white/80">{error}</div> : null}
        {cue && !(prefs.native && tracks.find((x) => x.id === sub)?.kind !== "file") ? (
          <div className="pointer-events-none absolute inset-x-0 flex justify-center px-6 transition-[bottom] duration-200" style={{ bottom: visible ? "118px" : "48px" }}>
            <div className="whitespace-pre-line rounded-lg px-3 py-1 text-center font-semibold leading-snug" style={{ fontSize: `${prefs.size}px`, color: prefs.textColor, fontFamily: FONT[prefs.font], backgroundColor: "rgba(0,0,0,0.45)", backdropFilter: prefs.blur ? `blur(${prefs.blur}px)` : undefined, textShadow: "0 1px 3px rgba(0,0,0,0.9)" }}>{cue}</div>
          </div>
        ) : null}
        <div className={`absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent px-4 pb-16 pt-6 sm:px-8 short:pb-8 short:pt-3 text-white transition-[transform,opacity] duration-200 ${visible ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-4 opacity-0"}`}>
          <button type="button" className="flex items-center gap-2 text-white/80 hover:text-white" onClick={close}>{Svg.back}Back</button>
          <div className="flex items-start justify-between gap-3"><div className="min-w-0">
            <p className="mt-2 text-lg font-bold">{title}</p>
            {subtitle ? <p className="text-sm text-white/70">{subtitle}</p> : null}
            {line ? <p className="mt-1 text-sm font-semibold text-atlantic-300" role="status">{line}</p> : null}
          </div></div>
        </div>
        <div className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-4 pb-4 pt-16 sm:px-8 short:pb-2 short:pt-8 text-white transition-[transform,opacity] duration-200 ${visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0"}`} onClick={(e) => e.stopPropagation()}>
          {live ? null : (
            <div className=""><div className="relative w-full"><div className="group flex h-8 w-full cursor-pointer touch-none items-center" onPointerDown={scrub}><div className="relative h-1 w-full rounded-full bg-white/25 transition-[height] duration-100 group-hover:h-1.5 ">
              <div className="absolute left-0 top-0 h-full rounded-full bg-white/40" style={{ width: `${bpct}%` }} />
              <div className="absolute left-0 top-0 flex h-full items-center justify-end rounded-full bg-atlantic-400" style={{ width: `${pct}%` }}><div className="h-4 w-4 min-w-[1rem] translate-x-1/2 scale-0 rounded-full bg-white transition-transform duration-100 group-hover:scale-100 " /></div>
            </div></div></div></div>
          )}
          <div className="mt-1 flex items-center gap-0.5 overflow-x-auto sm:gap-1">
            <button type="button" className="inline-flex shrink-0 items-center justify-center p-1.5 sm:p-2 text-white hover:text-atlantic-300" aria-label={t.paused ? "Play" : "Pause"} onClick={toggle}>{t.paused ? Svg.play : Svg.pause}</button>
            {live ? <>
              {onPrev ? <button type="button" className={BTN} aria-label="Previous channel" onClick={onPrev}>{Svg.prev}</button> : null}
              {onNext ? <button type="button" className={BTN} aria-label="Next channel" onClick={onNext}>{Svg.next}</button> : null}
            </> : <>
              <button type="button" className="hidden shrink-0 items-center justify-center p-1.5 text-white/80 hover:text-white sm:inline-flex sm:p-2" aria-label="Skip back" onClick={() => seek(-10)}>{Svg.skipBack}</button>
              <button type="button" className="hidden shrink-0 items-center justify-center p-1.5 text-white/80 hover:text-white sm:inline-flex sm:p-2" aria-label="Skip forward" onClick={() => seek(10)}>{Svg.skipFwd}</button>
            </>}
            <div className="flex shrink-0 cursor-pointer touch-none items-center py-0" onMouseEnter={() => setVolOpen(true)} onMouseLeave={() => setVolOpen(false)}>
              <button type="button" className="px-2 text-white/80 hover:text-white" aria-label={t.muted ? "Unmute" : "Mute"} onClick={() => { video.current.muted = !video.current.muted; }}>{t.muted || t.volume === 0 ? Svg.muted : Svg.volume}</button>
              <div className={`linear -ml-1 overflow-hidden transition-[width,opacity] duration-300 ${volOpen ? "w-20 opacity-100" : "w-0 opacity-0"}`}>
                <div className="flex h-8 w-20 items-center px-2" onPointerDown={volume}><div className="relative h-1 flex-1 rounded-full bg-white/25"><div className="absolute inset-y-0 left-0 flex items-center justify-end rounded-full bg-atlantic-400" style={{ width: `${t.muted ? 0 : t.volume * 100}%` }}><div className="h-3 w-3 translate-x-1/2 rounded-full bg-white" /></div></div></div>
              </div>
            </div>
            {live ? <span className="ml-1 inline-flex shrink-0 items-center gap-1.5 rounded-md bg-red-600 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-white">Live</span>
              : <span className="shrink-0 whitespace-nowrap px-1 text-xs text-white/80 sm:px-2 sm:text-sm">{fmt(t.cur)} / {fmt(t.dur)}</span>}
            <div className="flex-1" />
            {!live && onNext ? <button type="button" className={BTN} aria-label="Next episode" title="Next episode" onClick={onNext}>{Svg.next}</button> : null}
            <div className="relative"><button type="button" className={`inline-flex shrink-0 items-center justify-center p-1.5 hover:text-white sm:p-2 ${sub ? "text-atlantic-300" : "text-white/80"}`} aria-label="Captions" data-tour="player-captions" onClick={() => setMenu((m) => (m === "subtitles" ? null : "subtitles"))}>{Svg.captions}</button></div>
            <div className="relative"><button type="button" className={BTN} aria-label="Settings" data-tour="player-settings" onClick={() => setMenu((m) => (m ? null : "main"))}>{Svg.settings}</button></div>
            <button type="button" className={BTN} aria-label="Fullscreen" onClick={full}>{Svg.full}</button>
          </div>
        </div>
        {menu ? (
          <PlayerMenu view={menu} setView={setMenu} prefs={prefs} setPref={setPref} live={live}
            resetSubs={() => setPrefs((p) => { const n = { ...p, native: DEFAULTS.native, delay: DEFAULTS.delay, size: DEFAULTS.size, blur: DEFAULTS.blur, font: DEFAULTS.font, textColor: DEFAULTS.textColor }; savePrefs(n); return n; })}
            quality={{ label: qualityLabel, levels: levels.length ? levels.map((l) => ({ id: l.id, label: `${l.height}p` })) : [{ id: 0, label: qualityLabel }], current: levels.length ? level.current : 0, auto: levels.length ? level.auto : false,
              choose: (id) => { if (hlsRef.current) { hlsRef.current.currentLevel = id; setLevel({ current: id, auto: false }); } },
              setAuto: (on) => { if (hlsRef.current) { if (on) hlsRef.current.currentLevel = -1; setLevel((s) => ({ ...s, auto: on })); } } }}
            server={getLine()?.name || "Your line"}
            subs={{ tracks, current: sub, choose: chooseSub, toggle: (on) => chooseSub(on ? lastSub() : null),
              upload: (f) => f.text().then((txt) => addFile(f.name.replace(/\.[^.]+$/, ""), txt)), paste: (txt) => addFile("Pasted subtitles", txt) }}
            audio={{ tracks: audios.tracks, current: audios.current, choose: (id) => { if (hlsRef.current) hlsRef.current.audioTrack = id; else if (video.current?.audioTracks) [...video.current.audioTracks].forEach((a, i) => { a.enabled = i === id; }); setAudios((a) => ({ ...a, current: id })); } }}
            party={{ code: party.code, active: !!party.id, hosting: party.hosting, note, host: hostParty, leave: () => leaveParty(), join: () => { close(); nav("/parties"); } }}
          />
        ) : null}
      </div>
    </div>
  );
}
