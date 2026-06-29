// One-off utility: clear all guests + check-ins (keeps sponsors & settings).
// Run with:  npx tsx server/reset-guests.ts
import db from "./db.ts";

const before = (db.prepare("SELECT COUNT(*) AS n FROM guests").get() as { n: number }).n;
db.exec("DELETE FROM checkins; DELETE FROM guests;");
console.log(`Cleared ${before} guest(s) and all check-ins. Sponsors/settings kept.`);
