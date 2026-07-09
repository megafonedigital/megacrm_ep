import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const audienceSchema = z.object({
  tagIdInclude: z.string().uuid().nullable().optional(),
  tagIdExclude: z.string().uuid().nullable().optional(),
});

const createSchema = z.object({
  brandId: z.string().uuid(),
  automationId: z.string().uuid(),
  name: z.string().min(1).max(120),
  audience: audienceSchema,
  scheduledAt: z.string().datetime().nullable().optional(),
  ratePerMinute: z.number().int().min(1).max(5000),
  skipNoWindow: z.boolean(),
});

async function assertWriteAccess(userId: string, brandId: string, supabase: any) {
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roleSet = new Set((roles ?? []).map((r: any) => r.role));
  if (roleSet.has("admin")) return;
  const allowed = roleSet.has("supervisor") || roleSet.has("developer");
  if (!allowed) throw new Response("Forbidden", { status: 403 });
  const { data: hasAccess } = await supabase.rpc("has_brand_access", { _user_id: userId, _brand_id: brandId });
  if (!hasAccess) throw new Response("Forbidden", { status: 403 });
}

export const previewBroadcastAudience = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ brandId: z.string().uuid(), audience: audienceSchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId, supabase } = context;
    await assertWriteAccess(userId, data.brandId, supabase);

    const { data: rows, error } = await (supabase as any).rpc("preview_broadcast_audience", {
      _brand_id: data.brandId,
      _include_tag_id: data.audience.tagIdInclude ?? null,
      _exclude_tag_id: data.audience.tagIdExclude ?? null,
      _sample_limit: 20,
    });
    if (error) throw new Error(error.message);
    const row = Array.isArray(rows) ? rows[0] : rows;
    return {
      count: Number(row?.total_count ?? 0),
      sample: (row?.sample ?? []) as any[],
    };
  });


export const listBroadcasts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ brandId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("broadcasts")
      .select("id, name, status, automation_id, scheduled_at, total_targets, dispatched_count, failed_count, skipped_count, rate_per_minute, started_at, finished_at, created_at, created_by, automations:automation_id(name)")
      .eq("brand_id", data.brandId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return { rows: rows ?? [] };
  });

export const getBroadcast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: row, error } = await supabase
      .from("broadcasts")
      .select("*, automations:automation_id(name)")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Response("Not found", { status: 404 });

    // Uma única RPC agrega todas as contagens, taxas e último envio.
    const { data: summary, error: sumErr } = await (supabaseAdmin as any).rpc(
      "get_broadcast_summary",
      { _broadcast_id: data.id },
    );
    if (sumErr) throw new Error(sumErr.message);
    const s: any = summary ?? {};

    return {
      row: {
        ...row,
        dispatched_count: s.dispatched_count ?? 0,
        failed_count: s.failed_count ?? 0,
        skipped_count: s.skipped_count ?? 0,
        pending_count: s.pending_count ?? 0,
        processing_count: s.processing_count ?? 0,
        cancelled_count: s.cancelled_count ?? 0,
        rate_last_minute: s.rate_last_minute ?? 0,
        rate_last_10m: s.rate_last_10m ?? 0,
        last_dispatch_at: s.last_dispatch_at ?? null,
        queue_pending_count: s.queue_pending_count ?? 0,
        queue_processing_count: s.queue_processing_count ?? 0,
        queue_dispatched_count: s.queue_dispatched_count ?? 0,
        queue_failed_count: s.queue_failed_count ?? 0,
        queue_skipped_count: s.queue_skipped_count ?? 0,
      },
    };
  });


