/* global Hls */
const $ = (selector) => document.querySelector(selector);
const LIBRARY_SCHEMA = 2;
const state = {
  provider: null, items: [], view: "home", query: "", category: "All", limit: 120,
  favorites: new Set(JSON.parse(localStorage.getItem("aurora-favorites") || "[]")),
  progress: new Map(Object.entries(JSON.parse(localStorage.getItem("aurora-progress") || "{}"))),
  playerItem: null, playing: null, hls: null, queue: null,
  seriesItem: null, seriesData: null, selectedSeason: null, detailItem: null, detailData: null,
};
const views = { home: "Home", live: "Live TV", movies: "Movies", series: "Series", favorites: "Favorites", history: "History" };

const cleanServer = (value) => { const clean = value.trim().replace(/\/$/, ""); return /^https?:\/\//i.test(clean) ? clean : `http://${clean}` };
const relay = (url) => `/proxy?src=${encodeURIComponent(url)}`;
const escapeHtml = (value = "") => String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
const rating = (value) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n.toFixed(1) : "" };
const clock = (value) => {
  const total = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60), seconds = total % 60;
  return hours ? `${hours}h ${String(minutes).padStart(2, "0")}m` : `${minutes}:${String(seconds).padStart(2, "0")}`;
};
const credentials = () => ({ server: state.provider.server, user: encodeURIComponent(state.provider.username), pass: encodeURIComponent(state.provider.password) });
const apiUrl = (action = "", extra = "") => { const { server, user, pass } = credentials(); return `${server}/player_api.php?username=${user}&password=${pass}${action ? `&action=${action}` : ""}${extra}` };

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("aurora-mac", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("library");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveLibrary(items) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction("library", "readwrite");
    transaction.objectStore("library").put(items, "items");
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
  localStorage.setItem("aurora-library-schema", String(LIBRARY_SCHEMA));
}

async function loadLibrary() {
  const db = await openDb();
  const items = await new Promise((resolve, reject) => {
    const request = db.transaction("library", "readonly").objectStore("library").get("items");
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return items;
}

function showToast(message) {
  const toast = $("#toast"); toast.textContent = message; toast.classList.add("show");
  clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove("show"), 4500);
}

function setLoading(show, title = "Connecting", detail = "Checking your account…") {
  $("#loading").classList.toggle("hidden", !show); $("#loading-title").textContent = title; $("#loading-detail").textContent = detail;
}

async function fetchJson(url) {
  const response = await fetch(relay(url));
  const text = await response.text();
  if (!response.ok) { try { throw new Error(JSON.parse(text).error || `Provider returned ${response.status}`) } catch (error) { if (error instanceof SyntaxError) throw new Error(`Provider returned ${response.status}`); throw error } }
  if (text.trim() === "FORCED_COUNTRY") throw new Error("This account is locked to another country");
  try { return JSON.parse(text) } catch { throw new Error(text.trim() || "The provider returned an invalid response") }
}

function categoryMap(categories) {
  const map = new Map(); for (const item of categories || []) map.set(String(item.category_id), item.category_name); return map;
}

/* ---------- watch progress ---------- */

function persistProgress() {
  const entries = [...state.progress.entries()].sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, 400);
  state.progress = new Map(entries);
  localStorage.setItem("aurora-progress", JSON.stringify(Object.fromEntries(entries)));
}

function saveProgress(patch) {
  if (!patch?.key) return;
  const merged = { ...(state.progress.get(patch.key) || {}), ...patch, updatedAt: Date.now() };
  state.progress.set(patch.key, merged); persistProgress();
}

const progressOf = (key) => state.progress.get(key) || null;
const finished = (record) => Boolean(record && record.duration > 0 && record.position >= record.duration * 0.95);
const percent = (record) => (record && record.duration > 0 ? Math.min(100, (record.position / record.duration) * 100) : 0);
const continueWatching = () => [...state.progress.values()].filter((r) => r.type !== "live" && r.position > 20 && !finished(r)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20);
const watchHistory = () => [...state.progress.values()].sort((a, b) => b.updatedAt - a.updatedAt);

/* ---------- library ---------- */

async function loadEverything() {
  setLoading(true, "Loading live TV", "Downloading channels and categories…");
  const [liveCategories, live] = await Promise.all([fetchJson(apiUrl("get_live_categories")), fetchJson(apiUrl("get_live_streams"))]);
  const liveMap = categoryMap(liveCategories);
  const items = live.map((x) => ({ id: `live-${x.stream_id}`, type: "live", streamId: Number(x.stream_id), name: x.name, category: liveMap.get(String(x.category_id)) || "Uncategorized", logo: x.stream_icon || "", ext: "m3u8", added: Number(x.added) || 0 }));

  setLoading(true, "Loading movies", `${items.length.toLocaleString()} live channels ready…`);
  const [movieCategories, movies] = await Promise.all([fetchJson(apiUrl("get_vod_categories")), fetchJson(apiUrl("get_vod_streams"))]);
  const movieMap = categoryMap(movieCategories);
  for (const x of movies) items.push({ id: `movie-${x.stream_id}`, type: "movie", streamId: Number(x.stream_id), name: x.name, category: movieMap.get(String(x.category_id)) || "Uncategorized", logo: x.stream_icon || "", ext: x.container_extension || "mp4", rating: rating(x.rating), year: x.year || String(x.releaseDate || "").slice(0, 4), duration: x.duration || "", added: Number(x.added) || 0 });

  setLoading(true, "Loading series", `${items.length.toLocaleString()} channels and movies ready…`);
  const [seriesCategories, series] = await Promise.all([fetchJson(apiUrl("get_series_categories")), fetchJson(apiUrl("get_series"))]);
  const seriesMap = categoryMap(seriesCategories);
  for (const x of series) items.push({ id: `series-${x.series_id}`, type: "series", streamId: Number(x.series_id), name: x.name, category: seriesMap.get(String(x.category_id)) || "Uncategorized", logo: x.cover || "", backdrop: Array.isArray(x.backdrop_path) ? x.backdrop_path[0] || "" : "", rating: rating(x.rating), year: String(x.releaseDate || "").slice(0, 4), description: x.plot || "", added: Number(x.last_modified) || 0 });
  return items;
}

