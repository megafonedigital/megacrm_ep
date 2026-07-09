import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authenticateApiKey, jsonError, jsonOk, normalizePhone } from "@/lib/api-auth.server";
import { withApiLogging } from "@/lib/api-logger.server";

const triggerSchema = z.object({
  contact_id: z.string().uuid().optional(),
  phone: z.string().min(8).max(20).optional(),
  email: z.string().email().max(255).optional(),
  variables: z.record(z.string(), z.any()).optional(),
}).refine((v) => v.contact_id || v.phone || v.email, { message: "contact_id, phone ou email obrigatório" });

export const Route = createFileRoute("/api/public/v1/automations/$id/trigger")({
  server: {
    handlers: {
      POST: async ({ request, params }) => withApiLogging(request, async ({ setMeta }) => {
        const auth = await authenticateApiKey(request);
        if (!auth.ok) return jsonError(auth.status, auth.error);
        setMeta({ brandId: auth.brandId, apiKeyId: auth.keyId, apiKeyPrefix: auth.keyPrefix });

        const body = await request.json().catch(() => null);
        setMeta({ requestBody: body });
        const parsed = triggerSchema.safeParse(body);
        if (!parsed.success) return jsonError(400, parsed.error.errors[0]?.message ?? "Invalid body");

        const { data: automation, error: aErr } = await supabaseAdmin
          .from("automations")
          .select("id, brand_id, status, graph")
          .eq("id", params.id)
          .maybeSingle();
        if (aErr) return jsonError(500, aErr.message);
        if (!automation) return jsonError(404, "Automation not found");
        if (automation.brand_id !== auth.brandId) return jsonError(403, "Automation does not belong to this brand");
        if (automation.status !== "active") return jsonError(400, "Automation is not active");

        const emailNorm = parsed.data.email?.trim().toLowerCase() || null;
        const phoneNorm = parsed.data.phone ? normalizePhone(parsed.data.phone) : null;

        let contactId = parsed.data.contact_id ?? null;
        if (!contactId && phoneNorm) {
          const { data: c } = await supabaseAdmin
            .from("contacts")
            .select("id")
            .eq("brand_id", auth.brandId)
            .eq("wa_id", phoneNorm)
            .maybeSingle();
          if (c) contactId = c.id;
        }
        if (!contactId && emailNorm) {
          const { data: c } = await supabaseAdmin
            .from("contacts")
            .select("id")
            .eq("brand_id", auth.brandId)
            .filter("metadata->>email", "eq", emailNorm)
            .limit(1)
            .maybeSingle();
          if (c) contactId = c.id;
        }
        if (!contactId) return jsonError(404, "Contato não encontrado para phone/email informados");

        const { data: contact } = await supabaseAdmin
          .from("contacts")
          .select("id, brand_id, metadata")
          .eq("id", contactId)
          .maybeSingle();
        if (!contact || contact.brand_id !== auth.brandId) {
          return jsonError(404, "Contact not found");
        }

        // Persist email on contact metadata if missing
        if (emailNorm && !(contact.metadata as any)?.email) {
          await supabaseAdmin
            .from("contacts")
            .update({ metadata: { ...((contact.metadata as any) ?? {}), email: emailNorm } })
            .eq("id", contactId);
        }

        const { data: conv } = await supabaseAdmin
          .from("conversations")
          .select("id")
          .eq("contact_id", contactId)
          .eq("brand_id", auth.brandId)
          .order("last_message_at", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle();
        if (!conv) return jsonError(409, "No conversation exists for this contact yet");

        const mergedVariables: Record<string, unknown> = { ...(parsed.data.variables ?? {}) };
        if (phoneNorm) mergedVariables.contact_phone = phoneNorm;
        if (emailNorm) mergedVariables.contact_email = emailNorm;

        const fnUrl = `${process.env.SUPABASE_URL}/functions/v1/automation-engine`;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
        const res = await fetch(fnUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            event: "manual_trigger",
            automation_id: automation.id,
            contact_id: contactId,
            conversation_id: conv.id,
            variables: mergedVariables,
          }),
        });
        const text = await res.text();
        if (!res.ok) return jsonError(res.status, text || "engine error");
        try {
          return jsonOk(JSON.parse(text));
        } catch {
          return jsonOk({ ok: true });
        }
      }),
    },
  },
});
