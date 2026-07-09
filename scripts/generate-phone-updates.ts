import { Client } from "pg";
import { writeFileSync } from "fs";
import { toE164, toE164Digits } from "../src/lib/phone";

const c = new Client();
await c.connect();
const { rows } = await c.query("SELECT id, brand_id, wa_id, phone FROM contacts");
await c.end();

const updates: string[] = [];
let skipped = 0;
for (const r of rows) {
  if (typeof r.wa_id === "string" && r.wa_id.startsWith("email:")) { skipped++; continue; }
  const newWa = toE164Digits(r.wa_id ?? r.phone);
  const newPhone = toE164(r.wa_id ?? r.phone);
  if (!newWa) { skipped++; continue; }
  if (newWa === r.wa_id && newPhone === r.phone) continue;
  const safeWa = newWa.replace(/'/g, "''");
  const safePhone = newPhone ? `'${newPhone.replace(/'/g, "''")}'` : "NULL";
  updates.push(`UPDATE contacts SET wa_id='${safeWa}', phone=${safePhone} WHERE id='${r.id}';`);
}
const sql = updates.join("\n");
writeFileSync("/tmp/normalize-phones.sql", sql);
console.log(`Generated ${updates.length} updates, skipped ${skipped}`);
console.log(`Wrote /tmp/normalize-phones.sql (${sql.length} bytes)`);