async function connectProvider(event) {
  event.preventDefault(); $("#form-error").classList.add("hidden");
  const provider = { name: $("#provider-name").value.trim() || "My IPTV", server: cleanServer($("#server").value), username: $("#username").value.trim(), password: $("#password").value };
  const previous = state.provider;
  try {
    setLoading(true, "Connecting", "Checking the Xtream account from your Mac…");
    state.provider = provider;
    const auth = await fetchJson(apiUrl());
    if (Number(auth?.user_info?.auth) !== 1 || auth?.user_info?.status !== "Active") throw new Error("The provider rejected this login or the account is inactive");
    const items = await loadEverything();
    setLoading(true, "Saving your library", `${items.length.toLocaleString()} total items loaded…`);
    await saveLibrary(items);
    state.items = items; state.view = "home"; state.category = "All"; state.limit = 120;
    localStorage.setItem("aurora-provider", JSON.stringify(provider));
    closeModal("source-modal"); render();
    showToast(`${items.length.toLocaleString()} items loaded successfully`);
  } catch (error) {
    state.provider = previous;
    const box = $("#form-error"); box.textContent = error.message || "Could not connect"; box.classList.remove("hidden");
    $("#source-modal").classList.remove("hidden");
  } finally { setLoading(false) }
}

async function refreshLibrary(quiet = false) {
  if (!state.provider || refreshLibrary.busy) return;
  refreshLibrary.busy = true;
  try {
    if (!quiet) setLoading(true, "Refreshing library", "Asking your provider for the latest content…");
    const items = await loadEverything();
    await saveLibrary(items);
    state.items = items; render();
    showToast(`Library refreshed • ${items.length.toLocaleString()} items`);
  } catch (error) { showToast(error.message || "Could not refresh the library") }
  finally { refreshLibrary.busy = false; setLoading(false) }
}

function updateSource() {
  $("#source-name").textContent = state.provider?.name || "No source";
  $("#source-status").textContent = state.provider ? `${state.items.length.toLocaleString()} items • Local` : "Not connected";
  const count = state.favorites.size, badge = $("#favorite-count");
  badge.textContent = count; badge.style.display = count ? "grid" : "none";
}

function itemsForView(ignoreCategory = false) {
  let result = state.items;
  if (state.view === "live") result = result.filter((item) => item.type === "live");
  if (state.view === "movies") result = result.filter((item) => item.type === "movie");
  if (state.view === "series") result = result.filter((item) => item.type === "series");
  if (state.view === "favorites") result = result.filter((item) => state.favorites.has(item.id));
  if (!ignoreCategory && state.category !== "All") result = result.filter((item) => item.category === state.category);
  if (state.query) { const query = state.query.toLowerCase(); result = result.filter((item) => `${item.name} ${item.category}`.toLowerCase().includes(query)) }
  return result;
}

/* ---------- cards and shelves ---------- */

const glyph = (type) => (type === "live" ? "◉" : type === "movie" ? "▰" : "▦");

function card(item, wide = false) {
  const art = item.logo || item.backdrop;
  const bar = item.type === "movie" ? percent(progressOf(item.id)) : 0;
  const opens = item.type === "live" ? "play-item" : "open-detail";
  return `<article class="card ${wide ? "wide" : ""}" data-id="${escapeHtml(item.id)}"><div class="art ${opens}">${art ? `<img loading="lazy" src="${escapeHtml(art)}" onerror="this.style.display='none'">` : ""}<div class="fallback">${glyph(item.type)}</div>${item.type === "live" ? '<span class="live">Live</span>' : ""}${item.rating ? `<span class="score">★ ${escapeHtml(item.rating)}</span>` : ""}<span class="play-bubble">▶</span>${bar > 1 ? `<span class="resume-bar"><i style="width:${bar.toFixed(1)}%"></i></span>` : ""}</div><div class="card-copy"><div><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml([item.year, item.category].filter(Boolean).join(" • ") || item.type)}</p></div><button class="heart ${state.favorites.has(item.id) ? "saved" : ""}">${state.favorites.has(item.id) ? "♥" : "♡"}</button></div></article>`;
}

function resumeCard(record) {
  const bar = percent(record), left = record.duration > record.position ? `${clock(record.duration - record.position)} left` : "Ready";
  return `<article class="card wide" data-resume="${escapeHtml(record.key)}"><div class="art play-resume">${record.poster ? `<img loading="lazy" src="${escapeHtml(record.poster)}" onerror="this.style.display='none'">` : ""}<div class="fallback">${glyph(record.type === "episode" ? "series" : record.type)}</div><span class="play-bubble">▶</span><span class="resume-bar"><i style="width:${bar.toFixed(1)}%"></i></span></div><div class="card-copy"><div><h3>${escapeHtml(record.title)}</h3><p>${escapeHtml([record.subtitle, left].filter(Boolean).join(" • "))}</p></div><button class="forget" title="Remove from Continue watching">×</button></div></article>`;
}

