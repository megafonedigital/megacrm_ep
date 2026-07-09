// upload-media: recebe arquivo, sobe ao Storage da marca e retorna URL assinada
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient, requireUser } from "../_shared/supabase.ts";

function deriveKind(mime: string): string {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

Deno.serve(async (req) => {
  const pf = handlePreflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  let userId: string | null = null;
  try {
    const u = await requireUser(req);
    userId = (u as any)?.id ?? null;
  } catch (e) {
    if (e instanceof Response) return e;
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const form = await req.formData().catch(() => null);
  if (!form) return jsonResponse({ error: "Esperado multipart/form-data" }, 400);

  const file = form.get("file") as File | null;
  const conversationId = form.get("conversation_id") as string | null;
  const brandIdRaw = form.get("brand_id") as string | null;
  
  if (!file || (!conversationId && !brandIdRaw))
    return jsonResponse({ error: "file e (conversation_id ou brand_id) obrigatórios" }, 400);

  const admin = getAdminClient();

  let brandId: string;
  let pathPrefix: string;
  let signedSeconds: number;
  if (conversationId) {
    const { data: conv } = await admin
      .from("conversations")
      .select("brand_id")
      .eq("id", conversationId)
      .single();
    if (!conv) return jsonResponse({ error: "Conversa não encontrada" }, 404);
    brandId = conv.brand_id as string;
    pathPrefix = `${brandId}/${conversationId}`;
    signedSeconds = 60 * 60 * 24 * 7;
  } else {
    brandId = brandIdRaw!;
    pathPrefix = `automation/${brandId}`;
    signedSeconds = 60 * 60 * 24 * 365 * 10; // 10 anos
  }

  const ext = (file.name.split(".").pop() ?? "bin").slice(0, 8);
  const path = `${pathPrefix}/${crypto.randomUUID()}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error: upErr } = await admin.storage
    .from("message-media")
    .upload(path, bytes, { contentType: file.type, upsert: false });
  if (upErr) return jsonResponse({ error: upErr.message }, 500);

  const { data: signed } = await admin.storage
    .from("message-media")
    .createSignedUrl(path, signedSeconds);

  // Registra na biblioteca do workspace (apenas para uploads originados de automação — quando não há conversation_id).
  if (!conversationId && signed?.signedUrl) {
    try {
      await admin.from("brand_media_library").insert({
        brand_id: brandId,
        storage_path: path,
        url: signed.signedUrl,
        mime: file.type,
        kind: deriveKind(file.type),
        filename: file.name,
        size_bytes: file.size,
        source: "automation",
        created_by: userId,
      });
    } catch (e) {
      console.warn("[upload-media] falha ao registrar em brand_media_library", e);
    }
  }

  return jsonResponse({
    url: signed?.signedUrl,
    path,
    mime: file.type,
    filename: file.name,
    size: file.size,
  });
});
