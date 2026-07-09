// Loga envios outbound de WhatsApp em api_request_logs
// para que apareçam misturados com webhooks/REST na página /admin/api-logs.
import { getAdminClient } from "./supabase.ts";

export interface WaLogInput {
  brandId: string;
  source: string; // "automation" | "inbox" | "api" | etc.
  type: "text" | "template" | "image" | "audio" | "video" | "document";
  to: string;
  templateName?: string | null;
  templateLanguage?: string | null;
  variables?: unknown[] | null;
  content?: string | null;
  mediaUrl?: string | null;
  status: "sent" | "failed";
  waMessageId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  messageId?: string | null;
  durationMs?: number;
  statusCode?: number;
  // Which identifier was used to address the recipient on the Meta API:
  // - 'to'        → legacy phone-number addressing (wa_id digits)
  // - 'recipient' → new BSUID addressing (Business-Scoped User ID)
  // Always 'to' today; this field exists so we can measure the BSUID rollout.
  identifierUsed?: "to" | "recipient";
}

export async function logWhatsAppSend(input: WaLogInput): Promise<void> {
  // Reduz ruído: só registra falhas. Sends bem-sucedidos ficam em `messages`.
  if (input.status === "sent") return;
  try {
    const admin = getAdminClient();
    const path = `/whatsapp/send/${input.type}`;
    const status_code =
      input.statusCode ??
      (input.status === "sent" ? 200 : input.errorCode === "INTERNAL" ? 500 : 400);
    await admin.from("api_request_logs" as any).insert({
      brand_id: input.brandId,
      api_key_prefix: input.source,
      method: "POST",
      path,
      status_code,
      duration_ms: input.durationMs ?? null,
      request_body: {
        to: input.to,
        type: input.type,
        template_name: input.templateName ?? null,
        template_language: input.templateLanguage ?? null,
        variables: input.variables ?? null,
        content: input.content ?? null,
        media_url: input.mediaUrl ?? null,
        source: input.source,
        identifier_used: input.identifierUsed ?? "to",
      },
      response_summary: {
        wa_message_id: input.waMessageId ?? null,
        error_code: input.errorCode ?? null,
        error_message: input.errorMessage ?? null,
        message_id: input.messageId ?? null,
      },
    } as any);

  } catch (e) {
    console.error("[wa-log] failed:", e);
  }
}

// ---------------- Inbound (webhooks recebidos da Meta) ----------------

export interface WaInboundLogInput {
  brandId: string;
  channelId: string;
  method: "GET" | "POST";
  statusCode: number;
  durationMs: number;
  payload: unknown;
  summary: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

function truncatePayload(payload: unknown, maxBytes = 8000): unknown {
  try {
    const json = JSON.stringify(payload);
    if (!json || json.length <= maxBytes) return payload;
    return { _truncated: true, _original_bytes: json.length, preview: json.slice(0, maxBytes) };
  } catch {
    return { _truncated: true, _error: "serialize_failed" };
  }
}

export async function logWhatsAppInbound(input: WaInboundLogInput): Promise<void> {
  // Reduz ruído: callbacks só de statuses (delivered/read/sent) são altíssimo volume
  // e o histórico real já vai para `messages`. Mantém mensagens reais, verify, e erros.
  if (input.statusCode < 400 && input.method === "POST") {
    const s = input.summary ?? {};
    const hasMessages = Number((s as any).messages_received ?? 0) > 0;
    const hasStatuses = Number((s as any).statuses_received ?? 0) > 0;
    const hasError = (s as any).error != null;
    if (!hasMessages && !hasError && hasStatuses) return;
  }
  try {
    const admin = getAdminClient();
    const path = input.method === "GET" ? "/whatsapp/webhook/meta/verify" : "/whatsapp/webhook/meta";
    await admin.from("api_request_logs" as any).insert({
      brand_id: input.brandId,
      api_key_prefix: "meta-webhook",
      method: input.method,
      path,
      status_code: input.statusCode,
      duration_ms: input.durationMs,
      ip: input.ip ?? null,
      user_agent: input.userAgent ?? null,
      request_body: truncatePayload(input.payload),
      response_summary: { channel_id: input.channelId, ...input.summary },
    } as any);
  } catch (e) {
    console.error("[wa-log inbound] failed:", e);
  }
}
