import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authenticateApiKey, jsonError, jsonOk } from "@/lib/api-auth.server";
import { withApiLogging } from "@/lib/api-logger.server";

export const Route = createFileRoute("/api/public/v1/contacts/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => withApiLogging(request, async ({ setMeta }) => {
        const auth = await authenticateApiKey(request);
        if (!auth.ok) return jsonError(auth.status, auth.error);
        setMeta({ brandId: auth.brandId, apiKeyId: auth.keyId, apiKeyPrefix: auth.keyPrefix });
        const { data, error } = await supabaseAdmin
          .from("contacts")
          .select("id, name, profile_name, phone, wa_id, metadata, created_at, updated_at")
          .eq("brand_id", auth.brandId)
          .eq("id", params.id)
          .maybeSingle();
        if (error) return jsonError(500, error.message);
        if (!data) return jsonError(404, "Contact not found");
        return jsonOk(data);
      }),
    },
  },
});
