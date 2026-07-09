// Núcleo de processamento de importação de contatos — reutilizado pelo worker
// de drain. Recebe um array já preparado de linhas (mesma forma esperada pelo
// front: { _rowIndex, name?, phone?, wa_id?, email?, activecampaign_id?, custom }).
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { toE164, toE164Digits } from "./phone";

export type ImportRow = {
  _rowIndex: number;
  name?: string | null;
  profile_name?: string | null;
  phone?: string | null;
  wa_id?: string | null;
  email?: string | null;
  activecampaign_id?: string | null;
  custom?: Record<string, any>;
};

export type ImportBatchResult = {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; reason: string }>;
  affectedIds: string[];
};

export async function processImportBatch(
  brandId: string,
  rows: ImportRow[],
  opts: { updateExisting: boolean; tagIds: string[] },
): Promise<ImportBatchResult> {
  const errors: Array<{ row: number; reason: string }> = [];
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
  for (const r of rows) {
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

  if (prepared.length === 0) return { created, updated, skipped, errors, affectedIds };

  const byWa = new Map<string, Prepared>();
  for (const p of prepared) byWa.set(p.wa_id, p);

  const waIds = Array.from(byWa.keys());
  const existingMap = new Map<string, { id: string; metadata: any; name: string | null; profile_name: string | null; phone: string | null }>();
  const { data: existing, error: exErr } = await supabaseAdmin
    .from("contacts")
    .select("id, wa_id, metadata, name, profile_name, phone")
    .eq("brand_id", brandId)
    .in("wa_id", waIds);
  if (exErr) {
    errors.push({ row: -1, reason: `Falha ao consultar contatos existentes: ${exErr.message}` });
    return { created, updated, skipped, errors, affectedIds };
  }
  for (const e of existing ?? []) existingMap.set((e as any).wa_id, e as any);

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
      if (!opts.updateExisting) {
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
        brand_id: brandId,
        wa_id: p.wa_id,
        phone: p.phone,
        name: p.name,
        profile_name: p.profile_name,
        metadata: meta,
      });
    }
  }

  if (toInsert.length > 0) {
    const { data: ins, error } = await supabaseAdmin
      .from("contacts")
      .insert(toInsert)
      .select("id");
    if (error) {
      errors.push({ row: -1, reason: `Falha ao criar lote (${toInsert.length}): ${error.message}` });
    } else {
      created += ins?.length ?? 0;
      for (const r of ins ?? []) affectedIds.push((r as any).id);
    }
  }

  // Atualiza em massa via upsert (1 round-trip) em vez de N UPDATEs sequenciais,
  // que estouravam o limite de wall-time do worker para lotes grandes.
  if (toUpdate.length > 0) {
    const upsertRows = toUpdate.map((u) => ({
      id: u.id,
      brand_id: brandId,
      wa_id: u.wa_id,
      ...u.patch,
    }));
    const { error } = await supabaseAdmin
      .from("contacts")
      .upsert(upsertRows, { onConflict: "id" });
    if (error) {
      errors.push({ row: -1, reason: `Falha ao atualizar lote (${toUpdate.length}): ${error.message}` });
    } else {
      updated += toUpdate.length;
      for (const u of toUpdate) affectedIds.push(u.id);
    }
  }

  // Aplica as tags em massa (1 upsert). NÃO dispara automações 'tag_added'
  // durante importação em massa: isso fazia N chamadas HTTP sequenciais à
  // automation-engine (uma por contato), travando o worker. Se o usuário
  // precisar disparar fluxos para a lista, deve usar Broadcast/Automação.
  if (opts.tagIds.length > 0 && affectedIds.length > 0) {
    const tagRows: { contact_id: string; tag_id: string }[] = [];
    for (const cid of affectedIds) {
      for (const tid of opts.tagIds) {
        tagRows.push({ contact_id: cid, tag_id: tid });
      }
    }
    const { error: tagErr } = await supabaseAdmin
      .from("contact_tags")
      .upsert(tagRows, { onConflict: "contact_id,tag_id", ignoreDuplicates: true });
    if (tagErr) errors.push({ row: -1, reason: `Falha ao aplicar tags: ${tagErr.message}` });
  }

  return { created, updated, skipped, errors, affectedIds };
}
