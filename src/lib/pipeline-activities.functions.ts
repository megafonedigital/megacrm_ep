import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  resolveBinding,
  type BindingSource,
  type VariableBinding,
} from "@/lib/template-bindings";

const ActivityKind = z.enum(["send_message", "send_template", "move_stage"]);
const ActivityMode = z.enum(["auto", "manual"]);

const ActivityInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(120).default("Atividade"),
  kind: ActivityKind,
  mode: ActivityMode,
  delay_minutes: z.number().int().min(0).max(60 * 24 * 365),
  message_text: z.string().max(4096).nullable().optional(),
  template_id: z.string().uuid().nullable().optional(),
  template_variables: z.array(z.string()).default([]),
  target_stage_id: z.string().uuid().nullable().optional(),
  active: z.boolean().default(true),
  position: z.number().int().min(0).default(0),
});

async function ensureBrandManager(userId: string, brandId: string) {
  const [{ data: access }, { data: isAdmin }, { data: isSup }, { data: isDev }] = await Promise.all([
    supabaseAdmin.rpc("has_brand_access", { _user_id: userId, _brand_id: brandId }),
    supabaseAdmin.rpc("is_admin", { _user_id: userId }),
    supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "supervisor" }),
    supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "developer" }),
  ]);
  if (!access) throw new Response("Forbidden", { status: 403 });
  if (!isAdmin && !isSup && !isDev) throw new Response("Forbidden", { status: 403 });
}

export const listStageActivities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ stageId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("pipeline_stage_activities")
      .select("*")
      .eq("stage_id", data.stageId)
      .order("position", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listPipelineActivitiesByPipeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ pipelineId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("pipeline_stage_activities")
      .select("*")
      .eq("pipeline_id", data.pipelineId)
      .order("position", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertStageActivities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      stageId: z.string().uuid(),
      pipelineId: z.string().uuid(),
      brandId: z.string().uuid(),
      activities: z.array(ActivityInput),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await ensureBrandManager(context.userId, data.brandId);

    const existing = await supabaseAdmin
      .from("pipeline_stage_activities")
      .select("id")
      .eq("stage_id", data.stageId);
    if (existing.error) throw new Error(existing.error.message);
    const existingIds = new Set((existing.data ?? []).map((r) => r.id));
    const keepIds = new Set(data.activities.filter((a) => a.id).map((a) => a.id!));

    // Delete removed (and respective instances)
    const toDelete = [...existingIds].filter((id) => !keepIds.has(id));
    if (toDelete.length) {
      await supabaseAdmin
        .from("pipeline_contact_activities")
        .delete()
        .in("activity_id", toDelete);
      const { error } = await supabaseAdmin
        .from("pipeline_stage_activities")
        .delete()
        .in("id", toDelete);
      if (error) throw new Error(error.message);
    }

    // Upsert each
    for (let i = 0; i < data.activities.length; i++) {
      const a = data.activities[i];
      const row = {
        stage_id: data.stageId,
        pipeline_id: data.pipelineId,
        brand_id: data.brandId,
        position: i,
        name: a.name,
        kind: a.kind,
        mode: a.mode,
        delay_minutes: a.delay_minutes,
        message_text: a.kind === "send_message" ? (a.message_text ?? "") : null,
        template_id: a.kind === "send_template" ? (a.template_id ?? null) : null,
        template_variables: a.template_variables,
        target_stage_id: a.kind === "move_stage" ? (a.target_stage_id ?? null) : null,
        active: a.active,
        created_by: context.userId,
      };
      if (a.id && existingIds.has(a.id)) {
        const { error } = await supabaseAdmin
          .from("pipeline_stage_activities")
          .update(row)
          .eq("id", a.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabaseAdmin
          .from("pipeline_stage_activities")
          .insert(row);
        if (error) throw new Error(error.message);
      }
    }

    // Backfill: para cada atividade ativa, criar instâncias pendentes para
    // pipeline_contacts já presentes nesta etapa que ainda não tenham instância.
    await supabaseAdmin.rpc("backfill_stage_activities" as any, { _stage_id: data.stageId });

    return { ok: true };
  });

export const listContactActivities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      pipelineContactId: z.string().uuid().optional(),
      contactId: z.string().uuid().optional(),
      brandId: z.string().uuid().optional(),
      currentStageOnly: z.boolean().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    let currentStageId: string | null = null;
    let currentStageName: string | null = null;
    let currentPipelineContactId: string | null = data.pipelineContactId ?? null;

    if (data.currentStageOnly && data.contactId && data.brandId) {
      const { data: pc } = await supabase
        .from("pipeline_contacts")
        .select("id, stage_id, stage:pipeline_stages!stage_id(name)")
        .eq("contact_id", data.contactId)
        .eq("brand_id", data.brandId)
        .eq("status", "aberto")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (pc) {
        currentPipelineContactId = (pc as any).id;
        currentStageId = (pc as any).stage_id;
        currentStageName = (pc as any).stage?.name ?? null;
      } else {
        return { items: [], currentStageId: null, currentStageName: null };
      }
    }

    let q = supabase
      .from("pipeline_contact_activities")
      .select("*, stage:pipeline_stages!stage_id(name, color), target_stage:pipeline_stages!target_stage_id(name, color), pipeline:pipelines!pipeline_id(name)")
      .order("due_at", { ascending: true });
    if (currentPipelineContactId) q = q.eq("pipeline_contact_id", currentPipelineContactId);
    else if (data.contactId) q = q.eq("contact_id", data.contactId);
    if (data.brandId) q = q.eq("brand_id", data.brandId);
    if (currentStageId) q = q.eq("stage_id", currentStageId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    if (data.currentStageOnly) {
      return { items: rows ?? [], currentStageId, currentStageName };
    }
    return rows ?? [];
  });

