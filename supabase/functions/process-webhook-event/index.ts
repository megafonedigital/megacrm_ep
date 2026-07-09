// process-webhook-event: processa registros de webhook_events_raw
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient } from "../_shared/supabase.ts";
import { downloadMedia } from "../_shared/meta.ts";
import { getChannelToken } from "../_shared/vault.ts";
import { logError, translateMetaError } from "../_shared/errors.ts";
import { logWhatsAppSend } from "../_shared/wa-log.ts";
import { markNodeMessageStatus, markNodeMessageReply } from "../_shared/automation-node-messages.ts";

const TWENTYFOUR_HOURS_MS = 24 * 60 * 60 * 1000;

async function transcribeAudio(args: { bytes: Uint8Array; mime: string }): Promise<{
  text?: string;
  model?: string;
  ms?: number;
  error?: string;
  status?: number;
  message?: string;
}> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");
  const model = "openai/gpt-4o-mini-transcribe";
  const mime = (args.mime || "audio/ogg").split(";")[0];
  const extMap: Record<string, string> = {
    "audio/ogg": "ogg",
    "audio/oga": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/mp4": "mp4",
    "audio/m4a": "m4a",
    "audio/x-m4a": "m4a",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/webm": "webm",
    "audio/aac": "aac",
    "audio/flac": "flac",
  };
  const ext = extMap[mime] ?? "ogg";
  const blob = new Blob([args.bytes], { type: mime });
  const form = new FormData();
  form.append("model", model);
  form.append("file", blob, `recording.${ext}`);
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return { error: "stt_failed", status: res.status, message: txt.slice(0, 300) };
    }
    const body = (await res.json()) as { text?: string };
    return { text: body.text ?? "", model, ms: Date.now() - startedAt };
  } finally {
    clearTimeout(timeoutId);
  }
}

interface RawEvent {
  id: string;
  brand_id: string | null;
  payload: any;
  attempts: number;
}

