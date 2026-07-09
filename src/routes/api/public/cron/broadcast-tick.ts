import { createFileRoute } from "@tanstack/react-router";
import { processBroadcastTick } from "@/lib/broadcasts-engine.server";

export const Route = createFileRoute("/api/public/cron/broadcast-tick")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const result = await processBroadcastTick();
          return Response.json({ ok: true, ...result });
        } catch (e: any) {
          return Response.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
        }
      },
      GET: async () => {
        // Permite acionar manualmente via navegador para debug.
        try {
          const result = await processBroadcastTick();
          return Response.json({ ok: true, ...result });
        } catch (e: any) {
          return Response.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
