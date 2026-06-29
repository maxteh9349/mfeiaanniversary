import * as THREE from "three";
import { loadLogoBase, neonOutlineCanvas } from "../logo.ts";

// Portal centre (the upright gear/iris) and the floor spawn point.
// Gear group is kept smaller and centred in frame; floor ring stays forward.
const C = new THREE.Vector3(0, 3.6, 0);
const SPAWN = new THREE.Vector3(0, 0, 4);

/**
 * The central "传送门" rebuilt to match the close-up reference: a neon gear/iris
 * with a hex hole, layered glowing blue rings + rotating arc highlights, a soft
 * halo, rising light columns, and a particle field. The glow is baked into
 * canvas textures (shadowBlur) so it reads as neon without full-scene bloom.
 */
export class Portal {
  readonly group = new THREE.Group();
  private gear: THREE.Mesh;
  private arcs1: THREE.Mesh;
  private arcs2: THREE.Mesh;
  private hotspot: THREE.Mesh;
  private floorArcsTex: THREE.Texture;
  private particles: THREE.Points;
  private pSpeed: Float32Array;

  constructor() {
    // soft halo behind everything
    this.group.add(plane(haloTexture(), 8.5, C.clone().add(new THREE.Vector3(0, 0, -0.4)), 0.9));

    // static faint full rings
    this.group.add(plane(ringsTexture(), 6.2, C.clone().add(new THREE.Vector3(0, 0, -0.05)), 0.85));

    // two counter-rotating bright arc layers (give the rings visible motion)
    this.arcs1 = plane(arcsTexture(0x59c4ff), 6.4, C, 0.95);
    this.arcs2 = plane(arcsTexture(0x7a6cff), 6.9, C.clone().add(new THREE.Vector3(0, 0, -0.02)), 0.6);
    this.group.add(this.arcs1, this.arcs2);

    // the MFEIA gear/iris mark — solid (normal blending) so it reads as the logo.
    // Uses the official /logo.png (white background keyed out) when present,
    // otherwise the drawn fallback below.
    this.gear = new THREE.Mesh(
      new THREE.PlaneGeometry(4.6, 4.6),
      new THREE.MeshBasicMaterial({ map: gearTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.gear.position.copy(C.clone().add(new THREE.Vector3(0, 0, 0.06)));
    this.group.add(this.gear);
    loadLogoBase("/Logo.png").then((r) => {
      if (!r) return;
      const tex = new THREE.CanvasTexture(neonOutlineCanvas(r.base, r.s));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const m = this.gear.material as THREE.MeshBasicMaterial;
      m.map = tex;
      m.needsUpdate = true;
    });

    // flat HUD ring on the floor (concentric rings + tick marks)
    const floorHud = new THREE.Mesh(
      new THREE.PlaneGeometry(11, 11),
      new THREE.MeshBasicMaterial({ map: hudRingTexture(), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    floorHud.rotation.x = -Math.PI / 2;
    floorHud.position.set(SPAWN.x, 0.02, SPAWN.z);
    this.group.add(floorHud);

    // spinning bright arc segments on the floor (texture-rotated)
    this.floorArcsTex = arcsTexture(0x7fd0ff);
    this.floorArcsTex.center.set(0.5, 0.5);
    const floorArcs = new THREE.Mesh(
      new THREE.PlaneGeometry(9.5, 9.5),
      new THREE.MeshBasicMaterial({ map: this.floorArcsTex, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    floorArcs.rotation.x = -Math.PI / 2;
    floorArcs.position.set(SPAWN.x, 0.03, SPAWN.z);
    this.group.add(floorArcs);

    // bright centre hotspot
    this.hotspot = new THREE.Mesh(
      new THREE.CircleGeometry(2.0, 48),
      new THREE.MeshBasicMaterial({ map: haloTexture(), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.hotspot.rotation.x = -Math.PI / 2;
    this.hotspot.position.set(SPAWN.x, 0.04, SPAWN.z);
    this.group.add(this.hotspot);

    // particle field rising across the whole stage (not just the centre)
    const n = 320;
    const pos = new Float32Array(n * 3);
    this.pSpeed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 52;
      pos[i * 3 + 1] = Math.random() * 16;
      pos[i * 3 + 2] = -8 + Math.random() * 18;
      this.pSpeed[i] = 0.4 + Math.random() * 1.1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.particles = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x8fd0ff, size: 0.1, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.group.add(this.particles);
  }

  update(dt: number, t: number): void {
    this.gear.rotation.z = -t * 0.3; // clockwise on screen
    this.arcs1.rotation.z = t * 0.5;
    this.arcs2.rotation.z = -t * 0.35;

    const pulse = 0.7 + Math.sin(t * 2) * 0.2;
    (this.hotspot.material as THREE.MeshBasicMaterial).opacity = 0.65 + pulse * 0.2;
    this.floorArcsTex.rotation = t * 0.5;

    // drift particles upward, wrap at top
    const p = this.particles.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      let y = p.getY(i) + this.pSpeed[i] * dt;
      if (y > 16) y = 0;
      p.setY(i, y);
    }
    p.needsUpdate = true;
  }

  get spawnPoint(): THREE.Vector3 {
    return SPAWN.clone();
  }
}

// ---- helpers --------------------------------------------------------------
function plane(tex: THREE.Texture, size: number, pos: THREE.Vector3, opacity: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  m.position.copy(pos);
  return m;
}

function canvas(size = 1024): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return [c, c.getContext("2d")!];
}

function toTex(c: HTMLCanvasElement): THREE.Texture {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * The MFEIA mark: 12 chunky gear-tooth blades spiralling into a central
 * aperture hole, with thin spiral gaps between them (matches the logo).
 */
function gearTexture(): THREE.Texture {
  const [c, x] = canvas(1024);
  const cx = 512;
  const N = 12;
  const ri = 150; // inner (aperture hole) radius
  const roBase = 345;
  const ro = 450; // gear-tooth tip
  const innerHalf = (10 * Math.PI) / 180;
  const toothHalf = (13 * Math.PI) / 180;
  const swirl = (20 * Math.PI) / 180; // tangential shear -> swirl
  const P = (r: number, a: number): [number, number] => [cx + r * Math.cos(a), cx + r * Math.sin(a)];

  x.lineJoin = "round";
  x.shadowColor = "#2a7bff";
  for (let i = 0; i < N; i++) {
    const A = (i / N) * Math.PI * 2;
    const pts: [number, number][] = [
      P(ri, A + innerHalf),
      P(roBase, A - swirl + toothHalf),
      P(ro, A - swirl + toothHalf * 0.5),
      P(ro, A - swirl - toothHalf * 0.5),
      P(roBase, A - swirl - toothHalf),
      P(ri, A - innerHalf),
    ];
    x.beginPath();
    x.moveTo(pts[0][0], pts[0][1]);
    for (let k = 1; k < pts.length; k++) x.lineTo(pts[k][0], pts[k][1]);
    x.closePath();
    x.shadowBlur = 16;
    x.fillStyle = "#2f63e6";
    x.fill();
    x.lineWidth = 5;
    x.strokeStyle = "#9fd0ff";
    x.stroke();
  }
  return toTex(c);
}

/** Faint full concentric rings. */
function ringsTexture(): THREE.Texture {
  const [c, x] = canvas(1024);
  const cx = 512;
  x.translate(cx, cx);
  x.shadowColor = "#2a8cff";
  for (const [r, lw, op] of [[400, 10, 0.5], [430, 4, 0.35], [468, 6, 0.45], [300, 3, 0.3]] as const) {
    x.beginPath();
    x.arc(0, 0, r, 0, Math.PI * 2);
    x.shadowBlur = 24;
    x.lineWidth = lw;
    x.strokeStyle = `rgba(90,180,255,${op})`;
    x.stroke();
  }
  return toTex(c);
}

/** Bright rotating arc segments at a few radii. */
function arcsTexture(color: number): THREE.Texture {
  const [c, x] = canvas(1024);
  const cx = 512;
  const hex = `#${color.toString(16).padStart(6, "0")}`;
  x.translate(cx, cx);
  x.shadowColor = hex;
  x.lineCap = "round";
  const arcs: [number, number, number, number][] = [
    [400, 0.1, 1.2, 12],
    [400, 3.5, 4.6, 12],
    [468, 2.2, 3.0, 8],
    [468, 5.0, 5.9, 8],
    [430, 1.0, 1.6, 5],
  ];
  for (const [r, a0, a1, lw] of arcs) {
    x.beginPath();
    x.arc(0, 0, r, a0, a1);
    x.shadowBlur = 28;
    x.lineWidth = lw;
    x.strokeStyle = hex;
    x.stroke();
  }
  return toTex(c);
}

/** Top-down flat HUD ring: concentric rings, tick marks, dashed segments. */
function hudRingTexture(): THREE.Texture {
  const [c, x] = canvas(1024);
  const cx = 512;
  x.translate(cx, cx);
  x.shadowColor = "#2a8cff";

  // concentric rings
  for (const [r, lw, op] of [[180, 5, 0.5], [300, 9, 0.7], [330, 3, 0.4], [420, 6, 0.55], [470, 2, 0.35]] as const) {
    x.beginPath();
    x.arc(0, 0, r, 0, Math.PI * 2);
    x.shadowBlur = 22;
    x.lineWidth = lw;
    x.strokeStyle = `rgba(90,190,255,${op})`;
    x.stroke();
  }

  // tick marks around the 300 ring
  x.shadowBlur = 10;
  x.strokeStyle = "rgba(150,215,255,0.7)";
  x.lineWidth = 3;
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const r0 = i % 6 === 0 ? 248 : 264;
    x.beginPath();
    x.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    x.lineTo(Math.cos(a) * 282, Math.sin(a) * 282);
    x.stroke();
  }

  // dashed/segmented outer band
  x.shadowBlur = 14;
  x.strokeStyle = "rgba(120,200,255,0.6)";
  x.lineWidth = 12;
  for (let i = 0; i < 24; i++) {
    if (i % 2 === 0) continue;
    const a0 = (i / 24) * Math.PI * 2;
    const a1 = a0 + (Math.PI * 2) / 24 - 0.04;
    x.beginPath();
    x.arc(0, 0, 445, a0, a1);
    x.stroke();
  }
  return toTex(c);
}

/** Soft radial glow disc. */
function haloTexture(): THREE.Texture {
  const [c, x] = canvas(512);
  const g = x.createRadialGradient(256, 256, 0, 256, 256, 256);
  g.addColorStop(0, "rgba(90,160,255,0.9)");
  g.addColorStop(0.35, "rgba(50,110,230,0.45)");
  g.addColorStop(1, "rgba(30,60,160,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 512, 512);
  return toTex(c);
}
