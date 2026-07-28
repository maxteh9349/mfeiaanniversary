import type {
  Guest,
  Honouree,
  Prize,
  PrizeLevel,
  Segment,
  SegmentKind,
  StageState,
  WinnerStatus,
} from "../../shared/events.ts";
import { STAGE_VOLUME_DEFAULT } from "../../shared/events.ts";
import { DRAW_DEFAULTS } from "../../shared/config.ts";
import { getBackend } from "../shared/backend.ts";

const PRIZE_LEVELS: Record<PrizeLevel, string> = {
  grand: "特等奖",
  second: "二等奖",
  third: "三等奖",
  lucky: "幸运奖",
};
const WINNER_STATUS: Record<WinnerStatus, string> = {
  pending: "待领取",
  claimed: "已领取",
  forfeit: "已弃权",
};
const SEGMENT_KINDS: Record<SegmentKind, string> = {
  title: "过场标题",
  speech: "致辞",
  roster: "整屏名单",
  award: "逐位颁奖",
  sponsor_thanks: "赞助商感谢状",
  lucky_draw: "幸运抽奖",
};

// ID-only console login: the typed ID maps to a Supabase account
// <id>@mfeia.local, signed in with this shared, build-embedded password.
// (Low-security by design — the venue console is gated by knowing a valid ID.)
const CONSOLE_DOMAIN = "mfeia.local";
const CONSOLE_PW = "mfeia-console-2026";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---- 现场 / 布置 两页 -------------------------------------------------------
// 纯展示层：body[data-tab] 决定显示哪一组板块，所有板块照常初始化（隐藏的也能用），
// 所以这里既不用懒加载也不碰任何业务逻辑。选中的页记在 localStorage —— 晚宴中途
// 刷新运维台，回来还停在「现场」。
const TAB_KEY = "mfeia.admin.tab";
function selectTab(tab: string): void {
  document.body.dataset.tab = tab;
  for (const b of document.querySelectorAll<HTMLButtonElement>("#tabs button")) {
    b.classList.toggle("on", b.dataset.go === tab);
  }
  localStorage.setItem(TAB_KEY, tab);
}
$("tabs").addEventListener("click", (e) => {
  const tab = (e.target as HTMLElement).dataset.go;
  if (tab) selectTab(tab);
});
selectTab(localStorage.getItem(TAB_KEY) === "setup" ? "setup" : "live");

