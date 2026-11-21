/* Party codes, and the parties your friends have open.

   A party can be joined by a short code (K7P2QX) instead of an invitation to
   one named friend: the host reads it out, the other person types it. Only
   the host can add members (members_invite), so joining by code goes through
   join_party_by_code, which checks the code and adds the caller and nothing
   else. A code works while its party is open and for 12 hours at most.

   friends_watching lists the open parties your accepted friends are hosting,
   for a "Watching now" row: who, what, and the code to join. */

alter table public.parties add column if not exists code text;

-- a code names one open party at a time; an ended party frees its code
create unique index if not exists parties_open_code_idx on public.parties (code) where ended_at is null and code is not null;

create or replace function public.join_party_by_code(party_code text)
returns table (id uuid, host uuid, fingerprint text, title text, kind text)
language plpgsql security definer set search_path = public as $$
declare
  me uuid := (select auth.uid());
  found public.parties%rowtype;
begin
  if me is null then return; end if;
  select * into found from public.parties p
    where p.code = upper(regexp_replace(coalesce(party_code, ''), '[^0-9A-Za-z]', '', 'g'))
      and p.ended_at is null and p.created_at > now() - interval '12 hours'
    limit 1;
  if not found.id is null then
    if found.host <> me then
      insert into public.party_members (party_id, user_id, joined_at) values (found.id, me, now())
        on conflict (party_id, user_id) do update set joined_at = excluded.joined_at;
    end if;
    return query select found.id, found.host, found.fingerprint, found.title, found.kind;
  end if;
end;
$$;

create or replace function public.friends_watching()
returns table (party_id uuid, code text, host uuid, display_name text, title text, kind text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.code, p.host, pr.display_name, p.title, p.kind, p.created_at
  from public.parties p
  join public.profiles pr on pr.user_id = p.host
  where p.ended_at is null
    and p.code is not null
    and p.created_at > now() - interval '6 hours'
    and p.host <> (select auth.uid())
    and public.is_friend(p.host)
  order by p.created_at desc
  limit 10;
$$;

revoke execute on function public.join_party_by_code(text), public.friends_watching() from public, anon;
grant execute on function public.join_party_by_code(text), public.friends_watching() to authenticated;
