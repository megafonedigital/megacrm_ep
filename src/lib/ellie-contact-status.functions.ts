import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ELLIE_BRAND_ID } from "./ellie";

export type EllieContactStatus = {
  contactId: string;
  status: "aluno" | "lead_ativo" | "lead_esgotado" | "desconhecido";
  used: number;
  limit: number;
  source: "manual" | "hotmart" | null;
};

function digits(v: string | null | undefined): string {
  return (v ?? "").replace(/\D+/g, "");
}

async function computeForContacts(contactIds: string[]): Promise<EllieContactStatus[]> {
  if (contactIds.length === 0) return [];

  const { data: contacts } = await supabaseAdmin
    .from("contacts")
    .select("id, brand_id, phone, wa_id, metadata")
    .in("id", contactIds);

  const list = (contacts ?? []) as Array<{
    id: string;
    brand_id: string;
    phone: string | null;
    wa_id: string | null;
    metadata: any;
  }>;
  if (list.length === 0) return [];

  // Defesa em profundidade: features Ellie só computam para o brand da Ellie.
  const ellieList = list.filter((c) => c.brand_id === ELLIE_BRAND_ID);
  if (ellieList.length === 0) {
    return contactIds.map((id) => ({
      contactId: id,
      status: "desconhecido" as const,
      used: 0,
      limit: 0,
      source: null,
    }));
  }

  const brandIds = Array.from(new Set(ellieList.map((c) => c.brand_id)));

  // Buyer validations for these brands (manual + hotmart, active)
  const { data: validations } = await supabaseAdmin
    .from("ellie_buyer_validations")
    .select("brand_id, email, phone, source, active")
    .in("brand_id", brandIds)
    .eq("active", true);

  // Lead agents per brand (the Ellie-style agent with lead limit configured)
  const { data: agents } = await supabaseAdmin
    .from("ai_agents")
    .select("id, brand_id, lead_free_message_limit, created_at")
    .in("brand_id", brandIds)
    .not("lead_free_message_limit", "is", null)
    .order("created_at", { ascending: false });

  const agentByBrand = new Map<string, { id: string; limit: number }>();
  for (const a of (agents ?? []) as any[]) {
    if (!agentByBrand.has(a.brand_id)) {
      agentByBrand.set(a.brand_id, { id: a.id, limit: Number(a.lead_free_message_limit ?? 0) });
    }
  }

  const agentIds = Array.from(new Set(Array.from(agentByBrand.values()).map((a) => a.id)));
  const { data: usages } = agentIds.length
    ? await supabaseAdmin
        .from("ellie_lead_usage")
        .select("agent_id, contact_id, messages_used")
        .in("agent_id", agentIds)
        .in("contact_id", contactIds)
    : { data: [] as any[] };

  const usageMap = new Map<string, number>();
  for (const u of (usages ?? []) as any[]) {
    usageMap.set(`${u.agent_id}:${u.contact_id}`, Number(u.messages_used ?? 0));
  }

  // Index validations by brand for quick lookup
  const validByBrand = new Map<string, any[]>();
  for (const v of (validations ?? []) as any[]) {
    if (!validByBrand.has(v.brand_id)) validByBrand.set(v.brand_id, []);
    validByBrand.get(v.brand_id)!.push(v);
  }

  const computed = ellieList.map((c) => {
    const email = (c.metadata?.email ?? "").toString().toLowerCase().trim();
    const phoneD = digits(c.phone ?? c.wa_id);

    // 1) Check buyer validations
    const candidates = validByBrand.get(c.brand_id) ?? [];
    const match = candidates.find((v) => {
      const vEmail = (v.email ?? "").toString().toLowerCase().trim();
      const vPhone = digits(v.phone);
      if (email && vEmail && vEmail === email) return true;
      if (phoneD && vPhone && (vPhone === phoneD || vPhone.endsWith(phoneD) || phoneD.endsWith(vPhone))) return true;
      return false;
    });
    if (match) {
      return {
        contactId: c.id,
        status: "aluno" as const,
        used: 0,
        limit: 0,
        source: (match.source === "hotmart" ? "hotmart" : "manual") as "manual" | "hotmart",
      };
    }

    // 2) Lead usage
    const agent = agentByBrand.get(c.brand_id);
    if (!agent) {
      return { contactId: c.id, status: "desconhecido" as const, used: 0, limit: 0, source: null };
    }
    const used = usageMap.get(`${agent.id}:${c.id}`) ?? 0;
    const limit = agent.limit;
    if (limit > 0 && used >= limit) {
      return { contactId: c.id, status: "lead_esgotado" as const, used, limit, source: null };
    }
    return { contactId: c.id, status: "lead_ativo" as const, used, limit, source: null };
  });

  // Merge: contatos fora do brand da Ellie recebem "desconhecido".
  const byId = new Map(computed.map((s) => [s.contactId, s] as const));
  return contactIds.map(
    (id) =>
      byId.get(id) ?? {
        contactId: id,
        status: "desconhecido" as const,
        used: 0,
        limit: 0,
        source: null,
      },
  );
}

export const getEllieContactStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ contactId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const [s] = await computeForContacts([data.contactId]);
    return (
      s ?? {
        contactId: data.contactId,
        status: "desconhecido" as const,
        used: 0,
        limit: 0,
        source: null,
      }
    );
  });

export const getEllieContactStatusBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ contactIds: z.array(z.string().uuid()).max(200) }).parse(input),
  )
  .handler(async ({ data }) => {
    const items = await computeForContacts(data.contactIds);
    return { items };
  });
