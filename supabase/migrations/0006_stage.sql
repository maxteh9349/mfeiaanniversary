-- MFEIA lobby — 晚宴流程环节大屏（/stage）。
--
-- The rundown (2026 MFEIA 49th Annual Dinner Rundown) has ~19 programme segments
-- between 6.40pm and 10.37pm that the big screen had no content for: VIP speeches,
-- the 23rd committee sworn-in roster, student certificate + academic award
-- presentations, long-service awards, cheque and sponsor-plaque presentations.
--
-- Two tables drive a data-driven presentation page:
--   segments  — one row per programme item (kind decides the big-screen layout)
--   honourees — the named people/companies called up during a segment
--
-- Which segment is live (and, for `award`, which honouree is on stage) lives in
-- the existing `settings` table rather than a broadcast channel: settings is
-- already in the supabase_realtime publication, so a settings upsert is both the
-- live cue AND the persisted state — a big screen refreshed mid-ceremony comes
-- back on the same segment at the same honouree.

-- ---- tables ---------------------------------------------------------------
create table if not exists public.segments (
  id          bigint generated always as identity primary key,
  -- title | speech | roster | award | sponsor_thanks — picks the /stage layout
  kind        text not null,
  time_label  text,                              -- '8.42pm' as printed in the rundown
  title_zh    text not null,
  title_en    text,
  subtitle    text,
  presenter   text,                              -- 颁发人
  escort      text,                              -- 陪同（多行以换行分隔）
  note        text,                              -- rundown "Notes 注意事项" leftovers
  auto_scroll boolean not null default false,    -- roster: long list scrolls itself
  sort        int  not null default 0,
  status      text not null default 'active',    -- active | archived
  created_at  bigint not null default public.now_ms()
);
create index if not exists idx_segments_sort on public.segments(sort, id);

create table if not exists public.honourees (
  id          bigint generated always as identity primary key,
  segment_id  bigint not null references public.segments(id) on delete cascade,
  group_label text,          -- '服务15年以上' — roster groups; null = ungrouped
  name_zh     text not null,
  name_en     text,
  org         text,          -- 公司 / 学校 / 职衔
  sort        int not null default 0
);
create index if not exists idx_honourees_segment on public.honourees(segment_id, sort, id);

-- ---- stage state (in settings) --------------------------------------------
-- stageActive     '1' while /stage owns the big screen ('0' -> /stage returns to /screen)
-- stageSegmentId  id of the live segment ('' when none)
-- stageIndex      0-based honouree cursor for `award` segments (== count -> 合照 card)
insert into public.settings(key, value) values
  ('stageActive', '0'),
  ('stageSegmentId', ''),
  ('stageIndex', '0')
on conflict (key) do nothing;

-- ---- row level security ---------------------------------------------------
-- Same shape as sponsors (0001_init.sql): public read so the big screen needs no
-- session; writes only for a signed-in operator.
alter table public.segments  enable row level security;
alter table public.honourees enable row level security;

drop policy if exists "segments read" on public.segments;
create policy "segments read" on public.segments for select using (true);
drop policy if exists "segments write" on public.segments;
create policy "segments write" on public.segments for all
  to authenticated using (true) with check (true);

drop policy if exists "honourees read" on public.honourees;
create policy "honourees read" on public.honourees for select using (true);
drop policy if exists "honourees write" on public.honourees;
create policy "honourees write" on public.honourees for all
  to authenticated using (true) with check (true);

-- ---- realtime -------------------------------------------------------------
-- /stage re-reads a segment's honourees when the operator edits them live.
-- Idempotent add, matching the loop in 0001_init.sql.
do $$
declare t text;
begin
  foreach t in array array['segments', 'honourees'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
