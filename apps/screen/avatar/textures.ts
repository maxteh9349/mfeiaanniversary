import * as THREE from "three";
import { drawHead, SPECS } from "./drawWorker.ts";

const spec = (id: number) => SPECS[id % SPECS.length];

/** Circular head-and-shoulders thumbnail for the HUD recent-checkin list. */
export function makeFaceThumb(id: number): string {
  const c = document.createElement("canvas");
  c.width = c.height = 160;
  const x = c.getContext("2d")!;
  const s = spec(id);
  // shoulders
  x.fillStyle = s.uniform;
  x.strokeStyle = "#15233f";
  x.lineWidth = 7;
  x.lineJoin = "round";
  x.beginPath();
  x.roundRect(24, 118, 112, 64, 26);
  x.stroke();
  x.fill();
  drawHead(x, s, 80, 76, 54);
  return c.toDataURL();
}

// ---- name label & chat bubble ---------------------------------------------
export function makeLabelTexture(name: string): { texture: THREE.Texture; aspect: number } {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 160;
  const x = c.getContext("2d")!;
  // pill background
  x.fillStyle = "rgba(8,18,46,0.78)";
  x.strokeStyle = "#38e1ff";
  x.lineWidth = 4;
  x.beginPath();
  x.roundRect(16, 40, 480, 80, 40);
  x.fill();
  x.stroke();
  x.font = "bold 52px 'PingFang SC','Microsoft YaHei',sans-serif";
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillStyle = "#ffffff";
  x.shadowColor = "#38e1ff";
  x.shadowBlur = 16;
  x.fillText(name, 256, 82);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { texture: tex, aspect: c.width / c.height };
}

let bubbleTex: THREE.Texture | null = null;
export function chatBubbleTexture(): THREE.Texture {
  if (bubbleTex) return bubbleTex;
  const c = document.createElement("canvas");
  c.width = 192;
  c.height = 160;
  const x = c.getContext("2d")!;
  x.fillStyle = "rgba(255,255,255,0.95)";
  x.beginPath();
  x.roundRect(16, 16, 160, 96, 28);
  x.moveTo(70, 108);
  x.lineTo(96, 150);
  x.lineTo(110, 108);
  x.fill();
  x.fillStyle = "#2a6cff";
  for (let i = 0; i < 3; i++) {
    x.beginPath();
    x.arc(60 + i * 38, 64, 11, 0, 7);
    x.fill();
  }
  bubbleTex = new THREE.CanvasTexture(c);
  bubbleTex.colorSpace = THREE.SRGBColorSpace;
  return bubbleTex;
}
