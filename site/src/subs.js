/* Subtitles for the player: SubRip (.srt) and WebVTT (.vtt) text into cues
   {start, end, text} in seconds, and the player's saved preferences. */

const stamp = (s) => {
  const m = /(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})/.exec(s || "");
  if (!m) return NaN;
  return (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0")) / 1000;
};

export function parseSubtitles(text) {
  const blocks = String(text || "").replace(/\r/g, "").replace(/^﻿/, "").split(/\n{2,}/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    const at = lines.findIndex((l) => l.includes("-->"));
    if (at < 0) continue;
    const [a, b] = lines[at].split("-->");
    const start = stamp(a), end = stamp(b);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    const body = lines.slice(at + 1).join("\n").replace(/<\/?(?:i|b|u|font|c)[^>]*>/gi, "").replace(/\{\\[^}]*\}/g, "").trim();
    if (body) cues.push({ start, end, text: body });
  }
  return cues.sort((x, y) => x.start - y.start);
}

/* the cue showing at time t (a delay moves the subtitles later) */
export function cueAt(cues, t, delay = 0) {
  const at = t - delay;
  for (const c of cues) { if (c.start > at) break; if (at <= c.end) return c; }
  return null;
}

const KEY = "aurora-site-player";
export const DEFAULTS = {
  speed: 1, picture: "Fit", noBars: false, boost: 100, brightness: 100, contrast: 100, color: 100, autoplayNext: true,
  native: false, delay: 0, size: 18, blur: 4, font: "Default", textColor: "#ffffff", subsOn: false,
};
export function loadPrefs() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return { ...DEFAULTS }; } }
export function savePrefs(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode */ } }
