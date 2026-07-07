// Slot-machine name reel: cycles rapidly through pool names, then decelerates
// and locks onto the winner. The winner is decided server-side; this only
// animates the reveal, so `stopOn` simply eases the swap interval to a stop.

export class Reel {
  private names: string[] = ["—"];
  private timer = 0;
  private i = 0;

  constructor(private el: HTMLElement) {}

  /** Begin fast cycling through `names`. */
  start(names: string[]): void {
    clearTimeout(this.timer);
    this.names = names.length ? names : ["—"];
    this.el.classList.remove("locked");
    this.i = 0;
    const tick = (): void => {
      this.el.textContent = this.names[this.i++ % this.names.length];
      this.timer = window.setTimeout(tick, 60);
    };
    tick();
  }

  /**
   * Decelerate the cycling and land on `winner`. Resolves once locked so the
   * caller can fire the reveal + confetti. Total time ≈ `durationMs`.
   */
  stopOn(winner: string, durationMs = 2200): Promise<void> {
    clearTimeout(this.timer);
    return new Promise((resolve) => {
      const start = performance.now();
      let delay = 60;
      const step = (): void => {
        const elapsed = performance.now() - start;
        if (elapsed >= durationMs) {
          this.el.textContent = winner;
          this.el.classList.add("locked");
          resolve();
          return;
        }
        // show a random name most of the way, easing the swap interval up
        this.el.textContent = this.names[Math.floor(Math.random() * this.names.length)];
        delay = Math.min(360, delay * 1.16);
        this.timer = window.setTimeout(step, delay);
      };
      step();
    });
  }

  reset(): void {
    clearTimeout(this.timer);
    this.el.classList.remove("locked");
    this.el.textContent = "准备开始";
  }
}
