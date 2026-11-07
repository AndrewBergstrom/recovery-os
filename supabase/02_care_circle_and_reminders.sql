-- Recovery OS — care circle (shared access) and push reminders. Run after schema.sql.
-- A care partner signs in through an invite link (Supabase anonymous auth) and is
-- attached to the owner's circle; row-level security then lets them read and
-- write the owner's records. Entries record who entered them (created_by).

-- ---------- Care circle ----------
create table if not exists public.care_circle (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users (id) on delete cascade,
  owner_name    text not null default '',
  member_id     uuid references auth.users (id) on delete set null,
  member_name   text not null,
  member_email  text,
  role          text not null default 'care_partner',
  invite_token  text unique,                 -- single use; cleared when accepted
  invited_at    timestamptz not null default now(),
  accepted_at   timestamptz,
  revoked_at    timestamptz
);

alter table public.care_circle enable row level security;

drop policy if exists "owner manages circle" on public.care_circle;
create policy "owner manages circle" on public.care_circle
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "member sees own membership" on public.care_circle;
create policy "member sees own membership" on public.care_circle
  for select to authenticated
  using (member_id = auth.uid());

grant select, insert, update, delete on public.care_circle to authenticated;

-- Is the signed-in user an active care partner for this owner?
create or replace function public.is_care_member(p_owner uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.care_circle c
    where c.owner_id = p_owner and c.member_id = auth.uid()
      and c.accepted_at is not null and c.revoked_at is null
  );
$$;
grant execute on function public.is_care_member(uuid) to authenticated;

-- records: the owner, or an active care partner, may read and write the owner's rows.
drop policy if exists "records are private to their owner" on public.records;
drop policy if exists "records: owner or care member" on public.records;
create policy "records: owner or care member" on public.records
  for all to authenticated
  using (user_id = auth.uid() or public.is_care_member(user_id))
  with check (user_id = auth.uid() or public.is_care_member(user_id));

-- Accept an invite. Called by the invitee after signing in (anonymously or by email).
create or replace function public.accept_invite(p_token text, p_name text default null)
returns table (owner_id uuid, owner_name text, member_name text, owner_profile jsonb)
language plpgsql security definer
set search_path = public
as $$
declare
  r public.care_circle%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  select * into r from public.care_circle c
    where c.invite_token = p_token and c.revoked_at is null
    for update;
  if not found then
    raise exception 'This invite link is invalid, already used or revoked';
  end if;
  update public.care_circle
    set member_id = auth.uid(), accepted_at = now(), invite_token = null,
        member_name = coalesce(nullif(trim(p_name), ''), care_circle.member_name)
    where id = r.id;
  return query
    select r.owner_id, r.owner_name, coalesce(nullif(trim(p_name), ''), r.member_name),
           (select payload from public.records x where x.user_id = r.owner_id and x.store = 'meta' and x.key = 'profile');
end;
$$;
grant execute on function public.accept_invite(text, text) to authenticated;

-- Memberships of the signed-in user (member side), with the owner's profile for display.
create or replace function public.my_memberships()
returns table (owner_id uuid, owner_name text, member_name text, owner_profile jsonb, accepted_at timestamptz)
language sql stable security definer
set search_path = public
as $$
  select c.owner_id, c.owner_name, c.member_name,
         (select payload from public.records r where r.user_id = c.owner_id and r.store = 'meta' and r.key = 'profile'),
         c.accepted_at
  from public.care_circle c
  where c.member_id = auth.uid() and c.accepted_at is not null and c.revoked_at is null;
$$;
grant execute on function public.my_memberships() to authenticated;

-- ---------- Push reminders ----------
create table if not exists public.push_subscriptions (
  id             uuid primary key default gen_random_uuid(),
  subscriber_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  owner_id       uuid not null references auth.users (id) on delete cascade,
  subscriber_name text not null default '',
  endpoint       text not null unique,
  p256dh         text not null,
  auth           text not null,
  device         text,
  prefs          jsonb not null default '{}'::jsonb,   -- { meds, exercise, ice, checkin, missed, quiet_from, quiet_to }
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "subscriber manages own subscriptions" on public.push_subscriptions;
create policy "subscriber manages own subscriptions" on public.push_subscriptions
  for all to authenticated
  using (subscriber_id = auth.uid())
  with check (subscriber_id = auth.uid() and (owner_id = auth.uid() or public.is_care_member(owner_id)));

grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- One row per notification actually sent, so the cron never sends twice.
create table if not exists public.reminder_log (
  owner_id uuid not null,
  slot_id  text not null,
  kind     text not null,          -- due | missed | test
  sent_at  timestamptz not null default now(),
  primary key (owner_id, slot_id, kind)
);
alter table public.reminder_log enable row level security;  -- no policies: service role only

-- ---------- Cron: call the reminders function every 5 minutes ----------
-- Run this block after the Edge Function is deployed. Replace <CRON_SECRET> with the
-- same value stored in the function's secrets.
--
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
-- select cron.unschedule('recovery-os-reminders') where exists (select 1 from cron.job where jobname = 'recovery-os-reminders');
-- select cron.schedule(
--   'recovery-os-reminders', '*/5 * * * *',
--   $$ select net.http_post(
--        url := 'https://aialohixjtwlmvywqqpe.supabase.co/functions/v1/reminders',
--        headers := '{"Content-Type": "application/json", "x-cron-secret": "<CRON_SECRET>"}'::jsonb,
--        body := '{}'::jsonb) $$
-- );
