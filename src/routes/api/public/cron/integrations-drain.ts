import { createFileRoute } from "@tanstack/react-router";
import { drainQueue } from "@/lib/integrations-queue.server";

// Chamado por pg_cron a cada 1 minuto. Para efetivamente drenar a fila a cada
// 30 s sem depender de granularidade < 1 min do pg_cron, fazemos duas passadas
// dentro do mesmo handler: uma imediata e outra ~30 s depois.
export const Route = createFileRoute("/api/public/cron/integrations-drain")({
  server: {
    handlers: {
      POST: async () => {
        const start = Date.now();
        const passA = { processed: 0, failed: 0 };
        const passB = { processed: 0, failed: 0 };

        try {
          const a = await drainQueue(12_000);
          passA.processed = a.processed;
          passA.failed = a.failed;
        } catch (e) {
          console.error("[cron/integrations-drain] passA", e);
        }

        // Aguarda até completar 25 s do início do tick antes de começar a 2ª passada.
        const waitMs = 25_000 - (Date.now() - start);
        if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));

        try {
          const b = await drainQueue(12_000);
          passB.processed = b.processed;
          passB.failed = b.failed;
        } catch (e) {
          console.error("[cron/integrations-drain] passB", e);
        }

        return Response.json({
          ok: true,
          processed: passA.processed + passB.processed,
          failed: passA.failed + passB.failed,
          passA,
          passB,
          totalMs: Date.now() - start,
        });
      },
    },
  },
});
