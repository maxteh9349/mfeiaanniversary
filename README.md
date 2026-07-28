# MFEIA 49 周年 · AI 虚拟社交大厅

活动现场大屏互动签到系统：嘉宾扫码签到 → 大屏中央传送门生成虚拟形象 →
形象走入虚拟社交空间并互动。本地优先 / 离线运行。

## 技术栈
- 大屏：Three.js + Vite + TypeScript（`apps/screen`）
- 签到页：手机端 Web 表单（`apps/checkin`）
- 幸运抽奖大屏：`apps/draw`
- 晚宴流程环节大屏：`apps/stage`（致辞 / 就职名单 / 逐位颁奖 / 赞助商感谢状）
- 运维台：`apps/admin`
- 后端：Node + Express + WebSocket（`server/`），数据用 **Node 内置 `node:sqlite`**（无需原生编译）

## 开发
```bash
npm install
npm run dev          # 同时起后端(:8080) + Vite(:5173)，Vite 代理 /api 和 /ws
```
开发时各页面：`http://localhost:5173/apps/screen/`、`.../checkin/`、`.../admin/`

## 现场运行（生产 / 离线）
```bash
npm run build        # 构建三个前端到 dist/
npm start            # 单进程：后端 + 托管 dist（默认 :8080，可用 PORT 覆盖）
```
- 大屏浏览器全屏打开 `http://localhost:8080/screen`
- 手机签到：扫大屏二维码，或访问启动日志打印的 `http://<局域网IP>:8080/checkin`
- 运维台：`http://localhost:8080/admin`
- 幸运抽奖大屏：`/draw`；晚宴流程环节大屏：`/stage`（两者与抽奖模块一样仅在
  Supabase 后端下可用，本地 Express 模式会明确报错）

## 晚宴流程环节
按 2026 年 49 周年晚宴流程表（Rundown）把每个环节做成大屏画面。**默认走叠加**：
环节上台时 `/screen` 保持不动（3D 场景压暗、标题栏 / 签到人数 / 赞助商照常显示），
只把该环节的图片叠在中间；结束就淡出，投影全程不用换页面。

- 图片在运维台「环节 & 名单管理」里逐个环节上传（存 Supabase `uploads` 桶，字段
  `segments.image_url`，见 `0009_segment_image.sql`）；格子墙上标「已配图」。
- 没上传专属图片的环节走**机器人举牌**：`assets/board/robot.png` 是一张牌面留空的
  模板图，全场共用；**中英标题由代码实时写在牌面上**，临场改环节名字大屏跟着变，
  不用重新出图（出图规格见 `assets/board/PROMPTS.md`）。大屏只显示中英标题 ——
  时间、副标题、备注是流程表的内部信息（如「播放 AI 短片」），只留在运维台。牌面文字区靠
  `apps/screen/style.css` 里 `#segment-card` 的 `--board-left/top/width/height` 四个
  百分比对位，`--art-h` 控整体大小，`--title-size` / `--title-en-size` 控中英标题字号
  （全场统一，不随字数缩放；卡片宽高写死，换环节时框不动只换字）。模板缺失时退回
  一张普通文字卡，绝不留空。
- **环节短片**：视频丢进 `assets/video/`，运维台在该环节填一行路径
  （`/video/sponsor.mp4`，也可填外部直链）即可。上台即播、播完停在最后一帧等切换；
  用于「颁发感谢状给赞助商」前先放赞助商短片这种场合。不走上传，因此没有 Storage
  单文件上限。声音需要开场前在大屏上点一下解锁（浏览器策略），忘了点会先静音播放
  并在画面下方提示。详见 `assets/video/README.md`。
- 叠加期间签到照常记录，只是**不弹**全屏欢迎海报，免得盖住台上画面。

`/stage` 是另一块可选的整页版式（`title` 过场标题、`speech` 致辞、`roster` 整屏名单、
`award` 逐位颁奖、`sponsor_thanks` 赞助商感谢状），需要文字排版时另开一块屏用；
它不读环节图片，与上面的叠加互不影响。

