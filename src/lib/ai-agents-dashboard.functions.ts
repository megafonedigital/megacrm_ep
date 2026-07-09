import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertAgentBrand(userId: string, agentId: string): Promise<string> {
  const { data: agent, error } = await supabaseAdmin
    .from("ai_agents")
    .select("id, brand_id")
    .eq("id", agentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!agent) throw new Response("Not found", { status: 404 });
  const { data: ok } = await supabaseAdmin.rpc("has_brand_access", {
    _user_id: userId,
    _brand_id: agent.brand_id as string,
  });
  if (!ok) throw new Response("Forbidden", { status: 403 });
  return agent.brand_id as string;
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

export const getAgentDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      agentId: z.string().uuid(),
      from: z.string(),
      to: z.string(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAgentBrand(context.userId, data.agentId);

    const { data: runs, error } = await supabaseAdmin
      .from("ai_agent_runs")
      .select("id, status, model, tokens_in, tokens_out, latency_ms, escalation_track, error_code, error_message, created_at, conversation_id, ab_variant, ab_test_id")
      .eq("agent_id", data.agentId)
      .gte("created_at", data.from)
      .lte("created_at", data.to)
      .order("created_at", { ascending: true })
      .limit(10000);
    if (error) throw new Error(error.message);

    const { data: pricing } = await supabaseAdmin
      .from("ai_model_pricing")
      .select("model, input_per_1k, output_per_1k");
    const priceMap = new Map<string, { i: number; o: number }>();
    (pricing ?? []).forEach((p) => priceMap.set(p.model as string, {
      i: Number(p.input_per_1k ?? 0),
      o: Number(p.output_per_1k ?? 0),
    }));

    const list = runs ?? [];
    const totals = {
      activations: list.length,
      success: 0,
      escalated: 0,
      errors: 0,
      rate_limited: 0,
      tokens_in: 0,
      tokens_out: 0,
      cost_usd: 0,
      avg_latency_ms: 0,
    };
    const daily = new Map<string, { day: string; activations: number; cost: number; tokens_in: number; tokens_out: number; escalated: number; success: number }>();
    const escalationReasons = new Map<string, number>();
    const abAgg = new Map<string, { variant: string; total: number; success: number; escalated: number; errors: number; cost: number; tokens: number }>();

    let latencySum = 0;
    let latencyCount = 0;
    const escalatedRunsForTime: Array<{ run_id: string; conversation_id: string | null; created_at: string }> = [];

    for (const r of list) {
      const status = r.status as string;
      if (status === "success") totals.success++;
      else if (status === "escalated") totals.escalated++;
      else if (status === "rate_limited") totals.rate_limited++;
      else totals.errors++;

      const ti = Number(r.tokens_in ?? 0);
      const to = Number(r.tokens_out ?? 0);
      totals.tokens_in += ti;
      totals.tokens_out += to;
      const price = priceMap.get(r.model as string) ?? { i: 0, o: 0 };
      const cost = (ti / 1000) * price.i + (to / 1000) * price.o;
      totals.cost_usd += cost;

      if (typeof r.latency_ms === "number") {
        latencySum += r.latency_ms;
        latencyCount++;
      }

      const dk = dayKey(r.created_at as string);
      const d = daily.get(dk) ?? { day: dk, activations: 0, cost: 0, tokens_in: 0, tokens_out: 0, escalated: 0, success: 0 };
      d.activations++;
      d.cost += cost;
      d.tokens_in += ti;
      d.tokens_out += to;
      if (status === "success") d.success++;
      if (status === "escalated") d.escalated++;
      daily.set(dk, d);

      if (status === "escalated") {
        const reason = (r.escalation_track || r.error_message || "(sem motivo)") as string;
        escalationReasons.set(reason, (escalationReasons.get(reason) ?? 0) + 1);
        escalatedRunsForTime.push({
          run_id: r.id as string,
          conversation_id: (r.conversation_id as string) ?? null,
          created_at: r.created_at as string,
        });
      }

      if (r.ab_variant && r.ab_test_id) {
        const key = `${r.ab_test_id}:${r.ab_variant}`;
        const a = abAgg.get(key) ?? { variant: r.ab_variant as string, total: 0, success: 0, escalated: 0, errors: 0, cost: 0, tokens: 0 };
        a.total++;
        if (status === "success") a.success++;
        else if (status === "escalated") a.escalated++;
        else a.errors++;
        a.cost += cost;
        a.tokens += ti + to;
        abAgg.set(key, a);
      }
    }
    totals.avg_latency_ms = latencyCount > 0 ? Math.round(latencySum / latencyCount) : 0;

    // Tempo médio até escalar = latência média dos runs com status='escalated'
    let avgTimeToEscalateMs = 0;
    let escalatedLatencyCount = 0;
    let escalatedLatencySum = 0;
    for (const r of list) {
      if (r.status === "escalated" && typeof r.latency_ms === "number") {
        escalatedLatencySum += r.latency_ms;
        escalatedLatencyCount++;
      }
    }
    avgTimeToEscalateMs = escalatedLatencyCount > 0 ? Math.round(escalatedLatencySum / escalatedLatencyCount) : 0;

    // % conversas fechadas sem humano: conversas com run do agente cujo status final é 'resolvido' E não tem assigned_to
    const convIds = Array.from(new Set(list.map((r) => r.conversation_id).filter(Boolean))) as string[];
    let resolvedWithoutHuman = 0;
    let totalConvs = convIds.length;
    if (convIds.length > 0) {
      const { data: convs } = await supabaseAdmin
        .from("conversations")
        .select("id, status, assigned_to")
        .in("id", convIds);
      for (const c of convs ?? []) {
        if (c.status === "resolvido" && !c.assigned_to) resolvedWithoutHuman++;
      }
    }

    // Taxa de 1ª resposta: conversas onde o agente enviou (run 'success') e o contato respondeu depois.
    let firstReplyEngaged = 0;
    let firstReplyTimeSum = 0;
    let firstReplyTimeCount = 0;
    const firstAgentRunByConv = new Map<string, string>();
    for (const r of list) {
      if (r.status !== "success" || !r.conversation_id) continue;
      const cid = r.conversation_id as string;
      const cur = firstAgentRunByConv.get(cid);
      const ts = r.created_at as string;
      if (!cur || ts < cur) firstAgentRunByConv.set(cid, ts);
    }
    const firstReplyTotal = firstAgentRunByConv.size;
    if (firstReplyTotal > 0) {
      const ids = Array.from(firstAgentRunByConv.keys());
      const minTs = Array.from(firstAgentRunByConv.values()).sort()[0];
      const { data: msgs } = await supabaseAdmin
        .from("messages")
        .select("conversation_id, created_at, direction")
        .in("conversation_id", ids)
        .eq("direction", "inbound")
        .gte("created_at", minTs)
        .order("created_at", { ascending: true })
        .limit(20000);
      const firstReplyByConv = new Map<string, string>();
      for (const m of msgs ?? []) {
        const cid = m.conversation_id as string;
        const ts = m.created_at as string;
        const agentTs = firstAgentRunByConv.get(cid);
        if (!agentTs || ts <= agentTs) continue;
        if (!firstReplyByConv.has(cid)) firstReplyByConv.set(cid, ts);
      }
      for (const [cid, replyTs] of firstReplyByConv) {
        firstReplyEngaged++;
        const agentTs = firstAgentRunByConv.get(cid)!;
        firstReplyTimeSum += new Date(replyTs).getTime() - new Date(agentTs).getTime();
        firstReplyTimeCount++;
      }
    }
    const avgTimeToFirstReplyMs = firstReplyTimeCount > 0 ? Math.round(firstReplyTimeSum / firstReplyTimeCount) : 0;

    const dailySorted = Array.from(daily.values()).sort((a, b) => a.day.localeCompare(b.day));
    const reasonsSorted = Array.from(escalationReasons.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Reviews aggregated
    const escalatedRunIds = escalatedRunsForTime.map((e) => e.run_id);
    let reviewsSummary = { total: 0, confirmed: 0, corrected: 0, pending: escalatedRunIds.length };
    if (escalatedRunIds.length > 0) {
      const { data: reviews } = await supabaseAdmin
        .from("ai_escalation_reviews")
        .select("run_id, was_correct")
        .in("run_id", escalatedRunIds);
      for (const r of reviews ?? []) {
        reviewsSummary.total++;
        if (r.was_correct) reviewsSummary.confirmed++;
        else reviewsSummary.corrected++;
      }
      reviewsSummary.pending = Math.max(0, escalatedRunIds.length - reviewsSummary.total);
    }

    return {
      totals: {
        ...totals,
        cost_usd: Number(totals.cost_usd.toFixed(4)),
        avg_time_to_escalate_ms: avgTimeToEscalateMs,
        resolved_without_human: resolvedWithoutHuman,
        total_conversations: totalConvs,
        resolution_rate: totalConvs > 0 ? resolvedWithoutHuman / totalConvs : 0,
        first_reply_engaged: firstReplyEngaged,
        first_reply_total: firstReplyTotal,
        first_reply_rate: firstReplyTotal > 0 ? firstReplyEngaged / firstReplyTotal : 0,
        avg_time_to_first_reply_ms: avgTimeToFirstReplyMs,
      },
      daily: dailySorted.map((d) => ({ ...d, cost: Number(d.cost.toFixed(4)) })),
      escalation_reasons: reasonsSorted,
      ab: Array.from(abAgg.entries()).map(([key, v]) => ({ key, ...v, cost: Number(v.cost.toFixed(4)) })),
      reviews: reviewsSummary,
    };
  });

export const listEscalationReviews = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      agentId: z.string().uuid(),
      from: z.string(),
      to: z.string(),
      limit: z.number().int().min(1).max(200).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAgentBrand(context.userId, data.agentId);
    const { data: rows, error } = await supabaseAdmin
      .from("ai_escalation_reviews")
      .select("id, run_id, conversation_id, original_reason, validated_reason, was_correct, reviewer_id, reviewed_at")
      .eq("agent_id", data.agentId)
      .gte("reviewed_at", data.from)
      .lte("reviewed_at", data.to)
      .order("reviewed_at", { ascending: false })
      .limit(data.limit ?? 50);
    if (error) throw new Error(error.message);
    return { reviews: rows ?? [] };
  });

