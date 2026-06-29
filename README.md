# MFEIA 49 周年 · AI 虚拟社交大厅

活动现场大屏互动签到系统：嘉宾扫码签到 → 大屏中央传送门生成虚拟形象 →
形象走入虚拟社交空间并互动。本地优先 / 离线运行。

## 技术栈
- 大屏：Three.js + Vite + TypeScript（`apps/screen`）
- 签到页：手机端 Web 表单（`apps/checkin`）
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

## 导入预登记名单
```bash
npm run import -- data/guests.csv   # 列：name,company,gender,role（仅 name 必填，可重复导入去重）
```

## 线上部署（GitHub + Supabase + Cloudflare Pages）
前端是纯静态多页，后端通过 `apps/shared/backend.ts` 抽象：构建变量 `VITE_BACKEND`
选择 `local`（默认，Express+SQLite）或 `supabase`。本地离线版完全保留作后备。

### 1. 建 Supabase 项目
1. 在 supabase.com 新建项目，记下 **Project URL** 与 **anon key**（Settings → API）。
2. SQL Editor 运行 `supabase/migrations/0001_init.sql`（建表 + RLS + `checkin_guest` RPC +
   `uploads` 存储桶 + Realtime）。
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
