# 全息机甲身体模板 — 生成规格（一次性离线产出）

英雄揭幕卡（`apps/screen/avatar/heroCard.ts`）运行时把嘉宾照片的脸**本地合成**到这些机甲身体上。
身体模板**只需做一次**（离线、用任意 AI 绘图工具），不逐人生成、不联网。**缺图也能跑**——
缺失的编号会回退到代码绘制的程序化机甲剪影。

## 最快：只放一张 body0.png 即可（所有嘉宾共用）
现在的逻辑：缺少 `body{N}.png` 时**自动回退到 `body0.png`**。所以**只要放一张 `body0.png`**，全场嘉宾就都用它。
想多几种姿态再补 `body1.png…`。

## 当前模式：as-is（图自带头脸，所有人同一个）
代码现在对**模板图原样显示、不再叠加真人脸/发光圆环**。所以 `body0.png`**可以自带头/脸**（就用 image2 那种），
全场嘉宾都是这一个形象。**务必透明背景**（去掉灰底）。
> 若日后想恢复"每人不同真人脸"：改回"空头透明模板"，并在 `heroCard.ts` 把模板分支的脸合成打开。

## 文件规格
- 命名：`body0.png`（必需）；可选 `body1.png … body3.png`（按 `avatarId` 轮换），放在本目录。
- 画布：竖向 **2:3**（如 512×768 或更清晰的 1024×1536），**透明背景**（务必抠掉灰色/任何底色）。
- 构图：**全身正面、居中、站姿**，脚部贴近画布底边，**头部在顶部居中**。
- 风格参照你选中的那张：**光滑半透明蓝色机甲、霓虹描边（Tron 风）**。
- **头部留空/开放**：脖颈以上不要画脸——留一个**干净开放的头位**供合成真人脸。
  **不要在头顶/头部周围画发光环或光晕**（halo/ring），保持简洁现代。
  脸锚点（中心 x,y、半径）在 `heroCard.ts` 的 `FACE_ANCHORS` 里按编号配置，做完图后据实微调。
- 像素边缘干净（无白边/白底光晕），方便叠加。

## 统一风格提示词（Style，所有模板共用）
```
full body sleek glossy translucent blue mech suit, Tron-style sci-fi power armor,
front view, standing, glowing cyan neon edge lines, electric blue panels,
clean modern look, OPEN EMPTY neck / no head (headless, no face, no hair),
transparent background, centered, feet at bottom,
high detail, consistent soft front lighting, no text
```
> 关键：**不要画头/脸/头发**——脖子以上留空，真人脸由系统合成上去。脸的落点在
> `heroCard.ts` 的 `FACE_ANCHORS`（默认中心约 360,200、半径 78），放图后我再据实微调。
> 每个模板用色板里不同的强调色（亮青 / 电气蓝 / 紫罗兰 / 洋红），与代码 `ACCENTS` 呼应，保证多彩。

## 模板变体（每个换姿态，Style 不变）
- body0：双臂自然垂立，胸口能量核心发光
- body1：抱臂自信站姿
- body2：单手叉腰，另一手垂下
- body3：双手微张（像在交谈/欢迎）

## 负面提示词（Negative）
```
face, human head, glowing halo, ring above head, realistic photo, white background,
dark dull colors, harsh shadows, cropped feet, text, watermark, extra limbs,
blurry edges, busy background
```

## 接入
PNG 放进本目录后，前端合成英雄卡时自动加载 `bodyN.png`；缺失编号回退程序化剪影，无需改代码。
> 若数量不是 4，改 `apps/screen/avatar/heroCard.ts` 的 `TEMPLATE_COUNT`，并补齐 `FACE_ANCHORS`。
