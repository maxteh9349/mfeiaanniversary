// 抽奖展示层：奖品卡 + 滚动条 + 倒数 + 中奖揭晓 + 撒花。
//
// 两个宿主共用这一份实现：
//   /draw        独立整页（自带 3D 世界，可以单独丢给第二块屏）
//   /screen      流程里的「幸运抽奖」环节，直接叠在大厅大屏上，不换页
// 两边订阅同一个广播频道，所以同时开着也天然同步。
//
// 宿主只负责提供一块含展示 DOM 的根节点（id 在根节点内部查，两页各有各的 DOM，
// 重名不冲突），以及「退出抽奖」时该做什么。

import { getBackend } from "../shared/backend.ts";
import { DRAW_DEFAULTS } from "../../shared/config.ts";
import type { Prize, Winner } from "../../shared/events.ts";
import { Reel } from "./reel.ts";
import { Confetti } from "./confetti.ts";

const PRIZE_LEVELS: Record<Prize["level"], string> = {
  grand: "特等奖",
  second: "二等奖",
  third: "三等奖",
  lucky: "幸运奖",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface DrawPresenterOptions {
  /** 操作台点「返回大厅大屏」时：/draw 跳回 /screen，/screen 收起图层。 */
  onReturn(): void;
  /**
   * 图层此刻是否在台上。/screen 常驻订阅广播，没上台抽奖环节时必须忽略事件 ——
   * 否则运维台一按「开始滚动」，大厅画面会莫名其妙倒数撒花。
   */
  isActive(): boolean;
}

export interface DrawPresenter {
  /** 收起揭晓层、清空滚动条 —— 退出抽奖或重新上台时调用。 */
  reset(): void;
}

/** Render the sponsor as two stacked lines — "鸣谢" caption on top, name below.
 *  Built with textContent (not innerHTML) so operator-entered names stay inert. */
function setSponsor(el: HTMLElement, sponsor: string | null): void {
  el.textContent = "";
  if (!sponsor) return;
  const label = document.createElement("div");
  label.className = "sp-label";
  label.textContent = "鸣谢";
  const name = document.createElement("div");
  name.className = "sp-name";
  name.textContent = sponsor;
  el.append(label, name);
}

export function mountDrawPresenter(root: ParentNode, opts: DrawPresenterOptions): DrawPresenter {
  const $ = (id: string) => root.querySelector(`#${id}`) as HTMLElement;

  const reel = new Reel($("reel"));
  const confetti = new Confetti($("confetti") as HTMLCanvasElement);

  function setPrizeCard(prize: Prize): void {
    $("prize-level").textContent = PRIZE_LEVELS[prize.level] ?? prize.level;
    $("prize-name").textContent = prize.name;
    setSponsor($("prize-sponsor"), prize.sponsor);
    const img = $("prize-img") as HTMLImageElement;
    if (prize.imageUrl) {
      img.src = prize.imageUrl;
      img.style.display = "";
    } else {
      img.style.display = "none";
    }
  }

  async function runCountdown(sec: number): Promise<void> {
    const el = $("countdown");
    for (let n = sec; n >= 1; n--) {
      el.textContent = String(n);
      el.classList.remove("tick");
      void el.offsetWidth; // restart the pop animation
      el.classList.add("tick");
      await sleep(700);
    }
    el.textContent = "";
  }

  function showReveal(prize: Prize, winner: Winner): void {
    $("reveal-name").textContent = winner.guestName;
    $("reveal-prize").textContent = `${PRIZE_LEVELS[prize.level] ?? prize.level} · ${prize.name}`;
    setSponsor($("reveal-sponsor"), prize.sponsor);
    $("reveal").classList.add("show");
    confetti.burst(DRAW_DEFAULTS.confettiMs);
  }

  function reset(): void {
    $("reveal").classList.remove("show");
    $("countdown").textContent = "";
    reel.reset();
  }

  void getBackend().then((backend) =>
    backend.subscribeDraw({
      onRollStart(prize, names) {
        if (!opts.isActive()) return;
        $("reveal").classList.remove("show");
        $("countdown").textContent = "";
        setPrizeCard(prize);
        reel.start(names);
      },
      async onReveal(prize, winner) {
        if (!opts.isActive()) return;
        setPrizeCard(prize);
        await runCountdown(DRAW_DEFAULTS.countdownSec);
        await reel.stopOn(winner.guestName, DRAW_DEFAULTS.decelMs);
        showReveal(prize, winner);
      },
      onReset() {
        if (!opts.isActive()) return;
        reset();
      },
      onReturnToScreen() {
        if (!opts.isActive()) return;
        opts.onReturn();
      },
      onPrizes(prizes) {
        // Cold-load / re-sync: show the next drawable prize when idle.
        if (!opts.isActive()) return;
        if ($("reveal").classList.contains("show")) return;
        const next = prizes.find((p) => p.status === "active" && p.remaining > 0) ?? prizes[0];
        if (next) setPrizeCard(next);
      },
    }),
  );

  return { reset };
}
