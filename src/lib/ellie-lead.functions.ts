import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertBrandAccess(userId: string, brandId: string) {
  const { data, error } = await supabaseAdmin.rpc("has_brand_access", {
    _user_id: userId,
    _brand_id: brandId,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Response("Forbidden", { status: 403 });
}

async function getAgentBrand(agentId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("ai_agents")
    .select("brand_id")
    .eq("id", agentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Response("Not found", { status: 404 });
  return data.brand_id as string;
}

// ============= Lead mode config (limit + prompts) =============
const leadConfigSchema = z.object({
  agentId: z.string().uuid(),
  lead_free_message_limit: z.number().int().min(0).max(1000),
  lead_mode_prompt: z.string().nullable().optional(),
  lead_offer_prompt: z.string().nullable().optional(),
});

export const updateEllieLeadConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => leadConfigSchema.parse(input))
  .handler(async ({ data, context }) => {
    const brandId = await getAgentBrand(data.agentId);
    await assertBrandAccess(context.userId, brandId);
    const { agentId, ...patch } = data;
    const { error } = await supabaseAdmin.from("ai_agents").update(patch).eq("id", agentId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============= Offer catalog =============
export const listLeadOffers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ agentId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const brandId = await getAgentBrand(data.agentId);
    await assertBrandAccess(context.userId, brandId);
    const { data: rows, error } = await supabaseAdmin
      .from("ellie_lead_offers")
      .select("*")
      .eq("agent_id", data.agentId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return { items: rows ?? [] };
  });

const upsertOfferSchema = z.object({
  id: z.string().uuid().optional(),
  agentId: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  checkout_url: z.string().url().max(500).nullable().optional(),
  image_url: z.string().url().max(500).nullable().optional(),
  sort_order: z.number().int().min(0).max(9999).optional(),
  active: z.boolean().optional(),
});

export const upsertLeadOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => upsertOfferSchema.parse(input))
  .handler(async ({ data, context }) => {
    const brandId = await getAgentBrand(data.agentId);
    await assertBrandAccess(context.userId, brandId);
    const row = {
      agent_id: data.agentId,
      brand_id: brandId,
      title: data.title.trim(),
      description: data.description ?? null,
      checkout_url: data.checkout_url ?? null,
      image_url: data.image_url ?? null,
      sort_order: data.sort_order ?? 0,
      active: data.active ?? true,
      created_by: context.userId,
    };
    if (data.id) {
      const { error } = await supabaseAdmin
        .from("ellie_lead_offers")
        .update(row)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: ins, error } = await supabaseAdmin
      .from("ellie_lead_offers")
      .insert(row)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: ins!.id };
  });

export const deleteLeadOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), agentId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const brandId = await getAgentBrand(data.agentId);
    await assertBrandAccess(context.userId, brandId);
    const { error } = await supabaseAdmin
      .from("ellie_lead_offers")
      .delete()
      .eq("id", data.id)
      .eq("agent_id", data.agentId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============= Usage counter (read/reset for ops) =============
export const getLeadUsage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ agentId: z.string().uuid(), contactId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const brandId = await getAgentBrand(data.agentId);
    await assertBrandAccess(context.userId, brandId);
    const { data: row } = await supabaseAdmin
      .from("ellie_lead_usage")
      .select("messages_used, last_message_at")
      .eq("agent_id", data.agentId)
      .eq("contact_id", data.contactId)
      .maybeSingle();
    return { usage: row };
  });

export const resetLeadUsage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ agentId: z.string().uuid(), contactId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const brandId = await getAgentBrand(data.agentId);
    await assertBrandAccess(context.userId, brandId);
    const { error } = await supabaseAdmin.rpc("reset_ellie_lead_usage", {
      _agent_id: data.agentId,
      _contact_id: data.contactId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
