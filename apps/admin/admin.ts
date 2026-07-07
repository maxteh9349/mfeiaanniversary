import type { Guest, Prize, PrizeLevel, WinnerStatus } from "../../shared/events.ts";
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

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

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
          <input id="login-email" type="email" placeholder="邮箱" autocomplete="username" />
          <input id="login-pw" type="password" placeholder="密码" autocomplete="current-password" />
          <button id="login-btn" type="submit">登录</button>
          <div id="login-err" class="msg"></div>
        </form>`;
      document.body.appendChild(overlay);
      const err = overlay.querySelector("#login-err") as HTMLElement;
      (overlay.querySelector(".login-card") as HTMLFormElement).addEventListener("submit", async (e) => {
        e.preventDefault();
        err.textContent = "登录中…";
        const email = (overlay.querySelector("#login-email") as HTMLInputElement).value.trim();
        const pw = (overlay.querySelector("#login-pw") as HTMLInputElement).value;
        const { error } = await backend.auth.signIn(email, pw);
        if (error) {
          err.textContent = `登录失败：${error}`;
          return;
        }
        overlay.remove();
        resolve();
      });
    });
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