// Wrapped in an async IIFE (not top-level await) so the build keeps the default
// browser target — guests' phones on the check-in page may be older browsers.
void (async () => {
  const msg = $("m-msg");
  const totalEl = $("total");
  const listEl = $("list");

  const backend = await getBackend();
  await ensureAuth();

  async function refreshStats(): Promise<void> {
    const { total, recent } = await backend.getStats();
    totalEl.textContent = String(total);
    renderList(recent);
  }

  function renderList(guests: Guest[]): void {
    listEl.innerHTML = guests
      .map(
        (g) => `<li data-id="${g.id}">
        <span>${esc(g.name)}</span>
        <span class="company">${esc(g.company ?? "")}</span>
        <button class="trigger">↻ 重新触发</button>
      </li>`,
      )
      .join("");
  }

  // Manual check-in.
  $("m-submit").addEventListener("click", async () => {
    const name = ($("m-name") as HTMLInputElement).value.trim();
    if (!name) return;
    const company = ($("m-company") as HTMLInputElement).value.trim();
    const gender = ($("m-gender") as HTMLSelectElement).value;
    try {
      const { guest } = await backend.checkin({ name, company, gender });
      msg.textContent = `已签到：${guest.name}`;
    } catch (err) {
      msg.textContent = `失败：${(err as Error).message}`;
    }
    ($("m-name") as HTMLInputElement).value = "";
    ($("m-company") as HTMLInputElement).value = "";
    void refreshStats();
  });

  // Replay trigger + search.
  listEl.addEventListener("click", async (e) => {
    const li = (e.target as HTMLElement).closest("li") as HTMLElement | null;
    if (li && (e.target as HTMLElement).classList.contains("trigger")) {
      await backend.triggerSpawn(Number(li.dataset.id));
    }
  });

  $("search").addEventListener("input", async (e) => {
    const q = (e.target as HTMLInputElement).value.trim();
    if (!q) return void refreshStats();
    renderList(await backend.searchGuests(q));
  });

  // Toggle the big-screen "最新签到嘉宾" panel (checked = shown). The screen
  // reacts live via its config subscription.
  const feedToggle = $<HTMLInputElement>("feed-toggle");
  void backend.getGuestFeedHidden().then((hidden) => {
    feedToggle.checked = !hidden;
  });
  feedToggle.addEventListener("change", async () => {
    try {
      await backend.setGuestFeedHidden(!feedToggle.checked);
    } catch {
      feedToggle.checked = !feedToggle.checked; // revert on failure
    }
  });

  // Toggle the big-screen bottom "签到流程" bar (checked = shown).
  const flowToggle = $<HTMLInputElement>("flow-toggle");
  void backend.getCheckinFlowHidden().then((hidden) => {
    flowToggle.checked = !hidden;
  });
  flowToggle.addEventListener("change", async () => {
    try {
      await backend.setCheckinFlowHidden(!flowToggle.checked);
    } catch {
      flowToggle.checked = !flowToggle.checked; // revert on failure
    }
  });

  // Danger zone: wipe all attendee + draw data. Double-confirm — it is irreversible.
  const clearMsg = $("clear-msg");
  $("clear-all").addEventListener("click", async () => {
    if (!confirm("确定要清除全部数据吗？\n\n将永久删除：所有签到记录、嘉宾、中奖记录与抽奖日志。\n保留：赞助商、奖品、大屏设置。\n\n此操作不可撤销！")) return;
    if (!confirm("再次确认：真的要清空吗？")) return;
    clearMsg.textContent = "清除中…";
    try {
      await backend.resetEvent();
      clearMsg.textContent = "✅ 已清除全部数据";
      await refreshStats();
      try {
        await loadPrizes();
        await loadWinners();
        // reset_event() also clears the rundown's aired marks — refresh the grid.
        await loadSegments();
      } catch {
        /* draw + stage are Supabase-only; ignore in local mode */
      }
    } catch (err) {
      clearMsg.textContent = `清除失败：${(err as Error).message}`;
    }
  });

  // ---- big-screen slogan --------------------------------------------------
  const tMsg = $("t-msg");
  async function loadSlogan(): Promise<void> {
    const { slogan } = await backend.getTexts();
    ($("t-slogan") as HTMLInputElement).value = slogan;
  }
  $("t-slogan-apply").addEventListener("click", async () => {
    const slogan = ($("t-slogan") as HTMLInputElement).value;
    try {
      await backend.setTexts(slogan);
      tMsg.textContent = "已更新大屏标语";
    } catch {
      tMsg.textContent = "更新失败";
    }
  });

  // ---- sponsors -----------------------------------------------------------
  const sMsg = $("s-msg");
  const sListEl = $<HTMLUListElement>("s-list");

  async function loadSponsors(): Promise<void> {
    const { logos, intervalSec } = await backend.listSponsors();
    ($("s-interval") as HTMLInputElement).value = String(intervalSec);
    sListEl.innerHTML = logos
      .map(
        (l) => `<li data-id="${l.id}">
        <img src="${l.url}" alt="" style="height:40px;background:#fff;border-radius:6px;padding:4px" />
        <span class="company"></span>
        <button class="s-del trigger">删除</button>
      </li>`,
      )
      .join("");
  }

  ($("s-file") as HTMLInputElement).addEventListener("change", async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    sMsg.textContent = "上传中…";
    try {
      const photo = await fileToDataUrl(file);
      await backend.addSponsor(photo);
      sMsg.textContent = "已添加";
    } catch {
      sMsg.textContent = "上传失败";
    }
    input.value = "";
    void loadSponsors();
  });

  sListEl.addEventListener("click", async (e) => {
    const li = (e.target as HTMLElement).closest("li") as HTMLElement | null;
    if (li && (e.target as HTMLElement).classList.contains("s-del")) {
      await backend.deleteSponsor(Number(li.dataset.id));
      void loadSponsors();
    }
  });

  $("s-interval-apply").addEventListener("click", async () => {
    const intervalSec = Number(($("s-interval") as HTMLInputElement).value);
    if (!Number.isFinite(intervalSec) || intervalSec <= 0) {
      sMsg.textContent = "秒数无效";
      return;
    }
    try {
      await backend.setSponsorInterval(intervalSec);
      sMsg.textContent = "秒数已更新";
    } catch {
      sMsg.textContent = "秒数无效";
    }
  });

  /**
   * Gate the console behind sign-in when the backend requires it (Supabase).
   * Local mode reports auth.enabled=false and resolves immediately. Resolves
   * only once a session exists; renders a login overlay otherwise.
   */
  async function ensureAuth(): Promise<void> {
    if (!backend.auth.enabled) return;
    if (await backend.auth.getSession()) return;
    await new Promise<void>((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "login-overlay";
      overlay.innerHTML = `
        <form class="login-card">
          <h2>运维台登录</h2>
          <input id="login-id" type="text" placeholder="ID" autocomplete="username" autocapitalize="off" autocorrect="off" />
          <button id="login-btn" type="submit">登录</button>
          <div id="login-err" class="msg"></div>
        </form>`;
      document.body.appendChild(overlay);
      const err = overlay.querySelector("#login-err") as HTMLElement;
      (overlay.querySelector(".login-card") as HTMLFormElement).addEventListener("submit", async (e) => {
        e.preventDefault();
        const id = (overlay.querySelector("#login-id") as HTMLInputElement).value.trim().toLowerCase();
        if (!id) {
          err.textContent = "请输入 ID";
          return;
        }
        err.textContent = "登录中…";
        // Map the ID to its fixed-domain Supabase account + shared console password.
        const email = id.includes("@") ? id : `${id}@${CONSOLE_DOMAIN}`;
        const { error } = await backend.auth.signIn(email, CONSOLE_PW);
        if (error) {
          err.textContent = `登录失败：${error}`;
          return;
        }
        overlay.remove();
        resolve();
      });
    });
  }

  // ---- programme segments (/stage) ---------------------------------------
  const gMsg = $("g-msg");
  const eMsg = $("e-msg");
  const hList = $<HTMLUListElement>("h-list");
  let segments: Segment[] = [];
  /** Honourees of the segment open in the editor. */
  let editing: Honouree[] = [];
  let editingSegmentId: number | null = null;
  let editingHonoureeId: number | null = null;
  let stage: StageState = { active: false, segmentId: null, index: 0, volume: STAGE_VOLUME_DEFAULT };
  /** 点「静音」前的音量，再点一下要能回到原来的大小。 */
  let volumeBeforeMute = STAGE_VOLUME_DEFAULT;
  /** Tile highlighted in the rundown grid (selection ≠ what is on the screen). */
  let selectedSegmentId: number | null = null;
  /** segmentId -> honouree count, so every tile can show 「N 位」. */
  let segCounts = new Map<number, number>();
  /** Honourees per segment — the cursor readout needs the live segment's count. */
  const honoureeCache = new Map<number, Honouree[]>();

  async function honoureesOf(segmentId: number): Promise<Honouree[]> {
    const hit = honoureeCache.get(segmentId);
    if (hit) return hit;
    const list = await backend.listHonourees(segmentId);
    honoureeCache.set(segmentId, list);
    return list;
  }

  const segById = (id: number | null): Segment | undefined =>
    id == null ? undefined : segments.find((s) => s.id === id);

  function segOptionLabel(s: Segment): string {
    return `${s.timeLabel ? `${s.timeLabel} · ` : ""}${s.titleZh}（${SEGMENT_KINDS[s.kind] ?? s.kind}）`;
  }

  function fillSegSelect(sel: HTMLSelectElement, keep: number | null): void {
    sel.textContent = "";
    for (const s of segments) {
      const opt = document.createElement("option");
      opt.value = String(s.id);
      opt.textContent = segOptionLabel(s); // textContent: titles are operator-entered
      sel.appendChild(opt);
    }
    if (keep != null && segments.some((s) => s.id === keep)) sel.value = String(keep);
  }

  async function loadSegments(): Promise<void> {
    const [list, counts] = await Promise.all([backend.listSegments(), backend.honoureeCounts()]);
    segments = list;
    segCounts = counts;
    const eSel = $<HTMLSelectElement>("e-seg");
    fillSegSelect(eSel, editingSegmentId ?? (eSel.value ? Number(eSel.value) : null));
    // Default the grid selection to whatever is live, else the first segment.
    if (selectedSegmentId == null || !segments.some((s) => s.id === selectedSegmentId)) {
      selectedSegmentId = stage.segmentId ?? segments[0]?.id ?? null;
    }
    renderSegmentGrid();
  }

  /**
   * The rundown as a wall of tiles: the whole evening at a glance, with the live
   * segment highlighted, played ones ticked, and the award cursor as a progress
   * bar. Built with createElement/textContent — segment titles are operator text.
   */
  function renderSegmentGrid(): void {
    const grid = $("g-grid");
    grid.textContent = "";
    for (const s of segments) {
      const live = stage.active && stage.segmentId === s.id;
      const total = segCounts.get(s.id) ?? 0;

      const tile = document.createElement("div");
      tile.className = "seg-tile";
      tile.dataset.id = String(s.id);
      if (live) tile.classList.add("live");
      if (s.id === selectedSegmentId) tile.classList.add("sel");
      if (s.airedAt != null) tile.classList.add("aired");

      const head = document.createElement("div");
      head.className = "seg-head";
      if (live) {
        const dot = document.createElement("i");
        dot.className = "seg-dot";
        head.appendChild(dot);
      }
      const time = document.createElement("span");
      time.className = "seg-time";
      time.textContent = s.timeLabel ?? "—";
      head.appendChild(time);
      if (live || s.airedAt != null) {
        const flag = document.createElement("span");
        flag.className = "seg-flag";
        flag.textContent = live ? "正在播" : "✓ 已播";
        head.appendChild(flag);
      }
      tile.appendChild(head);

      const title = document.createElement("div");
      title.className = "seg-title";
      title.textContent = s.titleZh;
      tile.appendChild(title);

      const meta = document.createElement("div");
      meta.className = "seg-meta";
      const kind = document.createElement("span");
      kind.className = "seg-kind";
      kind.textContent = SEGMENT_KINDS[s.kind] ?? s.kind;
      meta.appendChild(kind);
      if (total > 0) {
        const count = document.createElement("span");
        count.className = "seg-count";
        count.textContent = `${total} 位`;
        meta.appendChild(count);
      }
      if (s.imageUrl) {
        const img = document.createElement("span");
        img.className = "seg-img-flag";
        img.textContent = "已配图";
        meta.appendChild(img);
      }
      if (s.videoUrl) {
        const vid = document.createElement("span");
        vid.className = "seg-img-flag seg-vid-flag";
        vid.textContent = "▶ 短片";
        meta.appendChild(vid);
        // 配了短片的格子直接给一个静音快捷键（音量大小用上面的滑杆）。
        const mute = document.createElement("button");
        mute.className = "seg-mute";
        mute.textContent = stage.volume === 0 ? "🔇" : "🔊";
        mute.title = stage.volume === 0 ? "点击恢复声音" : "点击静音";
        meta.appendChild(mute);
      }
      tile.appendChild(meta);

      // Progress only makes sense for the award segment currently being called.
      if (live && s.kind === "award" && total > 0) {
        const prog = document.createElement("div");
        prog.className = "seg-progress";
        const bar = document.createElement("span");
        bar.className = "seg-bar";
        const fill = document.createElement("i");
        fill.style.width = `${Math.min(100, ((stage.index + 1) / total) * 100)}%`;
        bar.appendChild(fill);
        const pos = document.createElement("span");
        pos.className = "seg-pos";
        pos.textContent = stage.index >= total ? "礼成 · 合照" : `第 ${stage.index + 1} / ${total} 位`;
        prog.append(bar, pos);
        tile.appendChild(prog);
      }

      // 编辑 + 上台。只有 ▶ 上台 会切大屏，编辑跳去布置页改内容，互不误触。
      const actions = document.createElement("div");
      actions.className = "seg-actions";
      const edit = document.createElement("button");
      edit.className = "seg-edit";
      edit.textContent = "✎ 编辑";
      const air = document.createElement("button");
      air.className = "seg-air";
      air.textContent = live ? "▶ 重新上台" : "▶ 上台";
      actions.append(edit, air);
      tile.appendChild(actions);

      grid.appendChild(tile);
    }
  }

  /** Which honouree is on the screen right now (the tile already shows the rest). */
  async function renderCursor(): Promise<void> {
    const el = $("g-cursor");
    el.textContent = "";
    const seg = segById(stage.segmentId);
    if (!stage.active || !seg) {
      el.textContent = "大屏当前：签到大厅（未上台任何环节）";
      return;
    }
    if (seg.kind !== "award") return;
    const list = await honoureesOf(seg.id);
    if (stage.index >= list.length) {
      el.textContent = "本环节已到「合照」收尾";
      return;
    }
    const h = list[stage.index];
    el.append(document.createTextNode("当前上台："));
    const b = document.createElement("b");
    b.textContent = h.nameZh;
    el.appendChild(b);
    const extra = [h.nameEn, h.org].filter(Boolean).join(" · ");
    if (extra) el.append(document.createTextNode(`　${extra}`));
  }

  async function applyStage(next: StageState): Promise<void> {
    await backend.setStageState(next);
    stage = next;
    renderVolume();
    renderSegmentGrid();
    await renderCursor();
  }

  // ---- 短片音量：写进 stage 状态，正在播的大屏实时跟随 ----
  const volSlider = $<HTMLInputElement>("g-volume");
  const volVal = $("g-volume-val");

  /** 让滑杆 / 数字 / 静音图标跟当前 stage 状态一致（初始化和每次改动后都调）。 */
  function renderVolume(): void {
    volSlider.value = String(stage.volume);
    volVal.textContent = `${stage.volume}%`;
    $("g-mute").textContent = stage.volume === 0 ? "🔇" : "🔊";
  }

  async function setVolume(volume: number): Promise<void> {
    const v = Math.max(0, Math.min(100, Math.round(volume)));
    if (v === stage.volume) return;
    if (v > 0) volumeBeforeMute = v;
    try {
      await applyStage({ ...stage, volume: v });
      gMsg.textContent = v === 0 ? "短片已静音" : `短片音量 ${v}%`;
    } catch (err) {
      gMsg.textContent = `音量设置失败：${(err as Error).message}`;
      renderVolume(); // 写失败就把滑杆拨回真实值
    }
  }

  // 拖动时只更新数字，松手（change）才写库 —— 每次写都是一条实时事件，别刷屏。
  volSlider.addEventListener("input", () => (volVal.textContent = `${volSlider.value}%`));
  volSlider.addEventListener("change", () => void setVolume(Number(volSlider.value)));
  $("g-mute").addEventListener("click", () => {
    void setVolume(stage.volume === 0 ? volumeBeforeMute || STAGE_VOLUME_DEFAULT : 0);
  });

  /** Clamp an award cursor to [0, count] — count itself is the 合照 card. */
  async function maxIndex(seg: Segment | undefined): Promise<number> {
    if (!seg || seg.kind !== "award") return 0;
    return (await honoureesOf(seg.id)).length;
  }

  /** Put a segment on the big screen and tick it as played. */
  async function airSegment(id: number): Promise<void> {
    const seg = segById(id);
    if (!seg) return void (gMsg.textContent = "环节不存在，请刷新");
    selectedSegmentId = id;
    try {
      await applyStage({ ...stage, active: true, segmentId: id, index: 0 });
      await backend.markSegmentAired(id);
      seg.airedAt = Date.now(); // local echo so the ✓ shows without a reload
      renderSegmentGrid();
      if (seg.kind === "lucky_draw") {
        // 抽奖画面已经在大屏上了，操作台顺手滚到抽奖面板，省一次找。
        gMsg.textContent = `已上台：${seg.titleZh} —— 请在下方抽奖控制台选奖品并开始`;
        $("draw-console").scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        gMsg.textContent = seg.imageUrl
          ? `已上台：${seg.titleZh}`
          : `已上台：${seg.titleZh}（未配图，大屏显示标题文字卡）`;
      }
    } catch (err) {
      gMsg.textContent = `上台失败：${(err as Error).message}`;
    }
  }

  // Tile click selects; only the tile's own ▶ button cuts the big screen, so a
  // stray click while browsing the rundown can't change what guests are seeing.
  $("g-grid").addEventListener("click", (e) => {
    const tile = (e.target as HTMLElement).closest(".seg-tile") as HTMLElement | null;
    if (!tile) return;
    const id = Number(tile.dataset.id);
    const target = e.target as HTMLElement;
    if (target.classList.contains("seg-air")) {
      void airSegment(id);
      return;
    }
    if (target.classList.contains("seg-edit")) {
      void editSegment(id);
      return;
    }
    if (target.classList.contains("seg-mute")) {
      void setVolume(stage.volume === 0 ? volumeBeforeMute || STAGE_VOLUME_DEFAULT : 0);
      return;
    }
    selectedSegmentId = id;
    renderSegmentGrid();
  });

  /** 格子上的「✎ 编辑」：跳到布置页，把这个环节载进编辑器。大屏不受影响。 */
  async function editSegment(id: number): Promise<void> {
    selectedSegmentId = id;
    renderSegmentGrid();
    selectTab("setup");
    $<HTMLSelectElement>("e-seg").value = String(id);
    await openSegment(id);
    $("segment-editor").scrollIntoView({ behavior: "smooth", block: "start" });
    eMsg.textContent = `正在编辑：${segById(id)?.titleZh ?? ""}`;
  }

  // 「⟲ 一键恢复环节」：排练跑完一遍后，把整场流程恢复成未开始的样子 ——
  // 清掉全部已播标记 + 大屏退回大厅 + 游标归零。环节内容 / 名单 / 图片 / 短片全不动。
  $("g-clear-aired").addEventListener("click", async () => {
    const hasMarks = segments.some((s) => s.airedAt != null);
    if (!hasMarks && !stage.active) return void (gMsg.textContent = "流程已经是未开始状态");
    if (
      !confirm(
        "确定把整场流程重置到未开始吗？\n" +
          "会清除全部「已播」标记，并让大屏退回大厅画面。\n" +
          "环节内容、名单、图片、短片都不受影响。",
      )
    ) {
      return;
    }
    try {
      if (hasMarks) {
        await backend.clearAiredMarks();
        for (const s of segments) s.airedAt = null;
      }
      // applyStage 内部已经重画格子墙与游标行。
      await applyStage({ ...stage, active: false, segmentId: null, index: 0 });
      gMsg.textContent = "已恢复：全部标记已清除，大屏已回到大厅画面";
    } catch (err) {
      gMsg.textContent = `恢复失败：${(err as Error).message}`;
    }
  });

  async function step(delta: number): Promise<void> {
    const seg = segById(stage.segmentId);
    if (!stage.active || !seg) return void (gMsg.textContent = "尚未上台任何环节");
    if (seg.kind !== "award") return void (gMsg.textContent = "该环节不是逐位颁奖，无需翻名单");
    const top = await maxIndex(seg);
    const index = Math.max(0, Math.min(top, stage.index + delta));
    if (index === stage.index) {
      gMsg.textContent = delta > 0 ? "已是最后一项" : "已是第一位";
      return;
    }
    try {
      await applyStage({ ...stage, index });
      gMsg.textContent = "";
    } catch (err) {
      gMsg.textContent = `切换失败：${(err as Error).message}`;
    }
  }

  $("g-next").addEventListener("click", () => void step(1));
  $("g-prev").addEventListener("click", () => void step(-1));

  $("g-jump-go").addEventListener("click", async () => {
    const seg = segById(stage.segmentId);
    if (!stage.active || !seg) return void (gMsg.textContent = "尚未上台任何环节");
    const n = Number($<HTMLInputElement>("g-jump").value);
    if (!Number.isFinite(n) || n < 1) return void (gMsg.textContent = "请输入 1 起的位次");
    const top = await maxIndex(seg);
    const index = Math.min(top, Math.floor(n) - 1);
    try {
      await applyStage({ ...stage, index });
      gMsg.textContent = "";
    } catch (err) {
      gMsg.textContent = `跳转失败：${(err as Error).message}`;
    }
  });

  $("g-fullscreen").addEventListener("click", () => window.open("/stage", "_blank"));

  // End the segment: /stage sees active=false and hands the screen back to /screen.
  $("g-return").addEventListener("click", async () => {
    try {
      await applyStage({ ...stage, active: false });
      gMsg.textContent = "已通知大屏返回大厅画面";
    } catch (err) {
      gMsg.textContent = `返回失败：${(err as Error).message}`;
    }
  });

  // ← / → drive the name list without reaching for the mouse. Ignored while the
  // operator is typing so editing a name doesn't advance the big screen.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    e.preventDefault();
    void step(e.key === "ArrowRight" ? 1 : -1);
  });

  // ---- segment + honouree editor ----
  function readSegmentForm() {
    return {
      kind: $<HTMLSelectElement>("e-kind").value as SegmentKind,
      timeLabel: $<HTMLInputElement>("e-time").value.trim() || null,
      titleZh: $<HTMLInputElement>("e-title-zh").value.trim(),
      titleEn: $<HTMLInputElement>("e-title-en").value.trim() || null,
      subtitle: $<HTMLInputElement>("e-subtitle").value.trim() || null,
      presenter: $<HTMLInputElement>("e-presenter").value.trim() || null,
      escort: $<HTMLInputElement>("e-escort").value.trim() || null,
      note: $<HTMLInputElement>("e-note").value.trim() || null,
      autoScroll: $<HTMLInputElement>("e-scroll").checked,
      videoUrl: $<HTMLInputElement>("e-video").value.trim() || null,
      sort: Number($<HTMLInputElement>("e-sort").value) || 0,
    };
  }

  function fillSegmentForm(s: Segment | null): void {
    $<HTMLSelectElement>("e-kind").value = s?.kind ?? "title";
    $<HTMLInputElement>("e-time").value = s?.timeLabel ?? "";
    $<HTMLInputElement>("e-title-zh").value = s?.titleZh ?? "";
    $<HTMLInputElement>("e-title-en").value = s?.titleEn ?? "";
    $<HTMLInputElement>("e-subtitle").value = s?.subtitle ?? "";
    $<HTMLInputElement>("e-presenter").value = s?.presenter ?? "";
    $<HTMLInputElement>("e-escort").value = s?.escort ?? "";
    $<HTMLInputElement>("e-note").value = s?.note ?? "";
    $<HTMLInputElement>("e-scroll").checked = !!s?.autoScroll;
    $<HTMLInputElement>("e-video").value = s?.videoUrl ?? "";
    $<HTMLInputElement>("e-sort").value = String(s?.sort ?? (segments.at(-1)?.sort ?? 0) + 10);
    fillSegmentImage(s ?? null);
  }

  /** Thumbnail + 「移除图片」 reflect what the big screen would overlay right now. */
  function fillSegmentImage(s: Segment | null): void {
    const thumb = $<HTMLImageElement>("e-img-thumb");
    const del = $<HTMLButtonElement>("e-img-del");
    $<HTMLInputElement>("e-img").value = "";
    if (s?.imageUrl) {
      thumb.src = s.imageUrl;
      thumb.hidden = false;
      del.hidden = false;
    } else {
      thumb.removeAttribute("src");
      thumb.hidden = true;
      del.hidden = true;
    }
  }

  /** Store the picture, then re-read segments so grid + thumbnail agree with the DB. */
  async function saveSegmentImage(dataUrl: string | null): Promise<void> {
    if (editingSegmentId == null) return void (eMsg.textContent = "请先选择或保存环节");
    const id = editingSegmentId;
    eMsg.textContent = dataUrl ? "上传中…" : "移除中…";
    try {
      await backend.setSegmentImage(id, dataUrl);
      await loadSegments();
      fillSegmentImage(segById(id) ?? null);
      // The live segment picks the change up over realtime — no need to re-air it.
      eMsg.textContent = dataUrl ? "已上传环节大图" : "已移除环节大图";
    } catch (err) {
      eMsg.textContent = `${dataUrl ? "上传" : "移除"}失败：${(err as Error).message}`;
    }
  }

  $("e-img").addEventListener("change", async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    await saveSegmentImage(await fileToDataUrl(file));
    input.value = "";
  });

  $("e-img-del").addEventListener("click", () => {
    if (!confirm("确定移除这个环节的大图吗？\n上台时大屏将改为显示标题文字卡。")) return;
    void saveSegmentImage(null);
  });

  function resetHonoureeForm(): void {
    editingHonoureeId = null;
    for (const id of ["h-zh", "h-en", "h-org", "h-group"]) $<HTMLInputElement>(id).value = "";
    $("h-save").textContent = "添加";
    $<HTMLButtonElement>("h-cancel").hidden = true;
  }

  function renderHonourees(): void {
    $("h-count").textContent = String(editing.length);
    hList.textContent = "";
    for (const [i, h] of editing.entries()) {
      const li = document.createElement("li");
      li.dataset.id = String(h.id);
      // Mark the honouree currently on the big screen.
      if (stage.active && stage.segmentId === editingSegmentId && stage.index === i) li.classList.add("h-live");
      const idx = document.createElement("span");
      idx.className = "h-idx";
      idx.textContent = String(i + 1);
      const name = document.createElement("span");
      name.textContent = h.nameZh;
      const meta = document.createElement("span");
      meta.className = "company";
      meta.textContent = [h.nameEn, h.org].filter(Boolean).join(" · ");
      const group = document.createElement("span");
      group.className = "h-group";
      group.textContent = h.groupLabel ?? "";
      li.append(idx, name, meta, group);
      for (const [cls, text] of [
        ["h-up trigger", "↑"],
        ["h-down trigger", "↓"],
        ["h-edit trigger", "改"],
        ["h-del trigger", "删"],
      ] as const) {
        const b = document.createElement("button");
        b.className = cls;
        b.textContent = text;
        li.appendChild(b);
      }
      hList.appendChild(li);
    }
  }

  async function openSegment(id: number | null): Promise<void> {
    editingSegmentId = id;
    resetHonoureeForm();
    const seg = segById(id);
    fillSegmentForm(seg ?? null);
    editing = id != null && seg ? await honoureesOf(id) : [];
    renderHonourees();
  }

  $("e-seg").addEventListener("change", (e) => {
    void openSegment(Number((e.target as HTMLSelectElement).value));
  });

  $("e-new").addEventListener("click", () => {
    void openSegment(null);
    eMsg.textContent = "填写后点「保存环节」即新增";
  });

  $("e-save").addEventListener("click", async () => {
    const input = readSegmentForm();
    if (!input.titleZh) return void (eMsg.textContent = "请填写中文标题");
    try {
      if (editingSegmentId == null) {
        const created = await backend.createSegment(input);
        await loadSegments();
        $<HTMLSelectElement>("e-seg").value = String(created.id);
        await openSegment(created.id);
        eMsg.textContent = "已新增环节";
      } else {
        await backend.updateSegment(editingSegmentId, input);
        await loadSegments();
        await renderCursor();
        eMsg.textContent = "已保存环节";
      }
    } catch (err) {
      eMsg.textContent = `保存失败：${(err as Error).message}`;
    }
  });

  $("e-del").addEventListener("click", async () => {
    if (editingSegmentId == null) return void (eMsg.textContent = "没有选中的环节");
    const seg = segById(editingSegmentId);
    if (!confirm(`确定删除环节「${seg?.titleZh ?? ""}」及其名单吗？\n此操作不可撤销。`)) return;
    try {
      await backend.deleteSegment(editingSegmentId);
      honoureeCache.delete(editingSegmentId);
      // Deleting the live segment leaves the screen pointing at nothing — park it.
      if (stage.segmentId === editingSegmentId) await applyStage({ ...stage, active: false, segmentId: null, index: 0 });
      editingSegmentId = null;
      await loadSegments();
      await openSegment(segments[0]?.id ?? null);
      eMsg.textContent = "已删除环节";
    } catch (err) {
      eMsg.textContent = `删除失败：${(err as Error).message}`;
    }
  });

  $("h-save").addEventListener("click", async () => {
    if (editingSegmentId == null) return void (eMsg.textContent = "请先选择或保存环节");
    const nameZh = $<HTMLInputElement>("h-zh").value.trim();
    if (!nameZh) return void (eMsg.textContent = "请填写姓名 / 公司");
    const input = {
      nameZh,
      nameEn: $<HTMLInputElement>("h-en").value.trim() || null,
      org: $<HTMLInputElement>("h-org").value.trim() || null,
      groupLabel: $<HTMLInputElement>("h-group").value.trim() || null,
    };
    try {
      if (editingHonoureeId == null) await backend.addHonouree(editingSegmentId, input);
      else await backend.updateHonouree(editingHonoureeId, input);
      honoureeCache.delete(editingSegmentId);
      resetHonoureeForm();
      editing = await honoureesOf(editingSegmentId);
      segCounts.set(editingSegmentId, editing.length); // keep the grid's 「N 位」 honest
      renderHonourees();
      renderSegmentGrid();
      await renderCursor();
      eMsg.textContent = "已保存名单";
    } catch (err) {
      eMsg.textContent = `保存失败：${(err as Error).message}`;
    }
  });

  $("h-cancel").addEventListener("click", () => {
    resetHonoureeForm();
    eMsg.textContent = "";
  });

  hList.addEventListener("click", async (e) => {
    const li = (e.target as HTMLElement).closest("li") as HTMLElement | null;
    if (!li || editingSegmentId == null) return;
    const id = Number(li.dataset.id);
    const i = editing.findIndex((h) => h.id === id);
    if (i < 0) return;
    const cls = (e.target as HTMLElement).classList;
    try {
      if (cls.contains("h-edit")) {
        const h = editing[i];
        editingHonoureeId = h.id;
        $<HTMLInputElement>("h-zh").value = h.nameZh;
        $<HTMLInputElement>("h-en").value = h.nameEn ?? "";
        $<HTMLInputElement>("h-org").value = h.org ?? "";
        $<HTMLInputElement>("h-group").value = h.groupLabel ?? "";
        $("h-save").textContent = "保存修改";
        $<HTMLButtonElement>("h-cancel").hidden = false;
        return;
      }
      if (cls.contains("h-del")) {
        if (!confirm(`确定删除「${editing[i].nameZh}」吗？`)) return;
        await backend.deleteHonouree(id);
        if (editingHonoureeId === id) resetHonoureeForm();
      } else if (cls.contains("h-up") || cls.contains("h-down")) {
        const j = cls.contains("h-up") ? i - 1 : i + 1;
        if (j < 0 || j >= editing.length) return;
        const order = editing.map((h) => h.id);
        [order[i], order[j]] = [order[j], order[i]];
        await backend.reorderHonourees(editingSegmentId, order);
      } else return;
      honoureeCache.delete(editingSegmentId);
      editing = await honoureesOf(editingSegmentId);
      segCounts.set(editingSegmentId, editing.length);
      renderHonourees();
      renderSegmentGrid();
      await renderCursor();
    } catch (err) {
      eMsg.textContent = `操作失败：${(err as Error).message}`;
    }
  });

  async function initStage(): Promise<void> {
    stage = await backend.getStageState();
    volumeBeforeMute = stage.volume || STAGE_VOLUME_DEFAULT;
    renderVolume();
    await loadSegments();
    await renderCursor();
    await openSegment(stage.segmentId ?? segments[0]?.id ?? null);
  }

  // ---- lucky draw ---------------------------------------------------------
  const dMsg = $("d-msg");
  const pMsg = $("p-msg");
  const pList = $<HTMLUListElement>("p-list");
  const wList = $<HTMLUListElement>("w-list");
  let prizes: Prize[] = [];
  let drawPrizeId: number | null = null; // prize the current roll is for
  let currentWinnerId: number | null = null; // last committed winner (for redraw)

  async function loadPrizes(): Promise<void> {
    prizes = await backend.listPrizes();
    pList.innerHTML = prizes
      .map(
        (p) => `<li data-id="${p.id}">
        <span>${esc(p.name)}</span>
        <span class="company">${PRIZE_LEVELS[p.level] ?? p.level} · 剩 ${p.remaining}/${p.quantity}${p.sponsor ? " · " + esc(p.sponsor) : ""}</span>
        <button class="p-del trigger">删除</button>
      </li>`,
      )
      .join("");
    const sel = $<HTMLSelectElement>("d-prize");
    const keep = sel.value;
    sel.innerHTML = prizes
      .filter((p) => p.status === "active")
      .map((p) => `<option value="${p.id}">${esc(p.name)}（${PRIZE_LEVELS[p.level] ?? p.level}，剩 ${p.remaining}）</option>`)
      .join("");
    if (keep) sel.value = keep;
  }

  async function loadWinners(): Promise<void> {
    const winners = await backend.listWinners();
    wList.innerHTML = winners
      .map(
        (w) => `<li data-id="${w.id}">
        <span>${esc(w.guestName)}</span>
        <span class="company">${WINNER_STATUS[w.status] ?? w.status}</span>
        ${w.status === "pending" ? `<button class="w-claim trigger">已领取</button><button class="w-forfeit trigger">弃权</button>` : ""}
        <button class="w-del trigger">删除</button>
      </li>`,
      )
      .join("");
  }

  const prizeById = (id: number): Prize | undefined => prizes.find((p) => p.id === id);

  $("p-add").addEventListener("click", async () => {
    const name = ($("p-name") as HTMLInputElement).value.trim();
    if (!name) return void (pMsg.textContent = "请输入奖品名称");
    const quantity = Number(($("p-qty") as HTMLInputElement).value);
    if (!Number.isFinite(quantity) || quantity < 1) return void (pMsg.textContent = "数量无效");
    const level = ($("p-level") as HTMLSelectElement).value as PrizeLevel;
    const sponsor = ($("p-sponsor") as HTMLInputElement).value.trim();
    const file = ($("p-file") as HTMLInputElement).files?.[0];
    pMsg.textContent = "保存中…";
    try {
      const imageDataUrl = file ? await fileToDataUrl(file) : null;
      await backend.createPrize({ name, level, sponsor, quantity, imageDataUrl });
      pMsg.textContent = "已添加";
      ($("p-name") as HTMLInputElement).value = "";
      ($("p-sponsor") as HTMLInputElement).value = "";
      ($("p-qty") as HTMLInputElement).value = "1";
      ($("p-file") as HTMLInputElement).value = "";
      await loadPrizes();
    } catch (err) {
      pMsg.textContent = `保存失败：${(err as Error).message}`;
    }
  });

  pList.addEventListener("click", async (e) => {
    const li = (e.target as HTMLElement).closest("li") as HTMLElement | null;
    if (li && (e.target as HTMLElement).classList.contains("p-del")) {
      try {
        await backend.deletePrize(Number(li.dataset.id));
        await loadPrizes();
      } catch {
        pMsg.textContent = "删除失败（该奖品已有中奖记录，请改为归档）";
      }
    }
  });

  $("d-start").addEventListener("click", async () => {
    const prizeId = Number(($("d-prize") as HTMLSelectElement).value);
    const prize = prizeById(prizeId);
    if (!prize) return void (dMsg.textContent = "请先选择奖品");
    if (prize.remaining <= 0) return void (dMsg.textContent = "该奖品已抽完");
    try {
      const reel = await backend.drawPoolSample(DRAW_DEFAULTS.reelSize);
      if (!reel.length) return void (dMsg.textContent = "抽奖池为空（无可抽嘉宾）");
      drawPrizeId = prizeId;
      currentWinnerId = null;
      await backend.logDraw("draw_started", prizeId);
      await backend.broadcastDraw({ type: "roll_start", prize, reel, countdownMs: DRAW_DEFAULTS.countdownSec * 1000 });
      dMsg.textContent = "滚动中… 点击「停止揭晓」抽出中奖者";
    } catch (err) {
      dMsg.textContent = `开始失败：${(err as Error).message}`;
    }
  });

  $("d-stop").addEventListener("click", async () => {
    if (!drawPrizeId) return void (dMsg.textContent = "尚未开始抽奖");
    const prize = prizeById(drawPrizeId);
    try {
      const winner = await backend.pickWinner(drawPrizeId);
      currentWinnerId = winner.id;
      await backend.logDraw("draw_stopped", drawPrizeId);
      if (prize) await backend.broadcastDraw({ type: "reveal", prize, winner });
      dMsg.textContent = `🎉 中奖：${winner.guestName}`;
      await loadPrizes();
      await loadWinners();
    } catch (err) {
      dMsg.textContent = `抽奖失败：${(err as Error).message}`;
    }
  });

  $("d-redraw").addEventListener("click", async () => {
    if (!currentWinnerId) return void (dMsg.textContent = "没有可重抽的当前中奖者");
    try {
      const winner = await backend.redraw(currentWinnerId);
      currentWinnerId = winner.id;
      const prize = prizeById(winner.prizeId);
      if (prize) await backend.broadcastDraw({ type: "reveal", prize, winner });
      dMsg.textContent = `🎉 重抽中奖：${winner.guestName}`;
      await loadPrizes();
      await loadWinners();
    } catch (err) {
      dMsg.textContent = `重抽失败：${(err as Error).message}`;
    }
  });

  $("d-reset").addEventListener("click", async () => {
    await backend.broadcastDraw({ type: "reset" });
    drawPrizeId = null;
    currentWinnerId = null;
    dMsg.textContent = "已清屏";
  });

  $("d-fullscreen").addEventListener("click", () => window.open("/draw", "_blank"));

  // End the draw segment: tell the /draw presentation to return to the lobby /screen.
  $("d-return").addEventListener("click", async () => {
    try {
      await backend.broadcastDraw({ type: "screen" });
      dMsg.textContent = "已通知大屏返回大厅画面";
    } catch (err) {
      dMsg.textContent = `返回失败：${(err as Error).message}`;
    }
  });

  wList.addEventListener("click", async (e) => {
    const li = (e.target as HTMLElement).closest("li") as HTMLElement | null;
    if (!li) return;
    const id = Number(li.dataset.id);
    const t = e.target as HTMLElement;
    try {
      if (t.classList.contains("w-claim")) await backend.setWinnerStatus(id, "claimed");
      else if (t.classList.contains("w-forfeit")) {
        await backend.setWinnerStatus(id, "forfeit");
        await loadPrizes();
      } else if (t.classList.contains("w-del")) {
        if (!confirm("确定删除这条中奖记录吗？\n若该中奖仍有效，将归还奖品名额与该嘉宾的抽奖资格。")) return;
        await backend.deleteWinner(id);
        await loadPrizes();
      } else return;
      await loadWinners();
    } catch (err) {
      dMsg.textContent = `操作失败：${(err as Error).message}`;
    }
  });

  void refreshStats();
  setInterval(refreshStats, 5000);
  void loadSponsors();
  void loadSlogan();
  void loadPrizes();
  void loadWinners();
  void initStage();
})();

/** Read + downscale an image file to a data URL (logos kept ≤512px). */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 512;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = reject;
    img.src = url;
  });
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
