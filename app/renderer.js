/* global Hls */
const $ = (selector) => document.querySelector(selector);
const state = { provider: null, items: [], view: "home", query: "", category: "All", limit: 120, favorites: new Set(JSON.parse(localStorage.getItem("aurora-favorites") || "[]")), playerItem: null, hls: null, seriesItem: null, seriesData: null, selectedSeason: null };
const views = { home: "Home", live: "Live TV", movies: "Movies", series: "Series", favorites: "Favorites" };

const cleanServer = (value) => { const clean = value.trim().replace(/\/$/, ""); return /^https?:\/\//i.test(clean) ? clean : `http://${clean}` };
const relay = (url) => `/proxy?src=${encodeURIComponent(url)}`;
const escapeHtml = (value = "") => String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
const rating = (value) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n.toFixed(1) : "" };

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

async function connectProvider(event) {
  event.preventDefault(); $("#form-error").classList.add("hidden");
  const provider = { name: $("#provider-name").value.trim() || "My IPTV", server: cleanServer($("#server").value), username: $("#username").value.trim(), password: $("#password").value };
  const encodedUser = encodeURIComponent(provider.username), encodedPass = encodeURIComponent(provider.password);
  const endpoint = `${provider.server}/player_api.php?username=${encodedUser}&password=${encodedPass}`;
  try {
    setLoading(true, "Connecting", "Checking the Xtream account from your Mac…");
    const auth = await fetchJson(endpoint);
    if (Number(auth?.user_info?.auth) !== 1 || auth?.user_info?.status !== "Active") throw new Error("The provider rejected this login or the account is inactive");

    setLoading(true, "Loading live TV", "Downloading channels and categories…");
    const [liveCategories, live] = await Promise.all([fetchJson(`${endpoint}&action=get_live_categories`), fetchJson(`${endpoint}&action=get_live_streams`)]);
    const liveMap = categoryMap(liveCategories);
    const items = live.map((x) => ({ id: `live-${x.stream_id}`, type: "live", streamId: Number(x.stream_id), name: x.name, category: liveMap.get(String(x.category_id)) || "Uncategorized", logo: x.stream_icon || "", ext: "m3u8" }));

    setLoading(true, "Loading movies", `${items.length.toLocaleString()} live channels ready…`);
    const [movieCategories, movies] = await Promise.all([fetchJson(`${endpoint}&action=get_vod_categories`), fetchJson(`${endpoint}&action=get_vod_streams`)]);
    const movieMap = categoryMap(movieCategories);
    for (const x of movies) items.push({ id: `movie-${x.stream_id}`, type: "movie", streamId: Number(x.stream_id), name: x.name, category: movieMap.get(String(x.category_id)) || "Uncategorized", logo: x.stream_icon || "", ext: x.container_extension || "mp4", rating: rating(x.rating), year: x.year || "", duration: x.duration || "" });

    setLoading(true, "Loading series", `${items.length.toLocaleString()} channels and movies ready…`);
    const [seriesCategories, series] = await Promise.all([fetchJson(`${endpoint}&action=get_series_categories`), fetchJson(`${endpoint}&action=get_series`)]);
    const seriesMap = categoryMap(seriesCategories);
    for (const x of series) items.push({ id: `series-${x.series_id}`, type: "series", streamId: Number(x.series_id), name: x.name, category: seriesMap.get(String(x.category_id)) || "Uncategorized", logo: x.cover || "", backdrop: Array.isArray(x.backdrop_path) ? x.backdrop_path[0] || "" : "", rating: rating(x.rating), year: String(x.releaseDate || "").slice(0, 4), description: x.plot || "" });

    setLoading(true, "Saving your library", `${items.length.toLocaleString()} total items loaded…`);
    await saveLibrary(items);
    state.provider = provider; state.items = items; state.view = "home"; state.category = "All"; state.limit = 120;
    localStorage.setItem("aurora-provider", JSON.stringify(provider));
    closeModal("source-modal"); updateSource(); render();
    showToast(`${items.length.toLocaleString()} items loaded successfully`);
  } catch (error) {
    const box = $("#form-error"); box.textContent = error.message || "Could not connect"; box.classList.remove("hidden");
    $("#source-modal").classList.remove("hidden");
  } finally { setLoading(false) }
}

