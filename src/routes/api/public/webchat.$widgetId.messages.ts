import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { webchatError, webchatJson, webchatPreflight } from "@/lib/webchat-cors.server";

const SendBodySchema = z.object({
  text: z.string().trim().min(1).max(4000),
});

type SessionRow = {
  id: string;
  brand_id: string;
  channel_id: string;
  conversation_id: string | null;
  contact_id: string | null;
  widget_id: string;
};

async function loadSession(widgetId: string, token: string): Promise<SessionRow | null> {
  if (!token || token.length < 16 || token.length > 200) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("webchat_sessions")
    .select("id, brand_id, channel_id, conversation_id, contact_id, widget_id")
    .eq("widget_id", widgetId)
    .eq("session_token", token)
    .maybeSingle();
  if (error || !data) return null;
  return data as SessionRow;
}

export const Route = createFileRoute("/api/public/webchat/$widgetId/messages")({
  server: {
    handlers: {
      OPTIONS: async () => webchatPreflight(),

      // Visitor sends a message
      POST: async ({ request, params }) => {
        const widgetId = params.widgetId;
        if (!widgetId || !/^[0-9a-f-]{36}$/i.test(widgetId)) return webchatError(400, "invalid_widget_id");

        const token = request.headers.get("x-session-token") ?? "";
        const session = await loadSession(widgetId, token);
        if (!session || !session.conversation_id) return webchatError(401, "invalid_session");

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return webchatError(400, "invalid_json");
        }
        const parsed = SendBodySchema.safeParse(body);
        if (!parsed.success) return webchatError(400, "invalid_body", parsed.error.errors[0]?.message);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Insert inbound message
        const { data: msg, error: msgErr } = await supabaseAdmin
          .from("messages")
          .insert({
            conversation_id: session.conversation_id,
            brand_id: session.brand_id,
            channel_id: session.channel_id,
            direction: "inbound",
            type: "text",
            content: parsed.data.text,
            status: "delivered",
          })
          .select("id, created_at")
          .single();

        if (msgErr || !msg) {
          console.error("[webchat] insert message error:", msgErr);
          return webchatError(500, "insert_failed", msgErr?.message);
        }

        // Touch conversation: bump last_message_at. If it was marked
        // `resolvido`, reopen it — no webchat visitor knows the conversation
        // was "resolved"; sending a new message means they want a reply.
        await supabaseAdmin
          .from("conversations")
          .update({ last_message_at: msg.created_at, status: "aberto" })
          .eq("id", session.conversation_id)
          .eq("status", "resolvido");
        await supabaseAdmin
          .from("conversations")
          .update({ last_message_at: msg.created_at })
          .eq("id", session.conversation_id)
          .neq("status", "resolvido");

        // Touch session
        await supabaseAdmin
          .from("webchat_sessions")
          .update({ last_seen_at: new Date().toISOString() })
          .eq("id", session.id);

        // Trigger the AI agent (if one is attached to this conversation).
        // Awaited so the run isn't cut off when the worker returns; the
        // engine only enqueues outbound messages for webchat, so it stays fast.
        try {
          const { runAgentForConversation } = await import(
            "@/lib/ai-agents-engine.server"
          );
          await runAgentForConversation(session.conversation_id as string);
        } catch (e) {
          console.error("[webchat] agent run failed:", (e as Error).message);
        }


        return webchatJson({ ok: true, id: msg.id, created_at: msg.created_at });

      },

      // Visitor polls for new agent replies (?after=ISO)
      GET: async ({ request, params }) => {
        const widgetId = params.widgetId;
        if (!widgetId || !/^[0-9a-f-]{36}$/i.test(widgetId)) return webchatError(400, "invalid_widget_id");

        const token = request.headers.get("x-session-token") ?? "";
        const session = await loadSession(widgetId, token);
        if (!session || !session.conversation_id) return webchatError(401, "invalid_session");

        const url = new URL(request.url);
        const after = url.searchParams.get("after");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        let q = supabaseAdmin
          .from("messages")
          .select("id, direction, type, content, media_url, media_mime, media_filename, created_at, status")
          .eq("conversation_id", session.conversation_id)
          .order("created_at", { ascending: true })
          .limit(200);

        if (after) {
          const d = new Date(after);
          if (!isNaN(d.getTime())) q = q.gt("created_at", d.toISOString());
        }

        const { data: msgs, error } = await q;
        if (error) return webchatError(500, "query_failed", error.message);

        // Touch session last_seen
        void supabaseAdmin
          .from("webchat_sessions")
          .update({ last_seen_at: new Date().toISOString() })
          .eq("id", session.id);

        return webchatJson({
          messages: (msgs ?? []).map((m) => ({
            id: m.id,
            from: m.direction === "outbound" ? "agent" : "visitor",
            type: m.type,
            text: m.content,
            media_url: m.media_url,
            media_mime: m.media_mime,
            media_filename: m.media_filename,
            created_at: m.created_at,
          })),
        });
      },
    },
  },
});
