// Fila de webhooks de integração — recebe rajadas e processa em ritmo
// controlado por conta (token bucket simples baseado em rate_limit_per_minute).
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { recordAndDispatch, type NormalizedEvent } from "./integrations-webhook.server";
import type { IntegrationPlatform } from "./integrations-platforms";

const GLOBAL_QUEUE_CAP = 50_000; // acima disso o webhook só conta e descarta

export interface EnqueueInput {
  account: { id: string; platform: IntegrationPlatform; queue_paused?: boolean | null };
  event: NormalizedEvent;
  signatureHeader?: string | null;
}

export interface EnqueueResult {
  enqueued: boolean;
  status: "pending" | "skipped" | "duplicate" | "overflow" | "no_match";
  id?: string;
  reason?: string;
  listenedEvents?: string[];
  expectedProductIds?: string[];
}

// ---------------------------------------------------------------------------
// Pré-filtro: só enfileira eventos que casem com alguma automação ativa.
// Cache em memória do mapa account_id -> { anyProduct: Set<event_type>,
// byProduct: Map<event_type, Set<product_id>> } com TTL curto (rajadas
// de webhook podem chegar a 4k/min — não dá pra fazer 1 SELECT por evento).
// ---------------------------------------------------------------------------

interface AutomationMatchIndex {
  anyProduct: Set<string>;
  byProduct: Map<string, Set<string>>;
  eventTypes: Set<string>;
  automationCount: number;
  loadFailed?: boolean;
}

interface AutomationMatchResult {
  matches: boolean;
  reason?: string;
  listenedEvents?: string[];
  expectedProductIds?: string[];
}

const MATCH_CACHE_TTL_MS = 30_000;
const matchCache = new Map<string, { expiresAt: number; index: AutomationMatchIndex }>();

async function loadAutomationIndex(accountId: string, options?: { bypassCache?: boolean }): Promise<AutomationMatchIndex> {
  const cached = matchCache.get(accountId);
  if (!options?.bypassCache && cached && cached.expiresAt > Date.now()) return cached.index;

  const { data, error } = await supabaseAdmin
    .from("automations")
    .select("trigger_config")
    .eq("status", "active")
    .filter("trigger_config->>account_id", "eq", accountId);

  const index: AutomationMatchIndex = { anyProduct: new Set(), byProduct: new Map(), eventTypes: new Set(), automationCount: 0 };

  if (error) {
    console.error("[integrations-queue] loadAutomationIndex:", error.message);
    return { ...index, loadFailed: true }; // não cacheia; fail-open no match
  }

  index.automationCount = data?.length ?? 0;

  for (const row of data ?? []) {
    const cfg = (row as any).trigger_config ?? {};
    const events: string[] = Array.isArray(cfg.events)
      ? cfg.events.filter((x: unknown) => x != null && x !== "").map(String)
      : cfg.event
        ? [String(cfg.event)]
        : [];
    const productIds: string[] = Array.isArray(cfg.product_ids)
      ? cfg.product_ids.filter((x: unknown) => x != null && x !== "").map(String)
      : cfg.product_ids != null && cfg.product_ids !== ""
        ? [String(cfg.product_ids)]
      : [];
    const singleProduct = cfg.product_id != null && cfg.product_id !== "" ? [String(cfg.product_id)] : [];
    const products = productIds.length ? productIds : singleProduct;

    for (const ev of events) {
      if (!ev) continue;
      index.eventTypes.add(ev);
      if (products.length === 0) {
        index.anyProduct.add(ev);
      } else {
        let set = index.byProduct.get(ev);
        if (!set) {
          set = new Set();
          index.byProduct.set(ev, set);
        }
        for (const p of products) set.add(p);
      }
    }
  }

  matchCache.set(accountId, { expiresAt: Date.now() + MATCH_CACHE_TTL_MS, index });
  return index;
}

export function invalidateAutomationMatchCache(accountId?: string) {
  if (accountId) matchCache.delete(accountId);
  else matchCache.clear();
}

