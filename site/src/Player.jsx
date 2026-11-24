import { useCallback, useEffect, useRef, useState } from "react";
import { attachPlayer, hostMedia, useParty, getParty } from "./party.js";
import { PartyStatus, PartyChat } from "./PartyUI.jsx";
import { report } from "./trackers.js";
import { getLine } from "./line.js";
import { parseSubtitles, cueAt, loadPrefs, savePrefs, DEFAULTS, FONTS } from "./subs.js";
import PlayerMenu from "./PlayerMenu.jsx";
import EpisodesPanel from "./EpisodesPanel.jsx";
import { Svg, SIDE, fullOrder } from "./playerButtons.jsx";
import { segments as loadSegments, subtitles as loadSubtitles, subtitleText } from "./extras.js";
import { tmdb } from "./tmdb.js";
import { isTV, isPhone } from "./platform.js";

/* The player, in atlantic.bz's markup (its /watch page): Back and the title at
   the top; the timeline and the controls at the bottom (play, skip by the seek amount,
   volume, time, captions, settings, full screen), hidden after a moment
   without the mouse. The settings panel is PlayerMenu. Keys: space or K plays
   and pauses, ←/→ skip (↑/↓ change channel when live; volume otherwise), F is full screen,
   M mutes, C toggles subtitles, Esc closes the panel, then the player.

   live: a channel — no timeline or skips, LIVE in place of the time.
   meta: {type, tmdb, imdb, season, episode, title, poster, backdrop} — what a
   watch party hosts (party.js), what Trakt and Simkl hear about, TheIntroDB's skip times
   (Skip Intro, the timeline's marks, Next Episode in the credits) and
   OpenSubtitles' languages in the subtitles panel (extras.js). */

const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };
const BTN = "inline-flex shrink-0 items-center justify-center p-1.5 text-white/80 hover:text-white sm:p-2";
const RATIO = { "16:9": 16 / 9, "4:3": 4 / 3, "21:9": 21 / 9 };

