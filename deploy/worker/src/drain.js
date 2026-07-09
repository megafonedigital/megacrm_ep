/**
 * Drain da fila durável (broadcast_dispatch_queue) — port do
 * drainBroadcastQueue de src/lib/broadcasts-engine.server.ts, com três
 * diferenças estruturais:
 *
 * 1. SEM deadline de request: roda em processo contínuo, então um batch é
 *    sempre processado até o fim (nada de "Deadline do drain atingido").
 * 2. SQL direto via pg em vez de PostgREST: sem limite de 8KB de URL
 *    (ANY($1::uuid[]) substitui os chunks de .in()), latência menor por RPC.
 * 3. Concorrência tunável por env em vez de auto-scaling limitado a 150.
 *
 * O teto de TAXA por broadcast continua 100% no Postgres
 * (claim_broadcast_dispatch_queue + broadcast_rate_state) — múltiplas
 * réplicas deste worker somam throughput sem duplicar envio (SKIP LOCKED).
 */
import { pool, callScalar, callRows } from "./db.js";
import { config } from "./config.js";
import { classifyMetaError } from "./meta-errors.js";

async function finishQueueItem(item, status, error = null, runId = null, conversationId = null) {
  await callScalar("finish_broadcast_dispatch", [
    item.id,
    item.target_id,
    status,
    runId,
    conversationId,
    error,
  ]);
}

async function retryQueueItem(item, error) {
  await callScalar("fail_or_retry_broadcast_dispatch", [
    item.id,
    item.target_id,
    String(error).slice(0, 500),
    config.maxAttempts,
  ]);
}

/** Devolve à fila sem penalizar tentativas (motivo interno, nunca chegou à Meta). */
async function releaseQueueItemNoPenalty(item, reason) {
  await callScalar("release_broadcast_dispatch_no_penalty", [
    item.id,
    item.target_id,
    String(reason).slice(0, 500),
  ]);
}

async function failAllPendingForBroadcast(broadcastId, errorMsg) {
  const msg = errorMsg.slice(0, 500);
  await pool.query(
    `UPDATE public.broadcast_dispatch_queue
        SET status = 'failed', last_error = $2, updated_at = now()
      WHERE broadcast_id = $1 AND status IN ('pending', 'processing')`,
    [broadcastId, msg],
  );
  await pool.query(
    `UPDATE public.broadcast_targets
        SET status = 'failed', error = $2, claimed_at = NULL
      WHERE broadcast_id = $1 AND status IN ('pending', 'processing') AND run_id IS NULL`,
    [broadcastId, msg],
  );
  console.warn(`[broadcast ${broadcastId}] AUTO-FAIL pending: ${msg}`);
}

/** Feature flag do fast-path no motor. Falha-aberto: erro → caminho normal. */
async function resolveEngineEvent() {
  try {
    const { rows } = await pool.query(
      `SELECT value FROM public.app_settings WHERE key = 'broadcasts.fast_path_enabled'`,
    );
    return rows[0]?.value === true ? "broadcast_send" : "manual_trigger";
  } catch {
    return "manual_trigger";
  }
}

/**
 * Prefetch de contexto do batch. Itens novos já vêm desnormalizados do claim
 * (phone/wa_id); o fallback cobre linhas antigas sem desnormalização.
 */
