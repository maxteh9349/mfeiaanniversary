-- MFEIA lucky-draw module. Builds on 0001_init.sql; same conventions: epoch-ms
-- bigints via public.now_ms(), SECURITY DEFINER RPCs with a fixed search_path,
-- idempotent guards, and idempotent realtime publication adds.
-- Runtime is Supabase-only for the draw; winner selection is server-side and
-- cryptographically secure (gen_random_uuid ordering, pgcrypto).

create extension if not exists pgcrypto;

-- ---- guests: draw eligibility -------------------------------------------------
alter table public.guests
  add column if not exists lucky_draw_eligible boolean not null default true;
-- optional future prize-to-category targeting; unused by the pool query in MVP.
alter table public.guests
  add column if not exists lucky_draw_category text;
-- pool = checked_in + eligible (partial index keeps the hot path small).
create index if not exists idx_guests_draw_pool on public.guests(status, lucky_draw_eligible)
  where status = 'checked_in' and lucky_draw_eligible = true;

-- ---- tables -------------------------------------------------------------------
create table if not exists public.prizes (
  id         bigint generated always as identity primary key,
  name       text not null,
  level      text not null default 'lucky',    -- lucky | third | second | grand
  image_url  text,
  sponsor    text,
  quantity   int  not null default 1 check (quantity >= 0),
  remaining  int  not null default 1 check (remaining >= 0),
  sort       int  not null default 0,
  status     text not null default 'active',    -- active | archived
  created_at bigint not null default public.now_ms(),
  constraint prizes_remaining_le_qty check (remaining <= quantity)
);
create index if not exists idx_prizes_sort on public.prizes(sort, id);

create table if not exists public.winners (
  id         bigint generated always as identity primary key,
  prize_id   bigint not null references public.prizes(id),
  guest_id   bigint not null references public.guests(id),
  guest_name text not null,                     -- snapshot for reveal / history
  status     text not null default 'pending',   -- pending | claimed | forfeit
  created_at bigint not null default public.now_ms(),
  updated_at bigint not null default public.now_ms()
);
create index if not exists idx_winners_prize on public.winners(prize_id);
-- Hard no-double-win guarantee: at most one ACTIVE (pending/claimed) win per guest.
-- A concurrent second win fails this even if the RPC's row lock were bypassed.
create unique index if not exists uq_winner_active_guest
  on public.winners(guest_id) where status in ('pending', 'claimed');

create table if not exists public.draw_audit (
  id             bigint generated always as identity primary key,
  action         text not null,   -- draw_started|draw_stopped|winner_generated|redraw|forfeit|claim
  operator_email text,
  prize_id       bigint,
  guest_id       bigint,
  detail         text,
  created_at     bigint not null default public.now_ms()
);
create index if not exists idx_draw_audit_created on public.draw_audit(created_at);

-- ---- row level security -------------------------------------------------------
alter table public.prizes     enable row level security;
alter table public.winners    enable row level security;
alter table public.draw_audit enable row level security;

-- prizes: public read (anon /draw app renders current prize + sponsor), authed CRUD.
drop policy if exists "prizes read" on public.prizes;
create policy "prizes read" on public.prizes for select using (true);
drop policy if exists "prizes write" on public.prizes;
create policy "prizes write" on public.prizes for all
  to authenticated using (true) with check (true);

-- winners: public read (presentation reveal + history); writes only via definer RPCs.
drop policy if exists "winners read" on public.winners;
create policy "winners read" on public.winners for select using (true);

-- draw_audit: holds operator email -> authenticated read only; writes only via RPCs.
drop policy if exists "audit read" on public.draw_audit;
create policy "audit read" on public.draw_audit for select to authenticated using (true);

