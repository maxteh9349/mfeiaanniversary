// Shared contract between the local server and the browser apps.
// Keep this dependency-free so it can be imported from both Node and the DOM.

export type Gender = "male" | "female" | "unknown";

export interface Guest {
  id: number;
  name: string;
  company: string | null;
  gender: Gender;
  /** Honorific/title shown before the name (先生 / 拿督斯里 / 博士 / …). */
  title: string | null;
  role: string | null;
  /** Which avatar variant was assigned at check-in. */
  avatarId: number;
  /** Optional guest photo (URL under /uploads) shown as the avatar's face. */
  photoUrl: string | null;
  checkedInAt: number; // epoch ms
}

/** Sent from server -> screen over WebSocket when a guest checks in. */
export interface SpawnMessage {
  type: "spawn";
  guest: Guest;
  /** Total checked-in count after this spawn (drives the HUD counter). */
  total: number;
  /** True when replayed from the admin console rather than a fresh check-in. */
  replay?: boolean;
}

/** Sent from server -> screen to toggle render quality remotely. */
export interface ConfigMessage {
  type: "config";
  lite?: boolean;
  paused?: boolean;
  /** Max concurrent foreground avatars before older ones drop to background. */
  maxAvatars?: number;
  /** Min seconds between spawns dequeued from the spawn queue. */
  spawnIntervalSec?: number;
}

/** Sent once on connect so a freshly opened screen can repopulate the HUD. */
export interface SnapshotMessage {
  type: "snapshot";
  total: number;
  recent: Guest[]; // newest first, for the HUD list
  crowd: Guest[]; // recent checked-in guests to repopulate the 3D scene on load
}

/** A sponsor logo shown (rotating) on the big-screen sponsor card. */
export interface SponsorLogo {
  id: number;
  url: string;
}

/** Sent from server -> screen with the sponsor logos + rotation interval. */
export interface SponsorsMessage {
  type: "sponsors";
  logos: SponsorLogo[];
  /** Seconds each logo is shown before rotating to the next. */
  intervalSec: number;
}

/** Editable big-screen texts (set from the admin console). */
export interface TextsMessage {
  type: "texts";
  slogan: string;
}

export type ServerMessage = SpawnMessage | ConfigMessage | SnapshotMessage | SponsorsMessage | TextsMessage;

/** Sent from screen -> server (heartbeat / role announce). */
export interface HelloMessage {
  type: "hello";
  role: "screen" | "admin";
}

export type ClientMessage = HelloMessage;

export const WS_PATH = "/ws";

// ---- lucky draw -----------------------------------------------------------

export type PrizeLevel = "lucky" | "third" | "second" | "grand";
export type WinnerStatus = "pending" | "claimed" | "forfeit";

export interface Prize {
  id: number;
  name: string;
  level: PrizeLevel;
  imageUrl: string | null;
  sponsor: string | null;
  quantity: number;
  remaining: number;
  sort: number;
  status: "active" | "archived";
}

export interface Winner {
  id: number;
  prizeId: number;
  guestId: number;
  guestName: string;
  status: WinnerStatus;
  createdAt: number; // epoch ms
}

/** Broadcast payloads on the "draw" channel (operator -> presentation). */
export interface DrawRollStart {
  type: "roll_start";
  prize: Prize;
  reel: string[]; // guest names to scroll (cosmetic; winner is decided server-side)
  countdownMs?: number;
}
export interface DrawReveal {
  type: "reveal";
  prize: Prize;
  winner: Winner;
}
export interface DrawReset {
  type: "reset";
}
export type DrawEvent = DrawRollStart | DrawReveal | DrawReset;

/** Supabase Realtime broadcast channel name for the draw presentation. */
export const DRAW_CHANNEL = "draw";

/** Honorifics shown AFTER the name (Chinese convention); all others go before. */
const POSTFIX_TITLES = new Set(["先生", "女士", "博士"]);

/** Combine a guest's title + name for display (no space). 先生/女士/博士 go after. */
export function displayName(g: { title: string | null; name: string }): string {
  const t = (g.title ?? "").trim();
  if (!t) return g.name;
  return POSTFIX_TITLES.has(t) ? `${g.name}${t}` : `${t}${g.name}`;
}