export const submitEscalationReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      runId: z.string().uuid(),
      wasCorrect: z.boolean(),
      validatedReason: z.string().max(2000).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: run, error } = await supabaseAdmin
      .from("ai_agent_runs")
      .select("id, agent_id, brand_id, conversation_id, escalation_track, error_message")
      .eq("id", data.runId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!run) throw new Response("Not found", { status: 404 });
    const { data: ok } = await supabaseAdmin.rpc("has_brand_access", {
      _user_id: context.userId,
      _brand_id: run.brand_id as string,
    });
    if (!ok) throw new Response("Forbidden", { status: 403 });

    const original = (run.escalation_track || run.error_message || null) as string | null;
    const { error: upErr } = await supabaseAdmin
      .from("ai_escalation_reviews")
      .upsert(
        {
          run_id: data.runId,
          conversation_id: run.conversation_id as string,
          agent_id: run.agent_id as string,
          brand_id: run.brand_id as string,
          original_reason: original,
          validated_reason: data.validatedReason ?? null,
          was_correct: data.wasCorrect,
          reviewer_id: context.userId,
          reviewed_at: new Date().toISOString(),
        },
        { onConflict: "run_id" },
      );
    if (upErr) throw new Error(upErr.message);
    return { ok: true };
  });

export const getPendingEscalationForConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ conversationId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: conv } = await supabaseAdmin
      .from("conversations")
      .select("id, brand_id")
      .eq("id", data.conversationId)
      .maybeSingle();
    if (!conv) return { run: null };
    const { data: ok } = await supabaseAdmin.rpc("has_brand_access", {
      _user_id: context.userId,
      _brand_id: conv.brand_id as string,
    });
    if (!ok) return { run: null };

    const { data: run, error } = await supabaseAdmin
      .from("ai_agent_runs")
      .select("id, agent_id, brand_id, escalation_track, error_message, created_at")
      .eq("conversation_id", data.conversationId)
      .eq("status", "escalated")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!run) return { run: null };

    const { data: review } = await supabaseAdmin
      .from("ai_escalation_reviews")
      .select("id")
      .eq("run_id", run.id as string)
      .maybeSingle();
    if (review) return { run: null };

    const { data: agent } = await supabaseAdmin
      .from("ai_agents")
      .select("name")
      .eq("id", run.agent_id as string)
      .maybeSingle();

    return {
      run: {
        id: run.id as string,
        agent_id: run.agent_id as string,
        agent_name: (agent?.name as string) ?? "Agente IA",
        original_reason: ((run.escalation_track || run.error_message) as string | null) ?? null,
        created_at: run.created_at as string,
      },
    };
  });

