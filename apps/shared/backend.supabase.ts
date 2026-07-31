// Supabase backend: Postgres (via the checkin_guest RPC + table reads), Storage
// for photos/logos, Realtime for screen spawns, and Auth for the admin gate.
// Mirrors the local backend's observable behaviour (see backend.local.ts).

import QRCode from "qrcode";
import type {
  DrawEvent,
  DrawReveal,
  DrawRollStart,
  Gender,
  Guest,
  Honouree,
  Prize,
  Segment,
  SponsorLogo,
  StageState,
  Winner,
  WinnerStatus,
} from "../../shared/events.ts";
import {
  DRAW_CHANNEL,
  prizeLevelRank,
  STAGE_AUTO_SEC_DEFAULT,
  STAGE_KEYS,
  STAGE_VOLUME_DEFAULT,
} from "../../shared/events.ts";
import { AVATAR_MODEL_COUNT, DEFAULTS, DRAW_DEFAULTS } from "../../shared/config.ts";
import type {
  AuthApi,
  Backend,
  CheckinBody,
  DrawHandlers,
  HonoureeInput,
  PrizeInput,
  ScreenHandlers,
  SegmentInput,
  StageHandlers,
} from "./backend.ts";
import { supabase } from "./supabaseClient.ts";

/** Raw guests row (snake_case) as returned by Postgres / Realtime. */
interface GuestRow {
  id: number;
  name: string;
  company: string | null;
  gender: string | null;
  title: string | null;
  role: string | null;
  avatar_id: number | null;
  photo_url: string | null;
  checked_in_at: number | null;
}

/** Mirror of rowToGuest in server/db.ts (random avatar fallback when unset). */
function rowToGuest(r: GuestRow): Guest {
  return {
    id: r.id,
    name: r.name,
    company: r.company,
    gender: (r.gender as Gender) ?? "unknown",
    title: r.title ?? null,
    role: r.role,
    avatarId: r.avatar_id ?? Math.floor(Math.random() * AVATAR_MODEL_COUNT),
    photoUrl: r.photo_url ?? null,
    checkedInAt: r.checked_in_at ?? Date.now(),
  };
}

