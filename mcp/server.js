#!/usr/bin/env node
/**
 * MCP server do MegaCRM — expõe ferramentas de broadcast, fila e audiência
 * para o Claude Code via stdio.
 *
 * Env obrigatórias:
 *   SUPABASE_URL                — ex.: https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY   — chave service_role (Settings → API)
 * Env opcional:
 *   APP_URL — base do app (ex.: https://crm.megafone.digital) para
 *             disparar os crons manualmente (run_broadcast_loop etc.)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_URL = process.env.APP_URL ?? null;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "[megacrm-mcp] Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no env do MCP.",
  );
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const server = new McpServer({ name: "megacrm", version: "1.0.0" });

/** Serializa qualquer resultado como bloco de texto JSON. */
function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function fail(message) {
  return { isError: true, content: [{ type: "text", text: message }] };
}

/** Wrapper: captura erros e devolve como isError em vez de crashar o server. */
function tool(name, description, shape, handler) {
  server.tool(name, description, shape, async (args) => {
    try {
      return ok(await handler(args ?? {}));
    } catch (e) {
      return fail(`${name}: ${e?.message ?? String(e)}`);
    }
  });
}

// ─────────────────────────── Descoberta (ids) ───────────────────────────

tool(
  "list_brands",
  "Lista os workspaces/marcas (id + nome). Use para descobrir o brandId das outras ferramentas.",
  {},
  async () => {
    const { data, error } = await db
      .from("brands")
      .select("id, name, created_at")
      .order("name");
    if (error) throw new Error(error.message);
    return data;
  },
);

