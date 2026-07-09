import { createFileRoute } from "@tanstack/react-router";
import { reconcileBroadcasts } from "@/lib/broadcasts-engine.server";

export const Route = createFileRoute("/api/public/cron/broadcast-reconcile")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const result = await reconcileBroadcasts();
          return Response.json({ ok: true, ...result });
        } catch (e: any) {
          return Response.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
        }
      },
      GET: async () => {
        try {
          const result = await reconcileBroadcasts();
          return Response.json({ ok: true, ...result });
        } catch (e: any) {
          return Response.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
