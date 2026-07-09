// whatsapp-finish-signup: completa o fluxo de Embedded Signup do WhatsApp
// 1) troca o `code` retornado pelo FB.login por um access_token (server-to-server)
// 2) inscreve o WABA no nosso App (POST /{waba_id}/subscribed_apps)
// 3) lê display_phone_number e verified_name do número
// 4) cria a linha em brand_channels e salva o token no Vault
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient, requireRole } from "../_shared/supabase.ts";
import { setChannelToken } from "../_shared/vault.ts";
import { subscribeWaba, validateToken } from "../_shared/meta.ts";
import { logError, translateMetaError } from "../_shared/errors.ts";

const GRAPH = "https://graph.facebook.com/v21.0";

async function exchangeCodeForToken(code: string): Promise<
  { ok: true; token: string } | { ok: false; error: string }
> {
  const appId = Deno.env.get("META_APP_ID");
  const appSecret = Deno.env.get("META_APP_SECRET");
  if (!appId || !appSecret) return { ok: false, error: "META_APP_ID/SECRET não configurados." };

  const url = `${GRAPH}/oauth/access_token?client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appSecret)}&code=${encodeURIComponent(code)}`;
  const res = await fetch(url, { method: "GET" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.access_token) {
    const msg = json?.error?.message ?? "Falha ao trocar code por token.";
    return { ok: false, error: msg };
  }
  return { ok: true, token: json.access_token as string };
}

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
  const { code, waba_id, phone_number_id, brand_id, name, type } = body as {
    code?: string;
    waba_id?: string;
    phone_number_id?: string;
    brand_id?: string;
    name?: string;
    type?: "suporte" | "vendas";
  };

  if (!code) return jsonResponse({ error: "code obrigatório" }, 400);
  if (!waba_id) return jsonResponse({ error: "waba_id obrigatório" }, 400);
  if (!phone_number_id) return jsonResponse({ error: "phone_number_id obrigatório" }, 400);
  if (!brand_id) return jsonResponse({ error: "brand_id obrigatório" }, 400);
  if (!name) return jsonResponse({ error: "name obrigatório" }, 400);
  const channelType: "suporte" | "vendas" = type === "vendas" ? "vendas" : "suporte";

  // 1) Troca code por token
  const tokenRes = await exchangeCodeForToken(code);
  if (!tokenRes.ok) {
    await logError({
      severity: "error",
      category: "auth",
      code: "EMBEDDED_SIGNUP_TOKEN_EXCHANGE_FAILED",
      messagePt: `Falha ao trocar código por token na Meta: ${tokenRes.error}`,
      technicalMessage: tokenRes.error,
      brandId: brand_id,
    });
    return jsonResponse({ error: tokenRes.error }, 400);
  }
  const token = tokenRes.token;

  // 2) Lê display_phone_number / verified_name
  const info = await validateToken(token, phone_number_id);
  if (!info.ok) {
    const msg = translateMetaError(String(info.error?.code ?? ""), info.error?.message);
    return jsonResponse({ error: `Token aceito mas falha ao ler número: ${msg}` }, 400);
  }
  const display = info.data?.display_phone_number ?? null;

  // 3) Inscreve WABA no nosso App
  const sub = await subscribeWaba({ token, wabaId: waba_id });
  if (!sub.ok) {
    const msg = translateMetaError(String(sub.error?.code ?? ""), sub.error?.message);
    await logError({
      severity: "error",
      category: "meta",
      code: "EMBEDDED_SIGNUP_SUBSCRIBE_FAILED",
      messagePt: `Falha ao inscrever WABA no App: ${msg}`,
      technicalMessage: sub.error?.message ?? "",
      brandId: brand_id,
      payload: sub.error,
    });
    return jsonResponse({ error: msg }, 400);
  }

  // 4) Cria canal
  const admin = getAdminClient();
  const appId = Deno.env.get("META_APP_ID")!;
  const { data: created, error: insErr } = await admin
    .from("brand_channels")
    .insert({
      brand_id,
      name,
      type: channelType,
      phone_number: display,
      phone_number_id,
      waba_id,
      app_id: appId,
      active: true,
    })
    .select("id")
    .single();
  if (insErr || !created) {
    return jsonResponse({ error: `Falha ao criar canal: ${insErr?.message ?? "erro desconhecido"}` }, 500);
  }

  // 5) Salva token no Vault e marca validado
  try {
    await setChannelToken(created.id, token);
  } catch (e) {
    return jsonResponse({ error: `Canal criado mas falha ao salvar token: ${(e as Error).message}` }, 500);
  }
  await admin
    .from("brand_channels")
    .update({
      token_valid: true,
      token_last_validated_at: new Date().toISOString(),
      token_last_error: null,
    })
    .eq("id", created.id);

  return jsonResponse({
    ok: true,
    channel_id: created.id,
    phone_number: display,
    verified_name: info.data?.verified_name ?? null,
  });
});
