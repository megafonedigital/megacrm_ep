import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import {
  resolveBinding,
  type BindingSource,
  type VariableBinding,
} from "@/lib/template-bindings";

const GRAPH = "https://graph.facebook.com/v21.0";

interface ActivityRow {
  id: string;
  pipeline_contact_id: string;
  contact_id: string;
  brand_id: string;
  stage_id: string;
  pipeline_id: string;
  kind: "send_message" | "send_template" | "move_stage";
  mode: "auto" | "manual";
  message_text: string | null;
  template_id: string | null;
  template_variables: string[] | null;
  target_stage_id: string | null;
}

async function sendText(token: string, phoneNumberId: string, to: string, body: string) {
  const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body, preview_url: true },
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

async function sendTemplate(
  token: string,
  phoneNumberId: string,
  to: string,
  templateName: string,
  language: string,
  variables: string[] | null,
) {
  const components: any[] = [];
  if (variables?.length) {
    components.push({
      type: "body",
      parameters: variables.map((v) => ({ type: "text", text: v })),
    });
  }
  const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: language },
        ...(components.length ? { components } : {}),
      },
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

export const Route = createFileRoute("/api/public/cron/pipeline-activities-tick")({
  server: {
    handlers: {
      POST: async () => {
        const url = process.env.SUPABASE_URL!;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
        const admin = createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const BATCH = 50;
        const { data: due, error: dueErr } = await admin
          .from("pipeline_contact_activities")
          .select(
            "id, pipeline_contact_id, contact_id, brand_id, stage_id, pipeline_id, kind, mode, message_text, template_id, template_variables, target_stage_id",
          )
          .eq("status", "pending")
          .eq("mode", "auto")
          .lte("due_at", new Date().toISOString())
          .order("due_at", { ascending: true })
          .limit(BATCH);

        if (dueErr) {
          return new Response(JSON.stringify({ error: dueErr.message }), { status: 500 });
        }

        const results: any[] = [];

        for (const a of (due ?? []) as ActivityRow[]) {
          try {
            // move_stage: apenas move o card, sem WhatsApp
            if (a.kind === "move_stage") {
              if (!a.target_stage_id) {
                await admin
                  .from("pipeline_contact_activities")
                  .update({ status: "failed", error_message: "Etapa de destino não definida" })
                  .eq("id", a.id);
                results.push({ id: a.id, status: "failed", reason: "no_target_stage" });
                continue;
              }
              const { error: mvErr } = await admin
                .from("pipeline_contacts")
                .update({ stage_id: a.target_stage_id, updated_at: new Date().toISOString() })
                .eq("id", a.pipeline_contact_id);
              if (mvErr) {
                await admin
                  .from("pipeline_contact_activities")
                  .update({ status: "failed", error_message: mvErr.message })
                  .eq("id", a.id);
                results.push({ id: a.id, status: "failed", reason: "move_failed" });
                continue;
              }
              await admin
                .from("pipeline_contact_activities")
                .update({ status: "done", executed_at: new Date().toISOString() })
                .eq("id", a.id);
              results.push({ id: a.id, status: "done", action: "moved" });
              continue;
            }

            // 1) Resolve contact + conversation
            const { data: contact } = await admin
              .from("contacts")
              .select("id, wa_id, name, profile_name, phone, metadata")
              .eq("id", a.contact_id)
              .single();
            if (!contact?.wa_id) {
              await admin
                .from("pipeline_contact_activities")
                .update({ status: "failed", error_message: "Contato sem wa_id" })
                .eq("id", a.id);
              results.push({ id: a.id, status: "failed", reason: "no_wa_id" });
              continue;
            }

            const { data: conv } = await admin
              .from("conversations")
              .select("id, channel_id, window_expires_at, channel:brand_channels!channel_id(phone_number_id)")
              .eq("contact_id", a.contact_id)
              .eq("brand_id", a.brand_id)
              .order("last_message_at", { ascending: false, nullsFirst: false })
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (!conv) {
              // sem conversa: marca failed (a ativação manual/inbox cria a conversa quando o usuário entrar)
              await admin
                .from("pipeline_contact_activities")
                .update({ status: "failed", error_message: "Sem conversa para este contato" })
                .eq("id", a.id);
              results.push({ id: a.id, status: "failed", reason: "no_conversation" });
              continue;
            }

            const phoneNumberId = (conv as any).channel?.phone_number_id as string | null;
            if (!phoneNumberId) {
              await admin
                .from("pipeline_contact_activities")
                .update({ status: "failed", error_message: "Canal sem phone_number_id" })
                .eq("id", a.id);
              results.push({ id: a.id, status: "failed", reason: "no_phone_number_id" });
              continue;
            }

            const windowOpen =
              !!conv.window_expires_at &&
              new Date(conv.window_expires_at).getTime() > Date.now();

            // Janela 24h fechada para send_message → vira manual (não falha)
            if (a.kind === "send_message" && !windowOpen) {
              await admin
                .from("pipeline_contact_activities")
                .update({ mode: "manual", error_message: "Janela 24h fechada — virou manual" })
                .eq("id", a.id);
              results.push({ id: a.id, status: "flipped_manual" });
              continue;
            }

            // 2) Token do canal
            const { data: secret } = await admin
              .from("channel_secrets")
              .select("system_user_token")
              .eq("channel_id", conv.channel_id)
              .single();
            if (!secret?.system_user_token) {
              await admin
                .from("pipeline_contact_activities")
                .update({ status: "failed", error_message: "Token do canal ausente" })
                .eq("id", a.id);
              results.push({ id: a.id, status: "failed", reason: "no_token" });
              continue;
            }
            const token = secret.system_user_token;

            // 3) Envio
            let waMessageId: string | null = null;
            let sendOk = false;
            let errMsg: string | null = null;

            if (a.kind === "send_message") {
              const body = (a.message_text ?? "").trim();
              if (!body) {
                errMsg = "Mensagem vazia";
              } else {
                const r = await sendText(token, phoneNumberId, contact.wa_id, body);
                if (r.ok) {
                  waMessageId = r.json?.messages?.[0]?.id ?? null;
                  sendOk = true;
                } else {
                  errMsg = r.json?.error?.message ?? `Falha ${r.status}`;
                }
                // Registra em messages
                await admin.from("messages").insert({
                  conversation_id: conv.id,
                  brand_id: a.brand_id,
                  channel_id: conv.channel_id,
                  direction: "outbound",
                  type: "text",
                  content: body,
                  wa_message_id: waMessageId,
                  status: sendOk ? "sent" : "failed",
                  error_message: errMsg,
                });
              }
            } else {
              // send_template
              if (!a.template_id) {
                errMsg = "Template não definido";
              } else {
                const { data: tpl } = await admin
                  .from("whatsapp_templates")
                  .select("name, language, variables_count, variable_bindings, components")
                  .eq("id", a.template_id)
                  .single();
                if (!tpl) {
                  errMsg = "Template não encontrado";
                } else {
                  // Resolve bindings: manual override (non-empty entry) wins,
                  // otherwise pull from contact / latest integration_events by platform.
                  const count = (tpl as any).variables_count ?? 0;
                  const bindings: VariableBinding[] = Array.isArray((tpl as any).variable_bindings)
                    ? ((tpl as any).variable_bindings as VariableBinding[])
                    : [];
                  const components = (((tpl as any).components ?? []) as any[]);
                  const bodyComp = components.find((c) => c?.type === "BODY");
                  const examples: string[] =
                    (bodyComp?.example?.body_text?.[0] as string[] | undefined) ?? [];
                  const manual = (a.template_variables ?? []) as string[];

                  // Fetch last integration_events payload per platform actually needed.
                  const neededPlatforms = new Set<BindingSource>();
                  for (const b of bindings) {
                    if (b.source !== "static" && b.source !== "contact") {
                      neededPlatforms.add(b.source);
                    }
                  }
                  const eventsByPlatform: Partial<Record<BindingSource, unknown>> = {};
                  if (neededPlatforms.size > 0) {
                    const { data: evs } = await admin
                      .from("integration_events")
                      .select("platform, payload, created_at")
                      .eq("contact_id", a.contact_id)
                      .in("platform", Array.from(neededPlatforms))
                      .order("created_at", { ascending: false })
                      .limit(50);
                    for (const ev of (evs ?? []) as any[]) {
                      const p = ev.platform as BindingSource;
                      if (!(p in eventsByPlatform)) eventsByPlatform[p] = ev.payload;
                    }
                  }

                  const resolved: string[] = [];
                  for (let vi = 0; vi < count; vi++) {
                    const manualVal = (manual[vi] ?? "").trim();
                    if (manualVal) {
                      resolved.push(manualVal);
                      continue;
                    }
                    const b = bindings.find((bb) => bb.index === vi + 1);
                    if (b) {
                      resolved.push(
                        resolveBinding(
                          b,
                          { contact: contact as Record<string, unknown>, eventsByPlatform },
                          examples[vi],
                        ),
                      );
                    } else {
                      resolved.push(examples[vi] ?? "");
                    }
                  }

                  const r = await sendTemplate(
                    token,
                    phoneNumberId,
                    contact.wa_id,
                    tpl.name,
                    tpl.language,
                    resolved,
                  );
                  if (r.ok) {
                    waMessageId = r.json?.messages?.[0]?.id ?? null;
                    sendOk = true;
                  } else {
                    errMsg = r.json?.error?.message ?? `Falha ${r.status}`;
                  }
                  await admin.from("messages").insert({
                    conversation_id: conv.id,
                    brand_id: a.brand_id,
                    channel_id: conv.channel_id,
                    direction: "outbound",
                    type: "template",
                    template_name: tpl.name,
                    template_language: tpl.language,
                    template_variables: resolved,
                    wa_message_id: waMessageId,
                    status: sendOk ? "sent" : "failed",
                    error_message: errMsg,
                  });
                }
              }
            }

            if (sendOk) {
              await admin
                .from("pipeline_contact_activities")
                .update({
                  status: "done",
                  executed_at: new Date().toISOString(),
                  wa_message_id: waMessageId,
                })
                .eq("id", a.id);
              await admin
                .from("conversations")
                .update({ last_message_at: new Date().toISOString() })
                .eq("id", conv.id);
              results.push({ id: a.id, status: "done" });
            } else {
              await admin
                .from("pipeline_contact_activities")
                .update({ status: "failed", error_message: errMsg ?? "Erro desconhecido" })
                .eq("id", a.id);
              results.push({ id: a.id, status: "failed", reason: errMsg });
            }
          } catch (e) {
            await admin
              .from("pipeline_contact_activities")
              .update({ status: "failed", error_message: String((e as Error).message ?? e) })
              .eq("id", a.id);
            results.push({ id: a.id, status: "failed", reason: "exception" });
          }
        }

        return new Response(JSON.stringify({ processed: results.length, results }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
