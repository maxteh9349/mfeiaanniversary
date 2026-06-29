// Supabase backend: Postgres (via the checkin_guest RPC + table reads), Storage
// for photos/logos, Realtime for screen spawns, and Auth for the admin gate.
// Mirrors the local backend's observable behaviour (see backend.local.ts).

import QRCode from "qrcode";
import type { Gender, Guest, SponsorLogo } from "../../shared/events.ts";
import { AVATAR_MODEL_COUNT, DEFAULTS } from "../../shared/config.ts";
import type { AuthApi, Backend, CheckinBody, ScreenHandlers } from "./backend.ts";
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
    const like = `%${q.trim()}%`;
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

  auth,
};

export default backend;
