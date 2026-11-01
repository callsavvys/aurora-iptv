/* Watching together, when the two of you are on different providers.

   Nothing here assumes you share a line. Each person plays their own copy of
   the film from their own account, and Aurora only agrees on *which film* and
   *where in it* you both are. That means the identity of a title has to survive
   two providers naming the same thing differently, so titles are matched on a
   fingerprint of the normalised name and year rather than on a provider's id.

   What one friend can learn about another is deliberately small: a display
   name, and whether a title they already know about is also in the other
   library. Never the other person's library itself. */

create extension if not exists pgcrypto;

/* ---- who you are to your friends ---- */

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 40),
  friend_code text not null unique,
  updated_at timestamptz not null default now()
);

/* Unambiguous on a television: no O/0, no I/1, nothing that reads differently
   in the font on a remote-driven screen. */
create or replace function public.new_friend_code()
returns text language plpgsql security definer set search_path = public as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  code text;
begin
  loop
    code := '';
    for _ in 1..8 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.profiles where friend_code = code);
  end loop;
  return code;
end $$;

/* ---- the friendship itself ---- */

create table if not exists public.friends (
  id uuid primary key default gen_random_uuid(),
  requester uuid not null references auth.users (id) on delete cascade,
  addressee uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  constraint friends_not_self check (requester <> addressee),
  constraint friends_pair unique (requester, addressee)
);

create index if not exists friends_addressee_idx on public.friends (addressee, status);
create index if not exists friends_requester_idx on public.friends (requester, status);

/* Used inside the policies below. SECURITY DEFINER so that asking "are we
   friends?" does not itself have to pass the policy it is being used to
   evaluate, which would recurse. */
create or replace function public.is_friend(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.friends
    where status = 'accepted'
      and ((requester = auth.uid() and addressee = other)
        or (addressee = auth.uid() and requester = other))
  );
$$;

/* ---- what you both have ---- */

/* A Bloom filter of the fingerprints of one library's films and series. It
   answers "could this title be in there?" for a title you already know about,
   and cannot be read back as a list — so a friend can see what you have in
   common without either library being handed over. */
create table if not exists public.library_filter (
  user_id uuid primary key references auth.users (id) on delete cascade,
  bits bytea not null,
  items integer not null default 0,
  hashes smallint not null default 4,
  updated_at timestamptz not null default now(),
  constraint library_filter_size check (octet_length(bits) between 1 and 262144)
);

/* ---- a party ---- */

