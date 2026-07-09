// Tools for the Copilot agent. Read tools operate via the user's authenticated
// Supabase client (RLS applied). Write tools also run as the user (so the user
// can only do via Copilot what they could do via the UI), but additionally
// record an entry in `copilot_audit_log` via the service-role client.

import { tool } from "ai";
import { z } from "zod";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

interface ToolCtx {
  supabase: SupabaseClient;
  brandId: string;
  userId: string;
  threadId: string;
}

function fmt(rows: any[] | null, limit = 50) {
  const arr = rows ?? [];
  return { count: arr.length, items: arr.slice(0, limit) };
}

function getAuditClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function recordAudit(
  ctx: ToolCtx,
  tool: string,
  args: unknown,
  result: unknown,
  ok: boolean,
  error?: string,
) {
  try {
    const admin = getAuditClient();
    if (!admin) return;
    await admin.from("copilot_audit_log").insert({
      brand_id: ctx.brandId,
      user_id: ctx.userId,
      thread_id: ctx.threadId,
      tool,
      args: (args ?? {}) as never,
      result: (result ?? null) as never,
      ok,
      error: error ?? null,
    });
  } catch (e) {
    console.error("[copilot] audit log failed", e);
  }
}

export function buildCopilotTools(ctx: ToolCtx) {
  const { supabase, brandId } = ctx;

  return {
    query_contacts: tool({
      description:
        "Busca contatos do workspace ativo por nome, profile do WhatsApp ou telefone. Pode filtrar por tag. Retorna até 50.",
      inputSchema: z.object({
        search: z.string().optional().describe("Texto livre (nome, profile name ou telefone)"),
        tagId: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      execute: async ({ search, tagId, limit }) => {
        let q = supabase
          .from("contacts")
          .select("id, name, profile_name, phone, created_at")
          .eq("brand_id", brandId)
          .order("created_at", { ascending: false })
          .limit(limit);
        if (search) {
          q = q.or(
            `name.ilike.%${search}%,profile_name.ilike.%${search}%,phone.ilike.%${search}%`,
          );
        }
        if (tagId) {
          const { data: tagRows } = await supabase
            .from("contact_tags")
            .select("contact_id")
            .eq("tag_id", tagId)
            .limit(500);
          const ids = (tagRows ?? []).map((r: any) => r.contact_id);
          if (ids.length === 0) return { count: 0, items: [] };
          q = q.in("id", ids);
        }
        const { data, error } = await q;
        if (error) return { error: error.message };
        return fmt(data, limit);
      },
    }),


    query_conversations: tool({
      description:
        "Lista conversas do workspace. Pode filtrar por status (open, pending, resolved, snoozed), agente IA, usuário responsável ou contato.",
      inputSchema: z.object({
        status: z.string().optional(),
        assignedTo: z.string().min(1).optional().describe("user_id do agente humano"),
        aiAgentId: z.string().min(1).optional(),
        contactId: z.string().min(1).optional(),
        sinceHours: z.number().int().min(1).max(720).optional(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      execute: async (args) => {
        let q = supabase
          .from("conversations")
          .select(
            "id, status, assigned_to, ai_agent_id, contact_id, unread_count, last_inbound_at, last_message_at, updated_at",
          )
          .eq("brand_id", brandId)
          .order("updated_at", { ascending: false })
          .limit(args.limit);
        if (args.status) q = q.eq("status", args.status);
        if (args.assignedTo) q = q.eq("assigned_to", args.assignedTo);
        if (args.aiAgentId) q = q.eq("ai_agent_id", args.aiAgentId);
        if (args.contactId) q = q.eq("contact_id", args.contactId);
        if (args.sinceHours) {
          const since = new Date(Date.now() - args.sinceHours * 3600_000).toISOString();
          q = q.gte("updated_at", since);
        }
        const { data, error } = await q;
        if (error) return { error: error.message };
        return fmt(data, args.limit);
      },
    }),

    query_pipelines: tool({
      description: "Lista pipelines do workspace com etapas e contagem de cards por etapa.",
      inputSchema: z.object({}),
      execute: async () => {
        const { data: pipes, error } = await supabase
          .from("pipelines")
          .select("id, name, description, position")
          .eq("brand_id", brandId)
          .order("position");
        if (error) return { error: error.message };
        const result: any[] = [];
        for (const p of pipes ?? []) {
          const { data: stages } = await supabase
            .from("pipeline_stages")
            .select("id, name, position, on_enter_status")
            .eq("pipeline_id", p.id)
            .order("position");
          const stageInfo: any[] = [];
          for (const s of stages ?? []) {
            const { count } = await supabase
              .from("pipeline_contacts")
              .select("id", { head: true, count: "exact" })
              .eq("pipeline_id", p.id)
              .eq("stage_id", s.id);
            stageInfo.push({ id: s.id, name: s.name, on_enter_status: s.on_enter_status, cards: count ?? 0 });
          }
          result.push({ id: p.id, name: p.name, description: p.description, stages: stageInfo });
        }
        return { count: result.length, items: result };
      },
    }),

    query_pipeline_activities: tool({
      description:
        "Lista atividades de contatos em pipelines (mensagens automáticas, movimentações de etapa, tarefas). Use para investigar o que acontece em cada etapa por dia. Status comuns: pending, scheduled, sent, failed, cancelled, executed.",
      inputSchema: z.object({
        pipelineId: z.string().min(1).optional(),
        stageId: z.string().min(1).optional(),
        status: z.string().optional(),
        sinceHours: z.number().int().min(1).max(720).default(168),
        limit: z.number().int().min(1).max(100).default(50),
      }),
      execute: async (args) => {
        let q = supabase
          .from("pipeline_contact_activities")
          .select(
            "id, pipeline_id, stage_id, contact_id, kind, mode, name, status, due_at, executed_at, error_message, created_at",
          )
          .eq("brand_id", brandId)
          .gte("created_at", new Date(Date.now() - args.sinceHours * 3600_000).toISOString())
          .order("created_at", { ascending: false })
          .limit(args.limit);
        if (args.pipelineId) q = q.eq("pipeline_id", args.pipelineId);
        if (args.stageId) q = q.eq("stage_id", args.stageId);
        if (args.status) q = q.eq("status", args.status);
        const { data, error } = await q;
        if (error) return { error: error.message };
        // breakdown por status para resumo rápido
        const byStatus: Record<string, number> = {};
        for (const r of data ?? []) byStatus[r.status ?? "unknown"] = (byStatus[r.status ?? "unknown"] ?? 0) + 1;
        return { count: data?.length ?? 0, byStatus, items: (data ?? []).slice(0, args.limit) };
      },
    }),

    query_automations: tool({
      description: "Lista automações do workspace (nome, status, gatilho).",
      inputSchema: z.object({
        status: z.string().optional().describe("draft, active, paused, archived..."),
        search: z.string().optional(),
      }),
      execute: async ({ status, search }) => {
        let q = supabase
          .from("automations")
          .select("id, name, status, trigger_type, trigger_tag, updated_at")
          .eq("brand_id", brandId)
          .order("updated_at", { ascending: false })
          .limit(50);
        if (status) q = q.eq("status", status);
        if (search) q = q.ilike("name", `%${search}%`);
        const { data, error } = await q;
        if (error) return { error: error.message };
        return fmt(data, 50);
      },
    }),

    query_automation_runs: tool({
      description:
        "Lista execuções de automação (runs). Status possíveis: waiting, running, completed, failed, cancelled, sleeping, waiting_button.",
      inputSchema: z.object({
        automationId: z.string().min(1).optional(),
        status: z.string().optional(),
        sinceHours: z.number().int().min(1).max(720).default(24),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      execute: async (args) => {
        let q = supabase
          .from("automation_runs")
          .select(
            "id, automation_id, conversation_id, contact_id, status, current_node_id, last_error, started_at, updated_at",
          )
          .eq("brand_id", brandId)
          .gte("started_at", new Date(Date.now() - args.sinceHours * 3600_000).toISOString())
          .order("started_at", { ascending: false })
          .limit(args.limit);
        if (args.automationId) q = q.eq("automation_id", args.automationId);
        if (args.status) q = q.eq("status", args.status);
        const { data, error } = await q;
        if (error) return { error: error.message };
        return fmt(data, args.limit);
      },
    }),

    query_ai_agents: tool({
      description:
        "Lista agentes de IA do workspace e estatísticas recentes (runs por status nas últimas 24h).",
      inputSchema: z.object({}),
      execute: async () => {
        const { data: agents, error } = await supabase
          .from("ai_agents")
          .select("id, name, status, model")
          .eq("brand_id", brandId);
        if (error) return { error: error.message };
        const since = new Date(Date.now() - 24 * 3600_000).toISOString();
        const result: any[] = [];
        for (const a of agents ?? []) {
          const { data: runs } = await supabase
            .from("ai_agent_runs")
            .select("status")
            .eq("agent_id", a.id)
            .gte("created_at", since);
          const counts: Record<string, number> = {};
          for (const r of runs ?? []) counts[r.status] = (counts[r.status] ?? 0) + 1;
          result.push({ ...a, last24h: counts });
        }
        return { count: result.length, items: result };
      },
    }),

    query_broadcasts: tool({
      description: "Lista broadcasts do workspace e progresso (despachados, falhas, pulados).",
      inputSchema: z.object({
        status: z.string().optional(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      execute: async ({ status, limit }) => {
        let q = supabase
          .from("broadcasts")
          .select(
            "id, name, status, total_targets, dispatched_count, failed_count, skipped_count, started_at, finished_at, created_at",
          )
          .eq("brand_id", brandId)
          .order("created_at", { ascending: false })
          .limit(limit);
        if (status) q = q.eq("status", status);
        const { data, error } = await q;
        if (error) return { error: error.message };
        return fmt(data, limit);
      },
    }),

    query_broadcast_responses: tool({
      description:
        "Mede engajamento de um broadcast: lista contatos que RESPONDERAM (mensagem inbound após o envio) e a taxa de resposta. Use sempre que o usuário perguntar quem interagiu/respondeu/reagiu a um broadcast — NÃO use query_conversations por data.",
      inputSchema: z.object({
        broadcastId: z.string().min(1).optional().describe("UUID do broadcast, se já souber"),
        broadcastNameSearch: z.string().optional().describe("Busca por nome do broadcast (ilike)"),
        onDate: z
          .string()
          .optional()
          .describe("Data de disparo no formato YYYY-MM-DD (filtra started_at desse dia)"),
        windowHours: z
          .number()
          .int()
          .min(1)
          .max(720)
          .default(168)
          .describe("Janela após o envio em que uma inbound conta como resposta"),
        includeContacts: z.boolean().default(true),
        limit: z.number().int().min(1).max(100).default(20),
      }),
      execute: async (args) => {
        // 1. Resolver broadcast
        let broadcast: any = null;
        if (args.broadcastId) {
          const { data, error } = await supabase
            .from("broadcasts")
            .select("id, name, status, started_at, total_targets, dispatched_count")
            .eq("brand_id", brandId)
            .eq("id", args.broadcastId)
            .maybeSingle();
          if (error) return { error: error.message };
          broadcast = data;
        } else {
          let q = supabase
            .from("broadcasts")
            .select("id, name, status, started_at, total_targets, dispatched_count")
            .eq("brand_id", brandId)
            .order("started_at", { ascending: false, nullsFirst: false })
            .limit(5);
          if (args.broadcastNameSearch) q = q.ilike("name", `%${args.broadcastNameSearch}%`);
          if (args.onDate) {
            const start = `${args.onDate}T00:00:00.000Z`;
            const end = `${args.onDate}T23:59:59.999Z`;
            q = q.gte("started_at", start).lte("started_at", end);
          }
          const { data, error } = await q;
          if (error) return { error: error.message };
          broadcast = (data ?? [])[0] ?? null;
        }
        if (!broadcast) return { error: "Broadcast não encontrado com os critérios informados." };

        // 2. Carregar targets despachados (paginar)
        const targets: { contact_id: string; dispatched_at: string; run_id: string | null }[] = [];
        const PAGE = 1000;
        for (let offset = 0; ; offset += PAGE) {
          const { data, error } = await supabase
            .from("broadcast_targets")
            .select("contact_id, dispatched_at, run_id")
            .eq("broadcast_id", broadcast.id)
            .eq("status", "dispatched")
            .not("dispatched_at", "is", null)
            .range(offset, offset + PAGE - 1);
          if (error) return { error: error.message };
          const rows = (data ?? []) as any[];
          for (const r of rows) targets.push(r);
          if (rows.length < PAGE) break;
          if (offset > 20000) break; // safety
        }

        if (targets.length === 0) {
          return {
            broadcast,
            windowHours: args.windowHours,
            dispatched_checked: 0,
            actually_delivered: 0,
            responded_count: 0,
            response_rate: "0/0 (0%)",
            response_rate_over_delivered: "0/0 (0%)",
            responders: [],
          };
        }

        const dispatchByContact = new Map<string, string>();
        for (const t of targets) {
          const prev = dispatchByContact.get(t.contact_id);
          if (!prev || new Date(t.dispatched_at) < new Date(prev)) {
            dispatchByContact.set(t.contact_id, t.dispatched_at);
          }
        }
        const contactIds = Array.from(dispatchByContact.keys());
        const minDispatch = targets.reduce(
          (acc, t) => (acc < t.dispatched_at ? acc : t.dispatched_at),
          targets[0].dispatched_at,
        );
        const windowMs = args.windowHours * 3600_000;

        // 2b. Estimar entregas reais via automation_runs (status completed | waiting_button)
        const runIds = targets.map((t) => t.run_id).filter((x): x is string => !!x);
        const deliveredContactIds = new Set<string>();
        const RUN_BATCH = 500;
        for (let i = 0; i < runIds.length; i += RUN_BATCH) {
          const batch = runIds.slice(i, i + RUN_BATCH);
          const { data, error } = await supabase
            .from("automation_runs")
            .select("id, status, contact_id")
            .in("id", batch);
          if (error) return { error: error.message };
          for (const r of (data ?? []) as any[]) {
            if (r.status === "completed" || r.status === "waiting_button") {
              if (r.contact_id) deliveredContactIds.add(r.contact_id);
            }
          }
        }
        const actuallyDelivered = deliveredContactIds.size;

        // 3. Buscar inbounds via conversations (messages só tem conversation_id)
        const convIdToContact = new Map<string, string>();
        const CBATCH = 200;
        for (let i = 0; i < contactIds.length; i += CBATCH) {
          const batch = contactIds.slice(i, i + CBATCH);
          const { data, error } = await supabase
            .from("conversations")
            .select("id, contact_id")
            .eq("brand_id", brandId)
            .in("contact_id", batch);
          if (error) return { error: error.message };
          for (const c of (data ?? []) as any[]) {
            convIdToContact.set(c.id, c.contact_id);
          }
        }
        const convIds = Array.from(convIdToContact.keys());

        const firstReplyByContact = new Map<string, string>();
        const MBATCH = 200;
        for (let i = 0; i < convIds.length; i += MBATCH) {
          const batch = convIds.slice(i, i + MBATCH);
          const { data, error } = await supabase
            .from("messages")
            .select("conversation_id, created_at")
            .eq("direction", "inbound")
            .in("conversation_id", batch)
            .gte("created_at", minDispatch)
            .order("created_at", { ascending: true });
          if (error) return { error: error.message };
          for (const row of (data ?? []) as any[]) {
            const contactId = convIdToContact.get(row.conversation_id);
            if (!contactId) continue;
            const dispatchedAt = dispatchByContact.get(contactId);
            if (!dispatchedAt) continue;
            const replyAt = new Date(row.created_at).getTime();
            const dispatchT = new Date(dispatchedAt).getTime();
            if (replyAt < dispatchT) continue;
            if (replyAt > dispatchT + windowMs) continue;
            if (!firstReplyByContact.has(contactId)) {
              firstReplyByContact.set(contactId, row.created_at);
            }
          }
        }

        const responderIds = Array.from(firstReplyByContact.keys());
        const respondedCount = responderIds.length;
        const dispatchedChecked = contactIds.length;
        const pct = dispatchedChecked > 0 ? Math.round((respondedCount / dispatchedChecked) * 1000) / 10 : 0;
        const pctDelivered = actuallyDelivered > 0 ? Math.round((respondedCount / actuallyDelivered) * 1000) / 10 : 0;

        let responders: any[] = [];
        if (args.includeContacts && responderIds.length > 0) {
          const slice = responderIds.slice(0, args.limit);
          const { data: contacts } = await supabase
            .from("contacts")
            .select("id, name, profile_name, phone")
            .eq("brand_id", brandId)
            .in("id", slice);
          const byId = new Map((contacts ?? []).map((c: any) => [c.id, c]));
          responders = slice.map((id) => {
            const c = byId.get(id) as any;
            return {
              contact_id: id,
              name: c?.name ?? null,
              profile_name: c?.profile_name ?? null,
              phone: c?.phone ?? null,
              first_reply_at: firstReplyByContact.get(id) ?? null,
            };
          });
        }

        return {
          broadcast,
          windowHours: args.windowHours,
          dispatched_checked: dispatchedChecked,
          actually_delivered: actuallyDelivered,
          responded_count: respondedCount,
          response_rate: `${respondedCount}/${dispatchedChecked} (${pct}%)`,
          response_rate_over_delivered: `${respondedCount}/${actuallyDelivered} (${pctDelivered}%)`,
          note:
            actuallyDelivered < dispatchedChecked
              ? `Atenção: ${dispatchedChecked - actuallyDelivered} dos ${dispatchedChecked} envios não chegaram ao destinatário (ver query_broadcast_delivery para detalhes). A taxa real de resposta é ${pctDelivered}% sobre quem efetivamente recebeu.`
              : null,
          responders,
        };
      },
    }),

    query_broadcast_delivery: tool({
      description:
        "Mostra o estado REAL de entrega de um broadcast cruzando broadcast_targets com automation_runs. Use SEMPRE antes de avaliar respostas/engajamento de um broadcast — muitos targets marcados como 'dispatched' podem ter falhado (ex.: 'Janela 24h fechada' do WhatsApp). Retorna runs por status e principais erros.",
      inputSchema: z.object({
        broadcastId: z.string().min(1).optional(),
        broadcastNameSearch: z.string().optional(),
        onDate: z.string().optional().describe("YYYY-MM-DD (filtra started_at)"),
      }),
      execute: async (args) => {
        let broadcast: any = null;
        if (args.broadcastId) {
          const { data, error } = await supabase
            .from("broadcasts")
            .select("id, name, status, started_at, total_targets, dispatched_count, failed_count")
            .eq("brand_id", brandId)
            .eq("id", args.broadcastId)
            .maybeSingle();
          if (error) return { error: error.message };
          broadcast = data;
        } else {
          let q = supabase
            .from("broadcasts")
            .select("id, name, status, started_at, total_targets, dispatched_count, failed_count")
            .eq("brand_id", brandId)
            .order("started_at", { ascending: false, nullsFirst: false })
            .limit(5);
          if (args.broadcastNameSearch) q = q.ilike("name", `%${args.broadcastNameSearch}%`);
          if (args.onDate) {
            const start = `${args.onDate}T00:00:00.000Z`;
            const end = `${args.onDate}T23:59:59.999Z`;
            q = q.gte("started_at", start).lte("started_at", end);
          }
          const { data, error } = await q;
          if (error) return { error: error.message };
          broadcast = (data ?? [])[0] ?? null;
        }
        if (!broadcast) return { error: "Broadcast não encontrado." };

        // Carrega targets
        const targetsByStatus: Record<string, number> = {};
        const runIds: string[] = [];
        const PAGE = 1000;
        let totalTargets = 0;
        for (let offset = 0; ; offset += PAGE) {
          const { data, error } = await supabase
            .from("broadcast_targets")
            .select("status, run_id")
            .eq("broadcast_id", broadcast.id)
            .range(offset, offset + PAGE - 1);
          if (error) return { error: error.message };
          const rows = (data ?? []) as any[];
          for (const r of rows) {
            totalTargets++;
            targetsByStatus[r.status] = (targetsByStatus[r.status] ?? 0) + 1;
            if (r.run_id) runIds.push(r.run_id);
          }
          if (rows.length < PAGE) break;
          if (offset > 50000) break;
        }

        // Carrega runs
        const runsByStatus: Record<string, number> = {};
        const errorCounts = new Map<string, number>();
        const RBATCH = 500;
        for (let i = 0; i < runIds.length; i += RBATCH) {
          const batch = runIds.slice(i, i + RBATCH);
          const { data, error } = await supabase
            .from("automation_runs")
            .select("status, last_error")
            .in("id", batch);
          if (error) return { error: error.message };
          for (const r of (data ?? []) as any[]) {
            runsByStatus[r.status] = (runsByStatus[r.status] ?? 0) + 1;
            if (r.status === "failed" && r.last_error) {
              const key = String(r.last_error).slice(0, 200);
              errorCounts.set(key, (errorCounts.get(key) ?? 0) + 1);
            }
          }
        }

        const topErrors = Array.from(errorCounts.entries())
          .map(([error, count]) => ({ error, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5);

        const actuallyDelivered =
          (runsByStatus["completed"] ?? 0) + (runsByStatus["waiting_button"] ?? 0);
        const pct = totalTargets > 0 ? Math.round((actuallyDelivered / totalTargets) * 1000) / 10 : 0;

        return {
          broadcast: {
            id: broadcast.id,
            name: broadcast.name,
            status: broadcast.status,
            started_at: broadcast.started_at,
            total_targets: totalTargets,
          },
          targets_by_status: targetsByStatus,
          runs_by_status: runsByStatus,
          top_errors: topErrors,
          actually_delivered_estimate: actuallyDelivered,
          delivery_rate: `${actuallyDelivered}/${totalTargets} (${pct}%)`,
        };
      },
    }),

    query_messages_health: tool({
      description:
        "Resumo de mensagens das últimas N horas, agrupado por direção/status. Útil para diagnosticar problemas de entrega.",
      inputSchema: z.object({
        sinceHours: z.number().int().min(1).max(168).default(24),
      }),
      execute: async ({ sinceHours }) => {
        const since = new Date(Date.now() - sinceHours * 3600_000).toISOString();
        const { data, error } = await supabase
          .from("messages")
          .select("direction, status")
          .eq("brand_id", brandId)
          .gte("created_at", since)
          .limit(10_000);
        if (error) return { error: error.message };
        const totals: Record<string, number> = {};
        for (const m of data ?? []) {
          const key = `${m.direction}/${m.status ?? "unknown"}`;
          totals[key] = (totals[key] ?? 0) + 1;
        }
        return { sinceHours, total: data?.length ?? 0, breakdown: totals };
      },
    }),

    query_error_logs: tool({
      description: "Logs de erro recentes do workspace.",
      inputSchema: z.object({
        category: z.string().optional().describe("Ex: meta_api, automation, ai_agent"),
        sinceHours: z.number().int().min(1).max(168).default(24),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      execute: async ({ category, sinceHours, limit }) => {
        let q = supabase
          .from("error_logs")
          .select("id, severity, category, code, message_pt, created_at")
          .eq("brand_id", brandId)
          .gte("created_at", new Date(Date.now() - sinceHours * 3600_000).toISOString())
          .order("created_at", { ascending: false })
          .limit(limit);
        if (category) q = q.eq("category", category);
        const { data, error } = await q;
        if (error) return { error: error.message };
        return fmt(data, limit);
      },
    }),

    get_conversation_messages: tool({
      description:
        "Retorna as mensagens (texto, direção, status, data) de uma conversa específica para análise do diálogo. Use para investigar o que aconteceu em uma conversa: motivos de escalação, atendimento, satisfação.",
      inputSchema: z.object({
        conversationId: z.string().min(1),
        limit: z.number().int().min(1).max(100).default(50),
      }),
      execute: async ({ conversationId, limit }) => {
        const { data, error } = await supabase
          .from("messages")
          .select("id, direction, type, content, status, error_message, template_name, sent_by, created_at")
          .eq("brand_id", brandId)
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true })
          .limit(limit);
        if (error) return { error: error.message };
        return fmt(data, limit);
      },
    }),

    query_ai_agent_runs: tool({
      description:
        "Lista execuções de agentes de IA com detalhes (status, escalation_track, erro, resposta gerada, conversa). Use para diagnosticar motivos de escalações e falhas. Status comuns: completed, escalated, error.",
      inputSchema: z.object({
        agentId: z.string().min(1).optional(),
        conversationId: z.string().min(1).optional(),
        status: z.string().optional().describe("Ex: escalated, error, completed"),
        sinceHours: z.number().int().min(1).max(720).default(24),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      execute: async (args) => {
        let q = supabase
          .from("ai_agent_runs")
          .select(
            "id, agent_id, conversation_id, contact_id, status, escalation_track, error_code, error_message, output_text, tokens_in, tokens_out, latency_ms, created_at",
          )
          .eq("brand_id", brandId)
          .gte("created_at", new Date(Date.now() - args.sinceHours * 3600_000).toISOString())
          .order("created_at", { ascending: false })
          .limit(args.limit);
        if (args.agentId) q = q.eq("agent_id", args.agentId);
        if (args.conversationId) q = q.eq("conversation_id", args.conversationId);
        if (args.status) q = q.eq("status", args.status);
        const { data, error } = await q;
        if (error) return { error: error.message };
        return fmt(data, args.limit);
      },
    }),

    get_ai_agent_config: tool({
      description:
        "Retorna a configuração completa de um agente de IA, incluindo system_prompt (prompt do sistema), modelo, temperatura, max_output_tokens, janela de contexto, inputs dinâmicos e knowledge anexada. Use para analisar/diagnosticar/otimizar o prompt de um agente. Identifique o agentId via query_ai_agents.",
      inputSchema: z.object({
        agentId: z.string().min(1),
        includeKnowledge: z.boolean().default(false).describe("Se true, retorna também os itens de base de conhecimento vinculados (pode ser longo)."),
      }),
      execute: async ({ agentId, includeKnowledge }) => {
        const { data: agent, error } = await supabase
          .from("ai_agents")
          .select(
            "id, name, status, model, temperature, max_output_tokens, context_window_messages, response_delay_ms, system_prompt, inputs, whitelist, tracking_tag, escalation_target_suporte, escalation_target_vendas",
          )
          .eq("brand_id", brandId)
          .eq("id", agentId)
          .maybeSingle();
        if (error) return { error: error.message };
        if (!agent) return { error: "Agente não encontrado neste workspace." };
        let knowledge: any = undefined;
        if (includeKnowledge) {
          const { data: k } = await supabase
            .from("ai_agent_knowledge")
            .select("id, title, content_type, content")
            .eq("agent_id", agentId);
          knowledge = k ?? [];
        }
        return { agent, knowledge };
      },
    }),

    // =====================================================================
    // MUTATION TOOLS — escrita
    //
    // Executam via cliente do usuário (RLS aplicada). O modelo SEMPRE deve
    // confirmar com o usuário em linguagem natural antes de chamá-las.
    // Toda execução (sucesso ou falha) é registrada em copilot_audit_log.
    // =====================================================================

    set_conversation_status: tool({
      description:
        "Altera o status de uma conversa. Status válidos: 'aberto', 'pendente', 'resolvido'. SEMPRE confirme com o usuário antes de chamar.",
      inputSchema: z.object({
        conversationId: z.string().min(1),
        status: z.enum(["aberto", "pendente", "resolvido"]),
      }),
      execute: async (args) => {
        const { data, error } = await supabase
          .from("conversations")
          .update({ status: args.status })
          .eq("id", args.conversationId)
          .eq("brand_id", brandId)
          .select("id, status")
          .maybeSingle();
        if (error || !data) {
          const msg = error?.message ?? "Conversa não encontrada ou sem permissão.";
          await recordAudit(ctx, "set_conversation_status", args, null, false, msg);
          return { ok: false, error: msg };
        }
        await recordAudit(ctx, "set_conversation_status", args, data, true);
        return { ok: true, conversation: data };
      },
    }),

    assign_conversation: tool({
      description:
        "Atribui (ou desatribui) uma conversa a um usuário humano e/ou agente de IA. Para desatribuir, passe a string \"none\" no campo. SEMPRE confirme antes.",
      inputSchema: z.object({
        conversationId: z.string().min(1),
        userId: z.string().optional().describe("UUID do usuário humano, ou \"none\" para remover."),
        aiAgentId: z.string().optional().describe("UUID do agente de IA, ou \"none\" para remover."),
      }),
      execute: async (args) => {
        const patch: Record<string, unknown> = {};
        if (args.userId !== undefined) patch.assigned_to = args.userId === "none" ? null : args.userId;
        if (args.aiAgentId !== undefined) patch.ai_agent_id = args.aiAgentId === "none" ? null : args.aiAgentId;
        if (Object.keys(patch).length === 0) {
          return { ok: false, error: "Nada para alterar (informe userId e/ou aiAgentId)." };
        }
        const { data, error } = await supabase
          .from("conversations")
          .update(patch)
          .eq("id", args.conversationId)
          .eq("brand_id", brandId)
          .select("id, assigned_to, ai_agent_id")
          .maybeSingle();
        if (error || !data) {
          const msg = error?.message ?? "Conversa não encontrada ou sem permissão.";
          await recordAudit(ctx, "assign_conversation", args, null, false, msg);
          return { ok: false, error: msg };
        }
        await recordAudit(ctx, "assign_conversation", args, data, true);
        return { ok: true, conversation: data };
      },
    }),


    mark_conversation_read: tool({
      description: "Marca a conversa como lida (zera unread_count). Reversível — pode executar sem confirmação explícita.",
      inputSchema: z.object({ conversationId: z.string().min(1) }),
      execute: async (args) => {
        const { data, error } = await supabase
          .from("conversations")
          .update({ unread_count: 0 })
          .eq("id", args.conversationId)
          .eq("brand_id", brandId)
          .select("id, unread_count")
          .maybeSingle();
        if (error || !data) {
          const msg = error?.message ?? "Conversa não encontrada.";
          await recordAudit(ctx, "mark_conversation_read", args, null, false, msg);
          return { ok: false, error: msg };
        }
        await recordAudit(ctx, "mark_conversation_read", args, data, true);
        return { ok: true, conversation: data };
      },
    }),

    add_contact_tag: tool({
      description: "Aplica uma tag a um contato. SEMPRE confirme antes.",
      inputSchema: z.object({
        contactId: z.string().min(1),
        tagId: z.string().min(1),
      }),
      execute: async (args) => {
        const [{ data: contact }, { data: tag }] = await Promise.all([
          supabase.from("contacts").select("id").eq("id", args.contactId).eq("brand_id", brandId).maybeSingle(),
          supabase.from("tags").select("id").eq("id", args.tagId).eq("brand_id", brandId).maybeSingle(),
        ]);
        if (!contact || !tag) {
          const msg = "Contato ou tag não encontrados no workspace.";
          await recordAudit(ctx, "add_contact_tag", args, null, false, msg);
          return { ok: false, error: msg };
        }
        const { error } = await supabase
          .from("contact_tags")
          .upsert({ contact_id: args.contactId, tag_id: args.tagId }, { onConflict: "contact_id,tag_id" });
        if (error) {
          await recordAudit(ctx, "add_contact_tag", args, null, false, error.message);
          return { ok: false, error: error.message };
        }
        await recordAudit(ctx, "add_contact_tag", args, { applied: true }, true);
        return { ok: true };
      },
    }),

    remove_contact_tag: tool({
      description: "Remove uma tag de um contato. SEMPRE confirme antes.",
      inputSchema: z.object({
        contactId: z.string().min(1),
        tagId: z.string().min(1),
      }),
      execute: async (args) => {
        const { error } = await supabase
          .from("contact_tags")
          .delete()
          .eq("contact_id", args.contactId)
          .eq("tag_id", args.tagId);
        if (error) {
          await recordAudit(ctx, "remove_contact_tag", args, null, false, error.message);
          return { ok: false, error: error.message };
        }
        await recordAudit(ctx, "remove_contact_tag", args, { removed: true }, true);
        return { ok: true };
      },
    }),

    set_contact_custom_field: tool({
      description:
        "Define o valor de um campo personalizado do contato (mescla em contacts.metadata.custom). SEMPRE confirme antes.",
      inputSchema: z.object({
        contactId: z.string().min(1),
        key: z.string().min(1),
        value: z.string().describe("Valor como string. Para limpar, envie string vazia."),
      }),
      execute: async (args) => {
        const { data: row, error: rErr } = await supabase
          .from("contacts")
          .select("metadata")
          .eq("id", args.contactId)
          .eq("brand_id", brandId)
          .maybeSingle();
        if (rErr || !row) {
          const msg = rErr?.message ?? "Contato não encontrado.";
          await recordAudit(ctx, "set_contact_custom_field", args, null, false, msg);
          return { ok: false, error: msg };
        }
        const metadata = (row.metadata ?? {}) as Record<string, any>;
        const custom = { ...(metadata.custom ?? {}), [args.key]: args.value };
        const nextMeta = { ...metadata, custom };
        const { error } = await supabase
          .from("contacts")
          .update({ metadata: nextMeta, updated_at: new Date().toISOString() })
          .eq("id", args.contactId)
          .eq("brand_id", brandId);
        if (error) {
          await recordAudit(ctx, "set_contact_custom_field", args, null, false, error.message);
          return { ok: false, error: error.message };
        }
        await recordAudit(ctx, "set_contact_custom_field", args, { key: args.key, value: args.value }, true);
        return { ok: true };
      },
    }),

    move_contact_to_stage: tool({
      description:
        "Move um contato para uma etapa específica de um pipeline. Cria a entrada se ainda não existir. SEMPRE confirme antes.",
      inputSchema: z.object({
        contactId: z.string().min(1),
        pipelineId: z.string().min(1),
        stageId: z.string().min(1),
      }),
      execute: async (args) => {
        const { data: stage } = await supabase
          .from("pipeline_stages")
          .select("id, pipeline_id")
          .eq("id", args.stageId)
          .eq("pipeline_id", args.pipelineId)
          .maybeSingle();
        if (!stage) {
          const msg = "Etapa não encontrada no pipeline informado.";
          await recordAudit(ctx, "move_contact_to_stage", args, null, false, msg);
          return { ok: false, error: msg };
        }
        const { data: existing } = await supabase
          .from("pipeline_contacts")
          .select("id")
          .eq("pipeline_id", args.pipelineId)
          .eq("contact_id", args.contactId)
          .maybeSingle();
        const nowIso = new Date().toISOString();
        if (existing) {
          const { error } = await supabase
            .from("pipeline_contacts")
            .update({ stage_id: args.stageId, moved_by: ctx.userId, moved_at: nowIso })
            .eq("id", existing.id);
          if (error) {
            await recordAudit(ctx, "move_contact_to_stage", args, null, false, error.message);
            return { ok: false, error: error.message };
          }
        } else {
          const { error } = await supabase.from("pipeline_contacts").insert({
            pipeline_id: args.pipelineId,
            stage_id: args.stageId,
            contact_id: args.contactId,
            brand_id: brandId,
            position: 0,
            moved_by: ctx.userId,
            moved_at: nowIso,
            status: "active",
          });
          if (error) {
            await recordAudit(ctx, "move_contact_to_stage", args, null, false, error.message);
            return { ok: false, error: error.message };
          }
        }
        await recordAudit(ctx, "move_contact_to_stage", args, { moved: true }, true);
        return { ok: true };
      },
    }),

    add_to_blocklist: tool({
      description:
        "Adiciona o telefone de um contato à blocklist do workspace (bloqueia futuras mensagens/automações). SEMPRE confirme antes.",
      inputSchema: z.object({
        contactId: z.string().min(1),
        reason: z.string().optional(),
      }),
      execute: async (args) => {
        const { data: contact } = await supabase
          .from("contacts")
          .select("phone, wa_id")
          .eq("id", args.contactId)
          .eq("brand_id", brandId)
          .maybeSingle();
        const value = contact?.phone ?? contact?.wa_id;
        if (!value) {
          const msg = "Contato não encontrado ou sem telefone.";
          await recordAudit(ctx, "add_to_blocklist", args, null, false, msg);
          return { ok: false, error: msg };
        }
        const { error } = await supabase.from("contact_blocklist").insert({
          brand_id: brandId,
          kind: "phone",
          value,
          reason: args.reason ?? "Adicionado via Copilot",
          created_by: ctx.userId,
        });
        if (error) {
          await recordAudit(ctx, "add_to_blocklist", args, null, false, error.message);
          return { ok: false, error: error.message };
        }
        await recordAudit(ctx, "add_to_blocklist", args, { value }, true);
        return { ok: true, blocked: value };
      },
    }),

    trigger_automation_for_contact: tool({
      description:
        "Dispara uma automação para um contato específico (cria um automation_run pendente). Use somente para automações com status 'active'. SEMPRE confirme antes.",
      inputSchema: z.object({
        automationId: z.string().min(1),
        contactId: z.string().min(1),
      }),
      execute: async (args) => {
        const { data: automation } = await supabase
          .from("automations")
          .select("id, status")
          .eq("id", args.automationId)
          .eq("brand_id", brandId)
          .maybeSingle();
        if (!automation) {
          const msg = "Automação não encontrada no workspace.";
          await recordAudit(ctx, "trigger_automation_for_contact", args, null, false, msg);
          return { ok: false, error: msg };
        }
        if (automation.status !== "active") {
          const msg = `Automação não está ativa (status: ${automation.status}).`;
          await recordAudit(ctx, "trigger_automation_for_contact", args, null, false, msg);
          return { ok: false, error: msg };
        }
        const { data: run, error } = await supabase
          .from("automation_runs")
          .insert({
            automation_id: args.automationId,
            contact_id: args.contactId,
            brand_id: brandId,
            status: "waiting",
            variables: {},
          })
          .select("id, status")
          .maybeSingle();
        if (error || !run) {
          const msg = error?.message ?? "Falha ao criar execução.";
          await recordAudit(ctx, "trigger_automation_for_contact", args, null, false, msg);
          return { ok: false, error: msg };
        }
        await recordAudit(ctx, "trigger_automation_for_contact", args, run, true);
        return { ok: true, run };
      },
    }),
  };
}
