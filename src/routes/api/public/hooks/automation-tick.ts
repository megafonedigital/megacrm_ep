import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

export const Route = createFileRoute("/api/public/hooks/automation-tick")({
  server: {
    handlers: {
      POST: async () => {
        const url = process.env.SUPABASE_URL!;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
        const fnUrl = `${url}/functions/v1/automation-engine`;
        const res = await fetch(fnUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({ event: "tick" }),
        });
        const text = await res.text();
        return new Response(text, { status: res.status, headers: { "Content-Type": "application/json" } });
      },
    },
  },
});
