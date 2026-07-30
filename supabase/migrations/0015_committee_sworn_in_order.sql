-- MFEIA lobby — 第二十三届理事就职：叫号次序改成「流程表**从下往上**」。
--
-- 0007 的种子是照流程表打印顺序灌的（黄汉明 → … → 张福宝 → 吴万安）。现场定的是
-- 倒过来叫：**会长先上台**，最后一位是黄汉明。这个环节是 award（逐位颁奖），
-- honourees.sort 就是运维台「下一位」的叫号顺序，所以只覆盖 sort，姓名 / 英文名 /
-- 职衔（会长 PRESIDENT、署理会长 DEPUTY PRESIDENT 存在 org）一概不动。
--
-- 按 name_en 匹配：这 24 个英文名在本环节内唯一；同名的吴万安 / 张福宝还各自出现在
-- 致辞环节，靠下面的 segment_id 限定排除。另一个同名环节（移交选任状那一档）里的人
-- 全都没有英文名，也碰不到。可反复执行。
--
-- 注意：第 11~14 位（陈金福 / 陈福成 / 赖志钦 / 陈志明）与 0007 种子里的先后**不一样** ——
-- 以现场提供的这份名单为准。
update public.honourees h
set sort = v.ord
from (values
  ('GOH BAN ANN', 0), ('CHONG FOOK POH', 1), ('LEE HOO KIM', 2), ('TONG POY CHUA', 3),
  ('WILLIAM FANG KONG KOK', 4), ('MOK TUANG SOON', 5), ('ONG CHOON SIANG', 6),
  ('GOH KIM LEONG', 7), ('CHAN WEE YIH', 8), ('CHOY YEW KWAN', 9),
  ('TAN KIM HOCK', 10), ('TAN HOCK SENG', 11), ('LAI CHEE KHIM', 12),
  ('TAN KIAM BENG', 13), ('DAVID TYO YEE THYE', 14), ('TEH NUN CHONG', 15),
  ('LEE SOO TAU', 16), ('THOMAS LOW HENG LEE', 17), ('DESMOND CHU CHEE KEEN', 18),
  ('MERVYN AMBROSE', 19), ('HONG YEAM LIANG', 20), ('YAP MIN KANG', 21),
  ('LEONG KEE FOO', 22), ('WEE HAN MENG', 23)
) as v(name_en, ord)
where h.name_en = v.name_en
  and h.segment_id in (
    select s.id from public.segments s where s.title_zh like '%第二十三届理事就职%'
  );
