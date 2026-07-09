/**
 * Reconciliação — port de reconcileBroadcasts:
 * 1. Promove processing-com-run para dispatched.
 * 2. Detecta targets dispatched cujas mensagens a Meta rejeitou async.
 * 3. Reconta progresso dos broadcasts ativos.
 */
import { pool, callScalar } from "./db.js";

export async function reconcileOnce() {
  const promoted = Number(await callScalar("promote_processing_with_run")) || 0;

  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { rows: targets } = await pool.query(
    `SELECT id, broadcast_id, run_id
       FROM public.broadcast_targets
      WHERE status = 'dispatched' AND run_id IS NOT NULL AND dispatched_at >= $1
      LIMIT 500`,
    [since],
  );

  let failedDetected = 0;
  const touched = new Set();

  if (targets.length > 0) {
    const runIds = [...new Set(targets.map((t) => t.run_id))];
    const { rows: runs } = await pool.query(
      `SELECT id, conversation_id, started_at FROM public.automation_runs WHERE id = ANY($1::uuid[])`,
      [runIds],
    );
    const runMap = new Map(runs.map((r) => [r.id, r]));

    for (const t of targets) {
      const run = runMap.get(t.run_id);
      if (!run?.conversation_id || !run?.started_at) continue;

      const { rows: msgs } = await pool.query(
        `SELECT status, error_code, error_message
           FROM public.messages
          WHERE conversation_id = $1 AND direction = 'outbound' AND created_at >= $2
          ORDER BY created_at ASC
          LIMIT 20`,
        [run.conversation_id, run.started_at],
      );
      if (msgs.length === 0) continue;
      if (!msgs.every((m) => m.status === "failed")) continue;

      const first = msgs.find((m) => m.error_message || m.error_code);
      const errText = first
        ? `[${first.error_code ?? "?"}] ${first.error_message ?? "Falha no envio"}`
        : "Mensagem rejeitada";

      await pool.query(
        `UPDATE public.broadcast_targets SET status = 'failed', error = $2 WHERE id = $1`,
        [t.id, errText.slice(0, 500)],
      );
      await pool.query(
        `UPDATE public.broadcast_dispatch_queue
            SET status = 'failed', last_error = $2, updated_at = now()
          WHERE target_id = $1`,
        [t.id, errText.slice(0, 500)],
      );
      failedDetected++;
      touched.add(t.broadcast_id);
    }
  }

  const { rows: actives } = await pool.query(
    `SELECT id FROM public.broadcasts WHERE status IN ('running', 'scheduled')`,
  );
  for (const b of actives) touched.add(b.id);
  for (const bid of touched) {
    await callScalar("recount_broadcast_progress", [bid]);
  }

  return { promoted, failedDetected, recounted: touched.size };
}

/** Snapshot de saúde: loga WARN quando ritmo real < 70% do configurado. */
export async function healthSnapshot() {
  try {
    const { rows: snaps } = await pool.query(
      `SELECT * FROM public.snapshot_running_broadcast_health()`,
    );
    for (const s of snaps) {
      if (s.under_target) {
        console.warn(
          `[health] under_target broadcast=${s.broadcast_id} ` +
            `actual=${s.actual_rate_1m}/min configured=${s.configured_rate}/min ` +
            `pending=${s.pending_total} tokens=${Math.floor(Number(s.tokens_available) || 0)}`,
        );
      }
    }
    return snaps.length;
  } catch (e) {
    console.error("[health] snapshot error:", e.message);
    return 0;
  }
}
