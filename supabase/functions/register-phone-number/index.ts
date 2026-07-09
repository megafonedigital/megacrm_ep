// register-phone-number: registra um número na Meta Cloud API (POST /{phone-number-id}/register)
// https://developers.facebook.com/docs/whatsapp/cloud-api/reference/registration
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient, requireRole } from "../_shared/supabase.ts";
import { getChannelToken } from "../_shared/vault.ts";
import { registerPhoneNumber } from "../_shared/meta.ts";
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
  const { channel_id, pin, data_localization_region } = body as {
    channel_id?: string;
    pin?: string;
    data_localization_region?: string;
  };

  if (!channel_id) return jsonResponse({ error: "channel_id obrigatório" }, 400);
  if (!pin || !/^\d{6}$/.test(pin)) {
    return jsonResponse({ error: "PIN deve ter exatamente 6 dígitos." }, 400);
  }

  const admin = getAdminClient();
  const { data: ch } = await admin
    .from("brand_channels")
    .select("id, name, brand_id, phone_number_id")
    .eq("id", channel_id)
    .maybeSingle();

  if (!ch) return jsonResponse({ error: "Canal não encontrado." }, 404);
  if (!ch.phone_number_id) {
    return jsonResponse({ error: "Canal sem phone_number_id configurado." }, 400);
  }

  let token: string;
  try {
    token = await getChannelToken(channel_id);
  } catch {
    return jsonResponse({ error: "Token do canal não cadastrado." }, 400);
  }

  const res = await registerPhoneNumber({
    token,
    phoneNumberId: ch.phone_number_id,
    pin,
    dataLocalizationRegion: data_localization_region,
  });

  if (!res.ok) {
    const code = String(res.error?.code ?? "META_ERR");
    const messagePt = translateMetaError(code, res.error?.message);
    await admin
      .from("brand_channels")
      .update({ registration_last_error: messagePt })
      .eq("id", channel_id);
    await logError({
      severity: "warning",
      category: "auth",
      code: "CHANNEL_REGISTER_FAILED",
      messagePt: `Falha ao registrar número do canal "${ch.name}": ${messagePt}`,
      technicalMessage: res.error?.message ?? "",
      brandId: ch.brand_id,
      payload: res.error,
    });
    return jsonResponse({ ok: false, code, message: messagePt }, 400);
  }

  await admin
    .from("brand_channels")
    .update({
      registered_at: new Date().toISOString(),
      registration_last_error: null,
    })
    .eq("id", channel_id);

  return jsonResponse({ ok: true });
});
