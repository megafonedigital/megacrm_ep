// Dispara automações configuradas para reagir a um evento de integração.
// Match-first: só resolve/cria contato e conversa quando há automação correspondente.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolveOrCreateContact } from "./integrations-resolve-contact.server";
import type { IntegrationPlatform } from "./integrations-platforms";

export interface DispatchInput {
  accountId: string;
  brandId: string;
  platform: IntegrationPlatform;
  eventType: string;
  contact: {
    phone?: string | null;
    email?: string | null;
    name?: string | null;
    externalIds?: { activecampaign?: string | null };
  };
  productExternalId?: string | null;
  payload: Record<string, unknown>;
}

export interface DispatchResult {
  started: number;
  diagnostic: string | null;
  contactId: string | null;
}

export async function dispatchIntegrationEvent(input: DispatchInput): Promise<DispatchResult> {
  // 1. Match-first: buscar automações ativas para esta plataforma + brand
  const { data: autos } = await supabaseAdmin
    .from("automations")
    .select("id, name, trigger_config")
    .eq("brand_id", input.brandId)
    .eq("status", "active")
    .eq("trigger_type", input.platform);

  if (!autos?.length) {
    return { started: 0, contactId: null, diagnostic: `Nenhuma automação ativa com gatilho ${input.platform} neste Expert.` };
  }

  const reasons: string[] = [];
  const matching = autos.filter((a) => {
    const cfg = (a.trigger_config as any) ?? {};
    if (cfg.account_id !== input.accountId) {
      reasons.push(`"${a.name}": conta diferente`);
      return false;
    }
    const cfgEvents: string[] = Array.isArray(cfg.events)
      ? cfg.events.filter(Boolean)
      : (cfg.event ? [cfg.event] : []);
    if (cfgEvents.length === 0 || !cfgEvents.includes(input.eventType)) {
      reasons.push(`"${a.name}": eventos esperados [${cfgEvents.join(", ") || "—"}] ≠ recebido "${input.eventType}"`);
      return false;
    }
    const cfgProductIds: string[] = Array.isArray(cfg.product_ids) && cfg.product_ids.length
      ? cfg.product_ids.map((x: any) => String(x))
      : (cfg.product_id ? [String(cfg.product_id)] : []);
    if (cfgProductIds.length && !cfgProductIds.includes(String(input.productExternalId ?? ""))) {
      reasons.push(`"${a.name}": tag/produto esperado [${cfgProductIds.join(", ")}] ≠ recebido "${input.productExternalId ?? "—"}"`);
      return false;
    }
    return true;
  });

  if (!matching.length) {
    return {
      started: 0,
      contactId: null,
      diagnostic: `Nenhuma automação correspondeu ao evento. ${reasons.join(" | ")}`,
    };
  }

  // 2. Há match — agora sim resolver/criar contato
  const contactId = await resolveOrCreateContact(input.brandId, input.contact);
  if (!contactId) {
    return {
      started: 0,
      contactId: null,
      diagnostic: "Contato não pôde ser resolvido (telefone/email ausentes ou inválidos no payload).",
    };
  }

  // 3. Buscar/criar conversa
  let { data: conv } = await supabaseAdmin
    .from("conversations")
    .select("id")
    .eq("brand_id", input.brandId)
    .eq("contact_id", contactId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (!conv) {
    const { data: channel } = await supabaseAdmin
      .from("brand_channels")
      .select("id, round_robin_enabled")
      .eq("brand_id", input.brandId)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!channel) {
      return {
        started: 0,
        contactId,
        diagnostic:
          "Contato resolvido, mas o Expert não tem nenhum canal WhatsApp ativo. Configure um canal antes de disparar automações.",
      };
    }

    let assignedTo: string | null = null;
    if ((channel as any).round_robin_enabled) {
      try {
        const { data: pick, error: pickErr } = await supabaseAdmin.rpc("pick_next_agent", {
          _channel_id: channel.id,
        });
        if (pickErr) {
          console.error("[integrations-dispatch] pick_next_agent error:", pickErr.message);
        } else {
          assignedTo = (pick as string | null) ?? null;
        }
      } catch (e) {
        console.error("[integrations-dispatch] pick_next_agent threw:", (e as Error).message);
      }
    }

    const { data: created, error: convErr } = await supabaseAdmin
      .from("conversations")
      .insert({
        brand_id: input.brandId,
        channel_id: channel.id,
        contact_id: contactId,
        assigned_to: assignedTo,
        status: "aberto" as never,
      })
      .select("id")
      .single();
    if (convErr || !created) {
      return {
        started: 0,
        contactId,
        diagnostic: `Falha ao criar conversa para o contato: ${convErr?.message ?? "erro desconhecido"}.`,
      };
    }
    conv = created;

    if (assignedTo) {
      await supabaseAdmin.from("conversation_events").insert({
        conversation_id: conv.id,
        event_type: "assigned",
        payload: { assigned_to: assignedTo, by: "round_robin" },
      });
    }
  }

  // 4. Disparar automações
  const fnUrl = `${process.env.SUPABASE_URL}/functions/v1/automation-engine`;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  let started = 0;
  const errors: string[] = [];
  for (const a of matching) {
    try {
      const res = await fetch(fnUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          event: "manual_trigger",
          automation_id: a.id,
          contact_id: contactId,
          conversation_id: conv.id,
          variables: {
            integration_platform: input.platform,
            integration_event: input.eventType,
            ...input.payload,
          },
        }),
      });
      if (res.ok) started++;
      else errors.push(`"${a.name}": engine HTTP ${res.status}`);
    } catch (e) {
      const msg = (e as Error).message;
      console.error("[integrations-dispatch] error:", msg);
      errors.push(`"${a.name}": ${msg}`);
    }
  }
  return {
    started,
    contactId,
    diagnostic: errors.length ? errors.join(" | ") : null,
  };
}
