// Import a pre-registration (RSVP) list into the guests table.
//   npm run import -- data/guests.csv
// Expected columns (header row, case-insensitive): name, company, gender, role.
// Only `name` is required. Re-running skips rows whose (name, company) already
// exist, so it is safe to import an updated list.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "csv-parse/sync";
import db, { createGuest } from "./db.ts";
import type { Gender } from "../shared/events.ts";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npm run import -- <path-to.csv>");
  process.exit(1);
}

const raw = readFileSync(resolve(process.cwd(), file), "utf8");
const records = parse(raw, {
  columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
  skip_empty_lines: true,
  trim: true,
}) as Record<string, string>[];

const existsStmt = db.prepare(
  `SELECT id FROM guests WHERE name = ? AND IFNULL(company,'') = ?`,
);

function normGender(v?: string): Gender {
  const s = (v ?? "").toLowerCase();
  if (["m", "male", "男"].includes(s)) return "male";
  if (["f", "female", "女"].includes(s)) return "female";
  return "unknown";
}

let added = 0;
let skipped = 0;
for (const row of records) {
  const name = (row.name ?? "").trim();
  if (!name) {
    skipped++;
    continue;
  }
  const company = (row.company ?? "").trim();
  if (existsStmt.get(name, company)) {
    skipped++;
    continue;
  }
  createGuest({
    name,
    company: company || null,
    gender: normGender(row.gender),
    role: (row.role ?? "").trim() || null,
  });
  added++;
}

console.log(`Imported ${added} guest(s), skipped ${skipped} (empty/duplicate).`);