// ============= Escalation Threshold Alerts =============

export const evaluateEscalationAlerts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ agentId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const brandId = await assertAgentBrand(context.userId, data.agentId);
    const { data: agent } = await supabaseAdmin
      .from("ai_agents")
      .select("escalation_alert_threshold_pct, escalation_alert_window_minutes, escalation_alert_min_runs")
      .eq("id", data.agentId)
      .maybeSingle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = agent as any;
    const threshold = a?.escalation_alert_threshold_pct == null ? null : Number(a.escalation_alert_threshold_pct);
    if (threshold == null || threshold <= 0) return { alert: null };
    const windowMin = Number(a.escalation_alert_window_minutes ?? 60);
    const minRuns = Number(a.escalation_alert_min_runs ?? 10);

    const since = new Date(Date.now() - windowMin * 60_000).toISOString();
    const { data: runs } = await supabaseAdmin
      .from("ai_agent_runs")
      .select("status")
      .eq("agent_id", data.agentId)
      .gte("created_at", since)
      .limit(5000);
    const total = (runs ?? []).length;
    const escalated = (runs ?? []).filter((r) => r.status === "escalated").length;
    const ratePct = total > 0 ? (escalated / total) * 100 : 0;

    if (total < minRuns || ratePct <= threshold) return { alert: null };

    const details = {
      window_minutes: windowMin,
      total_runs: total,
      escalated_runs: escalated,
      rate_pct: Number(ratePct.toFixed(2)),
      threshold_pct: threshold,
    };

    // Upsert único alerta ativo (índice parcial UNIQUE)
    const { data: existing } = await supabaseAdmin
      .from("ai_agent_alerts")
      .select("id")
      .eq("agent_id", data.agentId)
      .eq("kind", "escalation_threshold")
      .is("resolved_at", null)
      .maybeSingle();

    if (existing) {
      await supabaseAdmin
        .from("ai_agent_alerts")
        .update({ details })
        .eq("id", existing.id as string);
      return { alert: { id: existing.id as string, ...details, kind: "escalation_threshold" } };
    }
    const { data: ins, error } = await supabaseAdmin
      .from("ai_agent_alerts")
      .insert({ agent_id: data.agentId, brand_id: brandId, kind: "escalation_threshold", details })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { alert: { id: ins!.id as string, ...details, kind: "escalation_threshold" } };
  });