function evaluateAutomationIndex(
  index: AutomationMatchIndex,
  eventType: string,
  productExternalId: string | null | undefined,
): AutomationMatchResult {
  if (index.loadFailed) return { matches: true, reason: "index_load_failed" };
  if (index.anyProduct.has(eventType)) return { matches: true };
  const set = index.byProduct.get(eventType);
  if (set?.size) {
    if (!productExternalId) {
      return {
        matches: false,
        reason: "product_missing",
        listenedEvents: Array.from(index.eventTypes),
        expectedProductIds: Array.from(set),
      };
    }
    if (set.has(String(productExternalId))) return { matches: true };
    return {
      matches: false,
      reason: "product_not_in_list",
      listenedEvents: Array.from(index.eventTypes),
      expectedProductIds: Array.from(set),
    };
  }
  if (index.automationCount === 0) return { matches: false, reason: "index_empty", listenedEvents: [] };
  return { matches: false, reason: "event_not_listened", listenedEvents: Array.from(index.eventTypes) };
}

export async function hasMatchingAutomation(
  accountId: string,
  eventType: string,
  productExternalId: string | null | undefined,
): Promise<AutomationMatchResult> {
  const index = await loadAutomationIndex(accountId);
  const cachedResult = evaluateAutomationIndex(index, eventType, productExternalId);
  if (cachedResult.matches) return cachedResult;

  // Antes de descartar, recarrega sem cache. Isso elimina a janela de cache
  // stale quando uma automação é alterada e a Hotmart reenvia em seguida.
  const freshIndex = await loadAutomationIndex(accountId, { bypassCache: true });
  return evaluateAutomationIndex(freshIndex, eventType, productExternalId);
}

export async function enqueueIntegrationEvent(input: EnqueueInput): Promise<EnqueueResult> {
  // Pré-filtro: descarta eventos que ninguém escuta — eles entopem a fila
  // e consomem rate limit à toa (ex.: tag_removed em massa numa sync de AC).
  const match = await hasMatchingAutomation(
    input.account.id,
    input.event.eventType,
    input.event.productExternalId ?? null,
  );
  if (!match.matches) {
    return {
      enqueued: false,
      status: "no_match",
      reason: match.reason,
      listenedEvents: match.listenedEvents,
      expectedProductIds: match.expectedProductIds,
    };
  }

  // Sanity: corta sobrecarga absoluta para não derrubar a app inteira.
  const { count } = await supabaseAdmin
    .from("integration_event_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if ((count ?? 0) >= GLOBAL_QUEUE_CAP) {
    console.error("[integrations-queue] global overflow, dropping event for account", input.account.id);
    return { enqueued: false, status: "overflow" };
  }

  const row: any = {
    account_id: input.account.id,
    platform: input.account.platform,
    event_type: input.event.eventType,
    external_id: input.event.externalId ?? null,
    payload: input.event as any,
    signature_header: input.signatureHeader ?? null,
    status: input.account.queue_paused ? "skipped" : "pending",
  };

  const { data, error } = await supabaseAdmin
    .from("integration_event_queue")
    .insert(row)
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return { enqueued: false, status: "duplicate" };
    console.error("[integrations-queue] enqueue failed:", error.message);
    throw error;
  }
  return { enqueued: true, status: row.status as "pending" | "skipped", id: data!.id };
}

interface AccountLimits {
  id: string;
  platform: IntegrationPlatform;
  rate_limit_per_minute: number;
  rate_limit_burst: number;
  queue_paused: boolean;
  last_drain_at: string | null;
  dispatch_concurrency: number;
}

export interface DrainResult {
  processed: number;
  failed: number;
  byAccount: Array<{ account_id: string; platform: string; processed: number; failed: number }>;
}

/**
 * Processa até `maxOverallMs` ms de fila pendente, respeitando o rate limit
 * por conta. Pensado para ser chamado a cada 1 min pelo cron.
 */