function updateSource() {
  $("#source-name").textContent = state.provider?.name || "No source";
  $("#source-status").textContent = state.provider ? `${state.items.length.toLocaleString()} items • Local` : "Not connected";
  const count = state.favorites.size; const badge = $("#favorite-count"); badge.textContent = count; badge.style.display = count ? "grid" : "none";
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

function card(item, wide = false) {
  const art = item.logo || item.backdrop;
  return `<article class="card ${wide ? "wide" : ""}" data-id="${escapeHtml(item.id)}"><div class="art play-item">${art ? `<img loading="lazy" src="${escapeHtml(art)}" onerror="this.style.display='none'">` : ""}<div class="fallback">${item.type === "live" ? "◉" : item.type === "movie" ? "▰" : "▦"}</div>${item.type === "live" ? '<span class="live">Live</span>' : ""}<span class="play-bubble">▶</span></div><div class="card-copy"><div><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml([item.year, item.category].filter(Boolean).join(" • ") || item.type)}</p></div><button class="heart ${state.favorites.has(item.id) ? "saved" : ""}">${state.favorites.has(item.id) ? "♥" : "♡"}</button></div></article>`;
}

function shelf(title, items, wide = false, subtitle = "") {
  if (!items.length) return "";
  return `<section class="shelf"><div class="shelf-head"><div>${subtitle ? `<span>${escapeHtml(subtitle)}</span>` : ""}<h2>${escapeHtml(title)}</h2></div></div><div class="shelf-row ${wide ? "wide" : ""}">${items.slice(0, 8).map((item) => card(item, wide)).join("")}</div></section>`;
}

function renderHome() {
  const featured = state.items.find((item) => item.type === "movie") || state.items.find((item) => item.type === "series") || state.items[0];
  if (!featured) return renderWelcome();
  const image = featured.backdrop || featured.logo;
  $("#content").innerHTML = `<section class="hero">${image ? `<img src="${escapeHtml(image)}">` : ""}<div class="hero-copy"><span class="eyebrow">Featured from your library</span><h1>${escapeHtml(featured.name)}</h1><div class="meta"><span>${escapeHtml(featured.rating ? `★ ${featured.rating}` : featured.category)}</span>${featured.year ? `<span>${escapeHtml(featured.year)}</span>` : ""}${featured.duration ? `<span>${escapeHtml(featured.duration)}</span>` : ""}</div><p>${escapeHtml(featured.description || "Ready to watch from your connected IPTV source.")}</p><div class="actions"><button class="primary play-featured" data-id="${escapeHtml(featured.id)}">${featured.type === "series" ? "View episodes" : "▶ Play"}</button><button class="secondary favorite-featured" data-id="${escapeHtml(featured.id)}">${state.favorites.has(featured.id) ? "♥ Saved" : "♡ My list"}</button></div></div></section>${shelf("Live now", state.items.filter((x) => x.type === "live"), true, "Your channels")}${shelf("Movies", state.items.filter((x) => x.type === "movie"))}${shelf("Series", state.items.filter((x) => x.type === "series"))}`;
}

function renderWelcome() {
  $("#content").innerHTML = `<section class="welcome"><div class="welcome-card"><div class="welcome-mark">▶</div><h1>Your TV. Your Mac.</h1><p>Connect your Xtream account to browse live channels, movies and series directly through your own internet connection.</p><button class="primary open-source">＋ Connect source</button></div></section>`;
}

function renderCollection() {
  const base = itemsForView(true); const categories = ["All", ...new Set(base.map((item) => item.category).filter(Boolean))]; const items = itemsForView();
  $("#content").innerHTML = `<section class="page"><div class="page-title"><div><span class="eyebrow">${escapeHtml(state.provider?.name || "Local library")}</span><h1>${state.query ? `Search results` : views[state.view]}</h1></div><span>${items.length.toLocaleString()} items</span></div><div class="chips">${categories.slice(0, 80).map((name) => `<button class="chip ${state.category === name ? "active" : ""}" data-category="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join("")}</div>${items.length ? `<div class="grid">${items.slice(0, state.limit).map((item) => card(item, item.type === "live")).join("")}</div>${items.length > state.limit ? `<div class="load-more"><button class="secondary" id="load-more">Show 120 more • ${(items.length - state.limit).toLocaleString()} remaining</button></div>` : ""}` : '<div class="empty"><div><h2>Nothing found</h2><p>Try another category or search.</p></div></div>'}</section>`;
}

function render() {
  if (!state.provider || !state.items.length) renderWelcome(); else if (state.view === "home" && !state.query) renderHome(); else renderCollection();
  document.querySelectorAll("nav button").forEach((button) => button.classList.toggle("active", button.dataset.view === state.view)); updateSource();
}

function toggleFavorite(item) {
  if (state.favorites.has(item.id)) state.favorites.delete(item.id); else state.favorites.add(item.id);
  localStorage.setItem("aurora-favorites", JSON.stringify([...state.favorites])); render();
}

function seriesSeasons() {
  return Object.entries(state.seriesData?.episodes || {})
    .filter(([, episodes]) => Array.isArray(episodes) && episodes.length)
    .sort(([a], [b]) => String(a).localeCompare(String(b), undefined, { numeric: true }));
}

function renderSeriesDetail() {
  const item = state.seriesItem, data = state.seriesData || {}, info = data.info || {};
  if (!item) return;
  const seasons = seriesSeasons();
  if (!state.selectedSeason || !seasons.some(([number]) => number === state.selectedSeason)) state.selectedSeason = seasons[0]?.[0] || null;
  const episodes = seasons.find(([number]) => number === state.selectedSeason)?.[1] || [];
  const backdropValue = Array.isArray(info.backdrop_path) ? info.backdrop_path[0] : info.backdrop_path;
  const backdrop = backdropValue || item.backdrop || item.logo;
  const poster = info.cover || info.movie_image || item.logo;
  const description = info.plot || item.description || "Choose a season and episode to start watching.";
  const year = String(info.releaseDate || info.releasedate || item.year || "").slice(0, 4);
  const genre = info.genre || item.category;
  const ratingValue = rating(info.rating || item.rating);
  const episodeRows = episodes.map((episode, index) => {
    const number = episode.episode_num || episode.info?.episode_num || index + 1;
    const title = episode.title || episode.info?.name || `Episode ${number}`;
    const duration = episode.info?.duration || episode.duration || "Ready to play";
    return `<button class="episode" data-episode-index="${index}"><span class="episode-number">E${escapeHtml(number)}</span><span class="episode-copy"><strong>${escapeHtml(title)}</strong><small>Season ${escapeHtml(state.selectedSeason)} • ${escapeHtml(duration)}</small></span><span class="episode-play">▶</span></button>`;
  }).join("");
  $("#series-detail").innerHTML = `<section class="series-hero">${backdrop ? `<img class="series-backdrop" src="${escapeHtml(backdrop)}" onerror="this.style.display='none'">` : ""}${poster ? `<img class="series-poster" src="${escapeHtml(poster)}" onerror="this.style.visibility='hidden'">` : '<div class="series-poster"></div>'}<div class="series-info"><span class="eyebrow">Series</span><h2>${escapeHtml(item.name)}</h2><div class="series-meta">${ratingValue ? `<span>★ ${escapeHtml(ratingValue)}</span>` : ""}${year ? `<span>${escapeHtml(year)}</span>` : ""}${genre ? `<span>${escapeHtml(genre)}</span>` : ""}<span>${seasons.length} season${seasons.length === 1 ? "" : "s"}</span></div><p>${escapeHtml(description)}</p><div class="series-actions"><button class="secondary series-favorite">${state.favorites.has(item.id) ? "♥ Saved" : "♡ My list"}</button></div></div></section><section class="episodes-pane"><div class="episodes-head"><h3>Episodes</h3><div class="season-tabs">${seasons.map(([number]) => `<button class="season-tab ${number === state.selectedSeason ? "active" : ""}" data-season="${escapeHtml(number)}">Season ${escapeHtml(number)}</button>`).join("")}</div></div>${episodeRows ? `<div class="episode-list">${episodeRows}</div>` : '<div class="episodes-empty">No episodes were returned for this season.</div>'}</section>`;
}

async function openSeries(item) {
  if (!state.provider) return;
  const { server, username, password } = state.provider;
  try {
    setLoading(true, "Loading episodes", item.name);
    const user = encodeURIComponent(username), pass = encodeURIComponent(password);
    const data = await fetchJson(`${server}/player_api.php?username=${user}&password=${pass}&action=get_series_info&series_id=${item.streamId}`);
    if (!seriesHasEpisodes(data)) throw new Error("No episodes were returned for this series");
    state.seriesItem = item; state.seriesData = data; state.selectedSeason = null;
    renderSeriesDetail(); $("#series-modal").classList.remove("hidden");
  } catch (error) { showToast(error.message || "Could not load this series") }
  finally { setLoading(false) }
}

function seriesHasEpisodes(data) {
  return Object.values(data?.episodes || {}).some((episodes) => Array.isArray(episodes) && episodes.length);
}

function startPlayback(url, item, title, isLive = false) {
  state.playerItem = item; $("#player-title").textContent = title; $("#player-modal").classList.remove("hidden");
  const video = $("#video"), source = relay(url), message = $("#video-message"); message.classList.add("hidden");
  state.hls?.destroy(); state.hls = null; video.removeAttribute("src"); video.load();
  if (isLive && Hls.isSupported()) {
    state.hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 30 }); state.hls.loadSource(source); state.hls.attachMedia(video);
    state.hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
    state.hls.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) { message.textContent = "This channel could not be played. Close any other IPTV player because your account allows one connection."; message.classList.remove("hidden") } });
  } else { video.src = source; video.play().catch(() => {}) }
}

