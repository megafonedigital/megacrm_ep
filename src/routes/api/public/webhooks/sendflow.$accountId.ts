import { createFileRoute } from "@tanstack/react-router";
import {
  loadAccount, verifyHmacSha256, jsonOk, jsonErr,
  type NormalizedEvent,
} from "@/lib/integrations-webhook.server";
import { enqueueIntegrationEvent } from "@/lib/integrations-queue.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { withApiLogging } from "@/lib/api-logger.server";

export const Route = createFileRoute("/api/public/webhooks/sendflow/$accountId")({
  server: {
    handlers: {
      POST: async ({ request, params }) =>
        withApiLogging(request, async ({ setMeta }) => {
          const account = await loadAccount(params.accountId, "sendflow");
          if (!account) {
            setMeta({ responseSummary: { error: "Account not found", platform: "sendflow", account_id: params.accountId } });
            return jsonErr(404, "Account not found");
          }

          const body = await request.text();
          const sig =
            request.headers.get("x-sendflow-signature") ??
            request.headers.get("x-signature");
          if (sig && !verifyHmacSha256(account.webhook_secret, body, sig, "hex")) {
            setMeta({ responseSummary: { error: "Invalid signature", platform: "sendflow", account_id: params.accountId } });
            return jsonErr(401, "Invalid signature");
          }

          let payload: any;
          try { payload = JSON.parse(body); } catch {
            setMeta({ requestBody: { raw: body.slice(0, 500) }, responseSummary: { error: "Invalid JSON", platform: "sendflow", account_id: params.accountId } });
            return jsonErr(400, "Invalid JSON");
          }
          setMeta({ requestBody: payload });

          const { data: linkRows } = await supabaseAdmin
            .from("integration_account_brands")
            .select("brand_id")
            .eq("account_id", account.id);
          const brandIds = (linkRows ?? []).map((r: any) => r.brand_id).filter(Boolean);
          if (brandIds.length > 0) setMeta({ brandIds });

          const evRaw = String(payload.event ?? payload.type ?? "").toLowerCase();
          const eventType =
            /(added|join)/.test(evRaw) ? "group_joined" :
            /(removed|leave|left|kicked|exit)/.test(evRaw) ? "group_left" :
            null;
          if (!eventType) {
            setMeta({ responseSummary: { ok: true, ignored: evRaw, platform: "sendflow", account_id: params.accountId } });
            return jsonOk({ ok: true, ignored: evRaw });
          }

          const data = (payload.data ?? {}) as any;
          const member = (data.member ?? payload.member ?? payload.contact ?? {}) as any;
          const releaseId =
            data.groupId ?? data.groupJid ?? data.campaignId ??
            payload.release_id ?? payload.releaseId ?? payload.campaign_id ??
            payload.campaignId ?? payload.group_id ?? payload.groupId ??
            payload.release?.id ?? payload.campaign?.id ?? null;
          const phone =
            data.number ?? data.phone ?? data.whatsapp ??
            member.phone ?? member.whatsapp ?? payload.number ?? null;
          const ev: NormalizedEvent = {
            eventType,
            externalId: String(payload.id ?? `${releaseId ?? ""}-${phone ?? ""}-${Date.now()}`),
            productExternalId: releaseId ? String(releaseId) : null,
            contact: {
              phone,
              email: data.email ?? member.email ?? null,
              name: data.name ?? data.contactName ?? member.name ?? null,
            },
            payload,
          };
          const sigHeader = request.headers.get("x-sendflow-signature") ?? request.headers.get("x-signature");
          const out = await enqueueIntegrationEvent({ account, event: ev, signatureHeader: sigHeader });
          setMeta({
            responseSummary: { ok: true, queued: true, platform: "sendflow", account_id: params.accountId, event_type: eventType, ...out },
            skipLog: true,
          });
          return jsonOk({ ok: true, queued: true, ...out });
        }),
    },
  },
});
