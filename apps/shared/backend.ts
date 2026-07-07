// Frontend backend abstraction. One interface, two implementations selected at
// build time via VITE_BACKEND:
//   - "local"    (default) -> Express REST + WebSocket on the same origin
//   - "supabase"           -> Supabase Postgres / Storage / Realtime / Auth
//
// Call sites await `getBackend()` and use the returned object. The unused
// implementation is code-split (dynamic import) so the local build never pulls
// in supabase-js, and the supabase build never needs the local server running.

import type { DrawEvent, Guest, Prize, SponsorLogo, Winner, WinnerStatus } from "../../shared/events.ts";

/** Body accepted by checkin() — same shape the local /api/checkin took. */
export interface CheckinBody {
  guestId?: number;
  name?: string;
  company?: string;
  gender?: string;
  title?: string;
  role?: string;
  /** Optional photo as a data: URL; the impl persists it and stores the URL. */
  photo?: string | null;
}

/** Screen-side realtime callbacks (mirror the old WebSocket ServerMessage set). */
export interface ScreenHandlers {
  onSnapshot(total: number, recent: Guest[], crowd: Guest[]): void;
  onSpawn(guest: Guest, total: number, replay?: boolean): void;
  onConfig(cfg: { lite?: boolean; paused?: boolean; maxAvatars?: number; spawnIntervalSec?: number }): void;
  onSponsors(logos: SponsorLogo[], intervalSec: number): void;
  onTexts(slogan: string): void;
}

/** Draft prize fields for create/update (id/remaining are server-managed). */
export interface PrizeInput {
  name: string;
  level: Prize["level"];
  sponsor?: string | null;
  quantity: number;
  sort?: number;
  status?: Prize["status"];
  /** New image as a data: URL; the impl uploads it and stores the URL. */
  imageDataUrl?: string | null;
}

/** Presentation-side draw callbacks (mirror the "draw" broadcast events). */
export interface DrawHandlers {
  onRollStart(prize: Prize, reel: string[], countdownMs?: number): void;
  onReveal(prize: Prize, winner: Winner): void;
  onReset(): void;
  /** postgres_changes re-sync so a freshly-opened /draw reflects current prizes. */
  onPrizes?(prizes: Prize[]): void;
}

export interface AuthSession {
  email: string;
}

/** Admin auth. Local mode is open (enabled=false) so the console shows directly. */
export interface AuthApi {
  enabled: boolean;
  getSession(): Promise<AuthSession | null>;
  signIn(email: string, password: string): Promise<{ error: string | null }>;
  signOut(): Promise<void>;
  onChange(cb: (session: AuthSession | null) => void): void;
}

export interface Backend {
  // check-in surface
  searchGuests(q: string): Promise<Guest[]>;
  checkin(body: CheckinBody): Promise<{ guest: Guest; fresh: boolean }>;
  // stats / screen
  getStats(): Promise<{ total: number; recent: Guest[] }>;
  subscribeScreen(handlers: ScreenHandlers): void;
  qrDataUrl(): Promise<string>;
  // admin: texts
  getTexts(): Promise<{ slogan: string }>;
  setTexts(slogan: string): Promise<void>;
  // admin: sponsors
  listSponsors(): Promise<{ logos: SponsorLogo[]; intervalSec: number }>;
  addSponsor(photoDataUrl: string): Promise<void>;
  deleteSponsor(id: number): Promise<void>;
  setSponsorInterval(sec: number): Promise<void>;
  // admin: replay an existing guest onto the screen
  triggerSpawn(id: number): Promise<void>;

  // ---- lucky draw ----
  // prizes (operator CRUD)
  listPrizes(): Promise<Prize[]>;
  createPrize(input: PrizeInput): Promise<Prize>;
  updatePrize(id: number, input: PrizeInput): Promise<void>;
  deletePrize(id: number): Promise<void>;
  // draw operations (server-side, authenticated)
  drawPoolSample(limit?: number): Promise<string[]>;
  pickWinner(prizeId: number): Promise<Winner>;
  redraw(winnerId: number): Promise<Winner>;
  setWinnerStatus(winnerId: number, status: WinnerStatus): Promise<void>;
  logDraw(action: "draw_started" | "draw_stopped", prizeId?: number): Promise<void>;
  listWinners(prizeId?: number): Promise<Winner[]>;
  // realtime: presentation subscribes, operator broadcasts animation cues
  subscribeDraw(handlers: DrawHandlers): void;
  broadcastDraw(evt: DrawEvent): Promise<void>;

  // admin auth
  auth: AuthApi;
}

let cached: Backend | null = null;

/** Resolve the active backend (memoised). Awaited by every call site. */
export async function getBackend(): Promise<Backend> {
  if (cached) return cached;
  const mod =
    import.meta.env.VITE_BACKEND === "supabase"
      ? await import("./backend.supabase.ts")
      : await import("./backend.local.ts");
  cached = mod.default;
  return cached;
}
