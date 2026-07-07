-- MFEIA lobby — Supabase schema, mirrors the local node:sqlite tables in
-- server/db.ts. Run once in the Supabase SQL editor (or via `supabase db push`).
-- Times are epoch milliseconds (bigint), matching the local schema and shared/events.ts.

-- ---- helpers --------------------------------------------------------------
-- epoch milliseconds now()
create or replace function public.now_ms() returns bigint
  language sql stable as $$ select (extract(epoch from now()) * 1000)::bigint $$;

-- ---- tables ---------------------------------------------------------------
create table if not exists public.guests (
  id            bigint generated always as identity primary key,
  name          text not null,
  company       text,
  gender        text not null default 'unknown',
  title         text,
  role          text,
  avatar_id     int,
  photo_url     text,
  status        text not null default 'registered',  -- registered | checked_in
  checked_in_at bigint,
  created_at    bigint not null default public.now_ms()
);
create index if not exists idx_guests_status on public.guests(status);

create table if not exists public.checkins (
  id         bigint generated always as identity primary key,
  guest_id   bigint not null references public.guests(id),
  created_at bigint not null default public.now_ms()
);

create table if not exists public.sponsors (
  id         bigint generated always as identity primary key,
  url        text not null,
  sort       int not null default 0,
  created_at bigint not null default public.now_ms()
);

create table if not exists public.settings (
  key   text primary key,
  value text
);

-- Seed editable settings (match DEFAULTS in shared/config.ts).
insert into public.settings(key, value) values
  ('slogan', '携手创新 · 共塑未来'),
  ('sponsorIntervalSec', '6')
on conflict (key) do nothing;

-- ---- check-in RPC ---------------------------------------------------------
-- Mirrors findGuest + createGuest + checkIn (server/db.ts): dedup walk-ins by
-- name+company, idempotent re-scan, assign a random avatar, write a checkins row.
-- SECURITY DEFINER so anonymous callers can check in without direct table writes.
create or replace function public.checkin_guest(
  p_guest_id  bigint default null,
  p_name      text   default null,
  p_company   text   default null,
  p_gender    text   default 'unknown',
  p_title     text   default null,
  p_role      text   default null,
  p_photo_url text   default null
)
returns table (
  id bigint, name text, company text, gender text, title text, role text,
  avatar_id int, photo_url text, status text, checked_in_at bigint, fresh boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     bigint;
  v_status text;
  v_ts     bigint;
  -- Keep in sync with AVATAR_MODEL_COUNT in shared/config.ts.
  v_avatar int := floor(random() * 8)::int;
begin
  -- Resolve the target guest id WITHOUT writing anything yet: any write to a row
  -- that is already checked_in fires a realtime UPDATE the screen reads as a
  -- (duplicate) spawn. New walk-ins are inserted as 'registered' (that INSERT is
  -- not part of the screen's UPDATE subscription, so it never spawns).
  if p_guest_id is not null then
    v_id := p_guest_id;
  elsif p_name is not null and btrim(p_name) <> '' then
    select g.id into v_id from public.guests g
      where lower(btrim(g.name)) = lower(btrim(p_name))
        and lower(btrim(coalesce(g.company, ''))) = lower(btrim(coalesce(p_company, '')))
      order by g.id asc limit 1;
    if v_id is null then
      insert into public.guests(name, company, gender, title, role, status)
        values (btrim(p_name), nullif(btrim(coalesce(p_company, '')), ''),
                coalesce(p_gender, 'unknown'), nullif(btrim(coalesce(p_title, '')), ''),
                nullif(btrim(coalesce(p_role, '')), ''), 'registered')
        returning guests.id into v_id;
    end if;
  else
    raise exception 'guestId or name required';
  end if;

  select g.status into v_status from public.guests g where g.id = v_id;
  if v_status is null then
    raise exception 'guest not found';
  end if;

  -- Idempotent re-scan: already checked in -> return the row untouched (no write,
  -- so no duplicate spawn on the screen), even when a fresh photo was supplied.
  if v_status = 'checked_in' then
    return query
      select g.id, g.name, g.company, g.gender, g.title, g.role, g.avatar_id,
             g.photo_url, g.status, g.checked_in_at, false as fresh
      from public.guests g where g.id = v_id;
    return;
  end if;

  -- First check-in: assign avatar, timestamp and (optional) photo in ONE update,
  -- which is the single event the screen turns into a spawn.
  v_ts := public.now_ms();
  update public.guests
    set status = 'checked_in', checked_in_at = v_ts, avatar_id = v_avatar,
        photo_url = coalesce(p_photo_url, photo_url)
    where guests.id = v_id;
  insert into public.checkins(guest_id, created_at) values (v_id, v_ts);

  return query
    select g.id, g.name, g.company, g.gender, g.title, g.role, g.avatar_id,
           g.photo_url, g.status, g.checked_in_at, true as fresh
    from public.guests g where g.id = v_id;
end;
$$;

grant execute on function public.checkin_guest to anon, authenticated;

-- ---- row level security ---------------------------------------------------
alter table public.guests   enable row level security;
alter table public.checkins enable row level security;
alter table public.sponsors enable row level security;
alter table public.settings enable row level security;

-- guests: public read (screen shows checked-in guests; check-in searches names).
-- No direct writes — all mutations go through the SECURITY DEFINER RPC.
drop policy if exists "guests read" on public.guests;
create policy "guests read" on public.guests for select using (true);

-- sponsors / settings: public read; only signed-in admins may modify.
drop policy if exists "sponsors read" on public.sponsors;
create policy "sponsors read" on public.sponsors for select using (true);
drop policy if exists "sponsors write" on public.sponsors;
create policy "sponsors write" on public.sponsors for all
  to authenticated using (true) with check (true);

drop policy if exists "settings read" on public.settings;
create policy "settings read" on public.settings for select using (true);
drop policy if exists "settings write" on public.settings;
create policy "settings write" on public.settings for all
  to authenticated using (true) with check (true);
-- checkins: no policies -> direct access denied; RPC (definer) still writes.

-- ---- realtime -------------------------------------------------------------
-- Screen subscribes to guests (spawn on UPDATE -> checked_in), sponsors, settings.
alter table public.guests replica identity full;
-- Idempotent add (re-running the migration must not fail on already-published tables).
do $$
declare t text;
begin
  foreach t in array array['guests', 'sponsors', 'settings'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---- storage (guest photos + sponsor logos) -------------------------------
insert into storage.buckets (id, name, public)
  values ('uploads', 'uploads', true)
on conflict (id) do nothing;

drop policy if exists "uploads read" on storage.objects;
create policy "uploads read" on storage.objects for select
  using (bucket_id = 'uploads');
drop policy if exists "uploads insert" on storage.objects;
create policy "uploads insert" on storage.objects for insert
  to anon, authenticated with check (bucket_id = 'uploads');
