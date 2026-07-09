import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ApiLogsInput = z.object({
  brandId: z.string().default("all"),
  statusFilter: z.string().default("all"),
  methodFilter: z.string().default("all"),
  typeFilter: z.string().default("all"),
  platformFilter: z.string().default("all"),
  search: z.string().max(200).default(""),
  page: z.number().int().min(1).max(10_000).default(1),
  pageSize: z.number().int().min(1).max(200).default(25),
  contactId: z.string().uuid().nullable().optional(),
});

export const listApiLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => ApiLogsInput.parse(data))
  .handler(async ({ data, context }) => {
    const { data: roles, error: rolesError } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .in("role", ["admin", "supervisor", "developer"]);
    if (rolesError) throw new Error(rolesError.message);
    if (!roles?.length) throw new Error("Acesso restrito.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const from = (data.page - 1) * data.pageSize;
    const to = from + data.pageSize;

    let contactLogIds: string[] | null = null;
    if (data.contactId) {
      const { data: ids, error } = await context.supabase.rpc("api_logs_for_contact" as any, { _contact_id: data.contactId } as any);
      if (error) throw new Error(error.message);
      contactLogIds = ((ids as Array<{ id: string }> | null) ?? []).map((r) => r.id);
      if (contactLogIds.length === 0) return { rows: [], total: null, hasMore: false };
    }

    let q = supabaseAdmin
      .from("api_request_logs" as any)
      .select("id, created_at, brand_id, api_key_prefix, method, path, status_code, duration_ms, ip, request_body, response_summary")
      .order("created_at", { ascending: false })
      .range(from, to);

    if (contactLogIds) q = q.in("id", contactLogIds);
    if (data.brandId !== "all") q = q.eq("brand_id", data.brandId);
    if (data.methodFilter !== "all") q = q.eq("method", data.methodFilter);
    if (data.statusFilter === "2xx") q = q.gte("status_code", 200).lt("status_code", 300);
    else if (data.statusFilter === "4xx") q = q.gte("status_code", 400).lt("status_code", 500);
    else if (data.statusFilter === "5xx") q = q.gte("status_code", 500).lt("status_code", 600);

    const routeSearch = data.search.trim();
    if (routeSearch) q = q.ilike("path", `%${routeSearch}%`);

    if (data.typeFilter === "webhook") q = q.like("path", "/api/public/webhooks/%");
    else if (data.typeFilter === "rest") q = q.like("path", "/api/public/v1/%");
    else if (data.typeFilter === "whatsapp_out") q = q.like("path", "/whatsapp/send/%");
    else if (data.typeFilter === "whatsapp_in") q = q.like("path", "/whatsapp/webhook/%");
    if (data.platformFilter !== "all") q = q.like("path", `/api/public/webhooks/${data.platformFilter}/%`);

    const { data: rowsRaw, error } = await q;
    if (error) {
      if (error.code === "57014") {
        throw new Error("Timeout na busca de logs. Refine os filtros ou tente novamente.");
      }
      throw new Error(error.message);
    }

    const rowsWithExtra = (rowsRaw as any[] | null) ?? [];
    const hasMore = rowsWithExtra.length > data.pageSize;
    const rows = rowsWithExtra.slice(0, data.pageSize);
    const brandIds = Array.from(new Set(rows.map((r: any) => r.brand_id).filter(Boolean)));
    let brandMap = new Map<string, string>();
    if (brandIds.length) {
      const { data: bs } = await supabaseAdmin.from("brands").select("id, name").in("id", brandIds);
      brandMap = new Map((bs ?? []).map((b: any) => [b.id, b.name]));
    }

    return {
      rows: rows.map((r: any) => ({ ...r, brands: r.brand_id ? { name: brandMap.get(r.brand_id) ?? "—" } : null })),
      total: null,
      hasMore,
    };
  });