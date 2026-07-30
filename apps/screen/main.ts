import { getBackend } from "../shared/backend.ts";
import { Hud } from "./hud/hud.ts";
import { World } from "./scene/world.ts";
import { buildBackdrop } from "./scene/backdrop.ts";
import { Portal } from "./portal/portal.ts";
import { Director } from "./behavior/director.ts";
import { PosterReveal } from "./avatar/posterReveal.ts";
import { mountDrawPresenter } from "../draw/presenter.ts";
import { mountStagePresenter, STAGE_KINDS } from "./segments/presenter.ts";
import type { Guest, Honouree, Segment, StageState } from "../../shared/events.ts";
import { STAGE_VOLUME_DEFAULT } from "../../shared/events.ts";

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

// ---- programme segments -----------------------------------------------------
// 「上台」不换页：这块大屏保持原样，只在上面叠一张环节图片，3D 场景压暗、HUD 照常
// 显示。没上传图片的环节退回标题文字卡，免得操作台点了却看不出变化。
const segmentOverlay = document.getElementById("segment-overlay") as HTMLElement;
const segmentPhoto = document.getElementById("segment-photo") as HTMLImageElement;
/** True while a segment owns the screen — mutes the check-in welcome poster. */
let segmentLive = false;

// 机器人举牌模板。加载成功才切到「牌面排版」，缺图就一直是普通文字卡 —— 大屏上
// 永远不会出现破图占位（和 heroCard.ts 缺模板回退剪影同一套思路）。
const segmentBoardArt = document.getElementById("segment-board-art") as HTMLImageElement;
segmentBoardArt.addEventListener("load", () => {
  segmentBoardArt.hidden = false;
  segmentOverlay.classList.add("has-board");
});

// ---- 环节短片 ----
// 浏览器不允许带声自动播放，除非页面被真人点过。开场前在大屏上随便点一下就解锁全场；
// 没点也不会卡住 —— 先静音播出去。
// 注意：屏幕上**没有**任何「点一下开声音」的提示（刻意去掉的，不上大屏）。所以忘了点
// 就是一路静音、且现场看不出原因 —— 开场前必须在大屏上点一下当作固定流程。
const segmentVideo = document.getElementById("segment-video") as HTMLVideoElement;
let soundUnlocked = false;
/** 运维台滑杆设定的音量 0–100，跟 stage 状态一起推过来。 */
let segmentVolume = STAGE_VOLUME_DEFAULT;

document.addEventListener(
  "click",
  () => {
    soundUnlocked = true;
    applySegmentVolume();
  },
  { once: true },
);

/** 音量 = 运维台设定值，但页面没被点过时只能静音播（浏览器策略）。 */
function applySegmentVolume(): void {
  segmentVideo.volume = segmentVolume / 100;
  segmentVideo.muted = segmentVolume === 0 || !soundUnlocked;
}

function playSegmentVideo(url: string): void {
  // 同一条片子重复上台就从头再放，不重新下载。
  if (segmentVideo.getAttribute("src") !== url) segmentVideo.src = url;
  else segmentVideo.currentTime = 0;
  applySegmentVolume();
  segmentVideo.play().catch(() => {
    // 带声被拦下就退回静音重播一次，宁可没声音也不能不播。
    segmentVideo.muted = true;
    void segmentVideo.play().catch(() => {
      /* 路径写错 / 编码不支持：大屏留黑框，操作台切走即可 */
    });
  });
}

function stopSegmentVideo(): void {
  if (!segmentVideo.getAttribute("src")) return;
  segmentVideo.pause();
}

// 播完不做任何事：停在最后一帧等操作台切走。

function setSegmentText(id: string, text: string | null): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text ?? ""; // textContent: segment titles are operator-entered
}

// 幸运抽奖也是流程里的一格：kind=lucky_draw 的环节上台，就在这块大屏上叠出抽奖画面
// （和 /draw 独立页共用 presenter，两边同时开着也同步）。滚动 / 揭晓仍由运维台的
// 抽奖控制台驱动 —— 这里只负责什么时候把画面亮出来。
const drawPresenter = mountDrawPresenter(document.getElementById("draw-layer") as HTMLElement, {
  onReturn: () => segmentOverlay.classList.remove("has-draw", "show"),
  isActive: () => segmentOverlay.classList.contains("has-draw"),
});

// 致辞 / 逐位颁奖 / 整屏名单 / 赞助商感谢状：版式在 ./segments/（presenter.ts + panes.css）。
// 上台即在这块大屏原地弹出，不换页、不重载 3D。名单本来就随每次指令一起推过来
// （subscribeStage 总是带 honourees）。
const stagePresenter = mountStagePresenter(document.getElementById("stage-layer") as HTMLElement);

/** 正在放的那条片子（环节 id + 路径），免得同环节的其它指令把片子从头重播。 */
let playingVideoKey = "";
/** 上一次上台的是不是抽奖环节 —— 只在真正进出抽奖时清画面。 */
let drawWasLive = false;