export default function Player({ src, title, subtitle, startAt = 0, onClose, onProgress, onEnded, onNext, onPrev, episodes, live: liveProp = false, meta }) {
  const video = useRef(null), wrap = useRef(null), hlsRef = useRef(null), hideTimer = useRef(null), audioCtx = useRef(null);
  // live: true for a channel, or "auto" to tell from the stream (no end means live)
  const [live, setLive] = useState(liveProp === true);
  useEffect(() => {
    const v = video.current; if (!v || liveProp !== "auto") return undefined;
    const check = () => setLive(v.duration === Infinity);
    v.addEventListener("loadedmetadata", check); v.addEventListener("durationchange", check);
    return () => { v.removeEventListener("loadedmetadata", check); v.removeEventListener("durationchange", check); };
  }, [liveProp]);
  const [t, setT] = useState({ cur: 0, dur: 0, buf: 0, paused: false, muted: false, volume: 1, waiting: true });
  const [shown, setShown] = useState(true);
  const [error, setError] = useState("");
  // a stream that stays stuck is loaded again from the same point (the time effect below)
  const [reloads, setReloads] = useState(0);
  const resume = useRef(null), srcNow = useRef(src); srcNow.current = src;
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
  const [segs, setSegs] = useState([]);
  const [online, setOnline] = useState(null);   // OpenSubtitles' languages, once looked up
  const skipped = useRef(new Set());
  const partyPhase = useParty((p) => p.phase), partyRole = useParty((p) => p.role);

  const setPref = useCallback((k, v) => setPrefs((p) => { const n = { ...p, [k]: v }; savePrefs(n); return n; }), []);
  const poke = useCallback(() => { setShown(true); clearTimeout(hideTimer.current); hideTimer.current = setTimeout(() => { if (!video.current?.paused) setShown(false); }, 3000); }, []);
  const toggle = () => { const v = video.current; if (!v) return; if (v.paused) v.play().catch(() => {}); else v.pause(); poke(); };
  const seek = (d) => { const v = video.current; if (!v || !v.duration || live) return; v.currentTime = Math.max(0, Math.min(v.duration - 1, v.currentTime + d)); poke(); };
  // an iPhone has no fullscreen for page elements, only for the video itself (its own player, which turns to landscape)
  const full = () => {
    const el = wrap.current, v = video.current;
    if (document.fullscreenElement) { document.exitFullscreen?.(); return; }
    if (el?.requestFullscreen) el.requestFullscreen().catch(() => v?.webkitEnterFullscreen?.());
    else v?.webkitEnterFullscreen?.();
  };
  // Back (a phone's back button or swipe, the browser's, the remote's) closes the player and keeps
  // the page: an open player is its own step in the history, and closing it takes that step back
  const closer = useRef(onClose); closer.current = onClose;
  const step = useRef(null), closed = useRef(false);
  useEffect(() => {
    const id = Math.random().toString(36).slice(2);
    const was = window.history.state;
    // the next episode or channel takes over the step of the one before
    if (was?.auroraPlayer) window.history.replaceState({ ...was, auroraPlayer: id }, "");
    else window.history.pushState({ ...was, auroraPlayer: id }, "");
    step.current = id;
    // closing gives focus back to what opened it (the channel, the episode, Play), for the remote
    // (the next episode or channel opens from inside the player: it keeps the first one's)
    const at = document.activeElement !== document.body ? document.activeElement : null;
    const opener = at?.closest?.(".fixed.inset-0.z-\\[60\\]") ? window.__auroraOpener : at;
    window.__auroraOpener = opener;
    const pop = () => { if (window.history.state?.auroraPlayer !== id && !closed.current) { closed.current = true; closer.current?.(); } };
    window.addEventListener("popstate", pop);
    return () => {
      window.removeEventListener("popstate", pop);
      if (opener && opener.isConnected) setTimeout(() => { if (opener.isConnected && !document.querySelector(".fixed.inset-0.z-\\[60\\]")) opener.focus({ preventScroll: true }); }, 0);
    };
  }, []);
  const close = () => {
    if (closed.current) return;
    if (window.history.state?.auroraPlayer === step.current) window.history.back();   // pop() then closes it
    else { closed.current = true; onClose?.(); }
  };

  // (declared before the stream, so on closing these let go while the video still has its position)
  // the watch party: the host's video is the room's clock, a guest's follows it (party.js);
  // a host who moves to another episode takes the room along
  const media = meta?.tmdb && !live ? { type: meta.type, tmdb: meta.tmdb, season: meta.season || 0, episode: meta.episode || 0, title: meta.title || title, poster: meta.poster || "", backdrop: meta.backdrop || "" } : null;
  useEffect(() => (partyPhase === "in" ? attachPlayer(video.current, media) : undefined), [partyPhase, partyRole]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (partyPhase === "in" && partyRole === "host" && media) hostMedia(media); }, [partyPhase, partyRole, media?.tmdb, media?.season, media?.episode]); // eslint-disable-line react-hooks/exhaustive-deps
  const getHostPayload = media ? () => { const v = video.current; return { media, playing: !!v && !v.paused, time: v?.currentTime || 0, rate: v?.playbackRate || 1 }; } : null;

  // Trakt and Simkl hear start, pause and stop, with how far it got
  const lastPos = useRef({ cur: 0, dur: 0 });
  useEffect(() => {
    const v = video.current; if (!v || !media) return undefined;
    const pct = () => (v.duration ? (v.currentTime / v.duration) * 100 : 0);
    const keep = () => { if (v.duration) lastPos.current = { cur: v.currentTime, dur: v.duration }; };
    v.addEventListener("timeupdate", keep);
    const start = () => report(media, "start", pct()), pause = () => { if (!v.ended) report(media, "pause", pct()); }, stop = () => report(media, "stop", pct());
    v.addEventListener("playing", start); v.addEventListener("pause", pause); v.addEventListener("ended", stop);
    return () => {
      v.removeEventListener("playing", start); v.removeEventListener("pause", pause); v.removeEventListener("ended", stop); v.removeEventListener("timeupdate", keep);
      const { cur, dur } = lastPos.current;
      if (dur && !v.ended) { const p = (cur / dur) * 100; report(media, p >= 90 ? "stop" : "pause", p); }
    };
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps

  // the stream
  useEffect(() => {
    const v = video.current; if (!v || !src) return undefined;
    let hls = null, gone = false;
    const from = resume.current?.src === src ? resume.current.at : startAt;
    setError(""); setLevels([]); setTracks((ts) => ts.filter((x) => x.kind === "file"));
    (async () => {
      if (/\.m3u8(\?|$)/i.test(decodeURIComponent(src))) {
        const { default: Hls } = await import("hls.js");
        if (gone) return;
        if (Hls.isSupported()) {
          hls = new Hls({ startPosition: from || -1 }); hlsRef.current = hls;
          hls.loadSource(src); hls.attachMedia(v);
          hls.on(Hls.Events.MANIFEST_PARSED, () => setLevels(hls.levels.map((l, i) => ({ id: i, height: l.height || 0 })).filter((l) => l.height).sort((a, b) => b.height - a.height)));
          hls.on(Hls.Events.LEVEL_SWITCHED, (_, d) => setLevel((s) => ({ ...s, current: d.level })));
          hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => setAudios({ tracks: hls.audioTracks.map((a, i) => ({ id: i, label: a.name || a.lang || `Track ${i + 1}` })), current: hls.audioTrack }));
          hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => setTracks((ts) => [...ts.filter((x) => x.kind === "file"), ...hls.subtitleTracks.map((s, i) => ({ id: `hls-${i}`, kind: "hls", index: i, label: s.name || s.lang || `Subtitles ${i + 1}` }))]));
          hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) setError(`This stream could not be played (${d.details}).`); });
        } else {
          v.src = src;
          if (from) v.addEventListener("loadedmetadata", () => { v.currentTime = from; }, { once: true });
        }
      } else {
        v.src = src;
        if (from) v.addEventListener("loadedmetadata", () => { v.currentTime = from; }, { once: true });
      }
      v.play().catch(() => {});
    })();
    return () => { gone = true; hls?.destroy(); hlsRef.current = null; v.removeAttribute("src"); v.load(); };
  }, [src, reloads]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // a stream can stop sending without the video saying so (no "waiting", readyState still
    // full): the picture just freezes. Playing but not moving for 2 seconds counts as waiting.
    let mark = { at: v.currentTime, since: Date.now() }, stuck = false;
    const paint = () => {
      if (stuck && Math.abs(v.currentTime - mark.at) > 0.05) { stuck = false; mark = { at: v.currentTime, since: Date.now() }; }
      let buf = 0; try { if (v.buffered.length) buf = v.buffered.end(v.buffered.length - 1); } catch { /* nothing yet */ }
      setT({ cur: v.currentTime, dur: Number.isFinite(v.duration) ? v.duration : 0, buf, paused: v.paused, muted: v.muted, volume: v.volume, waiting: (v.readyState < 3 || stuck) && !v.paused });
      if (!live && Date.now() - last > 5000 && v.duration) { last = Date.now(); onProgress?.(v.currentTime, v.duration); }
    };
    const events = ["timeupdate", "play", "pause", "progress", "waiting", "playing", "volumechange", "loadedmetadata"];
    events.forEach((e) => v.addEventListener(e, paint));
    // stuck for 15 seconds: the stream has likely died, so load it again from the same point.
    // Twice at most; after that say so. Ten seconds of playing past the point starts the count over.
    let tries = { n: 0, at: 0, src: srcNow.current }, gaveUp = false;
    const watch = setInterval(() => {
      const now = Date.now();
      if (tries.src !== srcNow.current) { tries = { n: 0, at: 0, src: srcNow.current }; gaveUp = false; }
      if (v.paused || v.ended || v.seeking || Math.abs(v.currentTime - mark.at) > 0.05) {
        mark = { at: v.currentTime, since: now };
        if (tries.n && !v.paused && v.currentTime - tries.at > 10) { tries.n = 0; if (gaveUp) { gaveUp = false; setError(""); } }
      }
      const was = stuck; stuck = now - mark.since >= 2000;
      if (stuck !== was) paint();
      if (!v.paused && !v.ended && now - mark.since >= 15000 && !gaveUp) {
        if (tries.n < 2) {
          tries.n += 1; tries.at = v.currentTime;
          resume.current = { src: srcNow.current, at: live ? 0 : v.currentTime };
          mark = { at: v.currentTime, since: now };
          setReloads((r) => r + 1);
        } else {
          gaveUp = true;
          setError("The stream stopped and did not come back. Close the player and press Play to try again.");
        }
      }
    }, 1000);
    const ended = () => { if (!live) onProgress?.(v.duration, v.duration); if (prefs.autoplayNext) onEnded?.(); };
    const failed = () => setError("This stream could not be played. Your line may not carry this format, or another device is using your connection.");
    const pause = () => { if (!live && v.duration) onProgress?.(v.currentTime, v.duration); };
    v.addEventListener("ended", ended); v.addEventListener("error", failed); v.addEventListener("pause", pause);
    return () => { clearInterval(watch); events.forEach((e) => v.removeEventListener(e, paint)); v.removeEventListener("ended", ended); v.removeEventListener("error", failed); v.removeEventListener("pause", pause); };
  }, [onProgress, onEnded, live, prefs.autoplayNext]);

  // the skip times and the subtitle languages for this film or episode
  useEffect(() => {
    if (!meta?.tmdb || live) return undefined;
    let gone = false;
    setSegs([]); setOnline(null); skipped.current = new Set();
    loadSegments(meta).then((x) => !gone && setSegs(x));
    (meta.imdb ? Promise.resolve(meta.imdb) : tmdb(`/${meta.type}/${meta.tmdb}/external_ids`).then((x) => x.imdb_id).catch(() => ""))
      .then((imdb) => (imdb ? loadSubtitles({ ...meta, imdb }) : [])).then((x) => !gone && setOnline(x));
    return () => { gone = true; };
  }, [meta?.tmdb, meta?.season, meta?.episode, live]); // eslint-disable-line react-hooks/exhaustive-deps

  // speed, the volume booster, the window's size (for fixed picture shapes)
  useEffect(() => { const v = video.current; if (v && !live && getParty().phase !== "in") v.playbackRate = prefs.speed; }, [prefs.speed, live]);
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

  useEffect(() => { if (prefs.autoSubs && !sub && tracks.some((x) => x.kind !== "file")) setSub(tracks.find((x) => x.kind !== "file").id); }, [tracks]); // eslint-disable-line react-hooks/exhaustive-deps
  const chooseSub = (id) => {
    if (id === "auto") { const lang = (navigator.language || "en").slice(0, 2).toLowerCase(); const hit = tracks.find((x) => x.label.toLowerCase().startsWith(lang) || x.label.toLowerCase().includes("english")) || tracks[0]; id = hit?.id || null; if (!hit) setNote("This stream has no subtitles of its own."); }
    setSub(id); setPref("subsOn", !!id); if (id) setPref("lastSub", id);
  };
  const addFile = (label, text, os) => {
    const cues = parseSubtitles(text);
    if (!cues.length) { setNote("Those subtitles could not be read. Use .srt or .vtt."); return; }
    const id = `file-${Date.now()}`;
    setTracks((ts) => [{ id, kind: "file", label, cues, os }, ...ts.filter((x) => !(os && x.os === os))]);
    setSub(id); setPref("subsOn", true);
  };

  // keys
  useEffect(() => {
    const key = (e) => {
      if (e.target.closest?.("input, textarea")) return;
      // the remote is moving between the controls (the player's own buttons; the page's Play button,
      // still focused under the picture right after it started, does not count)
      if (e.key.startsWith("Arrow") && e.target.closest?.("button") && e.target.closest?.(".fixed.inset-0.z-\\[60\\]") && document.documentElement.classList.contains("platform-tv")) return;
      if (e.key === " " || e.key === "k") { e.preventDefault(); toggle(); }
      else if (e.key === "ArrowLeft" && !live) { e.preventDefault(); seek(-prefs.seek); }
      else if (e.key === "ArrowRight" && !live) { e.preventDefault(); seek(prefs.seek); }
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

  // the segment playing now, and its button: Skip Intro / Recap / Preview, or in the credits Next Episode (Skip Credits for a film)
  const seg = segs.find((g) => t.cur >= g.start && t.cur < (g.end ?? t.dur) - 0.5);
  const segLabel = !seg ? "" : seg.kind === "credits" ? (onNext ? "Next Episode" : "Skip Credits") : `Skip ${seg.kind[0].toUpperCase()}${seg.kind.slice(1)}`;
  const skipSeg = () => { const v = video.current; if (!v || !seg) return; if (seg.kind === "credits" && onNext) onNext(); else v.currentTime = Math.min((seg.end ?? v.duration) || v.duration, v.duration - 0.25); poke(); };
  useEffect(() => {
    if (!prefs.autoSkip || !seg || !(prefs.autoSkipTypes || []).includes(seg.kind)) return;
    const k = `${seg.kind}:${seg.start}`;
    if (skipped.current.has(k)) return;
    skipped.current.add(k); skipSeg();
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const visible = shown || t.paused || !!menu;

  /* a touch screen, like a phone's video apps: a tap shows or hides the controls (with big
     play, back and forward buttons in the middle), a double tap on the left or right skips
     back or forward and more taps keep skipping, and a swipe down closes the player */
  const touchUI = useRef(!isTV() && (isPhone() || window.matchMedia?.("(pointer: coarse)").matches)).current;
  const vis = useRef(visible); vis.current = visible;
  const lastTouch = useRef(0), down = useRef(null), tapTimer = useRef(null), taps = useRef({ side: 0, at: 0, run: false }), rippleTimer = useRef(null);
  const [ripple, setRipple] = useState(null);   // {side, secs}
  const skipBy = (side) => {
    const v = video.current; if (!v || !v.duration) return;
    v.currentTime = Math.max(0, Math.min(v.duration - 1, v.currentTime + side * prefs.seek));
    setRipple((r) => ({ side, secs: r && r.side === side ? r.secs + prefs.seek : prefs.seek }));
    clearTimeout(rippleTimer.current); rippleTimer.current = setTimeout(() => setRipple(null), 700);
  };
  const onTap = (x) => {
    if (menu) { setMenu(null); return; }
    const side = !live && prefs.doubleTap ? (x < window.innerWidth / 3 ? -1 : x > (window.innerWidth * 2) / 3 ? 1 : 0) : 0;
    const now = Date.now(), prev = taps.current;
    if (side && prev.side === side && now - prev.at < (prev.run ? 700 : 300)) {
      clearTimeout(tapTimer.current); taps.current = { side, at: now, run: true }; skipBy(side); return;
    }
    taps.current = { side, at: now, run: false };
    clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => { if (vis.current && !video.current?.paused) { clearTimeout(hideTimer.current); setShown(false); } else poke(); }, side ? 260 : 0);
  };
  const touchProps = touchUI ? {
    onPointerDown: (e) => { if (e.pointerType === "touch") down.current = { x: e.clientX, y: e.clientY, on: e.target === e.currentTarget || e.target.tagName === "VIDEO" || !!e.target.closest?.("[data-tap-through]") }; },
    onPointerUp: (e) => {
      const d = down.current; down.current = null;
      if (e.pointerType !== "touch" || !d?.on) return;
      lastTouch.current = Date.now();
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (dy > 110 && Math.abs(dx) < dy * 0.6) { close(); return; }
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) onTap(e.clientX);
    },
  } : {};
  const fromTouch = () => Date.now() - lastTouch.current < 800;
  const tapBtn = (fn) => (e) => { e.stopPropagation(); lastTouch.current = Date.now(); fn(); poke(); };

  // the party chat sits just above the timeline, whatever the size of the screen
  const barTop = useRef(null), stage = useRef(null);
  const [chatBottom, setChatBottom] = useState(null);
  useEffect(() => {
    const el = barTop.current, box0 = stage.current; if (!el || !box0) return;
    setChatBottom(Math.round(box0.getBoundingClientRect().bottom - el.getBoundingClientRect().top + 12));
  }, [box, live, visible, menu]);
  const pct = t.dur ? (t.cur / t.dur) * 100 : 0, bpct = t.dur ? (t.buf / t.dur) * 100 : 0;
  // the picture: fit, fill, stretch, or a fixed shape centred in the window
  const ratio = RATIO[prefs.picture];
  const frame = ratio ? (box.w / box.h > ratio ? { width: box.h * ratio, height: box.h } : { width: box.w, height: box.w / ratio }) : { width: box.w, height: box.h };
  const frameStyle = { left: `${(box.w - frame.width) / 2}px`, top: `${(box.h - frame.height) / 2}px`, width: `${frame.width}px`, height: `${frame.height}px` };
  const fit = prefs.picture === "Fill" ? "cover" : prefs.picture === "Fit" ? "contain" : "fill";
  const filter = [prefs.brightness !== 100 && `brightness(${prefs.brightness}%)`, prefs.contrast !== 100 && `contrast(${prefs.contrast}%)`, prefs.color !== 100 && `saturate(${prefs.color}%)`].filter(Boolean).join(" ");
  const chosen = levels.find((l) => l.id === level.current);
  const qualityLabel = levels.length ? (level.auto ? `Auto${chosen ? ` (${chosen.height}p)` : ""}` : `${chosen?.height || ""}p`) : (video.current?.videoHeight ? `${video.current.videoHeight}p` : "Original");
  const line = note;
  // the bar's buttons in the order Settings → Playback → Your Player keeps (hidden ones left out)
  const order = fullOrder(prefs.buttonOrder).filter((id) => !(prefs.hiddenButtons || []).includes(id));
  const button = (id) => {
    switch (id) {
      case "play": return <button key={id} type="button" className="inline-flex shrink-0 items-center justify-center p-1.5 sm:p-2 text-white hover:text-atlantic-300" aria-label={t.paused ? "Play" : "Pause"} onClick={toggle}>{t.paused ? Svg.play : Svg.pause}</button>;
      case "rewind": return live ? (onPrev ? <button key={id} type="button" className={BTN} aria-label="Previous channel" onClick={onPrev}>{Svg.prev}</button> : null)
        : <button key={id} type="button" className="hidden shrink-0 items-center justify-center p-1.5 text-white/80 hover:text-white sm:inline-flex sm:p-2" aria-label="Skip back" onClick={() => seek(-prefs.seek)}>{Svg.skipBack}</button>;
      case "forward": return live ? (onNext ? <button key={id} type="button" className={BTN} aria-label="Next channel" onClick={onNext}>{Svg.next}</button> : null)
        : <button key={id} type="button" className="hidden shrink-0 items-center justify-center p-1.5 text-white/80 hover:text-white sm:inline-flex sm:p-2" aria-label="Skip forward" onClick={() => seek(prefs.seek)}>{Svg.skipFwd}</button>;
      case "next": return !live && onNext ? <button key={id} type="button" className={BTN} aria-label="Next episode" title="Next episode" onClick={onNext}>{Svg.next}</button> : null;
      case "volume": return (
        <div key={id} className="flex shrink-0 cursor-pointer touch-none items-center py-0" onMouseEnter={() => setVolOpen(true)} onMouseLeave={() => setVolOpen(false)}>
          <button type="button" className="px-2 text-white/80 hover:text-white" aria-label={t.muted ? "Unmute" : "Mute"} onClick={() => { video.current.muted = !video.current.muted; }}>{t.muted || t.volume === 0 ? Svg.muted : Svg.volume}</button>
          <div className={`linear -ml-1 overflow-hidden transition-[width,opacity] duration-300 ${volOpen ? "w-20 opacity-100" : "w-0 opacity-0"}`}>
            <div className="flex h-8 w-20 items-center px-2" onPointerDown={volume}><div className="relative h-1 flex-1 rounded-full bg-white/25"><div className="absolute inset-y-0 left-0 flex items-center justify-end rounded-full bg-atlantic-400" style={{ width: `${t.muted ? 0 : t.volume * 100}%` }}><div className="h-3 w-3 translate-x-1/2 rounded-full bg-white" /></div></div></div>
          </div>
        </div>
      );
      case "captions": return <div key={id} className="relative"><button type="button" className={`inline-flex shrink-0 items-center justify-center p-1.5 hover:text-white sm:p-2 ${sub ? "text-atlantic-300" : "text-white/80"}`} aria-label="Captions" data-tour="player-captions" onClick={() => setMenu((m) => (m === "subtitles" ? null : "subtitles"))}>{Svg.captions}</button></div>;
      case "episodes": return episodes && !live ? <button key={id} type="button" className={`${BTN}${menu === "episodes" ? " text-atlantic-300" : ""}`} aria-label="Episodes" onClick={() => setMenu((m) => (m === "episodes" ? null : "episodes"))}>{Svg.episodes}</button> : null;
      case "settings": return <div key={id} className="relative"><button type="button" className={BTN} aria-label="Settings" data-tour="player-settings" onClick={() => setMenu((m) => (m ? null : "main"))}>{Svg.settings}</button></div>;
      case "fullscreen": return <button key={id} type="button" className={BTN} aria-label="Fullscreen" onClick={full}>{Svg.full}</button>;
      default: return null;
    }
  };
  const left = order.filter((id) => SIDE[id] === "left"), right = order.filter((id) => SIDE[id] === "right");
  const lastSub = () => (prefs.lastSub && tracks.some((x) => x.id === prefs.lastSub) ? prefs.lastSub : "auto");

  return (
    <div ref={wrap} className="fixed inset-0 z-[60]">
      <div ref={stage} {...touchProps} className={`relative h-dvh w-full select-none overflow-hidden bg-black${visible ? "" : " cursor-none"}`} onMouseMove={(e) => { if (!fromTouch()) poke(e); }} onClick={(e) => { if (fromTouch()) return; if (menu) { setMenu(null); return; } if (e.target === e.currentTarget || e.target.tagName === "VIDEO") toggle(); }}
        onDoubleClick={(e) => { if (fromTouch() || !(e.target === e.currentTarget || e.target.tagName === "VIDEO")) return; toggle(); const x = e.clientX / window.innerWidth; if (prefs.doubleTap && !live && x < 1 / 3) seek(-prefs.seek); else if (prefs.doubleTap && !live && x > 2 / 3) seek(prefs.seek); else full(); }}>
        <div className="absolute inset-0 overflow-hidden bg-black">
          <div className="absolute overflow-hidden" style={frameStyle}>
            <video ref={video} autoPlay playsInline className="h-full w-full" style={{ objectFit: fit, transform: prefs.noBars ? "scale(1.25)" : "none", transformOrigin: "50% 50%", transition: "transform 250ms ease-out", filter: filter || undefined }} />
          </div>
        </div>
        {segLabel ? <button type="button" onClick={(e) => { e.stopPropagation(); skipSeg(); }} className={`absolute right-4 z-20 rounded-md border border-white/30 bg-black/60 px-4 py-2 text-sm font-semibold text-white backdrop-blur-sm transition-[bottom,background-color,color] duration-200 hover:bg-white hover:text-black sm:right-8 ${visible ? "bottom-28" : "bottom-8"}`}>{segLabel}</button> : null}
        {/* centred by its box, not by a transform: the spin's own transform would undo that and swing it sideways */}
        {t.waiting && !error && !(touchUI && visible && !menu) ? <div className="pointer-events-none absolute inset-0 flex items-center justify-center"><div className="h-12 w-12 animate-spin rounded-full border-4 border-white/20 border-t-atlantic-400" /></div> : null}
        {touchUI && !error ? (
          <div data-tap-through className={`ptap-center${visible && !menu ? " on" : ""}`} aria-hidden={!(visible && !menu)}>
            {live ? (onPrev ? <button type="button" className="ptap-btn" aria-label="Previous channel" onPointerUp={(e) => e.stopPropagation()} onClick={tapBtn(onPrev)}>{Svg.prev}</button> : <span className="ptap-btn ptap-gap" />)
              : <button type="button" className="ptap-btn" aria-label={`Back ${prefs.seek} seconds`} onPointerUp={(e) => e.stopPropagation()} onClick={tapBtn(() => skipBy(-1))}>{Svg.skipBack}</button>}
            {t.waiting ? <span className="ptap-btn ptap-big"><span className="h-12 w-12 animate-spin rounded-full border-4 border-white/20 border-t-atlantic-400" /></span>
              : <button type="button" className="ptap-btn ptap-big" aria-label={t.paused ? "Play" : "Pause"} onPointerUp={(e) => e.stopPropagation()} onClick={tapBtn(toggle)}>{t.paused ? Svg.play : Svg.pause}</button>}
            {live ? (onNext ? <button type="button" className="ptap-btn" aria-label="Next channel" onPointerUp={(e) => e.stopPropagation()} onClick={tapBtn(onNext)}>{Svg.next}</button> : <span className="ptap-btn ptap-gap" />)
              : <button type="button" className="ptap-btn" aria-label={`Forward ${prefs.seek} seconds`} onPointerUp={(e) => e.stopPropagation()} onClick={tapBtn(() => skipBy(1))}>{Svg.skipFwd}</button>}
          </div>
        ) : null}
        {ripple ? <div key={`${ripple.side}`} className={`ptap-ripple ${ripple.side < 0 ? "left" : "right"}`}><span>{ripple.side < 0 ? "«" : "»"}</span>{ripple.secs} seconds</div> : null}
        {error ? <div className="absolute left-1/2 top-1/2 max-w-md -translate-x-1/2 -translate-y-1/2 px-6 text-center text-sm text-white/80">{error}</div> : null}
        {cue && !(prefs.native && tracks.find((x) => x.id === sub)?.kind !== "file") ? (
          <div className="pointer-events-none absolute inset-x-0 flex justify-center px-6 transition-[bottom] duration-200" style={{ bottom: visible ? "118px" : "48px" }}>
            <div className="whitespace-pre-line rounded-lg px-3 py-1 text-center font-semibold leading-snug" style={{ fontSize: `${prefs.size}px`, color: prefs.textColor, fontFamily: FONTS[prefs.font], backgroundColor: `rgba(0,0,0,${prefs.bgOpacity / 100})`, backdropFilter: prefs.blur ? `blur(${prefs.blur}px)` : undefined, textShadow: "0 1px 3px rgba(0,0,0,0.9)" }}>{cue}</div>
          </div>
        ) : null}
        <div className={`absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent px-4 pb-16 pt-6 sm:px-8 short:pb-8 short:pt-3 text-white transition-[transform,opacity] duration-200 ${visible ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-4 opacity-0"}`}>
          <button type="button" className="flex items-center gap-2 text-white/80 hover:text-white" onClick={close}>{Svg.back}Back</button>
          <div className="flex items-start justify-between gap-3"><div className="min-w-0">
            <p className="mt-2 text-lg font-bold">{title}</p>
            {subtitle ? <p className="text-sm text-white/60">{subtitle}</p> : null}
            {line ? <p className="mt-1 text-sm font-semibold text-atlantic-300" role="status">{line}</p> : null}
          </div></div>
        </div>
        <div className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-4 pb-4 pt-16 sm:px-8 short:pb-2 short:pt-8 text-white transition-[transform,opacity] duration-200 ${visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0"}`} onClick={(e) => e.stopPropagation()}>
          {live ? null : (
            <div ref={barTop} className=""><div className="relative w-full"><div className="group flex h-8 w-full cursor-pointer touch-none items-center" onPointerDown={scrub}><div className="relative h-1 w-full rounded-full bg-white/25 transition-[height] duration-100 group-hover:h-1.5 ">
              <div className="absolute left-0 top-0 h-full rounded-full bg-white/40" style={{ width: `${bpct}%` }} />
              {t.dur ? segs.map((g) => <div key={`${g.kind}-${g.start}`} className={`pointer-events-none absolute top-0 h-full ${g.kind === "intro" || g.kind === "recap" ? "bg-amber-300/70" : "bg-sky-300/70"}`} style={{ left: `${(g.start / t.dur) * 100}%`, width: `${(((g.end ?? t.dur) - g.start) / t.dur) * 100}%` }} />) : null}
              <div className="absolute left-0 top-0 flex h-full items-center justify-end rounded-full bg-atlantic-400" style={{ width: `${pct}%` }}><div className="h-4 w-4 min-w-[1rem] translate-x-1/2 scale-0 rounded-full bg-white transition-transform duration-100 group-hover:scale-100 " /></div>
            </div></div></div></div>
          )}
          <div ref={live ? barTop : undefined} className="mt-1 flex items-center gap-0.5 overflow-x-auto sm:gap-1">
            {left.map(button)}
            {live ? <span className="ml-1 inline-flex shrink-0 items-center gap-1.5 rounded-md bg-red-600 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-white">Live</span>
              : left.length ? <span className="shrink-0 whitespace-nowrap px-1 text-xs text-white/80 sm:px-2 sm:text-sm">{fmt(t.cur)} / {fmt(t.dur)}</span> : null}
            <div className="flex-1" />
            {right.map(button)}
          </div>
        </div>
        <PartyStatus controlsVisible={visible} />
        <PartyChat controlsVisible={visible} bottom={chatBottom} />
        {menu === "episodes" && episodes ? <EpisodesPanel tvId={episodes.tvId} seasons={episodes.seasons} season={meta?.season} episode={meta?.episode} onSelect={(s, e, name) => { setMenu(null); episodes.play(s, e, name); }} /> : null}
        {menu && menu !== "episodes" ? (
          <PlayerMenu view={menu} setView={setMenu} prefs={prefs} setPref={setPref} live={live}
            resetSubs={() => setPrefs((p) => { const n = { ...p, native: DEFAULTS.native, delay: DEFAULTS.delay, size: DEFAULTS.size, blur: DEFAULTS.blur, font: DEFAULTS.font, textColor: DEFAULTS.textColor }; savePrefs(n); return n; })}
            quality={{ label: qualityLabel, levels: levels.length ? levels.map((l) => ({ id: l.id, label: `${l.height}p` })) : [{ id: 0, label: qualityLabel }], current: levels.length ? level.current : 0, auto: levels.length ? level.auto : false,
              choose: (id) => { if (hlsRef.current) { hlsRef.current.currentLevel = id; setLevel({ current: id, auto: false }); } },
              setAuto: (on) => { if (hlsRef.current) { if (on) hlsRef.current.currentLevel = -1; setLevel((s) => ({ ...s, auto: on })); } } }}
            server={getLine()?.name || "Your line"}
            subs={{ tracks, current: sub, choose: chooseSub, toggle: (on) => chooseSub(on ? lastSub() : null),
              upload: (f) => f.text().then((txt) => addFile(f.name.replace(/\.[^.]+$/, ""), txt)), paste: (txt) => addFile("Pasted subtitles", txt),
              online, chosenOnline: tracks.find((x) => x.id === sub)?.os,
              pickOnline: (lang, file) => { setNote(`Loading ${lang.name} subtitles…`); subtitleText(file).then((txt) => { addFile(lang.name, txt, file.id); setNote(""); setMenu(null); }).catch(() => setNote("Those subtitles did not download. Try another.")); } }}
            audio={{ tracks: audios.tracks, current: audios.current, choose: (id) => { if (hlsRef.current) hlsRef.current.audioTrack = id; else if (video.current?.audioTracks) [...video.current.audioTracks].forEach((a, i) => { a.enabled = i === id; }); setAudios((a) => ({ ...a, current: id })); } }}
            party={{ getHostPayload }}
          />
        ) : null}
      </div>
    </div>
  );
}