function play(item) {
  if (!state.provider || !item) return;
  if (item.type === "series") return openSeries(item);
  const { server, username, password } = state.provider, user = encodeURIComponent(username), pass = encodeURIComponent(password);
  if (item.type === "live") return startPlayback(`${server}/live/${user}/${pass}/${item.streamId}.m3u8`, item, item.name, true);
  if (item.type === "movie") return startPlayback(`${server}/movie/${user}/${pass}/${item.streamId}.${item.ext || "mp4"}`, item, item.name);
}

function playSeriesEpisode(index) {
  const item = state.seriesItem, episodes = seriesSeasons().find(([number]) => number === state.selectedSeason)?.[1] || [], episode = episodes[index];
  if (!item || !episode || !state.provider) return;
  const { server, username, password } = state.provider, user = encodeURIComponent(username), pass = encodeURIComponent(password);
  const season = state.selectedSeason;
  const number = episode.episode_num || episode.info?.episode_num || index + 1;
  const title = episode.title || episode.info?.name || `Episode ${number}`;
  closeModal("series-modal");
  startPlayback(`${server}/series/${user}/${pass}/${episode.id}.${episode.container_extension || "mp4"}`, item, `${item.name} • S${season} E${number} • ${title}`);
}

function closeModal(id) {
  $("#" + id).classList.add("hidden");
  if (id === "player-modal") { state.hls?.destroy(); state.hls = null; const video = $("#video"); video.pause(); video.removeAttribute("src"); video.load() }
  if (id === "series-modal") { state.seriesItem = null; state.seriesData = null; state.selectedSeason = null }
}

