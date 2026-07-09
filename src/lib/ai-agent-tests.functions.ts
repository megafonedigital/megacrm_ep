import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { extractFaqKeywords, runScenarioCore } from "./ai-agent-tests.server";

async function assertAgentAccess(userId: string, agentId: string) {
  const { data, error } = await supabaseAdmin
    .from("ai_agents")
    .select("id, brand_id")
    .eq("id", agentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Response("Not found", { status: 404 });
  const { data: hasAccess, error: rpcErr } = await supabaseAdmin.rpc("has_brand_access", {
    _user_id: userId,
    _brand_id: data.brand_id as string,
  });
  if (rpcErr) throw new Error(rpcErr.message);
  if (!hasAccess) throw new Response("Forbidden", { status: 403 });
  return data as { id: string; brand_id: string };
}

async function assertScenarioAccess(userId: string, scenarioId: string) {
  const { data, error } = await supabaseAdmin
    .from("ai_agent_test_scenarios")
    .select("id, agent_id, brand_id")
    .eq("id", scenarioId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Response("Not found", { status: 404 });
  const { data: hasAccess, error: rpcErr } = await supabaseAdmin.rpc("has_brand_access", {
    _user_id: userId,
    _brand_id: data.brand_id as string,
  });
  if (rpcErr) throw new Error(rpcErr.message);
  if (!hasAccess) throw new Response("Forbidden", { status: 403 });
  return data as { id: string; agent_id: string; brand_id: string };
}

export const listTestScenarios = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ agentId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAgentAccess(context.userId, data.agentId);
    const { data: rows, error } = await supabaseAdmin
      .from("ai_agent_test_scenarios")
      .select("*")
      .eq("agent_id", data.agentId)
      .order("source", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return { scenarios: rows ?? [] };
  });

const turnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(4000),
});

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  agentId: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().default(""),
  turns: z.array(turnSchema).min(1).max(40),
  expect_must_contain: z.array(z.string().min(1).max(500)).max(50).optional().default([]),
  expect_must_not_contain: z.array(z.string().min(1).max(500)).max(50).optional().default([]),
  expect_need_human: z.boolean().optional().default(false),
  expect_need_human_reason: z.string().max(200).nullable().optional(),
  judge_criteria: z.string().max(4000).nullable().optional(),
});

export const upsertTestScenario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => upsertSchema.parse(input))
  .handler(async ({ data, context }) => {
    const agent = await assertAgentAccess(context.userId, data.agentId);
    const payload = {
      agent_id: data.agentId,
      brand_id: agent.brand_id,
      name: data.name,
      description: data.description ?? "",
      turns: data.turns,
      expect_must_contain: data.expect_must_contain ?? [],
      expect_must_not_contain: data.expect_must_not_contain ?? [],
      expect_need_human: data.expect_need_human ?? false,
      expect_need_human_reason: data.expect_need_human_reason ?? null,
      judge_criteria: data.judge_criteria ?? null,
    };
    if (data.id) {
      await assertScenarioAccess(context.userId, data.id);
      const { error } = await supabaseAdmin
        .from("ai_agent_test_scenarios")
        .update(payload as never)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: row, error } = await supabaseAdmin
      .from("ai_agent_test_scenarios")
      .insert({ ...payload, source: "manual" } as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: (row as { id: string }).id };
  });

export const deleteTestScenario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ scenarioId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertScenarioAccess(context.userId, data.scenarioId);
    const { error } = await supabaseAdmin
      .from("ai_agent_test_scenarios")
      .delete()
      .eq("id", data.scenarioId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const runTestScenario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ scenarioId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertScenarioAccess(context.userId, data.scenarioId);
    const r = await runScenarioCore(data.scenarioId);
    return r;
  });