export const listBroadcastTargets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      broadcastId: z.string().uuid(),
      status: z.enum(["pending", "processing", "dispatched", "failed", "skipped", "cancelled", "all"]).default("all"),
      page: z.number().int().min(1).default(1),
      sort: z
        .object({
          column: z.enum(["dispatched_at", "status"]),
          direction: z.enum(["asc", "desc"]),
        })
        .optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId, supabase } = context;
    const { data: bc } = await supabase
      .from("broadcasts")
      .select("brand_id")
      .eq("id", data.broadcastId)
      .maybeSingle();
    if (!bc) throw new Response("Not found", { status: 404 });
    await assertWriteAccess(userId, (bc as any).brand_id, supabase);

    const PAGE = 50;
    const fromIdx = (data.page - 1) * PAGE;
    const toIdx = fromIdx + PAGE - 1;

    const useCount = data.status !== "all";

    let q = supabaseAdmin
      .from("broadcast_targets")
      .select(
        "id, status, error, dispatched_at, created_at, claimed_at, run_id, contact_id",
        useCount ? { count: "exact" } : undefined,
      )
      .eq("broadcast_id", data.broadcastId);

    if (data.status !== "all") {
      q = q.eq("status", data.status);
    }

    if (data.sort) {
      const asc = data.sort.direction === "asc";
      if (data.sort.column === "dispatched_at") {
        q = q
          .order("dispatched_at", { ascending: asc, nullsFirst: false })
          .order("created_at", { ascending: asc });
      } else {
        q = q
          .order("status", { ascending: asc })
          .order("dispatched_at", { ascending: false, nullsFirst: false });
      }
    } else if (data.status !== "all") {
      if (["dispatched", "failed", "skipped"].includes(data.status)) {
        q = q.order("dispatched_at", { ascending: false, nullsFirst: false });
      } else {
        q = q.order("created_at", { ascending: true });
      }
    } else {
      q = q.order("created_at", { ascending: true });
    }

    const { data: rows, error, count } = await q.range(fromIdx, toIdx);
    if (error) throw new Error(error.message);

    // Total: usa count quando filtrado; senão usa total_targets do broadcast
    let total = count ?? 0;
    if (!useCount) {
      const { data: bcTotal } = await supabaseAdmin
        .from("broadcasts")
        .select("total_targets")
        .eq("id", data.broadcastId)
        .maybeSingle();
      total = (bcTotal as any)?.total_targets ?? 0;
    }

    const contactIds = Array.from(new Set((rows ?? []).map((r: any) => r.contact_id).filter(Boolean)));
    const contactsMap: Record<string, { name: string | null; profile_name: string | null; phone: string | null; wa_id: string | null }> = {};
    if (contactIds.length > 0) {
      const { data: cts } = await supabaseAdmin
        .from("contacts")
        .select("id, name, profile_name, phone, wa_id")
        .in("id", contactIds);
      for (const c of cts ?? []) {
        contactsMap[(c as any).id] = {
          name: (c as any).name ?? null,
          profile_name: (c as any).profile_name ?? null,
          phone: (c as any).phone ?? null,
          wa_id: (c as any).wa_id ?? null,
        };
      }
    }
    const enriched = (rows ?? []).map((r: any) => ({ ...r, contacts: contactsMap[r.contact_id] ?? null }));
    return { rows: enriched, total, page: data.page, pageSize: PAGE };
  });


export const listActiveBroadcastsForAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ automationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("broadcasts")
      .select("id, name, status")
      .eq("automation_id", data.automationId)
      .in("status", ["scheduled", "running"])
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { rows: rows ?? [] };
  });

