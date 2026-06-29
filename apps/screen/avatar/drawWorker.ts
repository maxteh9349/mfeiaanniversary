// Parametric chibi foundry-worker illustration drawn on a 2D canvas.
// Produces the placeholder avatar set in the style of the reference UI (big
// head, clean dark outline, soft cel shading, friendly face, work uniform).
// Replaced 1:1 by AI PNGs (assets/avatars/avatarN.png) when present.

export type Pose = "thumbsUp" | "hips" | "wave" | "open" | "tablet" | "crossed";

export interface WorkerSpec {
  skin: string;
  uniform: string;
  uniformDark: string;
  cap: "cap" | "hardhat" | "none";
  capColor: string;
  hair: "short" | "ponytail" | "bun" | "buzz";
  hairColor: string;
  glasses: boolean;
  pose: Pose;
}

const OUTLINE = "#15233f";
const PANTS = "#26304a";
const PANTS_D = "#1b2236";
const BOOT = "#23170f";

export const SPECS: WorkerSpec[] = [
  { skin: "#f1c49a", uniform: "#3f7fcf", uniformDark: "#2f63a8", cap: "cap", capColor: "#1d3a6b", hair: "short", hairColor: "#1c1208", glasses: false, pose: "thumbsUp" },
  { skin: "#e9b488", uniform: "#8a7250", uniformDark: "#6f5b3d", cap: "none", capColor: "#000", hair: "ponytail", hairColor: "#241404", glasses: false, pose: "tablet" },
  { skin: "#d99a6c", uniform: "#2f6f8f", uniformDark: "#235871", cap: "hardhat", capColor: "#ffce3a", hair: "short", hairColor: "#0e0a06", glasses: false, pose: "hips" },
  { skin: "#f1c49a", uniform: "#4a5a8a", uniformDark: "#39466e", cap: "none", capColor: "#000", hair: "buzz", hairColor: "#16100a", glasses: false, pose: "open" },
  { skin: "#e9b488", uniform: "#2f7a64", uniformDark: "#235e4d", cap: "cap", capColor: "#214a3a", hair: "bun", hairColor: "#1c1208", glasses: false, pose: "wave" },
  { skin: "#d99a6c", uniform: "#8a5a3c", uniformDark: "#6f4730", cap: "none", capColor: "#000", hair: "short", hairColor: "#0c0805", glasses: false, pose: "thumbsUp" },
  { skin: "#f1c49a", uniform: "#34577a", uniformDark: "#284560", cap: "none", capColor: "#000", hair: "short", hairColor: "#160f08", glasses: true, pose: "crossed" },
  { skin: "#e9b488", uniform: "#5566a0", uniformDark: "#41507e", cap: "none", capColor: "#000", hair: "ponytail", hairColor: "#1a0f04", glasses: false, pose: "open" },
];

// ---- low-level helpers ----------------------------------------------------
type C = CanvasRenderingContext2D;

function shape(ctx: C, draw: () => void, fill: string, lw = 9): void {
  ctx.beginPath();
  draw();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = lw;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.fillStyle = fill;
  ctx.fill();
}

function rrect(ctx: C, x: number, y: number, w: number, h: number, r: number): void {
  ctx.roundRect(x, y, w, h, r);
}

/** A limb / sausage drawn from a point list, outlined then colour-filled. */
function limb(ctx: C, pts: [number, number][], w: number, color: string): void {
  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  };
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  trace();
  ctx.lineWidth = w + 9;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  trace();
  ctx.lineWidth = w;
  ctx.strokeStyle = color;
  ctx.stroke();
}

function hand(ctx: C, x: number, y: number, skin: string, r = 22): void {
  shape(ctx, () => ctx.arc(x, y, r, 0, 7), skin, 7);
}

// ---- geometry constants ---------------------------------------------------
const CX = 256;
const HEAD_CY = 208;
const HEAD_R = 120;
const SH_Y = 376;
const SH_X = 96; // half shoulder span