-- ---- realtime -----------------------------------------------------------------
alter table public.prizes  replica identity full;
alter table public.winners replica identity full;
do $$
declare t text;
begin
  foreach t in array array['prizes', 'winners'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---- RPCs ---------------------------------------------------------------------
-- Winner selection — the atomic core. Called at STOP so the outcome is decided by
-- the server CSPRNG at commit time; the presentation only reveals it.
-- OUT columns are out_-prefixed so bare column names (e.g. remaining) inside the
-- body never collide with the function's implicit OUT variables.
create or replace function public.draw_pick_winner(
  p_prize_id bigint,
  p_operator text default null
)
returns table (
  out_winner_id  bigint,
  out_guest_id   bigint,
  out_guest_name text,
  out_prize_id   bigint,
  out_remaining  int
)
language plpgsql security definer set search_path = public
as $$
declare
  v_remaining int;
  v_guest_id  bigint;
  v_name      text;
  v_winner_id bigint;
  v_ts        bigint := public.now_ms();
begin
  -- Lock the prize row: serialises concurrent picks on the SAME prize so remaining
  -- can never go negative, and guard availability.
  select p.remaining into v_remaining
    from public.prizes p
    where p.id = p_prize_id and p.status = 'active'
    for update;
  if v_remaining is null then raise exception 'prize not found'; end if;
  if v_remaining <= 0 then raise exception 'prize out of stock'; end if;

  -- Cryptographically-random pick of one eligible guest; lock it and skip any row
  -- another concurrent draw already holds (so two draws can't pick the same guest).
  select g.id, g.name into v_guest_id, v_name
    from public.guests g
    where g.status = 'checked_in'
      and g.lucky_draw_eligible = true
      and not exists (
        select 1 from public.winners w
        where w.guest_id = g.id and w.status in ('pending', 'claimed'))
    order by gen_random_uuid()
    limit 1
    for update of g skip locked;
  if v_guest_id is null then raise exception 'draw pool empty'; end if;

  -- Atomic commit (single function = single transaction).
  insert into public.winners(prize_id, guest_id, guest_name, status, created_at, updated_at)
    values (p_prize_id, v_guest_id, v_name, 'pending', v_ts, v_ts)
    returning id into v_winner_id;
  update public.guests set lucky_draw_eligible = false where id = v_guest_id;
  update public.prizes set remaining = remaining - 1 where id = p_prize_id
    returning remaining into v_remaining;
  insert into public.draw_audit(action, operator_email, prize_id, guest_id, detail, created_at)
    values ('winner_generated', p_operator, p_prize_id, v_guest_id, v_name, v_ts);

  return query select v_winner_id, v_guest_id, v_name, p_prize_id, v_remaining;
end;
$$;

-- Redraw: forfeit a just-picked pending winner (restore pool + stock) then pick again.
create or replace function public.draw_redraw(
  p_winner_id bigint,
  p_operator  text default null
)
returns table (
  out_winner_id  bigint,
  out_guest_id   bigint,
  out_guest_name text,
  out_prize_id   bigint,
  out_remaining  int
)
language plpgsql security definer set search_path = public
as $$
declare
  v_prize bigint;
  v_guest bigint;
begin
  select w.prize_id, w.guest_id into v_prize, v_guest
    from public.winners w
    where w.id = p_winner_id and w.status = 'pending'
    for update;
  if v_prize is null then raise exception 'winner not pending'; end if;

  update public.winners set status = 'forfeit', updated_at = public.now_ms() where id = p_winner_id;
  update public.guests  set lucky_draw_eligible = true where id = v_guest;
  update public.prizes  set remaining = remaining + 1 where id = v_prize;
  insert into public.draw_audit(action, operator_email, prize_id, guest_id, detail)
    values ('redraw', p_operator, v_prize, v_guest, 'redraw');

  return query select * from public.draw_pick_winner(v_prize, p_operator);
end;
$$;

-- Claim management: mark a winner claimed or forfeit. Forfeit restores eligibility
-- and prize stock (so the guest can be redrawn).
create or replace function public.draw_set_winner_status(
  p_winner_id bigint,
  p_status    text,
  p_operator  text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_prize bigint;
  v_guest bigint;
  v_cur   text;
begin
  if p_status not in ('claimed', 'forfeit') then raise exception 'bad status'; end if;
  select w.prize_id, w.guest_id, w.status into v_prize, v_guest, v_cur
    from public.winners w where w.id = p_winner_id for update;
  if v_prize is null then raise exception 'winner not found'; end if;

  update public.winners set status = p_status, updated_at = public.now_ms() where id = p_winner_id;
  if p_status = 'forfeit' and v_cur <> 'forfeit' then
    update public.guests set lucky_draw_eligible = true where id = v_guest;
    update public.prizes set remaining = remaining + 1 where id = v_prize;
  end if;
  insert into public.draw_audit(action, operator_email, prize_id, guest_id, detail)
    values (case when p_status = 'forfeit' then 'forfeit' else 'claim' end,
            p_operator, v_prize, v_guest, p_status);
end;
$$;

-- Lifecycle logging (START / STOP) — audit only, no state change.
create or replace function public.draw_log(
  p_action   text,
  p_prize_id bigint default null,
  p_operator text default null,
  p_detail   text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_action not in ('draw_started', 'draw_stopped') then raise exception 'bad action'; end if;
  insert into public.draw_audit(action, operator_email, prize_id, detail)
    values (p_action, p_operator, p_prize_id, p_detail);
end;
$$;

-- Read-only random sample of the current pool for the presentation reel (cosmetic).
create or replace function public.draw_pool_sample(p_limit int default 60)
returns table (guest_id bigint, name text)
language sql stable security definer set search_path = public
as $$
  select g.id, g.name
    from public.guests g
    where g.status = 'checked_in'
      and g.lucky_draw_eligible = true
      and not exists (
        select 1 from public.winners w
        where w.guest_id = g.id and w.status in ('pending', 'claimed'))
    order by gen_random_uuid()
    limit greatest(1, p_limit);
$$;

-- ---- grants: authenticated (signed-in operator) only; never anon --------------
revoke all on function public.draw_pick_winner(bigint, text)             from public, anon;
revoke all on function public.draw_redraw(bigint, text)                  from public, anon;
revoke all on function public.draw_set_winner_status(bigint, text, text) from public, anon;
revoke all on function public.draw_log(text, bigint, text, text)         from public, anon;
revoke all on function public.draw_pool_sample(int)                      from public, anon;

grant execute on function public.draw_pick_winner(bigint, text)             to authenticated;
grant execute on function public.draw_redraw(bigint, text)                  to authenticated;
grant execute on function public.draw_set_winner_status(bigint, text, text) to authenticated;
grant execute on function public.draw_log(text, bigint, text, text)         to authenticated;
grant execute on function public.draw_pool_sample(int)                      to authenticated;
