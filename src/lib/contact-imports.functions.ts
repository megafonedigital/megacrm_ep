import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const RowSchema = z.object({
  _rowIndex: z.number().int().nonnegative(),
  name: z.string().nullish(),
  profile_name: z.string().nullish(),
  phone: z.string().nullish(),
  wa_id: z.string().nullish(),
  email: z.string().nullish(),
  activecampaign_id: z.string().nullish(),
  custom: z.record(z.string(), z.any()).default({}),
});

const EnqueueInput = z.object({
  brandId: z.string().uuid(),
  filename: z.string().max(255).nullish(),
  rows: z.array(RowSchema).min(1).max(200000),
  tagIds: z.array(z.string().uuid()).max(50).default([]),
  updateExisting: z.boolean().default(false),
});

const BATCH_SIZE = 200;

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export const enqueueContactImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => EnqueueInput.parse(data))
  .handler(async ({ data, context }) => {
    const { userId } = context;

    const { data: access } = await supabaseAdmin.rpc("has_brand_access", {
      _user_id: userId,
      _brand_id: data.brandId,
    });
    if (!access) throw new Error("Sem acesso a este workspace.");

    const { data: imp, error: impErr } = await supabaseAdmin
      .from("contact_imports")
      .insert({
        brand_id: data.brandId,
        created_by: userId,
        filename: data.filename ?? null,
        total_rows: data.rows.length,
        tag_ids: data.tagIds,
        update_existing: data.updateExisting,
        status: "queued",
      })
      .select("id")
      .single();
    if (impErr || !imp) throw new Error(impErr?.message ?? "Falha ao criar importação.");

    const batches = chunk(data.rows, BATCH_SIZE).map((payload, idx) => ({
      import_id: imp.id,
      batch_index: idx,
      payload,
    }));

    // insert batches in slices of 50 (jsonb payloads são pesados)
    for (const slice of chunk(batches, 50)) {
      const { error } = await supabaseAdmin.from("contact_import_batches").insert(slice);
      if (error) {
        await supabaseAdmin
          .from("contact_imports")
          .update({ status: "failed", error_message: `Falha ao enfileirar lotes: ${error.message}`, finished_at: new Date().toISOString() })
          .eq("id", imp.id);
        throw new Error(`Falha ao enfileirar lotes: ${error.message}`);
      }
    }

    await supabaseAdmin.from("contact_import_logs").insert({
      import_id: imp.id,
      level: "info",
      message: `Importação enfileirada: ${data.rows.length} linhas em ${batches.length} lote(s) de até ${BATCH_SIZE}.`,
    });

    // kick off drain immediately (best-effort)
    const baseUrl = process.env.LOVABLE_APP_URL || process.env.PUBLIC_APP_URL || "";
    if (baseUrl) {
      fetch(`${baseUrl}/api/public/cron/contact-imports-drain`, { method: "POST" }).catch(() => {});
    }

    return { importId: imp.id, batches: batches.length };
  });

export const listContactImports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ brandId: z.string().uuid(), limit: z.number().int().min(1).max(100).default(50) }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("contact_imports")
      .select("id, brand_id, created_by, filename, total_rows, processed_rows, created_count, updated_count, skipped_count, error_count, status, started_at, finished_at, error_message, created_at, update_existing")
      .eq("brand_id", data.brandId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return { imports: rows ?? [] };
  });

export const getContactImportDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ importId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const [impRes, logsRes] = await Promise.all([
      supabase.from("contact_imports").select("*").eq("id", data.importId).maybeSingle(),
      supabase.from("contact_import_logs").select("id, level, message, row_index, created_at")
        .eq("import_id", data.importId).order("created_at", { ascending: true }).limit(2000),
    ]);
    if (impRes.error) throw new Error(impRes.error.message);
    if (!impRes.data) throw new Error("Importação não encontrada.");
    return { import: impRes.data, logs: logsRes.data ?? [] };
  });

export const cancelContactImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ importId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("contact_imports")
      .update({ status: "cancelled", finished_at: new Date().toISOString() })
      .eq("id", data.importId)
      .in("status", ["queued", "running"]);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("contact_import_batches")
      .update({ status: "failed", error: "Cancelada pelo usuário" })
      .eq("import_id", data.importId).eq("status", "pending");
    return { ok: true };
  });
