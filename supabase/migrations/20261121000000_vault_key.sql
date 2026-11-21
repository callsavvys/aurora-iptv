-- Applied to project dslcmbkdzukyvuzggjjc ("Aurora IPTV") on 2026-11-21.
-- The key to your sealed vault, kept on your account, so a device you are
-- already signed in on opens your saved sources without the password again
-- (the owner's ask: "if my account is saved on the device, no password").
-- The vault's sources are then protected by the account's own access rules,
-- not by a seal only your password opens. Only you can read your row.

create table public.vault_key (
  user_id    uuid        primary key default auth.uid() references auth.users (id) on delete cascade,
  key        text        not null,                   -- base64, the AES-GCM key
  salt       text        not null,                   -- base64, the vault's kdf_salt it belongs to
  updated_at timestamptz not null default now()
);

alter table public.vault_key enable row level security;
create policy "own vault key" on public.vault_key for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
