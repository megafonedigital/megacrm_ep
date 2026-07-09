import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Concorrência interna do drain. O teto de TAXA por broadcast é imposto em
// claim_broadcast_dispatch_queue (rate_per_minute). Portanto workers aqui
// NÃO controlam velocidade — só precisam ser altos o bastante para esvaziar
// um lote inteiro em UMA passada paralela, mesmo no pior caso (timeout 5s).
const WORKER_CONCURRENCY_MIN = 40;
const WORKER_CONCURRENCY_MAX = 150;
// Reduzido de 3000→800ms: em async:true o engine só precisa receber o POST
// e enfileirar o run. Esperar 3s pelo response HTTP prendia workers em
// chamadas onde o p95 do engine excedia o timeout. AbortError já é tratado
// como "dispatched" e o broadcast-reconcile detecta falhas reais.
const AUTOMATION_ENGINE_TIMEOUT_MS = 800;
// Reduzido 750→150: lotes grandes faziam o prefetch (contacts + get_latest_conversations + blocklist)
// estourar o deadline ANTES de qualquer worker rodar, devolvendo tudo como "retried" e zerando o throughput.
// 150 itens × 90 workers paralelos termina em ~1-2s; drains concorrentes (SKIP LOCKED) somam throughput.
const DRAIN_BATCH_SIZE = 150;
// PostgREST/Supabase tem limite ~8KB de URL. Filtros .in("col",[...]) com
// muitos UUIDs (36+ chars cada) estouram silenciosamente e retornam só uma
// fatia → linhas "ausentes" viram "Contato não encontrado". 150 ids ≈ 6KB.
const SAFE_IN_CHUNK = 150;

async function chunkedIn<T>(
  values: string[],
  fetcher: (chunk: string[]) => Promise<T[]>,
): Promise<T[]> {
  if (values.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < values.length; i += SAFE_IN_CHUNK) {
    chunks.push(values.slice(i, i + SAFE_IN_CHUNK));
  }
  const results = await Promise.all(chunks.map(fetcher));
  return results.flat();
}
const LOCK_TTL_SECONDS = 25;
// Budget mínimo/máximo POR RUN do drain. Com cron a cada 5s = 12 runs/min,
// e burst cap = rate/3, cada run precisa consumir até ~rate/3 tokens.
// RUN_BUDGET_MAX=3500 cobre broadcasts agregados de até ~10k msg/min.
const RUN_BUDGET_MIN = 120;
const RUN_BUDGET_MAX = 3500;

function computeRunBudget(totalRatePerMinute: number): number {
  // Cron a cada 5s = 12 runs úteis/min. Sem folga: cada drain consome
  // exatamente as fichas acumuladas no ciclo, mantendo a curva linear.
  const target = Math.ceil((totalRatePerMinute || 0) / 12);
  return Math.min(Math.max(target, RUN_BUDGET_MIN), RUN_BUDGET_MAX);
}

function computeWorkerConcurrency(totalRatePerMinute: number): number {
  // Workers paralelos por run. Cada worker ~800ms de timeout; com 4s de
  // janela útil, cada worker processa ~5 itens. workers ≈ rate/30.
  const target = Math.ceil((totalRatePerMinute || 0) / 30);
  return Math.min(Math.max(target, WORKER_CONCURRENCY_MIN), WORKER_CONCURRENCY_MAX);
}

/**
 * Lê a feature flag global do fast-path de broadcast. Falha-aberto:
 * em caso de erro de leitura, mantém o caminho normal (manual_trigger).
 */
async function isFastPathEnabled(): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", "broadcasts.fast_path_enabled")
      .maybeSingle();
    return (data as any)?.value === true;
  } catch {
    return false;
  }
}



type ContactRow = { id: string; phone: string | null; wa_id: string | null; email: string | null };
type ConvRow = { id: string; window_expires_at: string | null };
type QueueRow = {
  id: string;
  broadcast_id: string;
  target_id: string;
  brand_id: string;
  automation_id: string;
  contact_id: string;
  conversation_id: string | null;
  attempts: number;
  phone?: string | null;
  contact_name?: string | null;
  wa_id?: string | null;
};

