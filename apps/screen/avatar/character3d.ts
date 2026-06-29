import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

/**
 * A semi-realistic "industrial digital-twin" avatar built procedurally from
 * primitives: human proportions, a metallic dark blue-grey exoskeleton suit,
 * blue neon accent strips, a holographic head ring + visor, and a two-segment
 * arm/leg rig so it can stand, walk, gesture and strike a per-variant pose
 * (engineer w/ tablet, technician w/ helmet+tool, supervisor arms-crossed,
 * operator casual). High-tech control-room look — not a cartoon/toy.
 *
 * Origin at the feet (y = 0); ≈2.4 units tall.
 */
export type VariantType = "engineer" | "technician" | "supervisor" | "operator";

export interface CharacterSpec {
  variant: VariantType;
  accent: string; // neon accent
  suit: string; // base plate
  suitDark: string; // secondary/limb plate
}

export const CHAR_HEIGHT = 2.4;

const VARIANTS: VariantType[] = ["engineer", "technician", "supervisor", "operator"];

export function specFor(avatarId: number): CharacterSpec {
  const variant = VARIANTS[avatarId % VARIANTS.length];
  // Vibrant multi-colour neon per variant (cyan / electric blue / violet / teal).
  const accent = { engineer: "#22e0ff", technician: "#4d8bff", supervisor: "#a86bff", operator: "#2dffc4" }[variant];
  // Bright polished-steel armour plates (cool silver) cycled by id for variety.
  const suits = ["#cfd8e6", "#c4cedd", "#d6dfeb"];
  const darks = ["#9aa6b8", "#909cae", "#a4b0c2"];
  return { variant, accent, suit: suits[avatarId % suits.length], suitDark: darks[avatarId % darks.length] };
}

// ---- shared geometry (created once) ---------------------------------------
const rb = (w: number, h: number, d: number, r = 0.05) => new RoundedBoxGeometry(w, h, d, 2, r);
const G = {
  chest: rb(0.62, 0.5, 0.34, 0.07),
  ab: rb(0.42, 0.26, 0.28, 0.06),
  pelvis: rb(0.52, 0.24, 0.32, 0.06),
  pauldron: rb(0.27, 0.22, 0.34, 0.07),
  upper: rb(0.16, 0.44, 0.17, 0.06),
  fore: rb(0.14, 0.42, 0.15, 0.05),
  hand: rb(0.13, 0.17, 0.1, 0.04),
  thigh: rb(0.21, 0.52, 0.23, 0.07),
  shin: rb(0.18, 0.5, 0.19, 0.06),
  boot: rb(0.21, 0.17, 0.36, 0.05),
  neck: new THREE.CylinderGeometry(0.08, 0.1, 0.12, 12),
  head: rb(0.3, 0.36, 0.3, 0.1),
  strip: rb(0.05, 0.34, 0.03, 0.015),
  face: new THREE.CircleGeometry(0.19, 36),
  tablet: rb(0.32, 0.22, 0.02, 0.01),
  tool: rb(0.07, 0.34, 0.07, 0.02),
} as const;

const matCache = new Map<string, THREE.MeshStandardMaterial>();
function metal(color: string): THREE.MeshStandardMaterial {
  const k = "m" + color;
  let m = matCache.get(k);
  if (!m) {
    // Moderate metalness (no envMap in the scene) + low roughness so light
    // steel plates read as bright polished metal under the direct lights.
    m = new THREE.MeshStandardMaterial({ color, metalness: 0.6, roughness: 0.32 });
    matCache.set(k, m);
  }
  return m;
}
function glow(color: string): THREE.MeshStandardMaterial {
  const k = "g" + color;
  let m = matCache.get(k);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.8, metalness: 0.3, roughness: 0.4 });
    matCache.set(k, m);
  }
  return m;
}

export class Character3D {
  readonly group = new THREE.Group();
  private shoulderL!: THREE.Group;
  private shoulderR!: THREE.Group;
  private elbowL!: THREE.Group;
  private elbowR!: THREE.Group;
  private hipL!: THREE.Group;
  private hipR!: THREE.Group;
  private kneeL!: THREE.Group;
  private kneeR!: THREE.Group;
  private head!: THREE.Group;
  private torso!: THREE.Group;
  private faceMesh!: THREE.Mesh;

