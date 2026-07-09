import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertAgentAccess(userId: string, agentId: string) {
  const { data: agent, error } = await supabaseAdmin
    .from("ai_agents")
    .select("id, brand_id, current_version_id")
    .eq("id", agentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!agent) throw new Response("Not found", { status: 404 });
  const { data: ok, error: e2 } = await supabaseAdmin.rpc("has_brand_access", {
    _user_id: userId,
    _brand_id: agent.brand_id as string,
  });
  if (e2) throw new Error(e2.message);
  if (!ok) throw new Response("Forbidden", { status: 403 });
  return agent as { id: string; brand_id: string; current_version_id: string | null };
}

async function loadTestForUser(userId: string, testId: string) {
  const { data: t, error } = await supabaseAdmin
    .from("ai_agent_ab_tests")
    .select("*")
    .eq("id", testId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!t) throw new Response("Not found", { status: 404 });
  await assertAgentAccess(userId, (t as { agent_id: string }).agent_id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return t as any;
}

export const listAgentAbTests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ agentId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAgentAccess(context.userId, data.agentId);
    const { data: rows, error } = await supabaseAdmin
      .from("ai_agent_ab_tests")
      .select("*")
      .eq("agent_id", data.agentId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const versionIds = Array.from(
      new Set(
        (rows ?? []).flatMap((r) => [
          r.version_a_id as string,
          r.version_b_id as string,
        ]),
      ),
    );
    let versions: Record<string, { version_number: number; label: string | null }> = {};
    if (versionIds.length) {
      const { data: vs } = await supabaseAdmin
        .from("ai_agent_versions")
        .select("id, version_number, label")
        .in("id", versionIds);
      versions = Object.fromEntries(
        (vs ?? []).map((v) => [
          v.id as string,
          { version_number: v.version_number as number, label: v.label as string | null },
        ]),
      );
    }
    return {
      tests: (rows ?? []).map((r) => ({
        ...r,
        version_a: versions[r.version_a_id as string] ?? null,
        version_b: versions[r.version_b_id as string] ?? null,
      })),
    };
  });

export const createAbTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        agentId: z.string().uuid(),
        name: z.string().min(1).max(120),
        versionAId: z.string().uuid(),
        versionBId: z.string().uuid(),
        trafficBPercent: z.number().int().min(0).max(100),
        description: z.string().max(2000).optional(),
        startNow: z.boolean().optional(),
      })
      .refine((d) => d.versionAId !== d.versionBId, {
        message: "Versões A e B devem ser diferentes",
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const agent = await assertAgentAccess(context.userId, data.agentId);

    const { data: vs, error: vErr } = await supabaseAdmin
      .from("ai_agent_versions")
      .select("id, agent_id")
      .in("id", [data.versionAId, data.versionBId]);
    if (vErr) throw new Error(vErr.message);
    if ((vs ?? []).length !== 2 || (vs ?? []).some((v) => v.agent_id !== data.agentId)) {
      throw new Response("Versões inválidas para este agente", { status: 400 });
    }

    if (data.startNow) {
      const { data: running } = await supabaseAdmin
        .from("ai_agent_ab_tests")
        .select("id")
        .eq("agent_id", data.agentId)
        .eq("status", "running")
        .maybeSingle();
      if (running) throw new Response("Já existe um teste A/B rodando para este agente", { status: 409 });
    }

    const { data: row, error } = await supabaseAdmin
      .from("ai_agent_ab_tests")
      .insert({
        agent_id: data.agentId,
        brand_id: agent.brand_id,
        name: data.name,
        description: data.description ?? null,
        version_a_id: data.versionAId,
        version_b_id: data.versionBId,
        traffic_b_percent: data.trafficBPercent,
        status: data.startNow ? "running" : "draft",
        starts_at: data.startNow ? new Date().toISOString() : null,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row!.id as string };
  });

export const startAbTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const t = await loadTestForUser(context.userId, data.id);
    if (t.status === "running") return { ok: true };
    if (!["draft", "stopped"].includes(t.status)) {
      throw new Response("Teste não pode ser iniciado", { status: 400 });
    }
    const { data: running } = await supabaseAdmin
      .from("ai_agent_ab_tests")
      .select("id")
      .eq("agent_id", t.agent_id)
      .eq("status", "running")
      .maybeSingle();
    if (running) throw new Response("Já existe um teste A/B rodando para este agente", { status: 409 });

    const { error } = await supabaseAdmin
      .from("ai_agent_ab_tests")
      .update({
        status: "running",
        starts_at: new Date().toISOString(),
        ends_at: null,
        winner: null,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const stopAbTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      id: z.string().uuid(),
      winner: z.enum(["a", "b", "tie"]).nullable().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await loadTestForUser(context.userId, data.id);
    const { error } = await supabaseAdmin
      .from("ai_agent_ab_tests")
      .update({
        status: data.winner ? "completed" : "stopped",
        ends_at: new Date().toISOString(),
        winner: data.winner ?? null,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteAbTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const t = await loadTestForUser(context.userId, data.id);
    if (t.status === "running") {
      throw new Response("Pare o teste antes de excluí-lo", { status: 400 });
    }
    const { error } = await supabaseAdmin
      .from("ai_agent_ab_tests")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

type VariantStats = {
  runs: number;
  conversations: number;
  success: number;
  escalated: number;
  error: number;
  rate_limited: number;
  tokens_in: number;
  tokens_out: number;
  avg_latency_ms: number;
};

export const getAbTestResults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await loadTestForUser(context.userId, data.id);
    const { data: rows, error } = await supabaseAdmin
      .from("ai_agent_runs")
      .select("ab_variant, status, conversation_id, tokens_in, tokens_out, latency_ms")
      .eq("ab_test_id", data.id);
    if (error) throw new Error(error.message);

    const empty = (): VariantStats => ({
      runs: 0,
      conversations: 0,
      success: 0,
      escalated: 0,
      error: 0,
      rate_limited: 0,
      tokens_in: 0,
      tokens_out: 0,
      avg_latency_ms: 0,
    });
    const acc = { a: empty(), b: empty() };
    const convs = { a: new Set<string>(), b: new Set<string>() };
    const lat = { a: [] as number[], b: [] as number[] };

    for (const r of rows ?? []) {
      const v = r.ab_variant as "a" | "b" | null;
      if (v !== "a" && v !== "b") continue;
      const s = acc[v];
      s.runs += 1;
      const status = r.status as keyof VariantStats;
      if (status === "success" || status === "escalated" || status === "error" || status === "rate_limited") {
        (s[status] as number) += 1;
      }
      s.tokens_in += (r.tokens_in as number | null) ?? 0;
      s.tokens_out += (r.tokens_out as number | null) ?? 0;
      if (r.conversation_id) convs[v].add(r.conversation_id as string);
      if (typeof r.latency_ms === "number") lat[v].push(r.latency_ms as number);
    }
    acc.a.conversations = convs.a.size;
    acc.b.conversations = convs.b.size;
    acc.a.avg_latency_ms = lat.a.length ? Math.round(lat.a.reduce((x, y) => x + y, 0) / lat.a.length) : 0;
    acc.b.avg_latency_ms = lat.b.length ? Math.round(lat.b.reduce((x, y) => x + y, 0) / lat.b.length) : 0;

    return { a: acc.a, b: acc.b };
  });
