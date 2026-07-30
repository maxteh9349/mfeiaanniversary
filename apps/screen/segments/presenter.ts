// 晚宴流程环节的版式渲染器 —— /screen 把它渲染进环节叠加层（apps/screen/main.ts），
// 环节上台即在原地弹出，投影全程不换页。
//
// 曾经还有一块 /stage 整页大屏共用这一份版式，那一页已经删掉（叠加层完全取代了它），
// 所以这里连同 panes.css 一起搬进了 apps/screen/segments/。
//
// DOM 由这里自己建（不写进 index.html），版式 CSS 也由这里 import —— 版式的一切都在
// 这两个文件里。整块画面的大小由容器上的 --pane-scale 控制（#stage-layer 取 1），
// 改它只缩放不变形。
//
// All operator-entered text is written with textContent — never innerHTML — the
// same rule /draw follows for prize + sponsor names.

import type { Honouree, Segment, StageState } from "../../../shared/events.ts";
import "./panes.css";

/** 有整页版式的环节类型；其余（title / lucky_draw）由 /screen 自己决定怎么显示。 */
export const STAGE_KINDS: ReadonlySet<Segment["kind"]> = new Set([
  "speech",
  "award",
  "roster",
  "sponsor_thanks",
]);

export interface StagePresenter {
  /** 把一个上台中的环节渲染出来。调用前请先确保容器可见。 */
  render(state: StageState, segment: Segment, honourees: Honouree[]): void;
  /** 收场时清掉动画去抖记录，下次上台重新播入场动画。 */
  reset(): void;
}

