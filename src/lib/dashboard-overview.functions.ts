import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function extractAttribution(platform: string, payload: unknown): {
  fields: string[];
  utms: { source?: string; medium?: string; campaign?: string; content?: string; term?: string };
  sck: string | null;
  total: number;
  currency: string | null;
  product: string | null;
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = (payload ?? {}) as any;
  const fields: string[] = [];
  const utms: { source?: string; medium?: string; campaign?: string; content?: string; term?: string } = {};
  let sck: string | null = null;
  let total = 0;
  let currency: string | null = null;
  let product: string | null = null;
  if (platform === "hotmart") {
    const purchase = p?.data?.purchase ?? {};
    const origin = purchase?.origin ?? {};
    if (origin.sck) {
      sck = String(origin.sck);
      fields.push(sck);
    }
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
        const key = k.toLowerCase();
        let val = v;
        try { val = decodeURIComponent(v); } catch { /* keep raw */ }
        if (["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].includes(key)) {
          fields.push(val);
          if (key === "utm_source") utms.source = val;
          else if (key === "utm_medium") utms.medium = val;
          else if (key === "utm_campaign") utms.campaign = val;
          else if (key === "utm_content") utms.content = val;
          else if (key === "utm_term") utms.term = val;
        }
      }
    }
    const codes = Array.isArray(p?.discount_codes) ? p.discount_codes : [];
    for (const c of codes) if (c?.code) fields.push(String(c.code));
    total = Number(p?.current_total_price ?? p?.total_price ?? 0);
    currency = p?.currency ?? null;
    const items = Array.isArray(p?.line_items) ? p.line_items : [];
    product = items[0]?.title ?? null;
  }
  return { fields, utms, sck, total, currency, product };
}


async function assertBrand(userId: string, brandId: string) {
  const { data: ok } = await supabaseAdmin.rpc("has_brand_access", {
    _user_id: userId,
    _brand_id: brandId,
  });
  if (!ok) throw new Response("Forbidden", { status: 403 });
}

const PAGE_SIZE = 1000;
const MAX_ROWS = 100000;

// Paginates a PostgREST query in chunks of 1000 (the default max-rows cap).
// `build` receives a fresh query builder per page and must apply filters/select/order;
// only `.range()` is added here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllPaginated<T>(build: () => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await build().range(from, to);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

