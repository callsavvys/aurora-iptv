/* Aurora, the web version: the screens, the way between them, and the player.

   Navigation is a stack. The tabs (Home, Movies, Series, Live TV, My List,
   Search, Settings) are roots; a title page or a category pushes onto them;
   Back pops and puts focus back exactly where it was. Changing tab from the
   tab bar keeps focus in the bar — press Down to go into the page — because
   focus never moves unless you moved it. */
import * as F from "./focus.js";
import { prefs, myList, progress, slim } from "./store.js";
import { makeSource, testXtream } from "./sources.js";
import * as U from "./ui.js";
import { enrich, seasonEpisodes, collection, person as tmdbPerson, scores, norm, cleanTitle } from "./tmdb.js";

const $ = (s, r = document) => r.querySelector(s);
const stage = $(".stage"), screenEl = $("#screen"), bar = $(".bar");
const esc = U.esc;

// ---------- the stage: 1920x1080, scaled to the window ----------
function fit() {
  const s = Math.min(innerWidth / 1920, innerHeight / 1080);
  stage.style.transform = `translate(${(innerWidth - 1920 * s) / 2}px, ${(innerHeight - 1080 * s) / 2}px) scale(${s})`;
  F.setScale(s);
}
addEventListener("resize", fit); fit();

function applyLook() {
  document.documentElement.dataset.theme = prefs.theme;
  F.setMotion(prefs.motion);
  document.documentElement.classList.toggle("no-titles", !prefs.titles);
}
applyLook();

let source = makeSource(prefs.source);

// ---------- what each focusable thing does ----------
const actions = new Map();
const on = (key, fn) => { actions.set(key, fn); return key; };
const P = (item, where) => (on(U.keyOf(item, where), () => openItem(item)), U.posterCard(item, where));
const W = (item, where, opts) => (on(opts?.key || U.keyOf(item, where), () => openItem(item)), U.wideCard(item, where, opts));
const T = (item, n, where) => (on(U.keyOf(item, where), () => openItem(item)), U.topCard(item, n, where));
const C = (ch, where, list) => (on(U.keyOf(ch, where), () => playChannel(ch, list)), U.channelCard(ch, where));

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-key]");
  if (!el) return;
  const fn = actions.get(el.dataset.key);
  if (fn) fn(el);
});

function openItem(item) {
  if (item.kind === "live") return playChannel(item, [item]);
  go("detail", { item: slim(item) });
}

// ---------- toast ----------
let toastTimer;
function toast(text) {
  const t = $("#toast");
  t.textContent = text; t.classList.add("on");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("on"), 2600);
}

// ---------- the stack ----------
const stack = [];
let renderToken = 0, cleanup = null;

const SCREENS = {
  home: { tab: "home", render: renderHome },
  movies: { tab: "movies", render: (el, p) => renderBrowse(el, "movie", p) },
  series: { tab: "series", render: (el, p) => renderBrowse(el, "series", p) },
  live: { tab: "live", render: renderLive },
  mylist: { tab: "mylist", render: renderMyList },
  search: { tab: "search", render: renderSearch },
  settings: { tab: "settings", render: renderSettings },
  detail: { bar: false, render: renderDetail },
  person: { bar: false, render: renderPerson },
};

function go(name, params = {}, { root = false, focus = "content" } = {}) {
  const current = stack[stack.length - 1];
  if (current) current.focusKey = F.signature(document.activeElement);
  if (root) stack.length = 0;
  stack.push({ name, params });
  show(stack[stack.length - 1], { focus });
}

function back(key) {
  if (trailer) return closeTrailer();
  if (player) return player.back();
  if (dialogOpen()) return closeDialog();
  if (stack[stack.length - 1]?.name === "search" && key === "Backspace" && searchState.query) {
    searchState.type(null); return;
  }
  if (stack.length > 1) {
    stack.pop();
    const entry = stack[stack.length - 1];
    show(entry, { focus: "restore", key: entry.focusKey });
    return;
  }
  // at the root of a tab: Back goes Home, and from Home to the tab bar
  if (stack[0]?.name !== "home") return go("home", {}, { root: true });
  if (!bar.contains(document.activeElement)) { F.focus(bar.querySelector(".tab.on")); return; }
  toast("You're at the start — that's as far back as it goes");
}
F.setBackHandler(back);

async function show(entry, { focus = "content", key = null } = {}) {
  const token = ++renderToken;
  if (cleanup) { try { cleanup(); } catch { /* a screen that failed to clean up is gone anyway */ } cleanup = null; }
  actions.clear();
  for (const t of bar.querySelectorAll("[data-tab]")) {
    t.classList.toggle("on", t.dataset.tab === (SCREENS[entry.name].tab || ""));
    on(t.dataset.key, () => tabTo(t.dataset.tab));
  }
  const showBar = SCREENS[entry.name].bar !== false;
  bar.classList.toggle("is-hidden", !showBar);
  bar.classList.remove("away");
  const el = document.createElement("div");
  el.className = "screen-root";
  screenEl.replaceChildren(el);
  let result;
  try { result = await SCREENS[entry.name].render(el, entry.params, entry, () => token === renderToken); }
  catch (error) {
    if (token !== renderToken) return;
    el.innerHTML = `<div class="empty" style="padding-top:220px"><h2>That didn't load</h2><p>${esc(error.message || error)}</p>
      <button class="btn primary" data-f data-start data-key="retry">Try again</button></div>`;
    on("retry", () => show(entry, { focus: "content" }));
    F.focusStart();
    return;
  }
  if (token !== renderToken) return;
  cleanup = result?.cleanup || null;
  if (focus === "keep" && bar.contains(document.activeElement)) return;
  if (focus === "restore" && key && F.restore(key)) return;
  if (!screenEl.contains(document.activeElement) || focus !== "keep") F.focusStart();
}

function tabTo(tab) {
  if (stack.length === 1 && stack[0].name === tab) { // already here: go into the page
    const start = screenEl.querySelector("[data-start]") || F.focusables(screenEl)[0];
    if (start) F.focus(start);
    return;
  }
  go(tab, {}, { root: true, focus: "keep" });
}

// the tab bar steps aside once the page has moved, and comes back when you
// go up to it — the page goes back to its top with it, as on Apple TV
document.addEventListener("focus:moved", (e) => {
  const el = e.detail.el;
  if (bar.contains(el)) {
    bar.classList.remove("away");
    const page = screenEl.querySelector("[data-page]");
    if (page && Number(page.dataset.y) > 0) {
      page.dataset.y = 0;
      page.querySelector(":scope > .scroller").style.transform = "translate3d(0,0,0)";
    }
  }
});
screenEl.addEventListener("page:scroll", (e) => {
  if (!e.target.matches(".screen-root > .page, .screen-root > [data-page]")) return;
  bar.classList.toggle("away", e.detail > 40 && !bar.contains(document.activeElement));
});

// ============================== Home ==============================
let heroTimer = null;