tool(
  "list_automations",
  "Lista automações de um workspace (id, nome, status). Broadcasts disparam uma automação — use para achar o automationId.",
  { brandId: z.string().uuid() },
  async ({ brandId }) => {
    const { data, error } = await db
      .from("automations")
      .select("id, name, status, trigger_type, created_at")
      .eq("brand_id", brandId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data;
  },
);

tool(
  "list_tags",
  "Lista tags de contato de um workspace (para montar a audiência de um broadcast).",
  { brandId: z.string().uuid() },
  async ({ brandId }) => {
    const { data, error } = await db
      .from("tags")
      .select("id, name, color")
      .eq("brand_id", brandId)
      .order("name");
    if (error) throw new Error(error.message);
    return data;
  },
);

// ─────────────────────────── Broadcasts ───────────────────────────

tool(
  "list_broadcasts",
  "Lista broadcasts (opcionalmente filtrados por workspace e/ou status) com progresso.",
  {
    brandId: z.string().uuid().optional(),
    status: z
      .enum(["scheduled", "running", "completed", "cancelled", "failed"])
      .optional(),
    limit: z.number().int().min(1).max(100).default(20),
  },
  async ({ brandId, status, limit }) => {
    let q = db
      .from("broadcasts")
      .select(
        "id, name, status, brand_id, automation_id, rate_per_minute, total_targets, dispatched_count, failed_count, skipped_count, scheduled_at, started_at, finished_at, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(limit ?? 20);
    if (brandId) q = q.eq("brand_id", brandId);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data;
  },
);

tool(
  "get_broadcast",
  "Detalhes completos de um broadcast: contadores por status, taxa real no último minuto/10min, fila.",
  { id: z.string().uuid() },
  async ({ id }) => {
    const { data: row, error } = await db
      .from("broadcasts")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Broadcast não encontrado");
    const { data: summary, error: sumErr } = await db.rpc(
      "get_broadcast_summary",
      { _broadcast_id: id },
    );
    if (sumErr) throw new Error(sumErr.message);
    return { ...row, summary };
  },
);

tool(
  "preview_audience",
  "Prévia da audiência de um broadcast: total de contatos e amostra, por tag de inclusão/exclusão.",
  {
    brandId: z.string().uuid(),
    tagIdInclude: z.string().uuid().nullable().optional(),
    tagIdExclude: z.string().uuid().nullable().optional(),
  },
  async ({ brandId, tagIdInclude, tagIdExclude }) => {
    const { data, error } = await db.rpc("preview_broadcast_audience", {
      _brand_id: brandId,
      _include_tag_id: tagIdInclude ?? null,
      _exclude_tag_id: tagIdExclude ?? null,
      _sample_limit: 10,
    });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    return { count: Number(row?.total_count ?? 0), sample: row?.sample ?? [] };
  },
);

tool(
  "create_broadcast",
  "Cria um broadcast. Sem scheduledAt = dispara imediatamente. rate = msgs/min (1–5000). CONFIRME com o usuário antes de criar — envia mensagens reais.",
  {
    brandId: z.string().uuid(),
    automationId: z.string().uuid(),
    name: z.string().min(1).max(120),
    ratePerMinute: z.number().int().min(1).max(5000).default(60),
    tagIdInclude: z.string().uuid().nullable().optional(),
    tagIdExclude: z.string().uuid().nullable().optional(),
    scheduledAt: z.string().datetime().nullable().optional(),
    skipNoWindow: z.boolean().default(false),
  },
  async (a) => {
    // Valida automação pertence à marca
    const { data: automation } = await db
      .from("automations")
      .select("id, brand_id, status")
      .eq("id", a.automationId)
      .maybeSingle();
    if (!automation || automation.brand_id !== a.brandId) {
      throw new Error("Automação inválida para esse workspace");
    }

    const { data: prevRows, error: prevErr } = await db.rpc(
      "preview_broadcast_audience",
      {
        _brand_id: a.brandId,
        _include_tag_id: a.tagIdInclude ?? null,
        _exclude_tag_id: a.tagIdExclude ?? null,
        _sample_limit: 0,
      },
    );
    if (prevErr) throw new Error(prevErr.message);
    const prevRow = Array.isArray(prevRows) ? prevRows[0] : prevRows;
    const previewCount = Number(prevRow?.total_count ?? 0);
    if (previewCount === 0) throw new Error("Público vazio — nada a enviar");

    // Mesmo padrão race-safe do app: cria como scheduled com data no futuro,
    // insere os targets, e só então promove para running (se imediato).
    const wantsRunning = !a.scheduledAt;
    const { data: bcast, error: bErr } = await db
      .from("broadcasts")
      .insert({
        brand_id: a.brandId,
        automation_id: a.automationId,
        name: a.name,
        status: "scheduled",
        audience_filter: {
          tagIdInclude: a.tagIdInclude ?? null,
          tagIdExclude: a.tagIdExclude ?? null,
        },
        scheduled_at:
          a.scheduledAt ?? new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        rate_per_minute: a.ratePerMinute ?? 60,
        skip_no_window: a.skipNoWindow ?? false,
        total_targets: previewCount,
        started_at: null,
        created_by: null,
      })
      .select("id")
      .single();
    if (bErr || !bcast) throw new Error(bErr?.message ?? "insert falhou");

    const { data: inserted, error: insErr } = await db.rpc(
      "create_broadcast_targets_for_audience",
      {
        _broadcast_id: bcast.id,
        _brand_id: a.brandId,
        _include_tag_id: a.tagIdInclude ?? null,
        _exclude_tag_id: a.tagIdExclude ?? null,
      },
    );
    if (insErr) throw new Error(insErr.message);

    if (wantsRunning) {
      const nowIso = new Date().toISOString();
      const { error: upErr } = await db
        .from("broadcasts")
        .update({ status: "running", started_at: nowIso, scheduled_at: nowIso })
        .eq("id", bcast.id);
      if (upErr) throw new Error(upErr.message);
    }

    return {
      id: bcast.id,
      totalTargets: Number(inserted ?? 0),
      status: wantsRunning ? "running" : "scheduled",
    };
  },
);

tool(
  "cancel_broadcast",
  "Cancela um broadcast em execução ou agendado (targets pending/processing viram cancelled).",
  { id: z.string().uuid() },
  async ({ id }) => {
    const { data: row } = await db
      .from("broadcasts")
      .select("status")
      .eq("id", id)
      .maybeSingle();
    if (!row) throw new Error("Broadcast não encontrado");
    if (["completed", "cancelled", "failed"].includes(row.status)) {
      return { ok: true, note: `Já estava ${row.status}` };
    }
    await db
      .from("broadcasts")
      .update({ status: "cancelled", finished_at: new Date().toISOString() })
      .eq("id", id);
    await db
      .from("broadcast_targets")
      .update({ status: "cancelled", claimed_at: null })
      .eq("broadcast_id", id)
      .in("status", ["pending", "processing"]);
    await db
      .from("broadcast_dispatch_queue")
      .update({ status: "skipped", last_error: "Broadcast cancelado" })
      .eq("broadcast_id", id)
      .in("status", ["pending", "processing"]);
    return { ok: true };
  },
);

tool(
  "update_broadcast_rate",
  "Ajusta o rate_per_minute de um broadcast (efeito imediato no token bucket, sem pausar).",
  { id: z.string().uuid(), ratePerMinute: z.number().int().min(1).max(5000) },
  async ({ id, ratePerMinute }) => {
    const { error } = await db
      .from("broadcasts")
      .update({ rate_per_minute: ratePerMinute })
      .eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true, ratePerMinute };
  },
);

// ─────────────────────────── Fila / Saúde ───────────────────────────

tool(
  "queue_health",
  "Saúde da fila de disparo: broadcasts running, tokens disponíveis, contagens por status e itens travados.",
  {},
  async () => {
    const { data: running } = await db
      .from("broadcasts")
      .select("id, name, rate_per_minute, total_targets, dispatched_count")
      .eq("status", "running");
    const ids = (running ?? []).map((b) => b.id);

    const countByStatus = async (status) => {
      const { count } = await db
        .from("broadcast_dispatch_queue")
        .select("id", { count: "exact", head: true })
        .eq("status", status);
      return count ?? 0;
    };
    const [pending, processing, dispatched, failed, skipped] =
      await Promise.all(
        ["pending", "processing", "dispatched", "failed", "skipped"].map(
          countByStatus,
        ),
      );

    let rateState = [];
    if (ids.length > 0) {
      const { data } = await db
        .from("broadcast_rate_state")
        .select("broadcast_id, tokens, last_refill_at")
        .in("broadcast_id", ids);
      rateState = data ?? [];
    }

    // Itens travados: processing há mais de 2 min (claim órfão)
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { count: stuck } = await db
      .from("broadcast_dispatch_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "processing")
      .lt("claimed_at", twoMinAgo);

    return {
      runningBroadcasts: running ?? [],
      queue: { pending, processing, dispatched, failed, skipped },
      rateState,
      stuckProcessing: stuck ?? 0,
    };
  },
);

tool(
  "check_stuck_dispatches",
  "Lista itens travados na fila (processing antigo ou pending atrasado) com amostra para diagnóstico.",
  { sampleSize: z.number().int().min(1).max(50).default(10) },
  async ({ sampleSize }) => {
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const { data: stuckProcessing } = await db
      .from("broadcast_dispatch_queue")
      .select("id, broadcast_id, status, attempts, claimed_at, last_error")
      .eq("status", "processing")
      .lt("claimed_at", twoMinAgo)
      .limit(sampleSize ?? 10);

    const { data: latePending } = await db
      .from("broadcast_dispatch_queue")
      .select(
        "id, broadcast_id, status, attempts, scheduled_send_at, next_attempt_at, last_error",
      )
      .eq("status", "pending")
      .lt("scheduled_send_at", fiveMinAgo)
      .limit(sampleSize ?? 10);

    return {
      stuckProcessing: stuckProcessing ?? [],
      latePending: latePending ?? [],
      hint:
        (stuckProcessing?.length ?? 0) > 0
          ? "Itens processing antigos são recuperados pelo requeue_stuck_broadcast_dispatches no próximo drain. Se persistirem, verifique o cron broadcast-loop."
          : "Fila saudável.",
    };
  },
);

tool(
  "list_failed_targets",
  "Lista os targets com falha de um broadcast, agrupando a mensagem de erro para diagnóstico rápido.",
  { broadcastId: z.string().uuid(), limit: z.number().int().min(1).max(200).default(50) },
  async ({ broadcastId, limit }) => {
    const { data, error } = await db
      .from("broadcast_targets")
      .select("id, contact_id, error, dispatched_at")
      .eq("broadcast_id", broadcastId)
      .eq("status", "failed")
      .order("dispatched_at", { ascending: false, nullsFirst: false })
      .limit(limit ?? 50);
    if (error) throw new Error(error.message);
    const byError = {};
    for (const t of data ?? []) {
      const key = (t.error ?? "sem mensagem").slice(0, 120);
      byError[key] = (byError[key] ?? 0) + 1;
    }
    return { total: data?.length ?? 0, groupedErrors: byError, sample: (data ?? []).slice(0, 10) };
  },
);

// ─────────────────────────── Crons manuais ───────────────────────────

async function hitCron(path) {
  if (!APP_URL) {
    throw new Error(
      "APP_URL não configurada no env do MCP — necessária para disparar crons manualmente.",
    );
  }
  const res = await fetch(`${APP_URL.replace(/\/$/, "")}${path}`, {
    method: "POST",
  });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text.slice(0, 1000) };
  }
}

tool(
  "run_broadcast_loop",
  "Dispara manualmente um ciclo do broadcast-loop (tick + drain). Útil para depurar sem esperar o cron.",
  {},
  () => hitCron("/api/public/cron/broadcast-loop"),
);

tool(
  "run_reconcile",
  "Dispara manualmente a reconciliação (promove runs, detecta falhas async da Meta, reconta progresso).",
  {},
  () => hitCron("/api/public/cron/broadcast-reconcile"),
);

// ───────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[megacrm-mcp] pronto (stdio)");
