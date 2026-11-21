/* Your saved sources, on your account: the same sealed vault the Aurora apps
   use (supabase/migrations/20260913000000_accounts_and_sync.sql, app/renderer.js),
   so a source added on the TV, the Mac or the site shows up on all of them.
   It is AES-GCM sealed with a key made from your account password (PBKDF2,
   600,000 rounds): the account server never sees your provider logins. The
   key is made when you sign in and kept on this device only. Xtream logins
   live here; an M3U link or file stays on the device that has it. */
import { start, currentUser } from "./account.js";

const ITERATIONS = 600000;
const toB64 = (bytes) => { let t = ""; for (const b of new Uint8Array(bytes)) t += String.fromCharCode(b); return btoa(t); };
const fromB64 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
const cleanServer = (s) => String(s || "").trim().replace(/\/+$/, "").replace(/^(?!https?:\/\/)/, "http://");
export const sourceKey = (s) => `${cleanServer(s.server).toLowerCase()}|${s.username || ""}`;
const KEY = (uid) => `aurora-site-vault:${uid}`;
const newId = () => `src-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function derive(password, salt, iterations = ITERATIONS) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}
/* The key is kept on this device and on your account (vault_key, readable by
   you only: supabase/migrations/20261121000000_vault_key.sql), so any device
   you are signed in on opens your sources without the password again. */
async function keep(uid, key, salt) {
  const raw = toB64(await crypto.subtle.exportKey("raw", key));
  localStorage.setItem(KEY(uid), JSON.stringify({ key: raw, salt }));
  try { const sb = await start(); await sb?.from("vault_key").upsert({ user_id: uid, key: raw, salt, updated_at: new Date().toISOString() }); } catch { /* kept on this device at least */ }
}
const importKey = (raw) => crypto.subtle.importKey("raw", fromB64(raw), { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
async function stored(uid) {
  try {
    const v = JSON.parse(localStorage.getItem(KEY(uid)) || "null");
    if (v) return { key: await importKey(v.key), salt: v.salt };
    // not on this device yet: from your account, or from the old Aurora app this TV ran
    const sb = await start();
    const { data } = sb ? await sb.from("vault_key").select("key, salt").maybeSingle() : { data: null };
    const old = (() => { try { return JSON.parse(localStorage.getItem("aurora-site-oldvault") || "null"); } catch { return null; } })();
    const found = data?.key ? data : old?.key ? old : null;
    if (!found) return null;
    const key = await importKey(found.key);
    const r = sb ? await row(sb) : null;
    if (r && r.kdf_salt !== found.salt) return null;   // a key for an older seal
    if (r) await open(key, r);                           // throws if it is not this vault's key
    await keep(uid, key, found.salt);
    return { key, salt: found.salt };
  } catch { return null; }
}
export const forget = (uid) => { try { localStorage.removeItem(KEY(uid)); } catch { /* private mode */ } };
export const unlocked = () => { const u = currentUser(); try { return !!(u && localStorage.getItem(KEY(u.id))); } catch { return false; } };

async function row(sb) {
  const { data, error } = await sb.from("vault").select("kdf_salt, kdf_iterations, iv, ciphertext").maybeSingle();
  if (error) throw error;
  return data;
}
const open = async (key, r) => JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(r.iv) }, key, fromB64(r.ciphertext))));

/* right after signing in, with the password: the key for this account's vault
   (made fresh, under a new salt, if it has none yet). Returns false when the
   vault was sealed under a password this account no longer has. */
export async function unlock(password) {
  const sb = await start(), u = currentUser();
  if (!sb || !u || !crypto?.subtle) return false;
  const r = await row(sb);
  if (r) {
    const key = await derive(password, fromB64(r.kdf_salt), r.kdf_iterations);
    try { await open(key, r); await keep(u.id, key, r.kdf_salt); return true; } catch { return false; }
  }
  const salt = toB64(crypto.getRandomValues(new Uint8Array(16)));
  await keep(u.id, await derive(password, fromB64(salt)), salt);
  return true;
}

/* the vault's contents ({v, sources, removed, tmdb, tmdbAt, omdb}), or null when locked */
export async function readVault() {
  const sb = await start(), u = currentUser();
  if (!sb || !u) return null;
  const k = await stored(u.id);
  if (!k) return null;
  const r = await row(sb);
  if (!r) return { v: 1, sources: [], removed: {}, tmdb: "", tmdbAt: 0, omdb: "" };
  if (r.kdf_salt !== k.salt) { forget(u.id); return null; }   // sealed again elsewhere after a password change
  return open(k.key, r);
}
async function writeVault(payload) {
  const sb = await start(), u = currentUser();
  const k = u && (await stored(u.id));
  if (!sb || !k) throw new Error("Your saved sources are locked on this device.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = { v: 1, sources: payload.sources.map(({ id, name, server, username, password, updatedAt }) => ({ id, name, server, username, password, updatedAt: updatedAt || 0 })), removed: payload.removed || {}, tmdb: payload.tmdb || "", tmdbAt: payload.tmdbAt || 0, omdb: payload.omdb || "" };
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k.key, new TextEncoder().encode(JSON.stringify(body)));
  const { error } = await sb.from("vault").upsert({ user_id: u.id, kdf_salt: k.salt, kdf_iterations: ITERATIONS, iv: toB64(iv), ciphertext: toB64(sealed), updated_at: new Date().toISOString() });
  if (error) throw error;
}

/* your saved sources, without the ones removed, or null when locked */
export async function savedSources() {
  const v = await readVault();
  if (!v) return null;
  return (v.sources || []).filter((s) => s.server && !(v.removed?.[sourceKey(s)] >= (s.updatedAt || 0)));
}
/* adds (or updates) an Xtream login in the vault; quiet when locked */
export async function saveSource({ name, server, username, password }) {
  const v = await readVault();
  if (!v) return false;
  const key = sourceKey({ server, username });
  const now = Date.now();
  const mine = (v.sources || []).find((s) => sourceKey(s) === key);
  v.sources = mine ? v.sources.map((s) => (s === mine ? { ...s, name, password, updatedAt: now } : s)) : [...(v.sources || []), { id: newId(), name, server, username, password, updatedAt: now }];
  if (v.removed?.[key]) delete v.removed[key];
  await writeVault(v);
  return true;
}
export async function removeSource(s) {
  const v = await readVault();
  if (!v) return false;
  v.removed = { ...(v.removed || {}), [sourceKey(s)]: Date.now() };
  await writeVault(v);
  return true;
}
