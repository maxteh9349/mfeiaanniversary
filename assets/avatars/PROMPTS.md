# Avatar 立绘 — AI 生成规格

大屏用 2.5D billboard 立绘。需要一组（默认 8 个，见 `AVATAR_MODEL_COUNT`）风格统一的
卡通工人立绘，**透明背景 PNG**，正面站姿、全身、脚部在画布底部。

## 文件规格
- 命名：`avatar0.png` … `avatar7.png`，放在本目录 `assets/avatars/`。
- 画布：竖向，建议 **512 × 768**（宽:高 = 2:3），透明背景。
- 构图：全身正面，居中，**脚底贴近画布底边**（系统按脚部着地），头顶留少量空白。
- 像素边缘干净（无白边/光晕），方便叠加到 3D 场景。
- 风格统一：同一画师/同一组提示词，光照一致（柔和正面光），描边一致。

## 统一风格提示词（Style，所有角色共用）
```
chibi cartoon character, friendly Malaysian foundry/engineering worker,
full body, front view, standing, clean vector illustration, soft cel shading,
thick clean outline, big friendly eyes, smiling, industrial work uniform,
tech-blue color theme, transparent background, centered, feet at bottom edge,
high detail, consistent lighting, sticker style
```

## 角色变体（每个 avatar 换这段，保持上面 Style 不变）
- avatar0：男，蓝色连体工装，戴鸭舌帽，竖大拇指
- avatar1：女，卡其工装，马尾，手持平板，微笑挥手
- avatar2：男，深蓝工装，戴黄色安全帽，叉腰
- avatar3：男，灰蓝工装，短发，双手张开像在交谈
- avatar4：女，墨绿工装，戴帽，点头微笑
- avatar5：男，棕色工装，络腮胡，竖大拇指
- avatar6：男，靛蓝工装，戴眼镜，抱臂自信
- avatar7：女，蓝灰工装，长发，手势像在讲解

## 负面提示词（Negative）
```
realistic photo, 3d render, harsh shadows, cropped feet, white background,
text, watermark, extra limbs, blurry edges, busy background
```

## 接入
PNG 放进本目录后，前端启动时 `preloadAvatars()`（`apps/screen/avatar/textures.ts`）
会自动加载 `avatarN.png`；缺失的编号回退到代码绘制的占位立绘。无需改代码。
> 若数量不是 8，调整 `shared/config.ts` 的 `AVATAR_MODEL_COUNT`。