/** Decode a data: URL, upload it to the public `uploads` bucket, return its URL. */
async function uploadDataUrl(dataUrl: string, prefix: string): Promise<string | null> {
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const ext = mime === "jpeg" ? "jpg" : mime;
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  const path = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e4)}.${ext}`;
  const { error } = await supabase.storage.from("uploads").upload(path, bytes, {
    contentType: `image/${mime}`,
  });
  if (error) throw error;
  return supabase.storage.from("uploads").getPublicUrl(path).data.publicUrl;
}

async function getSetting(key: string): Promise<string | null> {
  const { data } = await supabase.from("settings").select("value").eq("key", key).maybeSingle();
  return (data as { value: string } | null)?.value ?? null;
}

/** settings key holding the guest-feed mute flag ("1" = hidden). */
const GUEST_FEED_KEY = "guestFeedHidden";

async function fetchGuestFeedHidden(): Promise<boolean> {
  return (await getSetting(GUEST_FEED_KEY)) === "1";
}

/** settings key holding the check-in-flow bar mute flag ("1" = hidden). */
const CHECKIN_FLOW_KEY = "checkinFlowHidden";

async function fetchCheckinFlowHidden(): Promise<boolean> {
  return (await getSetting(CHECKIN_FLOW_KEY)) === "1";
}

async function fetchSponsors(): Promise<{ logos: SponsorLogo[]; intervalSec: number }> {
  const { data } = await supabase
    .from("sponsors")
    .select("id,url")
    .order("sort", { ascending: true })
    .order("id", { ascending: true });
  const raw = await getSetting("sponsorIntervalSec");
  const n = raw ? Number(raw) : NaN;
  const intervalSec = Number.isFinite(n) && n > 0 ? n : DEFAULTS.sponsorIntervalSec;
  return { logos: (data ?? []) as SponsorLogo[], intervalSec };
}

async function fetchStats(): Promise<{ total: number; recent: Guest[] }> {
  const { count } = await supabase
    .from("guests")
    .select("*", { count: "exact", head: true })
    .eq("status", "checked_in");
  const { data } = await supabase
    .from("guests")
    .select("*")
    .eq("status", "checked_in")
    .order("checked_in_at", { ascending: false })
    .limit(DEFAULTS.recentLimit);
  return { total: count ?? 0, recent: ((data ?? []) as GuestRow[]).map(rowToGuest) };
}

// Lazily-subscribed broadcast channel for admin -> screen replay commands.
let replayChannel: ReturnType<typeof supabase.channel> | null = null;
function adminChannel() {
  if (!replayChannel) {
    replayChannel = supabase.channel("screen", { config: { broadcast: { self: false } } });
    replayChannel.subscribe();
  }
  return replayChannel;
}

// ---- lucky draw mappers + helpers ----
interface PrizeRow {
  id: number;
  name: string;
  level: string;
  image_url: string | null;
  sponsor: string | null;
  quantity: number;
  remaining: number;
  sort: number;
  status: string;
}
function rowToPrize(r: PrizeRow): Prize {
  return {
    id: r.id,
    name: r.name,
    level: r.level as Prize["level"],
    imageUrl: r.image_url,
    sponsor: r.sponsor,
    quantity: r.quantity,
    remaining: r.remaining,
    sort: r.sort,
    status: r.status as Prize["status"],
  };
}

interface WinnerRow {
  id: number;
  prize_id: number;
  guest_id: number;
  guest_name: string;
  status: string;
  created_at: number;
}
function rowToWinner(r: WinnerRow): Winner {
  return {
    id: r.id,
    prizeId: r.prize_id,
    guestId: r.guest_id,
    guestName: r.guest_name,
    status: r.status as WinnerStatus,
    createdAt: r.created_at,
  };
}

/** Shape returned by draw_pick_winner / draw_redraw (out_-prefixed columns). */
interface DrawWinnerRpcRow {
  out_winner_id: number;
  out_guest_id: number;
  out_guest_name: string;
  out_prize_id: number;
  out_remaining: number;
}
function rpcRowToWinner(r: DrawWinnerRpcRow): Winner {
  return {
    id: r.out_winner_id,
    prizeId: r.out_prize_id,
    guestId: r.out_guest_id,
    guestName: r.out_guest_name,
    status: "pending",
    createdAt: Date.now(),
  };
}

/** Signed-in operator email, stamped into audit rows by the draw RPCs. */
async function operatorEmail(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.email ?? null;
}

// Lazily-subscribed broadcast channel for operator -> presentation draw cues.
let drawChannel: ReturnType<typeof supabase.channel> | null = null;
function drawBroadcastChannel() {
  if (!drawChannel) {
    drawChannel = supabase.channel(DRAW_CHANNEL, { config: { broadcast: { self: false } } });
    drawChannel.subscribe();
  }
  return drawChannel;
}

// ---- programme segments (the /screen overlay) mappers + helpers ----
interface SegmentRow {
  id: number;
  kind: string;
  time_label: string | null;
  title_zh: string;
  title_en: string | null;
  subtitle: string | null;
  presenter: string | null;
  escort: string | null;
  note: string | null;
  auto_scroll: boolean;
  image_url: string | null;
  video_url: string | null;
  sort: number;
  status: string;
  aired_at: number | null;
}
function rowToSegment(r: SegmentRow): Segment {
  return {
    id: r.id,
    kind: r.kind as Segment["kind"],
    timeLabel: r.time_label,
    titleZh: r.title_zh,
    titleEn: r.title_en,
    subtitle: r.subtitle,
    presenter: r.presenter,
    escort: r.escort,
    note: r.note,
    autoScroll: !!r.auto_scroll,
    imageUrl: r.image_url ?? null,
    videoUrl: r.video_url ?? null,
    sort: r.sort,
    status: r.status as Segment["status"],
    airedAt: r.aired_at ?? null,
  };
}

interface HonoureeRow {
  id: number;
  segment_id: number;
  group_label: string | null;
  name_zh: string;
  name_en: string | null;
  org: string | null;
  role_label: string | null;
  photo_url: string | null;
  sort: number;
}
function rowToHonouree(r: HonoureeRow): Honouree {
  return {
    id: r.id,
    segmentId: r.segment_id,
    groupLabel: r.group_label,
    nameZh: r.name_zh,
    nameEn: r.name_en,
    org: r.org,
    roleLabel: r.role_label ?? null,
    photoUrl: r.photo_url ?? null,
    sort: r.sort,
  };
}

/**
 * snake_case patch for segments. Deliberately excludes `aired_at` (editing a
 * segment in the console must not clear how far through the rundown we are) and
 * `image_url` (owned by setSegmentImage, so saving the form keeps the picture).
 */
function segmentPatch(input: SegmentInput): Record<string, unknown> {
  return {
    kind: input.kind,
    time_label: input.timeLabel ?? null,
    title_zh: input.titleZh,
    title_en: input.titleEn ?? null,
    subtitle: input.subtitle ?? null,
    presenter: input.presenter ?? null,
    escort: input.escort ?? null,
    note: input.note ?? null,
    auto_scroll: input.autoScroll ?? false,
    // 短片只是一条路径，跟着表单一起存；图片是上传，另走 setSegmentImage。
    video_url: input.videoUrl?.trim() || null,
    sort: input.sort ?? 0,
    status: input.status ?? "active",
  };
}

/** 与 segmentPatch 同理，刻意不含 `photo_url` —— 它归 setHonoureePhoto 管，
    所以在运维台改个名字 / 职衔再保存，照片不会被顺手清掉。 */
function honoureePatch(input: HonoureeInput): Record<string, unknown> {
  return {
    group_label: input.groupLabel ?? null,
    name_zh: input.nameZh,
    name_en: input.nameEn ?? null,
    org: input.org ?? null,
    role_label: input.roleLabel ?? null,
    sort: input.sort ?? 0,
  };
}

async function fetchStageState(): Promise<StageState> {
  const [active, segmentId, index, volume, autoSec] = await Promise.all([
    getSetting(STAGE_KEYS.active),
    getSetting(STAGE_KEYS.segmentId),
    getSetting(STAGE_KEYS.index),
    getSetting(STAGE_KEYS.volume),
    getSetting(STAGE_KEYS.autoSec),
  ]);
  const id = Number(segmentId);
  const i = Number(index);
  const v = Number(volume);
  const sec = Number(autoSec);
  return {
    active: active === "1",
    segmentId: segmentId && Number.isFinite(id) && id > 0 ? id : null,
    index: Number.isFinite(i) && i > 0 ? Math.floor(i) : 0,
    // 没设过（行不存在）就按满音量；写过 0 也要老实当静音，别被 || 吞掉。
    volume: volume != null && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : STAGE_VOLUME_DEFAULT,
    // 自动播放间隔：至少 1 秒（0 会让运维台的计时器空转），上限 120 秒。
    autoSec:
      autoSec != null && Number.isFinite(sec)
        ? Math.max(1, Math.min(120, Math.round(sec)))
        : STAGE_AUTO_SEC_DEFAULT,
  };
}

const auth: AuthApi = {
  enabled: true,
  async getSession() {
    const { data } = await supabase.auth.getSession();
    const s = data.session;
    return s ? { email: s.user.email ?? "" } : null;
  },
  async signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  },
  async signOut() {
    await supabase.auth.signOut();
  },
  onChange(cb) {
    supabase.auth.onAuthStateChange((_e, session) =>
      cb(session ? { email: session.user.email ?? "" } : null),
    );
  },
};

const backend: Backend = {
  async searchGuests(q) {
    // Strip characters PostgREST treats as structure in an .or() filter string
    // (comma separates conditions; parens group; % is our own wildcard) so a
    // guest name typed into the search box can't break or extend the query.
    const term = q.trim().replace(/[%,()*\\]/g, "");
    if (!term) return [];
    const like = `%${term}%`;
    const { data } = await supabase
      .from("guests")
      .select("*")
      .or(`name.ilike.${like},company.ilike.${like}`)
      .order("status", { ascending: false }) // 'registered' sorts before 'checked_in'
      .order("name", { ascending: true })
      .limit(20);
    return ((data ?? []) as GuestRow[]).map(rowToGuest);
  },

  async checkin(body: CheckinBody) {
    let photoUrl: string | null = null;
    if (typeof body.photo === "string" && body.photo.startsWith("data:")) {
      photoUrl = await uploadDataUrl(body.photo, "face");
    }
    const { data, error } = await supabase.rpc("checkin_guest", {
      p_guest_id: body.guestId ?? null,
      p_name: body.name ?? null,
      p_company: body.company ?? null,
      p_gender: body.gender ?? "unknown",
      p_title: body.title ?? null,
      p_role: body.role ?? null,
      p_photo_url: photoUrl,
    });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as (GuestRow & { fresh: boolean }) | undefined;
    if (!row) throw new Error("check-in failed");
    return { guest: rowToGuest(row), fresh: !!row.fresh };
  },

  getStats() {
    return fetchStats();
  },

  subscribeScreen(handlers: ScreenHandlers) {
    let total = 0;

    // Initial snapshot + sponsor/text push (the local server did this on WS connect).
    void (async () => {
      const [stats, sponsors, slogan, guestFeedHidden, checkinFlowHidden, crowd] = await Promise.all([
        fetchStats(),
        fetchSponsors(),
        getSetting("slogan"),
        fetchGuestFeedHidden(),
        fetchCheckinFlowHidden(),
        supabase
          .from("guests")
          .select("*")
          .eq("status", "checked_in")
          .order("checked_in_at", { ascending: false })
          .limit(DEFAULTS.maxAvatars),
      ]);
      total = stats.total;
      handlers.onSnapshot(stats.total, stats.recent, ((crowd.data ?? []) as GuestRow[]).map(rowToGuest));
      handlers.onSponsors(sponsors.logos, sponsors.intervalSec);
      handlers.onTexts(slogan ?? DEFAULTS.slogan);
      handlers.onConfig({ guestFeedHidden, checkinFlowHidden });
    })();

    // Spawn: a guest row flips to checked_in (fresh re-scans don't update the row).
    supabase
      .channel("screen-db")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "guests", filter: "status=eq.checked_in" },
        (payload) => {
          const guest = rowToGuest(payload.new as GuestRow);
          handlers.onSpawn(guest, ++total);
        },
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "sponsors" }, () => {
        void fetchSponsors().then((s) => handlers.onSponsors(s.logos, s.intervalSec));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "settings" }, () => {
        void getSetting("slogan").then((s) => handlers.onTexts(s ?? DEFAULTS.slogan));
        void fetchSponsors().then((s) => handlers.onSponsors(s.logos, s.intervalSec));
        void fetchGuestFeedHidden().then((guestFeedHidden) => handlers.onConfig({ guestFeedHidden }));
        void fetchCheckinFlowHidden().then((checkinFlowHidden) => handlers.onConfig({ checkinFlowHidden }));
      })
      .subscribe();

    // Replay: admin re-triggers an existing guest without a DB write.
    // Reload: admin wiped all data (一键清除) — reload to rebuild from the snapshot.
    supabase
      .channel("screen", { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "replay" }, ({ payload }) => {
        handlers.onSpawn((payload as { guest: Guest }).guest, total, true);
      })
      .on("broadcast", { event: "reload" }, () => location.reload())
      .subscribe();
  },

  async qrDataUrl() {
    const origin = import.meta.env.VITE_PUBLIC_ORIGIN || location.origin;
    return QRCode.toDataURL(`${origin}/checkin`, { margin: 1, width: 512 });
  },

  async getTexts() {
    return { slogan: (await getSetting("slogan")) ?? DEFAULTS.slogan };
  },
  async setTexts(slogan) {
    const { error } = await supabase.from("settings").upsert({ key: "slogan", value: slogan });
    if (error) throw error;
  },

  listSponsors() {
    return fetchSponsors();
  },
  async addSponsor(photoDataUrl) {
    const url = await uploadDataUrl(photoDataUrl, "spon");
    if (!url) throw new Error("invalid image");
    const { data } = await supabase.from("sponsors").select("sort").order("sort", { ascending: false }).limit(1);
    const sort = ((data?.[0] as { sort: number } | undefined)?.sort ?? 0) + 1;
    const { error } = await supabase.from("sponsors").insert({ url, sort });
    if (error) throw error;
  },
  async deleteSponsor(id) {
    const { error } = await supabase.from("sponsors").delete().eq("id", id);
    if (error) throw error;
  },
  async setSponsorInterval(sec) {
    const { error } = await supabase.from("settings").upsert({ key: "sponsorIntervalSec", value: String(sec) });
    if (error) throw error;
  },

  async triggerSpawn(id) {
    const { data } = await supabase.from("guests").select("*").eq("id", id).maybeSingle();
    if (!data) return;
    await adminChannel().send({
      type: "broadcast",
      event: "replay",
      payload: { guest: rowToGuest(data as GuestRow) },
    });
  },

  getGuestFeedHidden() {
    return fetchGuestFeedHidden();
  },
  async setGuestFeedHidden(hidden) {
    const { error } = await supabase.from("settings").upsert({ key: GUEST_FEED_KEY, value: hidden ? "1" : "0" });
    if (error) throw error;
  },
  getCheckinFlowHidden() {
    return fetchCheckinFlowHidden();
  },
  async setCheckinFlowHidden(hidden) {
    const { error } = await supabase.from("settings").upsert({ key: CHECKIN_FLOW_KEY, value: hidden ? "1" : "0" });
    if (error) throw error;
  },

  async resetEvent() {
    const { error } = await supabase.rpc("reset_event");
    if (error) throw error;
    // Realtime only pushes row-level INSERT/UPDATE; a bulk DELETE won't clear the
    // screen's HUD/crowd, so tell any open screen to reload itself.
    await adminChannel().send({ type: "broadcast", event: "reload", payload: {} });
  },

  // ---- lucky draw ----
  async listPrizes() {
    const { data } = await supabase.from("prizes").select("*").order("sort").order("id");
    // 按抽奖顺序（幸运 → 三 → 二 → 特等）排，同档之间保持库里的 sort / id 次序 ——
    // 运维台的奖品下拉与列表都吃这个顺序，操作者从上往下点就是正确的流程。
    return ((data ?? []) as PrizeRow[])
      .map(rowToPrize)
      .sort((a, b) => prizeLevelRank(a.level) - prizeLevelRank(b.level));
  },
  async createPrize(input: PrizeInput) {
    const image_url = input.imageDataUrl ? await uploadDataUrl(input.imageDataUrl, "prize") : null;
    const { data, error } = await supabase
      .from("prizes")
      .insert({
        name: input.name,
        level: input.level,
        sponsor: input.sponsor ?? null,
        quantity: input.quantity,
        remaining: input.quantity, // fresh prize: all remaining
        image_url,
        sort: input.sort ?? 0,
        status: input.status ?? "active",
      })
      .select("*")
      .single();
    if (error) throw error;
    return rowToPrize(data as PrizeRow);
  },
  async updatePrize(id, input: PrizeInput) {
    const { data: cur } = await supabase
      .from("prizes")
      .select("quantity,remaining")
      .eq("id", id)
      .maybeSingle();
    const patch: Record<string, unknown> = {
      name: input.name,
      level: input.level,
      sponsor: input.sponsor ?? null,
      quantity: input.quantity,
      sort: input.sort ?? 0,
      status: input.status ?? "active",
    };
    if (cur) {
      // Apply the quantity delta to remaining, clamped to [0, quantity] so the
      // prizes_remaining_le_qty check always holds even after awards.
      const c = cur as { quantity: number; remaining: number };
      patch.remaining = Math.max(0, Math.min(input.quantity, c.remaining + (input.quantity - c.quantity)));
    }
    if (input.imageDataUrl) patch.image_url = await uploadDataUrl(input.imageDataUrl, "prize");
    const { error } = await supabase.from("prizes").update(patch).eq("id", id);
    if (error) throw error;
  },
  async deletePrize(id) {
    const { error } = await supabase.from("prizes").delete().eq("id", id);
    if (error) throw error; // FK from winners blocks deleting a prize that has winners
  },

  async drawPoolSample(limit = DRAW_DEFAULTS.reelSize) {
    const { data, error } = await supabase.rpc("draw_pool_sample", { p_limit: limit });
    if (error) throw error;
    return ((data ?? []) as { guest_id: number; name: string }[]).map((r) => r.name);
  },
  async pickWinner(prizeId) {
    const { data, error } = await supabase.rpc("draw_pick_winner", {
      p_prize_id: prizeId,
      p_operator: await operatorEmail(),
    });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as DrawWinnerRpcRow | undefined;
    if (!row) throw new Error("draw failed");
    return rpcRowToWinner(row);
  },
  async redraw(winnerId) {
    const { data, error } = await supabase.rpc("draw_redraw", {
      p_winner_id: winnerId,
      p_operator: await operatorEmail(),
    });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as DrawWinnerRpcRow | undefined;
    if (!row) throw new Error("redraw failed");
    return rpcRowToWinner(row);
  },
  async setWinnerStatus(winnerId, status) {
    const { error } = await supabase.rpc("draw_set_winner_status", {
      p_winner_id: winnerId,
      p_status: status,
      p_operator: await operatorEmail(),
    });
    if (error) throw error;
  },
  async deleteWinner(winnerId) {
    const { error } = await supabase.rpc("draw_delete_winner", {
      p_winner_id: winnerId,
      p_operator: await operatorEmail(),
    });
    if (error) throw error;
  },
  async logDraw(action, prizeId) {
    const { error } = await supabase.rpc("draw_log", {
      p_action: action,
      p_prize_id: prizeId ?? null,
      p_operator: await operatorEmail(),
    });
    if (error) throw error;
  },
  async listWinners(prizeId) {
    let q = supabase.from("winners").select("*").order("created_at", { ascending: false });
    if (prizeId != null) q = q.eq("prize_id", prizeId);
    const { data } = await q;
    return ((data ?? []) as WinnerRow[]).map(rowToWinner);
  },

  subscribeDraw(handlers: DrawHandlers) {
    supabase
      .channel(DRAW_CHANNEL, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "roll_start" }, ({ payload }) => {
        const p = payload as DrawRollStart;
        handlers.onRollStart(p.prize, p.reel, p.countdownMs);
      })
      .on("broadcast", { event: "reveal" }, ({ payload }) => {
        const p = payload as DrawReveal;
        handlers.onReveal(p.prize, p.winner);
      })
      .on("broadcast", { event: "reset" }, () => handlers.onReset())
      .on("broadcast", { event: "screen" }, () => handlers.onReturnToScreen?.())
      .subscribe();

    // Cold-load / re-sync of prizes so a freshly-opened /draw shows current state.
    if (handlers.onPrizes) {
      void backend.listPrizes().then(handlers.onPrizes);
      supabase
        .channel("draw-db")
        .on("postgres_changes", { event: "*", schema: "public", table: "prizes" }, () => {
          void backend.listPrizes().then((p) => handlers.onPrizes!(p));
        })
        .subscribe();
    }
  },
  async broadcastDraw(evt: DrawEvent) {
    await drawBroadcastChannel().send({ type: "broadcast", event: evt.type, payload: evt });
  },

  // ---- programme segments (the /screen overlay) ----
  async listSegments() {
    const { data } = await supabase.from("segments").select("*").order("sort").order("id");
    return ((data ?? []) as SegmentRow[]).map(rowToSegment);
  },
  async listHonourees(segmentId) {
    const { data } = await supabase
      .from("honourees")
      .select("*")
      .eq("segment_id", segmentId)
      .order("sort")
      .order("id");
    return ((data ?? []) as HonoureeRow[]).map(rowToHonouree);
  },
  async honoureeCounts() {
    // One flat read (~90 rows) tallied client-side — no dependency on PostgREST
    // relationship aggregates, and cheap enough to refresh on every console load.
    const { data, error } = await supabase.from("honourees").select("segment_id");
    if (error) throw error;
    const counts = new Map<number, number>();
    for (const r of (data ?? []) as { segment_id: number }[]) {
      counts.set(r.segment_id, (counts.get(r.segment_id) ?? 0) + 1);
    }
    return counts;
  },
  async markSegmentAired(id) {
    const { error } = await supabase.from("segments").update({ aired_at: Date.now() }).eq("id", id);
    if (error) throw error;
  },
  async clearAiredMarks() {
    const { error } = await supabase
      .from("segments")
      .update({ aired_at: null })
      .not("aired_at", "is", null); // a WHERE clause is required by the safeupdate guard
    if (error) throw error;
  },
  async createSegment(input: SegmentInput) {
    const { data, error } = await supabase.from("segments").insert(segmentPatch(input)).select("*").single();
    if (error) throw error;
    return rowToSegment(data as SegmentRow);
  },
  async updateSegment(id, input: SegmentInput) {
    const { error } = await supabase.from("segments").update(segmentPatch(input)).eq("id", id);
    if (error) throw error;
  },
  async setSegmentImage(id, imageDataUrl) {
    const image_url = imageDataUrl ? await uploadDataUrl(imageDataUrl, "seg") : null;
    if (imageDataUrl && !image_url) throw new Error("图片上传失败");
    const { error } = await supabase.from("segments").update({ image_url }).eq("id", id);
    if (error) throw error;
  },
  async deleteSegment(id) {
    // honourees cascade (FK on delete cascade in 0006_stage.sql).
    const { error } = await supabase.from("segments").delete().eq("id", id);
    if (error) throw error;
  },
  async addHonouree(segmentId, input: HonoureeInput) {
    // Default to the end of the list when the caller doesn't pin a sort value.
    let sort = input.sort;
    if (sort == null) {
      const { data } = await supabase
        .from("honourees")
        .select("sort")
        .eq("segment_id", segmentId)
        .order("sort", { ascending: false })
        .limit(1);
      sort = ((data?.[0] as { sort: number } | undefined)?.sort ?? 0) + 1;
    }
    const { data, error } = await supabase
      .from("honourees")
      .insert({ ...honoureePatch({ ...input, sort }), segment_id: segmentId })
      .select("*")
      .single();
    if (error) throw error;
    return rowToHonouree(data as HonoureeRow);
  },
  async updateHonouree(id, input: HonoureeInput) {
    const patch = honoureePatch(input);
    if (input.sort == null) delete patch.sort; // keep the existing position
    const { error } = await supabase.from("honourees").update(patch).eq("id", id);
    if (error) throw error;
  },
  async setHonoureePhoto(id, photoDataUrl) {
    const photo_url = photoDataUrl ? await uploadDataUrl(photoDataUrl, "portrait") : null;
    if (photoDataUrl && !photo_url) throw new Error("照片上传失败");
    const { error } = await supabase.from("honourees").update({ photo_url }).eq("id", id);
    if (error) throw error;
  },
  async deleteHonouree(id) {
    const { error } = await supabase.from("honourees").delete().eq("id", id);
    if (error) throw error;
  },
  async reorderHonourees(segmentId, orderedIds) {
    // Renumber outright (sort = 0..n-1) rather than swapping pairs: the seed data
    // and hand-edits can leave duplicate sort values, and a swap between two rows
    // that already tie does nothing. Lists are ≤ 24 rows, so a full renumber is
    // cheap and always lands in exactly the order the console showed.
    const results = await Promise.all(
      orderedIds.map((id, i) =>
        supabase.from("honourees").update({ sort: i }).eq("id", id).eq("segment_id", segmentId),
      ),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) throw failed.error;
  },

  getStageState() {
    return fetchStageState();
  },
  async setStageState(state: StageState) {
    // Write only the keys that actually changed: each settings row update is a
    // realtime event for every open big screen, and "下一位" should cost exactly one.
    const cur = await fetchStageState();
    const rows: { key: string; value: string }[] = [];
    if (cur.active !== state.active) rows.push({ key: STAGE_KEYS.active, value: state.active ? "1" : "0" });
    if (cur.segmentId !== state.segmentId)
      rows.push({ key: STAGE_KEYS.segmentId, value: state.segmentId == null ? "" : String(state.segmentId) });
    if (cur.index !== state.index) rows.push({ key: STAGE_KEYS.index, value: String(state.index) });
    if (cur.volume !== state.volume) rows.push({ key: STAGE_KEYS.volume, value: String(state.volume) });
    if (cur.autoSec !== state.autoSec) rows.push({ key: STAGE_KEYS.autoSec, value: String(state.autoSec) });
    if (!rows.length) return;
    const { error } = await supabase.from("settings").upsert(rows);
    if (error) throw error;
  },

  subscribeStage(handlers: StageHandlers) {
    // Cue changes arrive as settings row updates. Each one re-reads the whole
    // stage state (cheap, 3 rows) plus the live segment and its honourees, so a
    // freshly-opened or reloaded /screen recovers with no extra code path.
    let seq = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    /** Coalesce bursts (a reorder writes one row per honouree) into one refresh. */
    const schedule = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void push();
      }, 80);
    };
    const push = async (): Promise<void> => {
      const mine = ++seq;
      const state = await fetchStageState();
      let segment: Segment | null = null;
      let honourees: Honouree[] = [];
      if (state.segmentId != null) {
        const { data } = await supabase.from("segments").select("*").eq("id", state.segmentId).maybeSingle();
        segment = data ? rowToSegment(data as SegmentRow) : null;
        if (segment) honourees = await backend.listHonourees(segment.id);
      }
      // Rapid cues (operator holding →) can resolve out of order; drop stale ones.
      if (mine !== seq) return;
      handlers.onState(state, segment, honourees);
    };
    void push();

    const ch = supabase.channel("stage-db");
    for (const key of [STAGE_KEYS.active, STAGE_KEYS.segmentId, STAGE_KEYS.index, STAGE_KEYS.volume]) {
      ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "settings", filter: `key=eq.${key}` },
        schedule,
      );
    }
    // Live edits from the console (renamed / added / reordered honourees).
    ch.on("postgres_changes", { event: "*", schema: "public", table: "honourees" }, schedule);
    ch.on("postgres_changes", { event: "*", schema: "public", table: "segments" }, schedule);
    ch.subscribe();
  },

  auth,
};

export default backend;