async function prefetchContext(items) {
  const contactIds = [...new Set(items.map((i) => i.contact_id))];
  const brandIds = [...new Set(items.map((i) => i.brand_id))];
  const broadcastIds = [...new Set(items.map((i) => i.broadcast_id))];

  const contactMap = new Map();
  const convMap = new Map();
  const blockedByBrand = new Map();

  const { rows: broadcastRows } = await pool.query(
    `SELECT id, skip_no_window, status FROM public.broadcasts WHERE id = ANY($1::uuid[])`,
    [broadcastIds],
  );

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
    const needsWindowCheck = broadcastRows.some((b) => b.skip_no_window);
    if (needsWindowCheck) {
      for (const brandId of brandIds) {
        const rows = await callRows("get_latest_conversations", [brandId, contactIds]);
        for (const c of rows) {
          convMap.set(`${brandId}:${c.contact_id}`, {
            id: c.id,
            window_expires_at: c.window_expires_at ?? null,
          });
        }
      }
    } else {
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
    // Fallback: linhas antigas sem desnormalização — prefetch completo.
    const [{ rows: contacts }, convBundles] = await Promise.all([
      pool.query(
        `SELECT id, phone, wa_id, metadata FROM public.contacts WHERE id = ANY($1::uuid[])`,
        [contactIds],
      ),
      Promise.all(
        brandIds.map(async (brandId) => ({
          brandId,
          rows: await callRows("get_latest_conversations", [brandId, contactIds]),
        })),
      ),
    ]);

    for (const c of contacts) {
      contactMap.set(c.id, {
        id: c.id,
        phone: c.phone ?? null,
        wa_id: c.wa_id ?? null,
        email: c.metadata?.email?.toLowerCase?.() ?? null,
      });
    }
    for (const bundle of convBundles) {
      for (const c of bundle.rows) {
        convMap.set(`${bundle.brandId}:${c.contact_id}`, {
          id: c.id,
          window_expires_at: c.window_expires_at ?? null,
        });
      }
    }

    const phones = [...new Set([...contactMap.values()].map((c) => c.phone ?? c.wa_id).filter(Boolean))];
    const emails = [...new Set([...contactMap.values()].map((c) => c.email).filter(Boolean))];
    const values = [...phones, ...emails];
    if (values.length > 0) {
      const { rows: blocks } = await pool.query(
        `SELECT brand_id, value, kind FROM public.contact_blocklist
          WHERE brand_id = ANY($1::uuid[]) AND value = ANY($2::text[])`,
        [brandIds, values],
      );
      for (const blk of blocks) {
        const bucket = blockedByBrand.get(blk.brand_id) ?? { phones: new Set(), emails: new Set() };
        if (blk.kind === "phone") bucket.phones.add(blk.value);
        else if (blk.kind === "email") bucket.emails.add(blk.value);
        blockedByBrand.set(blk.brand_id, bucket);
      }
    }
  }

  const broadcastMap = new Map(broadcastRows.map((b) => [b.id, b]));
  return { contactMap, convMap, blockedByBrand, broadcastMap };
}

