import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { toE164 } from "@/lib/phone";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeValue(kind: "phone" | "email", value: string): string {
  if (kind === "phone") {
    const e = toE164(value);
    if (!e) throw new Error("Telefone inválido. Use formato com DDD/DDI.");
    return e;
  }
  const v = value.trim().toLowerCase();
  if (!EMAIL_RE.test(v)) throw new Error("Email inválido.");
  return v;
}

async function assertBrandAccess(supabase: any, brandId: string) {
  const { data, error } = await supabase.rpc("has_brand_access", {
    _user_id: (await supabase.auth.getUser()).data.user?.id,
    _brand_id: brandId,
  });
  if (error || !data) throw new Error("Sem acesso ao workspace.");
}

async function userRoles(userId: string): Promise<string[]> {
  const { data } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId);
  return (data ?? []).map((r: any) => String(r.role));
}

function canManage(roles: string[]): boolean {
  return roles.includes("admin") || roles.includes("supervisor") || roles.includes("developer");
}

export const listBlocklist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { brandId: string; search?: string }) =>
    z.object({ brandId: z.string().uuid(), search: z.string().max(200).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertBrandAccess(context.supabase, data.brandId);
    let q = supabaseAdmin
      .from("contact_blocklist")
      .select("id, kind, value, reason, created_by, created_at")
      .eq("brand_id", data.brandId)
      .order("created_at", { ascending: false })
      .limit(2000);
    if (data.search) q = q.ilike("value", `%${data.search.trim()}%`);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const creatorIds = Array.from(new Set((rows ?? []).map((r: any) => r.created_by).filter(Boolean)));
    let profiles: Record<string, { full_name: string | null; email: string | null }> = {};
    if (creatorIds.length) {
      const { data: profs } = await supabaseAdmin
        .from("profiles").select("id, full_name, email").in("id", creatorIds);
      for (const p of profs ?? []) profiles[(p as any).id] = { full_name: (p as any).full_name, email: (p as any).email };
    }
    const roles = await userRoles(context.userId);
    return {
      entries: (rows ?? []).map((r: any) => ({
        ...r,
        creator: r.created_by ? profiles[r.created_by] ?? null : null,
      })),
      canManage: canManage(roles),
    };
  });

export const addBlocklistEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { brandId: string; kind: "phone" | "email"; value: string; reason?: string }) =>
    z.object({
      brandId: z.string().uuid(),
      kind: z.enum(["phone", "email"]),
      value: z.string().min(1).max(255),
      reason: z.string().max(500).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertBrandAccess(context.supabase, data.brandId);
    const value = normalizeValue(data.kind, data.value);
    const { error } = await supabaseAdmin.from("contact_blocklist").insert({
      brand_id: data.brandId,
      kind: data.kind,
      value,
      reason: data.reason?.trim() || null,
      created_by: context.userId,
    });
    if (error) {
      if ((error as any).code === "23505") throw new Error("Esta entrada já está no blocklist.");
      throw new Error(error.message);
    }
    return { ok: true };
  });

export const removeBlocklistEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const roles = await userRoles(context.userId);
    if (!canManage(roles)) throw new Error("Apenas admin, supervisor ou developer podem remover.");
    const { data: row } = await supabaseAdmin
      .from("contact_blocklist").select("brand_id").eq("id", data.id).maybeSingle();
    if (!row) throw new Error("Entrada não encontrada.");
    await assertBrandAccess(context.supabase, (row as any).brand_id);
    const { error } = await supabaseAdmin.from("contact_blocklist").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const addContactToBlocklist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { contactId: string; channels: Array<"phone" | "email">; reason?: string }) =>
    z.object({
      contactId: z.string().uuid(),
      channels: z.array(z.enum(["phone", "email"])).min(1),
      reason: z.string().max(500).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: contact, error } = await supabaseAdmin
      .from("contacts").select("brand_id, phone, wa_id, metadata").eq("id", data.contactId).maybeSingle();
    if (error || !contact) throw new Error("Contato não encontrado.");
    await assertBrandAccess(context.supabase, (contact as any).brand_id);

    const phone = toE164((contact as any).phone ?? (contact as any).wa_id ?? null);
    const email = String(((contact as any).metadata?.email ?? "")).trim().toLowerCase() || null;

    const rows: any[] = [];
    if (data.channels.includes("phone") && phone)
      rows.push({ brand_id: (contact as any).brand_id, kind: "phone", value: phone, reason: data.reason?.trim() || null, created_by: context.userId });
    if (data.channels.includes("email") && email)
      rows.push({ brand_id: (contact as any).brand_id, kind: "email", value: email, reason: data.reason?.trim() || null, created_by: context.userId });

    if (rows.length === 0) throw new Error("Contato não tem telefone/email válido para bloquear.");

    let added = 0;
    for (const r of rows) {
      const { error: insErr } = await supabaseAdmin.from("contact_blocklist").insert(r);
      if (!insErr) added++;
      else if ((insErr as any).code !== "23505") throw new Error(insErr.message);
    }
    return { ok: true, added, total: rows.length };
  });
