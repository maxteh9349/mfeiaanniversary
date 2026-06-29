// Shared processing for the official MFEIA logo (white-background PNG):
// key out the white, recentre on the artwork, and render either a glowing neon
// outline (large central portal) or a solid white mark (small HUD logo).

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return [c, c.getContext("2d")!];
}

/** Fill an existing shape (by its alpha) with a solid colour. */
function tintShape(src: HTMLCanvasElement, s: number, color: string): HTMLCanvasElement {
  const [c, x] = canvas(s);
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = "source-in";
  x.fillStyle = color;
  x.fillRect(0, 0, s, s);
  return c;
}

/** Erode a silhouette by radius r (intersection of ring-offset copies). */
function erode(sil: HTMLCanvasElement, s: number, r: number): HTMLCanvasElement {
  const [c, x] = canvas(s);
  x.drawImage(sil, 0, 0);
  x.globalCompositeOperation = "destination-in";
  const dirs = 16;
  for (let i = 0; i < dirs; i++) {
    const a = (i / dirs) * Math.PI * 2;
    x.drawImage(sil, Math.cos(a) * r, Math.sin(a) * r);
  }
  return c;
}

export interface LogoBase {
  base: HTMLCanvasElement; // keyed + recentred logo, transparent background
  s: number;
}

/** Load the logo, key out the white background, and recentre on the artwork. */
export function loadLogoBase(url: string): Promise<LogoBase | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onerror = () => resolve(null);
    img.onload = () => {
      const s = Math.max(img.width, img.height);
      const [base, bx] = canvas(s);
      bx.drawImage(img, (s - img.width) / 2, (s - img.height) / 2);
      const data = bx.getImageData(0, 0, s, s);
      const a = data.data;
      for (let i = 0; i < a.length; i += 4) {
        const lum = (a[i] + a[i + 1] + a[i + 2]) / 3;
        if (lum > 225) a[i + 3] = 0;
        else if (lum > 150) a[i + 3] = Math.round((255 * (225 - lum)) / 75);
      }
      bx.putImageData(data, 0, 0);

      // recentre on the artwork bounding box (so rotation has no wobble)
      let minX = s, minY = s, maxX = 0, maxY = 0;
      for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
          if (a[(y * s + x) * 4 + 3] > 20) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      let centred = base;
      if (maxX >= minX) {
        const [rb, rx] = canvas(s);
        rx.drawImage(base, Math.round(s / 2 - (minX + maxX) / 2), Math.round(s / 2 - (minY + maxY) / 2));
        centred = rb;
      }
      resolve({ base: centred, s });
    };
    img.src = url;
  });
}

/** Glowing neon outline: white-cyan edge tubes, blue glow, dark interior. */
export function neonOutlineCanvas(base: HTMLCanvasElement, s: number): HTMLCanvasElement {
  const sil = tintShape(base, s, "#eafdff");
  const r = Math.max(3, Math.round(s * 0.011));
  const eroded = erode(sil, s, r);

  const [outline, lx] = canvas(s);
  lx.drawImage(sil, 0, 0);
  lx.globalCompositeOperation = "destination-out";
  lx.drawImage(eroded, 0, 0);
  lx.globalCompositeOperation = "source-over";

  const darkInterior = tintShape(eroded, s, "rgba(4,12,32,0.6)");
  const [out, ox] = canvas(s);
  ox.drawImage(darkInterior, 0, 0);
  ox.shadowColor = "#2a7bff";
  ox.shadowBlur = Math.round(s * 0.03);
  ox.drawImage(outline, 0, 0);
  ox.drawImage(outline, 0, 0);
  ox.shadowColor = "#8fe0ff";
  ox.shadowBlur = Math.round(s * 0.012);
  ox.drawImage(outline, 0, 0);
  ox.shadowBlur = 0;
  ox.drawImage(outline, 0, 0);
  return out;
}

/** Solid near-white mark on transparent (legible at small sizes; CSS adds glow). */
export function whiteSolidCanvas(base: HTMLCanvasElement, s: number): HTMLCanvasElement {
  return tintShape(base, s, "#eaf6ff");
}
