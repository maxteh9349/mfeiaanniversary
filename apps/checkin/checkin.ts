import { displayName, type Guest } from "../../shared/events.ts";
import { getBackend } from "../shared/backend.ts";

const view = document.getElementById("view") as HTMLElement;

// ---- tiny helpers ---------------------------------------------------------
function h(html: string): void {
  view.innerHTML = html;
}
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

// ---- view -----------------------------------------------------------------
function renderNewGuest(): void {
  h(`
    <h2 class="step-title">新嘉宾登记</h2>
    <label class="lbl">称谓</label>
    <div class="gender" id="title-group">
      <button class="g-btn" data-t="先生">先生</button>
      <button class="g-btn" data-t="女士">女士</button>
      <button class="g-btn" data-t="拿督">拿督</button>
      <button class="g-btn" data-t="拿督斯里">拿督斯里</button>
      <button class="g-btn" data-t="丹斯里">丹斯里</button>
      <button class="g-btn" data-t="博士">博士</button>
      <button class="g-btn" data-t="__other">其他（请填写）</button>
    </div>
    <input id="title-other" class="field" type="text" placeholder="请填写称谓" hidden />
    <label class="lbl">姓名 *</label>
    <input id="name" class="field" type="text" placeholder="您的姓名" />
    <label class="lbl">公司 / 单位</label>
    <input id="company" class="field" type="text" placeholder="选填" />
    <button id="submit" class="primary-btn">确认签到</button>
  `);
  let title = "";
  const otherInput = document.getElementById("title-other") as HTMLInputElement;
  view.querySelectorAll<HTMLElement>(".g-btn").forEach((b) =>
    b.addEventListener("click", () => {
      view.querySelectorAll(".g-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      const t = b.dataset.t ?? "";
      if (t === "__other") {
        otherInput.hidden = false;
        otherInput.focus();
        title = otherInput.value.trim();
      } else {
        otherInput.hidden = true;
        title = t;
      }
    }),
  );
  otherInput.addEventListener("input", () => {
    title = otherInput.value.trim();
  });
  (document.getElementById("submit") as HTMLElement).addEventListener("click", () => {
    const name = (document.getElementById("name") as HTMLInputElement).value.trim();
    const company = (document.getElementById("company") as HTMLInputElement).value.trim();
    if (!name) {
      (document.getElementById("name") as HTMLInputElement).focus();
      return;
    }
    submit({ name, company, title });
  });
}

async function submit(body: { name: string; company: string; title: string }): Promise<void> {
  h(`<div class="loading"><div class="spinner"></div><p>正在签到…</p></div>`);
  try {
    const backend = await getBackend();
    const { guest, fresh } = await backend.checkin(body);
    renderSuccess(guest, fresh);
  } catch {
    h(`
      <div class="error">
        <p>网络连接不稳定，签到未成功。</p>
        <button id="retry" class="primary-btn">重试</button>
      </div>`);
    (document.getElementById("retry") as HTMLElement).addEventListener("click", () => submit(body));
  }
}

function renderSuccess(guest: Guest, fresh: boolean): void {
  h(`
    <div class="success">
      <div class="check">✓</div>
      <h2>${fresh ? "签到成功！" : "您已签到"}</h2>
      <p class="welcome">欢迎您，<strong>${esc(displayName(guest))}</strong></p>
      <p class="enter">您的虚拟形象正在进入会场…</p>
      <p class="look">请抬头看大屏 👀</p>
    </div>
  `);
}

renderNewGuest();