function rail(scroller) {
  return `<div class="rail"><button class="rail-nav prev" aria-label="Scroll left" disabled>‹</button>${scroller}<button class="rail-nav next" aria-label="Scroll right" disabled>›</button></div>`;
}

function updateRails() {
  for (const box of document.querySelectorAll(".rail")) {
    const scroller = box.querySelector(".rail-scroller");
    if (!scroller) continue;
    const max = scroller.scrollWidth - scroller.clientWidth;
    box.classList.toggle("scrollable", max > 1);
    box.querySelector(".rail-nav.prev").disabled = scroller.scrollLeft <= 1;
    box.querySelector(".rail-nav.next").disabled = scroller.scrollLeft >= max - 1;
  }
}

function shelf(title, items, wide = false, subtitle = "") {
  if (!items.length) return "";
  return `<section class="shelf"><div class="shelf-head"><div>${subtitle ? `<span>${escapeHtml(subtitle)}</span>` : ""}<h2>${escapeHtml(title)}</h2></div></div>${rail(`<div class="shelf-row rail-scroller ${wide ? "wide" : ""}">${items.slice(0, 20).map((item) => card(item, wide)).join("")}</div>`)}</section>`;
}

function resumeShelf() {
  const records = continueWatching();
  if (!records.length) return "";
  return `<section class="shelf"><div class="shelf-head"><div><span>Pick up where you left off</span><h2>Continue watching</h2></div></div>${rail(`<div class="shelf-row rail-scroller wide">${records.slice(0, 20).map(resumeCard).join("")}</div>`)}</section>`;
}

function recentlyAdded(type, title) {
  const items = state.items.filter((item) => item.type === type && item.added).sort((a, b) => b.added - a.added);
  return shelf(title, items, false, "New for you");
}

function renderHome() {
  const featured = state.items.find((item) => item.type === "movie") || state.items.find((item) => item.type === "series") || state.items[0];
  if (!featured) return renderWelcome();
  const image = featured.backdrop || featured.logo;
  $("#content").innerHTML = `<section class="hero">${image ? `<img src="${escapeHtml(image)}">` : ""}<div class="hero-copy"><span class="eyebrow">Featured from your library</span><h1>${escapeHtml(featured.name)}</h1><div class="meta"><span>${escapeHtml(featured.rating ? `★ ${featured.rating}` : featured.category)}</span>${featured.year ? `<span>${escapeHtml(featured.year)}</span>` : ""}${featured.duration ? `<span>${escapeHtml(featured.duration)}</span>` : ""}</div><p>${escapeHtml(featured.description || "Ready to watch from your connected IPTV source.")}</p><div class="actions"><button class="primary play-featured" data-id="${escapeHtml(featured.id)}">${featured.type === "series" ? "View episodes" : "▶ Play"}</button><button class="secondary favorite-featured" data-id="${escapeHtml(featured.id)}">${state.favorites.has(featured.id) ? "♥ Saved" : "♡ My list"}</button></div></div></section>${resumeShelf()}${shelf("Live now", state.items.filter((x) => x.type === "live"), true, "Your channels")}${recentlyAdded("movie", "Recently added movies")}${recentlyAdded("series", "Recently added series")}${shelf("Movies", state.items.filter((x) => x.type === "movie"))}${shelf("Series", state.items.filter((x) => x.type === "series"))}`;
}

function renderWelcome() {
  $("#content").innerHTML = `<section class="welcome"><div class="welcome-card"><div class="welcome-mark">▶</div><h1>Your TV. Your Mac.</h1><p>Connect your Xtream account to browse live channels, movies and series directly through your own internet connection.</p><button class="primary open-source">＋ Connect source</button></div></section>`;
}

