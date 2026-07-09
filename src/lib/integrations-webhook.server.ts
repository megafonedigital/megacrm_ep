// Lógica comum de processamento de webhooks de integração.
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { dispatchIntegrationEvent } from "./integrations-dispatch.server";
import type { IntegrationPlatform } from "./integrations-platforms";

export interface NormalizedEvent {
  eventType: string;
  externalId?: string | null;
  productExternalId?: string | null;
  contact: {
    phone?: string | null;
    email?: string | null;
    name?: string | null;
    externalIds?: { activecampaign?: string | null };
  };
  payload: Record<string, unknown>;
}

export async function loadAccount(accountId: string, platform: IntegrationPlatform) {
  const { data, error } = await supabaseAdmin
    .from("integration_accounts")
    .select("id, platform, status, credentials, webhook_secret, queue_paused, rate_limit_per_minute, rate_limit_burst")
    .eq("id", accountId)
    .eq("platform", platform)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

export async function getBrandsForAccount(accountId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("integration_account_brands")
    .select("brand_id")
    .eq("account_id", accountId);
  return (data ?? []).map((r) => r.brand_id);
}

export function verifyHmacSha256(secret: string, body: string, signature: string | null, encoding: "hex" | "base64" = "hex"): boolean {
  if (!signature) return false;
  try {
    const expected = createHmac("sha256", secret).update(body).digest(encoding);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function recordAndDispatch(
  account: { id: string; platform: IntegrationPlatform },
  ev: NormalizedEvent,
): Promise<{ stored: number; started: number }> {
  const brands = await getBrandsForAccount(account.id);
  let stored = 0;
  let totalStarted = 0;

  for (const brandId of brands) {
    // Match-first: dispatch decide se vale a pena criar contato/conversa
    const result = await dispatchIntegrationEvent({
      accountId: account.id,
      brandId,
      platform: account.platform,
      eventType: ev.eventType,
      contact: ev.contact,
      productExternalId: ev.productExternalId ?? null,
      payload: ev.payload,
    });

    const eventRow: any = {
      account_id: account.id,
      brand_id: brandId,
      contact_id: result.contactId,
      event_type: ev.eventType,
      external_id: ev.externalId ?? null,
      product_external_id: ev.productExternalId ?? null,
      payload: ev.payload,
      processed_at: new Date().toISOString(),
      automations_started: result.started,
      error: result.diagnostic ?? null,
    };
    const { error } = await supabaseAdmin.from("integration_events").insert(eventRow);
    if (error) {
      if (!error.message.toLowerCase().includes("duplicate")) {
        console.error("[integrations-webhook] insert event:", error.message);
      }
      continue;
    }
    stored++;
    totalStarted += result.started;
  }

  await supabaseAdmin
    .from("integration_accounts")
    .update({ last_event_at: new Date().toISOString() })
    .eq("id", account.id);

  return { stored, started: totalStarted };
}

export function jsonOk(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function jsonErr(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status, headers: { "Content-Type": "application/json" } });
}
