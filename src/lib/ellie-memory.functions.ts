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
  if (!data) throw new Response("Agent not found", { status: 404 });
  return data.brand_id as string;
}

// ============= Listar memórias por contato =============
export const listContactMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ agentId: z.string().uuid(), contactId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const brandId = await getAgentBrand(data.agentId);
    await assertBrandAccess(context.userId, brandId);
    const { data: rows, error } = await supabaseAdmin
      .from("ai_agent_contact_memory" as any)
      .select("id, key, value, category, confidence, last_mentioned_at, created_at, updated_at")
      .eq("agent_id", data.agentId)
      .eq("contact_id", data.contactId)
      .order("category", { ascending: true })
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { items: (rows ?? []) as any[] };
  });

// ============= Buscar contatos com memória ou por nome/telefone =============
export const searchContactsForMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        agentId: z.string().uuid(),
        q: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const brandId = await getAgentBrand(data.agentId);
    await assertBrandAccess(context.userId, brandId);

    if (data.q && data.q.trim()) {
      const term = `%${data.q.trim()}%`;
      const { data: rows, error } = await supabaseAdmin
        .from("contacts")
        .select("id, name, wa_id, phone")
        .eq("brand_id", brandId)
        .or(`name.ilike.${term},wa_id.ilike.${term},phone.ilike.${term}`)
        .limit(30);
      if (error) throw new Error(error.message);
      return { items: (rows ?? []) as any[] };
    }

    // Sem busca: contatos que já têm memória neste agente.
    const { data: memIds, error: memErr } = await supabaseAdmin
      .from("ai_agent_contact_memory" as any)
      .select("contact_id, updated_at")
      .eq("agent_id", data.agentId)
      .order("updated_at", { ascending: false })
      .limit(200);
    if (memErr) throw new Error(memErr.message);
    const uniqueIds = Array.from(
      new Set(((memIds ?? []) as any[]).map((r) => r.contact_id as string)),
    ).slice(0, 30);
    if (uniqueIds.length === 0) return { items: [] };
    const { data: rows, error } = await supabaseAdmin
      .from("contacts")
      .select("id, name, wa_id, phone")
      .in("id", uniqueIds);
    if (error) throw new Error(error.message);
    return { items: (rows ?? []) as any[] };
  });

// ============= Atualizar valor de uma memória =============
export const updateContactMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        agentId: z.string().uuid(),
        value: z.string().min(1).max(1000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const brandId = await getAgentBrand(data.agentId);
    await assertBrandAccess(context.userId, brandId);
    const { error } = await supabaseAdmin
      .from("ai_agent_contact_memory" as any)
      .update({ value: data.value } as any)
      .eq("id", data.id)
      .eq("agent_id", data.agentId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============= Apagar uma memória =============
export const deleteContactMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), agentId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const brandId = await getAgentBrand(data.agentId);
    await assertBrandAccess(context.userId, brandId);
    const { error } = await supabaseAdmin
      .from("ai_agent_contact_memory" as any)
      .delete()
      .eq("id", data.id)
      .eq("agent_id", data.agentId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============= Limpar toda a memória de um contato =============
export const clearContactMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ agentId: z.string().uuid(), contactId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const brandId = await getAgentBrand(data.agentId);
    await assertBrandAccess(context.userId, brandId);
    const { error } = await supabaseAdmin
      .from("ai_agent_contact_memory" as any)
      .delete()
      .eq("agent_id", data.agentId)
      .eq("contact_id", data.contactId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============= Toggle de memória de longo prazo no agente =============
export const setLongTermMemoryEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ agentId: z.string().uuid(), enabled: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const brandId = await getAgentBrand(data.agentId);
    await assertBrandAccess(context.userId, brandId);
    const { error } = await supabaseAdmin
      .from("ai_agents")
      .update({ long_term_memory_enabled: data.enabled } as any)
      .eq("id", data.agentId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
