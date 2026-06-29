// Import a pre-registration (RSVP) list into the Supabase guests table.
//   npm run import:supabase -- data/guests.csv
// Columns (header row, case-insensitive): name, company, gender, role. Only
// `name` is required. Re-running skips rows whose (name, company) already exist.
//
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (read from .env or the
// environment). The service-role key bypasses RLS and must never ship to the
// browser — keep it out of any VITE_-prefixed variable.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";
import type { Gender } from "../shared/events.ts";

// Minimal .env loader (no dependency) so `npm run import:supabase` just works.
function loadEnv(): void {
  try {
    const txt = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(line);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* no .env — rely on real environment variables */
  }
}
loadEnv();

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (in .env or environment).");
  process.exit(1);
}

const file = process.argv[2];
if (!file) {
  console.error("Usage: npm run import:supabase -- <path-to.csv>");
  process.exit(1);
}

function normGender(v?: string): Gender {
  const s = (v ?? "").toLowerCase();
  if (["m", "male", "男"].includes(s)) return "male";
  if (["f", "female", "女"].includes(s)) return "female";
  return "unknown";
}
const dedupKey = (name: string, company: string) =>
  `${name.trim().toLowerCase()}|${company.trim().toLowerCase()}`;

const supabase = createClient(url, key, { auth: { persistSession: false } });

const raw = readFileSync(resolve(process.cwd(), file), "utf8");
const records = parse(raw, {
  columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
  skip_empty_lines: true,
  trim: true,
}) as Record<string, string>[];

const { data: existing, error: readErr } = await supabase.from("guests").select("name,company");
if (readErr) {
  console.error("Failed to read existing guests:", readErr.message);
  process.exit(1);
}
const seen = new Set((existing ?? []).map((r) => dedupKey(r.name ?? "", r.company ?? "")));

const rows: { name: string; company: string | null; gender: Gender; role: string | null; status: string }[] = [];
let skipped = 0;
for (const row of records) {
  const name = (row.name ?? "").trim();
  const company = (row.company ?? "").trim();
  if (!name || seen.has(dedupKey(name, company))) {
    skipped++;
    continue;
  }
  seen.add(dedupKey(name, company));
  rows.push({
    name,
    company: company || null,
    gender: normGender(row.gender),
    role: (row.role ?? "").trim() || null,
    status: "registered",
  });
}

if (rows.length) {
  const { error } = await supabase.from("guests").insert(rows);
  if (error) {
    console.error("Insert failed:", error.message);
    process.exit(1);
  }
}
console.log(`Imported ${rows.length} guest(s), skipped ${skipped} (empty/duplicate).`);
