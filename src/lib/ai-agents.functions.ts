import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createVersionSnapshotInternal } from "@/lib/ai-agent-versions.server";


async function assertBrandAccess(userId: string, brandId: string) {
  const { data, error } = await supabaseAdmin.rpc("has_brand_access", {
    _user_id: userId,
    _brand_id: brandId,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Response("Forbidden", { status: 403 });
}

async function assertAgentAccess(userId: string, agentId: string) {
  const { data: agent, error } = await supabaseAdmin
    .from("ai_agents")
    .select("id, brand_id")
    .eq("id", agentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!agent) throw new Response("Not found", { status: 404 });
  await assertBrandAccess(userId, agent.brand_id as string);
  return agent as { id: string; brand_id: string };
}

async function assertKbAccess(
  userId: string,
  table: "ai_knowledge_company" | "ai_knowledge_context" | "ai_knowledge_products",
  kbId: string,
) {
  const { data, error } = await supabaseAdmin
    .from(table)
    .select("brand_id")
    .eq("id", kbId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Response("Not found", { status: 404 });
  await assertBrandAccess(userId, data.brand_id as string);
  return data.brand_id as string;
}

// ============= Agents =============
export const listAgents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ brandId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertBrandAccess(context.userId, data.brandId);
    const { data: rows, error } = await supabaseAdmin
      .from("ai_agents")
      .select("id, name, status, model, updated_at, created_at")
      .eq("brand_id", data.brandId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { agents: rows ?? [] };
  });

export const getAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ agentId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAgentAccess(context.userId, data.agentId);
    const [agentRes, linksRes] = await Promise.all([
      supabaseAdmin.from("ai_agents").select("*").eq("id", data.agentId).single(),
      supabaseAdmin.from("ai_agent_knowledge").select("kind, kb_id").eq("agent_id", data.agentId),
    ]);
    if (agentRes.error) throw new Error(agentRes.error.message);
    const links = (linksRes.data ?? []) as Array<{ kind: string; kb_id: string }>;
    return {
      agent: agentRes.data,
      knowledge: {
        company: links.filter((l) => l.kind === "company").map((l) => l.kb_id),
        context: links.filter((l) => l.kind === "context").map((l) => l.kb_id),
        product: links.filter((l) => l.kind === "product").map((l) => l.kb_id),
      },
    };
  });

export const createAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ brandId: z.string().uuid(), name: z.string().min(1).max(120) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertBrandAccess(context.userId, data.brandId);
    const { data: row, error } = await supabaseAdmin
      .from("ai_agents")
      .insert({ brand_id: data.brandId, name: data.name, created_by: context.userId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row!.id as string };
  });

const inputDefSchema = z.object({
  key: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_.]+$/, "Use apenas letras, números, '_' ou '.'"),
  label: z.string().max(120).optional(),
  source: z.enum(["contact", "brand", "conversation", "static", "hotmart", "shopify", "activecampaign", "sendflow"]),
  path: z.string().max(120).optional(),
  fallback: z.string().max(500).optional(),
});

const updateSchema = z.object({
  agentId: z.string().uuid(),
  patch: z.object({
    name: z.string().min(1).max(120).optional(),
    status: z.enum(["off", "test", "on"]).optional(),
    whitelist: z.array(z.string().min(1).max(64)).max(500).optional(),
    system_prompt: z.string().max(20000).optional(),
    model: z.string().min(1).max(120).optional(),
    temperature: z.number().min(0).max(2).optional(),
    max_output_tokens: z.number().int().min(64).max(8192).optional(),
    response_delay_ms: z.number().int().min(0).max(120000).optional(),
    context_window_messages: z.number().int().min(1).max(100).optional(),
    escalation_target_suporte: z.string().uuid().nullable().optional(),
    escalation_target_vendas: z.string().uuid().nullable().optional(),
    inputs: z.array(inputDefSchema).max(50).optional(),
    rate_limit_per_conversation: z.number().int().min(0).max(10000).optional(),
    rate_limit_window_minutes: z.number().int().min(1).max(1440).optional(),
    rate_limit_per_agent_hour: z.number().int().min(0).max(100000).nullable().optional(),
    escalation_alert_threshold_pct: z.number().min(0).max(100).nullable().optional(),
    escalation_alert_window_minutes: z.number().int().min(5).max(1440).optional(),
    escalation_alert_min_runs: z.number().int().min(1).max(10000).optional(),
    tracking_tag: z.string().max(120).nullable().optional(),
    version_label: z.string().max(120).optional(),
    version_notes: z.string().max(2000).optional(),
  }),
});


