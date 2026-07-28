// 晚宴流程环节大屏。Data-driven from the `segments` / `honourees` tables; the
// operator's cues arrive as StageState changes (persisted in `settings`, so a
// screen reloaded mid-ceremony comes back on the same segment / same honouree).
//
// All operator-entered text is written with textContent — never innerHTML — the
// same rule /draw follows for prize + sponsor names.

import { World } from "../screen/scene/world.ts";
import { buildBackdrop } from "../screen/scene/backdrop.ts";
import { getBackend } from "../shared/backend.ts";
import type { Honouree, Segment, StageState } from "../../shared/events.ts";

const $ = (id: string) => document.getElementById(id) as HTMLElement;

/** Ambient 3D backdrop — the same lobby world /screen and /draw use. */
const world = new World($("scene") as HTMLCanvasElement);
world.scene.add(buildBackdrop());
world.start();

const stageEl = $("stage");
const idleEl = $("idle");
const awardMain = document.querySelector(".award-main") as HTMLElement;
const queueEl = document.querySelector(".award-queue") as HTMLElement;
const rosterTrack = $("roster");
const rosterViewport = document.querySelector(".roster-viewport") as HTMLElement;

/** How many upcoming names the award queue lists beside the current honouree. */
const QUEUE_SIZE = 5;

/** True once a segment has been live in this page's lifetime (see render()). */
let wasActive = false;
/** Signature of what is on screen, so we only replay animations on real changes. */
let lastKey = "";

function setText(id: string, text: string | null | undefined): void {
  $(id).textContent = text ?? "";
}

/** "颁发：会长吴万安" — prefix only when there is something to label. */
function label(prefix: string, value: string | null): string {
  return value && value.trim() ? `${prefix}：${value.trim()}` : "";
}

function renderSpeech(honourees: Honouree[], segment: Segment): void {
  const speaker = honourees[0];
  setText("speech-name", speaker ? speaker.nameZh : (segment.subtitle ?? segment.titleZh));
  setText("speech-org", speaker?.org ?? speaker?.nameEn ?? "");
}

function renderAward(honourees: Honouree[], index: number): void {
  const done = index >= honourees.length;
  const cur = honourees[index];
  if (done) {
    // Past the last name: the rundown ends every presentation with a group photo.
    setText("award-counter", "礼 成");
    setText("award-name", "合 照");
    setText("award-en", "");
    setText("award-org", honourees.length ? "全体合影" : "");
  } else {
    setText("award-counter", `第 ${index + 1} / ${honourees.length} 位`);
    setText("award-name", cur.nameZh);
    setText("award-en", cur.nameEn ?? "");
    setText("award-org", cur.org ?? "");
  }

  const upcoming = done ? [] : honourees.slice(index + 1, index + 1 + QUEUE_SIZE);
  const ol = $("award-queue");
  ol.textContent = "";
  for (const [i, h] of upcoming.entries()) {
    const li = document.createElement("li");
    const num = document.createElement("span");
    num.className = "qi";
    num.textContent = String(index + 2 + i);
    const name = document.createElement("span");
    name.textContent = h.nameZh;
    li.append(num, name);
    ol.appendChild(li);
  }
  queueEl.classList.toggle("hidden", upcoming.length === 0);
}