create table if not exists public.parties (
  id uuid primary key default gen_random_uuid(),
  host uuid not null references auth.users (id) on delete cascade,
  fingerprint text not null,
  kind text not null check (kind in ('movie', 'series')),
  title text not null,
  season integer,
  episode integer,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

create table if not exists public.party_members (
  party_id uuid not null references public.parties (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  /* two providers' copies of one film are not the same file — different
     intros, different ad breaks — so each person keeps their own correction */
  offset_seconds numeric(8, 2) not null default 0,
  joined_at timestamptz,
  invited_at timestamptz not null default now(),
  primary key (party_id, user_id)
);

create index if not exists party_members_user_idx on public.party_members (user_id);
create index if not exists parties_host_idx on public.parties (host, created_at desc);

create or replace function public.in_party(party uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.party_members where party_id = party and user_id = auth.uid())
      or exists (select 1 from public.parties where id = party and host = auth.uid());
$$;

/* ---- row level security ---- */

alter table public.profiles enable row level security;
alter table public.friends enable row level security;
alter table public.library_filter enable row level security;
alter table public.parties enable row level security;
alter table public.party_members enable row level security;

-- your own profile, and your friends'. Strangers are reached only by code,
-- through the function below, which hands back a name and nothing else.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select
  using (user_id = auth.uid() or public.is_friend(user_id));

drop policy if exists profiles_write on public.profiles;
create policy profiles_write on public.profiles for insert with check (user_id = auth.uid());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- a request you sent or one sent to you
drop policy if exists friends_read on public.friends;
create policy friends_read on public.friends for select
  using (requester = auth.uid() or addressee = auth.uid());

drop policy if exists friends_ask on public.friends;
create policy friends_ask on public.friends for insert
  with check (requester = auth.uid() and status = 'pending');

-- only the person who was asked can accept
drop policy if exists friends_accept on public.friends;
create policy friends_accept on public.friends for update
  using (addressee = auth.uid()) with check (addressee = auth.uid() and status = 'accepted');

-- either side can walk away
drop policy if exists friends_remove on public.friends;
create policy friends_remove on public.friends for delete
  using (requester = auth.uid() or addressee = auth.uid());

drop policy if exists filter_read on public.library_filter;
create policy filter_read on public.library_filter for select
  using (user_id = auth.uid() or public.is_friend(user_id));

drop policy if exists filter_write on public.library_filter;
create policy filter_write on public.library_filter for insert with check (user_id = auth.uid());

drop policy if exists filter_update on public.library_filter;
create policy filter_update on public.library_filter for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists parties_read on public.parties;
create policy parties_read on public.parties for select using (public.in_party(id));

drop policy if exists parties_make on public.parties;
create policy parties_make on public.parties for insert with check (host = auth.uid());

drop policy if exists parties_end on public.parties;
create policy parties_end on public.parties for update
  using (host = auth.uid()) with check (host = auth.uid());

drop policy if exists members_read on public.party_members;
create policy members_read on public.party_members for select using (public.in_party(party_id));

-- the host invites; you accept for yourself and adjust only your own offset
drop policy if exists members_invite on public.party_members;
create policy members_invite on public.party_members for insert
  with check (exists (select 1 from public.parties where id = party_id and host = auth.uid()));

drop policy if exists members_update on public.party_members;
create policy members_update on public.party_members for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists members_leave on public.party_members;
create policy members_leave on public.party_members for delete
  using (user_id = auth.uid() or exists (select 1 from public.parties where id = party_id and host = auth.uid()));

/* ---- the few things that need more than a policy ---- */

/* Adding a friend by code. The code is the only way to reach someone you are
   not already friends with, and all it returns is who they are — never their
   email, and never whether some other address has an account. */
create or replace function public.friend_by_code(code text)
returns table (user_id uuid, display_name text)
language sql stable security definer set search_path = public as $$
  select p.user_id, p.display_name
  from public.profiles p
  where upper(trim(code)) = p.friend_code and p.user_id <> auth.uid()
  limit 1;
$$;

/* Your friends, with their names, in one call rather than a join the client
   would have to assemble from two policy-filtered tables. */
create or replace function public.my_friends()
returns table (user_id uuid, display_name text, friend_code text, status text, i_asked boolean, since timestamptz)
language sql stable security definer set search_path = public as $$
  select
    case when f.requester = auth.uid() then f.addressee else f.requester end as user_id,
    p.display_name,
    p.friend_code,
    f.status,
    f.requester = auth.uid() as i_asked,
    f.created_at
  from public.friends f
  join public.profiles p
    on p.user_id = case when f.requester = auth.uid() then f.addressee else f.requester end
  where f.requester = auth.uid() or f.addressee = auth.uid()
  order by f.created_at desc;
$$;

/* Making an account ready to be a friend: a name and a code, once. */
create or replace function public.claim_profile(name text)
returns table (user_id uuid, display_name text, friend_code text)
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  insert into public.profiles (user_id, display_name, friend_code)
  values (me, coalesce(nullif(trim(name), ''), 'Someone'), public.new_friend_code())
  on conflict (user_id) do update
    set display_name = coalesce(nullif(trim(excluded.display_name), ''), public.profiles.display_name),
        updated_at = now();
  return query select p.user_id, p.display_name, p.friend_code from public.profiles p where p.user_id = me;
end $$;

/* Nothing here means anything to someone who is not signed in, and leaving it
   callable lets a stranger hammer the friend-code space from the open API.
   is_friend, in_party and new_friend_code are used inside policies and other
   functions, which run as the table owner, so nobody calls them directly. */
revoke execute on function public.new_friend_code(), public.friend_by_code(text), public.my_friends(),
  public.claim_profile(text), public.is_friend(uuid), public.in_party(uuid) from anon, public, authenticated;

grant execute on function public.friend_by_code(text) to authenticated;
grant execute on function public.my_friends() to authenticated;
grant execute on function public.claim_profile(text) to authenticated;
