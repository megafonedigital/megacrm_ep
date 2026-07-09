/**
 * Tick: promove scheduled→running e enfileira targets com horário
 * determinístico (scheduled_send_at). Port de processBroadcastTick /
 * processBroadcastNow. A velocidade é imposta pelo agendamento uniforme
 * feito em enqueue_broadcast_dispatches — o tick só alimenta a fila.
 */
import { pool, callScalar } from "./db.js";

const LOCK_TTL_SECONDS = 25;

async function processBroadcastNow(broadcastId) {
  const lockName = `broadcast:${broadcastId}`;
  const lockOwner = `worker-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const acquired = await callScalar("try_acquire_named_lock", [
    lockName,
    lockOwner,
    LOCK_TTL_SECONDS,
  ]);
  if (acquired !== true) return { enqueued: 0 };

  try {
    const { rows } = await pool.query(
      `SELECT id, status, rate_per_minute FROM public.broadcasts WHERE id = $1`,
      [broadcastId],
    );
    const b = rows[0];
    if (!b || b.status !== "running") return { enqueued: 0 };

    // Limite alinhado ao burst do token bucket (rate/30) — a guarda de
    // carry-ahead na SQL impede over-enqueue de qualquer forma.
    const rate = Math.max(1, b.rate_per_minute || 60);
    const enqueueLimit = Math.max(5, Math.round(rate / 30));
    const enqueued =
      Number(await callScalar("enqueue_broadcast_dispatches", [b.id, enqueueLimit])) || 0;

    if (enqueued === 0) {
      await callScalar("recount_broadcast_progress", [b.id]);
    }
    return { enqueued };
  } finally {
    await callScalar("release_named_lock", [lockName, lockOwner]);
  }
}

export async function tickOnce() {
  // Requeue de targets processing sem run_id (run nunca foi criada).
  const requeued = Number(await callScalar("requeue_stuck_broadcast_targets")) || 0;

  // Promove scheduled → running.
  await pool.query(
    `UPDATE public.broadcasts
        SET status = 'running', started_at = now()
      WHERE status = 'scheduled' AND scheduled_at <= now()`,
  );

  const { rows: running } = await pool.query(
    `SELECT id FROM public.broadcasts WHERE status = 'running'`,
  );

  let enqueuedTotal = 0;
  const results = await Promise.all(running.map((b) => processBroadcastNow(b.id)));
  for (const r of results) enqueuedTotal += r.enqueued;

  return { processed: running.length, enqueued: enqueuedTotal, requeued };
}
