-- MFEIA lobby — 环节「已播过」标记。
--
-- The operator console shows the rundown as a grid of tiles; a segment that has
-- already been on the big screen is ticked and dimmed so the whole evening's
-- progress is readable at a glance. Persisted (not client-side) so a reloaded
-- console — or a second console on another laptop — sees the same progress.

alter table public.segments add column if not exists aired_at bigint;

-- Re-declare reset_event() (originally 0004_reset_event.sql) so 「一键清除全部数据」
-- also clears the aired marks: that button's job is to hand back a clean slate
-- between the rehearsal and the real event, and a ticked rundown is part of what
-- has to be reset. Everything else about the function is unchanged.
create or replace function public.reset_event()
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  -- FK-safe order: winners reference guests+prizes; checkins reference guests.
  -- `where true` satisfies Supabase's safeupdate guard, which blocks bare
  -- DELETE/UPDATE (no WHERE) even inside a SECURITY DEFINER function.
  delete from public.winners    where true;
  delete from public.draw_audit where true;
  delete from public.checkins   where true;
  delete from public.guests     where true;
  -- Keep prizes, but restore their pools and re-activate any archived ones so the
  -- draw starts fresh.
  update public.prizes set remaining = quantity, status = 'active' where true;
  -- Keep the programme itself (segments + honourees are configuration), but clear
  -- how far through it we got.
  update public.segments set aired_at = null where true;
end;
$$;

revoke all on function public.reset_event() from anon, public;
grant execute on function public.reset_event to authenticated;