function renderHistory() {
  const records = watchHistory();
  const rows = records.map((record) => {
    const bar = percent(record);
    const when = new Date(record.updatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    const status = record.type === "live" ? "Live channel" : finished(record) ? "Finished" : `${clock(record.position)} watched`;
    return `<article class="history-row" data-resume="${escapeHtml(record.key)}"><div class="history-art">${record.poster ? `<img loading="lazy" src="${escapeHtml(record.poster)}" onerror="this.style.display='none'">` : ""}<div class="fallback">${glyph(record.type === "episode" ? "series" : record.type)}</div></div><div class="history-copy"><strong>${escapeHtml(record.title)}</strong><small>${escapeHtml([record.subtitle, status, when].filter(Boolean).join(" • "))}</small>${bar > 1 ? `<span class="history-bar"><i style="width:${bar.toFixed(1)}%"></i></span>` : ""}</div><button class="forget" title="Remove from history">×</button></article>`;
  }).join("");
  $("#content").innerHTML = `<section class="page"><div class="page-title"><div><span class="eyebrow">${escapeHtml(state.provider?.name || "Local library")}</span><h1>History</h1></div><span>${records.length.toLocaleString()} entries</span></div>${records.length ? `<div class="history-list">${rows}</div><div class="load-more"><button class="secondary" id="clear-history">Clear watch history</button></div>` : '<div class="empty"><div><h2>Nothing watched yet</h2><p>Everything you play shows up here.</p></div></div>'}</section>`;
}

function renderCollection() {
  const base = itemsForView(true), categories = ["All", ...new Set(base.map((item) => item.category).filter(Boolean))], items = itemsForView();
  $("#content").innerHTML = `<section class="page"><div class="page-title"><div><span class="eyebrow">${escapeHtml(state.provider?.name || "Local library")}</span><h1>${state.query ? "Search results" : views[state.view]}</h1></div><span>${items.length.toLocaleString()} items</span></div><div class="rail chips-rail"><button class="rail-nav prev" aria-label="Scroll left" disabled>‹</button><div class="chips rail-scroller">${categories.slice(0, 80).map((name) => `<button class="chip ${state.category === name ? "active" : ""}" data-category="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join("")}</div><button class="rail-nav next" aria-label="Scroll right" disabled>›</button></div>${items.length ? `<div class="grid">${items.slice(0, state.limit).map((item) => card(item, item.type === "live")).join("")}</div>${items.length > state.limit ? `<div class="load-more"><button class="secondary" id="load-more">Show 120 more • ${(items.length - state.limit).toLocaleString()} remaining</button></div>` : ""}` : '<div class="empty"><div><h2>Nothing found</h2><p>Try another category or search.</p></div></div>'}</section>`;
  updateRails();
}

function render() {
  if (!state.provider || !state.items.length) renderWelcome();
  else if (state.view === "history") renderHistory();
  else if (state.view === "home" && !state.query) renderHome();
  else renderCollection();
  document.querySelectorAll("nav button").forEach((button) => button.classList.toggle("active", button.dataset.view === state.view));
  updateRails();
  updateSource();
}

function toggleFavorite(item) {
  if (!item) return;
  if (state.favorites.has(item.id)) state.favorites.delete(item.id); else state.favorites.add(item.id);
  localStorage.setItem("aurora-favorites", JSON.stringify([...state.favorites]));
  if (!$("#series-modal").classList.contains("hidden")) renderDetail(); else render();
  updatePlayerFavorite();
  updateSource();
}

/* ---------- detail sheet ---------- */

function seriesSeasons() {
  return Object.entries(state.seriesData?.episodes || {})
    .filter(([, episodes]) => Array.isArray(episodes) && episodes.length)
    .sort(([a], [b]) => String(a).localeCompare(String(b), undefined, { numeric: true }));
}

const episodeTitle = (episode, index) => episode.title || episode.info?.name || `Episode ${episode.episode_num || episode.info?.episode_num || index + 1}`;
const episodeNumber = (episode, index) => episode.episode_num || episode.info?.episode_num || index + 1;

function detailHero({ backdrop, poster, eyebrow, name, meta, description, actions }) {
  return `<section class="series-hero">${backdrop ? `<img class="series-backdrop" src="${escapeHtml(backdrop)}" onerror="this.style.display='none'">` : ""}${poster ? `<img class="series-poster" src="${escapeHtml(poster)}" onerror="this.style.visibility='hidden'">` : '<div class="series-poster"></div>'}<div class="series-info"><span class="eyebrow">${escapeHtml(eyebrow)}</span><h2>${escapeHtml(name)}</h2><div class="series-meta">${meta.filter(Boolean).map((entry) => `<span>${escapeHtml(entry)}</span>`).join("")}</div><p>${escapeHtml(description)}</p><div class="series-actions">${actions}</div></div></section>`;
}

function creditsBlock(info) {
  const rows = [["Cast", info.cast], ["Director", info.director], ["Genre", info.genre], ["Released", info.releasedate || info.releaseDate]].filter(([, value]) => value);
  if (!rows.length) return "";
  return `<section class="credits">${rows.map(([label, value]) => `<div><small>${escapeHtml(label)}</small><p>${escapeHtml(String(value))}</p></div>`).join("")}</section>`;
}

function renderSeriesDetail() {
  const item = state.seriesItem, data = state.seriesData || {}, info = data.info || {};
  if (!item) return;
  const seasons = seriesSeasons();
  if (!state.selectedSeason || !seasons.some(([number]) => number === state.selectedSeason)) state.selectedSeason = seasons[0]?.[0] || null;
  const episodes = seasons.find(([number]) => number === state.selectedSeason)?.[1] || [];
  const backdropValue = Array.isArray(info.backdrop_path) ? info.backdrop_path[0] : info.backdrop_path;
  const next = nextUnwatchedEpisode(seasons);
  const episodeRows = episodes.map((episode, index) => {
    const record = progressOf(`episode-${episode.id}`), bar = percent(record);
    const duration = episode.info?.duration || episode.duration || "Ready to play";
    return `<button class="episode ${finished(record) ? "watched" : ""}" data-episode-index="${index}"><span class="episode-number">E${escapeHtml(episodeNumber(episode, index))}</span><span class="episode-copy"><strong>${escapeHtml(episodeTitle(episode, index))}</strong><small>Season ${escapeHtml(state.selectedSeason)} • ${escapeHtml(duration)}${finished(record) ? " • Watched" : record ? ` • ${clock(record.position)} in` : ""}</small>${bar > 1 && !finished(record) ? `<span class="episode-bar"><i style="width:${bar.toFixed(1)}%"></i></span>` : ""}</span><span class="episode-play">▶</span></button>`;
  }).join("");
  const actions = `${next ? `<button class="primary detail-play-next">▶ ${escapeHtml(next.label)}</button>` : ""}<button class="secondary series-favorite">${state.favorites.has(item.id) ? "♥ Saved" : "♡ My list"}</button>`;
  $("#series-detail").innerHTML = detailHero({
    backdrop: backdropValue || item.backdrop || item.logo,
    poster: info.cover || info.movie_image || item.logo,
    eyebrow: "Series", name: item.name,
    meta: [rating(info.rating || item.rating) ? `★ ${rating(info.rating || item.rating)}` : "", String(info.releaseDate || info.releasedate || item.year || "").slice(0, 4), info.genre || item.category, `${seasons.length} season${seasons.length === 1 ? "" : "s"}`],
    description: info.plot || item.description || "Choose a season and episode to start watching.",
    actions,
  }) + creditsBlock(info) + `<section class="episodes-pane"><div class="episodes-head"><h3>Episodes</h3>${rail(`<div class="season-tabs rail-scroller">${seasons.map(([number]) => `<button class="season-tab ${number === state.selectedSeason ? "active" : ""}" data-season="${escapeHtml(number)}">Season ${escapeHtml(number)}</button>`).join("")}</div>`)}</div>${episodeRows ? `<div class="episode-list">${episodeRows}</div>` : '<div class="episodes-empty">No episodes were returned for this season.</div>'}</section>`;
}

function nextUnwatchedEpisode(seasons) {
  for (const [season, episodes] of seasons) {
    for (let index = 0; index < episodes.length; index += 1) {
      const record = progressOf(`episode-${episodes[index].id}`);
      if (finished(record)) continue;
      const label = record ? `Resume S${season} E${episodeNumber(episodes[index], index)}` : `Play S${season} E${episodeNumber(episodes[index], index)}`;
      return { season, index, label };
    }
  }
  return null;
}

function renderMovieDetail() {
  const item = state.detailItem, info = state.detailData?.info || {};
  if (!item) return;
  const record = progressOf(item.id), bar = percent(record);
  const backdropValue = Array.isArray(info.backdrop_path) ? info.backdrop_path[0] : info.backdrop_path;
  const actions = `<button class="primary detail-play">${record && !finished(record) ? `▶ Resume • ${clock(record.duration - record.position)} left` : "▶ Play"}</button>${record ? '<button class="secondary detail-restart">Start over</button>' : ""}<button class="secondary detail-favorite">${state.favorites.has(item.id) ? "♥ Saved" : "♡ My list"}</button>`;
  $("#series-detail").innerHTML = detailHero({
    backdrop: backdropValue || item.backdrop || item.logo,
    poster: info.movie_image || info.cover_big || item.logo,
    eyebrow: "Movie", name: item.name,
    meta: [rating(info.rating || item.rating) ? `★ ${rating(info.rating || item.rating)}` : "", String(info.releasedate || info.releaseDate || item.year || "").slice(0, 4), info.duration || item.duration, item.category],
    description: info.plot || info.description || "Ready to watch from your connected IPTV source.",
    actions,
  }) + creditsBlock(info) + (bar > 1 ? `<section class="detail-progress"><span><i style="width:${bar.toFixed(1)}%"></i></span><small>${escapeHtml(`${clock(record.position)} of ${clock(record.duration)} watched`)}</small></section>` : "");
}

function renderDetail() {
  if (state.seriesItem) renderSeriesDetail(); else if (state.detailItem) renderMovieDetail();
  updateRails();
}

async function openSeries(item) {
  if (!state.provider) return;
  try {
    setLoading(true, "Loading episodes", item.name);
    const data = await fetchJson(apiUrl("get_series_info", `&series_id=${item.streamId}`));
    if (!seriesHasEpisodes(data)) throw new Error("No episodes were returned for this series");
    state.detailItem = null; state.detailData = null;
    state.seriesItem = item; state.seriesData = data; state.selectedSeason = null;
    renderDetail(); $("#series-modal").classList.remove("hidden");
  } catch (error) { showToast(error.message || "Could not load this series") }
  finally { setLoading(false) }
}

async function openMovie(item) {
  if (!state.provider) return;
  state.seriesItem = null; state.seriesData = null;
  state.detailItem = item; state.detailData = null;
  renderDetail(); $("#series-modal").classList.remove("hidden");
  try {
    const data = await fetchJson(apiUrl("get_vod_info", `&vod_id=${item.streamId}`));
    if (state.detailItem?.id === item.id) { state.detailData = data; renderDetail() }
  } catch { /* the basic details from the library are already on screen */ }
}

function openDetail(item) {
  if (!item) return;
  if (item.type === "series") return openSeries(item);
  if (item.type === "movie") return openMovie(item);
  return play(item);
}

function seriesHasEpisodes(data) {
  return Object.values(data?.episodes || {}).some((episodes) => Array.isArray(episodes) && episodes.length);
}

/* ---------- playback ---------- */

function startPlayback({ url, title, subtitle = "", isLive = false, resumeAt = 0, record }) {
  state.playerItem = record?.id ? state.items.find((item) => item.id === record.id) || null : null;
  state.playing = { ...record, position: resumeAt, duration: progressOf(record.key)?.duration || 0 };
  $("#player-title").textContent = title;
  $("#player-subtitle").textContent = subtitle;
  updatePlayerFavorite();
  $("#player-modal").classList.remove("hidden");
  const video = $("#video"), source = relay(url), message = $("#video-message");
  message.classList.add("hidden");
  state.hls?.destroy(); state.hls = null;
  video.removeAttribute("src"); video.load();
  startPlayback.resumeAt = resumeAt;
  if (isLive && Hls.isSupported()) {
    state.hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 30 });
    state.hls.loadSource(source); state.hls.attachMedia(video);
    state.hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); refreshTrackMenus() });
    state.hls.on(Hls.Events.ERROR, (_, data) => {
      if (!data.fatal) return;
      message.textContent = "This channel could not be played. Close any other IPTV player because your account allows only one connection.";
      message.classList.remove("hidden");
    });
  } else {
    video.src = source; video.play().catch(() => {});
  }
  updatePlayerNav();
  saveProgress(state.playing);
}

