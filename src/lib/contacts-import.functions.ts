import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { toE164, toE164Digits } from "./phone";

const RowSchema = z.object({
  name: z.string().nullish(),
  profile_name: z.string().nullish(),
  phone: z.string().nullish(),
  wa_id: z.string().nullish(),
  email: z.string().nullish(),
  activecampaign_id: z.string().nullish(),
  custom: z.record(z.string(), z.any()).default({}),
  _rowIndex: z.number().int().nonnegative(),
});

const Input = z.object({
  brandId: z.string().uuid(),
  rows: z.array(RowSchema).min(1).max(2000),
  tagIds: z.array(z.string().uuid()).max(50).default([]),
  updateExisting: z.boolean().default(false),
});

export const importContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }) => {
    const { userId } = context;

    const { data: access } = await supabaseAdmin.rpc("has_brand_access", {
      _user_id: userId,
      _brand_id: data.brandId,
    });
    if (!access) throw new Error("Sem acesso a este workspace.");

    type Err = { row: number; reason: string };
    const errors: Err[] = [];
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const affectedIds: string[] = [];

    type Prepared = {
      _rowIndex: number;
      wa_id: string;
      phone: string | null;
      name: string | null;
      profile_name: string | null;
      email: string | null;
      activecampaign_id: string | null;
      custom: Record<string, any>;
    };
    const prepared: Prepared[] = [];
    for (const r of data.rows) {
      const rawPhone = (r.phone ?? "").toString().trim();
      const rawWa = (r.wa_id ?? "").toString().trim();
      const waId = rawWa ? rawWa.replace(/\D/g, "") : (toE164Digits(rawPhone) ?? "");
      const phoneE164 = toE164(rawPhone || rawWa);
      if (!waId || waId.length < 8) {
        errors.push({ row: r._rowIndex, reason: "Telefone/WhatsApp inválido" });
        continue;
      }
      prepared.push({
        _rowIndex: r._rowIndex,
        wa_id: waId,
        phone: phoneE164,
        name: (r.name ?? "").toString().trim() || null,
        profile_name: (r.profile_name ?? "").toString().trim() || null,
        email: ((r.email ?? "").toString().trim().toLowerCase()) || null,
        activecampaign_id: (r.activecampaign_id ?? "").toString().trim() || null,
        custom: r.custom ?? {},
      });
    }

    if (prepared.length === 0) {
      return { created: 0, updated: 0, skipped: 0, errors, taggedContactIds: [] as string[] };
    }

    // dedup within file (last wins) + remember original row index for errors
    const byWa = new Map<string, Prepared>();
    for (const p of prepared) byWa.set(p.wa_id, p);

    const chunk = <T,>(arr: T[], n: number) => {
      const out: T[][] = [];
      for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
      return out;
    };

    // fetch existing
    const waIds = Array.from(byWa.keys());
    const existingMap = new Map<string, { id: string; metadata: any; name: string | null; profile_name: string | null; phone: string | null }>();
    for (const slice of chunk(waIds, 500)) {
      const { data: existing, error } = await supabaseAdmin
        .from("contacts")
        .select("id, wa_id, metadata, name, profile_name, phone")
        .eq("brand_id", data.brandId)
        .in("wa_id", slice);
      if (error) throw new Error(error.message);
      for (const e of existing ?? []) existingMap.set((e as any).wa_id, e as any);
    }

    const toInsert: any[] = [];
    const toUpdate: { id: string; patch: any; rowIndex: number; wa_id: string }[] = [];

    for (const p of byWa.values()) {
      const ex = existingMap.get(p.wa_id);
      const meta: Record<string, any> = {};
      if (p.email) meta.email = p.email;
      if (p.activecampaign_id) meta.activecampaign_id = p.activecampaign_id;
      const customObj: Record<string, any> = {};
      for (const [k, v] of Object.entries(p.custom)) {
        if (v === undefined || v === null || v === "") continue;
        customObj[k] = v;
      }
      if (Object.keys(customObj).length > 0) meta.custom = customObj;

      if (ex) {
        if (!data.updateExisting) {
          skipped++;
          affectedIds.push(ex.id);
          continue;
        }
        const exMeta = (ex.metadata ?? {}) as Record<string, any>;
        const mergedCustom = { ...((exMeta.custom ?? {}) as Record<string, any>), ...customObj };
        const mergedMeta: Record<string, any> = { ...exMeta, ...meta };
        if (Object.keys(mergedCustom).length > 0) mergedMeta.custom = mergedCustom;
        toUpdate.push({
          id: ex.id,
          patch: {
            name: p.name ?? ex.name,
            profile_name: p.profile_name ?? ex.profile_name,
            phone: p.phone ?? ex.phone,
            metadata: mergedMeta,
            updated_at: new Date().toISOString(),
          },
          rowIndex: p._rowIndex,
          wa_id: p.wa_id,
        });

      } else {
        toInsert.push({
          brand_id: data.brandId,
          wa_id: p.wa_id,
          phone: p.phone,
          name: p.name,
          profile_name: p.profile_name,
          metadata: meta,
        });
      }
    }

    for (const slice of chunk(toInsert, 500)) {
      const { data: ins, error } = await supabaseAdmin
        .from("contacts")
        .insert(slice)
        .select("id");
      if (error) {
        for (const row of slice) {
          errors.push({ row: -1, reason: `Falha ao criar (${row.wa_id}): ${error.message}` });
        }
        continue;
      }
      created += ins?.length ?? 0;
      for (const r of ins ?? []) affectedIds.push((r as any).id);
    }

    for (const u of toUpdate) {
      const { error } = await supabaseAdmin
        .from("contacts")
        .update(u.patch)
        .eq("id", u.id);
      if (error) {
        errors.push({ row: u.rowIndex, reason: `Falha ao atualizar: ${error.message}` });
      } else {
        updated++;
        affectedIds.push(u.id);
      }
    }

    if (data.tagIds.length > 0 && affectedIds.length > 0) {
      // Detect which (contact, tag) pairs already exist so we only fire
      // `tag_added` events for newly-applied tags.
      const existingPairs = new Set<string>();
      for (const slice of chunk(affectedIds, 500)) {
        const { data: existingTagRows } = await supabaseAdmin
          .from("contact_tags")
          .select("contact_id, tag_id")
          .in("contact_id", slice)
          .in("tag_id", data.tagIds);
        for (const r of existingTagRows ?? []) {
          existingPairs.add(`${(r as any).contact_id}:${(r as any).tag_id}`);
        }
      }

      const tagRows: any[] = [];
      const newPairs: { contact_id: string; tag_id: string }[] = [];
      for (const cid of affectedIds) {
        for (const tid of data.tagIds) {
          tagRows.push({ contact_id: cid, tag_id: tid });
          if (!existingPairs.has(`${cid}:${tid}`)) {
            newPairs.push({ contact_id: cid, tag_id: tid });
          }
        }
      }
      for (const slice of chunk(tagRows, 1000)) {
        const { error } = await supabaseAdmin
          .from("contact_tags")
          .upsert(slice, { onConflict: "contact_id,tag_id", ignoreDuplicates: true });
        if (error) {
          errors.push({ row: -1, reason: `Falha ao aplicar tags: ${error.message}` });
        }
      }

      // Fire `tag_added` events for newly-applied tags so automations with
      // trigger_type='tag' run (matches behavior of ContactDetailDialog and
      // the public /v1/contacts(/:id/tags) endpoints).
      if (newPairs.length > 0) {
        const { data: tagRowsMeta } = await supabaseAdmin
          .from("tags")
          .select("id, name")
          .in("id", data.tagIds);
        const tagNameById = new Map<string, string>();
        for (const t of tagRowsMeta ?? []) tagNameById.set((t as any).id, (t as any).name);

        const fnUrl = `${process.env.SUPABASE_URL}/functions/v1/automation-engine`;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
        const dispatches = newPairs
          .map((p) => ({ p, tagName: tagNameById.get(p.tag_id) }))
          .filter((x): x is { p: { contact_id: string; tag_id: string }; tagName: string } => !!x.tagName);

        const CONCURRENCY = 8;
        for (let i = 0; i < dispatches.length; i += CONCURRENCY) {
          const batch = dispatches.slice(i, i + CONCURRENCY);
          const results = await Promise.allSettled(
            batch.map(({ p, tagName }) =>
              fetch(fnUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
                body: JSON.stringify({ event: "tag_added", contact_id: p.contact_id, tag: tagName }),
              }).then((r) => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r;
              })
            )
          );
          results.forEach((res, idx) => {
            if (res.status === "rejected") {
              const { p } = batch[idx];
              errors.push({
                row: -1,
                reason: `Falha ao disparar automação (contato ${p.contact_id}): ${(res.reason as Error)?.message ?? "erro"}`,
              });
            }
          });
        }
      }

    }


    return { created, updated, skipped, errors, taggedContactIds: affectedIds };
  });
