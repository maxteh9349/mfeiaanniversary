-- Lucky draw: show the guest's honorific with their name.
--
-- The draw snapshots a name into winners.guest_name at pick time, and samples
-- names for the cosmetic reel — both previously took the bare guests.name, so
-- the reveal card read "郑闰中" instead of "郑闰中先生".
--
-- KEEP IN SYNC with displayName() / POSTFIX_TITLES in shared/events.ts — the
-- browser composes title+name the same way everywhere else (screen HUD, hero
-- card, check-in success page).

create or replace function public.display_name(p_title text, p_name text)
returns text
language sql immutable
as $$
  select case
    when coalesce(btrim(p_title), '') = '' then p_name
    -- Chinese convention: these follow the name (王先生), all others lead it (拿督王).
    when btrim(p_title) in ('先生', '女士', '小姐', '太太', '博士', '教授')
      then p_name || btrim(p_title)
    else btrim(p_title) || p_name
  end;
$$;

-- Winner pick: snapshot the display name (v_name feeds winners.guest_name, the
-- audit detail and the RPC's out_guest_name, so one change covers all three).
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
  select g.id, public.display_name(g.title, g.name) into v_guest_id, v_name
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

-- Reel sample: cosmetic, but should match the reveal it lands on.
create or replace function public.draw_pool_sample(p_limit int default 60)
returns table (guest_id bigint, name text)
language sql stable security definer set search_path = public
as $$
  select g.id, public.display_name(g.title, g.name)
    from public.guests g
    where g.status = 'checked_in'
      and g.lucky_draw_eligible = true
      and not exists (
        select 1 from public.winners w
        where w.guest_id = g.id and w.status in ('pending', 'claimed'))
    order by gen_random_uuid()
    limit greatest(1, p_limit);
$$;

-- Backfill winners drawn before this change so the admin history matches.
update public.winners w
   set guest_name = public.display_name(g.title, g.name)
  from public.guests g
 where g.id = w.guest_id
   and w.guest_name is distinct from public.display_name(g.title, g.name);

-- Helper is only ever called from the security-definer draw functions above.
revoke all on function public.display_name(text, text) from public, anon;
