import * as THREE from "three";

/**
 * Wireframe neon city skyline on the left & right (centre kept clear for the
 * portal), with vertical light streaks rising from the towers, plus a floating
 * sparkle field — styled after the reference background image.
 */
export function buildBackdrop(): THREE.Group {
  const group = new THREE.Group();

  const faceMat = new THREE.MeshBasicMaterial({ color: 0x06122c, transparent: true, opacity: 0.45, depthWrite: true });
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x3f8ce0, transparent: true, opacity: 0.7 });
  const litMat = new THREE.LineBasicMaterial({ color: 0x7fc6ff, transparent: true, opacity: 0.9 });
  const streakTex = streakTexture();

  // tower clusters on each side, leaving the centre open
  const clusters = [
    { x0: -34, x1: -9, count: 11 },
    { x0: 9, x1: 34, count: 11 },
  ];
  for (const cl of clusters) {
    for (let i = 0; i < cl.count; i++) {
      const w = 1.6 + Math.random() * 2.6;
      const d = 1.6 + Math.random() * 2.6;
      const h = 7 + Math.random() * 20;
      const x = cl.x0 + (cl.x1 - cl.x0) * (i / (cl.count - 1)) + (Math.random() - 0.5) * 2;
      const z = -10 - Math.random() * 22;
      const geo = new THREE.BoxGeometry(w, h, d);

      const face = new THREE.Mesh(geo, faceMat);
      face.position.set(x, h / 2, z);
      group.add(face);

      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), Math.random() > 0.6 ? litMat : edgeMat);
      edges.position.copy(face.position);
      group.add(edges);

      // a light streak rising above the tower
      if (Math.random() > 0.35) group.add(streak(streakTex, x + (Math.random() - 0.5) * w, z, h + 2, 10 + Math.random() * 16));
    }
  }

  // a few tall streaks toward the back-centre (depth accent)
  for (let i = 0; i < 6; i++) {
    group.add(streak(streakTex, (Math.random() - 0.5) * 7, -16 - Math.random() * 10, 1, 16 + Math.random() * 14));
  }

  group.add(sparkles(380, 0.12, 0.8, 0x7fc6ff));
  group.add(sparkles(80, 0.3, 0.9, 0xbfe6ff));

  return group;
}

function streak(tex: THREE.Texture, x: number, z: number, baseY: number, height: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(0.14, height),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  m.position.set(x, baseY + height / 2, z);
  return m;
}

function sparkles(n: number, size: number, opacity: number, color: number): THREE.Points {
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 70;
    pos[i * 3 + 1] = Math.random() * 28;
    pos[i * 3 + 2] = -4 - Math.random() * 30;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ color, size, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
}

/** Vertical streak: bright at the bottom, fading toward the top. */
function streakTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 256;
  const x = c.getContext("2d")!;
  const g = x.createLinearGradient(0, 256, 0, 0);
  g.addColorStop(0, "rgba(180,225,255,0.95)");
  g.addColorStop(0.4, "rgba(90,170,255,0.4)");
  g.addColorStop(1, "rgba(60,140,255,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 8, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
