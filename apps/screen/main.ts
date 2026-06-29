import { getBackend } from "../shared/backend.ts";
import { Hud } from "./hud/hud.ts";
import { World } from "./scene/world.ts";
import { buildBackdrop } from "./scene/backdrop.ts";
import { Portal } from "./portal/portal.ts";
import { Director } from "./behavior/director.ts";
import { PosterReveal } from "./avatar/posterReveal.ts";
import type { Guest } from "../../shared/events.ts";

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const world = new World(canvas);
const hud = new Hud();
const posterReveal = new PosterReveal(document.getElementById("hero-reveal") as HTMLElement);

world.scene.add(buildBackdrop());

const portal = new Portal();
world.scene.add(portal.group);
world.onTick((dt, t) => portal.update(dt, t));

// 3D characters are procedural (no async asset load) — build the director now.
const director = new Director(world.scene);
world.onTick((dt, t) => director.update(dt, t));
let prefilled = false;

function applyPrefill(crowd: Guest[]): void {
  if (prefilled) return;
  prefilled = true;
  director.prefill(crowd, portal.spawnPoint);
}

world.start();

getBackend().then((backend) =>
  backend.subscribeScreen({
    onSnapshot(total, recent, crowd) {
      hud.setTotal(total);
      hud.setRecent(recent);
      applyPrefill(crowd);
    },
    onSpawn(guest, total) {
      hud.setTotal(total);
      hud.pushRecent(guest);
      posterReveal.show(guest); // full-screen welcome poster (5s)
      director.spawn(guest, portal.spawnPoint);
    },
    onConfig(cfg) {
      if (typeof cfg.maxAvatars === "number") director.maxAvatars = cfg.maxAvatars;
    },
    onSponsors(logos, intervalSec) {
      hud.setSponsors(logos, intervalSec);
    },
    onTexts(slogan) {
      const el = document.querySelector(".slogan");
      if (el) el.textContent = slogan;
    },
  }),
);