function div(className: string, text?: string): HTMLElement {
  const el = document.createElement("div");
  el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

/** 一块面板里的人物照片（致辞讲者 / 逐位颁奖的得奖者共用这一套）。 */
interface PanePhoto {
  el: HTMLImageElement;
  /** 换这一位的照片；null / 空 / 之前加载失败过的地址 = 收起照片，版式退回纯文字。 */
  show(url: string | null | undefined): void;
}

/**
 * 给面板挂一张人物照片，并处理「加载不出来就退回纯文字版式」——
 * 打包路径的文件还没放进 assets/、Storage 抽风、URL 填错时，大屏上挂一个碎图框
 * 比没有照片难看得多。记下失败的那个 URL：无关指令重渲染同一位时不会再有 error 事件，
 * 只靠 class 会把碎图框放回去。
 *
 * 照片是否显示由面板上的 .has-photo 决定（见 panes.css），所以「没照片」那条路
 * 与加这个功能之前的纯文字版式完全一致。
 */
function mountPanePhoto(pane: HTMLElement, variantClass: string): PanePhoto {
  const el = document.createElement("img");
  el.className = `pane-photo ${variantClass}`;
  el.alt = "";
  let failed = "";
  el.addEventListener("error", () => {
    failed = el.getAttribute("src") ?? "";
    pane.classList.remove("has-photo");
  });
  el.addEventListener("load", () => {
    failed = "";
    pane.classList.add("has-photo");
  });
  return {
    el,
    show(url) {
      // 只在真的换了图才动 src —— 无关指令重设同一个 URL 会让大屏闪一下白。
      const src = url ?? "";
      pane.classList.toggle("has-photo", !!src && src !== failed);
      if (src) {
        if (el.getAttribute("src") !== src) el.src = src;
      } else {
        el.removeAttribute("src");
      }
    },
  };
}

/**
 * 建出标题带 + 四种环节的面板，挂进 root。
 * root 上的 data-kind 决定显示哪一块（见 panes.css）。
 */
export function mountStagePresenter(root: HTMLElement): StagePresenter {
  root.textContent = "";

  // ---- 标题带：中文标题框 + 英文副标题。整组底对齐，见 .title-band。 ----
  const titleZh = div("stage-title");
  const titleEn = div("stage-title-en");
  const box = div("tech-box title-box");
  const boxInner = div("tech-inner");
  boxInner.appendChild(titleZh);
  box.appendChild(boxInner);
  const stack = div("title-stack");
  stack.append(box, titleEn);
  const band = div("title-band");
  band.appendChild(stack);
  // 「致 辞」挂在标题带**外面**、副标题正下方 —— 放进 .title-stack 会把标题框顶上去
  // （band 是底对齐的），致辞环节的标题就会比别的环节高一截。只在致辞环节显示，
  // 由容器的 data-kind 控制，见 panes.css。
  const speechLabel = div("speech-label", "致 辞");
  const header = document.createElement("header");
  header.className = "stage-header";
  header.append(band, speechLabel);

  // ---- kind=speech ----
  // 讲者照片在左、文字在右；没上传照片时照片整块收起，退回原来的纯文字居中版式。
  const paneSpeech = div("pane pane-speech");
  const speechPhoto = mountPanePhoto(paneSpeech, "speech-photo");
  const speechName = div("speech-name");
  const speechOrg = div("speech-org");
  const speechText = div("speech-text");
  speechText.append(speechName, speechOrg);
  paneSpeech.append(speechPhoto.el, speechText);

  // ---- kind=award ----
  // 与致辞同一套：这一位有照片就照片在左、姓名那栏在右；没照片的仍是原来的居中版式，
  // 所以同一个环节里有的有图有的没图也不会错位（每翻一位各自决定）。
  const paneAward = div("pane pane-award");
  const awardPhoto = mountPanePhoto(paneAward, "award-photo");
  const awardGroup = div("award-group");
  const awardName = div("award-name");
  // 职衔（「第五任会长」）夹在姓名与英文名之间 —— 它说的是这个人在本会的身份，
  // 紧贴姓名才读得出是谁的头衔；公司名仍在最后一行。留空的自动收起，见 panes.css。
  const awardRole = div("award-role");
  const awardEn = div("award-en");
  const awardOrg = div("award-org");
  const awardMain = div("award-main");
  awardMain.append(awardGroup, awardName, awardRole, awardEn, awardOrg);
  paneAward.append(awardPhoto.el, awardMain);

  // ---- kind=roster ----
  const rosterTrack = div("roster-track");
  const rosterViewport = div("roster-viewport");
  rosterViewport.appendChild(rosterTrack);
  const paneRoster = div("pane pane-roster");
  paneRoster.appendChild(rosterViewport);

  // ---- kind=sponsor_thanks ----
  const plaques = div("sponsor-plaques");
  const paneSponsor = div("pane pane-sponsor");
  paneSponsor.appendChild(plaques);

  root.append(header, paneSpeech, paneAward, paneRoster, paneSponsor);

  /** Signature of what is on screen, so we only replay animations on real changes. */
  let lastKey = "";

  function renderSpeech(honourees: Honouree[], segment: Segment): void {
    const speaker = honourees[0];
    speechName.textContent = speaker ? speaker.nameZh : (segment.subtitle ?? segment.titleZh);
    speechOrg.textContent = speaker?.org ?? speaker?.nameEn ?? "";
    speechPhoto.show(speaker?.photoUrl);
  }

  /**
   * 整屏只放当前这一位：名次与后续队列都留在运维台，大屏不显示。
   * 进度仍由 state.index 驱动（运维台的 上一位 / 下一位 照常翻页）。
   *
   * 名单分组时（长期服务奖那种「服务 15 年以上 / 20 年 / 25 年」），组别写在名字上方，
   * 翻到下一档会自己跟着变 —— 否则嘉宾看不出台上这位属于哪一档。没分组的名单
   * （奖学金那种 groupLabel 为空）靠 :empty 自动收起，不会多出一行空白。
   */
  function renderAward(honourees: Honouree[], index: number): void {
    const cur = honourees[index];
    if (index >= honourees.length) {
      // 翻过最后一位 = 合照环节。**每一行全部留空**：台上要拍照，屏上再写「合照 / 全体合影」
      // 只会抢镜头，所以只留顶部环节标题 + 左上 logo + 右上赞助商当干净背景。
      // 运维台照旧提示「本环节已到「合照」收尾」（那是操作者看的，不上大屏），
      // 所以操作者仍然知道翻到哪了。
      awardGroup.textContent = "";
      setAwardName("");
      awardRole.textContent = "";
      awardEn.textContent = "";
      awardOrg.textContent = "";
      awardPhoto.show(null); // 合照卡连照片一起收掉，屏上只留标题当背景
    } else {
      awardGroup.textContent = cur.groupLabel ?? "";
      setAwardName(cur.nameZh);
      awardRole.textContent = cur.roleLabel ?? "";
      awardEn.textContent = cur.nameEn ?? "";
      awardOrg.textContent = cur.org ?? "";
      awardPhoto.show(cur.photoUrl);
    }
  }

  /** 公司名尾巴上的法律后缀 —— 拆到第二行，主名字才不用被挤到极小。 */
  const CO_SUFFIX = /^(.+?)[\s,]+(SDN\.?\s*BHD\.?|BERHAD|S\/B|PLT|LLP)$/i;

  /**
   * 写入姓名。公司名（VR GREEN MOTOR SDN BHD 之类）把「SDN BHD」拆成独立一行 ——
   * 不拆的话整串太宽，只能整体缩到很小，主名字反而看不清。
   * 用 DOM 节点拼，不用 innerHTML：运维台录进来的文字一律 textContent，全项目一条规则。
   */
  function setAwardName(raw: string): void {
    const text = raw.trim();
    awardName.textContent = "";
    const m = CO_SUFFIX.exec(text);
    if (!m) {
      awardName.textContent = text;
      fitAwardName(text);
      return;
    }
    awardName.appendChild(document.createTextNode(m[1]));
    const suffix = document.createElement("span");
    suffix.className = "award-suffix";
    suffix.textContent = m[2];
    awardName.appendChild(suffix);
    // 拆成两行之后按**较长那一行**定字号，而不是整串 —— 否则等于白拆。
    fitAwardName(m[1].length >= m[2].length ? m[1] : m[2], true);
  }

  /**
   * 字号按名字**估算宽度**降档，不是按字符数 —— 中文字约占 1 个字宽，拉丁字母约 0.55，
   * 按字符数分档会把「ETHAN TYO」这种明明放得下的短英文名也误降一档。
   *
   * 默认字号是照「三个中文字」调的（与致辞姓名同大）。赞助商感谢状改成逐位颁发之后，
   * 「EURO POWER LIFT TRUCK SDN BHD」这种公司名照原字号会撑成两三行，才需要这套降档。
   * 阈值按「整屏宽 ÷ 字号」能放多少个字宽估的；短名字不带 class，显示效果完全不变。
   *
   * `isCompany`（带 SDN BHD 这类后缀、上面已经拆成两行的）一律**至少**降到 long 这一档：
   * 同一个环节里逐位翻过去，「VR GREEN MOTOR」按估算宽度够不上降档门槛，就会比
   * 「EURO POWER LIFT TRUCK」大将近一倍，现场看着像两块不同的画面。赞助商之间字号统一
   * 比单个名字尽量大更重要；真的超长（> 19 字宽）照旧继续降到 xlong。
   */
  function fitAwardName(measured: string, isCompany = false): void {
    const text = measured.trim();
    let em = 0;
    for (const ch of text) em += /[⺀-鿿豈-﫿＀-｠]/.test(ch) ? 1 : 0.55;
    const xlong = em > 19;
    awardName.classList.toggle("xlong", xlong);
    awardName.classList.toggle("long", !xlong && (isCompany || em > 10));
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
      const groupBox = div("roster-group");
      if (g.label) groupBox.appendChild(div("roster-group-title", g.label));
      const names = div("roster-names");
      for (const h of g.items) {
        const item = div("roster-item");
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
      groupBox.appendChild(names);
      rosterTrack.appendChild(groupBox);
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
    plaques.textContent = "";
    for (const h of honourees) {
      const card = div("plaque");
      card.append(
        div("plaque-label", "感 谢 状"),
        div("plaque-name", h.nameZh),
        div("plaque-org", h.nameEn ?? h.org ?? ""),
      );
      plaques.appendChild(card);
    }
  }

  return {
    render(state, segment, honourees) {
      root.dataset.kind = segment.kind;

      // 大屏只放中英标题 —— 时间 / 副标题 / 备注 / 颁发人 / 陪同都是流程表的内部信息，
      // 「播放 AI 短片」这类更是执行提示，一律只留在运维台。
      titleZh.textContent = segment.titleZh;
      titleEn.textContent = segment.titleEn ?? "";

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
        // 抽奖只在抽奖图层上演；这里退回一张标题卡。
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
    },
    reset() {
      lastKey = "";
    },
  };
}
