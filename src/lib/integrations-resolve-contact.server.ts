// Resolve ou cria um contato no MegaCRM a partir de telefone e/ou email
// e/ou IDs externos (ActiveCampaign).
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { toE164, toE164Digits, waIdLookupVariants } from "./phone";

export async function resolveOrCreateContact(
  brandId: string,
  input: {
    phone?: string | null;
    email?: string | null;
    name?: string | null;
    externalIds?: { activecampaign?: string | null };
  },
): Promise<string | null> {
  const waId = toE164Digits(input.phone) ?? "";
  const phoneE164 = toE164(input.phone);
  const email = (input.email ?? "").trim().toLowerCase() || null;
  const acId = (input.externalIds?.activecampaign ?? "").trim() || null;

  // 1. by ActiveCampaign contact id (1:1, exato)
  if (acId) {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select("id")
      .eq("brand_id", brandId)
      .filter("metadata->>activecampaign_id", "eq", acId)
      .limit(1)
      .maybeSingle();
    if (data) return data.id;
  }

  // 2. by phone (considera variantes BR com/sem o 9)
  if (waId && waId.length >= 8) {
    const variants = waIdLookupVariants(input.phone);
    if (variants.length) {
      const { data } = await supabaseAdmin
        .from("contacts")
        .select("id, metadata")
        .eq("brand_id", brandId)
        .in("wa_id", variants)
        .limit(1)
        .maybeSingle();
      if (data) {
        await maybeLinkAcId(data.id, (data as any).metadata, acId);
        return data.id;
      }
    }
  }

  // 3. by email in metadata
  if (email) {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select("id, metadata")
      .eq("brand_id", brandId)
      .filter("metadata->>email", "eq", email)
      .limit(1)
      .maybeSingle();
    if (data) {
      await maybeLinkAcId(data.id, (data as any).metadata, acId);
      return data.id;
    }
  }

  // 4. create
  if (!waId && !email) return null;
  const meta: Record<string, unknown> = {};
  if (email) meta.email = email;
  if (acId) meta.activecampaign_id = acId;
  const insertRow: any = {
    brand_id: brandId,
    wa_id: waId || `email:${email}`,
    phone: phoneE164,
    name: input.name ?? null,
    metadata: meta,
  };
  const { data, error } = await supabaseAdmin
    .from("contacts")
    .insert(insertRow)
    .select("id")
    .single();
  if (error || !data) {
    console.error("[integrations] create contact failed:", error?.message);
    return null;
  }
  return data.id;
}

async function maybeLinkAcId(contactId: string, existingMeta: any, acId: string | null) {
  if (!acId) return;
  const meta = (existingMeta ?? {}) as Record<string, unknown>;
  if (meta.activecampaign_id) return;
  const merged = { ...meta, activecampaign_id: acId };
  await supabaseAdmin
    .from("contacts")
    .update({ metadata: merged, updated_at: new Date().toISOString() })
    .eq("id", contactId);
}
