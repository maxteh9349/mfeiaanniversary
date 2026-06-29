// Hero reveal card — local, offline composite of a guest's real face onto a
// holographic mech body. Shown front-and-centre on the big screen the moment a
// guest checks in (then the 3D avatar walks into the crowd as before).
//
// Pipeline (all on a 2D canvas, no network / no AI at runtime):
//   1. draw a holographic mech BODY template (assets/hologram/bodyN.png), or a
//      procedural mech silhouette when the PNG is missing;
//   2. oval-crop + feather the guest photo, lightly "holographise" it (blue
//      cast, glass-helmet highlight, cyan rim, faint scanlines) so the real
//      face reads as a person inside the suit — not a flat blue mask;
//   3. paste the face at the template's anchor, add a glow platform, rising
//      particles and corner brackets that match the HUD palette.

import type { Guest } from "../../../shared/events.ts";

const CARD_W = 720;
const CARD_H = 1080;
// Region the mech body (template or fallback) occupies inside the card (2:3).
const BODY = { x: 60, y: 96, w: 600, h: 900 };

export const TEMPLATE_COUNT = 4;

const CYAN = "#38e1ff";

/** Vibrant neon accents keyed per template — different guests get different colours. */
const ACCENTS = ["#22e0ff", "#4d8bff", "#a86bff", "#ff5cf0"];

/** Where the face is composited per template (card-space). Tune after art lands. */
interface Anchor {
  cx: number;
  cy: number;
  r: number;
}
const FACE_ANCHORS: Anchor[] = [
  { cx: 360, cy: 200, r: 78 },
  { cx: 360, cy: 200, r: 78 },
  { cx: 360, cy: 200, r: 78 },
  { cx: 360, cy: 200, r: 78 },
];

// ---- template loading (cached; null = PNG absent -> procedural fallback) ----
const templateCache = new Map<number, Promise<HTMLImageElement | null>>();
function loadTemplate(i: number): Promise<HTMLImageElement | null> {
  let p = templateCache.get(i);
  if (!p) {
    p = new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      // Missing variant -> fall back to the shared body0.png (so dropping in a
      // single template uses it for everyone); body0 missing -> procedural.
      img.onerror = () => {
        if (i === 0) return resolve(null);
        const img0 = new Image();
        img0.onload = () => resolve(img0);
        img0.onerror = () => resolve(null);
        img0.src = `/hologram/body0.png`;
      };
      img.src = `/hologram/body${i}.png`;
    });
    templateCache.set(i, p);
  }
  return p;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// ---- small canvas helpers --------------------------------------------------
type C = CanvasRenderingContext2D;
function offscreen(w: number, h: number): [HTMLCanvasElement, C] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

/** Oval-cropped, soft-feathered face (cover-fit) at diameter 2r. */
function ovalFace(img: HTMLImageElement, r: number): HTMLCanvasElement {
  const s = r * 2;
  const [c, x] = offscreen(s, s);
  x.save();
  // feathered circular mask
  const g = x.createRadialGradient(r, r, r * 0.7, r, r, r);
  g.addColorStop(0, "#fff");
  g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g;
  x.beginPath();
  x.arc(r, r, r, 0, 7);
  x.fill();
  x.globalCompositeOperation = "source-in";
  const side = Math.min(img.width, img.height);
  // favour the upper portion of the photo (faces sit high)
  x.drawImage(img, (img.width - side) / 2, (img.height - side) * 0.25, side, side, 0, 0, s, s);
  x.restore();
  return c;
}

/**
 * Bright holographic helmet head used when a guest has no photo — a glowing
 * blue dome with a luminous visor and two accent "eyes" so the figure always
 * reads as a proper robot head (never an empty gap).
 */
function placeholderHead(r: number, accent: string): HTMLCanvasElement {
  const s = r * 2;
  const [c, x] = offscreen(s, s);
  x.save();
  // translucent blue dome (matches the body) with a soft accent glow
  x.shadowColor = accent;
  x.shadowBlur = 16;
  x.fillStyle = "rgba(34,80,170,0.78)";
  x.beginPath();
  x.arc(r, r, r * 0.9, 0, 7);
  x.fill();
  // luminous visor band
  x.shadowBlur = 12;
  x.fillStyle = "rgba(180,240,255,0.92)";
  x.beginPath();
  x.roundRect(r - r * 0.5, r - r * 0.06, r * 1.0, r * 0.26, r * 0.12);
  x.fill();
  // two glowing eyes on the visor
  x.fillStyle = accent;
  for (const dx of [-r * 0.22, r * 0.22]) {
    x.beginPath();
    x.arc(r + dx, r + r * 0.07, r * 0.07, 0, 7);
    x.fill();
  }
  x.restore();
  return c;
}

