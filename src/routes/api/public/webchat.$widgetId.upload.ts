import { createFileRoute } from "@tanstack/react-router";
import { webchatError, webchatJson, webchatPreflight } from "@/lib/webchat-cors.server";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MIMES = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

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

function sanitizeFilename(name: string): string {
  const base = (name || "arquivo").split(/[\\/]/).pop() ?? "arquivo";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return cleaned || "arquivo";
}

function extFromName(name: string): string {
  const m = /\.([a-zA-Z0-9]{1,8})$/.exec(name);
  return m ? m[1].toLowerCase() : "bin";
}

export const Route = createFileRoute("/api/public/webchat/$widgetId/upload")({
  server: {
    handlers: {
      OPTIONS: async () => webchatPreflight(),

      POST: async ({ request, params }) => {
        const widgetId = params.widgetId;
        if (!widgetId || !/^[0-9a-f-]{36}$/i.test(widgetId)) return webchatError(400, "invalid_widget_id");

        const token = request.headers.get("x-session-token") ?? "";
        const session = await loadSession(widgetId, token);
        if (!session || !session.conversation_id) return webchatError(401, "invalid_session");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Check widget allows attachments
        const { data: widget } = await supabaseAdmin
          .from("webchat_widgets")
          .select("allow_attachments")
          .eq("id", widgetId)
          .maybeSingle();
        if (!widget) return webchatError(404, "widget_not_found");
        if ((widget as { allow_attachments?: boolean }).allow_attachments === false) {
          return webchatError(403, "attachments_disabled");
        }

        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          return webchatError(400, "invalid_multipart");
        }
        const file = form.get("file");
        if (!(file instanceof File)) return webchatError(400, "file_required");
        if (file.size <= 0) return webchatError(400, "empty_file");
        if (file.size > MAX_BYTES) return webchatError(413, "file_too_large", "Máximo 10 MB.");

        const mime = (file.type || "application/octet-stream").toLowerCase();
        if (!ALLOWED_MIMES.has(mime)) {
          return webchatError(415, "mime_not_allowed", "Tipo de arquivo não permitido.");
        }

        const safeName = sanitizeFilename(file.name);
        const ext = extFromName(safeName);
        const objectPath = `webchat/${widgetId}/${session.id}/${crypto.randomUUID()}.${ext}`;

        const bytes = new Uint8Array(await file.arrayBuffer());
        const { error: upErr } = await supabaseAdmin.storage
          .from("message-media")
          .upload(objectPath, bytes, { contentType: mime, upsert: false });
        if (upErr) {
          console.error("[webchat] upload storage error:", upErr);
          return webchatError(500, "upload_failed", upErr.message);
        }

        // Signed URL — 7 days (same TTL used by the inbox upload flow).
        const { data: signed, error: signErr } = await supabaseAdmin.storage
          .from("message-media")
          .createSignedUrl(objectPath, 60 * 60 * 24 * 7);
        if (signErr || !signed?.signedUrl) {
          console.error("[webchat] sign url error:", signErr);
          return webchatError(500, "sign_failed", signErr?.message);
        }

        const type: "image" | "document" = mime.startsWith("image/") ? "image" : "document";

        const { data: msg, error: msgErr } = await supabaseAdmin
          .from("messages")
          .insert({
            conversation_id: session.conversation_id,
            brand_id: session.brand_id,
            channel_id: session.channel_id,
            direction: "inbound",
            type,
            content: safeName,
            media_url: signed.signedUrl,
            media_mime: mime,
            media_filename: safeName,
            media_size_bytes: file.size,
            status: "delivered",
          })
          .select("id, created_at")
          .single();

        if (msgErr || !msg) {
          console.error("[webchat] insert message error:", msgErr);
          // Best-effort cleanup of the orphan storage object
          try {
            await supabaseAdmin.storage.from("message-media").remove([objectPath]);
          } catch {
            /* noop */
          }
          return webchatError(500, "insert_failed", msgErr?.message);
        }

        // Reopen if resolvido — visitor sending a new attachment means they want a reply.
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

        await supabaseAdmin
          .from("webchat_sessions")
          .update({ last_seen_at: new Date().toISOString() })
          .eq("id", session.id);

        // Trigger AI agent (same pattern as text messages).
        try {
          const { runAgentForConversation } = await import("@/lib/ai-agents-engine.server");
          await runAgentForConversation(session.conversation_id as string);
        } catch (e) {
          console.error("[webchat] agent run failed:", (e as Error).message);
        }

        return webchatJson({
          ok: true,
          id: msg.id,
          created_at: msg.created_at,
          type,
          media_url: signed.signedUrl,
          media_mime: mime,
          media_filename: safeName,
        });
      },
    },
  },
});
