// send-message: envia texto / mídia / template via Graph API
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient, requireUser } from "../_shared/supabase.ts";
import { getChannelToken } from "../_shared/vault.ts";
import { sendText, sendMedia, sendTemplate } from "../_shared/meta.ts";
import { logError, translateMetaError } from "../_shared/errors.ts";
import { logWhatsAppSend } from "../_shared/wa-log.ts";

interface Body {
  conversation_id: string;
  type: "text" | "image" | "audio" | "video" | "document" | "template";
  text?: string;
  media_url?: string;
  media_mime?: string;
  media_filename?: string;
  caption?: string;
  template_id?: string;
  template_name?: string;
  template_language?: string;
  template_variables?: string[];
  template_header_type?: "IMAGE" | "VIDEO" | "DOCUMENT" | "TEXT" | null;
  template_header_media_url?: string | null;
  template_header_media_filename?: string | null;
  template_header_text?: string | null;
}

Deno.serve(async (req) => {
  const pf = handlePreflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  let user;
  try {
    ({ user } = await requireUser(req));
  } catch (e) {
    if (e instanceof Response) return e;
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "JSON inválido" }, 400);
  }

  const admin = getAdminClient();

  const { data: conv, error: convErr } = await admin
    .from("conversations")
    .select("id, brand_id, channel_id, window_expires_at, channel:channel_id(phone_number_id, type), contacts:contact_id(wa_id, phone, bsuid, metadata)")
    .eq("id", body.conversation_id)
    .single();
  if (convErr || !conv) return jsonResponse({ error: "Conversa não encontrada." }, 404);

  const channelId = (conv as any).channel_id as string | null;
  const channelType = (conv as any).channel?.type as string | undefined;
  const isWebchat = channelType === "webchat";
  const phoneNumberId = (conv as any).channel?.phone_number_id;

  // BSUID (Onda 2): quando o workspace está em modo `on` e o contato tem BSUID,
  // usamos o BSUID como destinatário. Caso contrário, mantém wa_id/telefone.
  let bsuidMode: "off" | "shadow" | "on" = "off";
  try {
    const { data: brandCfg } = await admin
      .from("brands").select("bsuid_mode").eq("id", conv.brand_id).maybeSingle();
    const m = (brandCfg as any)?.bsuid_mode;
    if (m === "shadow" || m === "on") bsuidMode = m;
  } catch (_e) { /* default off */ }
  const contactBsuid = (conv as any).contacts?.bsuid ?? null;
  const useBsuid = bsuidMode === "on" && !!contactBsuid;
  const to = useBsuid ? contactBsuid : (conv as any).contacts?.wa_id;
  if (!channelId) {
    return jsonResponse({ error: "Conversa sem canal." }, 400);
  }
  if (!isWebchat && (!phoneNumberId || !to)) {
    return jsonResponse({ error: "Canal sem phone_number_id ou contato sem WhatsApp." }, 400);
  }
  if (useBsuid) {
    console.info("[send-message] using BSUID recipient", { brand: conv.brand_id, bsuid: to });
  }

  // Blocklist: bloqueia envio outbound se contato estiver no blocklist
  {
    const phoneCandidate = (conv as any).contacts?.phone ?? (conv as any).contacts?.wa_id ?? null;
    const emailCandidate = ((conv as any).contacts?.metadata?.email ?? null) || null;
    const { data: blocked } = await admin.rpc("is_blocked", {
      _brand: conv.brand_id,
      _phone: phoneCandidate,
      _email: emailCandidate,
    });
    if (blocked === true) {
      return jsonResponse(
        { error: "BLOCKLISTED", error_pt: "Contato está no blocklist deste workspace." },
        409
      );
    }
  }

  const windowOpen =
    isWebchat ||
    (conv.window_expires_at && new Date(conv.window_expires_at).getTime() > Date.now());

  if (!windowOpen && body.type !== "template") {
    return jsonResponse(
      { error: "WINDOW_EXPIRED", error_pt: "Janela de 24h expirou. Envie um template aprovado." },
      409
    );
  }

  // ---- WEBCHAT FAST PATH ----------------------------------------------------
  // Webchat conversations do not go through the Meta API: the visitor's browser
  // polls /api/public/webchat/.../messages for new outbound messages. We just
  // persist the message as 'sent' and reopen the conversation.
  if (isWebchat) {
    if (body.type !== "text") {
      return jsonResponse({ error: "Webchat suporta apenas mensagens de texto nesta versão." }, 400);
    }
    if (!body.text?.trim()) return jsonResponse({ error: "Texto vazio." }, 400);

    const { data: wmsg, error: wErr } = await admin
      .from("messages")
      .insert({
        conversation_id: conv.id,
        brand_id: conv.brand_id,
        channel_id: channelId,
        direction: "outbound",
        type: "text" as never,
        content: body.text,
        sent_by: user.id,
        status: "sent",
      })
      .select("id")
      .single();
    if (wErr || !wmsg) return jsonResponse({ error: "Falha ao registrar mensagem." }, 500);

    await admin.rpc("reopen_conversation_on_outbound", {
      _conv_id: conv.id,
      _actor_id: user.id,
      _by: "agent_message",
    });

    return jsonResponse({ ok: true, message_id: wmsg.id });
  }
  // ---------------------------------------------------------------------------

  let token: string;
  try {
    token = await getChannelToken(channelId);
  } catch (e) {
    await logError({
      severity: "critical",
      category: "auth",
      code: "CHANNEL_TOKEN_MISSING",
      messagePt: "Token do canal não está configurado.",
      technicalMessage: String((e as Error).message ?? e),
      brandId: conv.brand_id,
      conversationId: conv.id,
      userId: user.id,
    });
    return jsonResponse({ error: "Token do canal ausente." }, 400);
  }

  const { data: msg, error: msgErr } = await admin
    .from("messages")
    .insert({
      conversation_id: conv.id,
      brand_id: conv.brand_id,
      channel_id: channelId,
      direction: "outbound",
      type: body.type as never,
      content: body.text ?? body.caption ?? null,
      media_url: body.media_url ?? null,
      media_mime: body.media_mime ?? null,
      media_filename: body.media_filename ?? null,
      template_name: body.template_name ?? null,
      template_language: body.template_language ?? null,
      template_variables: body.template_variables ?? null,
      sent_by: user.id,
      status: "queued",
    })
    .select("id")
    .single();
  if (msgErr || !msg) return jsonResponse({ error: "Falha ao registrar mensagem." }, 500);

  let result;
  const sendStartedAt = Date.now();
  let resolvedTplName: string | null = body.template_name ?? null;
  let resolvedTplLang: string | null = body.template_language ?? null;
  try {
    if (body.type === "text") {
      if (!body.text?.trim()) throw new Error("Texto vazio.");
      result = await sendText({ token, phoneNumberId, to, body: body.text });
    } else if (body.type === "template") {
      // Resolve dados do template via DB se template_id veio do client
      let tplName = body.template_name;
      let tplLang = body.template_language;
      let headerType = body.template_header_type ?? null;
      let headerMediaLink = body.template_header_media_url ?? null;
      let headerMediaFilename = body.template_header_media_filename ?? null;
      const headerTextVar = body.template_header_text ?? null;

      if (body.template_id) {
        const { data: tpl } = await admin
          .from("whatsapp_templates")
          .select("name, language, header_type, header_media_url, header_media_filename")
          .eq("id", body.template_id)
          .single();
        if (tpl) {
          tplName = tplName ?? tpl.name;
          tplLang = tplLang ?? tpl.language;
          // Auto-injetar header de mídia se o template tiver um (e o client não passou explicitamente)
          if (!headerType && tpl.header_type && tpl.header_type !== "TEXT" && tpl.header_media_url) {
            headerType = tpl.header_type as "IMAGE" | "VIDEO" | "DOCUMENT";
            headerMediaLink = tpl.header_media_url;
            headerMediaFilename = tpl.header_media_filename ?? null;
          }
        }
      }

      if (!tplName || !tplLang) throw new Error("Template incompleto.");
      resolvedTplName = tplName;
      resolvedTplLang = tplLang;
      result = await sendTemplate({
        token, phoneNumberId, to,
        templateName: tplName,
        language: tplLang,
        variables: body.template_variables,
        headerType,
        headerMediaLink,
        headerMediaFilename,
        headerTextVar,
      });
    } else {
      if (!body.media_url) throw new Error("URL da mídia ausente.");
      result = await sendMedia({
        token, phoneNumberId, to,
        type: body.type,
        link: body.media_url,
        caption: body.caption,
        filename: body.media_filename,
      });
    }
  } catch (e) {
    const technical = String((e as Error).message ?? e);
    await admin.from("messages")
      .update({ status: "failed", error_code: "INTERNAL", error_message: technical })
      .eq("id", msg.id);
    await logError({
      severity: "error", category: "internal", code: "SEND_FAILED",
      messagePt: "Falha interna ao tentar enviar a mensagem.",
      technicalMessage: technical,
      brandId: conv.brand_id, conversationId: conv.id, messageId: msg.id, userId: user.id,
    });
    await logWhatsAppSend({
      brandId: conv.brand_id, source: "inbox", type: body.type, to, identifierUsed: useBsuid ? "recipient" : "to",
      templateName: resolvedTplName, templateLanguage: resolvedTplLang,
      variables: body.template_variables ?? null,
      content: body.text ?? body.caption ?? null,
      mediaUrl: body.media_url ?? null,
      status: "failed", errorCode: "INTERNAL", errorMessage: technical,
      messageId: msg.id, durationMs: Date.now() - sendStartedAt, statusCode: 500,
    });
    return jsonResponse({ error: "Falha ao enviar mensagem.", message_id: msg.id }, 500);
  }

  if (!result.ok) {
    const code = String(result.error?.code ?? "META_ERR");
    const messagePt = translateMetaError(code, result.error?.message);
    await admin.from("messages")
      .update({ status: "failed", error_code: code, error_message: messagePt })
      .eq("id", msg.id);
    await logError({
      severity: code === "190" || code === "200" ? "critical" : "error",
      category: "meta_api", code, messagePt,
      technicalMessage: result.error?.message ?? "",
      brandId: conv.brand_id, conversationId: conv.id, messageId: msg.id, userId: user.id,
      payload: result.error,
    });
    await logWhatsAppSend({
      brandId: conv.brand_id, source: "inbox", type: body.type, to, identifierUsed: useBsuid ? "recipient" : "to",
      templateName: resolvedTplName, templateLanguage: resolvedTplLang,
      variables: body.template_variables ?? null,
      content: body.text ?? body.caption ?? null,
      mediaUrl: body.media_url ?? null,
      status: "failed", errorCode: code, errorMessage: messagePt,
      messageId: msg.id, durationMs: Date.now() - sendStartedAt, statusCode: 400,
    });
    return jsonResponse({ error: messagePt, code, message_id: msg.id }, 400);
  }

  const waId = result.data?.messages?.[0]?.id ?? null;
  await admin.from("messages").update({ status: "sent", wa_message_id: waId }).eq("id", msg.id);
  await admin.rpc("reopen_conversation_on_outbound", {
    _conv_id: conv.id,
    _actor_id: user.id,
    _by: "agent_message",
  });

  await logWhatsAppSend({
    brandId: conv.brand_id, source: "inbox", type: body.type, to, identifierUsed: useBsuid ? "recipient" : "to",
    templateName: resolvedTplName, templateLanguage: resolvedTplLang,
    variables: body.template_variables ?? null,
    content: body.text ?? body.caption ?? null,
    mediaUrl: body.media_url ?? null,
    status: "sent", waMessageId: waId,
    messageId: msg.id, durationMs: Date.now() - sendStartedAt,
  });

  return jsonResponse({ ok: true, message_id: msg.id, wa_message_id: waId });
});
