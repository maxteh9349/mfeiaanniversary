-- MFEIA lobby — 环节照片：环节进行时直接叠在大厅大屏（/screen）上，不再切换页面。
--
-- 0006_stage.sql 的 /stage 是一整页接管大屏：上台 -> 跳到 /stage，结束 -> 跳回
-- /screen。现场希望大屏画面保持不变（3D 场景、签到人数、赞助商都留着），环节
-- 进行时只要把一张事先排好的图片叠上去即可。图片存 Supabase Storage 的 `uploads`
-- 公开桶（和赞助商 logo / 奖品图同一条上传路径），这里只记 URL。
--
-- /stage 仍然可用（文字排版版本），此列留空对它没有任何影响。
alter table public.segments add column if not exists image_url text;

comment on column public.segments.image_url is
  '环节大图（叠加在 /screen 上）。null = 没上传，大屏回退到标题文字卡。';