export async function drainQueue(maxOverallMs = 12_000): Promise<DrainResult> {
  const deadline = Date.now() + maxOverallMs;
  const tickStart = Date.now();

  // 0) Reaper: devolve para `pending` qualquer item travado em `processing`
  // por mais de 90 s. Workers do CF podem encerrar a request antes do UPDATE
  // final de cada dispatch, então itens órfãos precisam ser requeued rápido.
  try {
    await supabaseAdmin.rpc("reap_stuck_integration_events" as any, { _older_than: "90 seconds" });
  } catch (e) {
    console.error("[integrations-queue] reaper failed:", (e as Error).message);
  }

  // 1) Carrega config global (singleton). Se não existir, usa defaults.
  const { data: cfgRow } = await supabaseAdmin
    .from("integration_global_limits" as any)
    .select("tier, global_rate_limit_per_minute, global_burst, min_share_per_account, distribution_mode, auto_throttle_until, auto_throttle_tier")
    .eq("id", true)
    .maybeSingle();


  const cfg = (cfgRow as any) ?? {
    tier: "equilibrado",
    global_rate_limit_per_minute: 300,
    global_burst: 60,
    min_share_per_account: 10,
    distribution_mode: "equal",
    auto_throttle_until: null,
    auto_throttle_tier: null,
  };

  // 2) Aplica auto-throttle se ainda estiver vigente
  let effectiveRpm: number = cfg.global_rate_limit_per_minute;
  let effectiveBurst: number = cfg.global_burst;
  let effectiveTier: string = cfg.tier;
  if (cfg.auto_throttle_until && new Date(cfg.auto_throttle_until).getTime() > Date.now() && cfg.auto_throttle_tier) {
    const { tierPreset } = await import("./integrations-tiers");
    const p = tierPreset(cfg.auto_throttle_tier);
    if (p) {
      effectiveRpm = p.rpm;
      effectiveBurst = p.burst;
      effectiveTier = `${cfg.tier}→${cfg.auto_throttle_tier}`;
    }
  }

  // 3) Contas ativas
  const { data: accountsRaw } = await supabaseAdmin
    .from("integration_accounts")
    .select("id, platform, rate_limit_per_minute, rate_limit_burst, queue_paused, last_drain_at, dispatch_concurrency")
    .eq("status", "active")
    .eq("queue_paused", false);
  const accounts = (accountsRaw ?? []) as AccountLimits[];

  // 4) Quais contas têm fila pendente agora? Só elas consomem orçamento.
  // IMPORTANTE: uma única query com .limit(N) sem GROUP BY faz contas grandes
  // (com milhares de pending) ocuparem todos os slots e esconderem contas
  // menores. Checamos existência por conta em paralelo — barato porque o
  // número de contas ativas é pequeno (~10) e cada check é head:true count.
  let accountsWithPending: AccountLimits[] = [];
  if (accounts.length > 0) {
    const nowIso = new Date().toISOString();
    const checks = await Promise.all(
      accounts.map(async (a) => {
        const { count } = await supabaseAdmin
          .from("integration_event_queue")
          .select("id", { count: "exact", head: true })
          .eq("account_id", a.id)
          .eq("status", "pending")
          .lte("next_attempt_at", nowIso);
        return { account: a, hasPending: (count ?? 0) > 0 };
      }),
    );
    accountsWithPending = checks.filter((c) => c.hasPending).map((c) => c.account);
  }

  // 5) Calcula budget por conta — distribuição igual ou ponderada
  const N = accountsWithPending.length;
  const minShare = Math.max(1, Number(cfg.min_share_per_account) || 10);
  const budgetByAccount = new Map<string, number>();

  if (N > 0) {
    if (cfg.distribution_mode === "weighted") {
      const totalWeight = accountsWithPending.reduce((s, a) => s + Math.max(1, a.rate_limit_per_minute || 1), 0);
      for (const a of accountsWithPending) {
        const share = Math.floor(effectiveRpm * (Math.max(1, a.rate_limit_per_minute || 1) / totalWeight));
        budgetByAccount.set(a.id, Math.max(minShare, share));
      }
    } else {
      const equalShare = Math.floor(effectiveRpm / N);
      for (const a of accountsWithPending) {
        const cap = Math.max(1, a.rate_limit_per_minute || effectiveRpm);
        budgetByAccount.set(a.id, Math.min(cap, Math.max(minShare, equalShare)));
      }
    }
  }

  // 6) Burst global = teto duro de itens processados nesta execução
  let remainingBurst = Math.max(1, effectiveBurst);

  const byAccount: DrainResult["byAccount"] = [];
  let totalProcessed = 0;
  let totalFailed = 0;

  for (const acc of accountsWithPending) {
    if (Date.now() > deadline) break;
    if (remainingBurst <= 0) break;

    const accBudget = budgetByAccount.get(acc.id) ?? minShare;
    const elapsedMs = acc.last_drain_at ? Date.now() - new Date(acc.last_drain_at).getTime() : 60_000;
    const timeAllowed = Math.max(1, Math.floor((accBudget * elapsedMs) / 60_000));
    const concurrency = Math.max(1, Math.min(64, acc.dispatch_concurrency || 8));
    // Limita o claim deste tick: o suficiente para 4 lotes paralelos cheios.
    // Evita reivindicar centenas de itens que não vão terminar antes do Worker morrer.
    const claimCap = Math.max(concurrency, concurrency * 4);
    const allowed = Math.min(remainingBurst, timeAllowed, claimCap);

    const { data: claimed, error: claimErr } = await supabaseAdmin.rpc("claim_integration_events", {
      _account_id: acc.id,
      _limit: allowed,
    });
    if (claimErr) {
      console.error("[integrations-queue] claim failed for", acc.id, claimErr.message);
      continue;
    }
    const rows = ((claimed as unknown) as Array<{ id: string; payload: NormalizedEvent; attempts: number }>) ?? [];
    if (rows.length === 0) continue;

    let processed = 0;
    let failed = 0;

    // Processa em lotes paralelos. Antes de cada lote, checa deadline/burst.
    // Se o lote estourar o que sobra, devolve o restante para `pending`.
    let i = 0;
    while (i < rows.length) {
      if (Date.now() > deadline || remainingBurst <= 0) {
        const leftoverIds = rows.slice(i).map((r) => r.id);
        if (leftoverIds.length > 0) {
          await supabaseAdmin
            .from("integration_event_queue")
            .update({
              status: "pending",
              started_at: null,
              next_attempt_at: new Date().toISOString(),
            })
            .in("id", leftoverIds);
        }
        break;
      }

      const batchSize = Math.min(concurrency, remainingBurst, rows.length - i);
      const batch = rows.slice(i, i + batchSize);
      i += batchSize;
      // Reserva o burst do lote já, para não estourar com requisições concorrentes.
      remainingBurst -= batchSize;

      // Dispatcha em paralelo SEM UPDATE individual; coleta IDs ok/erro.
      const dispatchResults = await Promise.all(
        batch.map(async (row) => {
          try {
            await recordAndDispatch({ id: acc.id, platform: acc.platform }, row.payload);
            return { ok: true as const, id: row.id };
          } catch (e) {
            const msg = (e as Error).message ?? String(e);
            const attempts = (row.attempts ?? 0) + 1;
            const giveUp = attempts >= 4;
            const backoffMs = attempts === 1 ? 30_000 : attempts === 2 ? 120_000 : 600_000;
            console.error("[integrations-queue] process failed", row.id, msg);
            return {
              ok: false as const,
              id: row.id,
              attempts,
              giveUp,
              backoffMs,
              msg,
            };
          }
        }),
      );

      const okIds: string[] = [];
      const errResults: Array<{ id: string; attempts: number; giveUp: boolean; backoffMs: number; msg: string }> = [];
      for (const r of dispatchResults) {
        if (r.ok) okIds.push(r.id);
        else errResults.push(r);
      }

      // 1 UPDATE em lote para todos os sucessos (via RPC).
      if (okIds.length > 0) {
        const { error: doneErr } = await supabaseAdmin.rpc(
          "mark_integration_events_done" as any,
          { _ids: okIds },
        );
        if (doneErr) {
          console.error("[integrations-queue] mark_done failed:", doneErr.message);
        }
        processed += okIds.length;
      }

      // Falhas: ainda 1-por-1 (raras e cada uma tem backoff próprio).
      for (const r of errResults) {
        await supabaseAdmin
          .from("integration_event_queue")
          .update({
            status: r.giveUp ? "failed" : "pending",
            attempts: r.attempts,
            last_error: r.msg,
            next_attempt_at: r.giveUp
              ? new Date().toISOString()
              : new Date(Date.now() + r.backoffMs).toISOString(),
            finished_at: r.giveUp ? new Date().toISOString() : null,
          })
          .eq("id", r.id);
        failed++;
      }
    }


    await supabaseAdmin
      .from("integration_accounts")
      .update({ last_drain_at: new Date().toISOString() })
      .eq("id", acc.id);

    byAccount.push({ account_id: acc.id, platform: acc.platform, processed, failed });
    totalProcessed += processed;
    totalFailed += failed;
  }

  // 7) Saúde + snapshot por minuto + auto-throttle se necessário
  try {
    await assessAndSnapshotHealth({
      processed: totalProcessed,
      failed: totalFailed,
      tier: effectiveTier,
      tickElapsedMs: Date.now() - tickStart,
      cfg,
    });
  } catch (e) {
    console.error("[integrations-queue] health snapshot failed:", (e as Error).message);
  }

  return { processed: totalProcessed, failed: totalFailed, byAccount };
}

