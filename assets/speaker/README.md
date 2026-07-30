# 致辞讲者肖像

致辞环节上台时，讲者照片在左、姓名 + 职衔在右（版式见 `apps/screen/segments/panes.css` 的
`.pane-speech.has-photo`）。照片**直接丢进这个目录**，不走上传、不进 Supabase Storage。
这里是 Vite 的 `publicDir`（`vite.config.ts`），所以 `assets/speaker/goh-ban-ann.jpg`
的运行时路径就是 **`/speaker/goh-ban-ann.jpg`** —— 跟着代码一起部署，断网也照样显示。

## 文件名 ↔ 讲者

`honourees.photo_url` 由 `supabase/migrations/0012_speech_photo_paths.sql` 按姓名写死成这些路径
（其中两张改成 PNG，见 `0014_speech_photo_png.sql`），**改名字要连迁移一起改**。文件名用 ASCII slug
（罗马拼音）而不是中文 —— 中文进 URL 要转义，线上部署容易出岔子。

格式看原图：棚拍灰底的走 JPEG（约 100KB）；**抠好背景的透明图必须存 PNG**（约 1.2MB）——
JPEG 没有 alpha，透明区会被填成黑块或白块糊在深色大屏上。`resize-photo.ps1` 会自己判断，
发现是透明图就把输出扩展名换成 .png 并提示。

| 讲者 | 环节 | 文件 | 原图 |
| --- | --- | --- | --- |
| 吴万安 GOH BAN ANN | 大会主席致欢迎词 | `goh-ban-ann.jpg` | 棚拍灰底 |
| 拿督郑美昌 Dato' Richard Teh | 马来西亚机器厂商总会会长致词 | `dato-richard-teh.png` | 透明抠图 |
| YB 谢守钦 YB Allex Seah | 晚宴主宾致词 | `yb-allex-seah.png` | 透明抠图 |
| 张福宝 CHONG FOOK POH | 筹委会主席致谢词 | `chong-fook-poh.jpg` | 棚拍灰底 |

四位齐了。原图都在项目根目录的 `Photo/`（按中文姓名命名），要重出图直接拿那里的。

**万一某张图丢了也不会碎图** —— 加载失败时致辞版式自动退回纯文字居中版式
（`apps/screen/segments/presenter.ts` 的 `onerror`），和没配照片时一模一样。

## 补一张照片

原始棚拍肖像（`Photo/` 里那批 2630×3946、4~6MB）太大，缩一下再放进来：

```powershell
scripts\resize-photo.ps1 -In "Photo\拿督郑美昌.png" -Out "assets\speaker\dato-richard-teh.png"
```

默认输出高 1200px：灰底原图走 JPEG（q88，约 100~300KB），透明抠图走 PNG（约 1.2MB，脚本自动切换）。
为什么是 1200：版式里照片高 `min(54vh, 34vw)`，1080p ≈ 583px、4K ≈ 1166px，1200 两边都够。
**竖构图（2:3 半身像）最合版式** —— `width: auto` 保持原比例，不裁切。

放进来之后不用改数据库：路径已经在迁移里了，文件到位刷新大屏即可。

## 现场临时换图

运维台 →「环节 & 名单管理」→ 选致辞环节 → 名单里那一行的「照片」按钮，
上传的图进 Supabase Storage，`photo_url` 会被换成 https 直链、盖掉这里的打包路径。
要退回打包路径：先在同一个按钮上「移除」，再重跑一次
`supabase db push`（0012 只在 `photo_url is null` 时写，所以可反复执行）。
