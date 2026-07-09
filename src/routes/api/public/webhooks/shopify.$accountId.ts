import { createFileRoute } from "@tanstack/react-router";
import {
  loadAccount, recordAndDispatch, verifyHmacSha256, jsonOk, jsonErr,
  type NormalizedEvent,
} from "@/lib/integrations-webhook.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { withApiLogging } from "@/lib/api-logger.server";

const TOPIC_TO_EVENT: Record<string, string> = {
  "products/create": "product_created",
  "orders/paid": "order_paid",
  "orders/refunded": "order_refunded",
  "checkouts/create": "checkout_abandoned",
  "checkouts/update": "checkout_abandoned",
  "disputes/create": "chargeback_created",
};

export const Route = createFileRoute("/api/public/webhooks/shopify/$accountId")({
  server: {
    handlers: {
      POST: async ({ request, params }) =>
        withApiLogging(request, async ({ setMeta }) => {
          const account = await loadAccount(params.accountId, "shopify");
          if (!account) {
            setMeta({ responseSummary: { error: "Account not found", platform: "shopify", account_id: params.accountId } });
            return jsonErr(404, "Account not found");
          }

          const body = await request.text();
          const sig = request.headers.get("x-shopify-hmac-sha256");
          const platformSecret = ((account.credentials as any)?.webhook_signing_secret as string | undefined)?.trim();
          const signingSecret = platformSecret || account.webhook_secret;
          if (!platformSecret) {
            setMeta({ responseSummary: { error: "Shopify webhook signing secret not configured in MegaCRM credentials", platform: "shopify", account_id: params.accountId, hint: "Edite a conta em /admin/integracoes e cole o 'Webhook signing secret' do Shopify Admin → Settings → Notifications → Webhooks." } });
            return jsonErr(401, "Shopify webhook signing secret not configured");
          }
          if (!verifyHmacSha256(signingSecret, body, sig, "base64")) {
            setMeta({ responseSummary: { error: "Invalid signature", platform: "shopify", account_id: params.accountId, hint: "O 'Webhook signing secret' salvo no MegaCRM não confere com o do Shopify Admin. Copie novamente em Settings → Notifications → Webhooks." } });
            return jsonErr(401, "Invalid signature");
          }

          const topic = (request.headers.get("x-shopify-topic") ?? "").toLowerCase();
          const eventType = TOPIC_TO_EVENT[topic];

          let payload: any;
          try { payload = JSON.parse(body); } catch {
            setMeta({ requestBody: { raw: body.slice(0, 500) }, responseSummary: { error: "Invalid JSON", platform: "shopify", account_id: params.accountId } });
            return jsonErr(400, "Invalid JSON");
          }
          setMeta({ requestBody: payload });

          const { data: linkRows } = await supabaseAdmin
            .from("integration_account_brands")
            .select("brand_id")
            .eq("account_id", account.id);
          const brandIds = (linkRows ?? []).map((r: any) => r.brand_id).filter(Boolean);
          if (brandIds.length > 0) setMeta({ brandIds });

          if (!eventType) {
            setMeta({ responseSummary: { ok: true, ignored: topic, platform: "shopify", account_id: params.accountId } });
            return jsonOk({ ok: true, ignored: topic });
          }

          // products/create → auto-cadastra o produto na tabela integration_products.
          if (eventType === "product_created") {
            const productId = payload?.id ? String(payload.id) : null;
            if (!productId) {
              setMeta({ responseSummary: { error: "Missing product id", platform: "shopify", account_id: params.accountId } });
              return jsonErr(400, "Missing product id");
            }
            const { error: upErr } = await supabaseAdmin
              .from("integration_products")
              .upsert(
                {
                  account_id: account.id,
                  type: "product",
                  external_id: productId,
                  name: payload?.title ?? `Produto ${productId}`,
                  last_synced_at: new Date().toISOString(),
                  metadata: {
                    source: "webhook",
                    handle: payload?.handle ?? null,
                    status: payload?.status ?? null,
                    vendor: payload?.vendor ?? null,
                    product_type: payload?.product_type ?? null,
                  },
                },
                { onConflict: "account_id,type,external_id" },
              );
            if (upErr) {
              setMeta({ responseSummary: { error: upErr.message, platform: "shopify", account_id: params.accountId } });
              return jsonErr(500, upErr.message);
            }
            await supabaseAdmin
              .from("integration_accounts")
              .update({ last_event_at: new Date().toISOString() })
              .eq("id", account.id);
            setMeta({ responseSummary: { ok: true, platform: "shopify", account_id: params.accountId, event_type: eventType, product_id: productId } });
            return jsonOk({ ok: true, product_id: productId });
          }

          const customer = payload.customer ?? payload;
          const ev: NormalizedEvent = {
            eventType,
            externalId: String(payload.id ?? payload.token ?? ""),
            productExternalId: payload.line_items?.[0]?.product_id ? String(payload.line_items[0].product_id) : null,
            contact: {
              phone: customer?.phone ?? payload.phone ?? payload.shipping_address?.phone,
              email: customer?.email ?? payload.email,
              name: [customer?.first_name, customer?.last_name].filter(Boolean).join(" ") || null,
            },
            payload,
          };
          const out = await recordAndDispatch(account, ev);
          setMeta({
            responseSummary: { ok: true, platform: "shopify", account_id: params.accountId, event_type: eventType, ...out },
            skipLog: (out.started ?? 0) === 0,
          });
          return jsonOk({ ok: true, ...out });
        }),
    },
  },
});