function updatePlayerFavorite() {
  const button = $("#favorite-player"), item = state.playerItem;
  button.classList.toggle("hidden", !item);
  button.textContent = item && state.favorites.has(item.id) ? "♥ Saved" : "♡ My list";
}

function play(item, { startOver = false } = {}) {
  if (!state.provider || !item) return;
  if (item.type === "series") return openSeries(item);
  const { server, user, pass } = credentials();
  if (item.type === "live") {
    state.queue = null;
    return startPlayback({ url: `${server}/live/${user}/${pass}/${item.streamId}.m3u8`, title: item.name, subtitle: item.category, isLive: true, record: { key: item.id, id: item.id, type: "live", title: item.name, subtitle: item.category, poster: item.logo } });
  }
  if (item.type !== "movie") return;
  state.queue = null;
  const saved = startOver ? null : progressOf(item.id);
  const resumeAt = saved && !finished(saved) ? saved.position : 0;
  startPlayback({ url: `${server}/movie/${user}/${pass}/${item.streamId}.${item.ext || "mp4"}`, title: item.name, subtitle: item.category, resumeAt, record: { key: item.id, id: item.id, type: "movie", title: item.name, subtitle: item.category, poster: item.logo } });
}

function playEpisode(item, season, episodes, index, { startOver = false } = {}) {
  const episode = episodes[index];
  if (!episode || !state.provider) return;
  const { server, user, pass } = credentials();
  const number = episodeNumber(episode, index), title = episodeTitle(episode, index);
  const key = `episode-${episode.id}`;
  const saved = startOver ? null : progressOf(key);
  state.queue = { item, season, episodes, index };
  startPlayback({
    url: `${server}/series/${user}/${pass}/${episode.id}.${episode.container_extension || "mp4"}`,
    title: `${item.name} • S${season} E${number}`, subtitle: title,
    resumeAt: saved && !finished(saved) ? saved.position : 0,
    record: { key, id: item.id, type: "episode", title: item.name, subtitle: `S${season} E${number} • ${title}`, poster: item.logo, seriesId: item.streamId, season: String(season), episodeId: episode.id, container: episode.container_extension || "mp4" },
  });
}