function renderRoster(honourees: Honouree[], segment: Segment): void {
  rosterTrack.textContent = "";
  rosterTrack.classList.remove("scroll");

  // Preserve list order while grouping: a new group starts whenever the label changes.
  const groups: { label: string | null; items: Honouree[] }[] = [];
  for (const h of honourees) {
    const last = groups[groups.length - 1];
    if (last && last.label === (h.groupLabel ?? null)) last.items.push(h);
    else groups.push({ label: h.groupLabel ?? null, items: [h] });
  }

  for (const g of groups) {
    const box = document.createElement("div");
    box.className = "roster-group";
    if (g.label) {
      const title = document.createElement("div");
      title.className = "roster-group-title";
      title.textContent = g.label;
      box.appendChild(title);
    }
    const names = document.createElement("div");
    names.className = "roster-names";
    for (const h of g.items) {
      const item = document.createElement("div");
      item.className = "roster-item";
      // 会长 / 署理会长 rows carry their title in `org`; highlight them.
      if (h.org && /会长/.test(h.org)) item.classList.add("lead");
      const zh = document.createElement("span");
      zh.className = "roster-zh";
      zh.textContent = h.nameZh;
      item.appendChild(zh);
      if (h.nameEn) {
        const en = document.createElement("span");
        en.className = "roster-en";
        en.textContent = h.nameEn;
        item.appendChild(en);
      }
      if (h.org) {
        const org = document.createElement("span");
        org.className = "roster-org";
        org.textContent = h.org;
        item.appendChild(org);
      }
      names.appendChild(item);
    }
    box.appendChild(names);
    rosterTrack.appendChild(box);
  }

  if (!segment.autoScroll) return;
  // Only scroll when the list actually overflows; measure after layout settles.
  requestAnimationFrame(() => {
    const shift = rosterViewport.clientHeight - rosterTrack.scrollHeight;
    if (shift < -20) {
      rosterTrack.style.setProperty("--shift", `${shift}px`);
      rosterTrack.classList.add("scroll");
    }
  });
}

function renderSponsors(honourees: Honouree[]): void {
  const wrap = $("sponsor-plaques");
  wrap.textContent = "";
  for (const h of honourees) {
    const card = document.createElement("div");
    card.className = "plaque";
    const lbl = document.createElement("div");
    lbl.className = "plaque-label";
    lbl.textContent = "感 谢 状";
    const name = document.createElement("div");
    name.className = "plaque-name";
    name.textContent = h.nameZh;
    const org = document.createElement("div");
    org.className = "plaque-org";
    org.textContent = h.nameEn ?? h.org ?? "";
    card.append(lbl, name, org);
    wrap.appendChild(card);
  }
}

function render(state: StageState, segment: Segment | null, honourees: Honouree[]): void {
  if (!state.active || !segment) {
    // Cold-open with nothing live: park on the idle card so /stage can be opened
    // and checked ahead of time. Only an active -> inactive flip (the operator's
    // 「返回大厅大屏」) hands the screen back to the lobby.
    if (wasActive) {
      location.href = "/screen";
      return;
    }
    stageEl.classList.remove("show");
    idleEl.classList.remove("hidden");
    lastKey = "";
    return;
  }

  wasActive = true;
  idleEl.classList.add("hidden");
  stageEl.classList.add("show");
  stageEl.dataset.kind = segment.kind;

  // 时间 / 副标题 / 备注只在运维台看得到 —— 「播放 AI 短片」这类是执行提示，不上大屏。
  setText("title-zh", segment.titleZh);
  setText("title-en", segment.titleEn);
  setText("foot-presenter", label("颁发", segment.presenter));
  setText("foot-escort", label("陪同", segment.escort));

  switch (segment.kind) {
    case "speech":
      renderSpeech(honourees, segment);
      break;
    case "award":
      renderAward(honourees, state.index);
      break;
    case "roster":
      renderRoster(honourees, segment);
      break;
    case "sponsor_thanks":
      renderSponsors(honourees);
      break;
    case "title":
    // 抽奖只在 /screen 的抽奖图层上演；这里退回一张标题卡。
    case "lucky_draw":
      break;
  }

  // Replay the entrance animation only when the honouree/segment actually moved —
  // an unrelated settings write must not re-pop the name on screen.
  const key = `${segment.id}:${segment.kind}:${state.index}`;
  if (segment.kind === "award" && key !== lastKey) {
    awardMain.classList.remove("enter");
    void awardMain.offsetWidth; // restart the CSS animation
    awardMain.classList.add("enter");
  }
  lastKey = key;
}

void getBackend().then((backend) => backend.subscribeStage({ onState: render }));