- 运维台「晚宴流程 · 环节控制台」把整场流程平铺成**格子墙**：每格显示时间、标题、
  类型与名单人数；点格子选中，格子内 `▶ 上台` 才切大屏（防现场误点）。正在播的
  格子金色高亮，已播过的打勾变暗（存在 `segments.aired_at`，刷新/换机器都保留，
  可用「清除已播标记」重置，「一键清除全部数据」也会清）。
- `award` 环节用 **上一位 / 下一位**（或键盘 `←` `→`）逐位点名，格子上直接显示
  「第 7 / 14 位」进度条；翻到最后一位之后是「合照」收尾卡。
- 环节状态存在 `settings`（`stageActive` / `stageSegmentId` / `stageIndex`），既是
  实时指令也是恢复状态：大屏中途刷新仍停在同一环节的同一位。
- **返回大厅大屏 ↩** 收起 `/screen` 的叠加层（若开着 `/stage`，它同时跳回 `/screen`）。
- 名单由 `supabase/migrations/0007_stage_seed.sql` 从流程表灌入，运维台
  「环节 & 名单管理」可临场增删改与调序。

## 导入预登记名单
```bash
npm run import -- data/guests.csv   # 列：name,company,gender,role（仅 name 必填，可重复导入去重）
```

## 线上部署（GitHub + Supabase + Cloudflare Pages）
前端是纯静态多页，后端通过 `apps/shared/backend.ts` 抽象：构建变量 `VITE_BACKEND`
选择 `local`（默认，Express+SQLite）或 `supabase`。本地离线版完全保留作后备。

### 1. 建 Supabase 项目
1. 在 supabase.com 新建项目，记下 **Project URL** 与 **anon key**（Settings → API）。
2. SQL Editor 按序运行 `supabase/migrations/` 下的全部脚本（`0001_init.sql` 建表 + RLS +
   `checkin_guest` RPC + `uploads` 存储桶 + Realtime；`0002`–`0005` 抽奖模块；
   `0006_stage.sql` + `0007_stage_seed.sql` 晚宴流程环节与名单，`0008` 已播标记，
   `0009_segment_image.sql` 环节大图）。
3. Authentication → Users → **Add user**，创建一个运维台管理员（邮箱+密码）。

### 2. 本地连云端自测
```bash
cp .env.example .env        # 填入 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY，VITE_BACKEND=supabase
npm run dev:web             # 仅前端；签到→大屏经 Realtime 即时生成，运维台需登录
npm run import:supabase -- data/guests.csv   # 可选：导入预登记名单（需 .env 里的 SERVICE ROLE key）
```

### 3. 部署到 Cloudflare Pages（或 Vercel）
- 推送到 GitHub，连接 Cloudflare Pages：**Build command** `npm run build`，**Output** `dist`。
- Pages 项目里配置环境变量：`VITE_BACKEND=supabase`、`VITE_SUPABASE_URL`、
  `VITE_SUPABASE_ANON_KEY`、`VITE_PUBLIC_ORIGIN=<你的站点域名>`。
- 友好路由（`/checkin`、`/screen`、`/admin`）由 `assets/_redirects`（Cloudflare）或
  `vercel.json`（Vercel）重写到 `apps/*/index.html`。
- 部署后：手机用流量打开 `<站点>/checkin` 签到，大屏开 `<站点>/screen`，运维台 `<站点>/admin`。

## 里程碑
- [x] **M1** 骨架：本地服务 + WebSocket + 签到页 + 大屏场景 + HUD，签到即时触发占位形象生成
- [ ] M2 传送门光圈 + 粒子生成特效 + GLB 角色加载 + 名字标签
- [ ] M3 行为状态机 + 群体/走动/互动 + 聊天气泡
- [ ] M4 HUD 细化 + 统计完善
- [ ] M5 运维台增强 + 性能上限/Lite 模式 + 压测
- [ ] M6 现场彩排
