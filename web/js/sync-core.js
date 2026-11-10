/* The rules both interfaces keep for the data they share: watch progress and
   History, Continue watching, My List bookkeeping, the sealed vault's source
   merge, and the library filter friends match against.

   One copy, so app/renderer.js and web/ can never disagree about a record:
   the old app and the new one read and write the same saved data on the TV,
   and a downgrade or an upgrade must find exactly what the other left.

   A classic script with no imports and no DOM: app/renderer.js is a classic
   script, web/ loads it before its modules, and the tests run it in node:vm.
   Every function is pure or works only on what it is given; the clock and new
   ids are passed in. Callers keep the side effects (saving, scheduling sync). */
(function (root) {
  "use strict";

  /* History is what you watched, so it has to outlast a binge. Over the cap,
     live channels go first (they carry no position or watched mark), then the
     oldest of everything else. */
  const HISTORY_CAP = 3000;
  const CONTINUE_LIMIT = 20;
  const UNDERWAY_SECONDS = 20;
  const FINISHED_SHARE = 0.95;
  const FILTER_BYTES = 1 << 16; // 64 KB covers a six-figure library at a low false-positive rate
  const FILTER_HASHES = 4;

  // ---------- progress records ----------

  function capProgress(progress) {
    if (progress.size <= HISTORY_CAP) return progress;
    const keep = [...progress.entries()]
      .sort(([, a], [, b]) => (a.type === "live") - (b.type === "live") || b.updatedAt - a.updatedAt)
      .slice(0, HISTORY_CAP);
    return new Map(keep);
  }

  // a write merges onto the record; watching again brings it back to Continue watching
  function mergeProgress(progress, patch, now) {
    if (!patch || !patch.key) return null;
    const merged = { ...(progress.get(patch.key) || {}), ...patch, updatedAt: now };
    delete merged.hidden;
    progress.set(patch.key, merged);
    return merged;
  }

  // removing a Continue watching card hides it; the watched mark and History stay
  function hideProgress(progress, keys, now) {
    const changed = [];
    for (const key of keys) {
      const record = progress.get(key);
      if (record) { progress.set(key, { ...record, hidden: true, updatedAt: now }); changed.push(key); }
    }
    return changed;
  }

  // forgetting from History deletes the record and leaves a tombstone for sync
  function forgetProgress(progress, gone, keys, now) {
    const tombstones = { ...(gone || {}) };
    const changed = [];
    for (const key of keys) {
      if (!progress.has(key)) continue;
      progress.delete(key);
      tombstones[key] = now;
      changed.push(key);
    }
    return { gone: tombstones, changed };
  }

  const finished = (record) => Boolean(record && record.duration > 0 && record.position >= record.duration * FINISHED_SHARE);
  const percent = (record) => (record && record.duration > 0 ? Math.min(100, (record.position / record.duration) * 100) : 0);
  const underway = (record) => Boolean(record) && record.position > UNDERWAY_SECONDS && !finished(record);

  // the unstarted episode a finished one's `next` hint points at
  function recordFromHint(latest) {
    const next = latest.next;
    return { key: `episode-${next.episodeId}`, id: latest.id, type: "episode", title: latest.title, subtitle: `S${next.season} E${next.number} • ${next.title}`, poster: latest.poster, seriesId: latest.seriesId, season: next.season, episodeId: next.episodeId, container: next.container, position: 0, duration: 0 };
  }

  // what "continue" means for a show: the episode in progress, or the unstarted
  // one after the last episode finished; nothing once it is caught up
  function upNextFor(latest, progress) {
    if (!finished(latest)) return underway(latest) ? { record: latest, fresh: false } : null;
    if (!latest.next) return null;
    const existing = progress.get(`episode-${latest.next.episodeId}`) || null;
    if (finished(existing)) return null;
    return existing && underway(existing) ? { record: existing, fresh: false } : { record: recordFromHint(latest), fresh: true };
  }

  // episodes grouped per show, on the show's newest record
  function historyShows(progress) {
    const shows = new Map();
    for (const record of progress.values()) {
      if (record.type !== "episode") continue;
      const show = shows.get(record.id) || { id: record.id, episodes: [], latest: record };
      show.episodes.push(record);
      if (record.updatedAt > show.latest.updatedAt) show.latest = record;
      shows.set(record.id, show);
    }
    for (const show of shows.values()) {
      show.episodes.sort((a, b) => b.updatedAt - a.updatedAt);
      show.title = show.latest.title;
      show.poster = (show.episodes.find((record) => record.poster) || {}).poster || "";
      show.updatedAt = show.latest.updatedAt;
      show.watched = show.episodes.filter(finished).length;
      show.upNext = upNextFor(show.latest, progress);
    }
    return [...shows.values()];
  }

  /* Films underway, and shows with an episode to go on with, newest first. A
     show is left out only when its latest record is hidden. */
  function continueWatching(progress) {
    const films = [...progress.values()]
      .filter((record) => record.type === "movie" && !record.hidden && underway(record))
      .map((record) => ({ kind: "movie", record, updatedAt: record.updatedAt }));
    const shows = historyShows(progress)
      .filter((show) => show.upNext && !show.latest.hidden)
      .map((show) => ({ kind: "series", show, record: show.upNext.record, fresh: show.upNext.fresh, updatedAt: show.updatedAt }));
    return [...films, ...shows].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, CONTINUE_LIMIT);
  }

  const watchHistory = (progress) => [...progress.values()].sort((a, b) => b.updatedAt - a.updatedAt);

  // ---------- sync bookkeeping ----------

  function markDirty(dirty, kind, id, now) {
    const next = { favorites: {}, progress: {}, ...(dirty || {}) };
    next[kind] = { ...(next[kind] || {}), [id]: now };
    return next;
  }

  function noteFavorite(times, id, saved, now) {
    return { ...(times || {}), [id]: { saved, at: now } };
  }

  // ---------- the sealed vault ----------

  function vaultPayload({ sources, removed, tmdb, omdb, keysUpdatedAt }) {
    return {
      v: 1,
      sources: (sources || []).map(({ id, name, server, username, password, updatedAt }) => ({ id, name, server, username, password, updatedAt: updatedAt || 0 })),
      removed: removed || {},
      tmdb: tmdb || "", tmdbAt: keysUpdatedAt || 0,
      omdb: omdb || "",
    };
  }

  /* Sources merge per provider login, newest change wins, and a removal is
     remembered: otherwise a device that still had the source would put it back
     on the next sync. `keys` is the API-key pair to adopt, or null. */
  function mergeVault({ local, removed, remote, sourceKey, newSourceId, keys }) {
    const tombstones = { ...(removed || {}) };
    for (const [key, at] of Object.entries(remote.removed || {})) if (!tombstones[key] || tombstones[key] < at) tombstones[key] = at;
    const byKey = new Map((local || []).map((source) => [sourceKey(source), source]));
    let gained = 0, changed = false;
    for (const source of remote.sources || []) {
      const key = sourceKey(source), mine = byKey.get(key);
      if (tombstones[key] && tombstones[key] >= (source.updatedAt || 0)) continue;
      if (!mine) { byKey.set(key, { ...source, id: source.id || newSourceId(), count: 0 }); gained += 1; changed = true; }
      else if ((source.updatedAt || 0) > (mine.updatedAt || 0)) { byKey.set(key, { ...mine, name: source.name, password: source.password, updatedAt: source.updatedAt }); changed = true; }
    }
    for (const [key, at] of Object.entries(tombstones)) {
      const mine = byKey.get(key);
      if (mine && at > (mine.updatedAt || 0)) { byKey.delete(key); changed = true; }
    }
    const current = keys || {};
    const keysChanged = (remote.tmdbAt || 0) > (current.at || 0) && (remote.tmdb !== current.tmdb || remote.omdb !== current.omdb);
    return {
      sources: [...byKey.values()], removed: tombstones, gained, changed,
      keys: keysChanged ? { tmdb: remote.tmdb || "", omdb: remote.omdb || "", at: remote.tmdbAt } : null,
    };
  }

  // ---------- the library filter (a Bloom filter of titles) ----------

  const fnv = (text, seed) => {
    let hash = (2166136261 ^ seed) >>> 0;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
  };

  function filterSet(bits, value) {
    for (let i = 0; i < FILTER_HASHES; i += 1) {
      const at = fnv(value, i) % (bits.length * 8);
      bits[at >> 3] |= 1 << (at & 7);
    }
  }

  function filterHas(bits, value) {
    for (let i = 0; i < FILTER_HASHES; i += 1) {
      const at = fnv(value, i) % (bits.length * 8);
      if (!(bits[at >> 3] & (1 << (at & 7)))) return false;
    }
    return true;
  }

  // films and series only; `fingerprints` turns an item into its title keys
  function libraryFilter(items, fingerprints) {
    const bits = new Uint8Array(FILTER_BYTES);
    let count = 0;
    for (const item of items) {
      if (item.type !== "movie" && item.type !== "series") continue;
      for (const print of fingerprints(item)) filterSet(bits, print);
      count += 1;
    }
    return { bits, count };
  }

  root.AuroraSync = Object.freeze({
    HISTORY_CAP, CONTINUE_LIMIT, FILTER_BYTES, FILTER_HASHES,
    capProgress, mergeProgress, hideProgress, forgetProgress,
    finished, percent, underway, recordFromHint, upNextFor, historyShows, continueWatching, watchHistory,
    markDirty, noteFavorite, vaultPayload, mergeVault,
    fnv, filterSet, filterHas, libraryFilter,
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
