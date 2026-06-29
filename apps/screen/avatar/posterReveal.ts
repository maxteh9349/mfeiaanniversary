import { displayName, type Guest } from "../../../shared/events.ts";

/** Public path to the welcome poster (drop the file at assets/welcome.png). */
const POSTER_SRC = "/welcome.png";

/**
 * Full-screen welcome poster shown for a few seconds whenever a guest checks in,
 * with the guest's title + name overlaid. Fades in, holds, fades out — then the
 * live 3D scene shows through again. Bursts are serialised so posters don't stack.
 */
export class PosterReveal {
  private root: HTMLElement;
  private posterEl: HTMLImageElement;
  private nameEl: HTMLElement;
  private queue: Guest[] = [];
  private busy = false;
  private readonly holdMs: number;

  constructor(root: HTMLElement, holdMs = 5000) {
    this.root = root;
    this.holdMs = holdMs;
    this.posterEl = root.querySelector<HTMLImageElement>(".hero-poster")!;
    this.nameEl = root.querySelector<HTMLElement>(".hero-name")!;
    // Hide the <img> if the poster file is absent (keeps the dark overlay + name).
    this.posterEl.addEventListener("error", () => {
      this.posterEl.style.visibility = "hidden";
    });
    this.posterEl.src = POSTER_SRC;
  }

  show(guest: Guest): void {
    this.queue.push(guest);
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.busy || this.queue.length === 0) return;
    this.busy = true;
    const guest = this.queue.shift()!;
    try {
      this.nameEl.textContent = displayName(guest);
      await this.play();
    } catch (err) {
      console.warn("[poster] reveal failed", err);
    } finally {
      this.busy = false;
      void this.pump();
    }
  }

  /** Fade in, hold, fade out; resolve when fully hidden. */
  private play(): Promise<void> {
    return new Promise((resolve) => {
      this.root.classList.remove("show");
      void this.root.offsetWidth; // force reflow so the fade re-triggers
      this.root.classList.add("show");
      setTimeout(() => {
        this.root.classList.remove("show");
        setTimeout(resolve, 600); // wait for the fade-out transition
      }, this.holdMs);
    });
  }
}