export const runAllTestScenarios = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      agentId: z.string().uuid(),
      only: z.enum(["all", "failed"]).optional().default("all"),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAgentAccess(context.userId, data.agentId);
    let q = supabaseAdmin
      .from("ai_agent_test_scenarios")
      .select("id, last_status")
      .eq("agent_id", data.agentId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const ids = (rows ?? [])
      .filter((r) => data.only === "all" || (r as { last_status: string }).last_status === "fail" || (r as { last_status: string }).last_status === "pending")
      .map((r) => (r as { id: string }).id);

    const concurrency = 4;
    const results: Array<{ id: string; ok: boolean; reason?: string }> = [];
    let cursor = 0;
    async function worker() {
      while (cursor < ids.length) {
        const i = cursor++;
        const id = ids[i];
        try {
          const r = await runScenarioCore(id);
          results.push({ id, ...r });
        } catch (e) {
          results.push({ id, ok: false, reason: (e as Error).message });
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
    return { ran: results.length, results };
  });

export const runScenariosAB = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        agentId: z.string().uuid(),
        versionAId: z.string().uuid(),
        versionBId: z.string().uuid(),
        scenarioIds: z.array(z.string().uuid()).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAgentAccess(context.userId, data.agentId);
    let query = supabaseAdmin
      .from("ai_agent_test_scenarios")
      .select("id, name")
      .eq("agent_id", data.agentId)
      .order("created_at", { ascending: true });
    if (data.scenarioIds && data.scenarioIds.length > 0) {
      query = query.in("id", data.scenarioIds);
    }
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    const scenarios = (rows ?? []) as Array<{ id: string; name: string }>;

    const concurrency = 4;
    const results: Array<{
      scenarioId: string;
      name: string;
      a: Awaited<ReturnType<typeof runScenarioCore>>;
      b: Awaited<ReturnType<typeof runScenarioCore>>;
    }> = [];
    let cursor = 0;
    async function worker() {
      while (cursor < scenarios.length) {
        const i = cursor++;
        const sc = scenarios[i];
        const [a, b] = await Promise.all([
          runScenarioCore(sc.id, { versionId: data.versionAId, persistOnScenario: false }).catch(
            (e: unknown) => ({
              ok: false as const,
              reason: (e as Error).message,
              status: "error" as const,
              reply: "",
              failures: [(e as Error).message],
              judge_verdict: null,
              tool_call: null,
              tokens_in: null,
              tokens_out: null,
              duration_ms: 0,
              model: "",
            }),
          ),
          runScenarioCore(sc.id, { versionId: data.versionBId, persistOnScenario: false }).catch(
            (e: unknown) => ({
              ok: false as const,
              reason: (e as Error).message,
              status: "error" as const,
              reply: "",
              failures: [(e as Error).message],
              judge_verdict: null,
              tool_call: null,
              tokens_in: null,
              tokens_out: null,
              duration_ms: 0,
              model: "",
            }),
          ),
        ]);
        results.push({ scenarioId: sc.id, name: sc.name, a, b });
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(concurrency, scenarios.length) }, worker),
    );

    // Ordenar resultados na ordem original
    const order = new Map(scenarios.map((s, i) => [s.id, i]));
    results.sort((x, y) => (order.get(x.scenarioId) ?? 0) - (order.get(y.scenarioId) ?? 0));

    const aPass = results.filter((r) => r.a.status === "pass").length;
    const bPass = results.filter((r) => r.b.status === "pass").length;
    const aFail = results.filter((r) => r.a.status === "fail" || r.a.status === "error").length;
    const bFail = results.filter((r) => r.b.status === "fail" || r.b.status === "error").length;
    const agreement = results.filter((r) => r.a.status === r.b.status).length;
    const avgLatencyA = results.length
      ? Math.round(results.reduce((s, r) => s + (r.a.duration_ms ?? 0), 0) / results.length)
      : 0;
    const avgLatencyB = results.length
      ? Math.round(results.reduce((s, r) => s + (r.b.duration_ms ?? 0), 0) / results.length)
      : 0;
    const avgTokensA = results.length
      ? Math.round(
          results.reduce((s, r) => s + ((r.a.tokens_in ?? 0) + (r.a.tokens_out ?? 0)), 0) /
            results.length,
        )
      : 0;
    const avgTokensB = results.length
      ? Math.round(
          results.reduce((s, r) => s + ((r.b.tokens_in ?? 0) + (r.b.tokens_out ?? 0)), 0) /
            results.length,
        )
      : 0;

    return {
      results,
      summary: {
        total: results.length,
        aPass,
        bPass,
        aFail,
        bFail,
        agreement,
        avgLatencyA,
        avgLatencyB,
        avgTokensA,
        avgTokensB,
      },
    };
  });