/**
 * Conta pendentes por pipeline_contact_id (para badges no Kanban).
 */
export const countPendingByPipeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ pipelineId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("pipeline_contact_activities")
      .select("pipeline_contact_id, due_at, status")
      .eq("pipeline_id", data.pipelineId)
      .eq("status", "pending");
    if (error) throw new Error(error.message);
    const map: Record<string, { pending: number; overdue: number }> = {};
    const now = Date.now();
    for (const r of rows ?? []) {
      const key = (r as any).pipeline_contact_id as string;
      if (!map[key]) map[key] = { pending: 0, overdue: 0 };
      map[key].pending += 1;
      if (new Date((r as any).due_at).getTime() <= now) map[key].overdue += 1;
    }
    return map;
  });

export const skipActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("pipeline_contact_activities")
      .update({ status: "skipped", executed_at: new Date().toISOString(), executed_by: userId })
      .eq("id", data.id)
      .in("status", ["pending", "failed"]);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Marca a atividade como `done` após o envio bem-sucedido (chamado pelo cliente
 * depois que ele dispara `send-message`).
 */
export const markActivityDone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      id: z.string().uuid(),
      waMessageId: z.string().nullable().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("pipeline_contact_activities")
      .update({
        status: "done",
        executed_at: new Date().toISOString(),
        executed_by: userId,
        wa_message_id: data.waMessageId ?? null,
      })
      .eq("id", data.id)
      .eq("status", "pending");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const GRAPH = "https://graph.facebook.com/v21.0";

/**
 * Executa uma atividade pendente sob demanda (botão "Executar agora").
 * Funciona para atividades em modo manual ou auto, status pending.
 */
