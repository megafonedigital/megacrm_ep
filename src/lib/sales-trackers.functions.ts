import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertBrand(userId: string, brandId: string) {
  const { data: ok } = await supabaseAdmin.rpc("has_brand_access", {
    _user_id: userId,
    _brand_id: brandId,
  });
  if (!ok) throw new Response("Forbidden", { status: 403 });
}

async function assertWriter(userId: string) {
  const { data: isAdmin } = await supabaseAdmin.rpc("is_admin", { _user_id: userId });
  if (isAdmin) return;
  const { data: sup } = await supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "supervisor" });
  if (sup) return;
  const { data: dev } = await supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "developer" });
  if (dev) return;
  throw new Response("Forbidden", { status: 403 });
}

const codeSchema = z.object({
  id: z.string().uuid().optional(),
  kind: z.enum(["sck", "utm"]),
  sck: z.string().trim().max(255).optional().nullable(),
  utm_source: z.string().trim().max(255).optional().nullable(),
  utm_medium: z.string().trim().max(255).optional().nullable(),
  utm_campaign: z.string().trim().max(255).optional().nullable(),
  utm_content: z.string().trim().max(255).optional().nullable(),
  utm_term: z.string().trim().max(255).optional().nullable(),
  platform_hint: z.enum(["hotmart", "shopify"]).optional().nullable(),
  active: z.boolean().default(true),
});

export const listTrackers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ brandId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertBrand(context.userId, data.brandId);
    const { data: trackers } = await supabaseAdmin
      .from("sales_trackers")
      .select("id, name, kind, user_id, automation_id, active, notes, created_at, updated_at")
      .eq("brand_id", data.brandId)
      .order("created_at", { ascending: false });
    const ids = (trackers ?? []).map((t) => t.id as string);
    const { data: codes } = ids.length
      ? await supabaseAdmin
          .from("sales_tracker_codes")
          .select("id, tracker_id, kind, sck, utm_source, utm_medium, utm_campaign, utm_content, utm_term, platform_hint, active, created_at")
          .in("tracker_id", ids)
      : { data: [] };
    // Lookup names for sellers/automations
    const userIds = Array.from(new Set((trackers ?? []).map((t) => t.user_id).filter(Boolean) as string[]));
    const autoIds = Array.from(new Set((trackers ?? []).map((t) => t.automation_id).filter(Boolean) as string[]));
    const [{ data: profiles }, { data: autos }] = await Promise.all([
      userIds.length
        ? supabaseAdmin.from("profiles").select("id, full_name, email").in("id", userIds)
        : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null; email: string | null }> }),
      autoIds.length
        ? supabaseAdmin.from("automations").select("id, name").in("id", autoIds)
        : Promise.resolve({ data: [] as Array<{ id: string; name: string | null }> }),
    ]);
    const profileMap = new Map((profiles ?? []).map((p) => [p.id as string, p]));
    const autoMap = new Map((autos ?? []).map((a) => [a.id as string, (a.name as string) ?? "—"]));
    const codesByTracker = new Map<string, typeof codes>();
    for (const c of codes ?? []) {
      const tid = c.tracker_id as string;
      if (!codesByTracker.has(tid)) codesByTracker.set(tid, [] as never);
      (codesByTracker.get(tid) as unknown as Array<typeof c>).push(c);
    }
    return {
      trackers: (trackers ?? []).map((t) => ({
        ...t,
        codes: (codesByTracker.get(t.id as string) ?? []) as Array<{
          id: string; tracker_id: string; kind: "sck" | "utm";
          sck: string | null; utm_source: string | null; utm_medium: string | null;
          utm_campaign: string | null; utm_content: string | null; utm_term: string | null;
          platform_hint: string | null; active: boolean; created_at: string;
        }>,
        user_name: t.user_id ? (profileMap.get(t.user_id as string)?.full_name ?? profileMap.get(t.user_id as string)?.email ?? null) : null,
        automation_name: t.automation_id ? autoMap.get(t.automation_id as string) ?? null : null,
      })),
    };
  });

