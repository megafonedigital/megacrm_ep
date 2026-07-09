import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authenticateApiKey, jsonError, jsonOk, normalizePhone } from "@/lib/api-auth.server";
import { toE164 } from "@/lib/phone";
import { withApiLogging } from "@/lib/api-logger.server";

const upsertSchema = z.object({
  phone: z.string().min(8).max(20),
  name: z.string().min(1).max(120).optional(),
  profile_name: z.string().min(1).max(120).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  tags: z.array(z.string().min(1).max(60)).max(50).optional(),
});

export const Route = createFileRoute("/api/public/v1/contacts")({
  server: {
    handlers: {
      POST: async ({ request }) => withApiLogging(request, async ({ setMeta }) => {
        const auth = await authenticateApiKey(request);
        if (!auth.ok) return jsonError(auth.status, auth.error);
        setMeta({ brandId: auth.brandId, apiKeyId: auth.keyId, apiKeyPrefix: auth.keyPrefix });

        let body: unknown;
        try { body = await request.json(); } catch { return jsonError(400, "Invalid JSON"); }
        setMeta({ requestBody: body });
        const parsed = upsertSchema.safeParse(body);
        if (!parsed.success) return jsonError(400, parsed.error.errors[0]?.message ?? "Invalid body");

        const phone = normalizePhone(parsed.data.phone);
        if (phone.length < 8) return jsonError(400, "Invalid phone");

        const { data: existing } = await supabaseAdmin
          .from("contacts")
          .select("id, metadata")
          .eq("brand_id", auth.brandId)
          .eq("wa_id", phone)
          .maybeSingle();

        const existingMeta = (existing?.metadata as any) ?? {};
        const existingTags: string[] = Array.isArray(existingMeta.tags) ? existingMeta.tags : [];
        const newTags = parsed.data.tags ?? [];
        const mergedTags = Array.from(new Set([...existingTags, ...newTags]));
        const mergedMeta = {
          ...existingMeta,
          ...(parsed.data.metadata ?? {}),
          tags: mergedTags,
        };

        const phoneE164 = toE164(parsed.data.phone);

        if (existing) {
          const { error } = await supabaseAdmin
            .from("contacts")
            .update({
              name: parsed.data.name ?? undefined,
              profile_name: parsed.data.profile_name ?? undefined,
              phone: phoneE164,
              metadata: mergedMeta,
            })
            .eq("id", existing.id);
          if (error) return jsonError(500, error.message);
          await triggerTagAutomations(auth.brandId, existing.id, newTags.filter((t) => !existingTags.includes(t)));
          return jsonOk({ contact_id: existing.id, created: false });
        }

        const { data: inserted, error } = await supabaseAdmin
          .from("contacts")
          .insert({
            brand_id: auth.brandId,
            wa_id: phone,
            phone: phoneE164,
            name: parsed.data.name ?? null,
            profile_name: parsed.data.profile_name ?? null,
            metadata: mergedMeta,
          })
          .select("id")
          .single();
        if (error || !inserted) return jsonError(500, error?.message ?? "insert failed");

        await triggerTagAutomations(auth.brandId, inserted.id, mergedTags);
        return jsonOk({ contact_id: inserted.id, created: true }, 201);
      }),

      GET: async ({ request }) => withApiLogging(request, async ({ setMeta }) => {
        const auth = await authenticateApiKey(request);
        if (!auth.ok) return jsonError(auth.status, auth.error);
        setMeta({ brandId: auth.brandId, apiKeyId: auth.keyId, apiKeyPrefix: auth.keyPrefix });

        const url = new URL(request.url);
        const search = url.searchParams.get("search")?.trim() ?? "";
        const tag = url.searchParams.get("tag")?.trim() ?? "";
        const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
        const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("page_size") ?? "25")));
        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;

        let q = supabaseAdmin
          .from("contacts")
          .select("id, name, profile_name, phone, wa_id, metadata, created_at, updated_at", { count: "exact" })
          .eq("brand_id", auth.brandId)
          .order("created_at", { ascending: false })
          .range(from, to);

        if (search) {
          q = q.or(`phone.ilike.%${search}%,name.ilike.%${search}%,profile_name.ilike.%${search}%,wa_id.ilike.%${search}%`);
        }
        if (tag) q = q.contains("metadata", { tags: [tag] });

        const { data, error, count } = await q;
        if (error) return jsonError(500, error.message);
        setMeta({ responseSummary: { total: count ?? 0, returned: data?.length ?? 0 } });
        return jsonOk({ data: data ?? [], page, page_size: pageSize, total: count ?? 0 });
      }),
    },
  },
});

async function triggerTagAutomations(brandId: string, contactId: string, addedTags: string[]) {
  if (!addedTags.length) return;
  const fnUrl = `${process.env.SUPABASE_URL}/functions/v1/automation-engine`;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  for (const tag of addedTags) {
    void fetch(fnUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ event: "tag_added", contact_id: contactId, tag }),
    }).catch(() => {});
  }
}
