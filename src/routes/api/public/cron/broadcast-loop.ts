import { createFileRoute } from "@tanstack/react-router";
import { processBroadcastTick, drainBroadcastQueue } from "@/lib/broadcasts-engine.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Loop combinado: tick (enfileira) + drain (dispara).
 *
 * O lock global ("broadcast_loop_tick") protege APENAS o tick, que escreve
 * scheduled_send_at em lote e não deve rodar concorrente. O drain NÃO usa
 * lock: claim_broadcast_dispatch_queue já é concurrency-safe via
 * FOR UPDATE SKIP LOCKED, então drains paralelos nunca pegam o mesmo item.
 *
 * Separar os locks evita o cenário "skipped (lock held)" em que o ciclo
 * inteiro (tick + drain) estourava 15s e a execução seguinte do cron era
 * descartada, derrubando o throughput efetivo para ~2 drains/min.
 */
async function runLoop() {
  const t0 = Date.now();
  const owner = `loop-${t0}-${Math.random().toString(36).slice(2)}`;

  // Executa Tick e Drain em paralelo. O Tick ainda é protegido por lock global,
  // mas o Drain começa imediatamente sem esperar o Tick terminar (que pode levar 7s+).
  const [tickResult, drainResult] = await Promise.all([
    (async () => {
      const { data: acquired } = await (supabaseAdmin as any).rpc("try_acquire_named_lock", {
        _name: "broadcast_loop_tick",
        _owner: owner,
        _ttl_seconds: 15,
      });

      if (acquired !== true) {
        return { skipped: true };
      }

      try {
        return await processBroadcastTick();
      } catch (e: any) {
        console.error("[broadcast-loop] tick error", e);
        return { processed: 0, enqueued: 0, pending: 0, requeued: 0, locked: false, error: String(e?.message ?? e) };
      } finally {
        await (supabaseAdmin as any).rpc("release_named_lock", {
          _name: "broadcast_loop_tick",
          _owner: owner,
        });
      }
    })(),
    drainBroadcastQueue(10_000).catch((e) => {
      console.error("[broadcast-loop] drain error", e);
      return { claimed: 0, dispatched: 0, skipped: 0, failed: 0, retried: 0, requeued: 0, error: String(e?.message ?? e) };
    })
  ]);

  if ((tickResult as any).skipped) {
    console.log("[broadcast-loop] tick skipped (lock held) — drain continues");
  }

  // 3) Snapshot de saúde: registra ritmo real vs configurado por broadcast
  //    e loga WARN quando o ritmo está abaixo de 70% do alvo com fila pendente.
  try {
    const { data: snaps } = await (supabaseAdmin as any).rpc("snapshot_running_broadcast_health");
    for (const s of (snaps ?? []) as any[]) {
      if (s.under_target) {
        console.warn(
          `[broadcast-health] under_target broadcast=${s.broadcast_id} ` +
            `actual=${s.actual_rate_1m}/min configured=${s.configured_rate}/min ` +
            `lag=${s.lag_ratio} pending=${s.pending_total} processing=${s.processing_total} ` +
            `tokens=${Math.floor(Number(s.tokens_available) || 0)}`,
        );
      }
    }
  } catch (e) {
    console.error("[broadcast-health] snapshot error", e);
  }

  const elapsedMs = Date.now() - t0;
  console.log(
    `[broadcast-loop] claimed=${(drainResult as any).claimed ?? 0} ` +
      `dispatched=${(drainResult as any).dispatched ?? 0} ` +
      `retried=${(drainResult as any).retried ?? 0} ` +
      `requeued=${(drainResult as any).requeued ?? 0} ` +
      `enqueued=${(tickResult as any).enqueued ?? 0} ` +
      `pending=${(tickResult as any).pending ?? 0} ` +
      `tickSkipped=${(tickResult as any).skipped === true} ` +
      `elapsedMs=${elapsedMs}`,
  );

  return { ok: true, tick: tickResult, drain: drainResult, elapsedMs };
}

export const Route = createFileRoute("/api/public/cron/broadcast-loop")({
  server: {
    handlers: {
      POST: async () => Response.json(await runLoop()),
      GET: async () => Response.json(await runLoop()),
    },
  },
});
