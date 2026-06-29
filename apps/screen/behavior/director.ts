import * as THREE from "three";
import type { Guest } from "../../../shared/events.ts";
import { Avatar } from "../avatar/avatar.ts";

interface Group {
  center: THREE.Vector3;
  radius: number;
  baseAngle: number;
  slots: (Avatar | null)[];
  ring: THREE.Group;
}

// Cluster anchors spread across the floor, echoing the reference UI's groups.
const ANCHORS: [number, number, number][] = [
  [-8.5, 0, 0.5], [-4, 0, 3.5], [4, 0, 3.5], [8.5, 0, 0.5],
  [-6, 0, -3], [6, 0, -3], [0, 0, 6],
];
const GROUP_CAPACITY = 6;

/** Owns avatar lifecycle, group placement, bubbles, and capacity limits. */
export class Director {
  private groups: Group[] = [];
  private avatars: Avatar[] = [];
  private bubbleTimer = 2;
  maxAvatars = 50;

  constructor(private scene: THREE.Scene) {
    for (const [x, , z] of ANCHORS) {
      const center = new THREE.Vector3(x, 0, z);
      const ring = this.makeSpotlight();
      ring.position.set(x, 0.02, z);
      scene.add(ring);
      this.groups.push({ center, radius: 1.9, baseAngle: Math.random() * Math.PI * 2, slots: new Array(GROUP_CAPACITY).fill(null), ring });
    }
  }

  private makeSpotlight(): THREE.Group {
    const g = new THREE.Group();
    // Concentric elliptical rings (perspective floor look).
    for (const [r0, r1, op] of [[1.0, 1.12, 0.5], [1.55, 1.7, 0.4], [2.05, 2.18, 0.28]] as const) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(r0, r1, 48),
        new THREE.MeshBasicMaterial({ color: 0x38e1ff, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      mesh.userData.base = op;
      g.add(mesh);
    }
    // Soft filled glow at centre.
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(2.0, 40),
      new THREE.MeshBasicMaterial({ color: 0x143a78, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    glow.userData.base = 0.18;
    g.add(glow);
    g.rotation.x = -Math.PI / 2;
    g.scale.set(1, 0.62, 1); // elliptical for perspective
    return g;
  }

  spawn(guest: Guest, spawnAt: THREE.Vector3, instant = false): void {
    const avatar = new Avatar(guest, spawnAt);
    this.scene.add(avatar.group);
    this.avatars.push(avatar);

    const placed = this.assignSlot(avatar);
    if (instant && placed) avatar.settleInstantly(placed);
    else if (placed) avatar.setTarget(placed);

    this.enforceCapacity();
  }

  /** Repopulate the scene with already-checked-in guests (oldest first, no fx). */
  prefill(guests: Guest[], at: THREE.Vector3): void {
    for (const g of [...guests].reverse()) this.spawn(g, at, true);
  }

  /** Assign the avatar to the least-full group's first open slot. */
  private assignSlot(avatar: Avatar): THREE.Vector3 | null {
    let best: Group | null = null;
    let bestCount = Infinity;
    for (const g of this.groups) {
      const count = g.slots.filter(Boolean).length;
      if (count < g.slots.length && count < bestCount) {
        best = g;
        bestCount = count;
      }
    }
    if (!best) best = this.groups[Math.floor(Math.random() * this.groups.length)];
    const idx = best.slots.findIndex((s) => s === null);
    const i = idx >= 0 ? idx : Math.floor(Math.random() * best.slots.length);
    if (idx >= 0) best.slots[i] = avatar;
    const a = (i / GROUP_CAPACITY) * Math.PI * 2 + best.baseAngle;
    return new THREE.Vector3(
      best.center.x + Math.cos(a) * best.radius,
      0,
      best.center.z + Math.sin(a) * best.radius * 0.62,
    );
  }

  private enforceCapacity(): void {
    while (this.avatars.length > this.maxAvatars) {
      const old = this.avatars.shift()!;
      for (const g of this.groups) {
        const i = g.slots.indexOf(old);
        if (i >= 0) g.slots[i] = null;
      }
      old.dispose();
    }
  }

  update(dt: number, t: number): void {
    for (const a of this.avatars) a.update(dt, t);

    // Spotlight intensity tracks occupancy.
    for (const g of this.groups) {
      const occ = g.slots.filter(Boolean).length / GROUP_CAPACITY;
      const k = occ > 0 ? 0.4 + occ * 0.6 : 0;
      for (const child of g.ring.children) {
        const m = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
        const target = (child.userData.base as number) * k;
        m.opacity += (target - m.opacity) * Math.min(1, dt * 3);
      }
    }

    // Occasionally make a settled avatar "talk".
    this.bubbleTimer -= dt;
    if (this.bubbleTimer <= 0) {
      this.bubbleTimer = 1.5 + Math.random() * 2.5;
      const settled = this.avatars.filter((a) => a.settled);
      if (settled.length) settled[Math.floor(Math.random() * settled.length)].showBubble(2 + Math.random() * 1.5);
    }
  }
}
