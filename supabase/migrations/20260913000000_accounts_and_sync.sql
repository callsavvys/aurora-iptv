-- Applied to project dslcmbkdzukyvuzggjjc ("Aurora IPTV", eu-central-1) on 2026-09-13.
-- Aurora account sync. Every row belongs to one auth user and is invisible to
-- every other. Conflicts resolve last-writer-wins on the client's updated_at;
-- pulls page on server-assigned synced_at, so device clock skew cannot hide a
-- change from another device.

create table public.vault (
  user_id        uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  kdf_salt       text        not null,               -- base64, PBKDF2 salt
  kdf_iterations integer     not null check (kdf_iterations >= 100000),
  iv             text        not null,               -- base64, AES-GCM nonce
  ciphertext     text        not null,               -- base64, AES-GCM of { sources, tmdb, omdb }
  updated_at     timestamptz not null default now()
);

create table public.favorites (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  item_id    text        not null check (length(item_id) <= 200),
  saved      boolean     not null,                   -- false is a removal, kept so it syncs
  updated_at timestamptz not null,
  synced_at  timestamptz not null default now(),
  primary key (user_id, item_id)
);

create table public.progress (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  key        text        not null check (length(key) <= 200),
  record     jsonb,                                  -- null once deleted
  deleted    boolean     not null default false,
  updated_at timestamptz not null,
  synced_at  timestamptz not null default now(),
  primary key (user_id, key)
);

create index favorites_user_synced on public.favorites (user_id, synced_at);
create index progress_user_synced on public.progress (user_id, synced_at);

alter table public.vault enable row level security;
alter table public.favorites enable row level security;
alter table public.progress enable row level security;

create policy "own vault" on public.vault for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own favorites" on public.favorites for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own progress" on public.progress for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Push a batch, keeping whichever side changed last. A plain upsert would let a
-- device that was offline for a week overwrite newer progress from another one.
create function public.push_favorites(items jsonb)
returns void language sql security invoker set search_path = '' as $$
  insert into public.favorites (user_id, item_id, saved, updated_at, synced_at)
  select (select auth.uid()), i->>'item_id', (i->>'saved')::boolean, (i->>'updated_at')::timestamptz, now()
  from jsonb_array_elements(items) as i
  on conflict (user_id, item_id) do update
    set saved = excluded.saved, updated_at = excluded.updated_at, synced_at = now()
    where public.favorites.updated_at < excluded.updated_at;
$$;

create function public.push_progress(items jsonb)
returns void language sql security invoker set search_path = '' as $$
  insert into public.progress (user_id, key, record, deleted, updated_at, synced_at)
  select (select auth.uid()), i->>'key', case when (i->>'deleted')::boolean then null else i->'record' end,
         coalesce((i->>'deleted')::boolean, false), (i->>'updated_at')::timestamptz, now()
  from jsonb_array_elements(items) as i
  on conflict (user_id, key) do update
    set record = excluded.record, deleted = excluded.deleted, updated_at = excluded.updated_at, synced_at = now()
    where public.progress.updated_at < excluded.updated_at;
$$;

-- Account deletion from inside the app, which the App Store requires. Removing
-- the auth user cascades to every table above. SECURITY DEFINER is deliberate
-- (the advisor flags it): it can only ever delete the caller's own user.
create function public.delete_my_account()
returns void language sql security definer set search_path = '' as $$
  delete from auth.users where id = (select auth.uid());
$$;

revoke all on function public.push_favorites(jsonb) from public, anon;
revoke all on function public.push_progress(jsonb) from public, anon;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.push_favorites(jsonb) to authenticated;
grant execute on function public.push_progress(jsonb) to authenticated;
grant execute on function public.delete_my_account() to authenticated;
