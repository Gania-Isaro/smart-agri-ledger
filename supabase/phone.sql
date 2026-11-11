-- Smart Agri-Ledger: signing in with a phone number, and resetting a forgotten
-- password without email.
--
-- Run this once in the Supabase SQL editor, after schema.sql and groups.sql. It
-- is safe to run again. In Authentication, Sign In / Providers, Email, "Confirm
-- email" must stay off: phone accounts have no mailbox to confirm.
--
-- How it works: the app turns a phone number into a private sign-in name, so
-- nobody needs an email address and no SMS is ever sent. A forgotten password
-- is reset inside the app with a code instead of an emailed link:
--   a manager uses the code of the group they manage (the owner reads it out);
--   the owner uses the recovery code shown once when the account was created.

create extension if not exists pgcrypto;

-- The owner's recovery code, stored only as a hash.
create table if not exists public.recovery (
  user_id uuid primary key references auth.users (id) on delete cascade,
  code_hash text not null,
  created_at timestamptz not null default now()
);
alter table public.recovery enable row level security;
-- No policies: nobody reads or writes this table directly, only the functions below.

-- Wrong guesses per sign-in name, to slow down anyone trying codes.
create table if not exists public.reset_attempts (
  login text primary key,
  fails int not null default 0,
  locked_until timestamptz
);
alter table public.reset_attempts enable row level security;

-- Save (or replace) the signed-in person's recovery code.
create or replace function public.set_recovery_code(p_code text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  clean text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if length(clean) < 12 then raise exception 'Recovery code is too short'; end if;
  insert into public.recovery (user_id, code_hash)
  values (auth.uid(), crypt(clean, gen_salt('bf')))
  on conflict (user_id) do update set code_hash = excluded.code_hash, created_at = now();
end;
$$;

-- Set a new password with a code. Returns 'ok', 'wrong' or 'locked'.
-- After 5 wrong codes the sign-in name is locked for 15 minutes.
create or replace function public.reset_password_with_code(p_login text, p_code text, p_password text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  who text := lower(trim(coalesce(p_login, '')));
  clean text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  u uuid;
  h text;
  a public.reset_attempts;
  good boolean := false;
begin
  if length(coalesce(p_password, '')) < 6 then raise exception 'Password should be at least 6 characters'; end if;

  select * into a from public.reset_attempts where login = who;
  if a.locked_until is not null and a.locked_until > now() then return 'locked'; end if;

  select id into u from auth.users where lower(email) = who;
  if u is not null and length(clean) >= 8 then
    -- the owner's (or anyone's) own recovery code
    select code_hash into h from public.recovery where user_id = u;
    if h is not null and crypt(clean, h) = h then good := true; end if;
    -- a manager: the code of the group they manage
    if not good then
      select exists (
        select 1
        from public.members m
        join public.group_codes g on g.coop_id = m.coop_id and g.group_id = m.group_id
        where m.user_id = u and m.role = 'manager' and replace(g.code, '-', '') = clean
      ) into good;
    end if;
  end if;

  if not good then
    insert into public.reset_attempts (login, fails) values (who, 1)
    on conflict (login) do update
      set fails = case when public.reset_attempts.fails >= 4 then 0 else public.reset_attempts.fails + 1 end,
          locked_until = case when public.reset_attempts.fails >= 4 then now() + interval '15 minutes' else null end;
    return 'wrong';
  end if;

  update auth.users set encrypted_password = crypt(p_password, gen_salt('bf', 10)), updated_at = now() where id = u;
  delete from public.reset_attempts where login = who;
  return 'ok';
end;
$$;

revoke all on function public.set_recovery_code(text) from public;
revoke all on function public.reset_password_with_code(text, text, text) from public;
grant execute on function public.set_recovery_code(text) to authenticated;
grant execute on function public.reset_password_with_code(text, text, text) to anon, authenticated;
