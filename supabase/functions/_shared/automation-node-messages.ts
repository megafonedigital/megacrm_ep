// Helper para gravar/atualizar eventos de mensagens disparadas por nós de
// automação (métricas por nó: enviado/entregue/lido/falhou/clique/resposta).
// Best-effort: nunca lança — falhas só são logadas no console.
import { getAdminClient } from "./supabase.ts";

export interface LogNodeMessageInput {
  brandId: string;
  automationId?: string | null;
  runId?: string | null;
  nodeId: string;
  nodeType: string;
  contactId?: string | null;
  conversationId?: string | null;
  channelId?: string | null;
  waMessageId?: string | null;
  templateName?: string | null;
  ok: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
}

/**
 * Registra uma linha em `automation_node_messages` para cada envio do engine.
 * Quando `ok=false`, marca `failed_at = now()` direto.
 * Sem `automationId` (ex.: envios fora de fluxo) → ignora silenciosamente.
 */
export async function logNodeMessage(input: LogNodeMessageInput): Promise<{ ok: boolean; error?: string }> {
  if (!input.automationId || !input.brandId || !input.nodeId) return { ok: false, error: "missing_required_input" };
  try {
    const admin = getAdminClient();
    const now = new Date().toISOString();
    const { error } = await admin.from("automation_node_messages" as any).insert({
      brand_id: input.brandId,
      automation_id: input.automationId,
      run_id: input.runId ?? null,
      node_id: input.nodeId,
      node_type: input.nodeType,
      contact_id: input.contactId ?? null,
      conversation_id: input.conversationId ?? null,
      channel_id: input.channelId ?? null,
      wa_message_id: input.waMessageId ?? null,
      template_name: input.templateName ?? null,
      sent_at: now,
      failed_at: input.ok ? null : now,
      error_code: input.ok ? null : (input.errorCode ?? null),
      error_message: input.ok ? null : (input.errorMessage ?? null),
    } as any);
    if (error) {
      console.error("[automation-node-messages] insert failed:", error.message ?? String(error));
      return { ok: false, error: error.message ?? String(error) };
    }
    return { ok: true };
  } catch (e) {
    console.error("[automation-node-messages] insert failed:", (e as Error).message);
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Atualiza o status de uma mensagem pelo `wa_message_id` quando chega
 * um webhook de status da Meta (sent / delivered / read / failed).
 */
export async function markNodeMessageStatus(
  waMessageId: string,
  status: "sent" | "delivered" | "read" | "failed",
  errorCode?: string | null,
  errorMessage?: string | null,
): Promise<void> {
  if (!waMessageId) return;
  try {
    const admin = getAdminClient();
    const patch: Record<string, unknown> = {};
    const now = new Date().toISOString();
    if (status === "delivered") patch.delivered_at = now;
    else if (status === "read") patch.read_at = now;
    else if (status === "failed") {
      patch.failed_at = now;
      if (errorCode) patch.error_code = errorCode;
      if (errorMessage) patch.error_message = errorMessage;
    }
    if (Object.keys(patch).length === 0) return;
    await admin
      .from("automation_node_messages" as any)
      .update(patch as any)
      .eq("wa_message_id", waMessageId);
  } catch (e) {
    console.error("[automation-node-messages] status update failed:", (e as Error).message);
  }
}

/**
 * Quando chega uma mensagem inbound do contato, marca como `replied_at`
 * a última mensagem de automação enviada para essa conversa nas últimas
 * 24h que ainda não tinha resposta. Se a inbound for clique de botão,
 * grava também `button_clicked_at` + `button_payload`.
 */
export async function markNodeMessageReply(
  conversationId: string,
  buttonPayload?: { text?: string | null; payload?: string | null } | null,
): Promise<void> {
  if (!conversationId) return;
  try {
    const admin = getAdminClient();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data } = await admin
      .from("automation_node_messages" as any)
      .select("id")
      .eq("conversation_id", conversationId)
      .is("replied_at", null)
      .gte("sent_at", since)
      .order("sent_at", { ascending: false })
      .limit(1);
    const row = (data as any[])?.[0];
    if (!row) return;
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { replied_at: now };
    if (buttonPayload) {
      patch.button_clicked_at = now;
      patch.button_payload = buttonPayload;
    }
    await admin
      .from("automation_node_messages" as any)
      .update(patch as any)
      .eq("id", row.id);
  } catch (e) {
    console.error("[automation-node-messages] reply update failed:", (e as Error).message);
  }
}
