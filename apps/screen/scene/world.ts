import * as THREE from "three";

/**
 * The digital-lobby environment styled after the reference background: deep
 * blue gradient sky with a bright horizon glow, a glowing perspective grid
 * floor, a soft central floor glow, and fog for depth.
 */
export class World {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  /** Ground plane y=0; world units are metres. */
  readonly groundY = 0;

  private clock = new THREE.Clock();
  private tickers = new Set<(dt: number, t: number) => void>();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x04060f, 1);

    // gradient sky with a bright horizon glow (screen-space backdrop)
    this.scene.background = skyTexture();
    this.scene.fog = new THREE.FogExp2(0x07142e, 0.02);

    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 200);
    this.camera.position.set(0, 7, 18);
    this.camera.lookAt(0, 2.5, 0);

    this.buildLights();
    this.buildFloor();
    this.resize();
    addEventListener("resize", () => this.resize());
  }

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight(0x4a7bff, 0x0a0a1a, 0.85));
    const key = new THREE.DirectionalLight(0x88bbff, 1.1);
    key.position.set(6, 14, 8);
    this.scene.add(key);
    const rim = new THREE.PointLight(0x38e1ff, 1.0, 70);
    rim.position.set(0, 6, -6);
    this.scene.add(rim);
  }

  private buildFloor(): void {
    // Glowing perspective grid.
    const grid = new THREE.GridHelper(160, 80, 0x3f8ce0, 0x123a72);
    const gm = grid.material as THREE.Material;
    gm.transparent = true;
    gm.opacity = 0.55;
    this.scene.add(grid);

    // Dark reflective base plane for depth.
    const plane = new THREE.Mesh(
      new THREE.CircleGeometry(70, 64),
      new THREE.MeshStandardMaterial({ color: 0x081230, metalness: 0.7, roughness: 0.4, transparent: true, opacity: 0.8 }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -0.012;
    this.scene.add(plane);

    // Soft radial floor glow under the stage (the bright centre).
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(20, 64),
      new THREE.MeshBasicMaterial({ map: glowTexture(0x2f7fe0), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(0, 0.008, -1);
    this.scene.add(glow);
  }

  /** Register a per-frame callback. Returns an unsubscribe function. */
  onTick(fn: (dt: number, t: number) => void): () => void {
    this.tickers.add(fn);
    return () => this.tickers.delete(fn);
  }

  private resize(): void {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start(): void {
    const loop = () => {
      const dt = Math.min(this.clock.getDelta(), 0.05);
      const t = this.clock.elapsedTime;
      // Gentle camera drift for life.
      this.camera.position.x = Math.sin(t * 0.08) * 2.5;
      this.camera.lookAt(0, 2.5, 0);
      for (const fn of this.tickers) fn(dt, t);
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    loop();
  }
}

/** Deep-blue vertical gradient with a bright horizon glow. */
function skyTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 1280;
  c.height = 720;
  const x = c.getContext("2d")!;
  const g = x.createLinearGradient(0, 0, 0, 720);
  g.addColorStop(0, "#03040c");
  g.addColorStop(0.5, "#061230");
  g.addColorStop(1, "#0a2148");
  x.fillStyle = g;
  x.fillRect(0, 0, 1280, 720);
  // horizon glow
  const rg = x.createRadialGradient(640, 470, 0, 640, 470, 460);
  rg.addColorStop(0, "rgba(48,128,235,0.55)");
  rg.addColorStop(0.5, "rgba(30,90,200,0.22)");
  rg.addColorStop(1, "rgba(10,40,120,0)");
  x.fillStyle = rg;
  x.fillRect(0, 0, 1280, 720);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Cached soft radial-glow texture for additive floor/halo glows. */
export function glowTexture(color: number): THREE.Texture {
  const key = color.toString(16);
  if (glowCache.has(key)) return glowCache.get(key)!;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const x = c.getContext("2d")!;
  const hex = `#${color.toString(16).padStart(6, "0")}`;
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, hex);
  g.addColorStop(0.45, hex + "88");
  g.addColorStop(1, hex + "00");
  x.fillStyle = g;
  x.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  glowCache.set(key, tex);
  return tex;
}
const glowCache = new Map<string, THREE.Texture>();
