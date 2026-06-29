import { displayName, type Guest, type SponsorLogo } from "../../../shared/events.ts";
import { DEFAULTS } from "../../../shared/config.ts";
import { getBackend } from "../../shared/backend.ts";
import { loadLogoBase, whiteSolidCanvas } from "../logo.ts";

/** "07:32 PM" 12-hour format matching the design. */
function fmtTime(d: Date): string {
  let h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${String(h).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} ${ampm}`;
}

/** Drives the DOM overlay: counter, recent-checkin list, QR, and clock. */
export class Hud {
  private counterEl = document.getElementById("counter") as HTMLElement;
  private listEl = document.getElementById("recent-list") as HTMLElement;
  private qrEl = document.getElementById("qr") as HTMLImageElement;
  private timeEl = document.getElementById("clock-time") as HTMLElement;
  private dateEl = document.getElementById("clock-date") as HTMLElement;
  private displayed = 0;

  // Sponsor logo carousel.
  private sponsorEl = document.getElementById("sponsor-logo") as HTMLElement | null;
  private sponsorFallback = "";
  private sponsors: SponsorLogo[] = [];
  private sponsorIdx = 0;
  private sponsorTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startClock();
    void this.loadQr();
    this.loadBrandLogo();
    this.sponsorFallback = this.sponsorEl?.innerHTML ?? "";
  }

  /**
   * Show sponsor logos in the sponsor card, rotating one at a time every
   * `intervalSec`. Empty list restores the built-in fallback mark.
   */
  setSponsors(logos: SponsorLogo[], intervalSec: number): void {
    if (this.sponsorTimer) {
      clearInterval(this.sponsorTimer);
      this.sponsorTimer = null;
    }
    this.sponsors = logos;
    this.sponsorIdx = 0;
    if (!this.sponsorEl) return;
    if (logos.length === 0) {
      this.sponsorEl.innerHTML = this.sponsorFallback;
      return;
    }
    this.sponsorEl.innerHTML = `<img class="sponsor-img" alt="赞助商" />`;
    const img = this.sponsorEl.querySelector("img") as HTMLImageElement;
    img.src = logos[0].url;
    if (logos.length < 2) return;
    const sec = Math.max(1, intervalSec);
    this.sponsorTimer = setInterval(() => {
      this.sponsorIdx = (this.sponsorIdx + 1) % this.sponsors.length;
      const next = this.sponsors[this.sponsorIdx].url;
      img.classList.add("fade");
      setTimeout(() => {
        img.src = next;
        img.classList.remove("fade");
      }, 180);
    }, sec * 1000);
  }

  /**
   * Top-left brand logo (white background keyed out). Prefers the full logo
   * with the "MFEIA" wordmark (LogoFull.png); falls back to the icon-only
   * Logo.png used by the central portal.
   */
  private loadBrandLogo(): void {
    const el = document.getElementById("brand-logo") as HTMLImageElement | null;
    if (!el) return;
    const apply = (r: Awaited<ReturnType<typeof loadLogoBase>>) => {
      if (r) el.src = whiteSolidCanvas(r.base, r.s).toDataURL();
    };
    void loadLogoBase("/LogoFull.png").then((r) => (r ? apply(r) : loadLogoBase("/Logo.png").then(apply)));
  }

  setTotal(total: number): void {
    // Roll the number up for a lively counter.
    const from = this.displayed;
    const start = performance.now();
    const dur = 600;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / dur);
      this.counterEl.textContent = String(Math.round(from + (total - from) * k));
      if (k < 1) requestAnimationFrame(step);
      else this.displayed = total;
    };
    requestAnimationFrame(step);
  }

  private itemHtml(g: Guest): string {
    const company = g.company ? `<span class="ri-company">${esc(g.company)}</span>` : "";
    const name = esc(displayName(g));
    return `<span class="ri-info">
        <span class="ri-name">${name}</span>
        ${company}
      </span>
      <span class="ri-time">${fmtTime(new Date(g.checkedInAt))}</span>`;
  }

  setRecent(guests: Guest[]): void {
    this.listEl.innerHTML = guests.map((g) => `<li class="recent-item">${this.itemHtml(g)}</li>`).join("");
  }

  /** Prepend a guest to the recent list with a highlight animation. */
  pushRecent(guest: Guest): void {
    const li = document.createElement("li");
    li.className = "recent-item enter";
    li.innerHTML = this.itemHtml(guest);
    this.listEl.prepend(li);
    while (this.listEl.children.length > DEFAULTS.recentLimit) this.listEl.lastElementChild?.remove();
    requestAnimationFrame(() => li.classList.remove("enter"));
  }

  private async loadQr(): Promise<void> {
    try {
      const backend = await getBackend();
      this.qrEl.src = await backend.qrDataUrl();
    } catch {
      /* QR is non-critical; ignore if backend not ready */
    }
  }

  private startClock(): void {
    const tick = () => {
      const d = new Date();
      this.timeEl.textContent = fmtTime(d);
      this.dateEl.textContent = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
      setTimeout(tick, 1000);
    };
    tick();
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
