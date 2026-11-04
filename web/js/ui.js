/* The pieces every screen is made of. Each focusable thing carries data-f
   (the remote can land on it) and data-key (what it is, so focus can be put
   back after a re-render or a Back). */
import { progress } from "./store.js";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const icons = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.6v14.8c0 .8.9 1.3 1.6.9l12-7.4c.6-.4.6-1.4 0-1.8l-12-7.4C7.9 3.3 7 3.8 7 4.6z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4.2" height="15" rx="1.2"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.2"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.6v.4"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>',
  back10: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4v4.5h4.5"/><text x="12" y="15.5" font-size="7" font-weight="800" fill="currentColor" stroke="none" text-anchor="middle">10</text></svg>',
  fwd10: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v4.5h-4.5"/><text x="12" y="15.5" font-size="7" font-weight="800" fill="currentColor" stroke="none" text-anchor="middle">10</text></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 5.5v13l9.5-6.5zM16.5 5h2.5v14h-2.5z"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 14H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.3 7l-.1-.1A2 2 0 1 1 7 4.1l.1.1A1.7 1.7 0 0 0 10 3V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1A2 2 0 1 1 19.8 7l-.1.1A1.7 1.7 0 0 0 21 10h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1z"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m14.5 5-7 7 7 7"/></svg>',
};

const LABEL = { movie: "Movie", series: "Series", live: "Live", anime: "Anime", arabic: "Arabic", turkish: "Turkish", new: "New" };
export const badge = (b, extra = "") => (b ? `<span class="badge b-${b} ${extra}">${LABEL[b] || esc(b)}</span>` : "");
export const kindLabel = (item) => (item.kind === "series" ? "Series" : item.kind === "live" ? "Live" : "Movie");
const art = (src, title) => (src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" data-fallback="${esc(title)}">` : `<div class="fallback">${esc(title)}</div>`);
const meta = (item) => [item.rating && `<span class="star">★ ${esc(item.rating)}</span>`, esc(item.year), kindLabel(item)].filter(Boolean).join(" · ");

/* An image that fails gives way to the title, set in type — never a broken
   picture. One listener for all of them (no inline handlers, which the TV
   build's security policy refuses). */
document.addEventListener("error", (e) => {
  const im = e.target;
  if (!(im instanceof HTMLImageElement) || !im.dataset.fallback) return;
  const f = document.createElement("div");
  f.className = "fallback"; f.textContent = im.dataset.fallback;
  im.replaceWith(f);
}, true);

export const keyOf = (item, where = "") => `${where}|${item.source || "demo"}:${item.kind}:${item.id}`;

export function posterCard(item, where) {
  return `<button class="card poster" data-f data-key="${esc(keyOf(item, where))}"><div class="art">${art(item.poster, item.title)}${badge(item.badge)}</div>
    <div class="t">${esc(item.title)}</div><div class="m">${meta(item)}</div></button>`;
}

export function wideCard(item, where, { flag = "", sub = "", pct = 0, left = "", key } = {}) {
  return `<button class="card wide" data-f data-key="${esc(key || keyOf(item, where))}"><div class="art">${art(item.still || item.backdrop || item.poster, item.title)}
    ${left ? `<span class="left">${esc(left)}</span>` : ""}${flag ? `<span class="flag">${esc(flag)}</span>` : ""}
    ${pct ? `<div class="meter"><i style="width:${Math.min(100, Math.max(2, pct))}%"></i></div>` : ""}<span class="play">${icons.play}</span></div>
    <div class="t">${esc(item.title)}</div><div class="m">${sub ? esc(sub) : meta(item)}</div></button>`;
}

export function topCard(item, n, where) {
  return `<button class="card top" data-f data-key="${esc(keyOf(item, where))}"><div class="art"><span class="n">${n}</span>
    <div class="thumb">${art(item.poster, item.title)}</div><div class="info"><div class="t">${esc(item.title)}</div><div class="m">${meta(item)}</div></div></div></button>`;
}

export function channelCard(ch, where) {
  const initials = ch.title.replace(/[^\p{L}\p{N} ]/gu, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return `<button class="card chan" data-f data-key="${esc(keyOf(ch, where))}"><div class="art">
    ${ch.poster ? `<img class="logo" src="${esc(ch.poster)}" alt="" loading="lazy" data-fallback="${esc(initials)}">` : `<span class="mono-logo">${esc(initials)}</span>`}
    <span class="num">${esc(ch.number || "")}</span>${badge("live")}</div><div class="t">${esc(ch.title)}</div><div class="m">${esc(ch.now || ch.category || "Live")}</div></button>`;
}

export function genreTile(g, where) {
  return `<button class="card genre" data-f data-key="${esc(`${where}|genre:${g.id}`)}"><div class="art" style="background:linear-gradient(135deg, hsl(${g.hue} 70% 42%), hsl(${(g.hue + 40) % 360} 75% 22%))"><b>${esc(g.name)}</b></div></button>`;
}

export const seeAll = (where, wide = false) => `<button class="card see-all ${wide ? "wide-all" : ""}" data-f data-key="${esc(where)}|all"><div class="art">See all →</div></button>`;

export function row(section, inner) {
  return `<section class="block" data-section data-id="${esc(section.id)}">
    <div class="head"><div><h2>${esc(section.title)}</h2>${section.line ? `<p>${esc(section.line)}</p>` : ""}</div>${section.count ? `<span class="count">${esc(section.count)}</span>` : ""}</div>
    <div class="row" data-zone="row" data-lock="x" data-track="x"><div class="track">${inner}</div></div></section>`;
}

export function skeletonRow(n = 7) {
  return `<section class="block" data-section><div class="head"><div><h2>&nbsp;</h2></div></div><div class="row"><div class="track">${
    Array.from({ length: n }, () => '<div class="card poster skeleton"><div class="art"></div></div>').join("")}</div></div></section>`;
}

export function continueCard(p, where) {
  const pct = (p.position / p.duration) * 100;
  const mins = Math.max(1, Math.round((p.duration - p.position) / 60));
  const sub = p.episode ? `S${p.episode.season} · E${p.episode.number} — ${mins} min left` : `${mins} min left`;
  return wideCard({ ...p.item, still: p.episode?.still || p.item.still || p.item.backdrop }, where, { sub, pct, key: `${where}|resume:${p.id}` });
}

export const pctOf = (id) => { const p = progress.get(id); return p && p.duration ? (p.position / p.duration) * 100 : 0; };
