import type { Guest } from "../../shared/events.ts";
import { getBackend } from "../shared/backend.ts";

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

  void refreshStats();
  setInterval(refreshStats, 5000);
  void loadSponsors();
  void loadSlogan();
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