export const updateAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => updateSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAgentAccess(context.userId, data.agentId);

    // Separa metadados de versão do patch real
    const { version_label, version_notes, ...realPatch } = data.patch;

    // Detecta se system_prompt vai mudar para snapshot automático
    let promptChanged = false;
    if (typeof realPatch.system_prompt === "string") {
      const { data: cur } = await supabaseAdmin
        .from("ai_agents")
        .select("system_prompt")
        .eq("id", data.agentId)
        .maybeSingle();
      promptChanged = (cur?.system_prompt ?? "") !== realPatch.system_prompt;
    }

    const { error } = await supabaseAdmin
      .from("ai_agents")
      .update(realPatch as never)
      .eq("id", data.agentId);
    if (error) throw new Error(error.message);

    if (promptChanged) {
      try {
        await createVersionSnapshotInternal({
          agentId: data.agentId,
          userId: context.userId,
          source: "auto_prompt_change",
          label: version_label?.trim() ? version_label.trim() : null,
          notes: version_notes?.trim() ? version_notes.trim() : null,
        });
      } catch (e) {
        // não bloqueia o save em caso de falha do snapshot
        console.error("auto-snapshot failed", e);
      }
    }

    return { ok: true };
  });


export const deleteAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ agentId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAgentAccess(context.userId, data.agentId);
    const { error } = await supabaseAdmin.from("ai_agents").delete().eq("id", data.agentId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============= Knowledge Bases — list por workspace =============
export const listKnowledgeBases = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ brandId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertBrandAccess(context.userId, data.brandId);
    const [c, ctx, p] = await Promise.all([
      supabaseAdmin.from("ai_knowledge_company").select("id, name, content, faq, company_name, expert_name, updated_at")
        .eq("brand_id", data.brandId).order("name"),
      supabaseAdmin.from("ai_knowledge_context").select("id, title, content, starts_at, ends_at, updated_at")
        .eq("brand_id", data.brandId).order("starts_at", { ascending: false }),
      supabaseAdmin.from("ai_knowledge_products").select("id, source, product_name, summary, description, utm_default, utm_params, faq, notes, external_product_id, integration_product_id, updated_at")
        .eq("brand_id", data.brandId).order("product_name"),
    ]);
    if (c.error) throw new Error(c.error.message);
    if (ctx.error) throw new Error(ctx.error.message);
    if (p.error) throw new Error(p.error.message);
    return { company: c.data ?? [], context: ctx.data ?? [], product: p.data ?? [] };
  });

// ============= KB: company =============
const companySchema = z.object({
  id: z.string().uuid().optional(),
  brandId: z.string().uuid(),
  name: z.string().min(1).max(200),
  content: z.string().max(50000),
  faq: z.array(z.object({ q: z.string().max(500), a: z.string().max(5000) })).max(200).optional(),
  company_name: z.string().max(200).optional().nullable(),
  expert_name: z.string().max(200).optional().nullable(),
});

export const upsertKnowledgeCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => companySchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertBrandAccess(context.userId, data.brandId);
    const norm = (v: string | null | undefined) => {
      const s = (v ?? "").trim();
      return s.length > 0 ? s : null;
    };
    const payload = {
      brand_id: data.brandId,
      name: data.name,
      content: data.content,
      faq: data.faq ?? [],
      company_name: norm(data.company_name),
      expert_name: norm(data.expert_name),
    };
    if (data.id) {
      await assertKbAccess(context.userId, "ai_knowledge_company", data.id);
      const { error } = await supabaseAdmin.from("ai_knowledge_company").update(payload).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: row, error } = await supabaseAdmin
      .from("ai_knowledge_company").insert(payload).select("id").single();
    if (error) throw new Error(error.message);
    return { id: row!.id as string };
  });

export const deleteKnowledgeCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertKbAccess(context.userId, "ai_knowledge_company", data.id);
    const { error } = await supabaseAdmin.from("ai_knowledge_company").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============= KB: context =============
const contextSchema = z.object({
  id: z.string().uuid().optional(),
  brandId: z.string().uuid(),
  title: z.string().min(1).max(200),
  content: z.string().max(20000),
  starts_at: z.string().min(1),
  ends_at: z.string().min(1),
});

export const upsertKnowledgeContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => contextSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertBrandAccess(context.userId, data.brandId);
    const payload = {
      brand_id: data.brandId,
      title: data.title,
      content: data.content,
      starts_at: data.starts_at,
      ends_at: data.ends_at,
    };
    if (data.id) {
      await assertKbAccess(context.userId, "ai_knowledge_context", data.id);
      const { error } = await supabaseAdmin.from("ai_knowledge_context").update(payload).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: row, error } = await supabaseAdmin
      .from("ai_knowledge_context").insert(payload).select("id").single();
    if (error) throw new Error(error.message);
    return { id: row!.id as string };
  });

