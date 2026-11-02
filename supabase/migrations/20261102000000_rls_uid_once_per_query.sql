/* auth.uid() once per query, not once per row.

   Postgres cannot hoist auth.uid() out of a row-level security predicate: it
   treats it as volatile and calls it again for every row it scans. Wrapping it
   in a scalar subquery makes it an InitPlan, evaluated once. The predicates
   below are otherwise identical, character for character, to the ones they
   replace — this changes when the function runs, never who can see what.

   It makes no measurable difference to two accounts. It is the difference
   between a table scan and a constant on a table with real users in it, and it
   is the most common way a Supabase schema stops scaling.

   Two of these are not what the original migration wrote, and are kept as they
   now stand rather than reverted: parties_read also admits the host directly,
   and members_read also admits your own row. Both were fixed after the first
   migration when a party could not read back the row it had just inserted. */

/* ---- the functions a policy calls per row ---- */

create or replace function public.is_friend(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.friends
    where status = 'accepted'
      and ((requester = (select auth.uid()) and addressee = other)
        or (addressee = (select auth.uid()) and requester = other))
  );
$$;

create or replace function public.in_party(party uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.party_members where party_id = party and user_id = (select auth.uid()))
      or exists (select 1 from public.parties where id = party and host = (select auth.uid()));
$$;

/* ---- profiles ---- */

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select
  using (user_id = (select auth.uid()) or public.is_friend(user_id));

drop policy if exists profiles_write on public.profiles;
create policy profiles_write on public.profiles for insert
  with check (user_id = (select auth.uid()));

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

/* ---- friends ---- */

drop policy if exists friends_read on public.friends;
create policy friends_read on public.friends for select
  using (requester = (select auth.uid()) or addressee = (select auth.uid()));

drop policy if exists friends_ask on public.friends;
create policy friends_ask on public.friends for insert
  with check (requester = (select auth.uid()) and status = 'pending');

drop policy if exists friends_accept on public.friends;
create policy friends_accept on public.friends for update
  using (addressee = (select auth.uid()))
  with check (addressee = (select auth.uid()) and status = 'accepted');

drop policy if exists friends_remove on public.friends;
create policy friends_remove on public.friends for delete
  using (requester = (select auth.uid()) or addressee = (select auth.uid()));

/* ---- what you both have ---- */

drop policy if exists filter_read on public.library_filter;
create policy filter_read on public.library_filter for select
  using (user_id = (select auth.uid()) or public.is_friend(user_id));

drop policy if exists filter_write on public.library_filter;
create policy filter_write on public.library_filter for insert
  with check (user_id = (select auth.uid()));

drop policy if exists filter_update on public.library_filter;
create policy filter_update on public.library_filter for update
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

/* ---- parties ---- */

drop policy if exists parties_read on public.parties;
create policy parties_read on public.parties for select
  using (host = (select auth.uid()) or public.in_party(id));

drop policy if exists parties_make on public.parties;
create policy parties_make on public.parties for insert
  with check (host = (select auth.uid()));

drop policy if exists parties_end on public.parties;
create policy parties_end on public.parties for update
  using (host = (select auth.uid())) with check (host = (select auth.uid()));

drop policy if exists members_read on public.party_members;
create policy members_read on public.party_members for select
  using (user_id = (select auth.uid()) or public.in_party(party_id));

drop policy if exists members_invite on public.party_members;
create policy members_invite on public.party_members for insert
  with check (exists (select 1 from public.parties where id = party_id and host = (select auth.uid())));

drop policy if exists members_update on public.party_members;
create policy members_update on public.party_members for update
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists members_leave on public.party_members;
create policy members_leave on public.party_members for delete
  using (user_id = (select auth.uid())
      or exists (select 1 from public.parties where id = party_id and host = (select auth.uid())));
