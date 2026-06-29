import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import QRCode from "qrcode";
import { WebSocketServer, WebSocket } from "ws";
import { DEFAULTS } from "../shared/config.ts";
import type {
  ConfigMessage,
  Guest,
  ServerMessage,
  SnapshotMessage,
  SpawnMessage,
  SponsorsMessage,
  TextsMessage,
} from "../shared/events.ts";
import { WS_PATH } from "../shared/events.ts";
import {
  addSponsor,
  checkIn,
  createGuest,
  deleteSponsor,
  findGuest,
  getGuest,
  getRecent,
  getSlogan,
  getSponsorIntervalSec,
  getTotal,
  listSponsors,
  searchGuests,
  setGuestPhoto,
  setSlogan,
  setSponsorIntervalSec,
} from "./db.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? DEFAULTS.port);
const isProd = process.env.NODE_ENV === "production";

// Persistent uploads dir (guest photos, logos) — served at /uploads in dev+prod.
const uploadsDir = resolve(__dirname, "../data/uploads");
mkdirSync(uploadsDir, { recursive: true });

/** Decode a data: URL, write it under data/uploads, return its public path. */
function saveDataUrl(dataUrl: string, prefix = "u"): string | null {
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;
  const ext = m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
  const name = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e4)}.${ext}`;
  writeFileSync(resolve(uploadsDir, name), Buffer.from(m[2], "base64"));
  return `/uploads/${name}`;
}

// ---- runtime control state (mutable via admin) ---------------------------
interface Control {
  lite: boolean;
  paused: boolean;
  maxAvatars: number;
  spawnIntervalSec: number;
}
const control: Control = {
  lite: DEFAULTS.lite,
  paused: false,
  maxAvatars: DEFAULTS.maxAvatars,
  spawnIntervalSec: DEFAULTS.spawnIntervalSec,
};

const app = express();
app.use(express.json({ limit: "8mb" })); // base64 photos
app.use("/uploads", express.static(uploadsDir));

// ---- REST API -------------------------------------------------------------
app.get("/api/guests/search", (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 1) return res.json({ guests: [] });
  res.json({ guests: searchGuests(q) });
});

app.post("/api/checkin", (req, res) => {
  const { guestId, name, company, gender, title, role, photo } = req.body ?? {};
  const photoUrl = typeof photo === "string" && photo.startsWith("data:") ? saveDataUrl(photo, "face") : null;
  let id: number | null = null;

  if (typeof guestId === "number") {
    id = guestId;
    if (photoUrl) setGuestPhoto(id, photoUrl);
  } else if (typeof name === "string" && name.trim()) {
    // Dedup walk-ins by name + company: reuse an existing record so a repeat
    // submission is an idempotent check-in (no new avatar/poster/count).
    const existing = findGuest(name, company);
    if (existing) {
      id = existing.id;
      if (photoUrl) setGuestPhoto(id, photoUrl);
    } else {
      id = createGuest({ name, company, gender, title, role, photoUrl });
    }
  } else {
    return res.status(400).json({ error: "guestId or name required" });
  }

  const result = checkIn(id);
  if (!result) return res.status(404).json({ error: "guest not found" });

  // Fresh check-ins enqueue a spawn; repeat scans are idempotent (no new spawn).
  if (result.fresh) enqueueSpawn(result.guest);

  res.json({ ok: true, guest: result.guest, fresh: result.fresh });
});

app.get("/api/stats", (_req, res) => {
  res.json({ total: getTotal(), recent: getRecent(DEFAULTS.recentLimit) });
});

app.post("/api/admin/trigger/:id", (req, res) => {
  const guest = getGuest(Number(req.params.id));
  if (!guest) return res.status(404).json({ error: "guest not found" });
  enqueueSpawn(guest, true);
  res.json({ ok: true });
});

app.post("/api/admin/config", (req, res) => {
  const { lite, paused, maxAvatars, spawnIntervalSec } = req.body ?? {};
  if (typeof lite === "boolean") control.lite = lite;
  if (typeof paused === "boolean") control.paused = paused;
  if (typeof maxAvatars === "number") control.maxAvatars = maxAvatars;
  if (typeof spawnIntervalSec === "number") control.spawnIntervalSec = spawnIntervalSec;
  broadcast(configMessage());
  res.json({ ok: true, control });
});

app.get("/api/qr", async (_req, res) => {
  const url = checkinUrl();
  const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 512 });
  res.json({ url, dataUrl });
});

// ---- sponsors (logos shown rotating on the big-screen sponsor card) --------
app.get("/api/sponsors", (_req, res) => {
  res.json({ logos: listSponsors(), intervalSec: getSponsorIntervalSec() });
});

app.post("/api/admin/sponsors", (req, res) => {
  const { photo } = req.body ?? {};
  const url = typeof photo === "string" && photo.startsWith("data:") ? saveDataUrl(photo, "spon") : null;
  if (!url) return res.status(400).json({ error: "valid image required" });
  addSponsor(url);
  broadcast(sponsorsMessage());
  res.json({ ok: true, logos: listSponsors() });
});

app.delete("/api/admin/sponsors/:id", (req, res) => {
  deleteSponsor(Number(req.params.id));
  broadcast(sponsorsMessage());
  res.json({ ok: true, logos: listSponsors() });
});

app.post("/api/admin/sponsors/interval", (req, res) => {
  const sec = Number(req.body?.intervalSec);
  if (!Number.isFinite(sec) || sec <= 0) return res.status(400).json({ error: "intervalSec must be > 0" });
  setSponsorIntervalSec(sec);
  broadcast(sponsorsMessage());
  res.json({ ok: true, intervalSec: getSponsorIntervalSec() });
});

// ---- editable big-screen texts (slogan) -----------------------------------
app.get("/api/texts", (_req, res) => {
  res.json({ slogan: getSlogan() });
});

app.post("/api/admin/texts", (req, res) => {
  const { slogan } = req.body ?? {};
  if (typeof slogan === "string") setSlogan(slogan);
  broadcast(textsMessage());
  res.json({ ok: true, slogan: getSlogan() });
});

// ---- static hosting (production serves the built apps) --------------------
if (isProd) {
  const dist = resolve(__dirname, "../dist");
  app.use(express.static(dist));
  // Friendly routes -> built html entries.
  for (const page of ["screen", "checkin", "admin", "preview"]) {
    app.get(`/${page}`, (_req, res) => res.sendFile(resolve(dist, `apps/${page}/index.html`)));
  }
  app.get("/", (_req, res) => res.redirect("/checkin"));
}

// ---- WebSocket ------------------------------------------------------------
const server = createServer(app);
const wss = new WebSocketServer({ server, path: WS_PATH });

wss.on("connection", (ws) => {
  // Send a snapshot so a freshly (re)opened screen rebuilds its HUD instantly.
  const snapshot: SnapshotMessage = {
    type: "snapshot",
    total: getTotal(),
    recent: getRecent(DEFAULTS.recentLimit),
    crowd: getRecent(control.maxAvatars),
  };
  send(ws, snapshot);
  send(ws, configMessage());
  send(ws, sponsorsMessage());
  send(ws, textsMessage());
});

function broadcast(msg: ServerMessage) {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  }
}

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function configMessage(): ConfigMessage {
  return {
    type: "config",
    lite: control.lite,
    paused: control.paused,
    maxAvatars: control.maxAvatars,
    spawnIntervalSec: control.spawnIntervalSec,
  };
}

function sponsorsMessage(): SponsorsMessage {
  return { type: "sponsors", logos: listSponsors(), intervalSec: getSponsorIntervalSec() };
}

function textsMessage(): TextsMessage {
  return { type: "texts", slogan: getSlogan() };
}

// ---- spawn queue (rate-limit avatar generation during rush) ---------------
const queue: { guest: Guest; replay: boolean }[] = [];
let lastSpawnAt = 0;

function enqueueSpawn(guest: Guest, replay = false) {
  queue.push({ guest, replay });
  pumpQueue();
}

function pumpQueue() {
  if (control.paused || queue.length === 0) return;
  const now = Date.now();
  const gapMs = control.spawnIntervalSec * 1000;
  const wait = Math.max(0, lastSpawnAt + gapMs - now);
  if (wait > 0) {
    setTimeout(pumpQueue, wait);
    return;
  }
  const item = queue.shift()!;
  lastSpawnAt = Date.now();
  const msg: SpawnMessage = {
    type: "spawn",
    guest: item.guest,
    total: getTotal(),
    replay: item.replay,
  };
  broadcast(msg);
  if (queue.length > 0) setTimeout(pumpQueue, gapMs);
}

// ---- boot -----------------------------------------------------------------
function lanIp(): string {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) return a.address;
    }
  }
  return "localhost";
}

function checkinUrl(): string {
  return `http://${lanIp()}:${PORT}/checkin`;
}

server.listen(PORT, () => {
  const ip = lanIp();
  console.log(`\n  MFEIA Lobby server (${isProd ? "prod" : "dev"}) on :${PORT}`);
  console.log(`  Screen  : http://localhost:${PORT}/screen`);
  console.log(`  Check-in: http://${ip}:${PORT}/checkin  (phones use this)`);
  console.log(`  Admin   : http://localhost:${PORT}/admin\n`);
});
