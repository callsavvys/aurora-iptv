-- Applied to project dslcmbkdzukyvuzggjjc ("Aurora IPTV") on 2026-11-20.
-- The website's own synced data: progress, watched marks, lists, where each
-- series was left, and settings, so one account shows the same on every
-- browser (and, later, on the apps rebuilt from the site). Kept apart from
-- `progress`, whose rows the current TV app reads as its own History.
-- Like the other sync tables: one row per (user, kind, key), last writer wins
-- on the client's updated_at, deletions kept so they reach other devices,
-- pulls page on the server's synced_at.

create table public.site_data (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  kind       text        not null check (kind in ('progress', 'watched', 'lists', 'last', 'settings')),
  key        text        not null check (length(key) <= 200),
  value      jsonb,                                  -- null once deleted
  deleted    boolean     not null default false,
  updated_at timestamptz not null,
  synced_at  timestamptz not null default now(),
  primary key (user_id, kind, key)
);

create index site_data_user_synced on public.site_data (user_id, synced_at);

alter table public.site_data enable row level security;
create policy "own site data" on public.site_data for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create function public.push_site_data(items jsonb)
returns void language sql security invoker set search_path = '' as $$
  insert into public.site_data (user_id, kind, key, value, deleted, updated_at, synced_at)
  select (select auth.uid()), i->>'kind', i->>'key',
         case when coalesce((i->>'deleted')::boolean, false) then null else i->'value' end,
         coalesce((i->>'deleted')::boolean, false), (i->>'updated_at')::timestamptz, now()
  from jsonb_array_elements(items) as i
  on conflict (user_id, kind, key) do update
    set value = excluded.value, deleted = excluded.deleted, updated_at = excluded.updated_at, synced_at = now()
    where public.site_data.updated_at < excluded.updated_at;
$$;

revoke all on function public.push_site_data(jsonb) from public, anon;
grant execute on function public.push_site_data(jsonb) to authenticated;
