/* Your Aurora account, on the site: a username and a password, as atlantic.bz
   has them. The account server (Supabase auth) works with email addresses,
   so a username is kept there as <username>@users.aurora; accounts made with
   a real email (the TV app's) still sign in with that email. The session is
   kept in this browser. The address and the key are the account server's
   public ones, read from the apps at build time (vite.config.js). */
import { createClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

const DOMAIN = "users.aurora";
export const USERNAME = /^[A-Za-z0-9_.-]{3,32}$/;

let client = null, user = null, started = null, loaded = false;
const listeners = new Set();
const changed = () => { for (const fn of listeners) { try { fn(); } catch { /* a screen went away */ } } };
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

function friendly(error) {
  const m = error?.message || "";
  if (/fetch|network|load failed/i.test(m)) return "Couldn't reach the account server. Try again.";
  if (/invalid login credentials/i.test(m)) return "Wrong username or password.";
  if (/already registered|already been registered|exists/i.test(m)) return "That username is taken.";
  if (/rate limit/i.test(m)) return "Too many tries. Wait a minute and try again.";
  return m || "Something went wrong. Try again.";
}

/* the screens re-render when the account changes */
export function useAccount() {
  const [, tick] = useState(0);
  useEffect(() => { start(); return onChange(() => tick((n) => n + 1)); }, []);
  return { user, loaded, accounts: !!client };
}

export function start() {
  if (started) return started;
  return (started = (async () => {
    if (!__SUPABASE_URL__ || !__SUPABASE_KEY__) { loaded = true; changed(); return null; }
    client = createClient(__SUPABASE_URL__, __SUPABASE_KEY__, { auth: { storageKey: "aurora-auth", persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
    client.auth.onAuthStateChange((_event, session) => {
      const next = session?.user || null;
      if (session?.refresh_token) remember(session);   // keep this account's newest tokens for switching back
      if (next?.id !== user?.id || next?.user_metadata?.display_name !== user?.user_metadata?.display_name) { user = next; changed(); }
    });
    const { data } = await client.auth.getSession();
    user = data.session?.user || null;
    loaded = true;
    changed();
    return client;
  })());
}

export const signedIn = () => !!user;
export const currentUser = () => user;
/* @name for a username account, else the email */
export function username() {
  if (!user) return "";
  const email = user.email || "";
  return user.user_metadata?.username || (email.endsWith(`@${DOMAIN}`) ? email.slice(0, -DOMAIN.length - 1) : "");
}
export const handle = () => (username() ? `@${username()}` : user?.email || "");
export const displayName = () => user?.user_metadata?.display_name || username() || (user?.email || "").split("@")[0] || "";

const addressOf = (name) => (name.includes("@") ? name.trim() : `${name.trim().toLowerCase()}@${DOMAIN}`);

/* log in or sign up; a username, or the email of an older account */
export async function signIn(name, password, { create = false } = {}) {
  if (!(await start())) throw new Error("Accounts are not available here.");
  const trimmed = String(name || "").trim();
  if (create || !trimmed.includes("@")) {
    if (!USERNAME.test(trimmed)) throw new Error("Username must be 3-32 characters (letters, numbers, _ . -).");
  }
  // older email accounts (the TV app's) may have 6-character passwords
  if (password.length < (create || !trimmed.includes("@") ? 8 : 6)) throw new Error("Password must be at least 8 characters.");
  const email = addressOf(trimmed);
  const { data, error } = create
    ? await client.auth.signUp({ email, password, options: { data: { username: trimmed, display_name: trimmed } } })
    : await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(friendly(error));
  if (create && !data.session) {
    // an account server that still asks for an email confirmation: try to sign straight in
    const again = await client.auth.signInWithPassword({ email, password });
    if (again.error) throw new Error("The account was made, but the account server wants it confirmed first.");
    user = again.data.user;
  } else user = data.user;
  // your saved sources are sealed with this password: unlock them on this device now
  try { const { unlock } = await import("./vault.js"); await unlock(password); } catch { /* sources stay locked; Choose a source asks again */ }
  remember();
  changed();
  return user;
}

/* checks your password again (to unlock your saved sources on a device that was already signed in) */
export async function confirmPassword(password) {
  if (!user || !(await start())) throw new Error("Sign in first.");
  const { error } = await client.auth.signInWithPassword({ email: user.email, password });
  if (error) throw new Error(friendly(error));
  const { unlock } = await import("./vault.js");
  if (!(await unlock(password))) throw new Error("Your saved sources were sealed under an older password and can't be opened.");
}

export async function setDisplayName(name) {
  const clean = String(name || "").replace(/\s+/g, " ").trim().slice(0, 255);
  if (!clean) throw new Error("Pick a display name.");
  const { data, error } = await client.auth.updateUser({ data: { display_name: clean } });
  if (error) throw new Error(friendly(error));
  user = data.user;
  changed();
}

/* ---- the accounts used on this device ("Who's watching?") ----
   Each keeps its own session, so picking one switches to it without the
   password. Log Out removes it from this device. */
const ACCOUNTS = "aurora-site-accounts";
export function savedAccounts() { try { return JSON.parse(localStorage.getItem(ACCOUNTS) || "[]"); } catch { return []; } }
const saveAccounts = (list) => { try { localStorage.setItem(ACCOUNTS, JSON.stringify(list)); } catch { /* private mode */ } };
async function remember(session) {
  const s = session || (await client?.auth.getSession())?.data?.session;
  const u = s?.user;
  if (!u || !s.refresh_token) return;
  const entry = { id: u.id, name: u.user_metadata?.display_name || u.user_metadata?.username || (u.email || "").split("@")[0], handle: u.user_metadata?.username ? `@${u.user_metadata.username}` : u.email?.endsWith("@users.aurora") ? `@${u.email.split("@")[0]}` : u.email || "", access_token: s.access_token, refresh_token: s.refresh_token, at: Date.now() };
  saveAccounts([entry, ...savedAccounts().filter((a) => a.id !== u.id)].slice(0, 8));
}
export async function switchTo(id) {
  const a = savedAccounts().find((x) => x.id === id);
  if (!a || !(await start())) throw new Error("That account is not on this device any more.");
  if (user?.id === id) return user;
  const { leave } = await import("./party.js");
  await leave();
  const { data, error } = await client.auth.setSession({ access_token: a.access_token, refresh_token: a.refresh_token });
  if (error || !data.session) { saveAccounts(savedAccounts().filter((x) => x.id !== id)); throw new Error("That account needs signing in again."); }
  user = data.user;
  changed();
  return user;
}

export async function signOut() {
  const { leave } = await import("./party.js");
  await leave();
  const gone = user?.id;
  await client?.auth.signOut({ scope: "local" }).catch(() => {});
  if (gone) { saveAccounts(savedAccounts().filter((a) => a.id !== gone)); (await import("./vault.js")).forget(gone); }
  user = null;
  changed();
}
