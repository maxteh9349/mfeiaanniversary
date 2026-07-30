// Frontend backend abstraction. One interface, two implementations selected at
// build time via VITE_BACKEND:
//   - "local"    (default) -> Express REST + WebSocket on the same origin
//   - "supabase"           -> Supabase Postgres / Storage / Realtime / Auth
//
// Call sites await `getBackend()` and use the returned object. The unused
// implementation is code-split (dynamic import) so the local build never pulls
// in supabase-js, and the supabase build never needs the local server running.

import type {
  DrawEvent,
  Guest,
  Honouree,
  Prize,
  Segment,
  SponsorLogo,
  StageState,
  Winner,
  WinnerStatus,
} from "../../shared/events.ts";

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
  onConfig(cfg: { lite?: boolean; paused?: boolean; maxAvatars?: number; spawnIntervalSec?: number; guestFeedHidden?: boolean; checkinFlowHidden?: boolean }): void;
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
  /** Operator ended the draw — the /draw page should return to the lobby /screen. */
  onReturnToScreen?(): void;
  /** postgres_changes re-sync so a freshly-opened /draw reflects current prizes. */
  onPrizes?(prizes: Prize[]): void;
}

/** /stage callbacks. State changes are the operator's cues; segments/honourees re-sync on edit. */
export interface StageHandlers {
  /** Live segment + honouree cursor changed (or first load). */
  onState(state: StageState, segment: Segment | null, honourees: Honouree[]): void;
}

/** Draft segment fields (id/created_at are server-managed). */
export interface SegmentInput {
  kind: Segment["kind"];
  timeLabel?: string | null;
  titleZh: string;
  titleEn?: string | null;
  subtitle?: string | null;
  presenter?: string | null;
  escort?: string | null;
  note?: string | null;
  autoScroll?: boolean;
  /** 短片路径（`/video/xx.mp4` 或外部直链）；空 = 不放片。图片走 setSegmentImage。 */
  videoUrl?: string | null;
  sort?: number;
  status?: Segment["status"];
}

/** Draft honouree fields (segmentId is passed separately on create). */
export interface HonoureeInput {
  groupLabel?: string | null;
  nameZh: string;
  nameEn?: string | null;
  org?: string | null;
  sort?: number;
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
  // admin: mute the guest feed (recent panel + welcome poster) during other segments
  getGuestFeedHidden(): Promise<boolean>;
  setGuestFeedHidden(hidden: boolean): Promise<void>;
  // admin: hide the bottom "签到流程" bar (QR + steps) on the screen
  getCheckinFlowHidden(): Promise<boolean>;
  setCheckinFlowHidden(hidden: boolean): Promise<void>;
  // admin: wipe all attendee + draw data (keeps sponsors/prizes/settings)
  resetEvent(): Promise<void>;

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
  deleteWinner(winnerId: number): Promise<void>;
  logDraw(action: "draw_started" | "draw_stopped", prizeId?: number): Promise<void>;
  listWinners(prizeId?: number): Promise<Winner[]>;
  // realtime: presentation subscribes, operator broadcasts animation cues
  subscribeDraw(handlers: DrawHandlers): void;
  broadcastDraw(evt: DrawEvent): Promise<void>;

  // ---- programme segments (/stage) ----
  listSegments(): Promise<Segment[]>;
  listHonourees(segmentId: number): Promise<Honouree[]>;
  /** segmentId -> honouree count, for the console's rundown grid. */
  honoureeCounts(): Promise<Map<number, number>>;
  /** Tick a segment as played (stamped when it goes on the big screen). */
  markSegmentAired(id: number): Promise<void>;
  /** Clear every 「已播过」 tick — e.g. after a rehearsal. */
  clearAiredMarks(): Promise<void>;
  createSegment(input: SegmentInput): Promise<Segment>;
  updateSegment(id: number, input: SegmentInput): Promise<void>;
  /**
   * Set (data: URL) or clear (null) the segment's big-screen image. Separate from
   * updateSegment so the console can upload without re-submitting the whole form,
   * and so "no new file" can never be mistaken for "remove the image".
   */
  setSegmentImage(id: number, imageDataUrl: string | null): Promise<void>;
  deleteSegment(id: number): Promise<void>;
  addHonouree(segmentId: number, input: HonoureeInput): Promise<Honouree>;
  updateHonouree(id: number, input: HonoureeInput): Promise<void>;
  /**
   * Set (data: URL) or clear (null) an honouree's portrait. Separate from
   * updateHonouree for the same reason setSegmentImage is separate from
   * updateSegment: saving the name/title form must never drop the photo.
   */
  setHonoureePhoto(id: number, photoDataUrl: string | null): Promise<void>;
  deleteHonouree(id: number): Promise<void>;
  /** Renumber a segment's honourees to the given order (console list reordering). */
  reorderHonourees(segmentId: number, orderedIds: number[]): Promise<void>;
  /** Current stage state; drives both /stage cold-load and the console's cursor. */
  getStageState(): Promise<StageState>;
  setStageState(state: StageState): Promise<void>;
  /** /stage subscribes; every operator cue arrives as an onState call. */
  subscribeStage(handlers: StageHandlers): void;

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