/** Chama o automation-engine. AbortError = async aceito → dispatched. */
async function callEngine(item, conv, engineEvent) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), config.engineTimeoutMs);
  try {
    const res = await fetch(`${config.functionsUrl}/automation-engine`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.serviceRoleKey}`,
      },
      body: JSON.stringify({
        event: engineEvent,
        automation_id: item.automation_id,
        contact_id: item.contact_id,
        conversation_id: conv?.id ?? null,
        variables: { broadcast_id: item.broadcast_id, broadcast_target_id: item.target_id },
        async: true,
      }),
      signal: ac.signal,
    });
    if (!res.ok) {
      return { kind: "http_error", errText: (await res.text()).slice(0, 500) };
    }
    let runId = null;
    try {
      const json = await res.json();
      if (typeof json?.run_id === "string") runId = json.run_id;
    } catch {
      /* corpo não-JSON é aceitável em async:true */
    }
    return { kind: "ok", runId };
  } catch (e) {
    // Timeout: em async:true o engine cria o run antes do trabalho pesado.
    // Assumimos dispatched — o reconcile detecta falhas reais depois.
    if (e?.name === "AbortError") return { kind: "ok", runId: null };
    return { kind: "network_error", errText: String(e?.message ?? e).slice(0, 500) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Processa UM batch da fila: claim → prefetch → dispatch paralelo.
 * Retorna contadores; `claimed === batchSize` sinaliza que há mais trabalho
 * imediato (o loop re-claima sem dormir).
 */
export async function drainOnce() {
  const requeued = Number(await callScalar("requeue_stuck_broadcast_dispatches")) || 0;

  const items = await callRows("claim_broadcast_dispatch_queue", [config.drainBatchSize]);
  if (items.length === 0) {
    return { claimed: 0, dispatched: 0, skipped: 0, failed: 0, retried: 0, requeued };
  }

  const [ctx, engineEvent] = await Promise.all([prefetchContext(items), resolveEngineEvent()]);
  const { contactMap, convMap, blockedByBrand, broadcastMap } = ctx;

  let dispatched = 0, skipped = 0, failed = 0, retried = 0;
  const queue = [...items];
  const failedAllBroadcasts = new Set();

  const runWorker = async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;

      // Broadcast entrou em fail-all neste mesmo batch: devolve sem penalidade.
      if (failedAllBroadcasts.has(item.broadcast_id)) {
        await releaseQueueItemNoPenalty(item, "Broadcast em fail-all neste batch");
        retried++;
        continue;
      }

      const broadcast = broadcastMap.get(item.broadcast_id);
      if (!broadcast || broadcast.status !== "running") {
        await releaseQueueItemNoPenalty(item, "Broadcast não está em execução");
        retried++;
        continue;
      }

      const contact = contactMap.get(item.contact_id);
      if (!contact) {
        await finishQueueItem(item, "failed", "Contato não encontrado");
        failed++;
        continue;
      }

      const blocked = blockedByBrand.get(item.brand_id);
      const phoneCand = contact.phone ?? contact.wa_id ?? null;
      if (
        (phoneCand && blocked?.phones.has(phoneCand)) ||
        (contact.email && blocked?.emails.has(contact.email))
      ) {
        await finishQueueItem(item, "skipped", "Contato no blocklist");
        skipped++;
        continue;
      }

      const conv = convMap.get(`${item.brand_id}:${item.contact_id}`) ?? null;

      if (broadcast.skip_no_window) {
        const open =
          conv?.window_expires_at && new Date(conv.window_expires_at).getTime() > Date.now();
        if (!open) {
          await finishQueueItem(item, "skipped", "Janela 24h fechada", null, conv?.id ?? null);
          skipped++;
          continue;
        }
      }

      const result = await callEngine(item, conv, engineEvent);

      if (result.kind === "ok") {
        await finishQueueItem(item, "dispatched", null, result.runId, conv?.id ?? null);
        dispatched++;
        continue;
      }

      if (result.kind === "network_error") {
        await retryQueueItem(item, result.errText);
        retried++;
        continue;
      }

      // http_error: classifica pela resposta da Meta/engine
      const errText = result.errText;
      const kind = classifyMetaError(errText);
      if (kind === "daily_tier") {
        failedAllBroadcasts.add(item.broadcast_id);
        await failAllPendingForBroadcast(
          item.broadcast_id,
          "Tier diário Meta atingido (80007) — recrie o broadcast amanhã",
        );
        await finishQueueItem(item, "failed", errText);
        failed++;
      } else if (kind === "quality") {
        failedAllBroadcasts.add(item.broadcast_id);
        await failAllPendingForBroadcast(
          item.broadcast_id,
          "Qualidade do número baixou (131048) — investigue antes de continuar",
        );
        await finishQueueItem(item, "failed", errText);
        failed++;
      } else if (kind === "permanent_contact") {
        await finishQueueItem(item, "failed", errText);
        failed++;
      } else if (/automation not active/i.test(errText)) {
        await releaseQueueItemNoPenalty(item, "Automação inativa (retry sem penalidade)");
        retried++;
      } else {
        // rate_limit ou genérico → retry com backoff (SQL controla next_attempt_at)
        await retryQueueItem(item, errText);
        retried++;
      }
    }
  };

  const workers = Array.from(
    { length: Math.min(config.drainConcurrency, items.length) },
    () => runWorker(),
  );
  await Promise.all(workers);

  return { claimed: items.length, dispatched, skipped, failed, retried, requeued };
}
