// subscribe-waba: lista/inscreve o WABA no App da Meta (subscribed_apps)
// Necessário após trocar de App: a Meta exige POST {waba_id}/subscribed_apps
// pra retomar o envio de webhooks de mensagens para o novo App.
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient, requireRole } from "../_shared/supabase.ts";
import { getChannelToken } from "../_shared/vault.ts";
import { listSubscribedApps, subscribeWaba } from "../_shared/meta.ts";
import { logError, translateMetaError } from "../_shared/errors.ts";

Deno.serve(async (req) => {
  const pf = handlePreflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    await requireRole(req, ["admin"]);
  } catch (e) {
    if (e instanceof Response) return e;
    return jsonResponse({ error: "forbidden" }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const { channel_id, action } = body as { channel_id: string; action: "list" | "subscribe" };
  if (!channel_id) return jsonResponse({ error: "channel_id obrigatório" }, 400);
  if (action !== "list" && action !== "subscribe") {
    return jsonResponse({ error: "action deve ser 'list' ou 'subscribe'" }, 400);
  }

  const admin = getAdminClient();
  const { data: ch } = await admin
    .from("brand_channels")
    .select("id, brand_id, name, waba_id")
    .eq("id", channel_id)
    .maybeSingle();
  if (!ch) return jsonResponse({ error: "Canal não encontrado." }, 404);
  if (!ch.waba_id) return jsonResponse({ error: "Canal sem waba_id configurado." }, 400);

  let token: string;
  try {
    token = await getChannelToken(channel_id);
  } catch {
    return jsonResponse({ error: "Token Meta não cadastrado para este canal." }, 400);
  }

  if (action === "subscribe") {
    const res = await subscribeWaba({ token, wabaId: ch.waba_id });
    if (!res.ok) {
      const msg = translateMetaError(String(res.error?.code ?? ""), res.error?.message);
      await logError({
        severity: "error",
        category: "meta",
        code: "WABA_SUBSCRIBE_FAILED",
        messagePt: `Falha ao inscrever WABA "${ch.name}" no App: ${msg}`,
        technicalMessage: res.error?.message ?? "",
        brandId: ch.brand_id,
        payload: res.error,
      });
      return jsonResponse({ ok: false, error: msg, meta_error: res.error }, 400);
    }
  }

  const after = await listSubscribedApps({ token, wabaId: ch.waba_id });
  if (!after.ok) {
    const msg = translateMetaError(String(after.error?.code ?? ""), after.error?.message);
    return jsonResponse({ ok: action === "subscribe", error: msg, meta_error: after.error }, 400);
  }

  return jsonResponse({
    ok: true,
    action,
    waba_id: ch.waba_id,
    subscribed_apps: after.data?.data ?? [],
  });
});
