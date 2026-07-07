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
  Prize,
  SponsorLogo,
  Winner,
  WinnerStatus,
} from "../../shared/events.ts";
import { DRAW_CHANNEL } from "../../shared/events.ts";
import { AVATAR_MODEL_COUNT, DEFAULTS, DRAW_DEFAULTS } from "../../shared/config.ts";
import type { AuthApi, Backend, CheckinBody, DrawHandlers, PrizeInput, ScreenHandlers } from "./backend.ts";
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
      const [stats, sponsors, slogan, crowd] = await Promise.all([
        fetchStats(),
        fetchSponsors(),
        getSetting("slogan"),
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
      })
      .subscribe();

    // Replay: admin re-triggers an existing guest without a DB write.
    supabase
      .channel("screen", { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "replay" }, ({ payload }) => {
        handlers.onSpawn((payload as { guest: Guest }).guest, total, true);
      })
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

  // ---- lucky draw ----
  async listPrizes() {
    const { data } = await supabase.from("prizes").select("*").order("sort").order("id");
    return ((data ?? []) as PrizeRow[]).map(rowToPrize);
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

  auth,
};

export default backend;