export const createBroadcast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => createSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId, supabase } = context;
    await assertWriteAccess(userId, data.brandId, supabase);

    // Validate automation belongs to brand
    const { data: automation } = await supabaseAdmin
      .from("automations")
      .select("id, brand_id, status")
      .eq("id", data.automationId)
      .maybeSingle();
    if (!automation || automation.brand_id !== data.brandId) {
      throw new Response("Automation inválida", { status: 400 });
    }

    // Prévia para saber se tem alguém antes de criar o broadcast.
    const { data: previewRows, error: prevErr } = await (supabase as any).rpc(
      "preview_broadcast_audience",
      {
        _brand_id: data.brandId,
        _include_tag_id: data.audience.tagIdInclude ?? null,
        _exclude_tag_id: data.audience.tagIdExclude ?? null,
        _sample_limit: 0,
      },
    );
    if (prevErr) throw new Error(prevErr.message);
    const previewRow = Array.isArray(previewRows) ? previewRows[0] : previewRows;
    const previewCount = Number(previewRow?.total_count ?? 0);
    if (previewCount === 0) {
      throw new Response("Público vazio", { status: 400 });
    }

    // FIX race condition: cria SEMPRE como 'scheduled' primeiro (sem
    // started_at). Se um broadcast-tick rodar entre o INSERT em broadcasts
    // e o RPC create_broadcast_targets_for_audience, ele poderia ver 0
    // targets pending e o recount_broadcast_progress marcaria como
    // 'completed' com dispatched_count=0. Inserindo como scheduled com
    // scheduled_at no futuro, o promotor scheduled→running do tick só
    // atua após o UPDATE explícito abaixo.
    const wantsRunning = !data.scheduledAt;

    const { data: bcast, error: bErr } = await supabaseAdmin
      .from("broadcasts")
      .insert({
        brand_id: data.brandId,
        automation_id: data.automationId,
        name: data.name,
        status: "scheduled",
        audience_filter: data.audience,
        // Agendamento imediato → data 10 min no futuro só para o tick não
        // promover antes do UPDATE final. Agendado pelo usuário → respeita.
        scheduled_at: data.scheduledAt ?? new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        rate_per_minute: data.ratePerMinute,
        skip_no_window: data.skipNoWindow,
        total_targets: previewCount,
        started_at: null,
        created_by: userId,
      })
      .select("id")
      .single();
    if (bErr || !bcast) throw new Error(bErr?.message ?? "create failed");

    // Insere os targets em uma única passagem no banco.
    const { data: insertedCount, error: insErr } = await (supabase as any).rpc(
      "create_broadcast_targets_for_audience",
      {
        _broadcast_id: bcast.id,
        _brand_id: data.brandId,
        _include_tag_id: data.audience.tagIdInclude ?? null,
        _exclude_tag_id: data.audience.tagIdExclude ?? null,
      },
    );
    if (insErr) throw new Error(insErr.message);
    const total = Number(insertedCount ?? 0);

    // Targets já existem: agora sim promove atomicamente para running
    // (mantém scheduled se o usuário agendou para depois).
    if (wantsRunning) {
      const nowIso = new Date().toISOString();
      const { error: upErr } = await supabaseAdmin
        .from("broadcasts")
        .update({ status: "running", started_at: nowIso, scheduled_at: nowIso })
        .eq("id", bcast.id);
      if (upErr) throw new Error(upErr.message);
    }

    return { id: bcast.id, total };
  });



export const cancelBroadcast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { userId, supabase } = context;
    const { data: row } = await supabase.from("broadcasts").select("brand_id, status").eq("id", data.id).maybeSingle();
    if (!row) throw new Response("Not found", { status: 404 });
    await assertWriteAccess(userId, (row as any).brand_id, supabase);
    if (["completed", "cancelled", "failed"].includes((row as any).status)) {
      return { ok: true };
    }
    await supabaseAdmin.from("broadcasts").update({ status: "cancelled", finished_at: new Date().toISOString() }).eq("id", data.id);
    await supabaseAdmin.from("broadcast_targets").update({ status: "cancelled", claimed_at: null }).eq("broadcast_id", data.id).in("status", ["pending", "processing"]);
    return { ok: true };
  });

export const getBroadcastSpeedSeries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      broadcastId: z.string().uuid(),
      minutes: z.number().int().min(5).max(720).default(60),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId, supabase } = context;
    const { data: bc } = await supabase
      .from("broadcasts")
      .select("brand_id, rate_per_minute")
      .eq("id", data.broadcastId)
      .maybeSingle();
    if (!bc) throw new Response("Not found", { status: 404 });
    await assertWriteAccess(userId, (bc as any).brand_id, supabase);

    const { data: rows, error } = await (supabaseAdmin as any).rpc("get_broadcast_speed_series", {
      _broadcast_id: data.broadcastId,
      _minutes: data.minutes,
    });
    if (error) throw new Error(error.message);
    return {
      ratePerMinute: (bc as any).rate_per_minute ?? 0,
      points: ((rows ?? []) as any[]).map((r) => ({
        minute: r.minute as string,
        dispatched: Number(r.dispatched ?? 0),
        failed: Number(r.failed ?? 0),
        isPartial: Boolean(r.is_partial ?? false),
      })),
    };
  });