  private readonly spec: CharacterSpec;
  private phase = Math.random() * Math.PI * 2;
  private sway = Math.random() * Math.PI * 2;
  private waveT = 0;
  private nodT = 0;
  /** holds a tablet/tool — keeps a carry pose instead of swinging arms. */
  private holding: boolean;

  constructor(spec: CharacterSpec, photoUrl?: string | null) {
    this.spec = spec;
    this.holding = spec.variant === "engineer" || spec.variant === "technician";
    const suit = metal(spec.suit);
    const dark = metal(spec.suitDark);
    const accent = glow(spec.accent);

    // ---- torso (slight breathing pivot at waist) ----
    this.torso = new THREE.Group();
    this.torso.position.y = 1.12;
    const chest = new THREE.Mesh(G.chest, suit);
    chest.position.y = 0.42;
    const ab = new THREE.Mesh(G.ab, dark);
    ab.position.y = 0.1;
    // chest neon core strip
    const core = new THREE.Mesh(G.strip, accent);
    core.position.set(0, 0.42, 0.18);
    this.torso.add(chest, ab, core);
    this.group.add(this.torso);

    // pelvis
    const pelvis = new THREE.Mesh(G.pelvis, dark);
    pelvis.position.y = 1.0;
    this.group.add(pelvis);

    // ---- arms ----
    [this.shoulderL, this.elbowL] = this.makeArm(0.36, suit, dark, accent);
    [this.shoulderR, this.elbowR] = this.makeArm(-0.36, suit, dark, accent);
    this.torso.add(this.shoulderL, this.shoulderR);

    // ---- legs ----
    [this.hipL, this.kneeL] = this.makeLeg(0.14, suit, dark);
    [this.hipR, this.kneeR] = this.makeLeg(-0.14, suit, dark);
    this.group.add(this.hipL, this.hipR);

    // ---- head: photo face inside a holographic ring ----
    this.head = new THREE.Group();
    this.head.position.y = 1.66;
    const neck = new THREE.Mesh(G.neck, dark);
    neck.position.y = 0.02;
    const headMesh = new THREE.Mesh(G.head, metal("#8591a4"));
    headMesh.position.set(0, 0.26, -0.04);
    // face disc (photo or digital placeholder), unlit so it reads clearly
    this.faceMesh = new THREE.Mesh(G.face, new THREE.MeshBasicMaterial({ map: facePlaceholder(spec.accent), toneMapped: false }));
    this.faceMesh.position.set(0, 0.28, 0.13);
    // no holographic ring around the head — cleaner, more modern look
    this.head.add(neck, headMesh, this.faceMesh);
    this.group.add(this.head);
    if (photoUrl) this.setPhoto(photoUrl);

    // ---- variant accessories ----
    if (spec.variant === "engineer") this.addTablet(accent);
    if (spec.variant === "technician") this.addTool(dark, accent);

    this.applyPose(1); // set the signature standing pose
  }

