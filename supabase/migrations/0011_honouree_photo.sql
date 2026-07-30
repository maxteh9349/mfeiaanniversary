-- MFEIA lobby — 致辞人照片：致辞环节上台时，讲者照片与姓名 / 职衔并排显示。
--
-- 与 0009 的 segments.image_url（整张排好的环节大图，直接铺满大屏）不同：这一列存的是
-- **单人肖像**，大屏仍然走 apps/stage/panes.css 的致辞版式，照片只是版式里的一格。
-- 好处是临场改名字 / 改职衔大屏跟着变，不用重新出图。
--
-- 图片存 Supabase Storage 的 `uploads` 公开桶（和赞助商 logo / 奖品图 / 环节大图同一条
-- 上传路径），这里只记 URL。
--
-- 目前只有致辞版式会读它；逐位颁奖等其它版式留空即可，对它们没有任何影响。
alter table public.honourees add column if not exists photo_url text;

comment on column public.honourees.photo_url is
  '人物肖像（致辞版式里与姓名并排）。null = 没上传，版式退回纯文字。';
