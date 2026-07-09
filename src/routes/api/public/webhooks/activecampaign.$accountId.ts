import { createFileRoute } from "@tanstack/react-router";
import {
  loadAccount, jsonOk, jsonErr,
  type NormalizedEvent,
} from "@/lib/integrations-webhook.server";
import { enqueueIntegrationEvent } from "@/lib/integrations-queue.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { withApiLogging } from "@/lib/api-logger.server";

const AC_EVENTS: Record<string, string> = {
  contact_tag_added: "tag_added",
  subscribe: "list_subscribed",
  contact_tag_removed: "tag_removed",
};

export const Route = createFileRoute("/api/public/webhooks/activecampaign/$accountId")({
  server: {
    handlers: {
      POST: async ({ request, params }) =>
        withApiLogging(request, async ({ setMeta }) => {
          const account = await loadAccount(params.accountId, "activecampaign");
          if (!account) {
            setMeta({ responseSummary: { error: "Account not found", platform: "activecampaign", account_id: params.accountId } });
            return jsonErr(404, "Account not found");
          }

          // ActiveCampaign envia form-urlencoded por padrão com chaves estilo PHP: contact[email], contact[phone], etc.
          const ct = request.headers.get("content-type") ?? "";
          const raw = await request.text();
          let payload: any;
          if (ct.includes("application/json")) {
            try { payload = JSON.parse(raw); } catch {
              setMeta({ requestBody: { raw: raw.slice(0, 500) }, responseSummary: { error: "Invalid JSON", platform: "activecampaign", account_id: params.accountId } });
              return jsonErr(400, "Invalid JSON");
            }
          } else {
            payload = {};
            for (const [k, v] of new URLSearchParams(raw).entries()) {
              const m = k.match(/^([^\[]+)\[([^\]]+)\](.*)$/);
              if (m) {
                const [, root, sub, rest] = m;
                payload[root] = payload[root] ?? {};
                if (rest) payload[root][sub + rest] = v;
                else payload[root][sub] = v;
              } else {
                payload[k] = v;
              }
            }
          }

          setMeta({ requestBody: payload });

          const evRaw = String(payload.type ?? payload.event ?? "").toLowerCase();
          const eventType = AC_EVENTS[evRaw];
          // Resolve brand to attach to log even on ignored events.
          const { data: linkRows } = await supabaseAdmin
            .from("integration_account_brands")
            .select("brand_id")
            .eq("account_id", account.id);
          const brandIds = (linkRows ?? []).map((r: any) => r.brand_id).filter(Boolean);
          if (brandIds.length > 0) setMeta({ brandIds });

          if (!eventType) {
            setMeta({ responseSummary: { ok: true, ignored: evRaw, platform: "activecampaign", account_id: params.accountId } });
            return jsonOk({ ok: true, ignored: evRaw });
          }

          const contact = (typeof payload.contact === "object" && payload.contact) ? payload.contact : payload;

          // Resolver tag/lista. ActiveCampaign manda formatos diferentes:
          //  - tag_id: "547" (ideal)
          //  - tag: { id: "547", name: "Foo" }
          //  - tag: "TesteMegaCRM" (apenas o nome) + list: "0"
          // Nunca usar `list` quando o evento é de tag (vem como "0" e estraga o match).
          let productExternalId: string | null = null;
          let tagName: string | null = null;

          if (eventType === "tag_added" || eventType === "tag_removed") {
            if (payload.tag_id != null && String(payload.tag_id) !== "" && String(payload.tag_id) !== "0") {
              productExternalId = String(payload.tag_id);
            } else if (payload.tag && typeof payload.tag === "object" && (payload.tag as any).id) {
              productExternalId = String((payload.tag as any).id);
              tagName = (payload.tag as any).name ?? null;
            } else if (typeof payload.tag === "string" && payload.tag.trim() !== "") {
              tagName = payload.tag.trim();
              const { data: prod } = await supabaseAdmin
                .from("integration_products")
                .select("external_id")
                .eq("account_id", account.id)
                .eq("type", "tag")
                .ilike("name", tagName!)
                .maybeSingle();
              if (prod?.external_id) productExternalId = String(prod.external_id);
            }
          } else if (eventType === "list_subscribed") {
            if (payload.list != null && String(payload.list) !== "" && String(payload.list) !== "0") {
              productExternalId = String(payload.list);
            }
          }

          if (tagName && !payload.tag_name) (payload as any).tag_name = tagName;

          const contactKey = String(payload.contact_id ?? contact.id ?? contact.email ?? "");
          const tagKey = productExternalId ?? tagName ?? "";
          const timeKey = String(payload.date_time ?? Date.now());
          const externalId =
            eventType === "tag_added" || eventType === "tag_removed"
              ? `${evRaw}-${contactKey}-${tagKey}-${timeKey}`
              : String(payload.contact_id ?? contact.id ?? `${evRaw}-${contact.email ?? ""}-${Date.now()}`);

          const acContactId = String(payload.contact_id ?? contact.id ?? "").trim() || null;
          const ev: NormalizedEvent = {
            eventType,
            externalId,
            productExternalId,
            contact: {
              phone: contact.phone ?? null,
              email: contact.email ?? null,
              name: [contact.first_name, contact.last_name].filter(Boolean).join(" ") || null,
              externalIds: { activecampaign: acContactId },
            },
            payload,
          };
          const out = await enqueueIntegrationEvent({ account, event: ev });
          const summary = {
            ok: true,
            queued: true,
            platform: "activecampaign",
            account_id: params.accountId,
            event_type: eventType,
            resolved_tag: productExternalId,
            tag_name: tagName,
            contact: { email: contact.email ?? null, phone: contact.phone ?? null },
            ...out,
          };
          setMeta({ responseSummary: summary, skipLog: true });
          return jsonOk({ ok: true, queued: true, resolved_tag: productExternalId, tag_name: tagName, ...out });
        }),
    },
  },
});