async function renderHome(el, params, entry, live) {
  el.innerHTML = `<div class="page" data-page data-anchor="96"><div class="scroller">
    <section class="hero" data-section><div class="art"></div>${source.kind === "xtream" ? `<div class="copy"><div class="badges"><span class="badge b-plain">${esc(source.name)}</span></div>
      <h1 style="font-size:var(--t-title2)">Getting your library</h1><p class="lib-status">Connecting…</p></div>` : ""}</section>${U.skeletonRow()}${U.skeletonRow()}</div></div>`;
  const status = (e) => { const p = el.querySelector(".lib-status"); if (p) p.textContent = e.detail; };
  document.addEventListener("library:progress", status);
  let data;
  try { data = await source.home(); } finally { document.removeEventListener("library:progress", status); }
  if (!live()) return;
  const sections = [];
  const resume = progress.recent().filter((p) => (p.item.source || "demo") === source.kind);
  if (resume.length) {
    sections.push(U.row({ id: "continue", title: "Continue watching", line: "Pick up exactly where you left off." },
      resume.map((p) => { on(`home-continue|resume:${p.id}`, () => resumePlay(p)); return U.continueCard(p, "home-continue"); }).join("")));
  }
  for (const s of data.sections) {
    if (!s.items?.length) continue;
    const where = `home-${s.id}`;
    let inner = "";
    if (s.type === "top10") inner = s.items.map((x, i) => T(x, i + 1, where)).join("");
    else if (s.type === "wide") inner = s.items.map((x) => W(x, where, { flag: s.flag })).join("");
    else if (s.type === "live") inner = s.items.map((x) => C(x, where, s.items)).join("");
    else if (s.type === "genres") inner = s.items.map((g) => { on(`${where}|genre:${g.id}`, () => go("movies", { category: g.id })); return U.genreTile(g, where); }).join("");
    else {
      inner = s.items.map((x) => P(x, where)).join("");
      if (s.browse) { on(`${where}|all`, () => go(s.browse.kind === "series" ? "series" : "movies", { category: s.browse.category || "" })); inner += U.seeAll(where); }
    }
    sections.push(U.row(s, inner));
    if (s.id === "top10" && myList.all().some((x) => (x.source || "demo") === source.kind)) {
      const mine = myList.all().filter((x) => (x.source || "demo") === source.kind);
      sections.push(U.row({ id: "mylist", title: "My List", line: "Everything you saved for later." }, mine.map((x) => P(x, "home-mylist")).join("")));
    }
  }
  el.querySelector(".scroller").innerHTML = heroHtml(data.hero) + sections.join("") + `<div style="height:120px"></div>`;
  return { cleanup: startHero(el, data.hero) };
}

function heroHtml(items) {
  return `<section class="hero" data-section data-zone="hero" data-lock="x">
    <div class="art">${items.map((h, i) => `<img class="${i ? "" : "on"} ${h.backdrop ? "" : "poster-only"}" src="${esc(h.backdrop || h.poster)}" alt="" data-i="${i}">`).join("")}</div>
    <div class="copy"></div>
    <div class="pager">${items.map((_, i) => `<i class="${i ? "" : "on"}"></i>`).join("")}</div></section>`;
}

function startHero(el, items) {
  const hero = el.querySelector(".hero");
  if (!hero || !items.length) return null;
  let index = 0;
  const copy = hero.querySelector(".copy");
  const draw = () => {
    const h = items[index];
    const saved = myList.has(h);
    copy.innerHTML = `<div class="badges">${U.badge(h.badge)}${index === 0 ? '<span class="badge b-plain">Featured</span>' : ""}</div>
      <h1 dir="auto">${esc(h.title)}</h1>
      <div class="meta">${h.rating ? `<span class="star">★ ${esc(h.rating)}</span>` : ""}${h.year ? `<span class="dot">${esc(h.year)}</span>` : ""}<span class="dot">${U.kindLabel(h)}</span><span class="dot">4K</span></div>
      <p dir="auto">${esc(h.overview)}</p>
      <div class="actions">
        <button class="btn primary" data-f data-start data-key="hero|play">${U.icons.play}Play</button>
        <button class="btn" data-f data-key="hero|info">${U.icons.info}More info</button>
        <button class="btn icon ${saved ? "on" : ""}" data-f data-key="hero|list" aria-label="My List">${saved ? U.icons.check : U.icons.plus}</button>
      </div>`;
    // TMDB's title art and backdrop, for a provider's title as much as a demo one
    enrich(h).then((m) => {
      if (!m || items[index] !== h) return;
      const h1 = copy.querySelector("h1");
      if (m.logo && h1) { const im = new Image(); im.className = "logo"; im.alt = h.title; im.src = m.logo; im.onload = () => h1.isConnected && h1.replaceWith(im); }
      const bg = hero.querySelector(`.art img[data-i="${index}"]`);
      if (m.backdrop && bg && bg.classList.contains("poster-only")) { bg.src = m.backdrop; bg.classList.remove("poster-only"); }
      if (m.overview && !h.overview) { const p = copy.querySelector("p"); if (p) p.textContent = m.overview; }
    }).catch(() => {});
    hero.querySelectorAll(".art img").forEach((im, i) => im.classList.toggle("on", i === index));
    hero.querySelectorAll(".pager i").forEach((d, i) => d.classList.toggle("on", i === index));
  };
  on("hero|play", () => playItem(items[index]));
  on("hero|info", () => openItem(items[index]));
  on("hero|list", (btn) => {
    const added = myList.toggle(items[index]);
    btn.classList.toggle("on", added); btn.innerHTML = added ? U.icons.check : U.icons.plus;
    toast(added ? `Added ${items[index].title} to My List` : `Removed from My List`);
  });
  draw();
  // the hero turns over by itself, but never while you are on it
  clearInterval(heroTimer);
  heroTimer = setInterval(() => {
    if (hero.contains(document.activeElement) || player) return;
    index = (index + 1) % items.length; draw();
  }, 9000);
  return () => clearInterval(heroTimer);
}

// ============================== Movies, Series ==============================
async function renderBrowse(el, kind, params) {
  const label = kind === "series" ? "Series" : "Movies";
  el.innerHTML = `<div class="page" data-page data-anchor="96"><div class="scroller">
    <section data-section><div class="page-head"><h1>${label}</h1><p>${esc(source.name)}</p></div><div class="chips-row" data-zone="chips" data-lock="x" data-track="x" data-prefer=".chip.on"><div class="track chips"></div></div></section>
    <section data-section class="grid-section"><div class="grid" data-zone="grid">${Array.from({ length: 12 }, () => '<div class="card poster skeleton"><div class="art"></div></div>').join("")}</div></section></div></div>`;
  const cats = await source.categories(kind);
  let category = params.category ?? "";
  const chipRow = el.querySelector(".chips");
  chipRow.innerHTML = cats.map((c) => `<button class="chip ${c.id === category ? "on" : ""}" data-f data-key="chip:${esc(c.id)}" ${c.id === category ? "data-start" : ""}>${esc(c.name)}</button>`).join("");
  const grid = el.querySelector(".grid");
  let page = 1, more = true, loading = false, items = [];
  const where = `browse-${kind}`;
  async function load(reset) {
    if (loading) return; loading = true;
    if (reset) { page = 1; items = []; grid.innerHTML = Array.from({ length: 12 }, () => '<div class="card poster skeleton"><div class="art"></div></div>').join(""); }
    try {
      const r = await source.browse(kind, { category, page });
      if (reset) grid.innerHTML = "";
      items.push(...r.items); more = r.more; page += 1;
      grid.insertAdjacentHTML("beforeend", r.items.map((x) => P(x, where)).join(""));
      if (!items.length) grid.innerHTML = `<div class="empty"><h2>Nothing here yet</h2><p>This category is empty on your line.</p></div>`;
    } finally { loading = false; }
  }
  for (const c of cats) on(`chip:${c.id}`, (btn) => {
    if (category === c.id) return;
    category = c.id; params.category = c.id;
    chipRow.querySelectorAll(".chip").forEach((b) => { b.classList.toggle("on", b === btn); b.toggleAttribute("data-start", b === btn); });
    load(true);
  });
  await load(true);
  // more arrives as you get near the end, so the grid never runs out under you
  const near = (e) => {
    const card = e.detail.el;
    if (!grid.contains(card) || !more) return;
    const i = [...grid.children].indexOf(card);
    if (i > grid.children.length - 14) load(false);
  };
  document.addEventListener("focus:moved", near);
  return { cleanup: () => document.removeEventListener("focus:moved", near) };
}

// ============================== My List ==============================
async function renderMyList(el) {
  const items = myList.all().filter((x) => (x.source || "demo") === source.kind);
  if (!items.length) {
    el.innerHTML = `<div class="page-head"><h1>My List</h1><p>Nothing saved yet</p></div>
      <div class="empty"><p>Press <b>＋</b> on any title to keep it here. It's the fastest way back to something you meant to watch.</p>
      <div class="actions"><button class="btn primary" data-f data-start data-key="ml:movies">Browse movies</button><button class="btn" data-f data-key="ml:series">Browse series</button></div></div>`;
    on("ml:movies", () => tabTo("movies")); on("ml:series", () => tabTo("series"));
    return;
  }
  el.innerHTML = `<div class="page" data-page data-anchor="96"><div class="scroller">
    <section data-section><div class="page-head"><h1>My List</h1><p>${items.length} saved</p></div>
    <div class="grid" data-zone="grid">${items.map((x, i) => P(x, "mylist").replace("<button", i ? "<button" : "<button data-start")).join("")}</div></section></div></div>`;
}

