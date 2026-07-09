// validate-brand-token: valida token Meta de um CANAL (ou todos, modo cron)
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient, requireRole } from "../_shared/supabase.ts";
import { getChannelToken, setChannelToken } from "../_shared/vault.ts";
import { validateToken } from "../_shared/meta.ts";
import { logError, translateMetaError } from "../_shared/errors.ts";

async function validateOne(channelId: string, overrideToken?: string) {
  const admin = getAdminClient();
  const { data: ch } = await admin
    .from("brand_channels")
    .select("id, phone_number_id, name, brand_id")
    .eq("id", channelId)
    .single();
  if (!ch?.phone_number_id) {
    return { ok: false, code: "NO_PHONE_NUMBER_ID", message: "Canal sem phone_number_id." };
  }

  let token: string;
  try {
    token = overrideToken ?? (await getChannelToken(channelId));
  } catch {
    await admin.from("brand_channels")
      .update({
        token_valid: false,
        token_last_validated_at: new Date().toISOString(),
        token_last_error: "Token não cadastrado.",
      })
      .eq("id", channelId);
    return { ok: false, code: "NO_TOKEN", message: "Token não cadastrado." };
  }

  const res = await validateToken(token, ch.phone_number_id);
  if (!res.ok) {
    const code = String(res.error?.code ?? "META_ERR");
    const messagePt = translateMetaError(code, res.error?.message);
    await admin.from("brand_channels")
      .update({
        token_valid: false,
        token_last_validated_at: new Date().toISOString(),
        token_last_error: messagePt,
      })
      .eq("id", channelId);
    await logError({
      severity: "critical",
      category: "auth",
      code: "CHANNEL_TOKEN_INVALID",
      messagePt: `Token do canal "${ch.name}" inválido: ${messagePt}`,
      technicalMessage: res.error?.message ?? "",
      brandId: ch.brand_id,
      payload: res.error,
    });
    return { ok: false, code, message: messagePt };
  }

  if (overrideToken) await setChannelToken(channelId, overrideToken);
  await admin.from("brand_channels")
    .update({
      token_valid: true,
      token_last_validated_at: new Date().toISOString(),
      token_last_error: null,
    })
    .eq("id", channelId);
  return { ok: true, info: res.data };
}

Deno.serve(async (req) => {
  const pf = handlePreflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const body = await req.json().catch(() => ({}));
  const isCron = body?.cron === true;

  if (isCron) {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.includes(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "____")) {
      return jsonResponse({ error: "forbidden" }, 403);
    }
    const admin = getAdminClient();
    const { data: channels } = await admin.from("brand_channels").select("id").eq("active", true);
    const results: Record<string, unknown> = {};
    for (const c of channels ?? []) results[c.id] = await validateOne(c.id);
    return jsonResponse({ ran: channels?.length ?? 0, results });
  }

  try {
    await requireRole(req, ["admin"]);
  } catch (e) {
    if (e instanceof Response) return e;
    return jsonResponse({ error: "forbidden" }, 403);
  }

  const { channel_id, token } = body as { channel_id: string; token?: string };
  if (!channel_id) return jsonResponse({ error: "channel_id obrigatório" }, 400);
  const result = await validateOne(channel_id, token);
  return jsonResponse(result, result.ok ? 200 : 400);
});
