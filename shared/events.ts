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
  /**
   * Hide the "最新签到嘉宾" panel AND suppress the full-screen welcome poster,
   * so the big screen can run other programme segments undisturbed. Check-ins
   * still record normally — only the guest-facing reveal is muted.
   */
  guestFeedHidden?: boolean;
  /** Hide the bottom "签到流程" bar (QR + steps) on the big screen. */
  checkinFlowHidden?: boolean;
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
/** Tell the /draw presentation to hand the big screen back to the lobby /screen. */
export interface DrawReturnToScreen {
  type: "screen";
}
export type DrawEvent = DrawRollStart | DrawReveal | DrawReset | DrawReturnToScreen;

/** Supabase Realtime broadcast channel name for the draw presentation. */
export const DRAW_CHANNEL = "draw";

// ---- programme segments (/stage) ------------------------------------------

/** Big-screen layout used for a rundown segment. */
export type SegmentKind =
  | "title" // 过场标题卡（国歌、敬酒、晚宴完毕…）
  | "speech" // 致辞：讲者姓名 + 职衔
  | "roster" // 整屏名单（理事就职、长期服务奖分组）
  | "award" // 逐位点名（结业证书、奖励金、支票、委任状）
  | "sponsor_thanks" // 赞助商感谢状
  // 幸运抽奖。不是一种排版：上台时 /screen 亮出抽奖图层（apps/draw/presenter.ts），
  // 滚动 / 揭晓仍由运维台的抽奖控制台驱动。
  | "lucky_draw";

/** One item of the dinner rundown, rendered by /stage according to `kind`. */
export interface Segment {
  id: number;
  kind: SegmentKind;
  /** Time as printed in the rundown ("8.42pm"); shown as a corner label. */
  timeLabel: string | null;
  titleZh: string;
  titleEn: string | null;
  subtitle: string | null;
  /** 颁发人 shown at the foot of award/roster layouts. */
  presenter: string | null;
  /** 陪同 — newline-separated when there are several. */
  escort: string | null;
  note: string | null;
  /** roster only: scroll a list too long to fit instead of clipping it. */
  autoScroll: boolean;
  /**
   * 环节大图，上台时叠在 /screen 大屏上（null = 未上传，大屏回退到标题文字卡）。
   * /stage 的文字排版不使用它。
   */
  imageUrl: string | null;
  /**
   * 环节短片。上台即播，盖住整块大屏；播完停在最后一帧，等操作台切走。
   * 存的是路径而不是上传的文件 —— 视频丢进 assets/video/ 就能用（`/video/xx.mp4`），
   * 填外部直链也行。null = 这个环节不放片。
   */
  videoUrl: string | null;
  sort: number;
  status: "active" | "archived";
  /** When this segment was last put on the big screen; null = not played yet. */
  airedAt: number | null;
}

/** A person (or company) called up during a segment. */
export interface Honouree {
  id: number;
  segmentId: number;
  /** Roster group heading ("服务15年以上"); null = ungrouped. */
  groupLabel: string | null;
  nameZh: string;
  nameEn: string | null;
  /** 公司 / 学校 / 职衔. */
  org: string | null;
  /**
   * 人物肖像（存 `uploads` 桶，见 0011_honouree_photo.sql）。目前只有致辞版式会读它，
   * 与姓名 / 职衔并排显示；null = 没上传，版式退回纯文字。
   */
  photoUrl: string | null;
  sort: number;
}

/**
 * What the big screen is showing right now. Persisted in `settings` (see
 * 0006_stage.sql) so it doubles as the realtime cue and as recovery state for a
 * screen reloaded mid-ceremony.
 */
export interface StageState {
  /** False -> /stage hands the screen back to the /screen lobby. */
  active: boolean;
  segmentId: number | null;
  /** 0-based honouree cursor for `award`; == honouree count shows the 合照 card. */
  index: number;
  /**
   * 环节短片的音量 0–100（0 = 静音）。跟着 stage 状态一起走，所以运维台拉一下滑杆，
   * 正在播的大屏立刻跟上；大屏中途刷新也会恢复成同一个音量。
   */
  volume: number;
}

/** 短片音量默认值：不设过就按满音量播。 */
export const STAGE_VOLUME_DEFAULT = 100;

/** settings keys holding StageState. */
export const STAGE_KEYS = {
  active: "stageActive",
  segmentId: "stageSegmentId",
  index: "stageIndex",
  volume: "stageVolume",
} as const;

/** Honorifics shown AFTER the name (Chinese convention); all others go before. */
const POSTFIX_TITLES = new Set(["先生", "女士", "小姐", "太太", "博士", "教授"]);

/** Combine a guest's title + name for display (no space). 先生/女士/小姐/太太/博士/教授 go after. */
export function displayName(g: { title: string | null; name: string }): string {
  const t = (g.title ?? "").trim();
  if (!t) return g.name;
  return POSTFIX_TITLES.has(t) ? `${g.name}${t}` : `${t}${g.name}`;
}