// ============================== Live TV ==============================
let previewHls = null;

async function renderLive(el) {
  el.innerHTML = `<div class="live-page">
    <div class="list" data-zone="cats" data-track="y" data-lock="y" data-leave="up" data-prefer=".cat-item.on" data-pad="80"><div class="track"></div></div>
    <div class="list" data-zone="chans" data-track="y" data-lock="y" data-leave="up" data-prefer=".ch-item.on" data-pad="120"><div class="track"></div></div>
    <div class="preview"><div class="screen"><video muted playsinline></video><span class="badge b-live">Live</span></div><h3></h3><p></p>
      <div class="actions"><button class="btn primary" data-f data-key="live:watch">${U.icons.play}Watch full screen</button></div></div></div>`;
  const cats = await source.liveCategories();
  const catTrack = el.querySelector("[data-zone=cats] .track"), chTrack = el.querySelector("[data-zone=chans] .track");
  let current = null, channels = [], catId = "";
  catTrack.innerHTML = cats.map((c, i) => `<button class="cat-item ${i ? "" : "on"}" data-f data-key="cat:${esc(c.id)}"><span>${esc(c.name)}</span></button>`).join("");
  async function showCat(id) {
    catId = id;
    catTrack.querySelectorAll(".cat-item").forEach((b) => b.classList.toggle("on", b.dataset.key === `cat:${id}`));
    channels = await source.channels(id);
    if (catId !== id) return;
    chTrack.parentElement.dataset.at = 0; chTrack.style.transform = "";
    chTrack.innerHTML = channels.map((ch, i) => {
      on(U.keyOf(ch, "live"), () => playChannel(ch, channels));
      return `<button class="ch-item ${i ? "" : "on"}" data-f data-key="${esc(U.keyOf(ch, "live"))}" ${i ? "" : "data-start"}>
        <span class="n">${esc(ch.number || i + 1)}</span><span class="lg">${ch.poster ? `<img src="${esc(ch.poster)}" alt="" loading="lazy" data-fallback="${esc(ch.title.slice(0, 2))}">` : esc(ch.title.slice(0, 2))}</span>
        <span class="tx"><div class="nm">${esc(ch.title)}</div><div class="now">${esc(ch.now || ch.category || "")}</div></span></button>`;
    }).join("") || `<div class="loading">No channels in this category.</div>`;
    if (channels[0]) preview(channels[0]);
  }
  for (const c of cats) on(`cat:${c.id}`, () => { const first = chTrack.querySelector(".ch-item"); if (first) F.focus(first); });
  on("live:watch", () => current && playChannel(current, channels));

  let dwell;
  function preview(ch) {
    current = ch;
    el.querySelector(".preview h3").textContent = ch.title;
    el.querySelector(".preview p").textContent = ch.now ? `Now: ${ch.now}` : ch.category || "";
    chTrack.querySelectorAll(".ch-item").forEach((b) => b.classList.toggle("on", b.dataset.key === U.keyOf(ch, "live")));
    clearTimeout(dwell);
    // the picture follows the remote after a moment's rest, so flicking
    // through the list does not start forty streams
    dwell = setTimeout(() => attach(el.querySelector(".preview video"), source.stream(ch), { muted: true }).then((h) => { previewHls?.destroy?.(); previewHls = h; }).catch(() => {}), 650);
  }
  let catDwell;
  const onMove = (e) => {
    const k = e.detail.el.dataset.key || "";
    if (k.startsWith("cat:")) { clearTimeout(catDwell); const id = k.slice(4); catDwell = setTimeout(() => id !== catId && showCat(id), 280); }
    else if (chTrack.contains(e.detail.el)) { const ch = channels.find((c) => U.keyOf(c, "live") === k); if (ch && ch !== current) preview(ch); }
  };
  document.addEventListener("focus:moved", onMove);
  await showCat(cats[0]?.id ?? "");
  return { cleanup: () => { document.removeEventListener("focus:moved", onMove); clearTimeout(dwell); clearTimeout(catDwell); previewHls?.destroy?.(); previewHls = null; } };
}

// ============================== Search ==============================
const searchState = { query: "", type: () => {} };

async function renderSearch(el) {
  const keys = [..."abcdefghijklmnopqrstuvwxyz1234567890"];
  el.innerHTML = `<div class="search-page">
    <div><div class="query">${U.icons.search}<span class="q" data-placeholder="Search films and series"></span><span class="caret"></span></div>
      <div class="keys" data-zone="keys">${keys.map((k, i) => `<button class="key" data-f data-key="key:${k}" ${i === 0 ? "data-start" : ""}>${k}</button>`).join("")}
        <button class="key wide2" data-f data-key="key:space">space</button><button class="key wide2" data-f data-key="key:del">⌫ delete</button><button class="key wide2" data-f data-key="key:clear">clear</button></div>
      <div class="search-hint">Or just type on your keyboard. Backspace deletes; Escape goes back.</div></div>
    <div class="results" data-page data-anchor="0"><div class="scroller"><section data-section><div class="head"><div><h2>Top searches</h2><p>What people are looking for right now.</p></div></div>
      <div class="grid" data-zone="grid"></div></section></div></div></div>`;
  const q = el.querySelector(".q"), grid = el.querySelector(".results .grid"), head = el.querySelector(".results .head");
  let timer, seq = 0;
  const suggestions = (await source.home().catch(() => ({ sections: [] }))).sections.find((s) => s.type === "posters")?.items || [];
  const fill = (items, title, line) => {
    head.innerHTML = `<div><h2>${esc(title)}</h2><p>${esc(line)}</p></div>`;
    grid.innerHTML = items.length ? items.map((x) => P(x, "search")).join("") : `<div class="empty" style="padding:30px 0"><p>Nothing matches “${esc(searchState.query)}”. Try fewer letters.</p></div>`;
  };
  fill(suggestions.slice(0, 16), "Top searches", "What people are looking for right now.");
  searchState.query = "";
  searchState.type = (ch) => {
    if (ch === null) searchState.query = searchState.query.slice(0, -1);
    else if (ch === "") searchState.query = "";
    else searchState.query = (searchState.query + ch).slice(0, 40);
    q.textContent = searchState.query;
    clearTimeout(timer);
    const mine = ++seq;
    if (!searchState.query.trim()) { fill(suggestions.slice(0, 16), "Top searches", "What people are looking for right now."); return; }
    timer = setTimeout(async () => {
      const r = await source.search(searchState.query).catch(() => []);
      if (mine !== seq) return;
      fill(r, `Results for “${searchState.query}”`, `${r.length} title${r.length === 1 ? "" : "s"}`);
    }, 260);
  };
  for (const k of keys) on(`key:${k}`, () => searchState.type(k));
  on("key:space", () => searchState.type(" "));
  on("key:del", () => searchState.type(null));
  on("key:clear", () => searchState.type(""));
  return { cleanup: () => { searchState.type = () => {}; searchState.query = ""; } };
}

// typing anywhere searches: a letter on any screen opens Search with it
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || F.isTyping() || player || trailer || dialogOpen()) return;
  if (e.key === "?") { e.preventDefault(); return openHelp(); }
  if (e.key === " " && stack[stack.length - 1]?.name !== "search") return;
  const ch = e.key.length === 1 && /[\p{L}\p{N} ]/u.test(e.key) ? e.key.toLowerCase() : null;
  if (!ch) return;
  e.preventDefault();
  if (stack[stack.length - 1]?.name !== "search") { go("search", {}, { root: true }); setTimeout(() => searchState.type(ch), 0); }
  else searchState.type(ch);
});

