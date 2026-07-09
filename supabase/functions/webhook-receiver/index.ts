// webhook-receiver: recebe webhooks da Meta
// Dois modos:
//  1) Por canal:  /functions/v1/webhook-receiver?ch=<channel_id>
//     -> verify_token específico do canal (brand_channels.webhook_verify_token)
//  2) Multi-tenant (allowlist): /functions/v1/webhook-receiver  (sem ?ch=)
//     -> verify_token global (env META_GLOBAL_VERIFY_TOKEN)
//     -> roteia por metadata.phone_number_id
//     -> só aceita brands na ALLOWED_BRAND_IDS
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient } from "../_shared/supabase.ts";
import { logError } from "../_shared/errors.ts";
import { logWhatsAppInbound } from "../_shared/wa-log.ts";

// Modo multi-tenant: a aceitação é feita por canal via
// brand_channels.use_global_webhook = true (em vez de allowlist hardcoded).


function summarizeMetaPayload(payload: any): Record<string, unknown> {
  try {
    const entry = Array.isArray(payload?.entry) ? payload.entry : [];
    let messages = 0;
    let statuses = 0;
    const events: string[] = [];
    for (const e of entry) {
      const changes = Array.isArray(e?.changes) ? e.changes : [];
      for (const c of changes) {
        if (c?.field) events.push(String(c.field));
        const v = c?.value ?? {};
        if (Array.isArray(v?.messages)) messages += v.messages.length;
        if (Array.isArray(v?.statuses)) statuses += v.statuses.length;
      }
    }
    const out: Record<string, unknown> = { object: payload?.object ?? null };
    if (messages > 0) out.messages_received = messages;
    if (statuses > 0) out.statuses_received = statuses;
    if (events.length) out.event_type = Array.from(new Set(events)).join(",");
    return out;
  } catch {
    return {};
  }
}

function extractPhoneNumberId(payload: any): string | null {
  try {
    const entry = Array.isArray(payload?.entry) ? payload.entry : [];
    for (const e of entry) {
      const changes = Array.isArray(e?.changes) ? e.changes : [];
      for (const c of changes) {
        const pid = c?.value?.metadata?.phone_number_id;
        if (pid) return String(pid);
      }
    }
  } catch {}
  return null;
}

Deno.serve(async (req) => {
  const pf = handlePreflight(req);
  if (pf) return pf;

  const startedAt = Date.now();
  const url = new URL(req.url);
  const channelIdParam = url.searchParams.get("ch");
  const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("cf-connecting-ip") ?? null;
  const userAgent = req.headers.get("user-agent") ?? null;

  const admin = getAdminClient();

  // =========================================================================
  // MODO 1: por canal (?ch=)
  // =========================================================================
  if (channelIdParam) {
    const { data: ch } = await admin
      .from("brand_channels")
      .select("id, brand_id, webhook_verify_token")
      .eq("id", channelIdParam)
      .maybeSingle();
    if (!ch) return new Response("channel not found", { status: 404 });

    const brandId = (ch as any).brand_id as string;
    const channelId = (ch as any).id as string;

    if (req.method === "GET") {
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge") ?? "";
      const ok = mode === "subscribe" && token === (ch as any).webhook_verify_token;
      const status = ok ? 200 : 403;
      const body = ok ? challenge : "forbidden";
      await logWhatsAppInbound({
        brandId, channelId, method: "GET", statusCode: status,
        durationMs: Date.now() - startedAt,
        payload: { hub_mode: mode, hub_challenge: challenge, has_token: !!token },
        summary: { verified: ok, mode: "per_channel" },
        ip, userAgent,
      });
      return new Response(body, { status });
    }

    if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

    return await handlePost({
      req, admin, brandId, channelId, startedAt, ip, userAgent, mode: "per_channel",
    });
  }

  // =========================================================================
  // MODO 2: multi-tenant (sem ?ch=)
  // =========================================================================

  // GET = handshake global com verify_token global
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge") ?? "";
    const globalToken = Deno.env.get("META_GLOBAL_VERIFY_TOKEN") ?? "";
    const ok = !!globalToken && mode === "subscribe" && token === globalToken;
    const status = ok ? 200 : 403;
    const body = ok ? challenge : "forbidden";
    await logWhatsAppInbound({
      brandId: null,
      channelId: null,
      method: "GET",
      statusCode: status,
      durationMs: Date.now() - startedAt,
      payload: { hub_mode: mode, hub_challenge: challenge, has_token: !!token },
      summary: { verified: ok, mode: "multi_tenant" },
      ip, userAgent,
    });
    return new Response(body, { status });
  }

  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  // POST multi-tenant: identifica canal por phone_number_id e checa allowlist
  const signature = req.headers.get("x-hub-signature-256") ?? null;
  const bodyText = await req.text();
  let payload: any;
  try { payload = JSON.parse(bodyText); } catch {
    await logWhatsAppInbound({
      brandId: null, channelId: null, method: "POST", statusCode: 400,
      durationMs: Date.now() - startedAt,
      payload: { raw: bodyText.slice(0, 2000) },
      summary: { error: "invalid_json", mode: "multi_tenant" },
      ip, userAgent,
    });
    return jsonResponse({ error: "invalid json" }, 400);
  }

  const phoneNumberId = extractPhoneNumberId(payload);
  let resolvedChannelId: string | null = null;
  let resolvedBrandId: string | null = null;
  let resolvedUseGlobal = false;

  if (phoneNumberId) {
    const { data: ch } = await admin
      .from("brand_channels")
      .select("id, brand_id, use_global_webhook")
      .eq("phone_number_id", phoneNumberId)
      .maybeSingle();
    if (ch) {
      resolvedChannelId = (ch as any).id;
      resolvedBrandId = (ch as any).brand_id;
      resolvedUseGlobal = !!(ch as any).use_global_webhook;
    }
  }

  const summary: Record<string, unknown> = {
    ...summarizeMetaPayload(payload),
    mode: "multi_tenant",
    phone_number_id: phoneNumberId,
  };

  // Sem canal correspondente -> 200 vazio (Meta exige 200), só registra log.
  if (!resolvedChannelId || !resolvedBrandId) {
    summary.error = phoneNumberId ? "unknown_phone_number_id" : "missing_phone_number_id";
    await logWhatsAppInbound({
      brandId: resolvedBrandId,
      channelId: resolvedChannelId,
      method: "POST", statusCode: 200,
      durationMs: Date.now() - startedAt,
      payload, summary, ip, userAgent,
    });
    return jsonResponse({ received: false, reason: summary.error });
  }

  // Canal não optou pelo webhook global -> rejeita silenciosamente.
  if (!resolvedUseGlobal) {
    summary.error = "channel_not_opted_in_global";
    await logWhatsAppInbound({
      brandId: resolvedBrandId,
      channelId: resolvedChannelId,
      method: "POST", statusCode: 200,
      durationMs: Date.now() - startedAt,
      payload, summary, ip, userAgent,
    });
    return jsonResponse({ received: false, reason: "channel_not_opted_in_global" });
  }


  return await processPayload({
    admin,
    brandId: resolvedBrandId,
    channelId: resolvedChannelId,
    payload,
    signature,
    startedAt,
    ip, userAgent,
    extraSummary: summary,
  });
});

