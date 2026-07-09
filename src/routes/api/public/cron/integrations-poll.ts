import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { syncAccount } from "@/lib/integrations-sync.server";

// Polling horário: hoje sincroniza Hotmart (produtos) e ActiveCampaign (tags + listas).
// Shopify/Sendflow ficam como no-op por enquanto.
export const Route = createFileRoute("/api/public/cron/integrations-poll")({
  server: {
    handlers: {
      POST: async () => {
        const { data: accounts, error } = await supabaseAdmin
          .from("integration_accounts")
          .select("id, platform, name")
          .eq("status", "active")
          .in("platform", ["hotmart", "activecampaign", "sendflow"]);

        if (error) return Response.json({ error: error.message }, { status: 500 });

        const results: Array<{ id: string; platform: string; ok: boolean; error?: string; results?: any }> = [];
        for (const acc of accounts ?? []) {
          try {
            const r = await syncAccount(acc.id);
            results.push({ id: acc.id, platform: acc.platform, ok: true, results: r.results });
          } catch (e: any) {
            results.push({ id: acc.id, platform: acc.platform, ok: false, error: e?.message ?? String(e) });
          }
        }

        return Response.json({ polled: results.length, results });
      },
    },
  },
});