// ============================== a title ==============================
/* Two halves meet here. The source says what you can play: the film, the
   seasons and episodes your line actually has. TMDB says everything else: the
   logo, the age rating, the scores, who made it and who is in it, what comes
   next, the trailer, the collection it belongs to. Either half can be missing
   and the page still stands. */
async function renderDetail(el, params) {
  const base = params.item;
  el.innerHTML = `<div class="detail page" data-page data-anchor="110"><div class="scroller">
    <section class="top-area" data-section><div class="backdrop">${base.backdrop ? `<img src="${esc(base.backdrop)}" alt="">` : ""}</div>
      <div class="copy"><div class="badges">${U.badge(base.badge)}</div><h1 dir="auto">${esc(base.title)}</h1><div class="loading" style="padding:0">Loading…</div></div></section></div></div>`;

  // a title known only from TMDB — a recommendation, an actor's film — is
  // looked for on your line first; if the line does not have it, it can still
  // be read about, but not played
  let item = base, onLine = true;
  if (base.tmdbOnly) {
    const found = await source.locate(base).catch(() => null);
    if (found) item = found; else onLine = false;
  }
  const provider = onLine ? await source.detail(item).catch((e) => { if (source.kind === "demo") throw e; return item; }) : item;
  const meta = await enrich(onLine ? provider : { ...base, source: "demo" }).catch(() => null);
  const page = el.querySelector(".detail");
  const preferMeta = meta && (prefs.lang !== "en" || item.source === "demo" || !provider.overview);
  const t = {
    ...provider,
    title: meta?.title || provider.title,
    overview: (preferMeta ? meta.overview : provider.overview) || meta?.overview || "",
    backdrop: meta?.backdrop || provider.backdrop || provider.poster,
    rating: meta?.rating || provider.rating,
    year: meta?.year || provider.year,
    runtime: provider.kind === "series" ? (provider.runtime || (meta?.seasonsCount ? `${meta.seasonsCount} seasons` : "")) : (meta?.runtime || provider.runtime),
    genres: meta?.genres?.length ? meta.genres : provider.genres || [],
  };
  if (t.backdrop && t.backdrop !== base.backdrop) page.querySelector(".backdrop").innerHTML = `<img src="${esc(t.backdrop)}" alt="">`;
  page.querySelector(".top-area").insertAdjacentHTML("beforeend", `<button class="btn back-btn" data-f data-key="d:back">${U.icons.back}Back</button>`);
  on("d:back", () => back());

  const saved = onLine && myList.has(provider);
  const resume = onLine ? findResume(provider) : null;
  const play = resume ? `${U.icons.play}Resume${resume.episode ? ` S${resume.episode.season} E${resume.episode.number}` : ""}` : `${U.icons.play}${provider.kind === "series" ? "Play S1 E1" : "Play"}`;
  const cert = meta?.certification;
  const next = meta?.nextEpisode && meta.nextEpisode.date >= new Date().toISOString().slice(0, 10) ? meta.nextEpisode : null;
  const when = (d) => new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  const status = meta?.type === "tv" ? (next ? `New episode ${when(next.date)}` : meta.status === "Ended" ? "Ended" : meta.status === "Returning Series" ? "Returning series" : "") : "";
  const credit = [meta?.directors?.length ? `<b>${meta.type === "tv" ? "Created by" : "Directed by"}</b> ${esc(meta.directors.join(", "))}` : "",
    meta?.cast?.length ? `<b>Starring</b> ${esc(meta.cast.slice(0, 4).map((c) => c.name).join(", "))}` : (provider.cast ? `<b>Starring</b> ${esc(provider.cast)}` : "")].filter(Boolean);

  page.querySelector(".copy").innerHTML = `
    <div class="badges">${U.badge(provider.badge)}${cert ? `<span class="badge b-cert" title="Rated in ${esc(cert.country)}">${esc(cert.cert)}</span>` : ""}${t.genres.slice(0, 3).map((g) => `<span class="badge b-plain">${esc(g)}</span>`).join("")}${onLine ? "" : '<span class="badge b-off">Not on your line</span>'}</div>
    ${meta?.logo ? `<img class="logo" src="${esc(meta.logo)}" alt="${esc(t.title)}">` : `<h1 dir="auto">${esc(t.title)}</h1>`}
    <div class="meta">${t.rating ? `<span class="star">★ ${esc(t.rating)}</span>` : ""}<span class="scores"></span>${t.year ? `<span class="dot">${esc(t.year)}</span>` : ""}${t.runtime ? `<span class="dot">${esc(t.runtime)}</span>` : ""}${status ? `<span class="dot ${next ? "soon" : ""}">${esc(status)}</span>` : ""}</div>
    ${meta?.tagline ? `<div class="tagline" dir="auto">${esc(meta.tagline)}</div>` : ""}
    <p class="overview" dir="auto">${esc(t.overview || "No description from the provider.")}</p>
    ${credit.length ? `<div class="cast">${credit.join('<span class="sep"></span>')}</div>` : ""}
    ${meta?.networks?.some((n) => n.logo) ? `<div class="nets">${meta.networks.filter((n) => n.logo).slice(0, 3).map((n) => `<img src="${esc(n.logo)}" alt="${esc(n.name)}" title="${esc(n.name)}">`).join("")}</div>` : ""}
    <div class="actions" data-zone="actions" data-lock="x">
      ${onLine ? `<button class="btn primary" data-f data-start data-key="d:play">${play}</button>` : ""}
      ${resume ? `<button class="btn" data-f data-key="d:restart">Start over</button>` : ""}
      ${meta?.trailer ? `<button class="btn" data-f ${onLine ? "" : "data-start"} data-key="d:trailer">${U.icons.film}Trailer</button>` : ""}
      ${onLine ? `<button class="btn ${saved ? "on" : ""}" data-f data-key="d:list">${saved ? U.icons.check : U.icons.plus}My List</button>` : ""}
      ${!onLine && !meta?.trailer ? `<button class="btn" data-f data-start data-key="d:back">${U.icons.back}Back</button>` : ""}
    </div>`;
  if (meta?.imdbId) scores(meta.imdbId).then((s) => {
    const box = page.querySelector(".scores");
    if (!s || !box) return;
    box.innerHTML = [s.imdb && `<span class="dot sc imdb">IMDb ${esc(s.imdb)}</span>`, s.rt && `<span class="dot sc rt">🍅 ${esc(s.rt)}</span>`, s.mc && `<span class="dot sc mc">MC ${esc(s.mc)}</span>`].filter(Boolean).join("");
  });
  on("d:play", () => resume ? resumePlay(resume) : provider.kind === "series" ? playFirstEpisode(provider) : playItem(provider));
  on("d:restart", () => resume.episode ? playEpisode(provider, resume.episode, 0) : playItem(provider, 0));
  on("d:trailer", () => openTrailer(meta.trailer, t.title));
  on("d:list", (btn) => {
    const added = myList.toggle(provider);
    btn.classList.toggle("on", added); btn.innerHTML = `${added ? U.icons.check : U.icons.plus}My List`;
    toast(added ? `Added to My List` : `Removed from My List`);
  });

  const scroller = page.querySelector(".scroller");
  const cleanups = [];

  // ---- episodes: the line's, dressed in TMDB's names and pictures ----
  if (onLine && provider.kind === "series" && provider.seasons?.length) {
    const first = resume?.episode?.season || provider.seasons[0].number;
    scroller.insertAdjacentHTML("beforeend", `<section class="block" data-section>
      <div class="head"><div><h2>Episodes</h2><p>${esc(provider.seasons.length)} season${provider.seasons.length === 1 ? "" : "s"} on your line</p></div></div>
      <div class="chips-row seasons" data-zone="seasons" data-lock="x" data-track="x" data-prefer=".chip.on"><div class="track">${provider.seasons.map((s) =>
        `<button class="chip ${s.number === first ? "on" : ""}" data-f data-key="season:${s.number}">${esc(s.name || `Season ${s.number}`)}</button>`).join("")}</div></div>
      <div class="row" data-zone="row" data-lock="x" data-track="x" style="margin-top:20px"><div class="track episodes"><div class="loading">Loading episodes…</div></div></div></section>`);
    const epTrack = scroller.querySelector(".episodes");
    let shown = null;
    const showSeason = async (n) => {
      if (shown === n) return; shown = n;
      scroller.querySelectorAll(".seasons .chip").forEach((c) => c.classList.toggle("on", c.dataset.key === `season:${n}`));
      const [eps, extra] = await Promise.all([source.episodes(provider, n), meta?.type === "tv" ? seasonEpisodes(meta.tmdbId, n) : Promise.resolve(new Map())]);
      if (shown !== n) return;
      const generic = (ep) => !ep.title || /^(episode|ep\.?|e)\s*\d+$/i.test(ep.title.trim()) || norm(ep.title).includes(norm(cleanTitle(provider.title)));
      const dressed = eps.map((ep) => {
        const x = extra.get(ep.number);
        if (!x) return ep;
        return { ...ep, title: generic(ep) || prefs.lang !== "en" ? x.title || ep.title : ep.title, overview: (prefs.lang !== "en" ? x.overview : ep.overview) || x.overview || ep.overview,
          still: x.still || ep.still, runtime: ep.runtime || x.runtime };
      });
      provider.queue = provider.queue || {}; provider.queue[n] = dressed;
      epTrack.parentElement.dataset.at = 0; epTrack.style.transform = "";
      epTrack.innerHTML = dressed.map((ep) => {
        const key = `ep:${ep.id}`;
        on(key, () => playEpisode(provider, ep));
        const pct = U.pctOf(epId(provider, ep));
        return `<button class="card episode" data-f data-key="${esc(key)}"><div class="art">${ep.still ? `<img src="${esc(ep.still)}" alt="" loading="lazy" data-fallback="${esc(ep.title)}">` : `<div class="fallback">${esc(ep.title)}</div>`}
          <span class="ep">E${ep.number}</span>${pct ? `<div class="meter"><i style="width:${pct}%"></i></div>` : ""}</div>
          <div class="t" dir="auto">${ep.number}. ${esc(ep.title)}</div><div class="m">${esc(ep.runtime || "")}</div><div class="o" dir="auto">${esc(ep.overview)}</div></button>`;
      }).join("") || `<div class="loading">No episodes listed for this season.</div>`;
    };
    for (const s of provider.seasons) on(`season:${s.number}`, () => { const e = epTrack.querySelector(".episode"); if (e) F.focus(e); });
    let dwell;
    const onMove = (e) => { const k = e.detail.el.dataset.key || ""; if (k.startsWith("season:")) { clearTimeout(dwell); dwell = setTimeout(() => showSeason(Number(k.slice(7))), 220); } };
    document.addEventListener("focus:moved", onMove);
    cleanups.push(() => { document.removeEventListener("focus:moved", onMove); clearTimeout(dwell); });
    await showSeason(first);
  }

  // ---- the people in it ----
  if (meta?.cast?.length) {
    scroller.insertAdjacentHTML("beforeend", U.row({ id: "cast", title: "Cast", line: meta.type === "tv" ? "Who is in it, and who they play." : "Who is in it, and who they play." },
      meta.cast.map((c) => { on(`cast:${c.id}`, () => go("person", { id: c.id, name: c.name })); return U.personCard(c); }).join("")));
  }

  // ---- the rest of the saga ----
  if (meta?.collection) {
    scroller.insertAdjacentHTML("beforeend", `<div class="collection-slot"></div>`);
    collection(meta.collection.id).then((parts) => {
      const slot = scroller.querySelector(".collection-slot");
      if (!slot || parts.length < 2) return slot?.remove();
      slot.outerHTML = U.row({ id: "collection", title: meta.collection.name, line: `${parts.length} films, in the order they came out.` },
        parts.map((x) => P(x, "collection")).join(""));
    });
  }

  // ---- more like it ----
  const more = meta?.recommendations?.length ? meta.recommendations : provider.more || [];
  if (more.length) scroller.insertAdjacentHTML("beforeend", U.row({ id: "more", title: "More like this", line: provider.kind === "series" ? "Series in the same vein." : "Films in the same vein." }, more.map((x) => P(x, "more")).join("")));

  // ---- the details, as TMDB has them ----
  if (meta) {
    const rows = [
      ["Original title", meta.originalTitle !== t.title ? meta.originalTitle : ""],
      ["Released", meta.released ? new Date(meta.released + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : ""],
      ["Age rating", cert ? `${cert.cert} (${cert.country})` : ""],
      ["Languages", meta.languages.join(", ")],
      ["Written by", meta.writers.join(", ")],
      [meta.type === "tv" ? "Network" : "Studios", (meta.type === "tv" ? meta.networks : meta.studios).map((s) => s.name).join(", ")],
      ["Also streaming on", meta.providers.map((p) => p.name).join(", ")],
    ].filter(([, v]) => v);
    scroller.insertAdjacentHTML("beforeend", `<section class="block" data-section><div class="head"><div><h2>Details</h2><p>From TMDB.</p></div></div>
      <button class="info-card" data-f data-key="d:info"><dl>${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd dir="auto">${esc(v)}</dd></div>`).join("")}</dl>
      ${meta.keywords.length ? `<div class="kw">${meta.keywords.map((k) => `<span>${esc(k)}</span>`).join("")}</div>` : ""}</button></section>`);
  }
  scroller.insertAdjacentHTML("beforeend", `<div style="height:80px"></div>`);
  return { cleanup: () => cleanups.forEach((f) => f()) };
}

// ============================== a person ==============================
async function renderPerson(el, params) {
  el.innerHTML = `<div class="detail page person-page" data-page data-anchor="110"><div class="scroller"><section class="top-area person-top" data-section>
    <button class="btn back-btn" data-f data-key="d:back">${U.icons.back}Back</button><div class="copy"><h1 dir="auto">${esc(params.name || "")}</h1><div class="loading" style="padding:0">Loading…</div></div></section></div></div>`;
  on("d:back", () => back());
  const p = await tmdbPerson(params.id);
  if (!p) throw new Error("TMDB has nothing on this person.");
  const top = el.querySelector(".person-top");
  const age = p.born ? Math.floor((Date.now() - new Date(p.born)) / 3.15576e10) : 0;
  top.insertAdjacentHTML("afterbegin", p.photo ? `<img class="portrait" src="${esc(p.photo)}" alt="">` : `<div class="portrait none">${esc(p.name.split(" ").map((w) => w[0]).slice(0, 2).join(""))}</div>`);
  top.querySelector(".copy").innerHTML = `<div class="badges"><span class="badge b-plain">${esc(p.dept || "Acting")}</span></div><h1 dir="auto">${esc(p.name)}</h1>
    <div class="meta">${p.born ? `<span>Born ${esc(new Date(p.born + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }))}${age ? ` (${age})` : ""}</span>` : ""}${p.place ? `<span class="dot">${esc(p.place)}</span>` : ""}</div>
    <p class="overview bio" dir="auto">${esc(p.bio || "No biography on TMDB yet.")}</p>
    <div class="actions"><button class="btn primary" data-f data-start data-key="p:known">${U.icons.film}Their titles</button></div>`;
  on("p:known", () => { const c = el.querySelector('[data-id="known"] .card'); if (c) F.focus(c); });
  const scroller = el.querySelector(".scroller");
  const known = p.known.slice(0, 40);
  scroller.insertAdjacentHTML("beforeend", U.row({ id: "known", title: "Known for", line: source.kind === "demo" ? "Their most watched films and series." : "Marked when your line has it." },
    known.map((x) => P({ ...x, badge: x.kind }, "known")).join("")) + `<div style="height:120px"></div>`);
  // mark the ones on your line, as they are found
  if (source.kind !== "demo") {
    for (const x of known) source.locate(x).then((hit) => {
      if (!hit) return;
      const card = el.querySelector(`[data-key="${CSS.escape(U.keyOf(x, "known"))}"] .art`);
      if (card && !card.querySelector(".b-online")) card.insertAdjacentHTML("beforeend", '<span class="badge b-online">On your line</span>');
    }).catch(() => {});
  }
}

// ============================== a trailer ==============================
let trailer = null;
function openTrailer(t, title) {
  if (!t) return;
  trailer = document.createElement("div");
  trailer.className = "trailer";
  // the video is YouTube's; focus stays on this layer, so Back always works
  trailer.innerHTML = `<iframe tabindex="-1" allow="autoplay; encrypted-media" src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(t.key)}?autoplay=1&rel=0&modestbranding=1&playsinline=1&enablejsapi=1"></iframe>
    <div class="trailer-bar"><b dir="auto">${esc(title)}</b><span>${esc(t.name || "Trailer")}</span><button class="btn" data-f data-start data-key="tr:close">${U.icons.back}Back</button></div>`;
  stage.appendChild(trailer);
  on("tr:close", closeTrailer);
  F.pushLayer(trailer);
}
function closeTrailer() { if (!trailer) return; const t = trailer; trailer = null; F.popLayer(t); t.remove(); }


const epId = (item, ep) => `${item.source || "demo"}:ep:${ep.id}`;
const filmId = (item) => `${item.source || "demo"}:${item.kind}:${item.id}`;

function findResume(item) {
  const mine = progress.recent().filter((p) => p.item.id === item.id && p.item.kind === item.kind && (p.item.source || "demo") === (item.source || "demo"));
  return mine[0] || null;
}
async function playFirstEpisode(item) {
  const s = item.seasons?.[0]?.number;
  if (!s) return toast("No episodes listed for this series");
  const eps = item.queue?.[s] || await source.episodes(item, s);
  if (eps[0]) playEpisode(item, eps[0]);
}
function resumePlay(p) {
  if (p.episode) return playEpisode(p.item, p.episode, p.position);
  return playItem(p.item, p.position);
}

// ============================== Settings ==============================
const THEMES = [
  { id: "teal", name: "Teal", sw: ["#080a0f", "#14d3a8", "#ffd25a"] },
  { id: "crimson", name: "Crimson", sw: ["#090909", "#e50914", "#ffffff"] },
  { id: "graphite", name: "Graphite", sw: ["#000000", "#ffffff", "#2c2c2e"] },
  { id: "aurora", name: "Aurora", sw: ["#050a0e", "#7df7dc", "#ff5a7a"] },
  { id: "violet", name: "Violet", sw: ["#0a0812", "#bf7bff", "#ff4f8b"] },
];

async function renderSettings(el, params) {
  const pane = params.pane || "look";
  el.innerHTML = `<div class="settings">
    <div class="side list" data-zone="side" data-lock="y" data-leave="up" data-prefer=".cat-item.on">
      ${[["look", "Appearance"], ["lang", "Language & region"], ["source", "Source"], ["keys", "Keyboard & remote"], ["about", "About"]].map(([id, label]) =>
        `<button class="cat-item ${id === pane ? "on" : ""}" data-f data-key="set:${id}" ${id === pane ? "data-start" : ""}><span>${label}</span></button>`).join("")}
    </div><div class="pane"></div></div>`;
  const paneEl = el.querySelector(".pane");
  const draw = (id) => {
    params.pane = id;
    el.querySelectorAll(".side .cat-item").forEach((b) => b.classList.toggle("on", b.dataset.key === `set:${id}`));
    if (id === "look") {
      paneEl.innerHTML = `<h2>Appearance</h2><p>Pick a palette — the whole app changes as you land on one. Press OK to keep it.</p>
        <div class="themes" data-zone="themes">${THEMES.map((t) => `<button class="theme ${prefs.theme === t.id ? "on" : ""}" data-f data-key="theme:${t.id}" style="background:${t.sw[0]}">
          <span class="sw">${t.sw.map((c) => `<i style="background:${c}"></i>`).join("")}</span><b>${t.name}</b></button>`).join("")}</div>
        <div data-zone="toggles">
          <button class="toggle ${prefs.motion ? "on" : ""}" data-f data-key="tg:motion"><span>Motion<small>Rows and pages glide. Off: they move in one step, which is kinder to slow televisions.</small></span><i class="sw"></i></button>
          <button class="toggle ${prefs.titles ? "on" : ""}" data-f data-key="tg:titles"><span>Titles under posters<small>Off: only the focused poster shows its name, as on Apple TV.</small></span><i class="sw"></i></button></div>`;
    } else if (id === "lang") {
      const opt = (group, value, label, current) => `<button class="chip ${value === current ? "on" : ""}" data-f data-key="opt:${group}:${value}" ${group === "lang" && value === "ar" ? 'dir="rtl"' : ""}>${label}</button>`;
      paneEl.innerHTML = `<h2>Language &amp; region</h2>
        <p>Titles, plots, episode names and biographies come from TMDB in the language you choose. Where a title has no translation yet, it falls back to English.</p>
        <div class="opt-group" data-zone="lang" data-lock="x" data-prefer=".chip.on"><b>Titles and plots</b><div class="opts">${opt("lang", "en", "English", prefs.lang)}${opt("lang", "ar", "العربية", prefs.lang)}</div></div>
        <div class="opt-group" data-zone="region" data-lock="x" data-prefer=".chip.on"><b>Country</b><small>Whose age ratings to show, and which services a title is also streaming on.</small><div class="opts">${
          [["EG", "Egypt"], ["SA", "Saudi Arabia"], ["AE", "UAE"], ["KW", "Kuwait"], ["QA", "Qatar"], ["MA", "Morocco"], ["US", "United States"], ["GB", "United Kingdom"]]
            .map(([v, l]) => opt("region", v, l, prefs.region)).join("")}</div></div>`;
    } else if (id === "source") {
      const s = prefs.source;
      paneEl.innerHTML = `<h2>Source</h2><p>Now reading from <b>${esc(source.name)}</b>. The demo uses TMDB's catalogue with a public test stream; connect your own Xtream line to test with real channels and films.</p>
        <div class="actions" style="margin-bottom:40px"><button class="btn ${s.kind === "demo" ? "primary" : ""}" data-f data-key="src:demo">Use the demo catalogue</button></div>
        <div data-zone="form">
          <label class="field"><span>Name</span><input data-f data-key="in:name" readonly value="${esc(s.name || "My IPTV")}"></label>
          <label class="field"><span>Server address</span><input data-f data-key="in:server" readonly placeholder="http://provider.com:8080" value="${esc(s.server || "")}" autocapitalize="off" spellcheck="false"></label>
          <div class="field-row"><label class="field"><span>Username</span><input data-f data-key="in:user" readonly value="${esc(s.username || "")}" autocapitalize="off" spellcheck="false"></label>
          <label class="field"><span>Password</span><input data-f data-key="in:pass" type="password" readonly value="${esc(s.password || "")}"></label></div>
          <div class="actions"><button class="btn primary" data-f data-key="src:connect">Connect</button></div>
          <div class="error" hidden></div>
          <p class="note">Press OK on a field to type in it; arrows or Escape leave it. The login is kept in this browser only. Requests to your provider go through the local Aurora server, as they go through native networking on the TV.</p></div>`;
      for (const inp of paneEl.querySelectorAll("input")) on(inp.dataset.key, () => { inp.readOnly = false; inp.focus(); const n = inp.value.length; try { inp.setSelectionRange(n, n); } catch { /* password fields */ } });
      paneEl.addEventListener("focusout", (e) => { if (e.target.matches("input")) e.target.readOnly = true; });
      paneEl.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("input") && !e.target.readOnly) { e.preventDefault(); e.target.readOnly = true; } });
    } else if (id === "keys") {
      paneEl.innerHTML = `<h2>Keyboard &amp; remote</h2><p>Everything works from the arrow keys alone — the same as a remote's D-pad.</p>
        <div class="shortcuts"><kbd>← ↑ → ↓</kbd><span>Move</span><kbd>Enter</kbd><span>Choose (OK)</span><kbd>Backspace / Esc</kbd><span>Back</span>
        <kbd>Space</kbd><span>Play / pause in the player</span><kbd>← →</kbd><span>In the player: back / forward 10 seconds</span><kbd>↑ ↓</kbd><span>Live TV player: channel up / down</span>
        <kbd>a–z 0–9</kbd><span>Start typing anywhere to search</span><kbd>?</kbd><span>Show these keys</span></div>`;
    } else {
      paneEl.innerHTML = `<h2>About</h2><p>Aurora web build — the TV interface, running in a browser so it can be tested with a keyboard. Laid out on the television's own 1920×1080 grid, following Apple's tvOS focus rules.</p>
        <p class="note">Film and series data and images from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB. Test stream: Big Buck Bunny, © Blender Foundation, CC BY 3.0.</p>`;
    }
  };
  for (const id of ["look", "lang", "source", "keys", "about"]) on(`set:${id}`, () => { const first = F.focusables(paneEl)[0]; if (first) F.focus(first); });
  for (const t of THEMES) on(`theme:${t.id}`, (btn) => {
    prefs.theme = t.id; applyLook();
    paneEl.querySelectorAll(".theme").forEach((b) => b.classList.toggle("on", b === btn));
    toast(`${t.name} it is`);
  });
  for (const [group, values] of [["lang", ["en", "ar"]], ["region", ["EG", "SA", "AE", "KW", "QA", "MA", "US", "GB"]]]) {
    for (const v of values) on(`opt:${group}:${v}`, (btn) => {
      prefs[group] = v;
      btn.parentElement.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c === btn));
      toast(group === "lang" ? (v === "ar" ? "العناوين والقصص بالعربية" : "Titles and plots in English") : `Ratings and services for ${btn.textContent}`);
    });
  }
  on("tg:motion", (b) => { prefs.motion = !prefs.motion; applyLook(); b.classList.toggle("on", prefs.motion); });
  on("tg:titles", (b) => { prefs.titles = !prefs.titles; applyLook(); b.classList.toggle("on", prefs.titles); });
  on("src:demo", () => { prefs.source = { kind: "demo" }; source = makeSource(prefs.source); toast("Using the demo catalogue"); go("home", {}, { root: true }); });
  on("src:connect", async (btn) => {
    const v = (k) => paneEl.querySelector(`[data-key="in:${k}"]`).value.trim();
    const cfg = { kind: "xtream", name: v("name") || "My IPTV", server: v("server"), username: v("user"), password: paneEl.querySelector('[data-key="in:pass"]').value };
    const err = paneEl.querySelector(".error");
    if (!cfg.server || !cfg.username || !cfg.password) { err.hidden = false; err.textContent = "Server, username and password are all needed."; return; }
    btn.textContent = "Connecting…";
    try {
      await testXtream(cfg);
      prefs.source = cfg; source = makeSource(cfg);
      toast(`Connected to ${cfg.name} — loading your library`);
      go("home", {}, { root: true });
    } catch (e) { err.hidden = false; err.textContent = e.message || "Could not connect"; btn.textContent = "Connect"; }
  });
  // landing on a section shows it, as Apple TV's Settings does
  let dwell;
  const onMove = (e) => {
    const k = e.detail.el.dataset.key || "";
    if (k.startsWith("set:")) { clearTimeout(dwell); dwell = setTimeout(() => { const id = k.slice(4); if (params.pane !== id || !paneEl.innerHTML) draw(id); }, 160); }
    if (k.startsWith("theme:")) { document.documentElement.dataset.theme = k.slice(6); }  // preview as you pass
  };
  const onLeave = (e) => { if (!(e.detail.el.dataset.key || "").startsWith("theme:")) document.documentElement.dataset.theme = prefs.theme; };
  document.addEventListener("focus:moved", onMove);
  document.addEventListener("focus:moved", onLeave);
  draw(pane);
  return { cleanup: () => { document.removeEventListener("focus:moved", onMove); document.removeEventListener("focus:moved", onLeave); clearTimeout(dwell); applyLook(); } };
}

// ============================== help ==============================
let dialog = null;
const dialogOpen = () => !!dialog;
function openHelp() {
  if (dialog) return;
  dialog = document.createElement("div");
  dialog.className = "dialog";
  dialog.innerHTML = `<div class="box"><h2>Keys</h2><div class="shortcuts"><kbd>← ↑ → ↓</kbd><span>Move</span><kbd>Enter</kbd><span>Choose</span><kbd>Backspace / Esc</kbd><span>Back</span>
    <kbd>Space</kbd><span>Play / pause</span><kbd>a–z</kbd><span>Type anywhere to search</span></div>
    <div class="actions" style="margin-top:40px"><button class="btn primary" data-f data-key="help:close">Got it</button></div></div>`;
  stage.appendChild(dialog);
  on("help:close", closeDialog);
  F.pushLayer(dialog);
}
function closeDialog() { if (!dialog) return; const d = dialog; dialog = null; F.popLayer(d); d.remove(); }

// ============================== playing ==============================
let hlsLoading = null;
const loadHls = () => (window.Hls ? Promise.resolve(window.Hls) : (hlsLoading = hlsLoading || new Promise((res, rej) => {
  const s = document.createElement("script"); s.src = "vendor/hls.js"; s.onload = () => res(window.Hls); s.onerror = rej; document.head.appendChild(s);
})));

async function attach(video, stream, { muted = false, startAt = 0 } = {}) {
  video.muted = muted;
  if (stream.hls) {
    const Hls = await loadHls();
    if (Hls?.isSupported()) {
      const hls = new Hls({
        enableWorker: true, lowLatencyMode: false, startPosition: startAt || -1,
        ...(stream.proxied ? { xhrSetup: (xhr, url) => xhr.open("GET", `/api/proxy?u=${encodeURIComponent(url)}`, true) } : {}),
      });
      hls.loadSource(stream.url); hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
      hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) video.dispatchEvent(new CustomEvent("streamerror", { detail: d.details })); });
      return hls;
    }
  }
  video.src = stream.url;
  if (startAt) video.addEventListener("loadedmetadata", () => { video.currentTime = startAt; }, { once: true });
  video.play().catch(() => {});
  return { destroy: () => { video.removeAttribute("src"); video.load(); } };
}

let player = null;

function playItem(item, startAt) {
  const saved = progress.get(filmId(item));
  openPlayer({ item, startAt: startAt ?? (saved ? saved.position : 0) });
}
function playEpisode(item, ep, startAt) {
  const saved = progress.get(epId(item, ep));
  openPlayer({ item, episode: ep, startAt: startAt ?? (saved ? saved.position : 0) });
}
function playChannel(ch, list) { openPlayer({ item: ch, live: true, channels: list?.length ? list : [ch] }); }

function openPlayer(opts) {
  if (player) player.close(true);
  previewHls?.destroy?.(); previewHls = null;
  const el = document.createElement("div");
  el.className = "player show";
  el.setAttribute("data-keys-own", "");
  el.innerHTML = `<video playsinline></video><div class="spinner"></div>
    <div class="flash l"></div><div class="flash r"></div><div class="flash c"></div>
    <div class="chrome"><div class="ttl"><small></small><b></b></div>
      <div class="bottom"><div class="timeline"><span class="cur">0:00</span><div class="bar2"><div class="buf"></div><div class="pos"></div><div class="knob"></div></div><span class="dur"></span></div>
        <div class="controls" data-zone="controls" data-lock="x">
          <button class="btn icon" data-f data-key="pl:back10" aria-label="Back 10 seconds">${U.icons.back10}</button>
          <button class="btn icon primary" data-f data-start data-key="pl:toggle" aria-label="Play or pause">${U.icons.pause}</button>
          <button class="btn icon" data-f data-key="pl:fwd10" aria-label="Forward 10 seconds">${U.icons.fwd10}</button>
          <span class="grow"></span>
          <button class="btn" data-f data-key="pl:next" hidden>${U.icons.next}Next episode</button>
          <button class="btn" data-f data-key="pl:close">${U.icons.back}Back</button>
        </div></div></div></div>`;
  stage.appendChild(el);
  const video = el.querySelector("video");
  const P0 = { ...opts, chIndex: opts.channels ? Math.max(0, opts.channels.findIndex((c) => c.id === opts.item.id)) : 0 };
  let handle = null, hideTimer = null, saveTimer = null, closed = false, upNext = null;

  const label = () => {
    const { item, episode, live } = P0;
    el.querySelector(".ttl small").textContent = live ? `Live · ${item.category || "Channel"}` : episode ? `${item.title} · Season ${episode.season}` : U.kindLabel(item);
    el.querySelector(".ttl b").textContent = episode ? `${episode.number}. ${episode.title}` : item.title;
    el.querySelector(".timeline").style.visibility = live ? "hidden" : "";
    const next = nextEpisode();
    el.querySelector('[data-key="pl:next"]').hidden = !next;
    ["pl:back10", "pl:fwd10"].forEach((k) => { el.querySelector(`[data-key="${k}"]`).hidden = !!live; });
  };
  function nextEpisode() {
    const { item, episode } = P0;
    if (!episode || !item.queue) return null;
    const eps = item.queue[episode.season] || [];
    const i = eps.findIndex((e) => e.id === episode.id);
    if (i !== -1 && eps[i + 1]) return eps[i + 1];
    const later = item.seasons?.find((s) => s.number > episode.season);
    return later && item.queue[later.number]?.[0] || null;
  }
  async function start(startAt = 0) {
    handle?.destroy?.(); upNext?.remove(); upNext = null;
    el.querySelector(".spinner").hidden = false;
    el.querySelector(".msg")?.remove();
    label();
    try { handle = await attach(video, source.stream(P0.item, P0.episode), { startAt }); }
    catch { fail("The player could not start."); }
  }
  const fail = (why) => {
    el.querySelector(".spinner").hidden = true;
    if (!el.querySelector(".msg")) el.insertAdjacentHTML("beforeend", `<div class="msg">${esc(why)}<br>Press Back to return.</div>`);
    showChrome();
  };
  video.addEventListener("streamerror", (e) => fail(`This stream could not be played (${e.detail}).`));
  video.addEventListener("error", () => fail("This stream could not be played."));
  video.addEventListener("playing", () => { el.querySelector(".spinner").hidden = true; });
  video.addEventListener("waiting", () => { el.querySelector(".spinner").hidden = false; });
  const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };
  const paint = () => {
    const d = video.duration || 0, t = video.currentTime || 0;
    const pct = d ? (t / d) * 100 : 0;
    el.querySelector(".pos").style.width = `${pct}%`;
    el.querySelector(".knob").style.left = `${pct}%`;
    try { if (video.buffered.length && d) el.querySelector(".buf").style.width = `${(video.buffered.end(video.buffered.length - 1) / d) * 100}%`; } catch { /* nothing buffered yet */ }
    el.querySelector(".cur").textContent = fmt(t);
    el.querySelector(".dur").textContent = d && isFinite(d) ? `-${fmt(d - t)}` : "";
    el.querySelector('[data-key="pl:toggle"]').innerHTML = video.paused ? U.icons.play : U.icons.pause;
  };
  video.addEventListener("timeupdate", paint);
  video.addEventListener("play", paint); video.addEventListener("pause", paint);
  video.addEventListener("ended", () => { save(); const n = nextEpisode(); if (n) offerNext(n); else showChrome(); });

  function save() {
    if (P0.live || !video.duration || !isFinite(video.duration)) return;
    const id = P0.episode ? epId(P0.item, P0.episode) : filmId(P0.item);
    const done = video.currentTime / video.duration > 0.95;
    progress.set(id, done ? null : { item: slim(P0.item), episode: P0.episode ? { ...P0.episode } : null, position: video.currentTime, duration: video.duration });
  }
  saveTimer = setInterval(save, 5000);

  function showChrome() {
    el.classList.add("show");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (!video.paused && !upNext) el.classList.remove("show"); }, 4000);
  }
  const chromeShown = () => el.classList.contains("show");
  const flash = (side, html) => { const f = el.querySelector(`.flash.${side}`); f.innerHTML = html; f.classList.add("on"); setTimeout(() => f.classList.remove("on"), 450); };
  const seek = (d) => { if (P0.live) return; video.currentTime = Math.max(0, Math.min((video.duration || 0) - 1, video.currentTime + d)); flash(d < 0 ? "l" : "r", `<div>${d < 0 ? U.icons.back10 : U.icons.fwd10}<div>${Math.abs(d)} s</div></div>`); };
  const toggle = () => { if (video.paused) video.play().catch(() => {}); else video.pause(); flash("c", video.paused ? U.icons.pause : U.icons.play); showChrome(); };
  const zap = (d) => {
    if (!P0.channels || P0.channels.length < 2) return;
    P0.chIndex = (P0.chIndex + d + P0.channels.length) % P0.channels.length;
    P0.item = P0.channels[P0.chIndex];
    showChrome(); start();
  };
  function offerNext(ep) {
    showChrome();
    upNext = document.createElement("div");
    upNext.className = "upnext";
    upNext.innerHTML = `<small>Up next</small><b>${esc(ep.number)}. ${esc(ep.title)}</b><div class="ring"><i style="width:0%"></i></div>
      <div class="actions"><button class="btn primary" data-f data-key="pl:upnext">${U.icons.play}Play now</button><button class="btn" data-f data-key="pl:close">Not now</button></div>`;
    el.appendChild(upNext);
    F.focus(upNext.querySelector("[data-f]"));
    let t = 0;
    const tick = setInterval(() => {
      if (!upNext || closed) return clearInterval(tick);
      t += 0.1; upNext.querySelector(".ring i").style.width = `${Math.min(100, t * 10)}%`;
      if (t >= 10) { clearInterval(tick); goNext(); }
    }, 100);
  }
  function goNext() { const n = nextEpisode(); if (!n) return; P0.episode = n; start(progress.get(epId(P0.item, n))?.position || 0); F.focusStart(); }

  // the player keeps the arrows for itself while its controls are hidden
  el.addEventListener("own:key", (e) => {
    const k = e.detail;
    if (chromeShown()) { showChrome(); return; }
    e.preventDefault();
    if (P0.live) { if (k === "ArrowUp") zap(-1); else if (k === "ArrowDown") zap(1); else showChrome(); return; }
    if (k === "ArrowLeft") seek(-10); else if (k === "ArrowRight") seek(10); else showChrome();
  });
  const onKey = (e) => {
    if (e.key === " ") { e.preventDefault(); toggle(); }
    // with the controls hidden, OK is play/pause — and the focus engine must not
    // also press whichever hidden button has focus when the key comes up
    else if (e.key === "Enter" && !chromeShown() && !upNext) { e.preventDefault(); document.activeElement?.classList.remove("pressed"); if (!e.repeat) toggle(); }
    else if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Escape", "Backspace"].includes(e.key)) showChrome();
  };
  document.addEventListener("keydown", onKey, true);

  on("pl:toggle", toggle);
  on("pl:back10", () => { seek(-10); showChrome(); });
  on("pl:fwd10", () => { seek(10); showChrome(); });
  on("pl:next", goNext);
  on("pl:upnext", goNext);
  on("pl:close", () => api.close());

  const api = {
    back() {
      if (upNext) { upNext.remove(); upNext = null; F.focusStart(); return; }
      if (chromeShown() && !video.paused) { el.classList.remove("show"); return; }
      api.close();
    },
    close(silent) {
      if (closed) return; closed = true;
      save();
      clearInterval(saveTimer); clearTimeout(hideTimer);
      document.removeEventListener("keydown", onKey, true);
      handle?.destroy?.();
      F.popLayer(el); el.remove();
      player = null;
      if (!silent) refreshAfterPlay();
    },
  };
  player = api;
  F.pushLayer(el);
  showChrome();
  start(opts.startAt || 0);
}

// coming back from the player, the page shows how far you got
function refreshAfterPlay() {
  const entry = stack[stack.length - 1];
  if (!entry) return;
  if (entry.name === "home" || entry.name === "detail") { entry.focusKey = F.signature(document.activeElement); show(entry, { focus: "restore", key: entry.focusKey }); }
}

// ---------- start ----------
window.__aurora = { focus: F };   // for the test driver: ask the engine what it sees
go("home", {}, { root: true });
