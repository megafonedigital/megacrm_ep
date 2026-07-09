import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type BrandMediaKind = "image" | "video" | "document" | "audio";

export type BrandMediaItem = {
  id: string;
  url: string;
  storage_path: string;
  mime: string;
  kind: string;
  filename: string | null;
  size_bytes: number | null;
  created_at: string;
};

export const listBrandMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { brandId: string; kind?: BrandMediaKind | null }) => input)
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("brand_media_library")
      .select("id, url, storage_path, mime, kind, filename, size_bytes, created_at")
      .eq("brand_id", data.brandId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (data.kind) q = q.eq("kind", data.kind);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []) as BrandMediaItem[];
  });

export const deleteBrandMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    // Busca a linha via RLS (garante que o usuário tem acesso ao brand).
    const { data: row, error: selErr } = await context.supabase
      .from("brand_media_library")
      .select("id, storage_path")
      .eq("id", data.id)
      .maybeSingle();
    if (selErr) throw new Error(selErr.message);
    if (!row) throw new Error("Mídia não encontrada.");

    // Remove o objeto no Storage (best-effort — usa admin porque bucket é privado).
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.storage.from("message-media").remove([row.storage_path]);
    } catch (e) {
      console.warn("[deleteBrandMedia] falha ao remover do storage", e);
    }

    const { error: delErr } = await context.supabase
      .from("brand_media_library")
      .delete()
      .eq("id", data.id);
    if (delErr) throw new Error(delErr.message);
    return { ok: true };
  });