/**
 * Promove um broadcast para "running" (se aplicável) e enfileira TODOS os
 * pendentes com horário de envio determinístico (scheduled_send_at).
 * O drain decide o que mandar com base em scheduled_send_at <= now().
 * Não há mais janela móvel nem cálculo reativo de quota — a velocidade é
 * imposta pelo agendamento uniforme.
 */
export async function processBroadcastNow(
  broadcastId: string,
): Promise<{ enqueued: number; skipped: number; failed: number; claimed: number; dispatched: number }> {
  const t0 = Date.now();
  const lockName = `broadcast:${broadcastId}`;
  const lockOwner = `tick-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data: lockAcquired } = await (supabaseAdmin as any).rpc("try_acquire_named_lock", {
    _name: lockName,
    _owner: lockOwner,
    _ttl_seconds: LOCK_TTL_SECONDS,
  });
  if (lockAcquired !== true) {
    return { enqueued: 0, skipped: 0, failed: 0, claimed: 0, dispatched: 0 };
  }

  try {
    const { data: b } = await supabaseAdmin
      .from("broadcasts")
      .select("id, status")
      .eq("id", broadcastId)
      .maybeSingle();

    if (!b || (b as any).status !== "running") {
      return { enqueued: 0, skipped: 0, failed: 0, claimed: 0, dispatched: 0 };
    }

    // Limite proporcional ao rate: cobre ~90s de carry-ahead (igual ao
    // v_max_carry_ahead da SQL). Sem isso, o default 500 limitava o
    // throughput em ~500 itens/tick, estrangulando broadcasts com
    // rate alto (ex.: 3k/min só conseguia ~1k–1.4k efetivos/min).
    const { data: rateRow } = await supabaseAdmin
      .from("broadcasts")
      .select("rate_per_minute")
      .eq("id", b.id)
      .maybeSingle();
    const rate = Math.max(1, ((rateRow as any)?.rate_per_minute as number) || 60);
    // enqueueLimit alinhado ao burst_cap do token bucket (rate/30).
    // Mantém a fila curta e a latência baixa (~4s). O buffer de 4 ciclos
    // testado (×4) inchava a fila sem ganho de throughput (gargalo é o
    // dispatch, não o enqueue), então foi revertido.
    const enqueueLimit = Math.max(5, Math.round(rate / 30));
    const { data: enqueuedRows, error: enqueueErr } = await (supabaseAdmin as any).rpc(
      "enqueue_broadcast_dispatches",
      { _broadcast_id: b.id, _limit: enqueueLimit },
    );
    if (enqueueErr) throw enqueueErr;
    const enqueued = typeof enqueuedRows === "number" ? enqueuedRows : 0;

    if (enqueued === 0) {
      await supabaseAdmin.rpc("recount_broadcast_progress", { _broadcast_id: b.id });
      return { enqueued: 0, skipped: 0, failed: 0, claimed: 0, dispatched: 0 };
    }

    console.log(`[broadcast ${broadcastId}] enqueued=${enqueued} total=${Date.now() - t0}ms`);
    return { enqueued, skipped: 0, failed: 0, claimed: enqueued, dispatched: 0 };
  } finally {
    await (supabaseAdmin as any).rpc("release_named_lock", { _name: lockName, _owner: lockOwner });
  }
}

async function finishQueueItem(
  item: QueueRow,
  status: "dispatched" | "skipped" | "failed",
  error?: string | null,
  runId?: string | null,
  conversationId?: string | null,
) {
  await (supabaseAdmin as any).rpc("finish_broadcast_dispatch", {
    _queue_id: item.id,
    _target_id: item.target_id,
    _status: status,
    _run_id: runId ?? null,
    _conversation_id: conversationId ?? null,
    _error: error ?? null,
  });
}

async function retryQueueItem(item: QueueRow, error: string) {
  await (supabaseAdmin as any).rpc("fail_or_retry_broadcast_dispatch", {
    _queue_id: item.id,
    _target_id: item.target_id,
    _error: error.slice(0, 500),
    _max_attempts: 4,
  });
}

/**
 * Devolve item à fila SEM penalizar tentativas. Usado quando o motivo é
 * interno (deadline do drain, broadcast fora de running) e a chamada
 * NUNCA chegou à Meta. Desfaz o incremento de attempts feito pelo claim.
 */
async function releaseQueueItemNoPenalty(item: QueueRow, reason: string) {
  await (supabaseAdmin as any).rpc("release_broadcast_dispatch_no_penalty", {
    _queue_id: item.id,
    _target_id: item.target_id,
    _reason: reason.slice(0, 500),
  });
}

/**
 * Erros conhecidos da Meta WhatsApp Cloud API.
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/
 *
 * Transitórios / por broadcast:
 * - 130429: Rate limit hit (MPS) — retry rápido.
 * - 80007:  Daily messaging tier reached — não adianta tentar de novo hoje (fail-all).
 * - 131048: Quality rating low/blocked — número precisa de atenção manual (fail-all).
 *
 * Permanentes por contato (failed direto, SEM retry — retry só gasta quota e polui logs):
 * - 131049: Mensagem rejeitada por política de marketing da Meta.
 * - 131026: Número sem WhatsApp ou bloqueou a marca.
 * - 131050: Usuário fez opt-out de marketing.
 * - 130472: Usuário fora do experimento Meta.
 * - 131053: Falha de mídia. Tratada como permanente porque, na prática,
 *           costuma ser problema da URL/asset (não resolve em retry).
 */
function classifyMetaError(
  errText: string,
): "rate_limit" | "daily_tier" | "quality" | "permanent_contact" | null {
  if (/\b130429\b/.test(errText) || /\b429\b/.test(errText) || /rate limit/i.test(errText)) {
    return "rate_limit";
  }
  if (/\b80007\b/.test(errText)) return "daily_tier";
  if (/\b131048\b/.test(errText)) return "quality";
  if (
    /\b131049\b/.test(errText) ||
    /\b131026\b/.test(errText) ||
    /\b131050\b/.test(errText) ||
    /\b130472\b/.test(errText) ||
    /\b131053\b/.test(errText)
  ) {
    return "permanent_contact";
  }
  return null;
}

async function failAllPendingForBroadcast(broadcastId: string, errorMsg: string) {
  await supabaseAdmin
    .from("broadcast_dispatch_queue")
    .update({ status: "failed", last_error: errorMsg.slice(0, 500), updated_at: new Date().toISOString() })
    .eq("broadcast_id", broadcastId)
    .in("status", ["pending", "processing"]);
  await supabaseAdmin
    .from("broadcast_targets")
    .update({ status: "failed", error: errorMsg.slice(0, 500), claimed_at: null })
    .eq("broadcast_id", broadcastId)
    .in("status", ["pending", "processing"])
    .is("run_id", null);
  console.warn(`[broadcast ${broadcastId}] AUTO-FAIL pending: ${errorMsg}`);
}

/**
 * Drain da fila durável. É a única etapa que chama automation-engine.
 * Se morrer no meio, os itens claimed voltam para pending pelo próximo cron.
 */
export async function drainBroadcastQueue(maxOverallMs = 22_000): Promise<{
  claimed: number;
  dispatched: number;
  skipped: number;
  failed: number;
  retried: number;
  requeued: number;
}> {
  const deadline = Date.now() + maxOverallMs;
  const { data: requeuedRows } = await (supabaseAdmin as any).rpc("requeue_stuck_broadcast_dispatches");
  const requeued = typeof requeuedRows === "number" ? requeuedRows : 0;

  // Auto-scaling de workers baseado na soma de rate_per_minute dos broadcasts running.
  const { data: rateSum } = await (supabaseAdmin as any).rpc("get_running_broadcasts_rate_sum");
  const totalRate = typeof rateSum === "number" ? rateSum : 0;
  const WORKER_CONCURRENCY = computeWorkerConcurrency(totalRate);
  const RUN_BUDGET = computeRunBudget(totalRate);

  let totalClaimed = 0, totalDispatched = 0, totalSkipped = 0, totalFailed = 0, totalRetried = 0;
  const touchedBroadcasts = new Set<string>();

  // Margem mínima para fechar a request — drain é concurrency-safe via
  // FOR UPDATE SKIP LOCKED, então um overrun pequeno não causa corrupção.
  const SAFETY_MARGIN_MS = 600;

  // Execução única por drain: o burst cap (rate/12) já casa com a frequência
  // do cron (5s), então um único claim por ciclo mantém a curva linear.
  {
    const remainingBudget = RUN_BUDGET - totalClaimed;
    const batchLimit = Math.min(DRAIN_BATCH_SIZE, remainingBudget);

    const { data: claimedRows, error: claimErr } = await (supabaseAdmin as any).rpc("claim_broadcast_dispatch_queue", {
      _limit: batchLimit,
    });
    if (claimErr) throw claimErr;


    const items = ((claimedRows ?? []) as any[]) as QueueRow[];
    if (items.length === 0) {
      // nada a fazer neste ciclo
    } else {
    totalClaimed += items.length;
    for (const i of items) touchedBroadcasts.add(i.broadcast_id);

    const contactIds = Array.from(new Set(items.map((i) => i.contact_id)));
    const brandIds = Array.from(new Set(items.map((i) => i.brand_id)));
    const broadcastIds = Array.from(new Set(items.map((i) => i.broadcast_id)));

    const contactMap = new Map<string, ContactRow>();
    const convMap = new Map<string, ConvRow>();
    const blockedByBrand = new Map<string, { phones: Set<string>; emails: Set<string> }>();
    let broadcastRows: any[] = [];

    // Fast path: dados desnormalizados já vieram no claim. Só precisamos
    // ainda buscar broadcasts (skip_no_window/status). Contatos, conversas
    // e blocklist já foram resolvidos no enqueue.
    const hasDenormalizedData = items[0]?.phone != null;

    if (hasDenormalizedData) {
      for (const it of items) {
        contactMap.set(it.contact_id, {
          id: it.contact_id,
          phone: it.phone ?? null,
          wa_id: it.wa_id ?? null,
          email: null,
        });
      }
      broadcastRows = await chunkedIn(broadcastIds, async (chunk) => {
        const { data } = await supabaseAdmin
          .from("broadcasts")
          .select("id, skip_no_window, status")
          .in("id", chunk);
        return (data ?? []) as any[];
      });

      // Se algum broadcast precisa de checagem de janela de 24h,
      // buscar conversations com window_expires_at real (não hardcoded null).
      const needsWindowCheck = broadcastRows.some((b: any) => b.skip_no_window);
      if (needsWindowCheck) {
        const convsRes = await Promise.all(
          brandIds.map(async (brandId) => ({
            brandId,
            rows: await chunkedIn(contactIds, async (chunk) => {
              const { data } = await supabaseAdmin.rpc("get_latest_conversations", {
                _brand: brandId,
                _contact_ids: chunk,
              });
              return (data ?? []) as any[];
            }),
          })),
        );
        for (const bundle of convsRes) {
          for (const c of bundle.rows) {
            convMap.set(`${bundle.brandId}:${c.contact_id}`, {
              id: c.id,
              window_expires_at: c.window_expires_at ?? null,
            });
          }
        }
      } else {
        // Sem checagem de janela — usar conversation_id da queue row direto.
        for (const it of items) {
          if (it.conversation_id) {
            convMap.set(`${it.brand_id}:${it.contact_id}`, {
              id: it.conversation_id,
              window_expires_at: null,
            });
          }
        }
      }
    } else {
      // Fallback: itens antigos sem desnormalização — prefetch completo.
      const [contactsRows, convsRes, broadcastRowsFetched] = await Promise.all([
        chunkedIn(contactIds, async (chunk) => {
          const { data } = await supabaseAdmin
            .from("contacts")
            .select("id, phone, wa_id, metadata")
            .in("id", chunk);
          return (data ?? []) as any[];
        }),
        Promise.all(
          brandIds.map(async (brandId) => ({
            brandId,
            rows: await chunkedIn(contactIds, async (chunk) => {
              const { data } = await supabaseAdmin.rpc("get_latest_conversations", {
                _brand: brandId,
                _contact_ids: chunk,
              });
              return (data ?? []) as any[];
            }),
          })),
        ),
        chunkedIn(broadcastIds, async (chunk) => {
          const { data } = await supabaseAdmin
            .from("broadcasts")
            .select("id, skip_no_window, status")
            .in("id", chunk);
          return (data ?? []) as any[];
        }),
      ]);
      broadcastRows = broadcastRowsFetched;

      for (const c of contactsRows) {
        contactMap.set(c.id, {
          id: c.id,
          phone: c.phone ?? null,
          wa_id: c.wa_id ?? null,
          email: (c.metadata?.email ?? null) || null,
        });
      }

      for (const bundle of convsRes) {
        for (const c of bundle.rows) {
          convMap.set(`${bundle.brandId}:${c.contact_id}`, { id: c.id, window_expires_at: c.window_expires_at ?? null });
        }
      }

      const phones = Array.from(new Set(Array.from(contactMap.values()).map((c) => c.phone ?? c.wa_id).filter(Boolean) as string[]));
      const emails = Array.from(new Set(Array.from(contactMap.values()).map((c) => c.email?.toLowerCase()).filter(Boolean) as string[]));
      if ((phones.length > 0 || emails.length > 0) && brandIds.length > 0) {
        const blocks = await chunkedIn([...phones, ...emails], async (chunk) => {
          const { data } = await supabaseAdmin
            .from("contact_blocklist")
            .select("brand_id, value, kind")
            .in("brand_id", brandIds)
            .in("value", chunk);
          return (data ?? []) as any[];
        });
        for (const blk of blocks) {
          const bucket = blockedByBrand.get(blk.brand_id) ?? { phones: new Set<string>(), emails: new Set<string>() };
          if (blk.kind === "phone") bucket.phones.add(blk.value);
          else if (blk.kind === "email") bucket.emails.add(blk.value);
          blockedByBrand.set(blk.brand_id, bucket);
        }
      }
    }

    const broadcastMap = new Map<string, any>();
    for (const b of broadcastRows) broadcastMap.set(b.id, b);


    let dispatched = 0, skipped = 0, failed = 0, retried = 0;
    const fnUrl = `${process.env.SUPABASE_URL}/functions/v1/automation-engine`;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    // Feature flag: fast-path enxuto no motor (event "broadcast_send").
    // Lida UMA vez por drain — não é hot-reload mas a flag é raramente flipada.
    const fastPathEvent = (await isFastPathEnabled()) ? "broadcast_send" : "manual_trigger";
    const queue = [...items];

    const runWorker = async () => {
      while (queue.length > 0 && Date.now() + SAFETY_MARGIN_MS < deadline) {
        const item = queue.shift();
        if (!item) break;

        const broadcast = broadcastMap.get(item.broadcast_id);
        if (!broadcast || broadcast.status !== "running") {
          await releaseQueueItemNoPenalty(item, "Broadcast não está em execução");
          retried++; continue;
        }

        const contact = contactMap.get(item.contact_id);
        if (!contact) {
          await finishQueueItem(item, "failed", "Contato não encontrado");
          failed++; continue;
        }

        const blocked = blockedByBrand.get(item.brand_id);
        const phoneCand = contact.phone ?? contact.wa_id ?? null;
        const emailCand = contact.email ? contact.email.toLowerCase() : null;
        if ((phoneCand && blocked?.phones.has(phoneCand)) || (emailCand && blocked?.emails.has(emailCand))) {
          await finishQueueItem(item, "skipped", "Contato no blocklist");
          skipped++; continue;
        }

        // Conversa preexistente do contato (qualquer canal). Quando null, o
        // automation-engine cria a conversa no canal sorteado pelo
        // resolveTemplateChannel — respeitando a regra de canais do nó.
        const conv = convMap.get(`${item.brand_id}:${item.contact_id}`) ?? null;


        if (broadcast.skip_no_window) {
          const open = conv?.window_expires_at && new Date(conv.window_expires_at).getTime() > Date.now();
          if (!open) {
            await finishQueueItem(item, "skipped", "Janela 24h fechada", null, conv?.id ?? null);
            skipped++; continue;
          }
        }

        try {
          const ac = new AbortController();
          const timer = setTimeout(() => ac.abort(), AUTOMATION_ENGINE_TIMEOUT_MS);
          let res: Response;
          try {
            res = await fetch(fnUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
              body: JSON.stringify({
                event: fastPathEvent,
                automation_id: item.automation_id,
                contact_id: item.contact_id,
                conversation_id: conv?.id ?? null,
                variables: { broadcast_id: item.broadcast_id, broadcast_target_id: item.target_id },
                async: true,
              }),
              signal: ac.signal,
            });
          } catch (fetchErr: any) {
            clearTimeout(timer);
            // Timeout/abort: o automation-engine em modo async:true cria o run
            // antes de fazer trabalho pesado. Assumimos dispatched — o cron
            // broadcast-reconcile detecta falhas reais depois.
            if (fetchErr?.name === "AbortError") {
              await finishQueueItem(item, "dispatched", null, null, conv?.id ?? null);
              dispatched++; continue;
            }
            throw fetchErr;
          }
          clearTimeout(timer);
          if (!res.ok) {
            const errText = (await res.text()).slice(0, 500);
            const kind = classifyMetaError(errText);
            if (kind === "daily_tier") {
              await failAllPendingForBroadcast(
                item.broadcast_id,
                "Tier diário Meta atingido (80007) — recrie o broadcast amanhã",
              );
              await finishQueueItem(item, "failed", errText);
              failed++; continue;
            }
            if (kind === "quality") {
              await failAllPendingForBroadcast(
                item.broadcast_id,
                "Qualidade do número baixou (131048) — investigue antes de continuar",
              );
              await finishQueueItem(item, "failed", errText);
              failed++; continue;
            }
            if (kind === "permanent_contact") {
              // Erro permanente do contato (131049/131026/131050/130472/131053).
              // Retry só desperdiça quota e polui api_request_logs — fail direto.
              await finishQueueItem(item, "failed", errText);
              failed++; continue;
            }
            // "automation not active": operador desativou brevemente a
            // automação. Trata como transitório SEM penalidade — não
            // queima as 4 tentativas do fail_or_retry (que teria matado
            // 2.664 itens do Captura 5 em cenário anterior).
            if (/automation not active/i.test(errText)) {
              await releaseQueueItemNoPenalty(item, "Automação inativa (retry sem penalidade)");
              retried++; continue;
            }
            // rate_limit ou genérico → retry com backoff
            await retryQueueItem(item, errText);
            retried++; continue;
          }
          let runId: string | null = null;
          try {
            const json = await res.json();
            if (json && typeof json.run_id === "string") runId = json.run_id;
          } catch {}
          await finishQueueItem(item, "dispatched", null, runId, conv?.id ?? null);
          dispatched++;
        } catch (e: any) {
          await retryQueueItem(item, String(e?.message ?? e).slice(0, 500));
          retried++;
        }
      }

    };

    const workers = Array.from({ length: Math.min(WORKER_CONCURRENCY, items.length) }, () => runWorker());
    await Promise.all(workers);

    totalDispatched += dispatched;
    totalSkipped += skipped;
    totalFailed += failed;
    totalRetried += retried;

    // Se ainda há itens pendentes no buffer local (deadline atingido), devolve à fila
    // EM PARALELO — 1 a 1 sequencial custava ~12s para 120 leftovers.
    if (queue.length > 0) {
      const leftovers = queue.splice(0);
      await Promise.all(leftovers.map((l) => releaseQueueItemNoPenalty(l, "Deadline do drain atingido")));
      totalRetried += leftovers.length;
    }
    }
  }

  // recount removido do tick rápido — roda em /api/public/cron/broadcast-reconcile (2min).
  void touchedBroadcasts;

  return { claimed: totalClaimed, dispatched: totalDispatched, skipped: totalSkipped, failed: totalFailed, retried: totalRetried, requeued };
}

/**
 * Tick principal: processa todos os broadcasts running.
 * NÃO faz reconciliação aqui — isso roda em /api/public/cron/broadcast-reconcile.
 */
export async function processBroadcastTick(): Promise<{
  processed: number;
  enqueued: number;
  pending: number;
  requeued: number;
  locked: boolean;
}> {
  // Requeue targets em processing SEM run_id (run nunca foi criada).
  const { data: requeuedRows } = await supabaseAdmin.rpc("requeue_stuck_broadcast_targets");
  const requeued = typeof requeuedRows === "number" ? requeuedRows : 0;

  // Promove scheduled → running
  const nowIso = new Date().toISOString();
  await supabaseAdmin
    .from("broadcasts")
    .update({ status: "running", started_at: nowIso })
    .eq("status", "scheduled")
    .lte("scheduled_at", nowIso);

  const { data: running } = await supabaseAdmin
    .from("broadcasts")
    .select("id")
    .eq("status", "running");
  const list = (running ?? []) as any[];

  // Processa cada broadcast (lock por broadcast garante segurança paralela)
  let enqueuedTotal = 0;
  const results = await Promise.all(list.map((b) => processBroadcastNow(b.id)));
  for (const r of results) enqueuedTotal += r.enqueued;

  let pendingCount = 0;
  if (list.length > 0) {
    const { count } = await supabaseAdmin
      .from("broadcast_targets")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .in("broadcast_id", list.map((b) => b.id));
    pendingCount = count ?? 0;
  }

  return { processed: list.length, enqueued: enqueuedTotal, pending: pendingCount, requeued, locked: false };
}

/**
 * Reconcilia broadcasts:
 * - Promove processing-com-run para dispatched (runs criadas mas tick caiu antes de atualizar).
 * - Verifica targets dispatched recentes cujas mensagens foram rejeitadas pela Meta.
 * - Recalcula contadores de broadcasts ativos.
 */
export async function reconcileBroadcasts(): Promise<{ promoted: number; failedDetected: number; recounted: number }> {
  // 1) Promove processing com run_id já criada
  const { data: promotedRows } = await (supabaseAdmin as any).rpc("promote_processing_with_run");
  const promoted = typeof promotedRows === "number" ? promotedRows : 0;

  // 2) Detecta mensagens rejeitadas async pela Meta (últimos 30 minutos)
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data: targets } = await supabaseAdmin
    .from("broadcast_targets")
    .select("id, broadcast_id, run_id, dispatched_at")
    .eq("status", "dispatched")
    .not("run_id", "is", null)
    .gte("dispatched_at", since)
    .limit(500);

  const list = (targets ?? []) as any[];
  let failedDetected = 0;
  const touchedBroadcasts = new Set<string>();

  if (list.length > 0) {
    const runIds = Array.from(new Set(list.map((t) => t.run_id)));
    const { data: runs } = await supabaseAdmin
      .from("automation_runs")
      .select("id, conversation_id, started_at")
      .in("id", runIds);
    const runMap = new Map<string, any>();
    for (const r of (runs ?? []) as any[]) runMap.set(r.id, r);

    for (const t of list) {
      const run = runMap.get(t.run_id);
      if (!run?.conversation_id || !run?.started_at) continue;

      const { data: msgs } = await supabaseAdmin
        .from("messages")
        .select("status, error_code, error_message")
        .eq("conversation_id", run.conversation_id)
        .eq("direction", "outbound")
        .gte("created_at", run.started_at)
        .order("created_at", { ascending: true })
        .limit(20);

      const ms = (msgs ?? []) as any[];
      if (ms.length === 0) continue;
      const allFailed = ms.every((m) => m.status === "failed");
      if (!allFailed) continue;

      const first = ms.find((m) => m.error_message || m.error_code);
      const errText = first ? `[${first.error_code ?? "?"}] ${first.error_message ?? "Falha no envio"}` : "Mensagem rejeitada";

      await supabaseAdmin
        .from("broadcast_targets")
        .update({ status: "failed", error: errText.slice(0, 500) })
        .eq("id", t.id);

      // Sincroniza a linha da fila para não divergir do target no painel
      await supabaseAdmin
        .from("broadcast_dispatch_queue")
        .update({ status: "failed", last_error: errText.slice(0, 500), updated_at: new Date().toISOString() })
        .eq("target_id", t.id);

      failedDetected++;
      touchedBroadcasts.add(t.broadcast_id);
    }
  }

  // 3) Recount de todos broadcasts ativos
  const { data: actives } = await supabaseAdmin
    .from("broadcasts")
    .select("id")
    .in("status", ["running", "scheduled"]);
  for (const b of (actives ?? []) as any[]) touchedBroadcasts.add(b.id);

  for (const bid of touchedBroadcasts) {
    await supabaseAdmin.rpc("recount_broadcast_progress", { _broadcast_id: bid });
  }

  return { promoted, failedDetected, recounted: touchedBroadcasts.size };
}
