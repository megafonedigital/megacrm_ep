// Idempotent BR phone normalizer + deduper.
// - Normalizes wa_id/phone to E.164 (with BR 9th digit for mobile).
// - Deduplicates contacts whose wa_id only differs by the 9th digit
//   (BR mobile 12 vs 13 digits) using the canonical 13-digit key.
import { Client } from "pg";
import { toE164, toE164Digits, waIdLookupVariants } from "../src/lib/phone";

const c = new Client();
await c.connect();

const { rows } = await c.query(
  "SELECT id, brand_id, wa_id, phone, created_at FROM contacts ORDER BY created_at ASC",
);
console.log(`Loaded ${rows.length} contacts`);

// Canonical key = the 13-digit BR mobile form when applicable, else normalized digits.
function canonicalKey(waOrPhone: string | null): string | null {
  const variants = waIdLookupVariants(waOrPhone);
  if (!variants.length) return null;
  // Pick the longest variant (13-digit BR mobile beats 12-digit form).
  return variants.sort((a, b) => b.length - a.length)[0];
}

const byKey = new Map<string, { keep: any; dups: any[] }>();
let normalizedCount = 0;
let skipped = 0;
for (const r of rows) {
  if (typeof r.wa_id === "string" && r.wa_id.startsWith("email:")) {
    skipped++;
    continue;
  }
  const newWa = toE164Digits(r.wa_id ?? r.phone);
  const key = canonicalKey(r.wa_id ?? r.phone);
  if (!newWa || !key) {
    skipped++;
    continue;
  }
  if (newWa !== r.wa_id) normalizedCount++;
  const k = `${r.brand_id}::${key}`;
  const existing = byKey.get(k);
  if (existing) existing.dups.push({ ...r, _newWa: key });
  else byKey.set(k, { keep: { ...r, _newWa: key }, dups: [] });
}

let dupGroups = 0;
for (const v of byKey.values()) if (v.dups.length) dupGroups++;
console.log(`Normalize candidates: ${normalizedCount}, skipped: ${skipped}, dup groups: ${dupGroups}`);

await c.query("BEGIN");
try {
  // Step 1: For each dup pair, merge conversations on the same channel first.
  for (const { keep, dups } of byKey.values()) {
    for (const d of dups) {
      const { rows: convs } = await c.query(
        `SELECT ck.id AS keep_conv, cd.id AS drop_conv
         FROM conversations ck
         JOIN conversations cd
           ON cd.contact_id = $2 AND cd.channel_id = ck.channel_id AND cd.id <> ck.id
         WHERE ck.contact_id = $1`,
        [keep.id, d.id],
      );
      for (const cv of convs) {
        await c.query(
          "SELECT public.merge_conversation_duplicates($1::uuid, $2::uuid)",
          [cv.keep_conv, cv.drop_conv],
        );
      }
      await c.query(
        "SELECT public.merge_contact_duplicates($1::uuid, $2::uuid)",
        [keep.id, d.id],
      );
    }
  }

  // Step 2: Normalize wa_id/phone on kept contacts.
  let updated = 0;
  for (const { keep } of byKey.values()) {
    const newWa = keep._newWa as string;
    const newPhone = toE164(newWa);
    if (newWa === keep.wa_id && newPhone === keep.phone) continue;
    await c.query(
      "UPDATE contacts SET wa_id=$1, phone=$2, updated_at=now() WHERE id=$3",
      [newWa, newPhone, keep.id],
    );
    updated++;
  }

  await c.query("COMMIT");
  console.log(`Updated ${updated} contacts; merged ${dupGroups} duplicate groups`);
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
}

await c.end();
