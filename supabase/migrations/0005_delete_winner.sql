-- MFEIA lucky draw — delete a single winner record from the 中奖记录 list.
-- Mirrors the forfeit accounting: if the win is still active (pending/claimed),
-- hand the prize slot and the guest's draw eligibility back before removing the
-- row, so counts stay correct. A forfeited record already returned them, so it is
-- just deleted. Winners has RLS with no DELETE policy, hence a SECURITY DEFINER
-- RPC granted to authenticated (signed-in operator) only.

create or replace function public.draw_delete_winner(
  p_winner_id bigint,
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
  select w.prize_id, w.guest_id, w.status into v_prize, v_guest, v_cur
    from public.winners w where w.id = p_winner_id for update;
  if v_prize is null then raise exception 'winner not found'; end if;

  if v_cur in ('pending', 'claimed') then
    update public.guests set lucky_draw_eligible = true where id = v_guest;
    update public.prizes set remaining = remaining + 1 where id = v_prize;
  end if;

  insert into public.draw_audit(action, operator_email, prize_id, guest_id, detail)
    values ('winner_deleted', p_operator, v_prize, v_guest, v_cur);
  delete from public.winners where id = p_winner_id;
end;
$$;

revoke all on function public.draw_delete_winner(bigint, text) from public, anon;
grant execute on function public.draw_delete_winner(bigint, text) to authenticated;
