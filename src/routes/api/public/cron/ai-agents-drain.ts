import { createFileRoute } from "@tanstack/react-router";
import { drainAgentDeliveryJobs, drainAgentPendingRuns, drainStuckAgentOutgoingMessages } from "@/lib/ai-agents-engine.server";

// Chamado por pg_cron a cada 10s.
// Mantemos 1 conversa por tick para evitar que uma execução longa consuma o
// tempo de vida da request e mate o envio no meio da sequência texto→botão→áudio.
export const Route = createFileRoute("/api/public/cron/ai-agents-drain")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const [pendingRuns, recoveredOutgoing] = await Promise.all([
            drainAgentPendingRuns(1),
            Promise.all([drainAgentDeliveryJobs(3), drainStuckAgentOutgoingMessages(1)]),
          ]);
          const [deliveryJobs, stuckOutgoing] = recoveredOutgoing;
          return Response.json({ ok: true, ...pendingRuns, delivery_jobs: deliveryJobs, recovered_outgoing: stuckOutgoing });
        } catch (e) {
          console.error("[cron/ai-agents-drain]", e);
          return Response.json(
            { ok: false, error: (e as Error).message ?? "drain failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
