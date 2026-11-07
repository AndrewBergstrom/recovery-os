-- Recovery OS — cross-device sync schema. Run once in the Supabase SQL editor.
-- One table holds every synced document; the app's local stores map onto `store`.
-- Rows are private to the signed-in account (row-level security). Events are
-- append-only; other documents are last-write-wins by the client's updated_at.

create table if not exists public.records (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  store      text        not null,            -- events | orders | questions | milestones | appointments | contacts | meta | slot_states
  key        text        not null,            -- the document's local key (event id, order id@vN, slot id, meta key …)
  payload    jsonb       not null default '{}'::jsonb,
  deleted    boolean     not null default false,  -- tombstone (slot states cleared, sample entries removed)
  updated_at timestamptz not null,            -- set by the device that wrote it (last-write-wins)
  synced_at  timestamptz not null default now(), -- set by the server; the pull cursor
  primary key (user_id, store, key)
);

create index if not exists records_user_synced_idx on public.records (user_id, synced_at);

-- Server-side guard: an older write never overwrites a newer one; every accepted write gets a fresh synced_at.
create or replace function public.records_before_write()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null; -- skip: the row on the server is newer
  end if;
  new.synced_at := now();
  return new;
end;
$$;

drop trigger if exists records_before_write on public.records;
create trigger records_before_write
  before insert or update on public.records
  for each row execute function public.records_before_write();

-- Row-level security: a signed-in user sees and writes only their own rows. Anonymous access gets nothing.
alter table public.records enable row level security;

drop policy if exists "records are private to their owner" on public.records;
create policy "records are private to their owner"
  on public.records
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

revoke all on public.records from anon;
grant select, insert, update, delete on public.records to authenticated;
