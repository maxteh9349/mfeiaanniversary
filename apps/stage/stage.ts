// 晚宴流程环节大屏。Data-driven from the `segments` / `honourees` tables; the
// operator's cues arrive as StageState changes (persisted in `settings`, so a
// screen reloaded mid-ceremony comes back on the same segment / same honouree).
//
// 这个文件只是页面外壳：3D 背景 + 左上角 logo + 待机卡。环节版式本身在
// ./presenter.ts —— /screen 的叠加层共用同一份，改版式请改那里。

import { World } from "../screen/scene/world.ts";
import { buildBackdrop } from "../screen/scene/backdrop.ts";
import { mountBrandLogo } from "../screen/logo.ts";
import { getBackend } from "../shared/backend.ts";
import { mountStagePresenter } from "./presenter.ts";

const $ = (id: string) => document.getElementById(id) as HTMLElement;

/** Ambient 3D backdrop — the same lobby world /screen and /draw use. */
const world = new World($("scene") as HTMLCanvasElement);
world.scene.add(buildBackdrop());
world.start();

mountBrandLogo(document.getElementById("brand-logo") as HTMLImageElement | null);

const stageEl = $("stage");
const idleEl = $("idle");
const presenter = mountStagePresenter(stageEl);

void getBackend().then((backend) =>
  backend.subscribeStage({
    onState(state, segment, honourees) {
      if (!state.active || !segment) {
        // 没有环节在台上就停在待机卡 —— 开场前可以先架好，环节之间也停在这里。
        // 这块屏全场钉在 /stage 上，绝不自己跳去 /screen。
        stageEl.classList.remove("show");
        idleEl.classList.remove("hidden");
        presenter.reset();
        return;
      }
      idleEl.classList.add("hidden");
      stageEl.classList.add("show");
      presenter.render(state, segment, honourees);
    },
  }),
);