  private makeArm(x: number, suit: THREE.Material, dark: THREE.Material, accent: THREE.Material): [THREE.Group, THREE.Group] {
    const shoulder = new THREE.Group();
    shoulder.position.set(x, 0.46, 0); // relative to torso
    const pauldron = new THREE.Mesh(G.pauldron, suit);
    pauldron.position.y = 0.02;
    const upper = new THREE.Mesh(G.upper, dark);
    upper.position.y = -0.22;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.3, 0.02), accent);
    stripe.position.set(0, -0.22, 0.09);
    const elbow = new THREE.Group();
    elbow.position.y = -0.44;
    const fore = new THREE.Mesh(G.fore, suit);
    fore.position.y = -0.21;
    const hand = new THREE.Mesh(G.hand, metal("#8591a4"));
    hand.position.y = -0.46;
    elbow.add(fore, hand);
    shoulder.add(pauldron, upper, stripe, elbow);
    return [shoulder, elbow];
  }

  private makeLeg(x: number, suit: THREE.Material, dark: THREE.Material): [THREE.Group, THREE.Group] {
    const hip = new THREE.Group();
    hip.position.set(x, 1.0, 0);
    const thigh = new THREE.Mesh(G.thigh, suit);
    thigh.position.y = -0.27;
    const knee = new THREE.Group();
    knee.position.y = -0.54;
    const shin = new THREE.Mesh(G.shin, dark);
    shin.position.y = -0.26;
    const boot = new THREE.Mesh(G.boot, metal("#6c788a"));
    boot.position.set(0, -0.52, 0.06);
    knee.add(shin, boot);
    hip.add(thigh, knee);
    return [hip, knee];
  }

  private addTablet(accent: THREE.Material): void {
    const t = new THREE.Group();
    const frame = new THREE.Mesh(G.tablet, metal("#1b2336"));
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.17), accent);
    screen.position.z = 0.012;
    t.add(frame, screen);
    t.position.set(0.1, 1.2, 0.3);
    t.rotation.set(-0.5, 0, 0);
    this.group.add(t);
  }

  private addTool(dark: THREE.Material, accent: THREE.Material): void {
    const tool = new THREE.Group();
    tool.add(new THREE.Mesh(G.tool, dark));
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.09), accent);
    tip.position.y = 0.2;
    tool.add(tip);
    // held in right hand (elbowR space): place near hand
    tool.position.y = -0.5;
    tool.rotation.z = 0.2;
    this.elbowR.add(tool);
  }

  // ---- signature standing pose per variant (target rotations) ----
  private poseTargets(): { sLx: number; sLz: number; eL: number; sRx: number; sRz: number; eR: number } {
    switch (this.spec.variant) {
      case "engineer": // both forearms forward holding tablet
        return { sLx: -0.55, sLz: 0.15, eL: -1.3, sRx: -0.55, sRz: -0.15, eR: -1.3 };
      case "supervisor": // arms crossed over chest
        return { sLx: -0.5, sLz: 0.5, eL: -1.9, sRx: -0.5, sRz: -0.5, eR: -1.9 };
      case "technician": // left relaxed, right holds tool at side
        return { sLx: 0.05, sLz: 0.08, eL: -0.2, sRx: -0.2, sRz: -0.05, eR: -0.7 };
      default: // operator casual: slight bend, one hand toward hip
        return { sLx: 0.08, sLz: 0.12, eL: -0.25, sRx: 0.05, sRz: -0.1, eR: -0.2 };
    }
  }

  private applyPose(k: number): void {
    const p = this.poseTargets();
    this.shoulderL.rotation.x = p.sLx * k;
    this.shoulderL.rotation.z = p.sLz * k;
    this.elbowL.rotation.x = p.eL * k;
    this.shoulderR.rotation.x = p.sRx * k;
    this.shoulderR.rotation.z = p.sRz * k;
    this.elbowR.rotation.x = p.eR * k;
  }

  /** Load a guest photo, circular-crop it, and show it as the face. */
  setPhoto(url: string): void {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const tex = circleTexture(img);
      const m = this.faceMesh.material as THREE.MeshBasicMaterial;
      m.map = tex;
      m.needsUpdate = true;
    };
    img.src = url;
  }

  wave(): void {
    if (!this.holding) this.waveT = 1.6;
    else this.nodT = 1.0; // holders nod instead of waving
  }
  nod(): void {
    this.nodT = 1.0;
  }

  animate(dt: number, t: number, moving: boolean): void {
    // legs
    if (moving) {
      this.phase += dt * 7.5;
      const s = Math.sin(this.phase);
      this.hipL.rotation.x = s * 0.45;
      this.hipR.rotation.x = -s * 0.45;
      this.kneeL.rotation.x = Math.max(0, -s) * 0.5;
      this.kneeR.rotation.x = Math.max(0, s) * 0.5;
      this.group.position.y = Math.abs(Math.sin(this.phase)) * 0.03;
    } else {
      this.hipL.rotation.x = damp(this.hipL.rotation.x, 0, dt);
      this.hipR.rotation.x = damp(this.hipR.rotation.x, 0, dt);
      this.kneeL.rotation.x = damp(this.kneeL.rotation.x, 0, dt);
      this.kneeR.rotation.x = damp(this.kneeR.rotation.x, 0, dt);
      this.group.position.y = damp(this.group.position.y, 0, dt);
    }

    // arms
    const p = this.poseTargets();
    const breathe = Math.sin(t * 1.3 + this.sway) * 0.05;
    if (moving && !this.holding) {
      const s = Math.sin(this.phase);
      this.shoulderL.rotation.x = damp(this.shoulderL.rotation.x, -s * 0.4, dt);
      this.shoulderR.rotation.x = damp(this.shoulderR.rotation.x, s * 0.4, dt);
      this.elbowL.rotation.x = damp(this.elbowL.rotation.x, -0.3, dt);
      this.elbowR.rotation.x = damp(this.elbowR.rotation.x, -0.3, dt);
      this.shoulderL.rotation.z = damp(this.shoulderL.rotation.z, 0, dt);
      this.shoulderR.rotation.z = damp(this.shoulderR.rotation.z, 0, dt);
    } else {
      // hold/idle signature pose (+ subtle breathing)
      this.shoulderL.rotation.x = damp(this.shoulderL.rotation.x, p.sLx + breathe, dt);
      this.shoulderL.rotation.z = damp(this.shoulderL.rotation.z, p.sLz, dt);
      this.elbowL.rotation.x = damp(this.elbowL.rotation.x, p.eL, dt);
      this.shoulderR.rotation.z = damp(this.shoulderR.rotation.z, p.sRz, dt);
      this.elbowR.rotation.x = damp(this.elbowR.rotation.x, p.eR, dt);
      if (this.waveT <= 0) this.shoulderR.rotation.x = damp(this.shoulderR.rotation.x, p.sRx - breathe, dt);
    }

    // wave gesture (right arm up)
    if (this.waveT > 0) {
      this.waveT -= dt;
      this.shoulderR.rotation.x = -2.5;
      this.shoulderR.rotation.z = -0.4 + Math.sin(t * 12) * 0.3;
      this.elbowR.rotation.x = -0.3;
    }

    // nod / head idle
    if (this.nodT > 0) {
      this.nodT -= dt;
      this.head.rotation.x = Math.sin((1.0 - this.nodT) * Math.PI * 4) * 0.22;
    } else {
      this.head.rotation.x = damp(this.head.rotation.x, 0, dt);
      this.head.rotation.y = Math.sin(t * 0.5 + this.sway) * 0.12; // subtle look-around
    }
  }

  /** Smoothly turn to face a world direction (x,z). */
  faceDir(dx: number, dz: number, dt: number): void {
    if (Math.abs(dx) < 1e-4 && Math.abs(dz) < 1e-4) return;
    const target = Math.atan2(dx, dz);
    let diff = target - this.group.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.group.rotation.y += diff * Math.min(1, dt * 8);
  }

  dispose(): void {
    this.group.removeFromParent();
    // geometries + materials are shared module-wide; not disposed here.
  }
}

function damp(cur: number, target: number, dt: number): number {
  return cur + (target - cur) * Math.min(1, dt * 8);
}

/** Circular-cropped texture from a loaded image (cover fit). */
function circleTexture(img: HTMLImageElement): THREE.CanvasTexture {
  const s = 256;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const x = c.getContext("2d")!;
  x.beginPath();
  x.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
  x.clip();
  const side = Math.min(img.width, img.height);
  x.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Digital placeholder face (dark with a glowing visor band) when no photo. */
const placeholderCache = new Map<string, THREE.CanvasTexture>();
function facePlaceholder(accent: string): THREE.CanvasTexture {
  let tex = placeholderCache.get(accent);
  if (tex) return tex;
  const s = 256;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(s / 2, s / 2, 10, s / 2, s / 2, s / 2);
  g.addColorStop(0, "#2a3550");
  g.addColorStop(1, "#141b2c");
  x.fillStyle = g;
  x.beginPath();
  x.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
  x.fill();
  // visor band
  x.fillStyle = accent;
  x.globalAlpha = 0.85;
  x.fillRect(s * 0.2, s * 0.44, s * 0.6, s * 0.1);
  x.globalAlpha = 1;
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  placeholderCache.set(accent, tex);
  return tex;
}
