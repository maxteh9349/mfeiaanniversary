-- MFEIA lobby — 「大会主席致欢迎词PPT」（8.13pm，kind=slides）灌入会长 PPT 的第 2~10 页。
--
-- 第 1 页**故意不放**：那是他的标题页（姓名 + 职衔 + 肖像），前一个环节 8.12pm 的致辞版式
-- 已经在演同一件事，连着放会重复。所以这个环节从正文第 2 页起，共 9 页。
--
-- 一页 = 一条 honourees 记录（图在 photo_url，sort 是页序），翻页复用逐位颁奖那套游标
-- （上一位 / 下一位、← →、跳转、自动播放）—— 机制见 assets/slides/README.md。
-- name_zh 沿用**原始 PPT 的页码**（第 2 页…第 10 页），运维台名单里一眼对得上源文件。
--
-- 图是打包资源 assets/slides/president/02.jpg …，由 scripts/resize-photo.ps1 从
-- 会长致辞PPT/*.png（1920×1080）转出。按 photo_url 去重，可反复执行；
-- 现场删掉某几页后重跑会把它们补回来。
insert into public.honourees(segment_id, name_zh, photo_url, sort)
select s.id, '第 ' || n || ' 页', '/slides/president/' || lpad(n::text, 2, '0') || '.jpg', n - 2
from public.segments s, generate_series(2, 10) as n
where s.title_zh = '大会主席致欢迎词PPT'
  and not exists (
    select 1 from public.honourees h
    where h.segment_id = s.id and h.photo_url = '/slides/president/' || lpad(n::text, 2, '0') || '.jpg'
  );