function showSegment(state: StageState, segment: Segment | null, honourees: Honouree[] = []): void {
  // 音量随时可调：运维台拉滑杆会推一次状态过来，正在播的片子立刻跟上。
  segmentVolume = state.volume;
  applySegmentVolume();

  segmentLive = state.active && !!segment;
  if (!segmentLive || !segment) {
    segmentOverlay.classList.remove("show", "has-draw", "has-stage");
    stagePresenter.reset();
    playingVideoKey = "";
    stopSegmentVideo();
    if (drawWasLive) drawPresenter.reset();
    drawWasLive = false;
    return;
  }

  // 进出抽奖时清一次画面：上一位中奖者不该留在屏上等下一轮。
  const drawLive = segment.kind === "lucky_draw";
  segmentOverlay.classList.toggle("has-draw", drawLive);
  if (drawLive !== drawWasLive) drawPresenter.reset();
  drawWasLive = drawLive;

  // 只认站内路径或 http(s) 直链才当短片。以前只判断非空，结果有人把人名填进这一栏，
  // 大屏就切进短片模式：底色压黑 + 一个加载失败的黑框，致辞版式完全不渲染。
  // 运维台已经拦了新保存的，这里再兜一层 —— 旧数据和直接改库都绕不过大屏。
  const rawVideo = segment.videoUrl?.trim() ?? "";
  const video = /^(\/|https?:\/\/)/.test(rawVideo) ? rawVideo : "";
  segmentOverlay.classList.toggle("has-video", !!video);
  if (video) {
    // 「下一位」这类同环节指令不该打断播放；换了环节或改了路径才重放。
    const key = `${segment.id}:${video}`;
    if (playingVideoKey !== key) {
      playingVideoKey = key;
      playSegmentVideo(video);
    }
  } else {
    playingVideoKey = "";
    stopSegmentVideo();
  }

  // 幻灯片环节：整屏图来自**当前这一页**（honourees[index] 的 photo_url），走的是与
  // 环节大图完全相同的那条显示路径，所以过场动画、HUD 淡出、底色全都一模一样。
  // 翻页 = 运维台的「下一位 / 上一位」写 stage.index，这里跟着换 src。
  const url =
    segment.kind === "slides" ? (honourees[state.index]?.photoUrl ?? "") : (segment.imageUrl ?? "");
  segmentOverlay.classList.toggle("has-photo", !!url);
  // Only touch src on a real change: an unrelated cue (下一位) must not reload the
  // picture and flash the screen mid-ceremony.
  if (url) {
    if (segmentPhoto.getAttribute("src") !== url) segmentPhoto.src = url;
  } else {
    segmentPhoto.removeAttribute("src");
  }
  setSegmentText("segment-card-zh", segment.titleZh);
  setSegmentText("segment-card-en", segment.titleEn);

  // 优先级：操作台明确上传的图片 / 短片 > 抽奖 > 流程版式 > 举牌标题卡。
  // 过场标题（kind=title）不走版式 —— 举牌卡本来就是为它做的。
  const hasStage = !url && !video && !drawLive && STAGE_KINDS.has(segment.kind);
  segmentOverlay.classList.toggle("has-stage", hasStage);
  if (hasStage) stagePresenter.render(state, segment, honourees);

  segmentOverlay.classList.add("show");
}

getBackend().then((backend) => {
  backend.subscribeStage({ onState: showSegment });
  backend.subscribeScreen({
    onSnapshot(total, recent, crowd) {
      hud.setTotal(total);
      hud.setRecent(recent);
      applyPrefill(crowd);
    },
    onSpawn(guest, total) {
      hud.setTotal(total);
      hud.pushRecent(guest);
      // full-screen welcome poster (5s) — held back while a segment is on screen,
      // a late check-in must not cover the ceremony picture.
      if (!segmentLive) posterReveal.show(guest);
      director.spawn(guest, portal.spawnPoint);
    },
    onConfig(cfg) {
      if (typeof cfg.maxAvatars === "number") director.maxAvatars = cfg.maxAvatars;
      if (typeof cfg.guestFeedHidden === "boolean") {
        const feed = document.querySelector(".hud-left") as HTMLElement | null;
        if (feed) feed.style.display = cfg.guestFeedHidden ? "none" : "";
      }
      if (typeof cfg.checkinFlowHidden === "boolean") {
        const flow = document.querySelector(".hud-bottom") as HTMLElement | null;
        if (flow) flow.style.display = cfg.checkinFlowHidden ? "none" : "";
      }
    },
    onSponsors(logos, intervalSec) {
      hud.setSponsors(logos, intervalSec);
    },
    onTexts(slogan) {
      const el = document.querySelector(".slogan");
      if (el) el.textContent = slogan;
    },
  });
});
