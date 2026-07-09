import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const StatusSchema = z.enum(["pending", "done", "missed", "cancelled"]);

export type AppointmentRow = {
  id: string;
  brand_id: string;
  contact_id: string;
  conversation_id: string | null;
  pipeline_id: string | null;
  pipeline_stage_id: string | null;
  assignee_id: string;
  created_by: string;
  scheduled_at: string;
  note: string | null;
  status: "pending" | "done" | "missed" | "cancelled";
  notified_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  contact?: { id: string; name: string | null; phone: string | null; wa_id: string | null } | null;
  pipeline?: { id: string; name: string } | null;
  stage?: { id: string; name: string } | null;
  assignee?: { id: string; full_name: string | null; email: string | null } | null;
};

async function assertBrandAccess(userId: string, brandId: string) {
  const { data, error } = await supabaseAdmin.rpc("has_brand_access", {
    _user_id: userId,
    _brand_id: brandId,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Response("Sem acesso a este workspace", { status: 403 });
}

async function getUserRoles(userId: string): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  return new Set((data ?? []).map((r) => r.role as string));
}

const SELECT_COLS =
  "id, brand_id, contact_id, conversation_id, pipeline_id, pipeline_stage_id, assignee_id, created_by, scheduled_at, note, status, notified_at, completed_at, created_at, updated_at, contact:contacts!appointments_contact_id_fkey(id, name, phone, wa_id), pipeline:pipelines!appointments_pipeline_id_fkey(id, name), stage:pipeline_stages!appointments_pipeline_stage_id_fkey(id, name), assignee:profiles!appointments_assignee_id_fkey(id, full_name, email)";

// Os FKs explícitos não existem — usamos joins manuais via supabaseAdmin para evitar dependência de naming
async function hydrate(rows: any[]): Promise<AppointmentRow[]> {
  if (!rows.length) return [];
  const contactIds = Array.from(new Set(rows.map((r) => r.contact_id).filter(Boolean)));
  const pipelineIds = Array.from(new Set(rows.map((r) => r.pipeline_id).filter(Boolean)));
  const stageIds = Array.from(new Set(rows.map((r) => r.pipeline_stage_id).filter(Boolean)));
  const userIds = Array.from(new Set(rows.map((r) => r.assignee_id).filter(Boolean)));

  const [contacts, pipelines, stages, profiles] = await Promise.all([
    contactIds.length
      ? supabaseAdmin.from("contacts").select("id, name, phone, wa_id").in("id", contactIds)
      : Promise.resolve({ data: [] as any[] }),
    pipelineIds.length
      ? supabaseAdmin.from("pipelines").select("id, name").in("id", pipelineIds)
      : Promise.resolve({ data: [] as any[] }),
    stageIds.length
      ? supabaseAdmin.from("pipeline_stages").select("id, name").in("id", stageIds)
      : Promise.resolve({ data: [] as any[] }),
    userIds.length
      ? supabaseAdmin.from("profiles").select("id, full_name, email").in("id", userIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const cMap = new Map((contacts.data ?? []).map((c: any) => [c.id, c]));
  const pMap = new Map((pipelines.data ?? []).map((p: any) => [p.id, p]));
  const sMap = new Map((stages.data ?? []).map((s: any) => [s.id, s]));
  const uMap = new Map((profiles.data ?? []).map((u: any) => [u.id, u]));

  return rows.map((r) => ({
    ...r,
    contact: r.contact_id ? cMap.get(r.contact_id) ?? null : null,
    pipeline: r.pipeline_id ? pMap.get(r.pipeline_id) ?? null : null,
    stage: r.pipeline_stage_id ? sMap.get(r.pipeline_stage_id) ?? null : null,
    assignee: r.assignee_id ? uMap.get(r.assignee_id) ?? null : null,
  })) as AppointmentRow[];
}

export const listAppointments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        brandId: z.string().uuid(),
        scope: z.enum(["mine", "workspace"]).default("mine"),
        range: z.enum(["today", "week", "overdue", "upcoming", "done", "all"]).default("upcoming"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await assertBrandAccess(userId, data.brandId);
    const roles = await getUserRoles(userId);
    const canSeeAll = roles.has("admin") || roles.has("supervisor") || roles.has("developer");

    let q = supabaseAdmin
      .from("appointments")
      .select(
        "id, brand_id, contact_id, conversation_id, pipeline_id, pipeline_stage_id, assignee_id, created_by, scheduled_at, note, status, notified_at, completed_at, created_at, updated_at",
      )
      .eq("brand_id", data.brandId)
      .order("scheduled_at", { ascending: true })
      .limit(500);

    if (data.scope === "mine" || !canSeeAll) {
      q = q.or(`assignee_id.eq.${userId},created_by.eq.${userId}`);
    }

    const now = new Date();
    if (data.range === "today") {
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      q = q
        .eq("status", "pending")
        .gte("scheduled_at", new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString())
        .lte("scheduled_at", end.toISOString());
    } else if (data.range === "week") {
      const end = new Date(now);
      end.setDate(end.getDate() + 7);
      q = q.eq("status", "pending").gte("scheduled_at", now.toISOString()).lte("scheduled_at", end.toISOString());
    } else if (data.range === "overdue") {
      q = q.eq("status", "pending").lt("scheduled_at", now.toISOString());
    } else if (data.range === "upcoming") {
      q = q.in("status", ["pending"]).order("scheduled_at", { ascending: true });
    } else if (data.range === "done") {
      q = q.in("status", ["done", "cancelled", "missed"]).order("scheduled_at", { ascending: false });
    }

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { appointments: await hydrate(rows ?? []) };
  });

export const listAppointmentsByContact = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ brandId: z.string().uuid(), contactId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertBrandAccess(context.userId, data.brandId);
    const { data: rows, error } = await supabaseAdmin
      .from("appointments")
      .select(
        "id, brand_id, contact_id, conversation_id, pipeline_id, pipeline_stage_id, assignee_id, created_by, scheduled_at, note, status, notified_at, completed_at, created_at, updated_at",
      )
      .eq("brand_id", data.brandId)
      .eq("contact_id", data.contactId)
      .order("scheduled_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return { appointments: await hydrate(rows ?? []) };
  });

export const countDueAppointments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ brandId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await assertBrandAccess(userId, data.brandId);
    const horizon = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const { count, error } = await supabaseAdmin
      .from("appointments")
      .select("id", { head: true, count: "exact" })
      .eq("brand_id", data.brandId)
      .eq("status", "pending")
      .eq("assignee_id", userId)
      .lte("scheduled_at", horizon);
    if (error) throw new Error(error.message);
    return { count: count ?? 0 };
  });

