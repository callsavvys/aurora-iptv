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
import * as Plat from "./platform.js";
import * as Tg from "./together.js";
import { enrich, seasonEpisodes, collection, person as tmdbPerson, scores, norm, cleanTitle } from "./tmdb.js";

const $ = (s, r = document) => r.querySelector(s);
const stage = $(".stage"), screenEl = $("#screen"), bar = $(".bar");
const esc = U.esc;

// ---------- the stage: 1920x1080, scaled to the window ----------
/* The window's real size is clientWidth/clientHeight. innerWidth is not: an
   Android TV WebView grows it to fit the 1920-wide stage itself (a 960x540
   screen reported 1920x1080), so scaling by it drew the stage at twice the
   size with three quarters of it off the screen. */
/* A phone gets its own page: 780 stage px wide and as tall as the screen, so
   the TV's sizes come out at phone sizes (26px text is about 13pt), pages and
   rows scroll under a finger, and a tap opens things. The TV and a computer
   keep the 1920x1080 stage. */
const PHONE_WIDTH = 780;
const isPhone = () => document.documentElement.clientWidth < 900;
function fit() {
  const w = document.documentElement.clientWidth, h = document.documentElement.clientHeight;
  const phone = isPhone();
  document.documentElement.classList.toggle("phone", phone);
  F.setTouch(phone);
  if (phone) {
    const s = w / PHONE_WIDTH;
    stage.style.width = `${PHONE_WIDTH}px`; stage.style.height = `${h / s}px`;
    stage.style.transform = `scale(${s})`;
    F.setScale(s);
    return;
  }
  stage.style.width = ""; stage.style.height = "";
  const s = Math.min(w / 1920, h / 1080);
  stage.style.transform = `translate(${(w - 1920 * s) / 2}px, ${(h - 1080 * s) / 2}px) scale(${s})`;
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

// a click from a mouse or a finger, not Enter on a remote (which also fires click, with detail 0)
let pointerClick = false;
document.addEventListener("click", (e) => {
  pointerClick = e.detail > 0;
  const el = e.target.closest("[data-key]");
  if (!el) return;
  // iPhone Safari does not focus a tapped button, and screens react to focus
  // (a Live TV category loads when it is focused): a tap focuses first
  if (isPhone() && el.matches("[data-f]") && document.activeElement !== el) F.focus(el);
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
  if (Plat.native) return false;   // the remote's Back from Home leaves the app
  toast("You're at the start — that's as far back as it goes");
}
F.setBackHandler(back);
// the television's Back button: true when the app used the press
Plat.onBack(() => back("Back") !== false);

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
  el.innerHTML = `<div class="page" data-page data-anchor="150"><div class="scroller">
    <section class="hero" data-section><div class="art"></div>${source.kind === "xtream" ? `<div class="copy"><div class="badges"><span class="badge b-plain">${esc(source.name)}</span></div>
      <h1 style="font-size:var(--t-title2)">Getting your library</h1><p class="lib-status">Connecting…</p></div>` : ""}</section>${U.skeletonRow()}${U.skeletonRow()}</div></div>`;
  const status = (e) => { const p = el.querySelector(".lib-status"); if (p) p.textContent = e.detail; };
  document.addEventListener("library:progress", status);
  let data;
  try { data = await source.home(); } finally { document.removeEventListener("library:progress", status); }
  if (!live()) return;
  const sections = [`<div class="watching-now" data-section hidden></div>`];
  const resume = progress.recent(source.kind);
  if (Tg.signedIn() && source.titles) source.titles().then((t) => Tg.publishLibrary(t, prefs.source.id || source.name)).catch(() => {});
  if (Tg.signedIn()) Tg.friendsWatching().then((list) => {
    const slot = el.querySelector(".watching-now");
    if (!slot || !live() || !list.length) return;
    slot.innerHTML = U.row({ id: "watching", title: "Watching now", line: "Your friends' parties. Join and you'll play your own copy, in step with theirs." },
      list.map((p) => { const key = `home-watching|${p.code}`; on(key, () => joinWithCode(p.code)); return `<button class="card wide watching" data-f data-key="${esc(key)}"><div class="art"><div class="who"><b>${esc(p.display_name || "A friend")}</b><span>is watching</span></div><div class="ov"><div class="name"><b dir="auto">${esc(p.title)}</b><small>Join · code ${esc(p.code)}</small></div></div></div><div class="t" dir="auto">${esc(p.title)}</div><div class="m">Join · code ${esc(p.code)}</div></button>`; }).join(""));
    slot.hidden = false;
  }).catch(() => {});
  const mine = await myList.items(source.kind, findOnLine);
  if (resume.length) {
    sections.push(U.row({ id: "continue", title: "Continue watching", line: "Pick up exactly where you left off." },
      resume.map((p) => { on(`home-continue|resume:${p.id}`, () => resumePlay(p)); return U.continueWideCard(p, "home-continue"); }).join("")));
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
    if (s.id === "top10" && mine.length) {
      sections.push(U.row({ id: "mylist", title: "My List", line: "Everything you saved for later." }, mine.map((x) => P(x, "home-mylist")).join("")));
    }
  }
  el.querySelector(".scroller").innerHTML = heroHtml(data.hero) + sections.join("") + `<div style="height:120px"></div>`;
  return { cleanup: startHero(el, data.hero) };
}

function heroHtml(items) {
  return `<section class="hero" data-section data-zone="hero" data-lock="x">
    <div class="ambient">${items.map((h, i) => `<img class="${i ? "" : "on"}" src="${esc(h.backdrop || h.poster)}" alt="" data-i="${i}">`).join("")}</div>
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
    const line = (genres) => U.ring(h.rating) + [h.year, genres || U.kindLabel(h)].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('<span class="sep">·</span>');
    const chips = (genres) => (genres || []).slice(0, 3).map((g) => `<span>${esc(g)}</span>`).join("");
    copy.innerHTML = `<span class="eyebrow">${index === 0 ? "Trending now" : U.kindLabel(h) === "Series" ? "Popular series" : "Popular film"}</span>
      <div class="logo-box"><h1 dir="auto">${esc(h.title)}</h1></div>
      <div class="meta atl-meta">${line()}</div>
      <div class="atl-chips">${chips(h.genres)}</div>
      <p dir="auto">${esc(h.overview)}</p>
      <div class="actions">
        <button class="btn primary" data-f data-start data-key="hero|play">${U.icons.play}Play</button>
        <button class="btn" data-f data-key="hero|info">${U.icons.info}Details</button>
      </div>`;
    // TMDB's title art and backdrop, for a provider's title as much as a demo one
    enrich(h).then((m) => {
      if (!m || items[index] !== h) return;
      const h1 = copy.querySelector("h1");
      if (m.logo && h1) { const im = new Image(); im.className = "logo"; im.alt = h.title; im.src = m.logo; im.onload = () => h1.isConnected && h1.replaceWith(im); }
      const bg = hero.querySelector(`.art img[data-i="${index}"]`);
      if (m.backdrop && bg && bg.classList.contains("poster-only")) { bg.src = m.backdrop; bg.classList.remove("poster-only"); }
      if (m.overview && !h.overview) { const p = copy.querySelector("p"); if (p) p.textContent = m.overview; }
      if (m.genres?.length) { const ch = copy.querySelector(".atl-chips"); if (ch) ch.innerHTML = chips(m.genres); const ml = copy.querySelector(".atl-meta"); if (ml) ml.innerHTML = line(m.genres.slice(0, 2).join(" / ")); }
    }).catch(() => {});
    hero.querySelectorAll(".art img, .ambient img").forEach((im) => im.classList.toggle("on", Number(im.dataset.i) === index));
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
  el.innerHTML = `<div class="page" data-page data-anchor="150"><div class="scroller">
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
  const items = await myList.items(source.kind, findOnLine);
  if (!items.length) {
    el.innerHTML = `<div class="page-head"><h1>My List</h1><p>Nothing saved yet</p></div>
      <div class="empty"><p>Press <b>＋</b> on any title to keep it here. It's the fastest way back to something you meant to watch.</p>
      <div class="actions"><button class="btn primary" data-f data-start data-key="ml:movies">Browse movies</button><button class="btn" data-f data-key="ml:series">Browse series</button></div></div>`;
    on("ml:movies", () => tabTo("movies")); on("ml:series", () => tabTo("series"));
    return;
  }
  el.innerHTML = `<div class="page" data-page data-anchor="150"><div class="scroller">
    <section data-section><div class="page-head"><h1>My List</h1><p>${items.length} saved</p></div>
    <div class="grid" data-zone="grid">${items.map((x, i) => P(x, "mylist").replace("<button", i ? "<button" : "<button data-start")).join("")}</div></section></div></div>`;
}

// ============================== Live TV ==============================
let previewHls = null;

async function renderLive(el) {
  el.innerHTML = `<div class="live-page"><h1 class="live-title">Live TV<small>${esc(source.name)}</small></h1>
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
/* A real text box, not a grid of letters on the page: a television already has
   its own keyboard (and a laptop has one under your hands), and a second one
   drawn on the screen only takes the room the results should have. */
const searchState = { query: "", type: () => {} };

async function renderSearch(el) {
  // Atlantic's search: the box and an on-screen keyboard on the left, what it finds on the right
  const KEYS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  el.innerHTML = `<div class="search-page">
    <div class="search-left">
      <label class="query">${U.icons.search}<input type="search" data-f data-key="search:box" placeholder="Search here" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search"></label>
      <div class="kbd" data-zone="kbd">${KEYS.map((k, i) => `<button class="key" data-f ${i === 0 ? "data-start" : ""} data-key="kb:${k}">${k}</button>`).join("")}
        <button class="key wide2" data-f data-key="kb:clear">Clear</button>
        <button class="key space" data-f data-key="kb:space">Space</button>
        <button class="key wide2" data-f data-key="kb:del" aria-label="Delete"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M22 3H7c-.69 0-1.23.35-1.59.88L0 12l5.41 8.11c.36.53.9.89 1.59.89h15a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-3 12.59L17.59 17 14 13.41 10.41 17 9 15.59 12.59 12 9 8.41 10.41 7 14 10.59 17.59 7 19 8.41 15.41 12z"/></svg></button></div>
    </div>
    <div class="results" data-page data-anchor="0"><div class="scroller"><section data-section><div class="head"><div><h2>Popular now</h2><p></p></div></div>
      <div class="grid" data-zone="grid"></div></section></div></div></div>`;
  const box = el.querySelector(".query input"), grid = el.querySelector(".results .grid"), head = el.querySelector(".results .head");
  let timer, seq = 0;
  const suggestions = (await source.home().catch(() => ({ sections: [] }))).sections.find((s) => s.type === "posters")?.items || [];
  const fill = (items, title, line) => {
    head.innerHTML = `<div><h2>${esc(title)}</h2><p>${esc(line)}</p></div>`;
    grid.parentElement.parentElement.parentElement.dataset.y = 0; grid.closest(".scroller").style.transform = "";
    grid.innerHTML = items.length ? items.map((x) => P(x, "search")).join("") : `<div class="empty" style="padding:30px 0"><p>Nothing matches “${esc(searchState.query)}”. Try fewer letters.</p></div>`;
  };
  fill(suggestions.slice(0, 20), "Popular now", "");
  const run = () => {
    searchState.query = box.value.slice(0, 40);
    clearTimeout(timer);
    const mine = ++seq;
    if (!searchState.query.trim()) { fill(suggestions.slice(0, 20), "Popular now", ""); return; }
    timer = setTimeout(async () => {
      const r = await source.search(searchState.query).catch(() => []);
      if (mine !== seq) return;
      fill(r, `Results for “${searchState.query}”`, `${r.length} title${r.length === 1 ? "" : "s"}`);
    }, 260);
  };
  box.addEventListener("input", run);
  // landing on the box is asking to type in it; Escape closes it, OK opens it again
  const open = () => { box.readOnly = false; box.focus(); };
  box.addEventListener("focus", () => { box.readOnly = false; });
  on("search:box", open);
  // OK on the keyboard sends you to what was found
  box.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); const first = grid.querySelector("[data-f]"); if (first) F.focus(first); } });
  searchState.query = "";
  // a letter typed while the remote is down in the results goes into the box
  searchState.type = (ch, { stay = false } = {}) => {
    if (ch === null) box.value = box.value.slice(0, -1);
    else if (ch === "") box.value = "";
    else box.value = (box.value + ch).slice(0, 40);
    if (!stay) open();
    run();
  };
  // the on-screen keyboard types without leaving the keyboard
  for (const k of KEYS) on(`kb:${k}`, () => searchState.type(k.toLowerCase(), { stay: true }));
  on("kb:space", () => searchState.type(" ", { stay: true }));
  on("kb:del", () => searchState.type(null, { stay: true }));
  on("kb:clear", () => searchState.type("", { stay: true }));
  return { cleanup: () => { clearTimeout(timer); searchState.type = () => {}; searchState.query = ""; } };
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
  const credit = [meta?.directors?.length ? `<b>${meta.type === "tv" ? "Creator" : "Director"}:</b> <span class="v">${esc(meta.directors.join(", "))}</span>` : "",
    meta?.cast?.length ? `<b>Starring:</b> <span class="v">${esc(meta.cast.slice(0, 4).map((c) => c.name).join(", "))}</span>` : (provider.cast ? `<b>Starring:</b> <span class="v">${esc(provider.cast)}</span>` : "")].filter(Boolean);

  const facts = [
    t.rating ? `<span><i class="tmdb"><span>TMDB</span></i>${esc(t.rating)}</span>` : "",
    `<span class="scores"></span>`,
    t.year ? `<span>${esc(t.year)}</span>` : "",
    t.runtime ? `<span>${esc(t.runtime)}</span>` : "",
    status ? `<span class="${next ? "soon" : ""}">${esc(status)}</span>` : "",
    onLine ? "" : "<span>Not on your line</span>",
  ].filter(Boolean).join("");
  const info = [
    provider.kind === "series" && provider.seasons?.length ? ["Seasons", provider.seasons.length] : null,
    meta?.released ? ["Release date", meta.released] : t.year ? ["Year", t.year] : null,
    meta?.languages?.length ? ["Language", meta.languages[0]] : null,
    cert ? ["Rating", cert.cert] : null,
    meta?.directors?.length ? [meta.type === "tv" ? "Created by" : "Director", meta.directors.slice(0, 2).join(", ")] : null,
    meta?.cast?.length ? ["Starring", meta.cast.slice(0, 3).map((c) => c.name).join(", ")] : null,
  ].filter(Boolean);
  page.querySelector(".copy").innerHTML = `
    ${meta?.logo ? `<img class="logo" src="${esc(meta.logo)}" alt="${esc(t.title)}">` : `<h1 dir="auto">${esc(t.title)}</h1>`}
    <div class="facts">${facts}</div>
    <div class="actions" data-zone="actions" data-lock="x">
      ${onLine ? `<button class="btn primary" data-f data-start data-key="d:play">${play}</button>` : ""}
      ${resume ? `<button class="btn" data-f data-key="d:restart">Start over</button>` : ""}
      ${onLine ? `<button class="btn icon ${saved ? "on" : ""}" data-f data-key="d:list" aria-label="My List">${saved ? U.icons.check : U.icons.plus}</button>` : ""}
      ${meta?.trailer ? `<button class="btn icon" data-f ${onLine ? "" : "data-start"} data-key="d:trailer" aria-label="Trailer">${U.icons.film}</button>` : ""}
      ${onLine && provider?.source === "xtream" && Tg.signedIn() ? `<button class="btn" data-f data-key="d:together">${U.icons.play}Watch together</button>` : ""}
      ${!onLine && !meta?.trailer ? `<button class="btn" data-f data-start data-key="d:back">${U.icons.back}Back</button>` : ""}
    </div>
    <p class="overview" dir="auto">${esc(t.overview || "No description from the provider.")}</p>
    ${t.genres.length ? `<div class="genres">${t.genres.slice(0, 4).map((g) => `<span>${esc(g)}</span>`).join("")}</div>` : ""}
    ${info.length ? `<dl class="infogrid">${info.map(([k, v]) => `<div data-k="${esc(k)}"><dt>${esc(k)}</dt><dd dir="auto">${esc(v)}</dd></div>`).join("")}</dl>` : ""}`;
  if (meta?.imdbId) scores(meta.imdbId).then((s) => {
    const box = page.querySelector(".scores");
    if (!box) return;
    if (!s?.imdb) return box.remove();
    box.outerHTML = `<span><i class="imdb">IMDb</i>${esc(s.imdb)}</span>`;
  });
  on("d:play", () => resume ? resumePlay(resume) : provider.kind === "series" ? playFirstEpisode(provider) : playItem(provider));
  on("d:restart", () => resume.episode ? playEpisode(provider, resume.episode, 0) : playItem(provider, 0));
  on("d:trailer", () => openTrailer(meta.trailer, t.title));
  on("d:together", () => pickFriendFor(provider));
  on("d:list", (btn) => {
    const added = myList.toggle(provider);
    btn.classList.toggle("on", added); btn.innerHTML = added ? U.icons.check : U.icons.plus;
    toast(added ? `Added to My List` : `Removed from My List`);
  });

  const scroller = page.querySelector(".scroller");
  const cleanups = [];

  // ---- episodes: the line's, dressed in TMDB's names and pictures ----
  if (onLine && provider.kind === "series" && provider.seasons?.length) {
    const first = resume?.episode?.season || provider.seasons[0].number;
    scroller.insertAdjacentHTML("beforeend", `<section class="block" data-section>
      <div class="ep-head"><h2>Seasons</h2>
      <div class="chips-row seasons" data-zone="seasons" data-lock="x" data-track="x" data-prefer=".chip.on"><div class="track">${provider.seasons.map((s) =>
        `<button class="chip ${s.number === first ? "on" : ""}" data-f data-key="season:${s.number}">S${esc(s.number)}</button>`).join("")}</div></div>
      <h2>Episodes</h2></div>
      <div class="ep-list" data-zone="eps" data-track="y" data-lock="y" data-leave="up down" data-pad="24"><div class="track episodes"><div class="loading">Loading episodes…</div></div></div></section>`);
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
        const pct = U.pctOf(progress.forEpisode(ep));
        return `<button class="ep-row episode" data-f data-key="${esc(key)}"><div class="th"><span class="epn">E${ep.number}</span>${ep.still ? `<img src="${esc(ep.still)}" alt="" loading="lazy" data-fallback="${esc(ep.title)}">` : `<div class="fallback"></div>`}
          ${pct ? `<div class="meter"><i style="width:${pct}%"></i></div>` : ""}</div>
          <div class="tx"><b dir="auto">${esc(ep.title)}${ep.runtime && !/^[0:]+$/.test(String(ep.runtime)) ? `<small>${esc(ep.runtime)}</small>` : ""}</b><span dir="auto">${esc(ep.overview || "")}</span></div></button>`;
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


/* My List keeps ids (the old app's); one the old app saved is found in the
   library to draw it. */
const findOnLine = (refs) => (source.find ? source.find(refs) : Promise.resolve([]));
// where to start: a finished record is the watched mark, so it starts over
const startOf = (saved) => (saved && !globalThis.AuroraSync.finished(saved) ? saved.position : 0);

function findResume(item) {
  const mine = progress.recent(item.source || "demo").filter((p) => String(p.item.id) === String(item.id) && p.item.kind === item.kind);
  return mine[0] || null;
}
async function playFirstEpisode(item) {
  const s = item.seasons?.[0]?.number;
  if (!s) return toast("No episodes listed for this series");
  const eps = item.queue?.[s] || await source.episodes(item, s);
  if (eps[0]) playEpisode(item, eps[0]);
}
async function resumePlay(p) {
  if (p.episode) return playEpisode(p.item, p.episode, p.position);
  // a film the old app started has no file type in its record: the library knows it
  const item = p.item.ext ? p.item : (await findOnLine([{ kind: p.item.kind, id: p.item.id }]).catch(() => []))[0] || p.item;
  return playItem(item, p.position);
}

// ============================== Settings ==============================
const THEMES = [
  { id: "ocean", name: "Ocean", sw: ["#050b12", "#0489ac", "#f2f7fa"] },
  { id: "teal", name: "Teal", sw: ["#080a0f", "#14d3a8", "#ffd25a"] },
  { id: "crimson", name: "Crimson", sw: ["#090909", "#e50914", "#ffffff"] },
  { id: "graphite", name: "Graphite", sw: ["#000000", "#ffffff", "#2c2c2e"] },
  { id: "aurora", name: "Aurora", sw: ["#050a0e", "#7df7dc", "#ff5a7a"] },
  { id: "violet", name: "Violet", sw: ["#0a0812", "#bf7bff", "#ff4f8b"] },
];

async function renderSettings(el, params) {
  const pane = params.pane || "look";
  // the website's Settings: a title, a row of tabs with icons, and the section in a card
  const SET_TABS = [["look", "Appearance", "<circle cx=\"13.5\" cy=\"6.5\" r=\"1.5\"/><circle cx=\"17.5\" cy=\"10.5\" r=\"1.5\"/><circle cx=\"8.5\" cy=\"7.5\" r=\"1.5\"/><circle cx=\"6.5\" cy=\"12.5\" r=\"1.5\"/><path d=\"M12 2a10 10 0 0 0 0 20c.9 0 1.6-.7 1.6-1.6 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.7-1.6 1.6-1.6H16a6 6 0 0 0 6-6c0-4.9-4.5-8.6-10-8.6z\"/>"], ["lang", "Language", "<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z\"/>"], ["source", "Source", "<rect x=\"2\" y=\"3\" width=\"20\" height=\"14\" rx=\"2\"/><path d=\"M8 21h8M12 17v4\"/>"], ["together", "Account", "<circle cx=\"12\" cy=\"8\" r=\"4\"/><path d=\"M4 21a8 8 0 0 1 16 0\"/>"], ["keys", "Remote", "<rect x=\"2\" y=\"6\" width=\"20\" height=\"12\" rx=\"2\"/><path d=\"M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8\"/>"], ["about", "About", "<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M12 16v-4M12 8h.01\"/>"]];
  el.innerHTML = `<div class="settings" data-page data-anchor="150"><div class="scroller">
    <section data-section class="set-top"><h1 class="set-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>Settings</h1>
      <div class="set-tabs" data-zone="side" data-lock="x" data-prefer=".cat-item.on">${SET_TABS.map(([id, label, icon]) =>
        `<button class="cat-item ${id === pane ? "on" : ""}" data-f data-key="set:${id}" ${id === pane ? "data-start" : ""}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg><span>${label}</span></button>`).join("")}</div></section>
    <section data-section class="pane"></section><div style="height:120px"></div></div></div>`;
  const paneEl = el.querySelector(".pane");
  const draw = (id) => {
    params.pane = id;
    el.querySelectorAll(".set-tabs .cat-item").forEach((b) => b.classList.toggle("on", b.dataset.key === `set:${id}`));
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
    } else if (id === "together") {
      drawTogether(paneEl, () => params.pane === "together" && draw("together"));
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
  // OK on a section moves into it; a click or a tap just opens it (there is no
  // focus to carry across, and the pane may still show the last section)
  for (const id of ["look", "lang", "source", "together", "keys", "about"]) on(`set:${id}`, () => {
    if (isPhone() || pointerClick) { clearTimeout(dwell); return draw(id); }
    const first = F.focusables(paneEl)[0]; if (first) F.focus(first);
  });
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

// ============================== account, friends, watching together ==============================
/* A small dialog: a heading, a line, and buttons ([label, fn, primary]). */
function ask(title, line, buttons) {
  if (dialog) closeDialog();
  dialog = document.createElement("div");
  dialog.className = "dialog";
  dialog.innerHTML = `<div class="box"><h2>${esc(title)}</h2>${line ? `<p class="note" style="font-size:var(--t-body)">${line}</p>` : ""}
    <div class="actions" style="margin-top:34px;display:flex;flex-wrap:wrap;gap:16px">${buttons.map(([label, , primary], i) => `<button class="btn ${primary ? "primary" : ""}" data-f ${i === 0 ? "data-start" : ""} data-key="ask:${i}">${esc(label)}</button>`).join("")}</div></div>`;
  stage.appendChild(dialog);
  buttons.forEach(([, fn], i) => on(`ask:${i}`, () => { closeDialog(); fn?.(); }));
  F.pushLayer(dialog);
}

function drawTogether(paneEl, redraw) {
  const s = Tg.social;
  const field = (key, label, type = "text", value = "") => `<label class="field"><span>${label}</span><input data-f data-key="${key}" type="${type}" readonly value="${esc(value)}" autocapitalize="off" spellcheck="false"></label>`;
  const typeable = () => {
    for (const inp of paneEl.querySelectorAll("input")) on(inp.dataset.key, () => { inp.readOnly = false; inp.focus(); });
    paneEl.addEventListener("focusout", (e) => { if (e.target.matches("input")) e.target.readOnly = true; });
    paneEl.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("input") && !e.target.readOnly) { e.preventDefault(); e.target.readOnly = true; } });
  };
  const val = (key) => paneEl.querySelector(`[data-key="${key}"]`)?.value || "";
  if (!Tg.signedIn()) {
    paneEl.innerHTML = `<h2>Account &amp; friends</h2><p>Sign in with your Aurora account to add friends and watch together. It is the same account as the Aurora app on a Mac, an iPhone or the TV.</p>
      <div data-zone="acct">${field("acct:email", "Email", "email")}${field("acct:pass", "Password", "password")}
      <div class="actions" style="display:flex;flex-wrap:wrap;gap:16px"><button class="btn primary" data-f data-key="acct:in">Sign in</button><button class="btn" data-f data-key="acct:new">Create account</button></div>
      <div class="error" ${s.error ? "" : "hidden"}>${esc(s.error)}</div>${s.notice ? `<p class="note">${esc(s.notice)}</p>` : ""}</div>`;
    typeable();
    const go = (create) => async () => {
      s.error = ""; s.notice = "";
      try { const r = await Tg.signIn(val("acct:email").trim(), val("acct:pass"), { create }); if (r.confirm) s.notice = "Check your email for a confirmation link, then sign in here."; else toast(`Signed in as ${Tg.email()}`); }
      catch (e) { s.error = e.message; }
      redraw();
    };
    on("acct:in", go(false)); on("acct:new", go(true));
    return;
  }
  const me = s.profile || {};
  const answer = s.friends.filter((f) => f.status === "pending" && !f.i_asked);
  const asked = s.friends.filter((f) => f.status === "pending" && f.i_asked);
  const friends = Tg.accepted();
  const row = (f, buttons) => `<div class="toggle" style="cursor:default"><span>${esc(f.display_name || "Someone")}<small>${esc(f.friend_code || "")}</small></span><span style="display:flex;gap:12px">${buttons}</span></div>`;
  paneEl.innerHTML = `<h2>Account &amp; friends</h2>
    <p>Signed in as <b>${esc(Tg.email())}</b>. Your name is <b>${esc(me.display_name || "…")}</b> and your friend code is <b style="font-family:var(--mono);letter-spacing:.08em">${esc(me.friend_code || "…")}</b>. Give the code to someone and they can add you.</p>
    <div data-zone="party-code">${field("pc:code", "Join a party with its code")}<div class="actions" style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:34px"><button class="btn primary" data-f data-key="pc:join">Join party</button></div></div>
    <div data-zone="add">${field("fr:code", "Add a friend by their code")}<div class="actions" style="display:flex;gap:16px;flex-wrap:wrap"><button class="btn primary" data-f data-key="fr:add">Send request</button><button class="btn" data-f data-key="acct:out">Sign out</button></div>
    <div class="error" ${s.error ? "" : "hidden"}>${esc(s.error)}</div>${s.notice ? `<p class="note">${esc(s.notice)}</p>` : ""}</div>
    ${answer.length ? `<h2 style="margin-top:40px">Wants to be your friend</h2><div data-zone="answer">${answer.map((f) => row(f, `<button class="btn primary" data-f data-key="fr:ok:${f.user_id}">Accept</button><button class="btn" data-f data-key="fr:no:${f.user_id}">Decline</button>`)).join("")}</div>` : ""}
    <h2 style="margin-top:40px">Friends</h2>
    <div data-zone="friends">${friends.length ? friends.map((f) => row(f, `<button class="btn" data-f data-key="fr:rm:${f.user_id}">Remove</button>`)).join("") : `<p class="note">No friends yet. Send someone your code.</p>`}</div>
    ${asked.length ? `<p class="note">Waiting on ${asked.map((f) => esc(f.display_name)).join(", ")}.</p>` : ""}
    <p class="note">To watch together, open a film or series and choose Watch together. Each of you plays your own copy; Aurora keeps you in step.</p>`;
  typeable();
  on("fr:add", async () => { await Tg.addFriendByCode(val("fr:code")); redraw(); });
  on("pc:join", () => joinWithCode(val("pc:code")));
  on("acct:out", async () => { await Tg.signOut(); toast("Signed out"); redraw(); });
  for (const f of answer) { on(`fr:ok:${f.user_id}`, async () => { await Tg.acceptFriend(f.user_id); redraw(); }); on(`fr:no:${f.user_id}`, async () => { await Tg.removeFriend(f.user_id); redraw(); }); }
  for (const f of friends) on(`fr:rm:${f.user_id}`, () => ask(`Remove ${f.display_name}?`, "You can add each other again with your codes.", [["Remove", async () => { await Tg.removeFriend(f.user_id); redraw(); }, true], ["Cancel"]]));
}

/* Host: pick a friend, invite them, start playing. */
/* Host: invite a friend, or start with a code anyone can join by. From a
   title page it then plays; from the player (`playing`) it keeps playing and
   the film already on screen becomes the party's clock. */
function pickFriendFor(item, { playing = null } = {}) {
  if (!Tg.signedIn()) return toast("Sign in first, in Settings → Account & friends");
  const start = async (f) => {
    if (!(await Tg.startParty(item, f?.user_id || null))) return toast(Tg.social.error || "Could not start the party");
    const code = Tg.party.code ? ` · code ${Tg.party.code}` : "";
    toast(f ? `Invited ${f.display_name}${code}` : Tg.party.code ? `Party code ${Tg.party.code} — they type it in Aurora` : "Party started");
    if (playing) return playing();
    if (item.kind === "series") return findResume(item) ? resumePlay(findResume(item)) : playFirstEpisode(item);
    playItem(item);
  };
  ask("Watch together", `Each of you plays your own copy of <b>${esc(item.title)}</b>; Aurora keeps you in step. Invite a friend, or start with a code to read out.`,
    [...Tg.accepted().map((f, i) => [f.display_name || "Friend", () => start(f), i === 0]), ["Start with a code", () => start(null), !Tg.accepted().length], ["Cancel"]]);
}

/* Guest: a code read out by the host, typed on this device. */
async function joinWithCode(code) {
  if (!source.titles) return toast("Connect your line first, in Settings → Source");
  toast("Finding it on your line…");
  const r = await Tg.joinByCode(code, await source.titles());
  if (r.error) return toast(r.error);
  if (r.item.kind === "series") { const res = findResume(r.item); return res ? resumePlay(res) : playFirstEpisode(r.item); }
  playItem(r.item);
}

/* The menu's profile, Atlantic's way: initials in a circle and a name */
function paintFace() {
  const name = Tg.social.profile?.display_name || (Tg.signedIn() ? Tg.email().split("@")[0] : "Guest");
  const face = document.querySelector(".round.face");
  if (!face) return;
  face.querySelector(".av").textContent = name.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "G";
  face.querySelector(".name").textContent = name;
}
Tg.onChange(paintFace); paintFace();

/* Guest: an invitation, from a friend's Aurora (this app or the old one). */
let offered = null;
Tg.onChange(() => {
  const inv = Tg.pendingInvite();
  if (!inv || offered === inv.party || player) return;
  offered = inv.party;
  ask(`${inv.from || "A friend"} wants to watch`, `<b>${esc(inv.title || "something")}</b> together. You will play your own copy, kept in step with theirs.`, [
    ["Watch together", async () => {
      if (!source.titles) return toast("Connect your line first, in Settings → Source");
      toast("Finding it on your line…");
      const r = await Tg.joinParty(inv.party, await source.titles());
      if (r.error) return toast(r.error);
      if (r.item.kind === "series") { const res = findResume(r.item); return res ? resumePlay(res) : playFirstEpisode(r.item); }
      playItem(r.item);
    }, true],
    ["Not now", () => Tg.dismissInvite()],
  ]);
});
Tg.start().catch(() => {});

// ============================== playing ==============================
let hlsLoading = null;
const loadHls = () => (window.Hls ? Promise.resolve(window.Hls) : (hlsLoading = hlsLoading || new Promise((res, rej) => {
  const s = document.createElement("script"); s.src = "vendor/hls.js"; s.onload = () => res(window.Hls); s.onerror = rej; document.head.appendChild(s);
})));

async function attach(video, stream, { muted = false, startAt = 0 } = {}) {
  video.muted = muted;
  // on the web site, through its relay (the provider is plain http)
  stream = { ...stream, url: Plat.playable(stream.url) };
  // Safari (an iPhone, a Mac) plays HLS itself; elsewhere hls.js does
  const systemHls = Plat.cloud && !!video.canPlayType("application/vnd.apple.mpegurl");
  if (stream.hls && !systemHls) {
    const Hls = await loadHls();
    if (Hls?.isSupported()) {
      const hls = new Hls({
        enableWorker: true, lowLatencyMode: false, startPosition: startAt || -1,
        ...(stream.proxied && !Plat.native && !Plat.cloud ? { xhrSetup: (xhr, url) => xhr.open("GET", Plat.streamUrl(url), true) } : {}),
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
const PL = {"back": "<svg viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20z\"/></svg>", "mark": "<svg viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M17 3H7a2 2 0 0 0-2 2v16l7-3 7 3V5a2 2 0 0 0-2-2zm0 15-5-2.18L7 18V5h10z\"/></svg>", "marked": "<svg viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M17 3H7a2 2 0 0 0-2 2v16l7-3 7 3V5a2 2 0 0 0-2-2z\"/></svg>", "vol": "<svg viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M3 9v6h4l5 5V4L7 9zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z\"/></svg>", "eps": "<svg viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M4 6H2v14a2 2 0 0 0 2 2h14v-2H4zm16-4H8a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm0 14H8V4h12z\"/></svg>", "next": "<svg viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z\"/></svg>", "cc": "<svg viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M19 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1zm7 0h-1.5v-.5h-2v3h2V13H18v1a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1z\"/></svg>", "tune": "<svg viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M3 17v2h6v-2zM3 5v2h10V5zm10 16v-2h8v-2h-8v-2h-2v6zM7 9v2H3v2h4v2h2V9zm14 4v-2H11v2zm-6-4h2V7h4V5h-4V3h-2z\"/></svg>", "people": "<svg viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z\"/></svg>", "chev": "<svg viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z\"/></svg>", "check": "<svg viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z\"/></svg>"};

function playItem(item, startAt) {
  openPlayer({ item, startAt: startAt ?? startOf(progress.forItem(item)) });
}
function playEpisode(item, ep, startAt) {
  openPlayer({ item, episode: ep, startAt: startAt ?? startOf(progress.forEpisode(ep)) });
}
function playChannel(ch, list) { openPlayer({ item: ch, live: true, channels: list?.length ? list : [ch] }); }

function openPlayer(opts) {
  if (player) player.close(true);
  previewHls?.destroy?.(); previewHls = null;
  const el = document.createElement("div");
  el.className = "player show";
  el.setAttribute("data-keys-own", "");
  /* Atlantic's player: a top bar, a play button in the middle, a hairline
     timeline across the bottom and a row of icons under it; its menus open
     as a panel on the right (see the panel code below) */
  el.innerHTML = `<video playsinline></video><div class="spinner"></div>
    <div class="flash l"></div><div class="flash r"></div><div class="flash c"></div>
    <div class="chrome">
      <div class="pl-top" data-zone="pl-top" data-lock="x">
        <button class="pl-ico" data-f data-key="pl:close" aria-label="Back">${PL.back}</button>
        <div class="ttl"><b></b><small></small></div>
        <button class="pl-ico" data-f data-key="pl:list" aria-label="My List">${PL.mark}</button>
      </div>
      <button class="pl-big" data-f data-start data-key="pl:toggle" aria-label="Play or pause">${U.icons.pause}</button>
      <div class="timeline"><div class="bar2"><div class="buf"></div><div class="pos"></div><div class="knob"></div></div></div>
      <div class="pl-bottom controls" data-zone="controls" data-lock="x">
        <span class="pl-vol">${PL.vol}</span><span class="pl-time"><span class="cur">0:00</span><span class="dur"></span></span>
        <span class="grow"></span>
        <button class="pl-ico pl-text" data-f data-key="pl:eps" hidden>${PL.eps}<span>Episodes</span></button>
        <button class="pl-ico" data-f data-key="pl:next" aria-label="Next episode" hidden>${PL.next}</button>
        <button class="pl-ico" data-f data-key="pl:subs" aria-label="Subtitles">${PL.cc}</button>
        <button class="pl-ico" data-f data-key="pl:settings" aria-label="Settings">${PL.tune}</button>
      </div></div>`;
  stage.appendChild(el);
  const video = el.querySelector("video");
  const P0 = { ...opts, chIndex: opts.channels ? Math.max(0, opts.channels.findIndex((c) => c.id === opts.item.id)) : 0 };
  let handle = null, hideTimer = null, saveTimer = null, closed = false, upNext = null;

  const label = () => {
    const { item, episode, live } = P0;
    el.querySelector(".ttl b").textContent = item.title;
    el.querySelector(".ttl small").textContent = live ? `Live · ${item.category || "Channel"}` : episode ? `S${episode.season} · E${episode.number}` : [item.year, U.kindLabel(item)].filter(Boolean).join(" · ");
    el.querySelector(".timeline").style.visibility = live ? "hidden" : "";
    el.querySelector(".pl-time").style.visibility = live ? "hidden" : "";
    el.querySelector('[data-key="pl:next"]').hidden = !nextEpisode();
    el.querySelector('[data-key="pl:eps"]').hidden = !(episode && item.seasons?.length);
    const listBtn = el.querySelector('[data-key="pl:list"]');
    listBtn.hidden = !!live; listBtn.innerHTML = myList.has(item) ? PL.marked : PL.mark;
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
    el.querySelector(".dur").textContent = d && isFinite(d) ? ` / ${fmt(d)}` : "";
    el.querySelector('[data-key="pl:toggle"]').innerHTML = video.paused ? U.icons.play : U.icons.pause;
    el.classList.toggle("paused", video.paused);
  };
  video.addEventListener("timeupdate", paint);
  video.addEventListener("play", paint); video.addEventListener("pause", paint);
  video.addEventListener("pause", () => save(true));
  video.addEventListener("ended", () => { save(true); const n = nextEpisode(); if (n) offerNext(n); else showChrome(); });

  /* In the old app's record shape, at most once every 5 s while playing (the
     store throttles), and at once on pause, the end and leaving. */
  function save(force = false) {
    if (P0.live || !video.duration || !isFinite(video.duration)) return;
    progress.save(P0.item, P0.episode || null, video.currentTime, video.duration, { next: P0.episode ? nextEpisode() : null, force });
  }
  saveTimer = setInterval(save, 5000);
  if (P0.live) progress.played(P0.item);
  // on a phone the system's own controls do the work: scrubbing, fullscreen, AirPlay
  if (isPhone()) { video.controls = true; el.classList.add("touch"); }
  // watching together: the host's clock goes out, the guest follows it
  let unparty = Tg.attachPlayer(video);
  let partyEl = null;
  const paintParty = () => {
    if (!Tg.party.id) { partyEl?.remove(); partyEl = null; return; }
    if (!partyEl) {
      partyEl = document.createElement("div");
      partyEl.className = "party-strip";
      partyEl.innerHTML = `<span></span>${Tg.party.hosting ? "" : '<button class="btn" data-f data-key="pt:back">−5s</button><button class="btn" data-f data-key="pt:fwd">+5s</button>'}<button class="btn" data-f data-key="pt:leave">${Tg.party.hosting ? "End" : "Leave"}</button>`;
      el.appendChild(partyEl);
    }
    partyEl.querySelector("span").textContent = Tg.partyLine();
  };
  // Watch together from the player: films and series on a line, when signed in and not in a party
  const canParty = () => !(P0.live || !Tg.signedIn() || Tg.party.id || P0.item.source !== "xtream");
  const paintPartyBtn = () => {};
  on("pl:party", () => pickFriendFor(P0.item, { playing: () => { unparty(); unparty = Tg.attachPlayer(video); paintParty(); paintPartyBtn(); showChrome(); } }));
  const stopPaint = Tg.onChange(() => { paintParty(); paintPartyBtn?.(); }); paintParty();
  on("pt:back", () => Tg.nudgeParty(-5)); on("pt:fwd", () => Tg.nudgeParty(5));
  on("pt:leave", () => { Tg.leaveParty(); toast("Left the party"); });

  /* ---- the panel on the right: Episodes, Subtitles, Settings ---- */
  let panel = null;
  const closePanel = () => { if (!panel) return; const p = panel; panel = null; F.popLayer(p); p.remove(); showChrome(); };
  function openPanel(title, rows, { grid = "", parent = false } = {}) {
    closePanel();
    panel = document.createElement("div");
    panel.className = "pl-panel";
    if (parent) panel.dataset.parent = "1";
    panel.innerHTML = `${title ? `<div class="pp-head"><button class="pp-back" data-f data-key="pp:back" aria-label="Back">${PL.back}</button><b>${esc(title)}</b></div>` : ""}
      ${grid}<div class="pp-list" data-zone="pp" data-track="y" data-lock="y" data-pad="24"><div class="track">${rows.map((r, i) => {
        const key = `pp:${i}`; on(key, () => r.run?.());
        return `<button class="pp-row ${r.on ? "on" : ""}" data-f data-key="${key}"><span class="pp-l"><b dir="auto">${esc(r.label)}</b>${r.sub ? `<small>${esc(r.sub)}</small>` : ""}</span>${r.value ? `<span class="pp-v">${esc(r.value)}</span>` : ""}${r.toggle !== undefined ? `<i class="sw ${r.toggle ? "on" : ""}"></i>` : ""}${r.on ? `<i class="pp-check">${PL.check}</i>` : r.more ? `<i class="pp-more">${PL.chev}</i>` : r.icon ? `<i class="pp-more">${r.icon}</i>` : ""}</button>`;
      }).join("")}</div></div>`;
    el.appendChild(panel);
    on("pp:back", () => (panel?.dataset.parent ? openSettings() : closePanel()));
    F.pushLayer(panel);
    F.focus(panel.querySelector(".pp-row.on") || panel.querySelector(".pp-row") || panel.querySelector("[data-f]"));
    showChrome();
  }
  const hlsOf = () => (handle && handle.levels ? handle : null);
  function openEpisodes(season = P0.episode?.season) {
    const eps = P0.item.queue?.[season] || [];
    const seasons = P0.item.seasons || [];
    const rows = [
      ...seasons.map((s) => ({ label: s.name || `Season ${s.number}`, sub: s.number === season ? `${eps.length} episodes` : "", on: s.number === season, run: () => loadSeason(s.number) })),
      ...eps.map((ep) => ({ label: `E${ep.number} · ${ep.title}`, sub: ep.overview ? ep.overview.slice(0, 80) : "", on: ep.id === P0.episode?.id && false, run: () => { closePanel(); P0.episode = ep; start(startOf(progress.forEpisode(ep))); } })),
    ];
    openPanel("Episodes", rows);
  }
  async function loadSeason(n) {
    if (!P0.item.queue?.[n]) { try { P0.item.queue = P0.item.queue || {}; P0.item.queue[n] = await source.episodes(P0.item, n); } catch { return toast("Could not load that season"); } }
    openEpisodes(n);
  }
  function openSubs() {
    const h = hlsOf();
    const hlsSubs = h?.subtitleTracks || [];
    const native = [...(video.textTracks || [])].filter((t) => t.kind === "subtitles" || t.kind === "captions");
    const rows = [{ label: "Off", on: h ? h.subtitleTrack === -1 : native.every((t) => t.mode !== "showing"), run: () => { if (h) h.subtitleTrack = -1; native.forEach((t) => { t.mode = "disabled"; }); closePanel(); } }];
    if (h) hlsSubs.forEach((t, i) => rows.push({ label: t.name || t.lang || `Track ${i + 1}`, on: h.subtitleTrack === i, run: () => { h.subtitleTrack = i; h.subtitleDisplay = true; closePanel(); } }));
    else native.forEach((t, i) => rows.push({ label: t.label || t.language || `Track ${i + 1}`, on: t.mode === "showing", run: () => { native.forEach((x, j) => { x.mode = j === i ? "showing" : "disabled"; }); closePanel(); } }));
    if (rows.length === 1) rows.push({ label: "This stream has no subtitles", sub: "Your line sends none for it" });
    openPanel("Subtitles", rows);
  }
  const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
  const FITS = [["contain", "Fit"], ["cover", "Fill"], ["fill", "Stretch"]];
  function openSettings() {
    const h = hlsOf();
    const lv = h?.levels || [];
    const quality = !h || h.currentLevel === -1 || h.autoLevelEnabled ? "Auto" : lv[h.currentLevel]?.height ? `${lv[h.currentLevel].height}p` : "Auto";
    const audios = h?.audioTracks || [];
    const tile = (k, label, value) => `<button class="pp-tile" data-f data-key="${k}"><b>${label}</b><small>${esc(value)}</small></button>`;
    const fit = FITS.find(([f]) => f === (video.style.objectFit || "contain"))[1];
    on("pt:quality", () => openPanel("Quality", [{ label: "Auto", on: quality === "Auto", run: () => { h.currentLevel = -1; openSettings(); } },
      ...lv.map((l, i) => ({ label: l.height ? `${l.height}p` : `Level ${i + 1}`, sub: l.bitrate ? `${(l.bitrate / 1e6).toFixed(1)} Mb/s` : "", on: h.currentLevel === i && !h.autoLevelEnabled, run: () => { h.currentLevel = i; openSettings(); } }))], { parent: true }));
    on("pt:audio", () => openPanel("Audio", audios.length ? audios.map((a, i) => ({ label: a.name || a.lang || `Track ${i + 1}`, on: h.audioTrack === i, run: () => { h.audioTrack = i; openSettings(); } })) : [{ label: "One audio track in this stream" }], { parent: true }));
    on("pt:subs", openSubs);
    on("pt:fit", () => { const i = (FITS.findIndex(([f]) => f === (video.style.objectFit || "contain")) + 1) % FITS.length; video.style.objectFit = FITS[i][0]; openSettings(); });
    const grid = `<div class="pp-grid" data-zone="pp-grid">${tile("pt:quality", "Quality", h && lv.length > 1 ? quality : "Auto")}${tile("pt:audio", "Audio", audios[h?.audioTrack]?.name || "Default")}${tile("pt:subs", "Subtitles", h?.subtitleTracks?.[h.subtitleTrack]?.name || "Off")}${tile("pt:fit", "Video mode", fit)}</div>`;
    openPanel("", [
      ...(canParty() ? [{ label: "Watch Party", icon: PL.people, run: () => { closePanel(); pickFriendFor(P0.item, { playing: () => { unparty(); unparty = Tg.attachPlayer(video); paintParty(); showChrome(); } }); } }] : []),
      { label: "Playback speed", value: `${video.playbackRate.toFixed(2)}x`, run: () => { const i = (SPEEDS.indexOf(video.playbackRate) + 1) % SPEEDS.length; video.playbackRate = SPEEDS[i === -1 ? 1 : i]; openSettings(); } },
      ...(nextEpisode() ? [{ label: "Next episode", more: true, run: () => { closePanel(); goNext(); } }] : []),
    ], { grid });
  }
  on("pl:eps", () => openEpisodes());
  on("pl:subs", openSubs);
  on("pl:settings", openSettings);
  on("pl:list", (btn) => { const added = myList.toggle(P0.item); btn.innerHTML = added ? PL.marked : PL.mark; toast(added ? "Added to My List" : "Removed from My List"); });

  function showChrome() {
    el.classList.add("show");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (!video.paused && !upNext && !panel) el.classList.remove("show"); }, 4000);
  }
  const chromeShown = () => el.classList.contains("show");
  const flash = (side, html) => { const f = el.querySelector(`.flash.${side}`); f.innerHTML = html; f.classList.add("on"); setTimeout(() => f.classList.remove("on"), 450); };
  const seek = (d) => { if (P0.live) return; video.currentTime = Math.max(0, Math.min((video.duration || 0) - 1, video.currentTime + d)); flash(d < 0 ? "l" : "r", `<div>${d < 0 ? U.icons.back10 : U.icons.fwd10}<div>${Math.abs(d)} s</div></div>`); };
  const toggle = () => { if (video.paused) video.play().catch(() => {}); else video.pause(); flash("c", video.paused ? U.icons.pause : U.icons.play); showChrome(); };
  const zap = (d) => {
    if (!P0.channels || P0.channels.length < 2) return;
    P0.chIndex = (P0.chIndex + d + P0.channels.length) % P0.channels.length;
    P0.item = P0.channels[P0.chIndex];
    progress.played(P0.item);
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
  function goNext() { const n = nextEpisode(); if (!n) return; P0.episode = n; start(startOf(progress.forEpisode(n))); F.focusStart(); }

  // the player keeps the arrows for itself while its controls are hidden
  el.addEventListener("own:key", (e) => {
    const k = e.detail;
    if (panel) return; // a menu is open: the arrows move in it
    // channel up and down always change channel, controls showing or not: a
    // channel that will not play must be one press from the next one
    if (P0.live && (k === "ArrowUp" || k === "ArrowDown")) { e.preventDefault(); zap(k === "ArrowUp" ? -1 : 1); return; }
    if (chromeShown()) { showChrome(); return; }
    e.preventDefault();
    if (P0.live) { showChrome(); return; }
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
  on("pl:next", goNext);
  on("pl:upnext", goNext);
  on("pl:close", () => api.close());

  const api = {
    back() {
      if (panel) { closePanel(); return; }
      if (upNext) { upNext.remove(); upNext = null; F.focusStart(); return; }
      if (chromeShown() && !video.paused) { el.classList.remove("show"); return; }
      api.close();
    },
    close(silent) {
      if (closed) return; closed = true;
      save(true);
      closePanel(); unparty(); stopPaint();
      if (Tg.party.id && Tg.party.hosting) Tg.leaveParty();
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