export const syncTestScenariosFromFaq = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ agentId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const agent = await assertAgentAccess(context.userId, data.agentId);

    // Bases vinculadas
    const { data: links, error: linksErr } = await supabaseAdmin
      .from("ai_agent_knowledge")
      .select("kind, kb_id")
      .eq("agent_id", data.agentId);
    if (linksErr) throw new Error(linksErr.message);

    const companyIds = (links ?? []).filter((l) => l.kind === "company").map((l) => l.kb_id as string);
    const productIds = (links ?? []).filter((l) => l.kind === "product").map((l) => l.kb_id as string);

    type FaqItem = { q: string; a: string };
    type Source = { kind: "company" | "product"; kb_id: string; index: number; q: string; a: string; kbName: string };
    const sources: Source[] = [];

    if (companyIds.length > 0) {
      const { data: companies, error } = await supabaseAdmin
        .from("ai_knowledge_company")
        .select("id, name, faq")
        .in("id", companyIds);
      if (error) throw new Error(error.message);
      for (const c of companies ?? []) {
        const faq = (Array.isArray((c as { faq: unknown }).faq) ? (c as { faq: unknown }).faq : []) as FaqItem[];
        faq.forEach((item, idx) => {
          if (!item?.q?.trim() || !item?.a?.trim()) return;
          sources.push({
            kind: "company",
            kb_id: (c as { id: string }).id,
            index: idx,
            q: item.q.trim(),
            a: item.a.trim(),
            kbName: (c as { name: string }).name ?? "Empresa",
          });
        });
      }
    }
    if (productIds.length > 0) {
      const { data: products, error } = await supabaseAdmin
        .from("ai_knowledge_products")
        .select("id, product_name, faq")
        .in("id", productIds);
      if (error) throw new Error(error.message);
      for (const p of products ?? []) {
        const faq = (Array.isArray((p as { faq: unknown }).faq) ? (p as { faq: unknown }).faq : []) as FaqItem[];
        faq.forEach((item, idx) => {
          if (!item?.q?.trim() || !item?.a?.trim()) return;
          sources.push({
            kind: "product",
            kb_id: (p as { id: string }).id,
            index: idx,
            q: item.q.trim(),
            a: item.a.trim(),
            kbName: (p as { product_name: string }).product_name ?? "Produto",
          });
        });
      }
    }

    // Cenários FAQ existentes
    const { data: existing, error: exErr } = await supabaseAdmin
      .from("ai_agent_test_scenarios")
      .select("id, faq_source_kind, faq_source_kb_id, faq_source_index")
      .eq("agent_id", data.agentId)
      .eq("source", "faq");
    if (exErr) throw new Error(exErr.message);

    const existingMap = new Map<string, string>();
    for (const r of existing ?? []) {
      const row = r as { id: string; faq_source_kind: string; faq_source_kb_id: string; faq_source_index: number };
      existingMap.set(`${row.faq_source_kind}:${row.faq_source_kb_id}:${row.faq_source_index}`, row.id);
    }

    let created = 0;
    let kept = 0;
    const wantedKeys = new Set<string>();
    for (const src of sources) {
      const key = `${src.kind}:${src.kb_id}:${src.index}`;
      wantedKeys.add(key);
      if (existingMap.has(key)) { kept++; continue; }
      const keywords = extractFaqKeywords(src.a, 3);
      const namePrefix = src.kind === "company" ? "FAQ empresa" : "FAQ produto";
      const truncQ = src.q.length > 80 ? src.q.slice(0, 77) + "…" : src.q;
      const { error: insErr } = await supabaseAdmin
        .from("ai_agent_test_scenarios")
        .insert({
          agent_id: data.agentId,
          brand_id: agent.brand_id,
          name: `${namePrefix} (${src.kbName}): ${truncQ}`,
          description: `Resposta esperada (referência):\n${src.a}`,
          source: "faq",
          faq_source_kind: src.kind,
          faq_source_kb_id: src.kb_id,
          faq_source_index: src.index,
          turns: [{ role: "user", content: src.q }],
          expect_must_contain: keywords,
          expect_must_not_contain: [],
          expect_need_human: false,
          judge_criteria: `A resposta deve responder corretamente à pergunta sobre "${truncQ}", em linha com esta referência: ${src.a}`,
        } as never);
      if (insErr) throw new Error(insErr.message);
      created++;
    }

    // Remove cenários FAQ órfãos (FAQ sumiu do KB)
    const toRemove: string[] = [];
    for (const [key, id] of existingMap.entries()) {
      if (!wantedKeys.has(key)) toRemove.push(id);
    }
    if (toRemove.length > 0) {
      const { error: delErr } = await supabaseAdmin
        .from("ai_agent_test_scenarios")
        .delete()
        .in("id", toRemove);
      if (delErr) throw new Error(delErr.message);
    }

    return { created, kept, removed: toRemove.length };
  });