export const deleteKnowledgeContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertKbAccess(context.userId, "ai_knowledge_context", data.id);
    const { error } = await supabaseAdmin.from("ai_knowledge_context").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============= KB: product =============
const productSchema = z.object({
  id: z.string().uuid().optional(),
  brandId: z.string().uuid(),
  source: z.enum(["hotmart", "shopify", "manual"]),
  integration_product_id: z.string().uuid().nullable().optional(),
  external_product_id: z.string().max(200).nullable().optional(),
  product_name: z.string().min(1).max(200),
  summary: z.string().max(500).optional(),
  description: z.string().max(50000).optional(),
  utm_default: z.string().max(200).nullable().optional(),
  utm_params: z.object({
    source: z.string().max(200).nullable().optional(),
    medium: z.string().max(200).nullable().optional(),
    campaign: z.string().max(200).nullable().optional(),
    content: z.string().max(200).nullable().optional(),
    term: z.string().max(200).nullable().optional(),
    site: z.string().max(200).nullable().optional(),
  }).nullable().optional(),
  faq: z.array(z.object({ q: z.string().max(500), a: z.string().max(5000) })).max(200).optional(),
  notes: z.string().max(20000).nullable().optional(),
});

export const upsertKnowledgeProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => productSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertBrandAccess(context.userId, data.brandId);
    const payload = {
      brand_id: data.brandId,
      source: data.source,
      integration_product_id: data.integration_product_id ?? null,
      external_product_id: data.external_product_id ?? null,
      product_name: data.product_name,
      summary: data.summary ?? "",
      description: data.description ?? "",
      utm_default: data.utm_default ?? null,
      utm_params: data.utm_params ?? {},
      faq: data.faq ?? [],
      notes: data.notes ?? null,
    };
    if (data.id) {
      await assertKbAccess(context.userId, "ai_knowledge_products", data.id);
      const { error } = await supabaseAdmin.from("ai_knowledge_products").update(payload).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: row, error } = await supabaseAdmin
      .from("ai_knowledge_products").insert(payload).select("id").single();
    if (error) throw new Error(error.message);
    return { id: row!.id as string };
  });

export const deleteKnowledgeProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertKbAccess(context.userId, "ai_knowledge_products", data.id);
    const { error } = await supabaseAdmin.from("ai_knowledge_products").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============= Agent ↔ KB links =============
export const setAgentKnowledge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      agentId: z.string().uuid(),
      kind: z.enum(["company", "context", "product"]),
      kbIds: z.array(z.string().uuid()).max(200),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const agent = await assertAgentAccess(context.userId, data.agentId);
    // Valida que todas as bases pertencem ao mesmo workspace do agente
    if (data.kbIds.length > 0) {
      const table =
        data.kind === "company" ? "ai_knowledge_company"
        : data.kind === "context" ? "ai_knowledge_context"
        : "ai_knowledge_products";
      const { data: rows, error } = await supabaseAdmin
        .from(table).select("id, brand_id").in("id", data.kbIds);
      if (error) throw new Error(error.message);
      const bad = (rows ?? []).find((r) => r.brand_id !== agent.brand_id);
      if (bad) throw new Response("KB de outro workspace", { status: 400 });
      if ((rows ?? []).length !== data.kbIds.length) {
        throw new Response("Algumas bases não foram encontradas", { status: 404 });
      }
    }
    // Replace links of this kind
    await supabaseAdmin.from("ai_agent_knowledge")
      .delete().eq("agent_id", data.agentId).eq("kind", data.kind);
    if (data.kbIds.length > 0) {
      const rows = data.kbIds.map((kb_id) => ({ agent_id: data.agentId, kind: data.kind, kb_id }));
      const { error } = await supabaseAdmin.from("ai_agent_knowledge").insert(rows);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

// ============= Integration products (catálogo já sincronizado) =============
export const listIntegrationProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      brandId: z.string().uuid(),
      source: z.enum(["hotmart", "shopify"]).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertBrandAccess(context.userId, data.brandId);
    // Pega contas de integração visíveis para esta brand
    const { data: accs, error: e1 } = await supabaseAdmin
      .from("integration_account_brands")
      .select("account_id, integration_accounts(id, platform, name)")
      .eq("brand_id", data.brandId);
    if (e1) throw new Error(e1.message);
    const accountIds = (accs ?? [])
      .map((r: { account_id: string; integration_accounts: { platform: string } | null }) => ({
        id: r.account_id,
        platform: r.integration_accounts?.platform,
      }))
      .filter((r) => !data.source || r.platform === data.source)
      .map((r) => r.id);
    if (accountIds.length === 0) return { products: [] };

    const { data: products, error } = await supabaseAdmin
      .from("integration_products")
      .select("id, account_id, external_id, name, type, metadata, integration_accounts!inner(platform, name)")
      .in("account_id", accountIds)
      .order("name");
    if (error) throw new Error(error.message);
    return {
      products: (products ?? []).map((p: {
        id: string; external_id: string; name: string; account_id: string;
        integration_accounts: { platform: string; name: string } | null;
      }) => ({
        id: p.id,
        external_id: p.external_id,
        name: p.name,
        account_id: p.account_id,
        platform: p.integration_accounts?.platform,
        account_name: p.integration_accounts?.name,
      })),
    };
  });

