-- MFEIA lobby — 把四位致辞讲者的肖像指向**打包进 assets/ 的图**，而不是上传到 Storage。
--
-- 0011 给 honourees 加了 photo_url，但它只认「上传」这一条路（Supabase Storage 的 https 直链）。
-- 讲者肖像是开场前就定下来的四张固定图，跟着代码部署更稳：assets/ 是 Vite 的 publicDir，
-- assets/speaker/goh-ban-ann.jpg 的运行时路径就是 /speaker/goh-ban-ann.jpg，断网也显示。
-- 所以 photo_url 这一列现在有两种取值：
--   /speaker/xxx.jpg          → 打包资源（本迁移写的，见 assets/speaker/README.md）
--   https://…/portrait-….jpg  → 运维台「照片」按钮上传到 Storage 的（现场换图走这条）
-- 大屏两种都当普通 <img src> 用，不区分。
--
-- 只在 photo_url is null 时写，于是：
--   * 可反复执行 —— `supabase db push` 不会冲掉现场刚上传的图；
--   * 现场误点了「移除」，重跑一次迁移就恢复成打包路径。
-- 按 kind + name_zh 定位而不是写死 id：id 是 0007 的 seed 生成的，各环境不一定一样。
--
-- 照片还没到位的那两位（拿督郑美昌 / YB 谢守钦）先把路径占上：文件缺失时致辞版式会退回
-- 纯文字居中版式（见 apps/stage/presenter.ts 的 onerror），不会在大屏上留一个碎图框。
update public.honourees h
set photo_url = v.url
from (values
  ('吴万安',      '/speaker/goh-ban-ann.jpg'),
  ('拿督郑美昌',  '/speaker/dato-richard-teh.jpg'),
  ('YB 谢守钦',   '/speaker/yb-allex-seah.jpg'),
  ('张福宝',      '/speaker/chong-fook-poh.jpg')
) as v(name_zh, url)
where h.name_zh = v.name_zh
  and h.photo_url is null
  and exists (
    select 1 from public.segments s
    where s.id = h.segment_id and s.kind = 'speech'
  );
