-- MFEIA lobby — 拿督郑美昌 / YB 谢守钦 的肖像到位了，路径从占位的 .jpg 改成实际的 .png。
--
-- 这两张原图是**抠好背景的透明图**（Photo/ 里的 PNG），所以 assets/speaker/ 下存的是
-- PNG 而不是 JPEG：JPEG 没有 alpha，透明区会被填成黑块或白块糊在深色大屏上。
-- 另外两位（吴万安 / 张福宝）是棚拍灰底，照旧 JPEG（小得多），路径不动。
--
-- 只改「还指着 0012 写的那条占位 .jpg」的行：现场若已用运维台的「照片」按钮传过图
-- （photo_url 是 Storage 的 https 直链），这条不会把它盖掉。可反复执行。
update public.honourees h
set photo_url = v.url
from (values
  ('拿督郑美昌', '/speaker/dato-richard-teh.jpg', '/speaker/dato-richard-teh.png'),
  ('YB 谢守钦',  '/speaker/yb-allex-seah.jpg',   '/speaker/yb-allex-seah.png')
) as v(name_zh, old_url, url)
where h.name_zh = v.name_zh
  and h.photo_url = v.old_url;