export const upsertTracker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      id: z.string().uuid().optional(),
      brandId: z.string().uuid(),
      name: z.string().trim().min(1).max(120),
      kind: z.enum(["seller", "automation"]),
      user_id: z.string().uuid().optional().nullable(),
      automation_id: z.string().uuid().optional().nullable(),
      active: z.boolean().default(true),
      notes: z.string().max(500).optional().nullable(),
      codes: z.array(codeSchema).max(50).default([]),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertBrand(context.userId, data.brandId);
    await assertWriter(context.userId);

    const trackerPayload = {
      brand_id: data.brandId,
      name: data.name,
      kind: data.kind,
      user_id: data.kind === "seller" ? (data.user_id ?? null) : null,
      automation_id: data.kind === "automation" ? (data.automation_id ?? null) : null,
      active: data.active,
      notes: data.notes ?? null,
      created_by: context.userId,
    };

    let trackerId = data.id;
    if (trackerId) {
      const { error } = await supabaseAdmin
        .from("sales_trackers")
        .update(trackerPayload)
        .eq("id", trackerId)
        .eq("brand_id", data.brandId);
      if (error) throw new Error(error.message);
    } else {
      const { data: created, error } = await supabaseAdmin
        .from("sales_trackers")
        .insert(trackerPayload)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      trackerId = created!.id as string;
    }

    // Replace codes (simple strategy: delete missing ids, upsert provided)
    const { data: existing } = await supabaseAdmin
      .from("sales_tracker_codes")
      .select("id")
      .eq("tracker_id", trackerId);
    const keepIds = new Set(data.codes.map((c) => c.id).filter(Boolean) as string[]);
    const toDelete = (existing ?? []).map((e) => e.id as string).filter((id) => !keepIds.has(id));
    if (toDelete.length > 0) {
      await supabaseAdmin.from("sales_tracker_codes").delete().in("id", toDelete);
    }
    if (data.codes.length > 0) {
      const toInsert: Array<Record<string, unknown>> = [];
      const toUpsert: Array<Record<string, unknown>> = [];
      for (const c of data.codes) {
        const base = {
          tracker_id: trackerId,
          brand_id: data.brandId,
          kind: c.kind,
          sck: c.kind === "sck" ? (c.sck?.trim() || null) : null,
          utm_source: c.kind === "utm" ? (c.utm_source?.trim() || null) : null,
          utm_medium: c.kind === "utm" ? (c.utm_medium?.trim() || null) : null,
          utm_campaign: c.kind === "utm" ? (c.utm_campaign?.trim() || null) : null,
          utm_content: c.kind === "utm" ? (c.utm_content?.trim() || null) : null,
          utm_term: c.kind === "utm" ? (c.utm_term?.trim() || null) : null,
          platform_hint: c.platform_hint ?? null,
          active: c.active,
        };
        if (c.id) toUpsert.push({ id: c.id, ...base });
        else toInsert.push(base);
      }
      if (toInsert.length > 0) {
        const { error: insErr } = await supabaseAdmin
          .from("sales_tracker_codes")
          .insert(toInsert as never);
        if (insErr) throw new Error(insErr.message);
      }
      if (toUpsert.length > 0) {
        const { error: upErr } = await supabaseAdmin
          .from("sales_tracker_codes")
          .upsert(toUpsert as never, { onConflict: "id" });
        if (upErr) throw new Error(upErr.message);
      }
    }

    return { id: trackerId };
  });

export const deleteTracker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid(), brandId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertBrand(context.userId, data.brandId);
    await assertWriter(context.userId);
    const { error } = await supabaseAdmin
      .from("sales_trackers")
      .delete()
      .eq("id", data.id)
      .eq("brand_id", data.brandId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listTrackerOptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ brandId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertBrand(context.userId, data.brandId);
    const [{ data: channels }, { data: autos }] = await Promise.all([
      supabaseAdmin
        .from("brand_channels")
        .select("id")
        .eq("brand_id", data.brandId),
      supabaseAdmin
        .from("automations")
        .select("id, name")
        .eq("brand_id", data.brandId)
        .order("name"),
    ]);
    const channelIds = (channels ?? []).map((c: any) => c.id as string);
    const userIds = new Set<string>();
    if (channelIds.length > 0) {
      const { data: ags } = await supabaseAdmin
        .from("channel_agents")
        .select("user_id")
        .in("channel_id", channelIds);
      for (const r of ags ?? []) {
        if ((r as any).user_id) userIds.add((r as any).user_id as string);
      }
    }
    // Sempre incluir admins, developers e supervisores (acesso global)
    const { data: priv } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role")
      .in("role", ["admin", "developer", "supervisor"]);
    for (const r of priv ?? []) {
      if ((r as any).user_id) userIds.add((r as any).user_id as string);
    }

    let users: Array<{ id: string; label: string }> = [];
    if (userIds.size > 0) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email")
        .in("id", Array.from(userIds))
        .eq("active", true)
        .order("full_name", { ascending: true, nullsFirst: false });
      users = (profiles ?? []).map((p: any) => ({
        id: p.id as string,
        label: (p.full_name as string) || (p.email as string) || (p.id as string).slice(0, 8),
      }));
    }
    return {
      users,
      automations: (autos ?? []).map((a) => ({ id: a.id as string, label: (a.name as string) ?? "—" })),
    };
  });

