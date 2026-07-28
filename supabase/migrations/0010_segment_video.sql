-- MFEIA lobby — 环节短片：颁发感谢状给赞助商之前先放一段赞助商短片。
--
-- 和 0009 的 image_url 不同，这里存的是**路径**而不是上传的文件：视频动辄几十上百 MB，
-- 走 Storage 既碰上单文件上限，浏览器端还要先转 base64（内存扛不住）。视频丢进
-- assets/video/ 就能用（Vite 的 publicDir，运行时是 `/video/xx.mp4`），要挂 CDN 直链
-- 也是同一个字段。
--
-- 用法：新建一个环节（如「赞助商短片」）排在感谢状前面，填上路径，点「▶ 上台」即播。
alter table public.segments add column if not exists video_url text;

comment on column public.segments.video_url is
  '环节短片路径（`/video/xx.mp4` 或外部直链）。上台即播，播完停在最后一帧。null = 不放片。';
