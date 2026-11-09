-- Smart Agri-Ledger online sync.
--
-- Run this once in the Supabase SQL editor of a new project.
--
-- How it works: every phone keeps its own copy of the cooperative's records
-- and works offline. Changes are uploaded to the `records` table when there
-- is internet, and each phone downloads what the others changed. The owner
-- creates the cooperative and shares its invite code; the manager joins with
-- that code. Row level security makes sure a person only ever reads or writes
-- the records of a cooperative they belong to.
--
-- Roles: the owner creates the cooperative and gets two invite codes, one for
-- the field manager and one for the accountant. The code a person joins with
-- decides their role.

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------ tables

create table if not exists public.coops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  accountant_code text unique,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  coop_id uuid not null references public.coops (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'accountant')),
  name text not null default '',
  email text not null default '',
  created_at timestamptz not null default now(),
  primary key (coop_id, user_id)
);

-- One row per record in the app (a farmer, a harvest, a payment, a work day).
-- `tbl` is the app table name and `data` the record itself.
create table if not exists public.records (
  coop_id uuid not null references public.coops (id) on delete cascade,
  tbl text not null,
  id text not null,
  data jsonb,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  primary key (coop_id, tbl, id)
);

create index if not exists records_coop_updated on public.records (coop_id, updated_at);

-- The server clock decides the order of changes, never a phone's clock.
create or replace function public.touch_record() returns trigger
language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists records_touch on public.records;
create trigger records_touch before insert or update on public.records
for each row execute function public.touch_record();

-- ---------------------------------------------------------------- security

create or replace function public.is_member(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where coop_id = c and user_id = auth.uid());
$$;

create or replace function public.is_owner(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where coop_id = c and user_id = auth.uid() and role = 'owner');
$$;

alter table public.coops enable row level security;
alter table public.members enable row level security;
alter table public.records enable row level security;

drop policy if exists coops_read on public.coops;
create policy coops_read on public.coops for select using (public.is_member(id));

drop policy if exists members_read on public.members;
create policy members_read on public.members for select using (public.is_member(coop_id));

drop policy if exists members_owner_remove on public.members;
create policy members_owner_remove on public.members for delete
  using (public.is_owner(coop_id) and role <> 'owner');

drop policy if exists records_read on public.records;
create policy records_read on public.records for select using (public.is_member(coop_id));

drop policy if exists records_insert on public.records;
create policy records_insert on public.records for insert with check (public.is_member(coop_id));

drop policy if exists records_update on public.records;
create policy records_update on public.records for update
  using (public.is_member(coop_id)) with check (public.is_member(coop_id));

-- Nobody deletes rows directly: a deletion is a row with deleted = true, so
-- every phone learns about it.

-- ------------------------------------------------------------- functions

-- Short code that is easy to read out over the phone: no 0/O or 1/I.
create or replace function public.new_invite_code() returns text
language plpgsql as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text := '';
begin
  for i in 1..8 loop
    code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return substr(code, 1, 4) || '-' || substr(code, 5, 4);
end;
$$;

-- The owner creates the cooperative and becomes its first member.
create or replace function public.create_coop(p_name text, p_user_name text)
returns json language plpgsql security definer set search_path = public as $$
declare
  c public.coops;
  u record;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Give the cooperative a name'; end if;
  select email into u from auth.users where id = auth.uid();
  loop
    begin
      insert into public.coops (name, invite_code, accountant_code)
      values (trim(p_name), public.new_invite_code(), public.new_invite_code()) returning * into c;
      exit;
    exception when unique_violation then
      -- invite code clash, try another
    end;
  end loop;
  insert into public.members (coop_id, user_id, role, name, email)
  values (c.id, auth.uid(), 'owner', coalesce(trim(p_user_name), ''), coalesce(u.email, ''));
  return json_build_object('coop_id', c.id, 'name', c.name, 'invite_code', c.invite_code,
    'accountant_code', c.accountant_code, 'role', 'owner');
end;
$$;

-- The field manager or the accountant joins with the code the owner gave them.
create or replace function public.join_coop(p_code text, p_user_name text)
returns json language plpgsql security definer set search_path = public as $$
declare
  c public.coops;
  u record;
  r text;
  clean text := upper(regexp_replace(trim(p_code), '[^A-Za-z0-9]', '', 'g'));
  joining text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into c from public.coops where replace(invite_code, '-', '') = clean;
  if c.id is not null then
    joining := 'manager';
  else
    select * into c from public.coops where replace(accountant_code, '-', '') = clean;
    if c.id is not null then joining := 'accountant'; end if;
  end if;
  if c.id is null then raise exception 'That invite code is not valid'; end if;
  select email into u from auth.users where id = auth.uid();
  insert into public.members (coop_id, user_id, role, name, email)
  values (c.id, auth.uid(), joining, coalesce(trim(p_user_name), ''), coalesce(u.email, ''))
  on conflict (coop_id, user_id) do nothing;
  select role into r from public.members where coop_id = c.id and user_id = auth.uid();
  return json_build_object('coop_id', c.id, 'name', c.name, 'invite_code', null, 'accountant_code', null, 'role', r);
end;
$$;

-- The cooperative this person belongs to, with their role. The invite code
-- is only returned to the owner.
create or replace function public.my_coop()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'coop_id', c.id,
    'name', c.name,
    'invite_code', case when m.role = 'owner' then c.invite_code else null end,
    'accountant_code', case when m.role = 'owner' then c.accountant_code else null end,
    'role', m.role,
    'user_name', m.name
  )
  from public.members m join public.coops c on c.id = m.coop_id
  where m.user_id = auth.uid()
  order by m.created_at
  limit 1;
$$;

-- The owner can issue a new code, for example after someone leaves.
create or replace function public.new_coop_code(p_coop uuid, p_role text default 'manager')
returns text language plpgsql security definer set search_path = public as $$
declare
  code text;
begin
  if not public.is_owner(p_coop) then raise exception 'Only the owner can change the invite code'; end if;
  loop
    begin
      code := public.new_invite_code();
      if p_role = 'accountant' then
        update public.coops set accountant_code = code where id = p_coop;
      else
        update public.coops set invite_code = code where id = p_coop;
      end if;
      exit;
    exception when unique_violation then
    end;
  end loop;
  return code;
end;
$$;

grant execute on function public.create_coop(text, text) to authenticated;
grant execute on function public.join_coop(text, text) to authenticated;
grant execute on function public.my_coop() to authenticated;
grant execute on function public.new_coop_code(uuid, text) to authenticated;
