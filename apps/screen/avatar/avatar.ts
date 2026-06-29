import * as THREE from "three";
import { displayName, type Guest } from "../../../shared/events.ts";
import { chatBubbleTexture, makeLabelTexture } from "./textures.ts";
import { CHAR_HEIGHT, Character3D, specFor } from "./character3d.ts";

let shadowTex: THREE.Texture | null = null;
function getShadowTexture(): THREE.Texture {
  if (shadowTex) return shadowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(64, 64, 4, 64, 64, 60);
  g.addColorStop(0, "rgba(0,0,0,0.5)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  shadowTex = new THREE.CanvasTexture(c);
  return shadowTex;
}

/**
 * A guest avatar: a procedural low-poly 3D character on the floor. It
 * materialises from a particle burst (scale pop-in), shows its name briefly,
 * walks to an assigned slot, turns to face the camera, then mingles
 * (idle + occasional wave/nod with a chat bubble).
 */
export class Avatar {
  readonly group = new THREE.Group();
  readonly guest: Guest;
  private character: Character3D;
  private label: THREE.Sprite;
  private bubble: THREE.Sprite;
  private shadow: THREE.Mesh;
  private particles: THREE.Points;

  private age = 0;
  private bubbleTimer = 0;
  private target: THREE.Vector3 | null = null;
  private speed = 1.3 + Math.random() * 0.4;

  constructor(guest: Guest, spawnAt: THREE.Vector3) {
    this.guest = guest;
    this.group.position.copy(spawnAt);

    // 3D character (starts scaled to 0 for the pop-in).
    // Crowd robots never wear the guest photo — the face only appears on the
    // central hero reveal card. They keep a clean glowing visor instead.
    this.character = new Character3D(specFor(guest.avatarId));
    this.character.group.scale.setScalar(0.001);
    this.group.add(this.character.group);

    // Soft ground shadow.
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.6, 24),
      new THREE.MeshBasicMaterial({ map: getShadowTexture(), transparent: true, opacity: 0, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.02;
    this.shadow.scale.set(1.1, 0.7, 1);
    this.group.add(this.shadow);

    // Name label (billboard sprite above head).
    const lbl = makeLabelTexture(displayName(guest));
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: lbl.texture, transparent: true, depthTest: false, depthWrite: false }));
    this.label.center.set(0.5, 0);
    this.label.scale.set(2.6, 2.6 / lbl.aspect, 1);
    this.label.position.y = CHAR_HEIGHT + 0.2;
    this.group.add(this.label);

    // Chat bubble (hidden until mingling).
    this.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: chatBubbleTexture(), transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
    this.bubble.center.set(0.1, 0);
    this.bubble.scale.set(0.9, 0.75, 1);
    this.bubble.position.set(0.5, CHAR_HEIGHT * 0.95, 0);
    this.group.add(this.bubble);

    this.particles = makeParticles();
    this.group.add(this.particles);
  }

  setTarget(p: THREE.Vector3): void {
    this.target = p.clone();
  }

  /** Place already-settled at a position (used to repopulate the scene on load). */
  settleInstantly(at: THREE.Vector3): void {
    this.group.position.copy(at);
    this.age = 5; // past materialise + name-display window
    this.target = null;
    this.character.group.scale.setScalar(1);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.85;
    (this.label.material as THREE.SpriteMaterial).opacity = 0;
    if (this.particles.parent) {
      this.group.remove(this.particles);
      this.particles.geometry.dispose();
    }
  }

  showBubble(seconds = 2.5): void {
    this.bubbleTimer = seconds;
    if (Math.random() < 0.5) this.character.wave();
    else this.character.nod();
  }

  /** Whether materialisation + name display has finished. */
  get settled(): boolean {
    return this.age > 1.4;
  }

  update(dt: number, t: number): void {
    this.age += dt;

    // Materialise: particles rise & fade, character scales in, shadow fades in.
    const rise = Math.min(this.age / 0.9, 1);
    const ease = 1 - (1 - rise) * (1 - rise);
    this.character.group.scale.setScalar(Math.max(0.001, ease));
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = ease * 0.85;

    const pm = this.particles.material as THREE.PointsMaterial;
    if (this.age < 1.3) {
      const pos = this.particles.geometry.getAttribute("position") as THREE.BufferAttribute;
      const spd = this.particles.geometry.getAttribute("speed") as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) + spd.getX(i) * dt * 1.8);
      pos.needsUpdate = true;
      pm.opacity = Math.max(0, 1 - this.age / 1.3);
    } else if (this.particles.parent) {
      this.group.remove(this.particles);
      this.particles.geometry.dispose();
    }

    // Name label: hold 3s, fade over 1s.
    (this.label.material as THREE.SpriteMaterial).opacity = this.age < 3 ? Math.min(1, this.age * 2) : Math.max(0, 1 - (this.age - 3));

    // Walk toward target; face movement direction, else face the camera (+z).
    let moving = false;
    if (this.target && this.age > 0.7) {
      const d = this.target.clone().sub(this.group.position);
      d.y = 0;
      const dist = d.length();
      if (dist > 0.08) {
        d.normalize();
        this.group.position.addScaledVector(d, Math.min(dist, this.speed * dt));
        this.character.faceDir(d.x, d.z, dt);
        moving = true;
      } else {
        this.target = null;
      }
    }
    if (!moving) this.character.faceDir(0, 1, dt); // turn to face camera

    this.character.animate(dt, t, moving);

    // Chat bubble fade.
    const bm = this.bubble.material as THREE.SpriteMaterial;
    if (this.bubbleTimer > 0) {
      this.bubbleTimer -= dt;
      bm.opacity = Math.min(1, bm.opacity + dt * 4);
      this.bubble.position.y = CHAR_HEIGHT * 0.95 + Math.sin(t * 3) * 0.04;
    } else {
      bm.opacity = Math.max(0, bm.opacity - dt * 4);
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    this.character.dispose();
    (this.label.material as THREE.SpriteMaterial).dispose();
  }
}

function makeParticles(): THREE.Points {
  const n = 90;
  const pos = new Float32Array(n * 3);
  const speed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 0.8;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = Math.random() * 0.4;
    pos[i * 3 + 2] = Math.sin(a) * r;
    speed[i] = 0.8 + Math.random() * 1.8;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("speed", new THREE.BufferAttribute(speed, 1));
  const mat = new THREE.PointsMaterial({ color: 0x7fd6ff, size: 0.1, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
  return new THREE.Points(geo, mat);
}
