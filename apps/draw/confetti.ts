// Lightweight canvas confetti for the winner reveal (no such system existed).
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  size: number;
  color: string;
}

const COLORS = ["#ffd266", "#38e1ff", "#ff6b6b", "#7ac943", "#7a6cff", "#ffffff"];

export class Confetti {
  private ctx: CanvasRenderingContext2D;
  private parts: Particle[] = [];
  private raf = 0;
  private endAt = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.resize();
    addEventListener("resize", () => this.resize());
  }

  private resize(): void {
    this.canvas.width = innerWidth;
    this.canvas.height = innerHeight;
  }

  /** Rain confetti for `durationMs`; can be called repeatedly to top up. */
  burst(durationMs: number, count = 220): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    for (let i = 0; i < count; i++) {
      this.parts.push({
        x: Math.random() * w,
        y: -20 - Math.random() * h * 0.3,
        vx: (Math.random() - 0.5) * 3,
        vy: 2 + Math.random() * 4,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        size: 6 + Math.random() * 8,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
      });
    }
    this.endAt = performance.now() + durationMs;
    if (!this.raf) this.loop();
  }

  private loop = (): void => {
    const { ctx } = this;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, this.canvas.width, h);
    for (const p of this.parts) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.05; // gravity
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }
    this.parts = this.parts.filter((p) => p.y < h + 30);
    if (this.parts.length || performance.now() < this.endAt) {
      this.raf = requestAnimationFrame(this.loop);
    } else {
      ctx.clearRect(0, 0, this.canvas.width, h);
      this.raf = 0;
    }
  };
}
