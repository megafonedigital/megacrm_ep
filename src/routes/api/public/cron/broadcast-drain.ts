import { createFileRoute } from "@tanstack/react-router";
import { drainBroadcastQueue } from "@/lib/broadcasts-engine.server";

// Deadline 10s (antes 4s): drains concorrentes são seguros (FOR UPDATE SKIP LOCKED).
// O deadline curto fazia o prefetch consumir todo o tempo e devolver o lote inteiro
// como "retried" antes de qualquer worker rodar.
async function run() {
  try {
    const result = await drainBroadcastQueue(10_000);
    return Response.json({ ok: true, ...result });
  } catch (e) {
    console.error("[cron/broadcast-drain]", e);
    return Response.json(
      { ok: false, error: (e as Error).message ?? "drain failed" },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/public/cron/broadcast-drain")({
  server: {
    handlers: {
      POST: async () => run(),
      GET: async () => run(),
    },
  },
});
