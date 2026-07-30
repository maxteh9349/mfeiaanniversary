-- MFEIA lobby — 得奖者职衔：逐位颁奖时在姓名**下面**多一行头衔（如「第五任会长」）。
--
-- 为什么不塞进 org：org 那一行是公司 / 学校（「P&P TECH SDN BHD」），职衔是另一回事 ——
-- 同一位既是 P&P TECH 的人、又是本会第五任会长，两条都要出现在大屏上，只有一个字段就得
-- 二选一。分开一列之后，运维台改职衔不动公司名，版式也能各自给字号 / 颜色。
--
-- 空着 = 这一位不显示职衔（绝大多数人都是），版式靠 :empty 自动收起，不留空行。
-- 名单版式（roster）不读它 —— 整屏名单里的「会长 / 署理会长」照旧写在 org。
alter table public.honourees add column if not exists role_label text;

comment on column public.honourees.role_label is
  '职衔 / 任期（如「第五任会长」），逐位颁奖版式里显示在姓名下方。null = 不显示这一行。';

-- 现场数据：长期服务奖里的彭刚浚（服务 20 年以上 / 功勋卓著两格都是他）是本会第五任会长。
-- 按姓名 + 公司匹配而不是写死 id（0007 的种子 id 是生成的）；`role_label is null` 让它可重跑，
-- 也不会盖掉之后在运维台手改的内容。
update public.honourees set role_label = '第五任会长'
where name_zh = '彭刚浚' and org = 'P&P TECH SDN BHD' and role_label is null;
