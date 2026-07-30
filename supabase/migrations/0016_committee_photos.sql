-- MFEIA lobby — 第二十三届理事就职：24 位理事的肖像。
--
-- 与致辞讲者（0012）同一条路子：图**打包进 assets/**，不走 Storage 上传 —— 跟着代码部署，
-- 断网也显示。assets 是 Vite 的 publicDir，所以 assets/committee/goh-ban-ann.jpg 的运行时
-- 路径就是 /committee/goh-ban-ann.jpg。原图在项目根目录 Photo/（按中文姓名），
-- 用 scripts/resize-photo.ps1 缩成高 1200px 的 JPEG。
--
-- 逐位颁奖版式（apps/screen/segments/）现在也会显示照片：有照片的这一位照片在左、
-- 姓名那栏在右；没照片的仍是原来的居中版式，所以同一环节里混着有图 / 没图也不会错位。
--
-- 按 name_en 匹配 + 限定在就职环节内（同 0015 的理由）；只写 photo_url is null 的行，
-- 于是可反复执行，且不会盖掉现场用运维台「照片」按钮传上去的图。
update public.honourees h
set photo_url = v.url
from (values
  ('GOH BAN ANN',           '/committee/goh-ban-ann.jpg'),
  ('CHONG FOOK POH',        '/committee/chong-fook-poh.jpg'),
  ('LEE HOO KIM',           '/committee/lee-hoo-kim.jpg'),
  ('TONG POY CHUA',         '/committee/tong-poy-chua.jpg'),
  ('WILLIAM FANG KONG KOK', '/committee/william-fang-kong-kok.jpg'),
  ('MOK TUANG SOON',        '/committee/mok-tuang-soon.jpg'),
  ('ONG CHOON SIANG',       '/committee/ong-choon-siang.jpg'),
  ('GOH KIM LEONG',         '/committee/goh-kim-leong.jpg'),
  ('CHAN WEE YIH',          '/committee/chan-wee-yih.jpg'),
  ('CHOY YEW KWAN',         '/committee/choy-yew-kwan.jpg'),
  ('TAN KIM HOCK',          '/committee/tan-kim-hock.jpg'),
  ('TAN HOCK SENG',         '/committee/tan-hock-seng.jpg'),
  ('LAI CHEE KHIM',         '/committee/lai-chee-khim.jpg'),
  ('TAN KIAM BENG',         '/committee/tan-kiam-beng.jpg'),
  ('DAVID TYO YEE THYE',    '/committee/david-tyo-yee-thye.jpg'),
  ('TEH NUN CHONG',         '/committee/teh-nun-chong.jpg'),
  ('LEE SOO TAU',           '/committee/lee-soo-tau.jpg'),
  ('THOMAS LOW HENG LEE',   '/committee/thomas-low-heng-lee.jpg'),
  ('DESMOND CHU CHEE KEEN', '/committee/desmond-chu-chee-keen.jpg'),
  ('MERVYN AMBROSE',        '/committee/mervyn-ambrose.jpg'),
  ('HONG YEAM LIANG',       '/committee/hong-yeam-liang.jpg'),
  ('YAP MIN KANG',          '/committee/yap-min-kang.jpg'),
  ('LEONG KEE FOO',         '/committee/leong-kee-foo.jpg'),
  ('WEE HAN MENG',          '/committee/wee-han-meng.jpg')
) as v(name_en, url)
where h.name_en = v.name_en
  and h.photo_url is null
  and h.segment_id in (
    select s.id from public.segments s where s.title_zh like '%第二十三届理事就职%'
  );