export const getWorkspaceDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      brandId: z.string().uuid(),
      from: z.string(),
      to: z.string(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertBrand(context.userId, data.brandId);

    // ===== Agents =====
    const { data: agents } = await supabaseAdmin
      .from("ai_agents")
      .select("id, name, status, tracking_tag")
      .eq("brand_id", data.brandId);

    const agentIds = (agents ?? []).map((a) => a.id as string);

    const runs = agentIds.length
      ? await fetchAllPaginated<{ agent_id: string; status: string; model: string; tokens_in: number; tokens_out: number; conversation_id: string | null; created_at: string }>(
          () =>
            supabaseAdmin
              .from("ai_agent_runs")
              .select("agent_id, status, model, tokens_in, tokens_out, conversation_id, created_at")
              .eq("brand_id", data.brandId)
              .gte("created_at", data.from)
              .lte("created_at", data.to),
        )
      : [];

    const { data: pricing } = await supabaseAdmin
      .from("ai_model_pricing")
      .select("model, input_per_1k, output_per_1k");
    const priceMap = new Map<string, { i: number; o: number }>();
    (pricing ?? []).forEach((p) => priceMap.set(p.model as string, {
      i: Number(p.input_per_1k ?? 0),
      o: Number(p.output_per_1k ?? 0),
    }));

    type AgentAgg = {
      agent_id: string;
      name: string;
      status: string;
      tracking_tag: string | null;
      activations: number;
      success: number;
      escalated: number;
      errors: number;
      cost_usd: number;
      first_reply_engaged: number;
      first_reply_total: number;
      first_reply_rate: number;
      attributed_sales_count: number;
      attributed_sales_value: number;
      // tracking helpers
      _firstSuccessByConv: Map<string, string>;
    };

    const agentMap = new Map<string, AgentAgg>();
    for (const a of agents ?? []) {
      agentMap.set(a.id as string, {
        agent_id: a.id as string,
        name: (a.name as string) ?? "—",
        status: (a.status as string) ?? "off",
        tracking_tag: ((a as { tracking_tag?: string }).tracking_tag ?? null) || null,
        activations: 0,
        success: 0,
        escalated: 0,
        errors: 0,
        cost_usd: 0,
        first_reply_engaged: 0,
        first_reply_total: 0,
        first_reply_rate: 0,
        attributed_sales_count: 0,
        attributed_sales_value: 0,
        _firstSuccessByConv: new Map(),
      });
    }

    let totalAiCost = 0;
    const allConvIds = new Set<string>();
    for (const r of runs ?? []) {
      const a = agentMap.get(r.agent_id as string);
      if (!a) continue;
      a.activations++;
      const status = r.status as string;
      if (status === "success") a.success++;
      else if (status === "escalated") a.escalated++;
      else if (status !== "rate_limited") a.errors++;
      const ti = Number(r.tokens_in ?? 0);
      const to = Number(r.tokens_out ?? 0);
      const price = priceMap.get(r.model as string) ?? { i: 0, o: 0 };
      const cost = (ti / 1000) * price.i + (to / 1000) * price.o;
      a.cost_usd += cost;
      totalAiCost += cost;

      if (r.conversation_id) {
        allConvIds.add(r.conversation_id as string);
        if (status === "success") {
          const cid = r.conversation_id as string;
          const cur = a._firstSuccessByConv.get(cid);
          const ts = r.created_at as string;
          if (!cur || ts < cur) a._firstSuccessByConv.set(cid, ts);
        }
      }
    }

    // First-reply: query inbound messages once for all conversations
    const allConvArr = Array.from(allConvIds);
    let resolvedWithoutHuman = 0;
    let totalConversations = allConvArr.length;
    if (allConvArr.length > 0) {
      const { data: convs } = await supabaseAdmin
        .from("conversations")
        .select("id, status, assigned_to")
        .in("id", allConvArr);
      for (const c of convs ?? []) {
        if (c.status === "resolvido" && !c.assigned_to) resolvedWithoutHuman++;
      }
    }

    // Collect all (agent, convId, agentTs) pairs
    const allFirstSuccess: Array<{ agentId: string; convId: string; ts: string }> = [];
    for (const a of agentMap.values()) {
      a.first_reply_total = a._firstSuccessByConv.size;
      for (const [cid, ts] of a._firstSuccessByConv) {
        allFirstSuccess.push({ agentId: a.agent_id, convId: cid, ts });
      }
    }
    if (allFirstSuccess.length > 0) {
      const convIdsForReply = Array.from(new Set(allFirstSuccess.map((x) => x.convId)));
      const minTs = allFirstSuccess.map((x) => x.ts).sort()[0];
      const msgs = await fetchAllPaginated<{ conversation_id: string; created_at: string; direction: string }>(
        () =>
          supabaseAdmin
            .from("messages")
            .select("conversation_id, created_at, direction")
            .in("conversation_id", convIdsForReply)
            .eq("direction", "inbound")
            .gte("created_at", minTs)
            .order("created_at", { ascending: true }),
      );
      const firstInboundAfter = new Map<string, string[]>(); // conv -> sorted asc inbound timestamps
      for (const m of msgs ?? []) {
        const cid = m.conversation_id as string;
        if (!firstInboundAfter.has(cid)) firstInboundAfter.set(cid, []);
        firstInboundAfter.get(cid)!.push(m.created_at as string);
      }
      for (const x of allFirstSuccess) {
        const list = firstInboundAfter.get(x.convId) ?? [];
        if (list.some((ts) => ts > x.ts)) {
          const a = agentMap.get(x.agentId);
          if (a) a.first_reply_engaged++;
        }
      }
    }
    for (const a of agentMap.values()) {
      a.first_reply_rate = a.first_reply_total > 0 ? a.first_reply_engaged / a.first_reply_total : 0;
    }

    // ===== Automations =====
    const autoRuns = await fetchAllPaginated<{ id: string; automation_id: string; status: string; started_at: string; finished_at: string | null; last_error: string | null }>(
      () =>
        supabaseAdmin
          .from("automation_runs")
          .select("id, automation_id, status, started_at, finished_at, last_error")
          .eq("brand_id", data.brandId)
          .gte("started_at", data.from)
          .lte("started_at", data.to),
    );

    const aRuns = autoRuns.length;
    let aFinished = 0;
    let aFailed = 0;
    let aWaiting = 0;
    let aRunning = 0;
    const byAuto = new Map<string, { runs: number; failed: number }>();
    for (const r of autoRuns ?? []) {
      const s = r.status as string;
      if (s === "finished") aFinished++;
      else if (s === "failed") aFailed++;
      else if (s === "waiting") aWaiting++;
      else if (s === "running") aRunning++;
      const aid = r.automation_id as string;
      const cur = byAuto.get(aid) ?? { runs: 0, failed: 0 };
      cur.runs++;
      if (s === "failed") cur.failed++;
      byAuto.set(aid, cur);
    }
    const topAutoIds = Array.from(byAuto.entries())
      .sort((a, b) => b[1].runs - a[1].runs)
      .slice(0, 10)
      .map(([id]) => id);
    let topAutomations: Array<{ id: string; name: string; runs: number; failed: number }> = [];
    if (topAutoIds.length > 0) {
      const { data: autos } = await supabaseAdmin
        .from("automations")
        .select("id, name")
        .in("id", topAutoIds);
      const nameMap = new Map((autos ?? []).map((a) => [a.id as string, (a.name as string) ?? "—"]));
      topAutomations = topAutoIds.map((id) => {
        const v = byAuto.get(id)!;
        return { id, name: nameMap.get(id) ?? "—", runs: v.runs, failed: v.failed };
      });
    }

    // ===== Sales =====
    const events = await fetchAllPaginated<{ id: string; platform: string; event_type: string; payload: unknown; created_at: string }>(
      () =>
        supabaseAdmin
          .from("integration_events")
          .select("id, platform, event_type, payload, created_at")
          .eq("brand_id", data.brandId)
          .in("event_type", ["purchase_approved", "purchase_complete", "order_paid"])
          .gte("created_at", data.from)
          .lte("created_at", data.to),
    );

    // Load Rastreio (sales_trackers + codes)
    const { data: trackerRows } = await supabaseAdmin
      .from("sales_trackers")
      .select("id, name, kind, active")
      .eq("brand_id", data.brandId)
      .eq("active", true);
    const trackerIds = (trackerRows ?? []).map((t) => t.id as string);
    const { data: trackerCodes } = trackerIds.length
      ? await supabaseAdmin
          .from("sales_tracker_codes")
          .select("tracker_id, kind, sck, utm_source, utm_medium, utm_campaign, utm_content, utm_term, active")
          .eq("brand_id", data.brandId)
          .eq("active", true)
          .in("tracker_id", trackerIds)
      : { data: [] };

    type TrackerInfo = { id: string; name: string; kind: "seller" | "automation" };
    const trackerInfo = new Map<string, TrackerInfo>();
    for (const t of trackerRows ?? []) {
      trackerInfo.set(t.id as string, {
        id: t.id as string,
        name: (t.name as string) ?? "—",
        kind: t.kind as "seller" | "automation",
      });
    }

    // Build SCK index and UTM index
    const sckMap = new Map<string, string>(); // lower(sck) -> tracker_id
    type UtmRule = { tracker_id: string; campaign?: string; content?: string; source?: string; medium?: string; term?: string };
    const utmRules: UtmRule[] = [];
    for (const c of trackerCodes ?? []) {
      const tid = c.tracker_id as string;
      if (c.kind === "sck" && c.sck) {
        sckMap.set(String(c.sck).trim().toLowerCase(), tid);
      } else if (c.kind === "utm") {
        utmRules.push({
          tracker_id: tid,
          campaign: c.utm_campaign ? String(c.utm_campaign).trim().toLowerCase() : undefined,
          content: c.utm_content ? String(c.utm_content).trim().toLowerCase() : undefined,
          source: c.utm_source ? String(c.utm_source).trim().toLowerCase() : undefined,
          medium: c.utm_medium ? String(c.utm_medium).trim().toLowerCase() : undefined,
          term: c.utm_term ? String(c.utm_term).trim().toLowerCase() : undefined,
        });
      }
    }

    function matchUtm(evUtms: { source?: string; medium?: string; campaign?: string; content?: string; term?: string }): string | null {
      const lc = (s?: string) => (s ?? "").trim().toLowerCase();
      const ev = {
        source: lc(evUtms.source), medium: lc(evUtms.medium), campaign: lc(evUtms.campaign),
        content: lc(evUtms.content), term: lc(evUtms.term),
      };
      for (const r of utmRules) {
        const checks: boolean[] = [];
        let any = false;
        if (r.campaign !== undefined) { checks.push(ev.campaign === r.campaign); any = true; }
        if (r.content !== undefined) { checks.push(ev.content === r.content); any = true; }
        if (r.source !== undefined) { checks.push(ev.source === r.source); any = true; }
        if (r.medium !== undefined) { checks.push(ev.medium === r.medium); any = true; }
        if (r.term !== undefined) { checks.push(ev.term === r.term); any = true; }
        if (any && checks.every(Boolean)) return r.tracker_id;
      }
      return null;
    }

    let salesCount = 0; // total raw sales (before filter), kept for diagnostics
    let attributedSalesCount = 0;
    let attributedSalesValue = 0;
    const salesByCurrency = new Map<string, number>();
    const salesByDay = new Map<string, { day: string; agent: number; seller: number; automation: number; agent_value: number; seller_value: number; automation_value: number }>();

    type TrackerAgg = { id: string; name: string; kind: "seller" | "automation"; count: number; value: number };
    const trackerAgg = new Map<string, TrackerAgg>();

    // Pre-compute lowercase agent tags
    const agentTags: Array<{ agent: AgentAgg; tag: string }> = [];
    for (const a of agentMap.values()) {
      if (a.tracking_tag && a.tracking_tag.trim()) {
        agentTags.push({ agent: a, tag: a.tracking_tag.trim().toLowerCase() });
      }
    }

    for (const ev of events ?? []) {
      const ext = extractAttribution(ev.platform as string, ev.payload);
      salesCount++;

      // Try agent first (existing logic)
      const fieldsLower = ext.fields.map((f) => (f ?? "").toLowerCase());
      let attributedAgent: AgentAgg | null = null;
      for (const { agent, tag } of agentTags) {
        if (fieldsLower.some((f) => f.includes(tag))) {
          attributedAgent = agent;
          break;
        }
      }

      // Try tracker via SCK then UTM
      let attributedTracker: TrackerInfo | null = null;
      if (!attributedAgent) {
        if (ext.sck) {
          const tid = sckMap.get(ext.sck.trim().toLowerCase());
          if (tid) attributedTracker = trackerInfo.get(tid) ?? null;
        }
        if (!attributedTracker) {
          const tid = matchUtm(ext.utms);
          if (tid) attributedTracker = trackerInfo.get(tid) ?? null;
        }
        // Also fall back to scanning all fields against SCK map (Hotmart sometimes places sck in src)
        if (!attributedTracker) {
          for (const f of fieldsLower) {
            const tid = sckMap.get(f);
            if (tid) { attributedTracker = trackerInfo.get(tid) ?? null; break; }
          }
        }
      }

      if (!attributedAgent && !attributedTracker) continue; // discard

      attributedSalesCount++;
      attributedSalesValue += ext.total;
      const cur = ext.currency ?? "—";
      salesByCurrency.set(cur, (salesByCurrency.get(cur) ?? 0) + ext.total);
      const dk = (ev.created_at as string).slice(0, 10);
      const d = salesByDay.get(dk) ?? { day: dk, agent: 0, seller: 0, automation: 0, agent_value: 0, seller_value: 0, automation_value: 0 };

      if (attributedAgent) {
        attributedAgent.attributed_sales_count++;
        attributedAgent.attributed_sales_value += ext.total;
        d.agent++;
        d.agent_value += ext.total;
      } else if (attributedTracker) {
        const cur2 = trackerAgg.get(attributedTracker.id) ?? {
          id: attributedTracker.id, name: attributedTracker.name, kind: attributedTracker.kind, count: 0, value: 0,
        };
        cur2.count++; cur2.value += ext.total;
        trackerAgg.set(attributedTracker.id, cur2);
        if (attributedTracker.kind === "seller") { d.seller++; d.seller_value += ext.total; }
        else { d.automation++; d.automation_value += ext.total; }
      }
      salesByDay.set(dk, d);
    }

    const agentList = Array.from(agentMap.values())
      .map((a) => {
        const { _firstSuccessByConv: _omit, ...rest } = a;
        return {
          ...rest,
          cost_usd: Number(rest.cost_usd.toFixed(4)),
          attributed_sales_value: Number(rest.attributed_sales_value.toFixed(2)),
        };
      })
      .sort((a, b) => b.activations - a.activations);

    const sellerAggList = Array.from(trackerAgg.values()).filter((t) => t.kind === "seller").sort((a, b) => b.value - a.value);
    const automationAggList = Array.from(trackerAgg.values()).filter((t) => t.kind === "automation").sort((a, b) => b.value - a.value);

    const agentSalesCount = agentList.reduce((s, a) => s + a.attributed_sales_count, 0);
    const agentSalesValue = agentList.reduce((s, a) => s + a.attributed_sales_value, 0);
    const sellerSalesCount = sellerAggList.reduce((s, t) => s + t.count, 0);
    const sellerSalesValue = sellerAggList.reduce((s, t) => s + t.value, 0);
    const automationSalesCount = automationAggList.reduce((s, t) => s + t.count, 0);
    const automationSalesValue = automationAggList.reduce((s, t) => s + t.value, 0);

    return {
      range: { from: data.from, to: data.to },
      totals: {
        conversations: totalConversations,
        resolved_without_human: resolvedWithoutHuman,
        resolution_rate: totalConversations > 0 ? resolvedWithoutHuman / totalConversations : 0,
        ai_cost_usd: Number(totalAiCost.toFixed(4)),
        ai_activations: (runs ?? []).length,
        first_reply_engaged: agentList.reduce((s, a) => s + a.first_reply_engaged, 0),
        first_reply_total: agentList.reduce((s, a) => s + a.first_reply_total, 0),
        sales_count: attributedSalesCount,
        sales_value: Number(attributedSalesValue.toFixed(2)),
        sales_raw_count: salesCount,
        attributed_count: attributedSalesCount,
        attributed_value: Number(attributedSalesValue.toFixed(2)),
      },
      agents: agentList,
      automations: {
        runs: aRuns,
        finished: aFinished,
        failed: aFailed,
        waiting: aWaiting,
        running: aRunning,
        top: topAutomations,
      },
      sales: {
        count: attributedSalesCount,
        value: Number(attributedSalesValue.toFixed(2)),
        raw_count: salesCount,
        currency_breakdown: Object.fromEntries(
          Array.from(salesByCurrency.entries()).map(([k, v]) => [k, Number(v.toFixed(2))]),
        ),
        daily: Array.from(salesByDay.values())
          .sort((a, b) => a.day.localeCompare(b.day))
          .map((d) => ({
            ...d,
            agent_value: Number(d.agent_value.toFixed(2)),
            seller_value: Number(d.seller_value.toFixed(2)),
            automation_value: Number(d.automation_value.toFixed(2)),
          })),
        breakdown: {
          agent: { count: agentSalesCount, value: Number(agentSalesValue.toFixed(2)) },
          seller: { count: sellerSalesCount, value: Number(sellerSalesValue.toFixed(2)) },
          automation: { count: automationSalesCount, value: Number(automationSalesValue.toFixed(2)) },
        },
        top_sellers: sellerAggList.slice(0, 10).map((t) => ({ id: t.id, name: t.name, count: t.count, value: Number(t.value.toFixed(2)) })),
        top_automations: automationAggList.slice(0, 10).map((t) => ({ id: t.id, name: t.name, count: t.count, value: Number(t.value.toFixed(2)) })),
      },
    };

  });