// ============= Runs (Execuções) =============
export const listAgentRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        brandId: z.string().uuid(),
        agentId: z.string().uuid().optional(),
        status: z.enum(["success", "error", "escalated", "rate_limited"]).optional(),
        triggeredBy: z.enum(["automation", "manual_test", "scenario", "assign_block", "message"]).optional(),
        contactId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(200).default(50),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertBrandAccess(context.userId, data.brandId);
    let q = supabaseAdmin
      .from("ai_agent_runs")
      .select(
        "id, created_at, brand_id, agent_id, conversation_id, contact_id, triggered_by, status, model, latency_ms, tokens_in, tokens_out, error_code, error_message, escalation_track",
      )
      .eq("brand_id", data.brandId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.agentId) q = q.eq("agent_id", data.agentId);
    if (data.status) q = q.eq("status", data.status);
    if (data.triggeredBy) q = q.eq("triggered_by", data.triggeredBy);
    if (data.contactId) q = q.eq("contact_id", data.contactId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const runs = rows ?? [];
    const agentIds = Array.from(new Set(runs.map((r) => r.agent_id).filter(Boolean) as string[]));
    const contactIds = Array.from(new Set(runs.map((r) => r.contact_id).filter(Boolean) as string[]));
    const [agentsRes, contactsRes] = await Promise.all([
      agentIds.length
        ? supabaseAdmin.from("ai_agents").select("id, name").in("id", agentIds)
        : Promise.resolve({ data: [] as Array<{ id: string; name: string }>, error: null }),
      contactIds.length
        ? supabaseAdmin.from("contacts").select("id, name, phone, wa_id").in("id", contactIds)
        : Promise.resolve({ data: [] as Array<{ id: string; name: string | null; phone: string | null; wa_id: string }>, error: null }),
    ]);
    const agentMap = new Map((agentsRes.data ?? []).map((a) => [a.id, a]));
    const contactMap = new Map((contactsRes.data ?? []).map((c) => [c.id, c]));
    const enriched = runs.map((r) => ({
      ...r,
      ai_agents: r.agent_id ? { name: agentMap.get(r.agent_id)?.name ?? null } : null,
      contacts: r.contact_id
        ? {
            name: contactMap.get(r.contact_id)?.name ?? null,
            phone: contactMap.get(r.contact_id)?.phone ?? null,
            wa_id: contactMap.get(r.contact_id)?.wa_id ?? null,
          }
        : null,
    }));
    return { runs: enriched };
  });

export const getAgentRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ runId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: run, error } = await supabaseAdmin
      .from("ai_agent_runs")
      .select("*")
      .eq("id", data.runId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!run) throw new Response("Not found", { status: 404 });
    await assertBrandAccess(context.userId, (run as { brand_id: string }).brand_id);
    return { run };
  });

// ============= Field path discovery =============
export const discoverContactFieldPaths = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ brandId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertBrandAccess(context.userId, data.brandId);
    const { data: rows, error } = await supabaseAdmin
      .from("contacts")
      .select("metadata")
      .eq("brand_id", data.brandId)
      .not("metadata", "eq", "{}")
      .order("updated_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    const counts = new Map<string, number>();
    const bump = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1);

    for (const row of rows ?? []) {
      const meta = (row as { metadata: unknown }).metadata;
      if (!meta || typeof meta !== "object" || Array.isArray(meta)) continue;
      for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
        bump(`metadata.${k}`);
        // Drill into nested objects (one level), specially "custom"
        if (v && typeof v === "object" && !Array.isArray(v)) {
          for (const k2 of Object.keys(v as Record<string, unknown>)) {
            bump(`metadata.${k}.${k2}`);
          }
        }
      }
    }

    const paths = Array.from(counts.entries())
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path));

    return { paths };
  });