/** Paste a face canvas at an anchor and apply a light holographic treatment. */
function drawFaceAt(x: C, face: HTMLCanvasElement, a: Anchor, accent: string): void {
  const { cx, cy, r } = a;

  // the face itself (no halo glow above the head — keep it clean & modern)
  x.drawImage(face, cx - r, cy - r, r * 2, r * 2);

  // clip remaining effects to the face circle
  x.save();
  x.beginPath();
  x.arc(cx, cy, r, 0, 7);
  x.clip();
  // subtle blue cast (kept light so real faces aren't over-tinted)
  x.fillStyle = "rgba(42,108,255,0.14)";
  x.fillRect(cx - r, cy - r, r * 2, r * 2);
  // faint scanlines
  x.fillStyle = "rgba(0,20,40,0.10)";
  for (let yy = cy - r; yy < cy + r; yy += 4) x.fillRect(cx - r, yy, r * 2, 1.5);
  // glass highlight sweep (top-left)
  const gloss = x.createLinearGradient(cx - r, cy - r, cx + r * 0.3, cy + r * 0.3);
  gloss.addColorStop(0, "rgba(255,255,255,0.30)");
  gloss.addColorStop(0.5, "rgba(255,255,255,0)");
  x.fillStyle = gloss;
  x.fillRect(cx - r, cy - r, r * 2, r * 2);
  x.restore();

  // single clean accent rim — crisp helmet edge, no diffuse halo
  x.save();
  x.shadowColor = accent;
  x.shadowBlur = 8;
  x.strokeStyle = accent;
  x.lineWidth = 3;
  x.beginPath();
  x.arc(cx, cy, r + 2, 0, 7);
  x.stroke();
  x.restore();
}

/** Procedural holographic mech silhouette (used when bodyN.png is missing). */
function drawMechFallback(x: C, accent: string): void {
  const cx = CARD_W / 2;
  x.save();
  x.lineJoin = "round";
  x.lineCap = "round";
  const plate = (draw: () => void) => {
    x.beginPath();
    draw();
    x.shadowColor = accent;
    x.shadowBlur = 26;
    x.fillStyle = "rgba(34,80,170,0.72)"; // brighter, more saturated electric blue
    x.fill();
    x.shadowBlur = 12;
    x.lineWidth = 4;
    x.strokeStyle = accent;
    x.stroke();
  };
  const limb = (pts: [number, number][], w: number) => {
    x.beginPath();
    x.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) x.lineTo(pts[i][0], pts[i][1]);
    x.shadowColor = accent;
    x.shadowBlur = 20;
    x.lineWidth = w + 8;
    x.strokeStyle = "rgba(34,80,170,0.9)";
    x.stroke();
    x.lineWidth = w;
    x.strokeStyle = accent;
    x.stroke();
  };

  // Absolute card-space layout: head sits at the FACE_ANCHOR (~y200, r78, so the
  // head bottom ≈278); the body hangs from a neck there down to feet that rest
  // on the platform (platform centre at y≈1010).
  // neck (connects up into the head)
  plate(() => x.roundRect(cx - 26, 268, 52, 56, 14));
  // legs + boots (stand on the platform)
  limb([[cx - 46, 650], [cx - 52, 800], [cx - 50, 916]], 54);
  limb([[cx + 46, 650], [cx + 52, 800], [cx + 50, 916]], 54);
  plate(() => x.roundRect(cx - 88, 906, 82, 60, 16));
  plate(() => x.roundRect(cx + 6, 906, 82, 60, 16));
  // arms down at sides
  limb([[cx - 122, 348], [cx - 152, 520], [cx - 140, 644]], 40);
  limb([[cx + 122, 348], [cx + 152, 520], [cx + 140, 644]], 40);
  // torso
  plate(() => {
    x.moveTo(cx - 122, 330);
    x.lineTo(cx + 122, 330);
    x.quadraticCurveTo(cx + 156, 470, cx + 98, 604);
    x.lineTo(cx - 98, 604);
    x.quadraticCurveTo(cx - 156, 470, cx - 122, 330);
    x.closePath();
  });
  // pelvis
  plate(() => x.roundRect(cx - 94, 600, 188, 76, 18));
  // chest core glow line
  x.shadowColor = accent;
  x.shadowBlur = 18;
  x.strokeStyle = accent;
  x.lineWidth = 6;
  x.beginPath();
  x.moveTo(cx, 350);
  x.lineTo(cx, 596);
  x.stroke();
  x.restore();
}

/** Glow platform the figure stands on (tinted with the card's accent). */
function drawPlatform(x: C, accent: string): void {
  const cx = CARD_W / 2;
  const cy = CARD_H - 70;
  x.save();
  // bright cyan inner rings + an accent-tinted outer ring for multi-colour pop
  x.shadowColor = accent;
  for (const [rx, ry, lw, color] of [
    [230, 56, 6, "rgba(120,225,255,0.95)"],
    [180, 42, 3, "rgba(160,235,255,0.7)"],
    [280, 70, 3, accent],
  ] as const) {
    x.beginPath();
    x.ellipse(cx, cy, rx, ry, 0, 0, 7);
    x.shadowBlur = 26;
    x.lineWidth = lw;
    x.strokeStyle = color;
    x.stroke();
  }
  const g = x.createRadialGradient(cx, cy, 10, cx, cy, 230);
  g.addColorStop(0, "rgba(80,225,255,0.34)");
  g.addColorStop(1, "rgba(56,225,255,0)");
  x.fillStyle = g;
  x.beginPath();
  x.ellipse(cx, cy, 230, 56, 0, 0, 7);
  x.fill();
  x.restore();
}