async function processOne(ev: RawEvent) {
  const admin = getAdminClient();
  try {
    const entry = ev.payload?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value ?? {};

    // Identifica canal e marca pelo phone_number_id
    const phoneNumberId = value?.metadata?.phone_number_id;
    let brandId = ev.brand_id;
    let channelId: string | null = null;
    if (phoneNumberId) {
      const { data } = await admin
        .from("brand_channels")
        .select("id, brand_id")
        .eq("phone_number_id", phoneNumberId)
        .maybeSingle();
      if (data) {
        channelId = (data as any).id;
        brandId = (data as any).brand_id;
      }
    }
    if (!brandId || !channelId) throw new Error("Canal não identificado (phone_number_id não vinculado).");

    // STATUSES
    if (value.statuses?.length) {
      for (const s of value.statuses) {
        const update: Record<string, unknown> = { status: s.status };
        if (s.errors?.length) {
          const code = String(s.errors[0].code ?? "META_ERR");
          const rawMetaMsg = s.errors[0].message ?? s.errors[0].title ?? "";
          const messagePt = translateMetaError(code, rawMetaMsg || "Falha ao se comunicar com a Meta.");
          update.status = "failed";
          update.error_code = code;
          update.error_message = messagePt;
          await logError({
            severity: code === "190" || code === "200" ? "critical" : "error",
            category: "meta_api",
            code,
            messagePt,
            technicalMessage: JSON.stringify(s.errors[0]),
            brandId,
            payload: s,
          });
          // Também registra em api_request_logs (aba WhatsApp dos Logs de API)
          // para que a falha assíncrona apareça ao lado do envio original.
          try {
            const { data: origMsg } = await admin
              .from("messages")
              .select("id, conversation_id, type, template_name, template_language, template_variables, content, media_url, sent_by")
              .eq("wa_message_id", s.id)
              .maybeSingle();
            if (origMsg) {
              await logWhatsAppSend({
                brandId,
                source: "meta-callback",
                type: (origMsg as any).type ?? "text",
                to: s.recipient_id ?? "",
                templateName: (origMsg as any).template_name ?? null,
                templateLanguage: (origMsg as any).template_language ?? null,
                variables: (origMsg as any).template_variables ?? null,
                content: (origMsg as any).content ?? null,
                mediaUrl: (origMsg as any).media_url ?? null,
                status: "failed",
                errorCode: code,
                errorMessage: messagePt,
                messageId: (origMsg as any).id,
                waMessageId: s.id,
                statusCode: 400,
              });
            }
          } catch (logErr) {
            console.error("[process-webhook-event] failed to log async failure to api_request_logs:", logErr);
          }
        }
        await admin.from("messages").update(update).eq("wa_message_id", s.id);
        // Atualiza métricas por nó da automação (best-effort, fora do caminho crítico).
        const metricStatus = (s.status === "delivered" || s.status === "read" || s.status === "sent" || s.status === "failed")
          ? s.status as "delivered" | "read" | "sent" | "failed"
          : "sent";
        const metricErrCode = s.errors?.length ? String(s.errors[0].code ?? "META_ERR") : null;
        const metricErrMsg = s.errors?.length ? (s.errors[0].message ?? s.errors[0].title ?? null) : null;
        // @ts-ignore EdgeRuntime existe no Supabase Edge Functions
        if (typeof EdgeRuntime !== "undefined" && (EdgeRuntime as any).waitUntil) {
          // @ts-ignore
          (EdgeRuntime as any).waitUntil(markNodeMessageStatus(s.id, metricStatus, metricErrCode, metricErrMsg));
        } else {
          void markNodeMessageStatus(s.id, metricStatus, metricErrCode, metricErrMsg);
        }
      }
    }

    if (value.messages?.length) {
      const contactRaw = value.contacts?.[0];
      // Onda 1: lê a feature flag de BSUID por workspace.
      // off = ignora bsuid/username; shadow = grava em colunas separadas; on = também usa para envio (Onda 2).
      let brandBsuidMode: "off" | "shadow" | "on" = "off";
      try {
        const { data: brandCfg } = await admin
          .from("brands")
          .select("bsuid_mode")
          .eq("id", brandId)
          .maybeSingle();
        const mode = (brandCfg as any)?.bsuid_mode;
        if (mode === "shadow" || mode === "on") brandBsuidMode = mode;
      } catch (_e) { /* ignora — default off */ }
      const captureBsuid = brandBsuidMode !== "off";

      for (const m of value.messages) {
        const waId = m.from;
        // Detect opaque identifiers (e.g. Meta BSUID "BR.abc123") so we never
        // try to normalize them as phone numbers or store them in `phone`.
        const waIdStr = typeof waId === "string" ? waId.trim() : "";
        const isOpaqueId = /^[A-Z]{2}\.[A-Za-z0-9_-]+$/.test(waIdStr);
        const isPhoneLike = /^\d{8,15}$/.test(waIdStr);
        // Username opcional vindo do payload (Meta 2026). Capturado só em modo shadow/on.
        const usernameFromPayload = captureBsuid
          ? ((contactRaw as any)?.username ?? (contactRaw as any)?.profile?.username ?? null)
          : null;
        // BR mobile: Meta às vezes manda o número sem o "9" extra de celular.
        // Procura contato existente por qualquer variante (com/sem 9) antes de criar.
        const variants: string[] = waIdStr ? [waIdStr] : [];
        if (isPhoneLike && waIdStr.startsWith("55")) {
          const rest = waIdStr.slice(2);
          if (rest.length === 11 && rest[2] === "9") {
            variants.push("55" + rest.slice(0, 2) + rest.slice(3));
          } else if (rest.length === 10) {
            variants.push("55" + rest.slice(0, 2) + "9" + rest.slice(2));
          }
        }
        let contact: { id: string } | null = null;
        // Lookup primário por wa_id (com variantes). Mantém comportamento atual.
        const { data: existing } = variants.length
          ? await admin
              .from("contacts")
              .select("id")
              .eq("brand_id", brandId)
              .in("wa_id", variants)
              .limit(1)
              .maybeSingle()
          : { data: null };
        // Fallback Onda 1: se nada por wa_id e for BSUID, tenta lookup por coluna `bsuid`.
        let existingByBsuid: { id: string } | null = null;
        if (!existing && isOpaqueId && captureBsuid) {
          const { data: byBsuid } = await admin
            .from("contacts")
            .select("id")
            .eq("brand_id", brandId)
            .eq("bsuid", waIdStr)
            .limit(1)
            .maybeSingle();
          existingByBsuid = (byBsuid as { id: string } | null) ?? null;
        }
        const match = existing ?? existingByBsuid;
        if (match) {
          contact = match as { id: string };
          // Atualiza profile_name se vier
          const patch: Record<string, unknown> = {};
          if (contactRaw?.profile?.name) patch.profile_name = contactRaw.profile.name;
          // Onda 1: preenche bsuid/username quando faltar e a flag permitir
          if (captureBsuid && isOpaqueId) patch.bsuid = waIdStr;
          if (captureBsuid && usernameFromPayload) patch.username = String(usernameFromPayload);
          if (Object.keys(patch).length > 0) {
            await admin.from("contacts").update(patch).eq("id", match.id);
          }
        } else {
          // Defensivo: só grava em `phone` se for realmente formato de telefone.
          // Se a Meta passar um BSUID (ou qualquer identificador não-numérico),
          // mantém `phone = NULL` para não corromper a coluna.
          const phoneToStore = isPhoneLike ? waIdStr : null;
          if (!waIdStr) {
            // Sem identificador algum no payload — pula para evitar criar contato fantasma.
            continue;
          }
          const insertPayload: Record<string, unknown> = {
            brand_id: brandId,
            wa_id: waIdStr,
            phone: phoneToStore,
            profile_name: contactRaw?.profile?.name ?? null,
          };
          if (captureBsuid && isOpaqueId) insertPayload.bsuid = waIdStr;
          if (captureBsuid && usernameFromPayload) insertPayload.username = String(usernameFromPayload);
          const { data: inserted } = await admin
            .from("contacts")
            .insert(insertPayload)
            .select("id")
            .single();
          contact = inserted as { id: string } | null;
          if (isOpaqueId) {
            console.warn("[process-webhook-event] created contact with opaque wa_id (BSUID-like):", waIdStr, "mode=", brandBsuidMode);
          }
        }

        if (!contact) continue;

        // Busca config do canal
        const { data: channelData } = await admin
          .from("brand_channels")
          .select("round_robin_enabled")
          .eq("id", channelId)
          .maybeSingle();
        const roundRobinEnabled = (channelData as any)?.round_robin_enabled ?? false;

        // Procura conversa do mesmo contato NESTE canal
        let { data: conv } = await admin
          .from("conversations")
          .select("id, assigned_to, ai_agent_id")
          .eq("brand_id", brandId)
          .eq("contact_id", contact.id)
          .eq("channel_id", channelId)
          .order("last_message_at", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle();

        const now = new Date();
        const windowExpires = new Date(now.getTime() + TWENTYFOUR_HOURS_MS).toISOString();

        let aiAgentId: string | null = null;
        if (!conv) {
          let assignedTo: string | null = null;
          if (roundRobinEnabled) {
            // Sorteio ponderado entre humanos e agentes de IA
            const { data: pickRows } = await admin.rpc("pick_next_assignee", {
              _channel_id: channelId,
            });
            const picked = Array.isArray(pickRows) ? pickRows[0] : pickRows;
            if (picked?.kind === "human") {
              assignedTo = (picked.id as string | null) ?? null;
            } else if (picked?.kind === "ai") {
              aiAgentId = (picked.id as string | null) ?? null;
            }
          }
          const { data: created } = await admin
            .from("conversations")
            .insert({
              brand_id: brandId,
              channel_id: channelId,
              contact_id: contact.id,
              assigned_to: assignedTo,
              ai_agent_id: aiAgentId,
              status: "aberto",
              last_message_at: now.toISOString(),
              last_inbound_at: now.toISOString(),
              window_expires_at: windowExpires,
              unread_count: 1,
            })
            .select("id, assigned_to, ai_agent_id")
            .single();
          conv = created!;
          if (assignedTo) {
            await admin.from("conversation_events").insert({
              conversation_id: conv.id,
              event_type: "assigned",
              payload: { assigned_to: assignedTo, by: "round_robin" },
            });
          }
          if (aiAgentId) {
            await admin.from("conversation_events").insert({
              conversation_id: conv.id,
              event_type: "ai_assigned",
              payload: { ai_agent_id: aiAgentId, by: "round_robin" },
            });
          }
        } else {
          aiAgentId = (conv as any).ai_agent_id ?? null;
          const existingAssigned = (conv as any).assigned_to ?? null;

          // Reabertura órfã: conversa sem dono humano nem IA e canal com RR.
          // Aciona round-robin no momento da resposta para não deixar o
          // inbound cair na fila de "não atribuídas".
          if (!existingAssigned && !aiAgentId && roundRobinEnabled) {
            try {
              const { data: pickRows } = await admin.rpc("pick_next_assignee", {
                _channel_id: channelId,
              });
              const picked = Array.isArray(pickRows) ? pickRows[0] : pickRows;
              if (picked?.kind === "human" && picked?.id) {
                const { data: upd, error: updErr } = await admin
                  .from("conversations")
                  .update({ assigned_to: picked.id as string })
                  .eq("id", conv.id)
                  .is("assigned_to", null)
                  .is("ai_agent_id", null)
                  .select("id")
                  .maybeSingle();
                if (updErr) {
                  console.warn("[process-webhook-event] rr_on_reopen update failed:", updErr.message);
                } else if (upd) {
                  await admin.from("conversation_events").insert({
                    conversation_id: conv.id,
                    event_type: "assigned",
                    payload: { assigned_to: picked.id, by: "round_robin_on_reopen" },
                  });
                }
              } else if (picked?.kind === "ai" && picked?.id) {
                const { data: upd, error: updErr } = await admin
                  .from("conversations")
                  .update({ ai_agent_id: picked.id as string })
                  .eq("id", conv.id)
                  .is("assigned_to", null)
                  .is("ai_agent_id", null)
                  .select("id")
                  .maybeSingle();
                if (updErr) {
                  console.warn("[process-webhook-event] rr_on_reopen ai update failed:", updErr.message);
                } else if (upd) {
                  aiAgentId = picked.id as string;
                  await admin.from("conversation_events").insert({
                    conversation_id: conv.id,
                    event_type: "ai_assigned",
                    payload: { ai_agent_id: picked.id, by: "round_robin_on_reopen" },
                  });
                }
              }
            } catch (e) {
              console.warn("[process-webhook-event] rr_on_reopen threw:", (e as Error).message);
            }
          }

          await admin.rpc("increment_conversation_unread", {
            _conv_id: conv.id,
            _window_expires_at: windowExpires,
          });
        }

        // Mídia
        let mediaUrl: string | null = null;
        let mediaMime: string | null = null;
        let mediaFilename: string | null = null;
        const mediaPayload = m.image || m.audio || m.video || m.document || m.sticker;
        const messageType: string = m.type;
        const content: string | null = m.text?.body ?? mediaPayload?.caption ?? null;

        if (mediaPayload?.id) {
          try {
            const token = await getChannelToken(channelId);
            const dl = await downloadMedia({ token, mediaId: mediaPayload.id });
            if (dl.ok) {
              mediaMime = dl.mime;
              const ext = (mediaPayload?.filename?.split(".").pop() ?? dl.mime.split("/")[1] ?? "bin").slice(0, 8);
              const path = `${brandId}/${conv.id}/${crypto.randomUUID()}.${ext}`;
              const { error: upErr } = await admin.storage
                .from("message-media")
                .upload(path, dl.bytes, { contentType: dl.mime, upsert: false });
              if (upErr) throw upErr;
              const { data: signed } = await admin.storage
                .from("message-media")
                .createSignedUrl(path, 60 * 60 * 24 * 7);
              mediaUrl = signed?.signedUrl ?? path;
              mediaFilename = mediaPayload.filename ?? null;

              // Transcrição de áudios recebidos (gated por agente).
              if (messageType === "audio" && aiAgentId) {
                try {
                  const { data: agentSttCfg } = await admin
                    .from("ai_agents")
                    .select("transcribe_inbound_audio")
                    .eq("id", aiAgentId)
                    .maybeSingle();
                  if ((agentSttCfg as any)?.transcribe_inbound_audio) {
                    const transcription = await transcribeAudio({ bytes: dl.bytes, mime: dl.mime });
                    (m as any).transcription = transcription;
                  }
                } catch (sttErr) {
                  (m as any).transcription = { error: "stt_failed", message: String((sttErr as Error).message ?? sttErr) };
                  await logError({
                    severity: "warning",
                    category: "ai",
                    code: "STT_FAILED",
                    messagePt: "Não foi possível transcrever o áudio recebido.",
                    technicalMessage: String((sttErr as Error).message ?? sttErr),
                    brandId,
                    conversationId: conv.id,
                  });
                }
              }
            }
          } catch (e) {
            await logError({
              severity: "warning",
              category: "media",
              code: "MEDIA_DOWNLOAD_FAILED",
              messagePt: "Não foi possível baixar a mídia recebida.",
              technicalMessage: String((e as Error).message ?? e),
              brandId,
              conversationId: conv.id,
              payload: mediaPayload,
            });
          }
        }

        // Detect button reply (template button or interactive button) ANTES do insert
        // context_id = wa_message_id da mensagem original que disparou o botão.
        // Permite identificar EXATAMENTE qual run de automação deve retomar.
        let buttonReply: { text?: string | null; payload?: string | null; context_id?: string | null; source?: string } | null = null;
        const contextId: string | null = m?.context?.id ?? null;
        if (m.type === "button" && m.button) {
          buttonReply = { text: m.button.text ?? null, payload: m.button.payload ?? null, context_id: contextId, source: "button" };
        } else if (m.type === "interactive" && m.interactive?.button_reply) {
          buttonReply = { text: m.interactive.button_reply.title ?? null, payload: m.interactive.button_reply.id ?? null, context_id: contextId, source: "interactive_button" };
        } else if (m.type === "interactive" && m.interactive?.list_reply) {
          buttonReply = { text: m.interactive.list_reply.title ?? null, payload: m.interactive.list_reply.id ?? null, context_id: contextId, source: "list_reply" };
        } else if (m.type === "text" && contextId && (content ?? "").trim().length > 0 && (content ?? "").length <= 100) {
          // Fallback: alguns clientes do WhatsApp (iOS especialmente) entregam
          // o clique em botão de QUICK_REPLY como uma mensagem de texto comum
          // que CITA a mensagem original (context.id presente). Tratamos como
          // possível resposta de botão; o automation-engine só vai retomar se
          // o texto bater EXATAMENTE com um label do template citado.
          buttonReply = { text: content, payload: null, context_id: contextId, source: "text_quote" };
        }

        // Se for resposta de botão, já grava o texto em content para exibição no inbox
        const insertContent = content ?? buttonReply?.text ?? null;

        const { error: insertErr } = await admin.from("messages").insert({
          conversation_id: conv.id,
          brand_id: brandId,
          channel_id: channelId,
          direction: "inbound",
          type: messageType as never,
          content: insertContent,
          media_url: mediaUrl,
          media_mime: mediaMime,
          media_filename: mediaFilename,
          wa_message_id: m.id,
          // Persiste o context.id (wa_message_id da msg original que disparou
          // este reply/botão). Permite auditoria e desambiguação de fluxos.
          reply_to_wa_id: contextId,
          status: "delivered",
          raw: m,
        });
        if (insertErr) {
          // Meta re-entrega webhooks (at-least-once). Duplicata de wa_message_id
          // significa que já processamos essa mensagem — silencia e pula para a
          // próxima, evitando reexecutar automações (button click contado 2×).
          if ((insertErr as { code?: string }).code === "23505") {
            console.info("[process-webhook-event] inbound duplicate ignored:", m.id);
            continue;
          }
          console.error("[process-webhook-event] failed to insert inbound message:", insertErr);
          await logError({
            severity: "error",
            category: "webhook",
            code: "INBOUND_INSERT_FAILED",
            messagePt: "Falha ao salvar mensagem recebida no inbox.",
            technicalMessage: `${insertErr.code ?? ""} ${insertErr.message ?? String(insertErr)}`.trim(),
            brandId,
            conversationId: conv.id,
            payload: { wa_message_id: m.id, type: messageType },
          });
        }

        const fnUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/automation-engine`;
        const fireEngine = (payload: any) => fetch(fnUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify(payload),
        }).catch(() => {});

        if (buttonReply) {
          // Clique de botão: SOMENTE button_click. Não disparar `inbound` em paralelo —
          // isso fazia o handler de inbound retomar runs em waiting_button quando o
          // button_click ficava sem context.id (Meta nem sempre envia), cruzando fluxos.
          fireEngine({ event: "button_click", conversation_id: conv.id, button: buttonReply });
        } else {
          fireEngine({ event: "inbound", conversation_id: conv.id, message: { type: messageType, content } });
        }

        // Marca a última mensagem de automação enviada para essa conversa
        // como "respondida" (e clique de botão, se aplicável). Best-effort, em background.
        // @ts-ignore EdgeRuntime existe no Supabase Edge Functions
        if (typeof EdgeRuntime !== "undefined" && (EdgeRuntime as any).waitUntil) {
          // @ts-ignore
          (EdgeRuntime as any).waitUntil(markNodeMessageReply(conv.id, buttonReply));
        } else {
          void markNodeMessageReply(conv.id, buttonReply);
        }



        // Enfileira execução do agente de IA (com debounce/atraso configurado no agente)
        if (aiAgentId) {
          try {
            const { data: agentCfg } = await admin
              .from("ai_agents")
              .select("response_delay_ms, status")
              .eq("id", aiAgentId)
              .maybeSingle();
            if (agentCfg && (agentCfg as any).status !== "off") {
              const delayMs = (agentCfg as any).response_delay_ms ?? 8000;
              const runAfter = new Date(Date.now() + delayMs).toISOString();
              await admin.from("ai_agent_pending_runs").upsert(
                { conversation_id: conv.id, agent_id: aiAgentId, run_after: runAfter },
                { onConflict: "conversation_id" },
              );
            }
          } catch (e) {
            console.error("[webhook] failed to enqueue ai run", (e as Error).message);
          }
        }
      }
    }

    await admin
      .from("webhook_events_raw")
      .update({ processed: true, processed_at: new Date().toISOString(), brand_id: brandId })
      .eq("id", ev.id);
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    await admin
      .from("webhook_events_raw")
      .update({ attempts: ev.attempts + 1, last_error: msg })
      .eq("id", ev.id);
    await logError({
      severity: "error",
      category: "webhook",
      code: "WEBHOOK_PROCESS_FAILED",
      messagePt: "Falha ao processar evento da Meta.",
      technicalMessage: msg,
      brandId: ev.brand_id,
      payload: { event_id: ev.id },
    });
  }
}

Deno.serve(async (req) => {
  const pf = handlePreflight(req);
  if (pf) return pf;

  const admin = getAdminClient();
  let eventIds: string[] = [];

  if (req.method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      if (body?.event_id) eventIds = [body.event_id];
    } catch {}
  }

  let events: RawEvent[] = [];
  if (eventIds.length) {
    const { data } = await admin
      .from("webhook_events_raw")
      .select("id, brand_id, payload, attempts")
      .in("id", eventIds)
      .eq("processed", false);
    events = (data as RawEvent[]) ?? [];
  } else {
    const { data } = await admin
      .from("webhook_events_raw")
      .select("id, brand_id, payload, attempts")
      .eq("processed", false)
      .lt("attempts", 5)
      .order("received_at", { ascending: true })
      .limit(50);
    events = (data as RawEvent[]) ?? [];
  }

  for (const ev of events) await processOne(ev);
  return jsonResponse({ processed: events.length });
});
