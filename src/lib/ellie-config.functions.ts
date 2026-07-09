import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { toE164 } from "@/lib/phone";


// ============= helpers =============
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

// ============= Ellie agent extras (colunas opcionais em ai_agents) =============
const ellieFieldsSchema = z.object({
  agentId: z.string().uuid(),
  group_inputs_seconds: z.number().int().min(0).max(600).optional(),
  followup_minutes: z.number().int().min(0).max(10080).nullable().optional(),
  default_user_message: z.string().nullable().optional(),
  image_mode: z.enum(["ignore", "transcribe", "respond"]).optional(),
  audio_mode: z.enum(["ignore", "transcribe", "respond"]).optional(),
  process_inbound_images: z.boolean().optional(),
  dynamic_quick_replies: z.boolean().optional(),
  ellie_context_window: z.number().int().min(1).max(500).nullable().optional(),
  buyer_validation_api_url: z.string().nullable().optional(),
  buyer_validation_api_key_ref: z.string().nullable().optional(),
  quick_replies: z
    .array(z.object({ label: z.string().min(1).max(20), payload: z.string().min(1).max(80) }))
    .max(3)
    .optional(),
  help_me_enabled: z.boolean().optional(),
  help_me_slow_speed: z.number().min(0.7).max(1).optional(),
});

export const updateEllieAgentExtras = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ellieFieldsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const brandId = await getAgentBrand(data.agentId);
    await assertBrandAccess(context.userId, brandId);
    const { agentId, ...patch } = data;
    const { error } = await supabaseAdmin.from("ai_agents").update(patch).eq("id", agentId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============= Functions (tools) =============
export const listAgentFunctions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ agentId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const brandId = await getAgentBrand(data.agentId);
    await assertBrandAccess(context.userId, brandId);
    const { data: rows, error } = await supabaseAdmin
      .from("ai_agent_functions")
      .select("*")
      .eq("agent_id", data.agentId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return { functions: rows ?? [] };
  });

const upsertFunctionSchema = z.object({
  id: z.string().uuid().optional(),
  agentId: z.string().uuid(),
  name: z.string().min(1).max(80),
  description: z.string().max(2000).default(""),
  action_type: z.enum(["custom", "save_to_memory", "call_automation", "buyer_detector", "send_image"]),
  parameters_schema: z.any().optional(),
  target_automation_id: z.string().uuid().nullable().optional(),
  save_results: z.boolean().optional(),
  enabled: z.boolean().optional(),
  config: z.any().optional(),
});

export const upsertAgentFunction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => upsertFunctionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const brandId = await getAgentBrand(data.agentId);
    await assertBrandAccess(context.userId, brandId);
    const row = {
      agent_id: data.agentId,
      brand_id: brandId,
      name: data.name,
      description: data.description ?? "",
      action_type: data.action_type,
      parameters_schema: data.parameters_schema ?? { type: "object", properties: {} },
      target_automation_id: data.target_automation_id ?? null,
      save_results: data.save_results ?? false,
      enabled: data.enabled ?? true,
      config: data.config ?? {},
      created_by: context.userId,
    };
    if (data.id) {
      const { error } = await supabaseAdmin.from("ai_agent_functions").update(row).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: ins, error } = await supabaseAdmin
      .from("ai_agent_functions")
      .insert(row)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: ins!.id };
  });

export const deleteAgentFunction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid(), agentId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const brandId = await getAgentBrand(data.agentId);
    await assertBrandAccess(context.userId, brandId);
    const { error } = await supabaseAdmin
      .from("ai_agent_functions")
      .delete()
      .eq("id", data.id)
      .eq("agent_id", data.agentId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============= Voice config =============
export const getAgentVoiceConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ agentId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const brandId = await getAgentBrand(data.agentId);
    await assertBrandAccess(context.userId, brandId);
    const { data: row, error } = await supabaseAdmin
      .from("ai_agent_voice_configs")
      .select("*")
      .eq("agent_id", data.agentId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { voice: row };
  });

const voiceSchema = z.object({
  agentId: z.string().uuid(),
  voice_id: z.string().nullable().optional(),
  model_id: z.string().optional(),
  stability: z.number().min(0).max(1).optional(),
  similarity_boost: z.number().min(0).max(1).optional(),
  style: z.number().min(0).max(1).optional(),
  speed: z.number().min(0.5).max(2).optional(),
  send_mode: z.enum(["text", "audio", "text_and_audio", "llm_decides"]).optional(),
});

export const upsertAgentVoiceConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => voiceSchema.parse(input))
  .handler(async ({ data, context }) => {
    const brandId = await getAgentBrand(data.agentId);
    await assertBrandAccess(context.userId, brandId);
    const { agentId, ...rest } = data;
    const row = { agent_id: agentId, brand_id: brandId, provider: "elevenlabs", ...rest };
    const { error } = await supabaseAdmin
      .from("ai_agent_voice_configs")
      .upsert(row, { onConflict: "agent_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============= Buyer validations (Ellie) =============
export const listBuyerValidations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ brandId: z.string().uuid(), q: z.string().optional() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertBrandAccess(context.userId, data.brandId);
    let qb = supabaseAdmin
      .from("ellie_buyer_validations")
      .select("*")
      .eq("brand_id", data.brandId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (data.q && data.q.trim()) {
      const term = `%${data.q.trim()}%`;
      qb = qb.or(`email.ilike.${term},full_name.ilike.${term},phone.ilike.${term}`);
    }
    const { data: rows, error } = await qb;
    if (error) throw new Error(error.message);
    return { items: rows ?? [] };
  });

const upsertBuyerSchema = z.object({
  id: z.string().uuid().optional(),
  brandId: z.string().uuid(),
  email: z.string().email().max(200),
  phone: z.string().max(40).nullable().optional(),
  full_name: z.string().max(200).nullable().optional(),
  product: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  active: z.boolean().optional(),
});

export const upsertBuyerValidation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => upsertBuyerSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertBrandAccess(context.userId, data.brandId);
    const normalizedPhone = data.phone ? toE164(data.phone) : null;
    const row = {
      brand_id: data.brandId,
      email: data.email.toLowerCase().trim(),
      phone: normalizedPhone,
      full_name: data.full_name ?? null,
      product: data.product ?? null,
      notes: data.notes ?? null,
      active: data.active ?? true,
      created_by: context.userId,
    };

    if (data.id) {
      const { error } = await supabaseAdmin
        .from("ellie_buyer_validations")
        .update(row)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: ins, error } = await supabaseAdmin
      .from("ellie_buyer_validations")
      .upsert(row, { onConflict: "brand_id,email" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: ins!.id };
  });

export const deleteBuyerValidation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid(), brandId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertBrandAccess(context.userId, data.brandId);
    const { error } = await supabaseAdmin
      .from("ellie_buyer_validations")
      .delete()
      .eq("id", data.id)
      .eq("brand_id", data.brandId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