export const listActiveAgentAlerts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ agentId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAgentBrand(context.userId, data.agentId);
    const { data: rows } = await supabaseAdmin
      .from("ai_agent_alerts")
      .select("id, kind, details, created_at")
      .eq("agent_id", data.agentId)
      .is("resolved_at", null)
      .order("created_at", { ascending: false });
    return { alerts: rows ?? [] };
  });

export const resolveAgentAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ alertId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: row } = await supabaseAdmin
      .from("ai_agent_alerts")
      .select("id, brand_id")
      .eq("id", data.alertId)
      .maybeSingle();
    if (!row) throw new Response("Not found", { status: 404 });
    const { data: ok } = await supabaseAdmin.rpc("has_brand_access", {
      _user_id: context.userId,
      _brand_id: row.brand_id as string,
    });
    if (!ok) throw new Response("Forbidden", { status: 403 });
    const { error } = await supabaseAdmin
      .from("ai_agent_alerts")
      .update({ resolved_at: new Date().toISOString(), resolved_by: context.userId })
      .eq("id", data.alertId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============= Sales Attribution =============

export function extractAttribution(platform: string, payload: unknown): {
  fields: string[];
  total: number;
  currency: string | null;
  product: string | null;
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = (payload ?? {}) as any;
  const fields: string[] = [];
  let total = 0;
  let currency: string | null = null;
  let product: string | null = null;

  if (platform === "hotmart") {
    const purchase = p?.data?.purchase ?? {};
    const origin = purchase?.origin ?? {};
    if (origin.sck) fields.push(String(origin.sck));
    if (origin.src) fields.push(String(origin.src));
    total = Number(purchase?.price?.value ?? 0);
    currency = purchase?.price?.currency_value ?? null;
    product = p?.data?.product?.name ?? null;
  } else if (platform === "shopify") {
    const landing = String(p?.landing_site ?? "");
    if (landing) {
      const m = landing.match(/[?&]([a-z_]+)=([^&]+)/gi) ?? [];
      for (const piece of m) {
        const [, k, v] = piece.match(/[?&]([a-z_]+)=([^&]+)/i) ?? [];
        if (!k) continue;
        if (["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].includes(k.toLowerCase())) {
          try { fields.push(decodeURIComponent(v)); } catch { fields.push(v); }
        }
      }
    }
    // discount codes are also a useful attribution signal
    const codes = Array.isArray(p?.discount_codes) ? p.discount_codes : [];
    for (const c of codes) if (c?.code) fields.push(String(c.code));
    total = Number(p?.current_total_price ?? p?.total_price ?? 0);
    currency = p?.currency ?? null;
    const items = Array.isArray(p?.line_items) ? p.line_items : [];
    product = items[0]?.title ?? null;
  }
  return { fields, total, currency, product };
}

export const getAgentSalesAttribution = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      agentId: z.string().uuid(),
      from: z.string(),
      to: z.string(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const brandId = await assertAgentBrand(context.userId, data.agentId);
    const { data: agent } = await supabaseAdmin
      .from("ai_agents")
      .select("tracking_tag")
      .eq("id", data.agentId)
      .maybeSingle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tag = ((agent as any)?.tracking_tag ?? "").trim();
    if (!tag) {
      return {
        tracking_tag: null,
        attributed: { count: 0, gross_value: 0, currency_breakdown: {} as Record<string, number>, top_products: [] as Array<{ name: string; count: number; value: number }>, daily: [] as Array<{ day: string; count: number; value: number }> },
        total_sales_in_period: 0,
      };
    }
    const tagLower = tag.toLowerCase();

    const { data: events, error } = await supabaseAdmin
      .from("integration_events")
      .select("id, platform, event_type, payload, created_at")
      .eq("brand_id", brandId)
      .in("event_type", ["purchase_approved", "purchase_complete", "order_paid"])
      .gte("created_at", data.from)
      .lte("created_at", data.to)
      .order("created_at", { ascending: true })
      .limit(10000);
    if (error) throw new Error(error.message);

    let count = 0;
    let gross = 0;
    const byCurrency = new Map<string, number>();
    const byProduct = new Map<string, { count: number; value: number }>();
    const byDay = new Map<string, { day: string; count: number; value: number }>();

    for (const ev of events ?? []) {
      const ext = extractAttribution(ev.platform as string, ev.payload);
      const matched = ext.fields.some((f) => f && f.toLowerCase().includes(tagLower));
      if (!matched) continue;
      count++;
      gross += ext.total;
      const cur = ext.currency ?? "—";
      byCurrency.set(cur, (byCurrency.get(cur) ?? 0) + ext.total);
      if (ext.product) {
        const cur2 = byProduct.get(ext.product) ?? { count: 0, value: 0 };
        cur2.count++;
        cur2.value += ext.total;
        byProduct.set(ext.product, cur2);
      }
      const dk = (ev.created_at as string).slice(0, 10);
      const d = byDay.get(dk) ?? { day: dk, count: 0, value: 0 };
      d.count++;
      d.value += ext.total;
      byDay.set(dk, d);
    }

    return {
      tracking_tag: tag,
      attributed: {
        count,
        gross_value: Number(gross.toFixed(2)),
        currency_breakdown: Object.fromEntries(
          Array.from(byCurrency.entries()).map(([k, v]) => [k, Number(v.toFixed(2))]),
        ),
        top_products: Array.from(byProduct.entries())
          .map(([name, v]) => ({ name, count: v.count, value: Number(v.value.toFixed(2)) }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10),
        daily: Array.from(byDay.values())
          .sort((a, b) => a.day.localeCompare(b.day))
          .map((d) => ({ ...d, value: Number(d.value.toFixed(2)) })),
      },
      total_sales_in_period: (events ?? []).length,
    };
  });

