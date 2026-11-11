-- Smart Agri-Ledger: groups with their own managers.
--
-- Run this once in the Supabase SQL editor, after schema.sql. It is safe to run
-- again.
--
-- The owner creates groups in the app and gets one manager code per group. A
-- manager who joins with a group's code sees and changes only that group's
-- workers, work days, produce and payments. The owner sees every group.
--
-- How: every record carries the group it belongs to (records.group_id).
--   group_id is null      shared by the whole cooperative (crops, settings...)
--   group_id = a group id  belongs to that group
--   group_id = '__owner'   only the owner can read it (the owner's audit trail)

-- ------------------------------------------------------------------ columns

alter table public.members add column if not exists group_id text;
alter table public.records add column if not exists group_id text;
create index if not exists records_coop_group on public.records (coop_id, group_id);

-- Earlier versions had one manager role and an accountant role. Group
-- managers replace both.
alter table public.members drop constraint if exists members_role_check;
update public.members set role = 'manager' where role = 'accountant';
alter table public.members add constraint members_role_check check (role in ('owner', 'manager'));

create table if not exists public.group_codes (
  code text primary key,
  coop_id uuid not null references public.coops (id) on delete cascade,
  group_id text not null,
  created_at timestamptz not null default now(),
  unique (coop_id, group_id)
);
alter table public.group_codes enable row level security;

drop policy if exists group_codes_owner_read on public.group_codes;
create policy group_codes_owner_read on public.group_codes for select using (public.is_owner(coop_id));

-- ------------------------------------------------------------------ helpers

-- The group a member manages; null for the owner.
create or replace function public.my_group(c uuid) returns text
language sql stable security definer set search_path = public as $$
  select group_id from public.members where coop_id = c and user_id = auth.uid();
$$;

-- May the signed-in person see or write a record with this group?
create or replace function public.can_reach(c uuid, g text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner(c)
      or (public.is_member(c) and (g is null or g = public.my_group(c)));
$$;

-- May the signed-in person write this record?
-- The owner writes anything. A manager writes only their own group's records.
-- Records shared by the whole cooperative (crop prices, settings, activity
-- types, the groups themselves) are written by the owner alone, with two
-- exceptions the app cannot work without: the counters that hand out worker
-- and entry numbers, and the manager's own person record.
create or replace function public.can_write(c uuid, g text, t text, i text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner(c)
      or (public.is_member(c) and (
            (g is not null and g = public.my_group(c) and t <> 'cooperatives')
         or (g is null and t = 'counters')
         or (g is null and t = 'users' and i = auth.uid()::text)));
$$;

-- ------------------------------------------------------------------ records

drop policy if exists records_read on public.records;
create policy records_read on public.records for select using (public.can_reach(coop_id, group_id));

drop policy if exists records_insert on public.records;
create policy records_insert on public.records for insert with check (public.can_write(coop_id, group_id, tbl, id));

drop policy if exists records_update on public.records;
create policy records_update on public.records for update
  using (public.can_write(coop_id, group_id, tbl, id)) with check (public.can_write(coop_id, group_id, tbl, id));

-- -------------------------------------------------------------- functions

-- A manager code for one group, created the first time it is asked for.
create or replace function public.group_code(p_coop uuid, p_group text)
returns text language plpgsql security definer set search_path = public as $$
declare
  code text;
begin
  if not public.is_owner(p_coop) then raise exception 'Only the owner can see manager codes'; end if;
  select g.code into code from public.group_codes g where g.coop_id = p_coop and g.group_id = p_group;
  if code is not null then return code; end if;
  loop
    begin
      code := public.new_invite_code();
      insert into public.group_codes (code, coop_id, group_id) values (code, p_coop, p_group);
      return code;
    exception when unique_violation then
      -- the code was taken, try another
    end;
  end loop;
end;
$$;

-- Replace a group's manager code, for example after a manager leaves.
create or replace function public.new_group_code(p_coop uuid, p_group text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner(p_coop) then raise exception 'Only the owner can change manager codes'; end if;
  delete from public.group_codes where coop_id = p_coop and group_id = p_group;
  return public.group_code(p_coop, p_group);
end;
$$;

-- A manager joins with their group's code.
create or replace function public.join_coop(p_code text, p_user_name text)
returns json language plpgsql security definer set search_path = public as $$
declare
  gc public.group_codes;
  c public.coops;
  u record;
  clean text := upper(regexp_replace(trim(p_code), '[^A-Za-z0-9]', '', 'g'));
  r text;
  g text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into gc from public.group_codes where replace(code, '-', '') = clean;
  if gc.code is null then raise exception 'That invite code is not valid'; end if;
  select * into c from public.coops where id = gc.coop_id;
  select email into u from auth.users where id = auth.uid();
  insert into public.members (coop_id, user_id, role, name, email, group_id)
  values (c.id, auth.uid(), 'manager', coalesce(trim(p_user_name), ''), coalesce(u.email, ''), gc.group_id)
  on conflict (coop_id, user_id) do update set group_id = case when public.members.role = 'owner' then null else excluded.group_id end;
  select role, group_id into r, g from public.members where coop_id = c.id and user_id = auth.uid();
  return json_build_object('coop_id', c.id, 'name', c.name, 'role', r, 'group_id', g);
end;
$$;

-- The signed-in person's cooperative, role and group.
create or replace function public.my_coop()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'coop_id', c.id,
    'name', c.name,
    'role', m.role,
    'group_id', m.group_id,
    'user_name', m.name
  )
  from public.members m join public.coops c on c.id = m.coop_id
  where m.user_id = auth.uid()
  order by m.created_at
  limit 1;
$$;

-- The owner's list of everyone in the cooperative, with their group.
drop policy if exists members_read on public.members;
create policy members_read on public.members for select
  using (public.is_owner(coop_id) or user_id = auth.uid());

-- The owner can remove a manager, who then can no longer read or write anything.
drop policy if exists members_owner_remove on public.members;
create policy members_owner_remove on public.members for delete
  using (public.is_owner(coop_id) and role <> 'owner');

grant execute on function public.group_code(uuid, text) to authenticated;
grant execute on function public.new_group_code(uuid, text) to authenticated;
grant execute on function public.join_coop(text, text) to authenticated;
grant execute on function public.my_coop() to authenticated;
