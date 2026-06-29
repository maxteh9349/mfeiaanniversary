import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AVATAR_MODEL_COUNT, DEFAULTS } from "../shared/config.ts";
import type { Gender, Guest, SponsorLogo } from "../shared/events.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../data/event.sqlite");

mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");

db.exec(`
  CREATE TABLE IF NOT EXISTS guests (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    company      TEXT,
    gender       TEXT NOT NULL DEFAULT 'unknown',
    role         TEXT,
    avatar_id    INTEGER,
    status       TEXT NOT NULL DEFAULT 'registered', -- registered | checked_in
    checked_in_at INTEGER,
    created_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );
  CREATE TABLE IF NOT EXISTS checkins (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guest_id   INTEGER NOT NULL REFERENCES guests(id),
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_guests_status ON guests(status);
  CREATE TABLE IF NOT EXISTS sponsors (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    url        TEXT NOT NULL,
    sort       INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Add columns to existing databases (ignored if the column already exists).
try {
  db.exec("ALTER TABLE guests ADD COLUMN photo_url TEXT");
} catch {
  /* column already present */
}
try {
  db.exec("ALTER TABLE guests ADD COLUMN title TEXT");
} catch {
  /* column already present */
}

interface GuestRow {
  id: number;
  name: string;
  company: string | null;
  gender: string;
  title: string | null;
  role: string | null;
  avatar_id: number | null;
  photo_url: string | null;
  status: string;
  checked_in_at: number | null;
}

function rowToGuest(r: GuestRow): Guest {
  return {
    id: r.id,
    name: r.name,
    company: r.company,
    gender: (r.gender as Gender) ?? "unknown",
    title: r.title ?? null,
    role: r.role,
    avatarId: r.avatar_id ?? pickAvatar(r.gender as Gender),
    photoUrl: r.photo_url ?? null,
    checkedInAt: r.checked_in_at ?? Date.now(),
  };
}

/** Random avatar assignment from the available model set. */
export function pickAvatar(gender: Gender): number {
  // Models 0..N-1. Simple random; later we can map gender -> model subsets.
  void gender;
  return Math.floor(Math.random() * AVATAR_MODEL_COUNT);
}

const stmt = {
  insertGuest: db.prepare(
    `INSERT INTO guests (name, company, gender, title, role, photo_url, status)
     VALUES (@name, @company, @gender, @title, @role, @photoUrl, 'registered')`,
  ),
  setPhoto: db.prepare(`UPDATE guests SET photo_url = @url WHERE id = @id`),
  search: db.prepare(
    `SELECT * FROM guests
     WHERE name LIKE @q OR company LIKE @q
     ORDER BY (status = 'registered') DESC, name ASC
     LIMIT 20`,
  ),
  byId: db.prepare(`SELECT * FROM guests WHERE id = ?`),
  findByNameCompany: db.prepare(
    `SELECT * FROM guests
     WHERE lower(trim(name)) = lower(trim(@name))
       AND lower(trim(COALESCE(company, ''))) = lower(trim(@company))
     ORDER BY id ASC LIMIT 1`,
  ),
  markCheckedIn: db.prepare(
    `UPDATE guests
     SET status = 'checked_in', checked_in_at = @ts, avatar_id = @avatarId
     WHERE id = @id`,
  ),
  insertCheckin: db.prepare(
    `INSERT INTO checkins (guest_id, created_at) VALUES (?, ?)`,
  ),
  total: db.prepare(`SELECT COUNT(*) AS n FROM guests WHERE status = 'checked_in'`),
  recent: db.prepare(
    `SELECT * FROM guests WHERE status = 'checked_in'
     ORDER BY checked_in_at DESC LIMIT ?`,
  ),
};

export function searchGuests(q: string): Guest[] {
  const like = `%${q.trim()}%`;
  return (stmt.search.all({ q: like }) as unknown as GuestRow[]).map(rowToGuest);
}

export function getGuest(id: number): Guest | null {
  const row = stmt.byId.get(id) as unknown as GuestRow | undefined;
  return row ? rowToGuest(row) : null;
}

/** Find an existing guest by name + company (case-insensitive, trimmed). */
export function findGuest(name: string, company?: string | null): Guest | null {
  const row = stmt.findByNameCompany.get({ name, company: company ?? "" }) as unknown as GuestRow | undefined;
  return row ? rowToGuest(row) : null;
}

/** Create a walk-in guest record (not pre-registered). Returns new id. */
export function createGuest(input: {
  name: string;
  company?: string | null;
  gender?: Gender;
  title?: string | null;
  role?: string | null;
  photoUrl?: string | null;
}): number {
  const info = stmt.insertGuest.run({
    name: input.name.trim(),
    company: input.company?.trim() || null,
    gender: input.gender ?? "unknown",
    title: input.title?.trim() || null,
    role: input.role?.trim() || null,
    photoUrl: input.photoUrl ?? null,
  });
  return Number(info.lastInsertRowid);
}

/** Set/replace a guest's photo URL. */
export function setGuestPhoto(id: number, url: string): void {
  stmt.setPhoto.run({ id, url });
}

/**
 * Mark a guest checked in (idempotent: a guest already checked in returns the
 * existing record without creating a duplicate checkin row). Returns the guest
 * and whether this was a fresh check-in.
 */
export function checkIn(id: number): { guest: Guest; fresh: boolean } | null {
  const existing = stmt.byId.get(id) as unknown as GuestRow | undefined;
  if (!existing) return null;
  if (existing.status === "checked_in") {
    return { guest: rowToGuest(existing), fresh: false };
  }
  const ts = Date.now();
  const avatarId = pickAvatar((existing.gender as Gender) ?? "unknown");
  db.exec("BEGIN");
  try {
    stmt.markCheckedIn.run({ id, ts, avatarId });
    stmt.insertCheckin.run(id, ts);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return { guest: rowToGuest(stmt.byId.get(id) as unknown as GuestRow), fresh: true };
}

export function getTotal(): number {
  return (stmt.total.get() as unknown as { n: number }).n;
}

export function getRecent(limit: number): Guest[] {
  return (stmt.recent.all(limit) as unknown as GuestRow[]).map(rowToGuest);
}

// ---- sponsors + settings --------------------------------------------------
const sponsorStmt = {
  list: db.prepare(`SELECT id, url FROM sponsors ORDER BY sort ASC, id ASC`),
  add: db.prepare(`INSERT INTO sponsors (url, sort) VALUES (@url, @sort)`),
  del: db.prepare(`DELETE FROM sponsors WHERE id = ?`),
  maxSort: db.prepare(`SELECT COALESCE(MAX(sort), 0) AS n FROM sponsors`),
  getSetting: db.prepare(`SELECT value FROM settings WHERE key = ?`),
  setSetting: db.prepare(
    `INSERT INTO settings (key, value) VALUES (@key, @value)
     ON CONFLICT(key) DO UPDATE SET value = @value`,
  ),
};

export function listSponsors(): SponsorLogo[] {
  return sponsorStmt.list.all() as unknown as SponsorLogo[];
}

/** Append a sponsor logo (kept after existing ones). Returns new id. */
export function addSponsor(url: string): number {
  const sort = (sponsorStmt.maxSort.get() as unknown as { n: number }).n + 1;
  const info = sponsorStmt.add.run({ url, sort });
  return Number(info.lastInsertRowid);
}

export function deleteSponsor(id: number): void {
  sponsorStmt.del.run(id);
}

export function getSponsorIntervalSec(): number {
  const row = sponsorStmt.getSetting.get("sponsorIntervalSec") as unknown as { value: string } | undefined;
  const n = row ? Number(row.value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULTS.sponsorIntervalSec;
}

export function setSponsorIntervalSec(sec: number): void {
  sponsorStmt.setSetting.run({ key: "sponsorIntervalSec", value: String(sec) });
}

export function getSlogan(): string {
  const row = sponsorStmt.getSetting.get("slogan") as unknown as { value: string } | undefined;
  return row?.value ?? DEFAULTS.slogan;
}

export function setSlogan(text: string): void {
  sponsorStmt.setSetting.run({ key: "slogan", value: text });
}

export default db;