document.addEventListener("click", (event) => {
  const target = event.target;
  const close = target.closest("[data-close]"); if (close) return closeModal(close.dataset.close);
  if (target.closest("#add-source,#source-settings,.open-source")) return $("#source-modal").classList.remove("hidden");
  const nav = target.closest("nav button"); if (nav) { state.view = nav.dataset.view; state.category = "All"; state.limit = 120; state.query = ""; $("#search").value = ""; render(); return }
  const chip = target.closest(".chip"); if (chip) { state.category = chip.dataset.category; state.limit = 120; renderCollection(); return }
  const load = target.closest("#load-more"); if (load) { state.limit += 120; renderCollection(); return }
  const featuredPlay = target.closest(".play-featured"); if (featuredPlay) return play(state.items.find((item) => item.id === featuredPlay.dataset.id));
  const featuredFavorite = target.closest(".favorite-featured"); if (featuredFavorite) return toggleFavorite(state.items.find((item) => item.id === featuredFavorite.dataset.id));
  const season = target.closest(".season-tab"); if (season) { state.selectedSeason = season.dataset.season; renderSeriesDetail(); return }
  const episode = target.closest(".episode"); if (episode) return playSeriesEpisode(Number(episode.dataset.episodeIndex));
  const seriesFavorite = target.closest(".series-favorite"); if (seriesFavorite && state.seriesItem) { const id = state.seriesItem.id; if (state.favorites.has(id)) state.favorites.delete(id); else state.favorites.add(id); localStorage.setItem("aurora-favorites", JSON.stringify([...state.favorites])); renderSeriesDetail(); updateSource(); return }
  const media = target.closest(".card"); if (media) { const item = state.items.find((entry) => entry.id === media.dataset.id); if (target.closest(".heart")) toggleFavorite(item); else if (target.closest(".play-item")) play(item) }
});

let searchTimer;
$("#search").addEventListener("input", (event) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.query = event.target.value.trim(); state.category = "All"; state.limit = 120; render() }, 180) });
$("#source-form").addEventListener("submit", connectProvider);
$("#favorite-player").addEventListener("click", () => { if (state.playerItem) toggleFavorite(state.playerItem) });

(async function init() {
  try {
    const provider = JSON.parse(localStorage.getItem("aurora-provider") || "null");
    if (provider) { setLoading(true, "Opening Aurora", "Loading your saved library…"); state.provider = provider; state.items = await loadLibrary() }
  } catch { localStorage.removeItem("aurora-provider") }
  finally { setLoading(false); render(); if (!state.provider) setTimeout(() => $("#source-modal").classList.remove("hidden"), 250) }
})();