export const createAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        brandId: z.string().uuid(),
        contactId: z.string().uuid(),
        scheduledAt: z.string().min(1),
        assigneeId: z.string().uuid().optional(),
        note: z.string().max(2000).optional().nullable(),
        conversationId: z.string().uuid().optional().nullable(),
        pipelineId: z.string().uuid().optional().nullable(),
        pipelineStageId: z.string().uuid().optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await assertBrandAccess(userId, data.brandId);
    const assignee = data.assigneeId ?? userId;
    if (assignee !== userId) {
      const roles = await getUserRoles(userId);
      if (!roles.has("admin") && !roles.has("supervisor") && !roles.has("developer")) {
        throw new Response("Sem permissão para atribuir a outro atendente", { status: 403 });
      }
      await assertBrandAccess(assignee, data.brandId);
    }

    const { data: row, error } = await supabaseAdmin
      .from("appointments")
      .insert({
        brand_id: data.brandId,
        contact_id: data.contactId,
        conversation_id: data.conversationId ?? null,
        pipeline_id: data.pipelineId ?? null,
        pipeline_stage_id: data.pipelineStageId ?? null,
        assignee_id: assignee,
        created_by: userId,
        scheduled_at: new Date(data.scheduledAt).toISOString(),
        note: data.note ?? null,
        status: "pending",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const updateAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        scheduledAt: z.string().optional(),
        note: z.string().max(2000).nullable().optional(),
        assigneeId: z.string().uuid().optional(),
        pipelineId: z.string().uuid().nullable().optional(),
        pipelineStageId: z.string().uuid().nullable().optional(),
        status: StatusSchema.optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: existing, error: exErr } = await supabaseAdmin
      .from("appointments")
      .select("id, brand_id, assignee_id, created_by")
      .eq("id", data.id)
      .single();
    if (exErr) throw new Error(exErr.message);
    await assertBrandAccess(userId, existing.brand_id);
    const roles = await getUserRoles(userId);
    const isOwner = existing.assignee_id === userId || existing.created_by === userId;
    const isPrivileged = roles.has("admin") || roles.has("supervisor") || roles.has("developer");
    if (!isOwner && !isPrivileged) {
      throw new Response("Sem permissão para editar este agendamento", { status: 403 });
    }

    const patch: {
      scheduled_at?: string;
      note?: string | null;
      assignee_id?: string;
      pipeline_id?: string | null;
      pipeline_stage_id?: string | null;
      status?: "pending" | "done" | "missed" | "cancelled";
      completed_at?: string | null;
      notified_at?: string | null;
    } = {};
    if (data.scheduledAt !== undefined) patch.scheduled_at = new Date(data.scheduledAt).toISOString();
    if (data.note !== undefined) patch.note = data.note;
    if (data.assigneeId !== undefined) patch.assignee_id = data.assigneeId;
    if (data.pipelineId !== undefined) patch.pipeline_id = data.pipelineId;
    if (data.pipelineStageId !== undefined) patch.pipeline_stage_id = data.pipelineStageId;
    if (data.status !== undefined) {
      patch.status = data.status;
      if (data.status === "done") patch.completed_at = new Date().toISOString();
    }
    if (data.scheduledAt !== undefined) patch.notified_at = null;

    const { error } = await supabaseAdmin.from("appointments").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const markAppointmentNotified = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { error } = await supabaseAdmin
      .from("appointments")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("assignee_id", userId)
      .is("notified_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: existing, error: exErr } = await supabaseAdmin
      .from("appointments")
      .select("id, brand_id, assignee_id, created_by")
      .eq("id", data.id)
      .single();
    if (exErr) throw new Error(exErr.message);
    await assertBrandAccess(userId, existing.brand_id);
    const roles = await getUserRoles(userId);
    const allowed =
      existing.assignee_id === userId ||
      existing.created_by === userId ||
      roles.has("admin") ||
      roles.has("supervisor");
    if (!allowed) throw new Response("Sem permissão", { status: 403 });
    const { error } = await supabaseAdmin.from("appointments").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

void SELECT_COLS;

export type PickerContact = {
  id: string;
  name: string | null;
  profile_name: string | null;
  phone: string | null;
  wa_id: string | null;
  email: string | null;
};

function escapeIlike(s: string): string {
  // PostgREST .or() splits on commas; escape commas and the parens that delimit values
  return s.replace(/([,()*\\])/g, "\\$1");
}

export const searchContactsForPicker = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        brandId: z.string().uuid(),
        query: z.string().trim().min(2).max(100),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertBrandAccess(context.userId, data.brandId);

    const tokens = data.query.split(/\s+/).filter((t) => t.length > 0).slice(0, 5);
    if (!tokens.length) return { contacts: [] as PickerContact[] };

    let candidateIds: Set<string> | null = null;

    for (const tok of tokens) {
      const digits = tok.replace(/\D/g, "");
      const safe = escapeIlike(tok);
      const conditions: string[] = [
        `name.ilike.%${safe}%`,
        `profile_name.ilike.%${safe}%`,
        `metadata->>email.ilike.%${safe}%`,
      ];
      if (digits.length >= 2) {
        conditions.push(`phone.ilike.%${digits}%`);
        conditions.push(`wa_id.ilike.%${digits}%`);
      }

      const { data: rows, error } = await supabaseAdmin
        .from("contacts")
        .select("id")
        .eq("brand_id", data.brandId)
        .or(conditions.join(","))
        .limit(500);
      if (error) throw new Error(error.message);

      const ids = new Set<string>((rows ?? []).map((r: any) => r.id as string));
      if (candidateIds === null) {
        candidateIds = ids;
      } else {
        const next = new Set<string>();
        candidateIds.forEach((id) => { if (ids.has(id)) next.add(id); });
        candidateIds = next;
      }


      if (candidateIds.size === 0) return { contacts: [] };

    }

    const finalIds: string[] = [];
    candidateIds!.forEach((id) => { if (finalIds.length < 100) finalIds.push(id); });
    if (!finalIds.length) return { contacts: [] };


    const { data: rows, error } = await supabaseAdmin
      .from("contacts")
      .select("id, name, profile_name, phone, wa_id, metadata")
      .in("id", finalIds)
      .order("name", { ascending: true, nullsFirst: false })
      .limit(20);
    if (error) throw new Error(error.message);

    return {
      contacts: (rows ?? []).map((r: any) => ({
        id: r.id,
        name: r.name ?? null,
        profile_name: r.profile_name ?? null,
        phone: r.phone ?? null,
        wa_id: r.wa_id ?? null,
        email: (r.metadata && typeof r.metadata === "object" ? (r.metadata.email ?? null) : null) as string | null,
      })) as PickerContact[],
    };
  });

export const getContactForPicker = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ brandId: z.string().uuid(), contactId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertBrandAccess(context.userId, data.brandId);
    const { data: row, error } = await supabaseAdmin
      .from("contacts")
      .select("id, name, profile_name, phone, wa_id, metadata, brand_id")
      .eq("id", data.contactId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row || row.brand_id !== data.brandId) return { contact: null };
    return {
      contact: {
        id: row.id,
        name: row.name ?? null,
        profile_name: row.profile_name ?? null,
        phone: row.phone ?? null,
        wa_id: row.wa_id ?? null,
        email: (row.metadata && typeof row.metadata === "object" ? ((row.metadata as any).email ?? null) : null) as
          | string
          | null,
      } as PickerContact,
    };
  });

