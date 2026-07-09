import { createFileRoute } from "@tanstack/react-router";
import {
  loadAccount, jsonOk, jsonErr,
  type NormalizedEvent,
} from "@/lib/integrations-webhook.server";
import { enqueueIntegrationEvent } from "@/lib/integrations-queue.server";
import { withApiLogging } from "@/lib/api-logger.server";

const HOTMART_EVENTS: Record<string, string> = {
  // Compras
  PURCHASE_APPROVED: "purchase_approved",
  PURCHASE_COMPLETE: "purchase_complete",
  PURCHASE_CANCELED: "purchase_canceled",
  PURCHASE_REFUNDED: "purchase_refunded",
  PURCHASE_CHARGEBACK: "purchase_chargeback",
  PURCHASE_BILLET_PRINTED: "purchase_billet_printed",
  PURCHASE_PROTEST: "purchase_protest",
  PURCHASE_EXPIRED: "purchase_expired",
  PURCHASE_DELAYED: "purchase_delayed",
  PURCHASE_OUT_OF_SHOPPING_CART: "cart_abandoned",
  CART_ABANDONED: "cart_abandoned",
  // Assinaturas
  SUBSCRIPTION_CANCELLATION: "subscription_cancellation",
  SWITCH_PLAN: "switch_plan",
  UPDATE_SUBSCRIPTION_CHARGE_DATE: "update_subscription_charge_date",
  // Club
  CLUB_FIRST_ACCESS: "club_first_access",
  CLUB_MODULE_COMPLETED: "club_module_completed",
};

export const Route = createFileRoute("/api/public/webhooks/hotmart/$accountId")({
  server: {
    handlers: {
      POST: async ({ request, params }) =>
        withApiLogging(request, async ({ setMeta }) => {
          const account = await loadAccount(params.accountId, "hotmart");
          if (!account) {
            setMeta({ responseSummary: { error: "Account not found", platform: "hotmart", account_id: params.accountId } });
            return jsonErr(404, "Account not found");
          }

          const body = await request.text();
          let payload: any;
          try { payload = JSON.parse(body); } catch {
            setMeta({ requestBody: { raw: body.slice(0, 500) }, responseSummary: { error: "Invalid JSON", platform: "hotmart", account_id: params.accountId } });
            return jsonErr(400, "Invalid JSON");
          }
          setMeta({ requestBody: payload });

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          // Conta compartilhada entre workspaces (ex.: mesma conta Hotmart usada por
          // Débora, Elza e Mulats) precisa gerar um log por workspace, senão o log
          // some da tela de todos menos um. Fan-out no logger.
          const { data: linkRows } = await supabaseAdmin
            .from("integration_account_brands")
            .select("brand_id")
            .eq("account_id", account.id);
          const brandIds = (linkRows ?? []).map((r: any) => r.brand_id).filter(Boolean);
          if (brandIds.length > 0) setMeta({ brandIds });

          const hottok = (account.credentials as any)?.hottok;
          const incomingHottok =
            request.headers.get("x-hotmart-hottok") ??
            payload.hottok ?? payload.data?.hottok ?? null;
          if (hottok && incomingHottok !== hottok) {
            setMeta({ responseSummary: { error: "Invalid hottok", platform: "hotmart", account_id: params.accountId } });
            return jsonErr(401, "Invalid hottok");
          }

          const evRaw = (payload.event ?? payload.action ?? "").toUpperCase();
          const eventType = HOTMART_EVENTS[evRaw];
          if (!eventType) {
            setMeta({ responseSummary: { ok: true, ignored: evRaw, platform: "hotmart", account_id: params.accountId }, forceLog: true });
            return jsonOk({ ok: true, ignored: evRaw });
          }

          const data = payload.data ?? payload;
          const buyer = data.buyer ?? data.subscriber ?? data.customer ?? data.user ?? {};
          const product = data.product ?? data.subscription?.plan?.product ?? {};
          const subscriptionPlan = data.subscription?.plan ?? data.plan ?? {};

          const productExternalId =
            (product.id ? String(product.id) : null) ??
            product.ucode ??
            (subscriptionPlan.id ? String(subscriptionPlan.id) : null) ??
            null;

          const rawExternalId = data.purchase?.transaction ?? data.transaction ?? data.id ?? null;
          let externalId: string | null = rawExternalId ? String(rawExternalId) : null;
          // Hotmart não envia transaction/id em CART_ABANDONED. Sem fallback,
          // todos os abandonos cairiam no índice unique (account_id, external_id)
          // como duplicate. Derivamos um id estável por (email + timestamp do carrinho)
          // para preservar dedup legítimo sem descartar carrinhos diferentes.
          if (!externalId && eventType === "cart_abandoned") {
            const email = String(buyer.email ?? "").toLowerCase().trim();
            const ts = data.creation_date ?? data.checkout_date ?? payload.creation_date ?? "";
            externalId = email && ts ? `cart:${email}:${ts}` : null;
          }

          const ev: NormalizedEvent = {
            eventType,
            externalId,
            productExternalId,
            contact: {
              phone: buyer.checkout_phone ?? buyer.phone ?? buyer.document_phone ?? null,
              email: buyer.email ?? null,
              name: buyer.name ?? null,
            },
            payload,
          };
          const out = await enqueueIntegrationEvent({ account, event: ev });
          setMeta({
            responseSummary: {
              ok: true,
              queued: out.enqueued,
              platform: "hotmart",
              account_id: params.accountId,
              event_type: eventType,
              external_id: externalId,
              product_external_id: productExternalId,
              enqueue_status: out.status,
              queue_id: out.id ?? null,
              ...out,
            },
            forceLog: true,
          });
          return jsonOk({ ok: true, queued: out.enqueued, ...out });
        }),
    },
  },
});
