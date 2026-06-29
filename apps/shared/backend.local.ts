// Local backend: the original Express REST + WebSocket on the same origin.
// This preserves the exact pre-migration behaviour and is the default build.

import type { Guest, ServerMessage, SponsorLogo } from "../../shared/events.ts";
import { WS_PATH } from "../../shared/events.ts";
import type { AuthApi, Backend, CheckinBody, ScreenHandlers } from "./backend.ts";

async function postJson(url: string, body: unknown, method = "POST"): Promise<Response> {
  return fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** POST /api/checkin with retry — phones on flaky venue wifi shouldn't lose a check-in. */
async function postCheckin(body: CheckinBody, attempt = 0): Promise<{ guest: Guest; fresh: boolean }> {
  try {
    const res = await postJson("/api/checkin", body);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      return postCheckin(body, attempt + 1);
    }
    throw err;
  }
}

/**
 * WebSocket client for the big screen with auto-reconnect — the screen must
 * survive flaky venue networking and laptop sleep without a manual reload.
 */
function connect(onMessage: (msg: ServerMessage) => void): void {
  let ws: WebSocket | null = null;
  let retry = 0;
  const open = () => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}${WS_PATH}`);
    ws.addEventListener("open", () => {
      retry = 0;
      ws?.send(JSON.stringify({ type: "hello", role: "screen" }));
    });
    ws.addEventListener("message", (ev) => {
      try {
        onMessage(JSON.parse(ev.data) as ServerMessage);
      } catch {
        /* ignore malformed frame */
      }
    });
    ws.addEventListener("close", () => {
      const wait = Math.min(5000, 500 * 2 ** retry++);
      setTimeout(open, wait);
    });
    ws.addEventListener("error", () => ws?.close());
  };
  open();
}

// Local mode has no auth gate; report a stub session so the console shows directly.
const auth: AuthApi = {
  enabled: false,
  async getSession() {
    return { email: "local" };
  },
  async signIn() {
    return { error: null };
  },
  async signOut() {
    /* no-op */
  },
  onChange() {
    /* no-op */
  },
};

const backend: Backend = {
  async searchGuests(q) {
    const res = await fetch(`/api/guests/search?q=${encodeURIComponent(q)}`);
    const { guests } = (await res.json()) as { guests: Guest[] };
    return guests;
  },
  checkin(body) {
    return postCheckin(body);
  },
  async getStats() {
    const res = await fetch("/api/stats");
    return (await res.json()) as { total: number; recent: Guest[] };
  },
  subscribeScreen(handlers: ScreenHandlers) {
    connect((msg) => {
      switch (msg.type) {
        case "snapshot":
          handlers.onSnapshot(msg.total, msg.recent, msg.crowd);
          break;
        case "spawn":
          handlers.onSpawn(msg.guest, msg.total, msg.replay);
          break;
        case "config":
          handlers.onConfig(msg);
          break;
        case "sponsors":
          handlers.onSponsors(msg.logos, msg.intervalSec);
          break;
        case "texts":
          handlers.onTexts(msg.slogan);
          break;
      }
    });
  },
  async qrDataUrl() {
    const res = await fetch("/api/qr");
    const { dataUrl } = (await res.json()) as { dataUrl: string };
    return dataUrl;
  },
  async getTexts() {
    const res = await fetch("/api/texts");
    return (await res.json()) as { slogan: string };
  },
  async setTexts(slogan) {
    await postJson("/api/admin/texts", { slogan });
  },
  async listSponsors() {
    const res = await fetch("/api/sponsors");
    return (await res.json()) as { logos: SponsorLogo[]; intervalSec: number };
  },
  async addSponsor(photoDataUrl) {
    await postJson("/api/admin/sponsors", { photo: photoDataUrl });
  },
  async deleteSponsor(id) {
    await fetch(`/api/admin/sponsors/${id}`, { method: "DELETE" });
  },
  async setSponsorInterval(sec) {
    await postJson("/api/admin/sponsors/interval", { intervalSec: sec });
  },
  async triggerSpawn(id) {
    await fetch(`/api/admin/trigger/${id}`, { method: "POST" });
  },
  auth,
};

export default backend;
