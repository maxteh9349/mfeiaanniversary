import { World } from "../screen/scene/world.ts";
import { buildBackdrop } from "../screen/scene/backdrop.ts";
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

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Ambient 3D backdrop — reuse the check-in lobby world (no Director/HUD).
const world = new World($("scene") as HTMLCanvasElement);
world.scene.add(buildBackdrop());
world.start();

const reel = new Reel($("reel"));
const confetti = new Confetti($("confetti") as HTMLCanvasElement);

function setPrizeCard(prize: Prize): void {
  $("prize-level").textContent = PRIZE_LEVELS[prize.level] ?? prize.level;
  $("prize-name").textContent = prize.name;
  $("prize-sponsor").textContent = prize.sponsor ? `鸣谢 ${prize.sponsor}` : "";
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
  $("reveal-sponsor").textContent = prize.sponsor ? `鸣谢 ${prize.sponsor}` : "";
  $("reveal").classList.add("show");
  confetti.burst(DRAW_DEFAULTS.confettiMs);
}

getBackend().then((backend) =>
  backend.subscribeDraw({
    onRollStart(prize, names) {
      $("reveal").classList.remove("show");
      $("countdown").textContent = "";
      setPrizeCard(prize);
      reel.start(names);
    },
    async onReveal(prize, winner) {
      setPrizeCard(prize);
      await runCountdown(DRAW_DEFAULTS.countdownSec);
      await reel.stopOn(winner.guestName, DRAW_DEFAULTS.decelMs);
      showReveal(prize, winner);
    },
    onReset() {
      $("reveal").classList.remove("show");
      $("countdown").textContent = "";
      reel.reset();
    },
    onPrizes(prizes) {
      // Cold-load / re-sync: show the next drawable prize when idle.
      if ($("reveal").classList.contains("show")) return;
      const next = prizes.find((p) => p.status === "active" && p.remaining > 0) ?? prizes[0];
      if (next) setPrizeCard(next);
    },
  }),
);
