# 环节幻灯片（PPT 导出的整屏图）

一页 = 一张整屏图，**手动一页页翻**（也可以交给自动播放）。这里是 Vite 的 `publicDir`，
所以 `assets/slides/president/01.jpg` 的运行时路径就是 `/slides/president/01.jpg`，
跟着代码部署，断网也在。

## 机制（为什么没有单独的「幻灯片表」）

环节类型选 **幻灯片**（`segments.kind = 'slides'`）之后：

- **一页 = 名单里的一条记录**，图存在 `honourees.photo_url`，`sort` 就是页码顺序 ——
  于是运维台「环节 & 名单管理」的加 / 删 / ↑↓ 调序 / 换图，天然就是幻灯片的页面管理；
- **翻页复用逐位颁奖那套游标**（`stage.index`）：上一位 / 下一位、键盘 ← →、
  跳至第 N 页、▶ 自动播放，一个都不用另做；
- 大屏走的是与「环节大图」完全相同的整屏显示路径（`apps/screen/main.ts` 取图那一段），
  过场动画、HUD 淡出、底色全都一致。

翻到最后一页就停（不像逐位颁奖那样多一张「合照」空卡）。

## 加一套新的幻灯片

1. PPT 里「另存为图片」导出 1920×1080 的 PNG，放进 `会长致辞PPT/` 这类源目录（不进 git 也行）。
2. 转成大屏用的 JPEG：
   ```powershell
   foreach ($n in 1..10) {
     scripts\resize-photo.ps1 -In "会长致辞PPT\$n.png" -Out ("assets\slides\president\{0:D2}.jpg" -f $n) -Height 1080
   }
   ```
   1920×1080 的 PNG 转完约 100~400KB，10 页合计约 2.5MB。
3. 运维台新建环节 → 类型选**幻灯片** → 名单里每页加一条（姓名填「第 N 页」当标签，
   用该行的「照片」按钮上传，或像本目录这样走打包路径 + 一条迁移写死 `photo_url`）。

## 现有的几套

| 目录 | 用在哪个环节 | 页数 | 迁移 |
| --- | --- | --- | --- |
| `president/` | 8.12pm 大会主席致欢迎词 | 10 | `0017_president_speech_slides.sql` |
