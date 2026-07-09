import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { webchatError, webchatJson, webchatPreflight } from "@/lib/webchat-cors.server";

const StartBodySchema = z.object({
  visitor_id: z.string().trim().min(8).max(120),
  name: z.string().trim().min(1).max(80).optional(),
  email: z.string().trim().email().max(200).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  page_url: z.string().trim().max(500).optional(),
});

function digitsOnly(v: string | undefined | null): string | null {
  if (!v) return null;
  const d = v.replace(/\D+/g, "");
  if (d.length < 8 || d.length > 15) return null;
  return d;
}

export const Route = createFileRoute("/api/public/webchat/$widgetId/session")({
  server: {
    handlers: {
      OPTIONS: async () => webchatPreflight(),
      POST: async ({ request, params }) => {
        const widgetId = params.widgetId;
        if (!widgetId || !/^[0-9a-f-]{36}$/i.test(widgetId)) {
          return webchatError(400, "invalid_widget_id");
        }

        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return webchatError(400, "invalid_json");
        }

        const parsed = StartBodySchema.safeParse(payload);
        if (!parsed.success) {
          return webchatError(400, "invalid_body", parsed.error.errors[0]?.message);
        }
        const { visitor_id, name, email, phone, page_url } = parsed.data;

        const userAgent = request.headers.get("user-agent")?.slice(0, 400) ?? undefined;
        const ip =
          request.headers.get("cf-connecting-ip") ??
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          undefined;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Server-side enforcement of widget requirements
        const { data: widget } = await supabaseAdmin
          .from("webchat_widgets")
          .select("require_name, require_phone, active")
          .eq("id", widgetId)
          .maybeSingle();
        if (!widget || !widget.active) return webchatError(404, "widget_not_found");
        if (widget.require_name && (!name || !name.trim())) {
          return webchatError(400, "name_required");
        }
        const phoneDigits = digitsOnly(phone);
        if (widget.require_phone && !phoneDigits) {
          return webchatError(400, "phone_required");
        }

        const { data, error } = await supabaseAdmin.rpc("webchat_start_session", {
          p_widget_id: widgetId,
          p_visitor_id: visitor_id,
          p_name: name ?? "",
          p_phone: phoneDigits ?? null,
          p_email: email && email.length > 0 ? email : null,
          p_user_agent: userAgent,
          p_ip: ip,
          p_page_url: page_url ?? undefined,
        } as never);
        if (error) {
          if (error.message?.includes("widget_not_found")) return webchatError(404, "widget_not_found");
          console.error("[webchat] start_session error:", error);
          return webchatError(500, "session_failed", error.message);
        }
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) return webchatError(500, "session_failed");

        return webchatJson({
          session_token: row.session_token,
          session_id: row.session_id,
          conversation_id: row.conversation_id,
          is_new: row.is_new,
        });
      },
    },
  },
});