function playSeriesEpisode(index) {
  const item = state.seriesItem, episodes = seriesSeasons().find(([number]) => number === state.selectedSeason)?.[1] || [];
  if (!item || !episodes[index]) return;
  closeModal("series-modal");
  playEpisode(item, state.selectedSeason, episodes, index);
}

function resumeRecord(key) {
  const record = progressOf(key);
  if (!record || !state.provider) return;
  if (record.type === "movie" || record.type === "live") {
    const item = state.items.find((entry) => entry.id === record.id);
    if (!item) return showToast("That title is no longer in your library — refresh the source");
    return play(item);
  }
  const { server, user, pass } = credentials();
  const item = state.items.find((entry) => entry.id === record.id) || { id: record.id, name: record.title, logo: record.poster, streamId: record.seriesId };
  state.queue = null;
  startPlayback({
    url: `${server}/series/${user}/${pass}/${record.episodeId}.${record.container || "mp4"}`,
    title: record.title, subtitle: record.subtitle,
    resumeAt: finished(record) ? 0 : record.position,
    record: { ...record },
  });
  loadQueueForEpisode(item, record);
}

async function loadQueueForEpisode(item, record) {
  if (!item?.streamId) return;
  try {
    const data = await fetchJson(apiUrl("get_series_info", `&series_id=${item.streamId}`));
    const episodes = Object.entries(data.episodes || {}).find(([number]) => String(number) === String(record.season))?.[1] || [];
    const index = episodes.findIndex((episode) => String(episode.id) === String(record.episodeId));
    if (index < 0) return;
    state.queue = { item, season: String(record.season), episodes, index };
    updatePlayerNav();
  } catch { /* next-episode navigation stays hidden */ }
}

function stepEpisode(delta) {
  const queue = state.queue;
  if (!queue) return;
  const index = queue.index + delta;
  if (index < 0 || index >= queue.episodes.length) return;
  playEpisode(queue.item, queue.season, queue.episodes, index);
}

function updatePlayerNav() {
  const queue = state.queue;
  $("#player-prev").hidden = !queue || queue.index <= 0;
  $("#player-next").hidden = !queue || queue.index >= queue.episodes.length - 1;
}

function refreshTrackMenus() {
  const video = $("#video");
  const audio = state.hls ? state.hls.audioTracks.map((track, index) => ({ value: index, label: track.name || track.lang || `Audio ${index + 1}` })) : [];
  const subtitles = [{ value: -1, label: "Off" }];
  if (state.hls) state.hls.subtitleTracks.forEach((track, index) => subtitles.push({ value: index, label: track.name || track.lang || `Subtitle ${index + 1}` }));
  else [...video.textTracks].forEach((track, index) => subtitles.push({ value: index, label: track.label || track.language || `Subtitle ${index + 1}` }));
  fillSelect($("#audio-track"), audio, state.hls ? state.hls.audioTrack : -1);
  fillSelect($("#subtitle-track"), subtitles.length > 1 ? subtitles : [], state.hls ? state.hls.subtitleTrack : -1);
  $("#audio-wrap").hidden = audio.length < 2;
  $("#subtitle-wrap").hidden = subtitles.length < 2;
}

