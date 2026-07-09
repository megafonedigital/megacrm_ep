// sync-templates: busca templates da WABA do canal e salva no banco
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient, requireRole } from "../_shared/supabase.ts";
import { getChannelToken } from "../_shared/vault.ts";
import { listTemplates } from "../_shared/meta.ts";
import { logError, translateMetaError } from "../_shared/errors.ts";

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

  const { channel_id } = await req.json().catch(() => ({}));
  if (!channel_id) return jsonResponse({ error: "channel_id obrigatório" }, 400);

  const admin = getAdminClient();
  const { data: ch } = await admin
    .from("brand_channels")
    .select("waba_id, brand_id")
    .eq("id", channel_id)
    .single();
  if (!ch?.waba_id) return jsonResponse({ error: "Canal sem WABA ID." }, 400);

  let token: string;
  try {
    token = await getChannelToken(channel_id);
  } catch {
    return jsonResponse({ error: "Token não cadastrado." }, 400);
  }

  const res = await listTemplates({ token, wabaId: ch.waba_id });
  if (!res.ok) {
    const code = String(res.error?.code ?? "META_ERR");
    const msg = translateMetaError(code, res.error?.message);
    await admin.from("brand_channels")
      .update({ templates_last_error: msg })
      .eq("id", channel_id);
    await logError({
      severity: "error", category: "meta_api", code, messagePt: msg, brandId: ch.brand_id,
    });
    return jsonResponse({ error: msg, error_pt: msg, code }, 400);
  }

  const items = res.data?.data ?? [];
  const syncStartedAt = new Date().toISOString();
  let synced = 0;
  for (const t of items) {
    const components = (t.components as unknown as any[]) ?? [];
    const bodyComp = components.find((c) => c.type === "BODY");
    const headerComp = components.find((c) => c.type === "HEADER");
    const headerType = headerComp?.format ? String(headerComp.format).toUpperCase() : null;
    const varCount = bodyComp ? (String(bodyComp.text ?? "").match(/\{\{\d+\}\}/g)?.length ?? 0) : 0;
    await admin.from("whatsapp_templates").upsert(
      {
        brand_id: ch.brand_id,
        channel_id,
        meta_template_id: String(t.id ?? ""),
        name: String(t.name),
        language: String(t.language),
        category: String(t.category ?? ""),
        status: String(t.status ?? "PENDING"),
        components,
        header_type: headerType,
        variables_count: varCount,
        synced_at: new Date().toISOString(),
      },
      { onConflict: "channel_id,name,language" }
    );
    synced++;
  }
  // Remove templates desse canal que sumiram da Meta nesta sync
  await admin
    .from("whatsapp_templates")
    .delete()
    .eq("channel_id", channel_id)
    .lt("synced_at", syncStartedAt);
  await admin.from("brand_channels")
    .update({ templates_last_error: null, templates_last_sync_at: new Date().toISOString() })
    .eq("id", channel_id);
  return jsonResponse({ synced });
});
