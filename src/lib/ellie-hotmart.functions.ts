import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listHotmartProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { brandId: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: items, error } = await context.supabase
      .from("ellie_hotmart_products")
      .select("*")
      .eq("brand_id", data.brandId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { items: items ?? [] };
  });

export const upsertHotmartProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      id?: string | null;
      brandId: string;
      product_id: string;
      label?: string | null;
      active?: boolean;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const payload = {
      brand_id: data.brandId,
      product_id: String(data.product_id).trim(),
      label: data.label ?? null,
      active: data.active ?? true,
    };
    if (data.id) {
      const { error } = await context.supabase
        .from("ellie_hotmart_products")
        .update(payload)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await context.supabase
        .from("ellie_hotmart_products")
        .upsert({ ...payload, created_by: context.userId }, { onConflict: "brand_id,product_id" });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const deleteHotmartProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("ellie_hotmart_products")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const testHotmartConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { brandId: string }) => d)
  .handler(async ({ data }) => {
    const { getAccessToken } = await import("./hotmart.server");
    try {
      const token = await getAccessToken(data.brandId);
      return { ok: true, tokenPrefix: token.slice(0, 8) + "…" };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? "Erro desconhecido" };
    }
  });

export const testEllieValidation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { brandId: string; email: string; forceRefresh?: boolean }) => d)
  .handler(async ({ data }) => {
    const { validateEllieBuyer } = await import("./ellie-validation.server");
    try {
      const r = await validateEllieBuyer({
        brandId: data.brandId,
        email: data.email.trim().toLowerCase(),
        forceRefresh: data.forceRefresh ?? true,
      });
      return { ok: true, ...r };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? "Erro desconhecido" };
    }
  });

