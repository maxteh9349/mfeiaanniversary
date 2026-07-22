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
    <label class="lbl">称谓 *</label>
    <select id="title" class="field select">
      <option value="">请选择称谓</option>
      <optgroup label="国家荣誉">
        <option value="丹斯里">丹斯里（Tan Sri）</option>
        <option value="丹斯里夫人">丹斯里夫人（Puan Sri）</option>
        <option value="拿督斯里">拿督斯里（Dato' Sri）</option>
        <option value="拿汀斯里">拿汀斯里（Datin Sri）</option>
        <option value="拿督">拿督（Dato'）</option>
        <option value="拿汀">拿汀（Datin）</option>
      </optgroup>
      <optgroup label="学术">
        <option value="教授">教授（Prof.）</option>
        <option value="博士">博士（Dr.）</option>
      </optgroup>
      <optgroup label="一般">
        <option value="先生">先生</option>
        <option value="女士">女士</option>
        <option value="小姐">小姐</option>
        <option value="太太">太太</option>
      </optgroup>
      <option value="__other">其他（请填写）</option>
    </select>
    <input id="title-other" class="field" type="text" placeholder="请填写称谓" hidden />
    <label class="lbl">姓名 *</label>
    <input id="name" class="field" type="text" placeholder="您的姓名" />
    <label class="lbl">公司 / 单位</label>
    <input id="company" class="field" type="text" placeholder="选填" />
    <p id="form-err" class="form-err"></p>
    <button id="submit" class="primary-btn">确认签到</button>
  `);
  const select = document.getElementById("title") as HTMLSelectElement;
  const otherInput = document.getElementById("title-other") as HTMLInputElement;
  const nameInput = document.getElementById("name") as HTMLInputElement;
  const errEl = document.getElementById("form-err") as HTMLElement;

  select.addEventListener("change", () => {
    otherInput.hidden = select.value !== "__other";
    if (!otherInput.hidden) otherInput.focus();
  });

  function fail(message: string, focus: HTMLElement): void {
    errEl.textContent = message;
    focus.focus();
  }

  (document.getElementById("submit") as HTMLElement).addEventListener("click", () => {
    errEl.textContent = "";
    const title = select.value === "__other" ? otherInput.value.trim() : select.value;
    if (!title) return fail("请选择称谓", select.value === "__other" ? otherInput : select);
    const name = nameInput.value.trim();
    if (!name) return fail("请填写姓名", nameInput);
    const company = (document.getElementById("company") as HTMLInputElement).value.trim();
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
