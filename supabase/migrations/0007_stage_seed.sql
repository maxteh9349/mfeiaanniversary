-- MFEIA lobby — seed the /stage programme from the printed rundown
-- ("2026 MFEIA 49th Annual Dinner Rundown", 3 pages, 2026-07-23).
--
-- Names were transcribed from the rundown; a handful of romanisations there are
-- ambiguous and are flagged with a NOTE comment beside them — check those against
-- the source spreadsheet and fix in the console (环节 & 名单管理) if needed.
--
-- Idempotent: seeds only when `segments` is empty, so re-running the migration
-- (or `supabase db push`) never duplicates the programme or clobbers live edits.

do $$
declare
  v_id bigint;
begin
  if exists (select 1 from public.segments) then
    raise notice 'public.segments is not empty — skipping rundown seed';
    return;
  end if;

  -- 6.40pm — 会员简讯轮播（会员公司由运维台补充）
  insert into public.segments(kind, time_label, title_zh, title_en, auto_scroll, sort)
    values ('roster', '6.40pm', '宴会厅两侧播放会员简讯',
            'Member Information Broadcast on Both Sides of the Banquet Hall', true, 10)
    returning id into v_id;

  -- 7.45pm — 开幕进场
  insert into public.segments(kind, time_label, title_zh, title_en, subtitle, note, sort)
    values ('title', '7.45pm', '正式开幕',
            'OPENING CEREMONY - Procession of VIPs',
            '全体顾问与理事进场仪式', '播放 Datuk Tan 的歌 · 逐位介绍贵宾', 20);

  -- 7.50pm — 国歌与州歌
  insert into public.segments(kind, time_label, title_zh, title_en, sort)
    values ('title', '7.50pm', '国歌 Negaraku 与马六甲州歌',
            'National anthem Negaraku and Melaka state songs', 30);

  -- 7.53pm — 司仪介绍贵宾 + AI 短片
  insert into public.segments(kind, time_label, title_zh, title_en, subtitle, sort)
    values ('title', '7.53pm', '司仪介绍与欢迎各位贵宾',
            'Emcee''s Welcome and Introduction of Distinguished Guests',
            '播放 AI 短片', 40);

  -- 7.57pm — 第二十三届理事就职（24 位）
  insert into public.segments(kind, time_label, title_zh, title_en, presenter, escort, note, sort)
    values ('roster', '7.57pm', '马六甲机器厂商公会第二十三届理事就职',
            'Sworn-in Ceremony for 23rd MFEIA Committees',
            '总务王俊祥代表宣读誓词',
            '监誓人：法律顾问拿督王乃志、马来西亚机器厂商总会会长拿督郑美昌、会务顾问彭刚浚',
            '理事们就位', 50)
    returning id into v_id;
  insert into public.honourees(segment_id, name_zh, name_en, org, sort)
  select v_id, zh, en, nullif(role, ''), ord
  from unnest(
    array['黄汉明','梁其富','叶名康','熊家良','默敏·安博斯','周志坚','卢兴利','李世涛',
          '郑闰中','张怡泰','陈金福','赖志钦','陈志明','陈福成','蔡耀琨','曾伟翌',
          '吴锦荣','王俊祥','莫壮春','方光国','唐焙初','李虎金','张福宝','吴万安'],
    array['WEE HAN MENG','LEONG KEE FOO','YAP MIN KANG','HONG YEAM LIANG',
          'MERVYN AMBROSE','DESMOND CHU CHEE KEEN','THOMAS LOW HENG LEE','LEE SOO TAU',
          'TEH NUN CHONG','DAVID TYO YEE THYE','TAN KIM HOCK','LAI CHEE KHIM',
          'TAN KIAM BENG','TAN HOCK SENG','CHOY YEW KWAN','CHAN WEE YIH',
          'GOH KIM LEONG','ONG CHOON SIANG','MOK TUANG SOON','WILLIAM FANG KONG KOK',
          'TONG POY CHUA','LEE HOO KIM','CHONG FOOK POH','GOH BAN ANN'],
    array['','','','','','','','','','','','','','','','','','','','','','',
          '署理会长 DEPUTY PRESIDENT','会长 PRESIDENT']
  ) with ordinality as t(zh, en, role, ord);

  -- 7.57pm — 移交选任状 / 纪念品 / 委任状（逐项上台）
  insert into public.segments(kind, time_label, title_zh, subtitle, presenter, escort, sort)
    values ('award', '7.57pm', '移交选任状 · 委任状 · 纪念品',
            '第二十三届理事就职典礼',
            '会长吴万安', '署理会长张福宝、王俊祥、子莹', 60)
    returning id into v_id;
  insert into public.honourees(segment_id, name_zh, org, sort)
  select v_id, zh, item, ord
  from unnest(
    array['现任理事会','拿督郑美昌','拿督王乃志局绅','拿督王乃志局绅律师','彭刚浚',
          'YB 谢守钦州议员','拿督林万锋州议员','廖德荣','江瑞财','雷原顺','朱富成','周亚东','彭刚浚'],
    array['移交选任状 · 由拿督王乃志律师代表移交，会长吴万安代表接领',
          '赠送纪念品给监誓人','赠送纪念品给监誓人',
          '移交委任状 · 法律顾问','移交委任状 · 会务顾问',
          '移交委任状 · 顾问','移交委任状 · 顾问',
          '移交委任状 · 名誉顾问','移交委任状 · 名誉顾问','移交委任状 · 名誉顾问',
          '移交委任状 · 名誉顾问','移交委任状 · 名誉顾问','移交委任状 · 名誉顾问']
  ) with ordinality as t(zh, item, ord);

  -- 8.12pm — 大会主席致欢迎词
  insert into public.segments(kind, time_label, title_zh, title_en, sort)
    values ('speech', '8.12pm', '大会主席致欢迎词', 'Speech by Chairman', 70)
    returning id into v_id;
  insert into public.honourees(segment_id, name_zh, name_en, org, sort)
    values (v_id, '吴万安', 'GOH BAN ANN', '马六甲机器厂商公会会长', 0);

  -- 8.22pm — 总会会长致词
  insert into public.segments(kind, time_label, title_zh, title_en, sort)
    values ('speech', '8.22pm', '马来西亚机器厂商总会会长致词',
            'Speech by the president of FOMFEIA', 80)
    returning id into v_id;
  insert into public.honourees(segment_id, name_zh, org, sort)
    values (v_id, '拿督郑美昌', '马来西亚机器厂商总会会长', 0);

  -- 8.32pm — 晚宴主宾致词 + 赠送纪念品
  insert into public.segments(kind, time_label, title_zh, title_en, subtitle, presenter, escort, sort)
    values ('speech', '8.32pm', '晚宴主宾致词', 'Speech by VIP',
            '致词后赠送纪念品', '会长吴万安', '署理会长张福宝', 90)
    returning id into v_id;
  insert into public.honourees(segment_id, name_zh, org, sort)
    values (v_id, 'YB 谢守钦', '马六甲州议员 · 晚宴主宾', 0);

  -- 8.42pm — 颁发结业证书（14 位）
  insert into public.segments(kind, time_label, title_zh, title_en, presenter, escort, sort)
    values ('award', '8.42pm', '颁发 2025/26 假期工业之旅结业证书',
            'Certificate Presentation Ceremony',
            'YB 谢守钦', '署理会长张福宝、Malim 华小董事', 100)
    returning id into v_id;
  insert into public.honourees(segment_id, name_zh, sort)
  select v_id, zh, ord
  from unnest(array[
    '林鲁璟','黄勇量','李韻嘉','李韻仪','丁子荣','李苑盈','彭胤翔',
    '沈嘉琳','余镇廷','李敏汘',           -- NOTE 李敏汘：末字在 PDF 中不清晰，请核对
    '江芷婕','江芷君','ETHAN TYO','CHLOE TYO'
  ]) with ordinality as t(zh, ord);

  -- 8.57pm — 颁发学业优良奖励金（23 位）
  insert into public.segments(kind, time_label, title_zh, title_en, presenter, escort, sort)
    values ('award', '8.57pm', '颁发会员子女学业优良奖励金',
            'Academic Excellence Award',
            '拿督王乃志',
            '人力资源发展组主任 默敏·安博斯 MERVYN AMBROSE、YB 谢守钦', 110)
    returning id into v_id;
  insert into public.honourees(segment_id, name_zh, name_en, sort)
  select v_id, zh, en, ord
  from unnest(
    array['王芷涵','吴杰胜','余杋燡','黄歆瑶','魏珈乐','张镇恒','周振宇','余镇廷',
          '曾婕仁','王嘉瑄','余铭柏','余彦禔','纪定煜','李滋禔','颜纤怡','颜上涵',
          '江芷君','王嘉乐','李泓兴','周振洋','江芷萱','蔡嘉文','吴宇萱'],
    array['Ailly Ong Zhi Hann','Goh Jecen','Jeremy Ee Sin Jee',
          'Evangeline Wee Chong Shin Tang',  -- NOTE 英文名偏长，疑与相邻列串行，请核对
          'Jayden Wee Jia Le','Tioh Zheng Hang','Chu Zen Ee','Justin Ee Zhen Teng',
          'Chan Jay Ren','Ong Chyin Shyuan','Jayden Ee Ming Bao','Janet Ee Yan Xuan',
          'Ashton Kee Ding Yu','Lee Zean',
          'Annabelle Gan Qian-Ii',           -- NOTE 尾字母疑为 Yi / li，请核对
          'Henry Gan Shan Han','Kung Zhi Jun','Ong Chyin Ler','Ivan Lee Hong Xing',
          'Chu Zen Young','Kung Zhi Xuan','Choy Kah Mun','Goh Yu Xuan']
  ) with ordinality as t(zh, en, ord);

  -- 9.12pm — 乐团第二阶段
  insert into public.segments(kind, time_label, title_zh, title_en, subtitle, sort)
    values ('title', '9.12pm', '音乐团经典歌曲演奏第二阶段',
            'Live Band classic songs performance session 2', '约 30 ~ 45 分钟', 120);

  -- 9.42pm — 长期服务奖 / 荣誉理事（分组名单）
  insert into public.segments(kind, time_label, title_zh, title_en, presenter, escort, sort)
    values ('roster', '9.42pm', '颁发长期服务奖 · 荣誉理事', 'Long Service Award',
            '会长吴万安', '署理会长张福宝', 130)
    returning id into v_id;
  insert into public.honourees(segment_id, group_label, name_zh, name_en, org, sort)
  select v_id, grp, zh, en, org, ord
  from unnest(
    array['服务 15 年以上 15+ years of service','服务 15 年以上 15+ years of service',
          '服务 15 年以上 15+ years of service','服务 15 年以上 15+ years of service',
          '服务 15 年以上 15+ years of service',
          '服务 20 年以上 20+ years of service','服务 20 年以上 20+ years of service',
          '服务 20 年以上 20+ years of service',
          '服务 25 年以上 25+ years of service',
          '服务 30 年以上 30+ years of service',
          '功勋卓著'],
    array['陈錄山','张怡泰','吴锦荣','霍明照','陈福成',
          '卢金明','彭刚浚','陈志明',
          '周亚东','李虎金','彭刚浚'],
    array['Tan Leck Sen','David Tyo Yee Thye','Goh Kim Leong','Wok Ming Chow','Tan Hock Seng',
          'Low Kim Lai','Pang Kong Woon','Tan Kiam Beng',
          'Chu Ah Tong','Lee Hoo Kim','Pang Kong Woon'],
    array['C T INDUSTRIAL ENGINEERING','KOON CHEONG ENGINEERING SDN BHD',
          'HER YI ENGINEERING SDN BHD','TOP MASTER ENGINEERING WORKS','SYKT TATA IRON WORKS',
          'MENG MUDGUARD','P&P TECH SDN BHD','HUP SHENG MACHINERY & INDUSTRY SDN BHD',
          'TONG CO MOTOR REPAIRS','KIM HENG METAL & CONSTRUCTION SDN BHD','P&P TECH SDN BHD']
  ) with ordinality as t(grp, zh, en, org, ord);

  -- 9.42pm — 移交感谢状给前会务顾问
  insert into public.segments(kind, time_label, title_zh, presenter, sort)
    values ('award', '9.42pm', '移交感谢状给前会务顾问', '会长吴万安', 140)
    returning id into v_id;
  insert into public.honourees(segment_id, name_zh, org, sort)
    values (v_id, '拿督陈保成', '前会务顾问', 0);

  -- 9.57pm — 筹委会主席致谢词
  insert into public.segments(kind, time_label, title_zh, title_en, sort)
    values ('speech', '9.57pm', '筹委会主席致谢词', 'Speech by organizing chairman', 150)
    returning id into v_id;
  insert into public.honourees(segment_id, name_zh, name_en, org, sort)
    values (v_id, '张福宝', 'CHONG FOOK POH', '马六甲机器厂商公会署理会长兼筹委会主席', 0);

  -- 10.02pm — 颁发支票
  insert into public.segments(kind, time_label, title_zh, title_en, presenter, escort, sort)
    values ('award', '10.02pm', '颁发支票给中华大会堂', 'Cheque Presentation',
            '会长吴万安', '署理会长张福宝、财政吴锦荣', 160)
    returning id into v_id;
  insert into public.honourees(segment_id, name_zh, sort)
    values (v_id, '马六甲中华大会堂', 0);

  -- 10.07pm — 赞助商感谢状
  insert into public.segments(kind, time_label, title_zh, title_en, subtitle, presenter, escort, sort)
    values ('sponsor_thanks', '10.07pm', '颁发感谢状给赞助商',
            'Presentation of Appreciation Plaques to Sponsors',
            '播放赞助商企业简介及宣传内容', '第一副会长李虎金', '总务王俊祥', 170)
    returning id into v_id;
  insert into public.honourees(segment_id, name_zh, sort)
  select v_id, zh, ord
  from unnest(array['VR GREEN MOTOR SDN BHD', 'EURO POWER LIFT TRUCK SDN BHD'])
    with ordinality as t(zh, ord);

  -- 10.22pm — 敬酒
  insert into public.segments(kind, time_label, title_zh, title_en, subtitle, sort)
    values ('title', '10.22pm', '敬酒', 'Toasting Of Gratitude to guests',
            '全体理事、会务顾问与顾问', 180);

  -- 10.37pm — 晚宴完毕（10.27pm 幸运抽奖走 /draw）
  insert into public.segments(kind, time_label, title_zh, title_en, subtitle, sort)
    values ('title', '10.37pm', '晚宴完毕', 'Farewell', '感谢各位嘉宾莅临', 190);
end $$;
