-- MFEIA lobby — "一键清除" (full event reset). Wipes all attendee + draw data so
-- the console's clear button can hand back a clean slate between a rehearsal and
-- the real event. Sponsors, prizes and settings are KEPT; prize remaining counts
-- are restored to their quantity so the draw can run again from scratch.
--
-- SECURITY DEFINER + granted to `authenticated` only: the tables have RLS with no
-- DELETE policy, so only a signed-in admin calling this RPC can perform the wipe.

create or replace function public.reset_event()
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  -- FK-safe order: winners reference guests+prizes; checkins reference guests.
  delete from public.winners;
  delete from public.draw_audit;
  delete from public.checkins;
  delete from public.guests;
  -- Keep prizes, but restore their pools and re-activate any archived ones so the
  -- draw starts fresh.
  update public.prizes set remaining = quantity, status = 'active';
end;
$$;

revoke all on function public.reset_event() from anon, public;
grant execute on function public.reset_event to authenticated;
