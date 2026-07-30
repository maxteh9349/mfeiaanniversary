# 第二十三届理事肖像

「第二十三届理事就职」逐位上台时，这一位的照片在左、姓名 / 英文名 / 职衔那一栏在右
（版式见 `apps/screen/segments/panes.css` 的 `.pane-award.has-photo`，与致辞版式共用同一套
蒙版与尺寸旋钮）。照片**直接放在这个目录**，不走上传、不进 Supabase Storage ——
这里是 Vite 的 `publicDir`，`assets/committee/goh-ban-ann.jpg` 的运行时路径就是
**`/committee/goh-ban-ann.jpg`**，跟着代码一起部署，断网也照样显示。

## 文件名 ↔ 理事

文件名是各人**英文名的小写连字符形式**（`GOH BAN ANN` → `goh-ban-ann.jpg`），
`honourees.photo_url` 由 `supabase/migrations/0016_committee_photos.sql` 按英文名写死成这些路径。
**改英文名要连迁移一起改。**

24 位齐全，上台次序（`0015_committee_sworn_in_order.sql` 定的，会长先上）：

| # | 理事 | 文件 | # | 理事 | 文件 |
| --- | --- | --- | --- | --- | --- |
| 1 | 吴万安（会长） | `goh-ban-ann.jpg` | 13 | 赖志钦 | `lai-chee-khim.jpg` |
| 2 | 张福宝（署理会长） | `chong-fook-poh.jpg` | 14 | 陈志明 | `tan-kiam-beng.jpg` |
| 3 | 李虎金 | `lee-hoo-kim.jpg` | 15 | 张怡泰 | `david-tyo-yee-thye.jpg` |
| 4 | 唐焙初 | `tong-poy-chua.jpg` | 16 | 郑闰中 | `teh-nun-chong.jpg` |
| 5 | 方光国 | `william-fang-kong-kok.jpg` | 17 | 李世涛 | `lee-soo-tau.jpg` |
| 6 | 莫壮春 | `mok-tuang-soon.jpg` | 18 | 卢兴利 | `thomas-low-heng-lee.jpg` |
| 7 | 王俊祥 | `ong-choon-siang.jpg` | 19 | 周志坚 | `desmond-chu-chee-keen.jpg` |
| 8 | 吴锦荣 | `goh-kim-leong.jpg` | 20 | 默敏·安博斯 | `mervyn-ambrose.jpg` |
| 9 | 曾伟翌 | `chan-wee-yih.jpg` | 21 | 熊家良 | `hong-yeam-liang.jpg` |
| 10 | 蔡耀琨 | `choy-yew-kwan.jpg` | 22 | 叶名康 | `yap-min-kang.jpg` |
| 11 | 陈金福 | `tan-kim-hock.jpg` | 23 | 梁其富 | `leong-kee-foo.jpg` |
| 12 | 陈福成 | `tan-hock-seng.jpg` | 24 | 黄汉明 | `wee-han-meng.jpg` |

**某张图丢了也不会碎图** —— 加载失败时这一位自动退回纯文字居中版式
（`apps/screen/segments/presenter.ts` 的 `mountPanePhoto`），和没配照片时一模一样，
后面几位照常显示。

## 重出 / 补一张

原图在项目根目录 `Photo/`（按中文姓名，2630×3946、4~6MB），缩一下再放进来：

```powershell
scripts\resize-photo.ps1 -In "Photo\吴万安.jpg" -Out "assets\committee\goh-ban-ann.jpg"
```

输出高 1200px 的 JPEG（q88，约 85~135KB，24 张合计 2.3MB）。竖构图半身像最合版式。
放进来不用改数据库：路径已经在迁移里了，文件到位刷新大屏即可。

现场要临时换某一位的图：运维台 →「环节 & 名单管理」→ 选这个环节 → 该行的「照片」按钮，
上传的图存进 Storage 并盖掉这里的打包路径；点「移除」再重跑 `0016` 即可退回打包路径
（迁移只写 `photo_url is null` 的行，可反复执行）。