/** Rising particle dots across the card. */
function drawParticles(x: C): void {
  x.save();
  x.globalCompositeOperation = "lighter";
  for (let i = 0; i < 70; i++) {
    const px = Math.random() * CARD_W;
    const py = Math.random() * CARD_H;
    const r = Math.random() * 2 + 0.6;
    x.fillStyle = `rgba(143,208,255,${0.25 + Math.random() * 0.5})`;
    x.beginPath();
    x.arc(px, py, r, 0, 7);
    x.fill();
  }
  x.restore();
}

/** Cyan corner brackets framing the card. */
function drawCornerFrame(x: C): void {
  x.save();
  x.shadowColor = CYAN;
  x.shadowBlur = 10;
  x.strokeStyle = CYAN;
  x.lineWidth = 4;
  const m = 26;
  const L = 60;
  const corner = (ox: number, oy: number, sx: number, sy: number) => {
    x.beginPath();
    x.moveTo(ox, oy + sy * L);
    x.lineTo(ox, oy);
    x.lineTo(ox + sx * L, oy);
    x.stroke();
  };
  corner(m, m, 1, 1);
  corner(CARD_W - m, m, -1, 1);
  corner(m, CARD_H - m, 1, -1);
  corner(CARD_W - m, CARD_H - m, -1, -1);
  x.restore();
}

/** Compose the full hero card onto `x` (sized CARD_W x CARD_H). */
async function renderHeroCard(x: C, faceUrl: string | null, i: number): Promise<void> {
  const accent = ACCENTS[i % ACCENTS.length];
  x.clearRect(0, 0, CARD_W, CARD_H);
  drawPlatform(x, accent);

  const tpl = await loadTemplate(i);
  if (tpl) {
    // Realistic template (body0.png) already has its own head/face — draw it
    // as-is, no face overlay, no glowing ring.
    x.drawImage(tpl, BODY.x, BODY.y, BODY.w, BODY.h);
  } else {
    // No template -> procedural fallback needs a head composited on the open neck.
    drawMechFallback(x, accent);
    const a = FACE_ANCHORS[i] ?? FACE_ANCHORS[0];
    let face: HTMLCanvasElement;
    if (faceUrl) {
      try {
        face = ovalFace(await loadImage(faceUrl), a.r);
      } catch {
        face = placeholderHead(a.r, accent);
      }
    } else {
      face = placeholderHead(a.r, accent);
    }
    drawFaceAt(x, face, a, accent);
  }

  drawParticles(x);
  drawCornerFrame(x);
}

// ---- reveal controller -----------------------------------------------------
/**
 * Drives the #hero-reveal DOM overlay: composites a card per check-in, plays the
 * entrance animation, holds, then fades out. Serialises bursts so cards don't
 * stack (one guest's hero moment at a time).
 */
export class HeroReveal {
  private root: HTMLElement;
  private ctx: C;
  private nameEl: HTMLElement;
  private subEl: HTMLElement;
  private queue: Guest[] = [];
  private busy = false;
  private readonly holdMs: number;

  constructor(root: HTMLElement, holdMs = 3500) {
    this.root = root;
    this.holdMs = holdMs;
    const canvas = root.querySelector<HTMLCanvasElement>(".hero-canvas")!;
    canvas.width = CARD_W;
    canvas.height = CARD_H;
    this.ctx = canvas.getContext("2d")!;
    this.nameEl = root.querySelector<HTMLElement>(".hero-name")!;
    this.subEl = root.querySelector<HTMLElement>(".hero-sub")!;
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
      await renderHeroCard(this.ctx, guest.photoUrl, guest.avatarId % TEMPLATE_COUNT);
      this.nameEl.textContent = guest.title ? `${guest.title} ${guest.name}` : guest.name;
      this.subEl.textContent = guest.company ?? "";
      await this.play();
    } catch (err) {
      console.warn("[hero] reveal failed", err);
    } finally {
      this.busy = false;
      void this.pump();
    }
  }

  /** Toggle the `.show` class (entrance + hold + exit) and resolve when done. */
  private play(): Promise<void> {
    return new Promise((resolve) => {
      this.root.classList.remove("show");
      void this.root.offsetWidth; // force reflow so the animation re-triggers
      this.root.classList.add("show");
      setTimeout(() => {
        this.root.classList.remove("show");
        setTimeout(resolve, 600); // wait for the fade-out transition
      }, this.holdMs);
    });
  }
}
