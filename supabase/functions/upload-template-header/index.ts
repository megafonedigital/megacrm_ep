// upload-template-header: upload em 2 passos para obter header_handle
// Recebe multipart/form-data: field "file" e "channel_id"
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient, requireRole } from "../_shared/supabase.ts";
import { getChannelToken } from "../_shared/vault.ts";
import { createMediaUploadSession, uploadMediaBytes } from "../_shared/meta.ts";
import { logError, translateMetaError } from "../_shared/errors.ts";

const ALLOWED_MIME = new Set([
  "image/jpeg", "image/png",
  "video/mp4",
  "application/pdf",
]);
const MAX_BYTES = 16 * 1024 * 1024; // 16 MB

Deno.serve(async (req) => {
  const pf = handlePreflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    await requireRole(req, ["admin", "supervisor", "developer"]);
  } catch (e) {
    if (e instanceof Response) return e;
    return jsonResponse({ error: "forbidden" }, 403);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonResponse({ error: "Envio precisa ser multipart/form-data." }, 400);
  }

  const channel_id = String(form.get("channel_id") ?? "");
  const file = form.get("file");
  if (!channel_id || !(file instanceof File)) {
    return jsonResponse({ error: "channel_id e file são obrigatórios." }, 400);
  }
  if (file.size === 0) return jsonResponse({ error: "Arquivo vazio." }, 400);
  if (file.size > MAX_BYTES) return jsonResponse({ error: "Arquivo excede 16 MB." }, 413);
  if (!ALLOWED_MIME.has(file.type)) {
    return jsonResponse({ error: `Tipo não suportado: ${file.type}` }, 400);
  }

  const admin = getAdminClient();
  const { data: ch } = await admin
    .from("brand_channels")
    .select("brand_id, app_id")
    .eq("id", channel_id)
    .single();
  if (!ch?.app_id) {
    return jsonResponse({
      error: "Canal não tem App ID configurado. Adicione o App ID da Meta nas credenciais do canal.",
    }, 400);
  }

  let token: string;
  try {
    token = await getChannelToken(channel_id);
  } catch {
    return jsonResponse({ error: "Token do canal não cadastrado." }, 400);
  }

  // 1) sessão
  const session = await createMediaUploadSession({
    token,
    appId: ch.app_id,
    fileName: file.name || "media",
    fileLength: file.size,
    fileType: file.type,
  });
  if (!session.ok || !session.data?.id) {
    const code = String(session.error?.code ?? "META_ERR");
    const msg = translateMetaError(code, session.error?.message);
    await logError({
      severity: "error", category: "media", code, messagePt: msg, brandId: ch.brand_id,
      technicalMessage: session.error?.message, payload: session.raw,
    });
    return jsonResponse({ error: msg, code }, 400);
  }

  // 2) upload p/ Meta (handle do template)
  const bytes = new Uint8Array(await file.arrayBuffer());
  const up = await uploadMediaBytes({ token, uploadId: session.data.id, bytes });
  if (!up.ok || !up.data?.h) {
    const code = String(up.error?.code ?? "UPLOAD_ERR");
    const msg = translateMetaError(code, up.error?.message ?? "Falha no upload da mídia.");
    await logError({
      severity: "error", category: "media", code, messagePt: msg, brandId: ch.brand_id,
      technicalMessage: up.error?.message, payload: up.raw,
    });
    return jsonResponse({ error: msg, code }, 400);
  }

  // 3) salvar a mesma mídia no Storage para reutilizar no envio (mesma URL pública = mesmo arquivo do exemplo aprovado)
  const ext = (file.name.includes(".") ? file.name.split(".").pop() : (file.type.split("/")[1] ?? "bin")) || "bin";
  const storagePath = `templates/${channel_id}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await admin.storage
    .from("message-media")
    .upload(storagePath, bytes, { contentType: file.type, upsert: false });
  let publicUrl: string | null = null;
  if (upErr) {
    await logError({
      severity: "warning", category: "media", code: "STORAGE_UPLOAD_FAILED",
      messagePt: "Mídia enviada à Meta, mas falhou ao salvar cópia local.",
      technicalMessage: upErr.message, brandId: ch.brand_id,
    });
  } else {
    const { data: signed } = await admin.storage
      .from("message-media")
      .createSignedUrl(storagePath, 60 * 60 * 24 * 365 * 10); // 10 anos
    publicUrl = signed?.signedUrl ?? null;
  }

  return jsonResponse({
    header_handle: up.data.h,
    mime: file.type,
    size: file.size,
    filename: file.name,
    header_media_url: publicUrl,
    header_media_path: storagePath,
  });
});
