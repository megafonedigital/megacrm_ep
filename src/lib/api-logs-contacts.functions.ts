import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SearchInput = z.object({
  search: z.string().min(1).max(200),
  brandId: z.string().uuid().nullable().optional(),
});

const GetInput = z.object({ id: z.string().uuid() });

async function assertCanViewLogs(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "supervisor", "developer"]);
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("Acesso restrito.");
}

export const searchContactsForLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => SearchInput.parse(data))
  .handler(async ({ data, context }) => {
    await assertCanViewLogs(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const s = data.search.trim();
    let q = supabaseAdmin
      .from("contacts")
      .select("id, name, profile_name, phone, wa_id, brand_id")
      .or(`name.ilike.%${s}%,profile_name.ilike.%${s}%,phone.ilike.%${s}%,wa_id.ilike.%${s}%`)
      .order("name", { ascending: true })
      .limit(20);
    if (data.brandId) q = q.eq("brand_id", data.brandId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const brandIds = Array.from(new Set((rows ?? []).map((r: any) => r.brand_id).filter(Boolean)));
    let brandMap = new Map<string, string>();
    if (brandIds.length) {
      const { data: bs } = await supabaseAdmin.from("brands").select("id, name").in("id", brandIds);
      brandMap = new Map((bs ?? []).map((b: any) => [b.id as string, b.name as string]));
    }
    return (rows ?? []).map((r: any) => ({
      id: r.id as string,
      name: r.name as string | null,
      profile_name: r.profile_name as string | null,
      phone: r.phone as string | null,
      wa_id: r.wa_id as string,
      brand_id: r.brand_id as string | null,
      brand_name: r.brand_id ? brandMap.get(r.brand_id) ?? null : null,
    }));
  });

export const getContactForLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => GetInput.parse(data))
  .handler(async ({ data, context }) => {
    await assertCanViewLogs(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("contacts")
      .select("id, name, profile_name, phone, wa_id, brand_id")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return null;
    let brand_name: string | null = null;
    if (row.brand_id) {
      const { data: b } = await supabaseAdmin.from("brands").select("name").eq("id", row.brand_id).maybeSingle();
      brand_name = (b?.name as string | undefined) ?? null;
    }
    return {
      id: row.id as string,
      name: row.name as string | null,
      profile_name: row.profile_name as string | null,
      phone: row.phone as string | null,
      wa_id: row.wa_id as string,
      brand_id: row.brand_id as string | null,
      brand_name,
    };
  });
