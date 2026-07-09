import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authenticateApiKey, jsonError, jsonOk } from "@/lib/api-auth.server";
import { withApiLogging } from "@/lib/api-logger.server";

const tagsSchema = z.object({
  tags: z.array(z.string().min(1).max(60)).min(1).max(50),
});

export const Route = createFileRoute("/api/public/v1/contacts/$id/tags")({
  server: {
    handlers: {
      POST: async ({ request, params }) => withApiLogging(request, async ({ setMeta }) => {
        const auth = await authenticateApiKey(request);
        if (!auth.ok) return jsonError(auth.status, auth.error);
        setMeta({ brandId: auth.brandId, apiKeyId: auth.keyId, apiKeyPrefix: auth.keyPrefix });
        const body = await request.json().catch(() => null);
        setMeta({ requestBody: body });
        const parsed = tagsSchema.safeParse(body);
        if (!parsed.success) return jsonError(400, "Invalid body");

        const { data: contact, error: cErr } = await supabaseAdmin
          .from("contacts")
          .select("id, metadata")
          .eq("brand_id", auth.brandId)
          .eq("id", params.id)
          .maybeSingle();
        if (cErr) return jsonError(500, cErr.message);
        if (!contact) return jsonError(404, "Contact not found");

        const meta = (contact.metadata as any) ?? {};
        const current: string[] = Array.isArray(meta.tags) ? meta.tags : [];
        const merged = Array.from(new Set([...current, ...parsed.data.tags]));
        const added = parsed.data.tags.filter((t) => !current.includes(t));

        const { error } = await supabaseAdmin
          .from("contacts")
          .update({ metadata: { ...meta, tags: merged } })
          .eq("id", params.id);
        if (error) return jsonError(500, error.message);

        const fnUrl = `${process.env.SUPABASE_URL}/functions/v1/automation-engine`;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
        for (const tag of added) {
          void fetch(fnUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
            body: JSON.stringify({ event: "tag_added", contact_id: params.id, tag }),
          }).catch(() => {});
        }

        return jsonOk({ tags: merged, added });
      }),

      DELETE: async ({ request, params }) => withApiLogging(request, async ({ setMeta }) => {
        const auth = await authenticateApiKey(request);
        if (!auth.ok) return jsonError(auth.status, auth.error);
        setMeta({ brandId: auth.brandId, apiKeyId: auth.keyId, apiKeyPrefix: auth.keyPrefix });
        const body = await request.json().catch(() => null);
        setMeta({ requestBody: body });
        const parsed = tagsSchema.safeParse(body);
        if (!parsed.success) return jsonError(400, "Invalid body");

        const { data: contact, error: cErr } = await supabaseAdmin
          .from("contacts")
          .select("id, metadata")
          .eq("brand_id", auth.brandId)
          .eq("id", params.id)
          .maybeSingle();
        if (cErr) return jsonError(500, cErr.message);
        if (!contact) return jsonError(404, "Contact not found");

        const meta = (contact.metadata as any) ?? {};
        const current: string[] = Array.isArray(meta.tags) ? meta.tags : [];
        const remaining = current.filter((t) => !parsed.data.tags.includes(t));

        const { error } = await supabaseAdmin
          .from("contacts")
          .update({ metadata: { ...meta, tags: remaining } })
          .eq("id", params.id);
        if (error) return jsonError(500, error.message);
        return jsonOk({ tags: remaining });
      }),
    },
  },
});