export const executeActivityNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;

    const { data: a, error: aErr } = await supabaseAdmin
      .from("pipeline_contact_activities")
      .select("id, contact_id, brand_id, pipeline_contact_id, kind, message_text, template_id, template_variables, target_stage_id, status")
      .eq("id", data.id)
      .single();
    if (aErr || !a) throw new Error("Atividade não encontrada");
    if (a.status !== "pending" && a.status !== "failed")
      throw new Error("Atividade já concluída ou cancelada");

    const { data: hasAccess } = await supabaseAdmin.rpc("has_brand_access", {
      _user_id: userId,
      _brand_id: a.brand_id,
    });
    if (!hasAccess) throw new Response("Forbidden", { status: 403 });

    // move_stage: não envia mensagem, apenas move o card de etapa
    if (a.kind === "move_stage") {
      if (!a.target_stage_id) throw new Error("Etapa de destino não definida");
      const { error: upErr } = await supabaseAdmin
        .from("pipeline_contacts")
        .update({ stage_id: a.target_stage_id, updated_at: new Date().toISOString() })
        .eq("id", a.pipeline_contact_id);
      if (upErr) throw new Error(upErr.message);
      await supabaseAdmin
        .from("pipeline_contact_activities")
        .update({
          status: "done",
          executed_at: new Date().toISOString(),
          executed_by: userId,
        })
        .eq("id", a.id);
      return { ok: true, waMessageId: null };
    }

    const { data: contact } = await supabaseAdmin
      .from("contacts")
      .select("id, wa_id, name, profile_name, phone, metadata")
      .eq("id", a.contact_id)
      .single();
    if (!contact?.wa_id) throw new Error("Contato sem WhatsApp ID");

    const { data: conv } = await supabaseAdmin
      .from("conversations")
      .select("id, channel_id, window_expires_at, channel:brand_channels!channel_id(phone_number_id)")
      .eq("contact_id", a.contact_id)
      .eq("brand_id", a.brand_id)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!conv) throw new Error("Sem conversa para este contato");

    const phoneNumberId = (conv as any).channel?.phone_number_id as string | null;
    if (!phoneNumberId) throw new Error("Canal sem phone_number_id");

    const windowOpen =
      !!conv.window_expires_at && new Date(conv.window_expires_at).getTime() > Date.now();
    if (a.kind === "send_message" && !windowOpen) {
      throw new Error("Janela de 24h fechada — envie um template.");
    }

    const { data: secret } = await supabaseAdmin
      .from("channel_secrets")
      .select("system_user_token")
      .eq("channel_id", conv.channel_id)
      .single();
    if (!secret?.system_user_token) throw new Error("Token do canal ausente");
    const token = secret.system_user_token;

    let waMessageId: string | null = null;
    let sendOk = false;
    let errMsg: string | null = null;

    if (a.kind === "send_message") {
      const body = (a.message_text ?? "").trim();
      if (!body) throw new Error("Mensagem vazia");
      const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: contact.wa_id,
          type: "text",
          text: { body, preview_url: true },
        }),
      });
      const json: any = await res.json().catch(() => ({}));
      sendOk = res.ok;
      waMessageId = json?.messages?.[0]?.id ?? null;
      errMsg = sendOk ? null : (json?.error?.message ?? `Falha ${res.status}`);
      await supabaseAdmin.from("messages").insert({
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
    } else {
      if (!a.template_id) throw new Error("Template não definido");
      const { data: tpl } = await supabaseAdmin
        .from("whatsapp_templates")
        .select("name, language, variables_count, variable_bindings, components")
        .eq("id", a.template_id)
        .single();
      if (!tpl) throw new Error("Template não encontrado");

      const count = (tpl as any).variables_count ?? 0;
      const bindings: VariableBinding[] = Array.isArray((tpl as any).variable_bindings)
        ? ((tpl as any).variable_bindings as VariableBinding[])
        : [];
      const tplComponents = (((tpl as any).components ?? []) as any[]);
      const bodyComp = tplComponents.find((c) => c?.type === "BODY");
      const examples: string[] =
        (bodyComp?.example?.body_text?.[0] as string[] | undefined) ?? [];
      const manual = (a.template_variables ?? []) as string[];

      // Fetch last integration_events payload per non-contact/static platform.
      const neededPlatforms = new Set<BindingSource>();
      for (const b of bindings) {
        if (b.source !== "static" && b.source !== "contact") {
          neededPlatforms.add(b.source);
        }
      }
      const eventsByPlatform: Partial<Record<BindingSource, unknown>> = {};
      if (neededPlatforms.size > 0) {
        const { data: evs } = await supabaseAdmin
          .from("integration_events")
          .select("platform, payload, created_at")
          .eq("contact_id", a.contact_id)
          .in("platform", Array.from(neededPlatforms) as any)
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
        let value = "";
        if (b) {
          value = resolveBinding(
            b,
            { contact: contact as Record<string, unknown>, eventsByPlatform },
            examples[vi],
          );
        } else {
          value = examples[vi] ?? "";
        }
        if (!value) value = " ";
        resolved.push(value);
      }

      const components: any[] = [];
      if (resolved.length) {
        components.push({
          type: "body",
          parameters: resolved.map((v) => ({ type: "text", text: v })),
        });
      }
      const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: contact.wa_id,
          type: "template",
          template: {
            name: tpl.name,
            language: { code: tpl.language },
            ...(components.length ? { components } : {}),
          },
        }),
      });
      const json: any = await res.json().catch(() => ({}));
      sendOk = res.ok;
      waMessageId = json?.messages?.[0]?.id ?? null;
      errMsg = sendOk ? null : (json?.error?.message ?? `Falha ${res.status}`);
      await supabaseAdmin.from("messages").insert({
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

    if (!sendOk) {
      await supabaseAdmin
        .from("pipeline_contact_activities")
        .update({ status: "failed", error_message: errMsg ?? "Erro desconhecido" })
        .eq("id", a.id);
      throw new Error(errMsg ?? "Falha ao enviar");
    }

    await supabaseAdmin
      .from("pipeline_contact_activities")
      .update({
        status: "done",
        executed_at: new Date().toISOString(),
        executed_by: userId,
        wa_message_id: waMessageId,
        error_message: null,
      })
      .eq("id", a.id);
    await supabaseAdmin
      .from("conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", conv.id);

    return { ok: true, waMessageId };
  });