/**
 * Avalia sinais de saúde e grava 1 snapshot por minuto. Em estado "critical",
 * ativa auto-throttle (faixa imediatamente abaixo) por 15 min.
 */
async function assessAndSnapshotHealth(params: {
  processed: number;
  failed: number;
  tier: string;
  tickElapsedMs: number;
  cfg: any;
}) {
  const { processed, failed, tier, tickElapsedMs, cfg } = params;

  const [{ count: pending }, { count: processing }, prevSnapRes] = await Promise.all([
    supabaseAdmin.from("integration_event_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabaseAdmin.from("integration_event_queue").select("id", { count: "exact", head: true }).eq("status", "processing"),
    supabaseAdmin
      .from("integration_queue_health_snapshots" as any)
      .select("pending, taken_at, level")
      .order("taken_at", { ascending: false })
      .limit(5),
  ]);

  const prevSnaps = ((prevSnapRes as any).data ?? []) as Array<{ pending: number; taken_at: string; level: string }>;
  const pendCount = pending ?? 0;
  const procCount = processing ?? 0;

  const reasons: string[] = [];
  let level: "ok" | "warn" | "critical" = "ok";

  // Backlog absoluto
  if (pendCount > 20_000) { level = "critical"; reasons.push(`Backlog crítico: ${pendCount} pendentes`); }
  else if (pendCount > 5_000) { level = level === "ok" ? "warn" : level; reasons.push(`Backlog alto: ${pendCount} pendentes`); }

  // Crescimento sustentado de pendentes
  if (prevSnaps.length >= 3) {
    const growing = prevSnaps[0].pending < pendCount && prevSnaps[1].pending < prevSnaps[0].pending && prevSnaps[2].pending < prevSnaps[1].pending;
    if (growing && pendCount > 500) {
      level = level === "critical" ? "critical" : "warn";
      reasons.push("Pendências crescendo nos últimos minutos");
    }
  }

  // Taxa de falhas no tick
  const tickTotal = processed + failed;
  if (tickTotal >= 10) {
    const failRate = failed / tickTotal;
    if (failRate >= 0.25) { level = "critical"; reasons.push(`Falhas em ${Math.round(failRate * 100)}% no último minuto`); }
    else if (failRate >= 0.10) { level = level === "ok" ? "warn" : level; reasons.push(`Falhas em ${Math.round(failRate * 100)}% no último minuto`); }
  }

  // Drain estourando o deadline
  if (tickElapsedMs > 40_000) {
    level = level === "critical" ? "critical" : "warn";
    reasons.push("Worker próximo do limite de tempo (40s+)");
  }

  // Muitos itens em "processing" (worker trava ou itens órfãos)
  if (procCount > 500) {
    level = level === "critical" ? "critical" : "warn";
    reasons.push(`${procCount} itens em processamento`);
  }

  // Snapshot por minuto (ON CONFLICT no taken_at trunc'd)
  const takenAt = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
  await supabaseAdmin.from("integration_queue_health_snapshots" as any).upsert(
    {
      taken_at: takenAt,
      pending: pendCount,
      processing: procCount,
      processed_last_min: processed,
      failed_last_min: failed,
      tier,
      level,
      reasons: reasons as any,
    },
    { onConflict: "taken_at" },
  );

  // Auto-throttle quando crítico — só liga se ainda não estiver throttling
  if (level === "critical") {
    const stillActive = cfg.auto_throttle_until && new Date(cfg.auto_throttle_until).getTime() > Date.now();
    if (!stillActive && cfg.tier !== "conservador") {
      const { tierBelow } = await import("./integrations-tiers");
      const next = tierBelow(cfg.tier);
      const until = new Date(Date.now() + 15 * 60_000).toISOString();
      await supabaseAdmin
        .from("integration_global_limits" as any)
        .update({ auto_throttle_until: until, auto_throttle_tier: next, updated_at: new Date().toISOString() })
        .eq("id", true);
      console.warn(`[integrations-queue] AUTO-THROTTLE: ${cfg.tier} → ${next} até ${until}`);
    }
  }
}

