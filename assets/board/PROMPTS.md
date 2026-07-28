# 机器人举牌模板 — 生成规格（一次性离线产出）

大屏（`/screen`）在环节上台时叠出这张图，**牌面上的中英标题由代码实时写上去**，
所以全场 19 个环节**只需要这一张图**，临场改环节名字大屏跟着变，不用重新出图。
（时间、副标题、备注是流程表的内部信息，只在运维台看得到，不上牌面。）

- 文件：`assets/board/robot.png`（运行时路径 `/board/robot.png`）
- **缺文件也能跑**：加载不到就退回一张普通文字卡，绝不留空。

## 关键：牌面必须留空
参考图里的 `STEP 05`、餐盘图标、`晚宴正式开始` 都要**去掉**——那块是给代码写标题的。
牌面留一块干净的深色玻璃面板即可（可以有细微网格/扫描线纹理，但**不要任何文字、数字、图标**）。

## 构图（决定文字对不对得准）
- 画布：**横向 3:2**（如 1536×1024）。
- **牌子在左、机器人在右**，机器人双手扶/托着牌子，半身入镜。
- 牌面（可写字的深色区域）占据画面**左侧约 10%–58% 宽、13%–78% 高**——
  和参考图一致即可，不必分毫不差：对不准时改 `apps/screen/style.css` 里
  `#segment-card` 的 `--board-left / --board-top / --board-width / --board-height`
  四个百分比就能对齐。
- 背景：深蓝科技感（同心圆 HUD 光环、电路纹理），**不要**做成透明。

## 提示词（Prompt）
```
futuristic black-and-blue mech robot holding a large blank holographic sign board,
robot on the right, sign board on the left occupying the left half of the frame,
EMPTY dark glass panel with glowing cyan border, no text no numbers no icons on the board,
glossy black armor with electric blue neon glow lines, glowing blue eyes,
dark blue tech background with concentric HUD rings and circuit patterns,
cinematic lighting, ultra detailed, 3:2 landscape
```

## 负面提示词（Negative）
```
text, letters, numbers, chinese characters, words, watermark, logo, icons on the board,
cluttered board, busy foreground, low contrast, warm colors, white background
```

## 出图后
1. 存成 `assets/board/robot.png`，刷新 `/screen`。
2. 上台一个环节，看牌面文字有没有压在边框上；有偏差就调上面那四个 CSS 百分比变量。
3. 字号统一由 `--art-h` 换算，改 `--art-h` 就是整体放大/缩小，版式比例不变。