// ---- head -----------------------------------------------------------------
export function drawHead(ctx: C, s: WorkerSpec, cx = CX, cy = HEAD_CY, r = HEAD_R): void {
  // back hair (long styles)
  if (s.hair === "ponytail") {
    shape(ctx, () => ctx.ellipse(cx + r * 0.7, cy + r * 0.3, r * 0.32, r * 0.62, -0.3, 0, 7), s.hairColor, 7);
  }

  // face
  shape(ctx, () => ctx.arc(cx, cy, r, 0, 7), s.skin, 9);
  // cheek shade (cel)
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r - 2, 0, 7);
  ctx.clip();
  const g = ctx.createLinearGradient(cx - r, 0, cx + r, 0);
  g.addColorStop(0, "rgba(0,0,0,0.16)");
  g.addColorStop(0.5, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.restore();

  // hair / cap
  drawHair(ctx, s, cx, cy, r);

  // eyes
  const eyeY = cy + r * 0.08;
  const eyeDx = r * 0.36;
  for (const dx of [-eyeDx, eyeDx]) {
    shape(ctx, () => ctx.ellipse(cx + dx, eyeY, r * 0.11, r * 0.15, 0, 0, 7), "#ffffff", 5);
    ctx.beginPath();
    ctx.fillStyle = "#241a14";
    ctx.arc(cx + dx, eyeY + 2, r * 0.075, 0, 7);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = "#fff";
    ctx.arc(cx + dx - 3, eyeY - 2, r * 0.025, 0, 7);
    ctx.fill();
  }
  // eyebrows
  ctx.strokeStyle = s.hairColor;
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  for (const dx of [-eyeDx, eyeDx]) {
    ctx.beginPath();
    ctx.arc(cx + dx, eyeY - r * 0.18, r * 0.12, 1.15 * Math.PI, 1.85 * Math.PI);
    ctx.stroke();
  }
  // glasses
  if (s.glasses) {
    ctx.strokeStyle = "#1a2336";
    ctx.lineWidth = 5;
    for (const dx of [-eyeDx, eyeDx]) {
      ctx.beginPath();
      ctx.roundRect(cx + dx - r * 0.18, eyeY - r * 0.16, r * 0.36, r * 0.32, 8);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx - eyeDx + r * 0.18, eyeY);
    ctx.lineTo(cx + eyeDx - r * 0.18, eyeY);
    ctx.stroke();
  }
  // nose
  ctx.strokeStyle = "rgba(120,70,50,0.5)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cx, eyeY + r * 0.18);
  ctx.lineTo(cx - 4, eyeY + r * 0.28);
  ctx.lineTo(cx + 3, eyeY + r * 0.29);
  ctx.stroke();
  // smile
  ctx.strokeStyle = "#9a4f3f";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(cx, eyeY + r * 0.28, r * 0.26, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  // blush
  ctx.fillStyle = "rgba(255,130,110,0.25)";
  for (const dx of [-r * 0.55, r * 0.55]) {
    ctx.beginPath();
    ctx.ellipse(cx + dx, eyeY + r * 0.22, r * 0.13, r * 0.08, 0, 0, 7);
    ctx.fill();
  }
}

function drawHair(ctx: C, s: WorkerSpec, cx: number, cy: number, r: number): void {
  if (s.cap === "hardhat") {
    // dome
    shape(ctx, () => ctx.arc(cx, cy - r * 0.18, r * 0.98, Math.PI, 0), s.capColor, 9);
    shape(ctx, () => rrect(ctx, cx - r * 1.12, cy - r * 0.22, r * 2.24, r * 0.2, r * 0.1), s.capColor, 8);
    // centre ridge
    shape(ctx, () => rrect(ctx, cx - r * 0.08, cy - r * 1.12, r * 0.16, r * 0.5, 6), "#e0b21f", 6);
    return;
  }
  if (s.cap === "cap") {
    shape(ctx, () => ctx.arc(cx, cy - r * 0.2, r * 0.95, Math.PI * 1.02, Math.PI * 1.98), s.capColor, 9);
    // brim
    shape(ctx, () => ctx.ellipse(cx + r * 0.6, cy - r * 0.3, r * 0.5, r * 0.18, -0.2, Math.PI, 0), s.capColor, 8);
    // button
    ctx.beginPath();
    ctx.fillStyle = "#dfe9ff";
    ctx.arc(cx, cy - r, r * 0.07, 0, 7);
    ctx.fill();
    return;
  }
  // bare hair styles
  if (s.hair === "buzz") {
    shape(ctx, () => ctx.arc(cx, cy - r * 0.12, r * 0.96, Math.PI * 1.06, Math.PI * 1.94), s.hairColor, 8);
  } else {
    // short / ponytail / bun top
    shape(ctx, () => ctx.arc(cx, cy - r * 0.18, r * 0.98, Math.PI * 1.02, Math.PI * 1.98), s.hairColor, 8);
    // side fringes
    shape(ctx, () => ctx.ellipse(cx - r * 0.82, cy - r * 0.1, r * 0.22, r * 0.5, 0.2, 0, 7), s.hairColor, 7);
    shape(ctx, () => ctx.ellipse(cx + r * 0.82, cy - r * 0.1, r * 0.22, r * 0.5, -0.2, 0, 7), s.hairColor, 7);
    if (s.hair === "bun") shape(ctx, () => ctx.arc(cx, cy - r * 1.05, r * 0.26, 0, 7), s.hairColor, 7);
  }
}

// ---- body -----------------------------------------------------------------
function drawBody(ctx: C, s: WorkerSpec): void {
  // legs (left leg slightly darker for depth)
  limb(ctx, [[CX - 36, 548], [CX - 36, 690]], 56, PANTS_D);
  limb(ctx, [[CX + 36, 548], [CX + 36, 690]], 56, PANTS);
  // boots
  for (const bx of [CX - 38, CX + 38]) {
    shape(ctx, () => rrect(ctx, bx - 34, 686, 72, 60, 18), BOOT, 8);
    shape(ctx, () => rrect(ctx, bx - 34, 724, 78, 22, 11), "#15100a", 6);
  }

  // torso (coverall)
  const torso = () => {
    ctx.beginPath();
    ctx.moveTo(CX - SH_X + 6, SH_Y);
    ctx.lineTo(CX + SH_X - 6, SH_Y);
    ctx.quadraticCurveTo(CX + SH_X + 8, SH_Y + 90, CX + 86, 560);
    ctx.lineTo(CX - 86, 560);
    ctx.quadraticCurveTo(CX - SH_X - 8, SH_Y + 90, CX - SH_X + 6, SH_Y);
    ctx.closePath();
  };
  shape(ctx, torso, s.uniform, 9);
  // cel shade left third
  ctx.save();
  ctx.beginPath();
  torso();
  ctx.clip();
  const g = ctx.createLinearGradient(CX - 96, 0, CX + 96, 0);
  g.addColorStop(0, "rgba(0,0,0,0.22)");
  g.addColorStop(0.45, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(CX - 110, SH_Y, 220, 220);
  // collar V
  ctx.strokeStyle = s.uniformDark;
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(CX - 34, SH_Y + 2);
  ctx.lineTo(CX, SH_Y + 52);
  ctx.lineTo(CX + 34, SH_Y + 2);
  ctx.stroke();
  // centre zip
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(CX, SH_Y + 52);
  ctx.lineTo(CX, 556);
  ctx.stroke();
  // belt
  ctx.fillStyle = s.uniformDark;
  ctx.fillRect(CX - 88, 500, 176, 16);
  // chest pocket
  ctx.strokeStyle = s.uniformDark;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.roundRect(CX + 22, SH_Y + 70, 48, 44, 6);
  ctx.stroke();
  ctx.restore();

  // neck
  shape(ctx, () => rrect(ctx, CX - 24, 312, 48, 44, 14), s.skin, 8);
}

// ---- arms (pose-dependent) ------------------------------------------------
function drawArms(ctx: C, s: WorkerSpec): void {
  const sL: [number, number] = [CX - SH_X + 8, SH_Y + 8];
  const sR: [number, number] = [CX + SH_X - 8, SH_Y + 8];
  const w = 40;
  const u = s.uniform;

  const arm = (pts: [number, number][], handAt: [number, number]) => {
    limb(ctx, pts, w, u);
    hand(ctx, handAt[0], handAt[1], s.skin);
  };

  switch (s.pose) {
    case "thumbsUp":
      arm([sL, [sL[0] - 14, 470], [sL[0] - 8, 540]], [sL[0] - 8, 548]);
      arm([sR, [sR[0] + 26, 446], [sR[0] + 2, 372]], [sR[0] + 2, 360]);
      // thumb
      shape(ctx, () => rrect(ctx, sR[0] - 6, 322, 16, 34, 8), s.skin, 6);
      break;
    case "hips":
      arm([sL, [sL[0] - 58, 452], [CX - 54, 502]], [CX - 54, 502]);
      arm([sR, [sR[0] + 58, 452], [CX + 54, 502]], [CX + 54, 502]);
      break;
    case "wave":
      arm([sL, [sL[0] - 12, 470], [sL[0] - 6, 540]], [sL[0] - 6, 548]);
      arm([sR, [sR[0] + 40, 326], [sR[0] + 58, 250]], [sR[0] + 58, 240]);
      break;
    case "open":
      arm([sL, [sL[0] - 56, 446], [sL[0] - 96, 506]], [sL[0] - 96, 514]);
      arm([sR, [sR[0] + 56, 446], [sR[0] + 96, 506]], [sR[0] + 96, 514]);
      break;
    case "tablet":
      arm([sL, [sL[0] - 30, 452], [CX - 70, 470]], [CX - 70, 478]);
      arm([sR, [sR[0] + 30, 452], [CX + 70, 470]], [CX + 70, 478]);
      // tablet
      shape(ctx, () => rrect(ctx, CX - 78, 452, 156, 96, 12), "#11203c", 8);
      ctx.fillStyle = "#39e1ff";
      ctx.fillRect(CX - 66, 462, 132, 76);
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fillRect(CX - 60, 466, 60, 30);
      break;
    case "crossed":
      arm([sL, [sL[0] - 40, 452], [CX + 64, 486]], [CX + 64, 486]);
      arm([sR, [sR[0] + 40, 452], [CX - 64, 470]], [CX - 64, 470]);
      break;
  }
}

// ---- compose --------------------------------------------------------------
export function drawWorker(ctx: C, s: WorkerSpec): void {
  drawBody(ctx, s);
  drawArms(ctx, s);
  drawHead(ctx, s);
}
