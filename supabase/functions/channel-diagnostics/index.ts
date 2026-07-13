// channel-diagnostics: retorna estado completo de um canal para a UI de diagnóstico
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient, requireRole } from "../_shared/supabase.ts";
import { getChannelToken } from "../_shared/vault.ts";


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

  const { channel_id } = await req.json().catch(() => ({}));
  if (!channel_id) return jsonResponse({ error: "channel_id obrigatório" }, 400);

  const admin = getAdminClient();
  const { data: ch, error } = await admin
    .from("brand_channels")
    .select("id, name, brand_id, phone_number, phone_number_id, waba_id, app_id, token_valid, token_last_validated_at, token_last_error, last_webhook_at, templates_last_sync_at, templates_last_error, webhook_verify_token, registered_at, registration_last_error, use_global_webhook")
    .eq("id", channel_id)
    .maybeSingle();
  if (error || !ch) return jsonResponse({ error: "Canal não encontrado." }, 404);

  const [{ count: webhookCount }, { count: templatesCount }, { count: agentsCount }, { data: secret }] = await Promise.all([
    admin.from("webhook_events_raw").select("id", { count: "exact", head: true }).eq("brand_id", (ch as any).brand_id),
    admin.from("whatsapp_templates").select("id", { count: "exact", head: true }).eq("channel_id", channel_id),
    admin.from("channel_agents").select("user_id", { count: "exact", head: true }).eq("channel_id", channel_id),
    admin.from("channel_secrets").select("channel_id").eq("channel_id", channel_id).maybeSingle(),
  ]);

  // Público (para colar na Meta), não o interno usado nas chamadas function-to-function.
  const supabaseUrl = Deno.env.get("SUPABASE_PUBLIC_URL") ?? Deno.env.get("SUPABASE_URL") ?? "";
  const dedicatedWebhookUrl = `${supabaseUrl}/functions/v1/webhook-receiver?ch=${channel_id}`;
  const globalWebhookUrl = `${supabaseUrl}/functions/v1/webhook-receiver`;
  const globalVerifyToken = Deno.env.get("META_GLOBAL_VERIFY_TOKEN") ?? "";

  const useGlobal = !!(ch as any).use_global_webhook;

  return jsonResponse({
    channel: ch,
    webhook_url: useGlobal ? globalWebhookUrl : dedicatedWebhookUrl,
    webhook_verify_token: useGlobal ? globalVerifyToken : (ch as any).webhook_verify_token,
    use_global_webhook: useGlobal,
    dedicated_webhook_url: dedicatedWebhookUrl,
    dedicated_verify_token: (ch as any).webhook_verify_token,
    global_webhook_url: globalWebhookUrl,
    global_verify_token: globalVerifyToken,
    counts: {
      webhooks_received: webhookCount ?? 0,
      templates: templatesCount ?? 0,
      agents: agentsCount ?? 0,
    },
    has_token: !!secret,
  });
});