function fillSelect(select, options, current) {
  select.innerHTML = options.map((option) => `<option value="${option.value}" ${option.value === current ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("");
}

function closeModal(id) {
  $("#" + id).classList.add("hidden");
  if (id === "player-modal") {
    recordPosition(true);
    state.hls?.destroy(); state.hls = null;
    const video = $("#video"); video.pause(); video.removeAttribute("src"); video.load();
    state.playing = null; state.playerItem = null; state.queue = null;
    if (state.view === "home" || state.view === "history") render();
  }
  if (id === "series-modal") { state.seriesItem = null; state.seriesData = null; state.selectedSeason = null; state.detailItem = null; state.detailData = null }
}

function recordPosition(force = false) {
  const video = $("#video");
  if (!state.playing || !Number.isFinite(video.currentTime)) return;
  if (state.playing.type === "live") { if (force) saveProgress({ ...state.playing, position: 0, duration: 0 }); return }
  if (!Number.isFinite(video.duration) || video.duration <= 0) return;
  const now = Date.now();
  if (!force && now - (recordPosition.last || 0) < 5000) return;
  recordPosition.last = now;
  saveProgress({ ...state.playing, position: video.currentTime, duration: Number.isFinite(video.duration) ? video.duration : state.playing.duration || 0 });
}

/* ---------- events ---------- */

const video = $("#video");
video.addEventListener("loadedmetadata", () => {
  const resumeAt = startPlayback.resumeAt || 0;
  if (resumeAt > 5 && Number.isFinite(video.duration) && resumeAt < video.duration - 10) {
    video.currentTime = resumeAt;
    showToast(`Resuming from ${clock(resumeAt)}`);
  }
  startPlayback.resumeAt = 0;
  refreshTrackMenus();
});
video.addEventListener("timeupdate", () => recordPosition());
video.addEventListener("pause", () => recordPosition(true));
video.addEventListener("ended", () => {
  recordPosition(true);
  if (state.queue && state.queue.index < state.queue.episodes.length - 1) { showToast("Playing the next episode…"); stepEpisode(1) }
});

document.addEventListener("click", (event) => {
  const target = event.target;
  const close = target.closest("[data-close]"); if (close) return closeModal(close.dataset.close);
  if (target.closest("#add-source,#source-settings,.open-source")) return $("#source-modal").classList.remove("hidden");
  if (target.closest("#source-refresh")) return refreshLibrary();
  const nav = target.closest("nav button");
  if (nav) { state.view = nav.dataset.view; state.category = "All"; state.limit = 120; state.query = ""; $("#search").value = ""; render(); return }
  const arrow = target.closest(".rail-nav");
  if (arrow) {
    const scroller = arrow.closest(".rail").querySelector(".rail-scroller");
    const step = Math.max(240, scroller.clientWidth * 0.8);
    scroller.scrollBy({ left: arrow.classList.contains("next") ? step : -step, behavior: "smooth" });
    return;
  }
  const chip = target.closest(".chip"); if (chip) { state.category = chip.dataset.category; state.limit = 120; renderCollection(); return }
  if (target.closest("#load-more")) { state.limit += 120; renderCollection(); return }
  if (target.closest("#clear-history")) { state.progress.clear(); persistProgress(); render(); return }
  const featuredPlay = target.closest(".play-featured"); if (featuredPlay) return openDetail(state.items.find((item) => item.id === featuredPlay.dataset.id));
  const featuredFavorite = target.closest(".favorite-featured"); if (featuredFavorite) return toggleFavorite(state.items.find((item) => item.id === featuredFavorite.dataset.id));
  const season = target.closest(".season-tab"); if (season) { state.selectedSeason = season.dataset.season; renderDetail(); return }
  const episode = target.closest(".episode"); if (episode) return playSeriesEpisode(Number(episode.dataset.episodeIndex));
  if (target.closest(".detail-play-next")) {
    const next = nextUnwatchedEpisode(seriesSeasons());
    if (!next) return;
    const item = state.seriesItem, episodes = seriesSeasons().find(([number]) => number === next.season)?.[1] || [];
    closeModal("series-modal"); return playEpisode(item, next.season, episodes, next.index);
  }
  if (target.closest(".detail-play")) { const item = state.detailItem; closeModal("series-modal"); return play(item) }
  if (target.closest(".detail-restart")) { const item = state.detailItem; closeModal("series-modal"); return play(item, { startOver: true }) }
  if (target.closest(".series-favorite,.detail-favorite")) return toggleFavorite(state.seriesItem || state.detailItem);
  if (target.closest("#player-prev")) return stepEpisode(-1);
  if (target.closest("#player-next")) return stepEpisode(1);
  if (target.closest("#player-pip")) return video.requestPictureInPicture?.().catch(() => showToast("Picture in Picture is not available for this stream"));
  const resume = target.closest("[data-resume]");
  if (resume) {
    if (target.closest(".forget")) { state.progress.delete(resume.dataset.resume); persistProgress(); render(); return }
    return resumeRecord(resume.dataset.resume);
  }
  const media = target.closest(".card[data-id]");
  if (media) {
    const item = state.items.find((entry) => entry.id === media.dataset.id);
    if (target.closest(".heart")) return toggleFavorite(item);
    if (target.closest(".play-bubble")) return play(item);
    if (target.closest(".open-detail")) return openDetail(item);
    if (target.closest(".play-item")) return play(item);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.target instanceof Element && event.target.matches("input,select,textarea")) {
    if (event.key === "Escape") event.target.blur();
    return;
  }
  if (event.key === "Escape") {
    for (const id of ["player-modal", "series-modal", "source-modal"]) {
      if (!$("#" + id).classList.contains("hidden")) return closeModal(id);
    }
    return;
  }
  if ($("#player-modal").classList.contains("hidden")) {
    if (event.key === "/") { event.preventDefault(); $("#search").focus() }
    return;
  }
  const step = event.shiftKey ? 60 : 10;
  const keys = {
    " ": () => (video.paused ? video.play() : video.pause()),
    ArrowRight: () => { video.currentTime = Math.min(video.duration || Infinity, video.currentTime + step) },
    ArrowLeft: () => { video.currentTime = Math.max(0, video.currentTime - step) },
    ArrowUp: () => { video.volume = Math.min(1, video.volume + 0.1) },
    ArrowDown: () => { video.volume = Math.max(0, video.volume - 0.1) },
    f: () => (document.fullscreenElement ? document.exitFullscreen() : $(".video-stage").requestFullscreen()),
    m: () => { video.muted = !video.muted },
    n: () => stepEpisode(1),
    p: () => stepEpisode(-1),
  };
  const action = keys[event.key] || keys[event.key.toLowerCase()];
  if (!action) return;
  event.preventDefault();
  action();
});

document.addEventListener("scroll", () => {
  cancelAnimationFrame(updateRails.frame);
  updateRails.frame = requestAnimationFrame(updateRails);
}, true);
window.addEventListener("resize", updateRails);

let searchTimer;
$("#search").addEventListener("input", (event) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.query = event.target.value.trim(); state.category = "All"; state.limit = 120; render() }, 180);
});
$("#source-form").addEventListener("submit", connectProvider);
$("#favorite-player").addEventListener("click", () => toggleFavorite(state.playerItem));
$("#audio-track").addEventListener("change", (event) => { if (state.hls) state.hls.audioTrack = Number(event.target.value) });
$("#subtitle-track").addEventListener("change", (event) => {
  const value = Number(event.target.value);
  if (state.hls) { state.hls.subtitleTrack = value; state.hls.subtitleDisplay = value >= 0; return }
  [...video.textTracks].forEach((track, index) => { track.mode = index === value ? "showing" : "disabled" });
});
window.addEventListener("beforeunload", () => recordPosition(true));

/* ---------- updates ---------- */

function renderUpdateBanner(status) {
  const banner = $("#update-banner"), install = $("#update-install"), button = $("#check-updates");
  const busy = status?.state === "checking" || status?.state === "downloading" || status?.state === "verifying";
  if (!busy && renderUpdateBanner.hold > Date.now()) {
    clearTimeout(renderUpdateBanner.pending);
    renderUpdateBanner.pending = setTimeout(() => renderUpdateBanner(status), renderUpdateBanner.hold - Date.now());
    return;
  }
  button.classList.toggle("busy", busy);
  button.disabled = busy;
  $("#update-check-label").textContent = { checking: "Checking…", downloading: "Downloading…", verifying: "Checking the download…", ready: "Restart to update" }[status?.state] || "Check for updates";
  const version = status?.version ? `Aurora ${status.version}` : "Aurora";
  const copy = {
    downloading: [`Downloading ${version}`, `${status?.percent || 0}% — you can keep watching`],
    verifying: [`Checking ${version}`, "Making sure the download is intact"],
    ready: [`${version} is ready`, "Aurora will restart to finish"],
    error: ["Update check failed", status?.message || ""],
    none: status?.message ? ["Aurora is up to date", `You are on ${$("#app-version").textContent}`] : null,
    skipped: status?.message ? ["Updates are off", status.message] : null,
  }[status?.state];
  renderUpdateBanner.last = status;
  if (!copy) return banner.classList.add("hidden");
  $("#update-title").textContent = copy[0];
  $("#update-detail").textContent = copy[1];
  install.hidden = status.state !== "ready";
  banner.classList.remove("hidden");
  if (status.state === "none" || status.state === "skipped") {
    clearTimeout(renderUpdateBanner.timer);
    renderUpdateBanner.timer = setTimeout(() => banner.classList.add("hidden"), 5000);
  }
}

if (window.aurora) {
  $("#check-updates").classList.remove("hidden");
  window.aurora.version().then((value) => { $("#app-version").textContent = value });
  window.aurora.updateStatus().then(renderUpdateBanner).catch(() => {});
  window.aurora.onUpdateStatus(renderUpdateBanner);
  $("#check-updates").addEventListener("click", () => {
    if (renderUpdateBanner.last?.state === "ready") return window.aurora.installUpdate();
    renderUpdateBanner.hold = Date.now() + 700;
    renderUpdateBanner({ state: "checking" });
    window.aurora.checkForUpdates();
  });
  $("#update-install").addEventListener("click", () => window.aurora.installUpdate());
  $("#update-dismiss").addEventListener("click", () => $("#update-banner").classList.add("hidden"));
}

(async function init() {
  try {
    const provider = JSON.parse(localStorage.getItem("aurora-provider") || "null");
    if (provider) {
      setLoading(true, "Opening Aurora", "Loading your saved library…");
      state.provider = provider;
      state.items = await loadLibrary();
    }
  } catch { localStorage.removeItem("aurora-provider") }
  finally {
    setLoading(false); render();
    if (!state.provider) setTimeout(() => $("#source-modal").classList.remove("hidden"), 250);
    else if (Number(localStorage.getItem("aurora-library-schema") || 0) < LIBRARY_SCHEMA) {
      showToast("Updating your library in the background…");
      refreshLibrary(true);
    }
  }
})();