// -------------------- helpers --------------------

async function handlePost(opts: {
  req: Request;
  admin: ReturnType<typeof getAdminClient>;
  brandId: string;
  channelId: string;
  startedAt: number;
  ip: string | null;
  userAgent: string | null;
  mode: "per_channel" | "multi_tenant";
}): Promise<Response> {
  const { req, admin, brandId, channelId, startedAt, ip, userAgent, mode } = opts;
  const signature = req.headers.get("x-hub-signature-256") ?? null;
  const bodyText = await req.text();
  let payload: any;
  try { payload = JSON.parse(bodyText); } catch {
    await logWhatsAppInbound({
      brandId, channelId, method: "POST", statusCode: 400,
      durationMs: Date.now() - startedAt,
      payload: { raw: bodyText.slice(0, 2000) },
      summary: { error: "invalid_json", mode },
      ip, userAgent,
    });
    return jsonResponse({ error: "invalid json" }, 400);
  }

  return await processPayload({
    admin, brandId, channelId, payload, signature, startedAt, ip, userAgent,
    extraSummary: { ...summarizeMetaPayload(payload), mode },
  });
}

async function processPayload(opts: {
  admin: ReturnType<typeof getAdminClient>;
  brandId: string;
  channelId: string;
  payload: any;
  signature: string | null;
  startedAt: number;
  ip: string | null;
  userAgent: string | null;
  extraSummary: Record<string, unknown>;
}): Promise<Response> {
  const { admin, brandId, channelId, payload, signature, startedAt, ip, userAgent, extraSummary } = opts;
  let statusCode = 200;
  const summary: Record<string, unknown> = { ...extraSummary };

  try {
    const { data: inserted, error } = await admin
      .from("webhook_events_raw")
      .insert({ brand_id: brandId, payload, signature })
      .select("id")
      .single();
    if (error) throw error;

    summary.event_id = inserted.id;

    // Throttle: só atualiza last_webhook_at se a última atualização foi há
    // mais de 60s. Reduz drasticamente a carga de UPDATEs (271k/dia → ~1/min/canal).
    await admin.from("brand_channels")
      .update({ last_webhook_at: new Date().toISOString() })
      .eq("id", channelId)
      .or(`last_webhook_at.is.null,last_webhook_at.lt.${new Date(Date.now() - 60_000).toISOString()}`);

    const fnUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/process-webhook-event`;
    fetch(fnUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({ event_id: inserted.id }),
    }).catch(() => {});

    return jsonResponse({ received: true });
  } catch (e) {
    summary.error = String((e as Error).message ?? e);
    await logError({
      severity: "error",
      category: "webhook",
      code: "WEBHOOK_INSERT_FAILED",
      messagePt: "Falha ao registrar evento recebido da Meta.",
      technicalMessage: String((e as Error).message ?? e),
      brandId,
      payload: { signature },
    });
    return jsonResponse({ received: false });
  } finally {
    await logWhatsAppInbound({
      brandId, channelId,
      method: "POST", statusCode,
      durationMs: Date.now() - startedAt,
      payload, summary, ip, userAgent,
    });
  }
}
