// 幸运抽奖独立整页。展示逻辑全在 presenter.ts —— /screen 流程里的「幸运抽奖」
// 环节用的是同一份，两边订阅同一个广播频道，同时开着也同步。
// 这一页额外做的只有两件事：自带 3D 背景，以及抽完把大屏交还给 /screen。

import { World } from "../screen/scene/world.ts";
import { buildBackdrop } from "../screen/scene/backdrop.ts";
import { mountDrawPresenter } from "./presenter.ts";

// Ambient 3D backdrop — reuse the check-in lobby world (no Director/HUD).
const world = new World(document.getElementById("scene") as HTMLCanvasElement);
world.scene.add(buildBackdrop());
world.start();

mountDrawPresenter(document, {
  // Hand the big screen back to the lobby view after the draw segment.
  onReturn: () => (location.href = "/screen"),
  // 整页就是抽奖本身，永远在台上。
  isActive: () => true,
});
