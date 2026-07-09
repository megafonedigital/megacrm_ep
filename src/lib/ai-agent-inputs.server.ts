import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type AgentInputSource =
  | "contact"
  | "brand"
  | "conversation"
  | "static"
  | "hotmart"
  | "shopify"
  | "activecampaign"
  | "sendflow";

const PLATFORM_SOURCES = new Set<AgentInputSource>([
  "hotmart",
  "shopify",
  "activecampaign",
  "sendflow",
]);

export type AgentInputDef = {
  key: string;
  label?: string;
  source: AgentInputSource;
  path?: string;
  fallback?: string;
};

export type DefaultInputDescriptor = {
  key: string;
  label: string;
  source: AgentInputSource;
  path: string;
  description: string;
};

export const DEFAULT_AGENT_INPUTS: DefaultInputDescriptor[] = [
  { key: "contact.name", label: "Nome do contato", source: "contact", path: "name", description: "Nome do contato (auto)" },
  { key: "contact.phone", label: "Telefone", source: "contact", path: "phone", description: "Telefone do contato" },
  { key: "contact.wa_id", label: "WhatsApp ID", source: "contact", path: "wa_id", description: "wa_id do contato" },
  { key: "brand.name", label: "Nome do workspace", source: "brand", path: "name", description: "Nome do workspace" },
  { key: "brand.slug", label: "Slug do workspace", source: "brand", path: "slug", description: "Slug do workspace" },
  { key: "agent.name", label: "Nome do agente", source: "static", path: "", description: "Nome configurado do agente" },
  { key: "company.name", label: "Nome da empresa", source: "static", path: "", description: "Da base de conhecimento (Empresa) vinculada" },
  { key: "expert.name", label: "Nome do expert", source: "static", path: "", description: "Da base de conhecimento (Empresa) vinculada" },
  { key: "now", label: "Data/hora atual", source: "conversation", path: "now", description: "Agora (America/Sao_Paulo)" },
  { key: "last_messages", label: "Últimas mensagens", source: "conversation", path: "last_messages", description: "Histórico recente" },
];

const DEFAULT_KEYS = new Set(DEFAULT_AGENT_INPUTS.map((d) => d.key));

export function isDefaultInputKey(key: string): boolean {
  return DEFAULT_KEYS.has(key);
}

function getPath(obj: unknown, path: string): unknown {
  if (!obj || !path) return undefined;
  const parts = path.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function asString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try { return JSON.stringify(v); } catch { return ""; }
}

export type ResolveContext = {
  brandId: string;
  agentId?: string | null;
  contactId?: string | null;
  conversationId?: string | null;
  contextWindow?: number;
  // pré-carregados (test runner pode preencher)
  preloaded?: {
    contact?: Record<string, unknown> | null;
    brand?: Record<string, unknown> | null;
    lastMessagesText?: string | null;
    companyName?: string | null;
    expertName?: string | null;
    agentName?: string | null;
  };
};

export async function resolveAgentVariables(
  inputs: AgentInputDef[] | null | undefined,
  ctx: ResolveContext,
): Promise<Record<string, string>> {
  // Carrega fontes de dados sob demanda
  let contact = ctx.preloaded?.contact ?? null;
  let brand = ctx.preloaded?.brand ?? null;
  let lastMessagesText = ctx.preloaded?.lastMessagesText ?? null;
  let companyName: string | null = ctx.preloaded?.companyName ?? null;
  let expertName: string | null = ctx.preloaded?.expertName ?? null;
  let agentName: string | null = ctx.preloaded?.agentName ?? null;
  // Cache do último payload por plataforma para o contato atual
  const platformPayloads: Partial<Record<AgentInputSource, Record<string, unknown> | null>> = {};

  const needContact = !contact && !!ctx.contactId;
  const needBrand = !brand && !!ctx.brandId;
  const needHistory = lastMessagesText == null && !!ctx.conversationId;
  const needKbCompany = (companyName == null || expertName == null) && !!ctx.agentId;
  const needAgentName = agentName == null && !!ctx.agentId;

  const promises: Array<Promise<void>> = [];
  if (needContact) {
    promises.push(
      Promise.resolve(
        supabaseAdmin
          .from("contacts")
          .select("name, phone, wa_id, metadata")
          .eq("id", ctx.contactId as string)
          .maybeSingle(),
      ).then((r) => { contact = (r.data as Record<string, unknown>) ?? null; }),
    );
  }
  if (needBrand) {
    promises.push(
      Promise.resolve(
        supabaseAdmin
          .from("brands")
          .select("name, slug")
          .eq("id", ctx.brandId)
          .maybeSingle(),
      ).then((r) => { brand = (r.data as Record<string, unknown>) ?? null; }),
    );
  }
  if (needHistory) {
    const limit = Math.max(1, Math.min(50, ctx.contextWindow ?? 10));
    promises.push(
      Promise.resolve(
        supabaseAdmin
          .from("messages")
          .select("direction, content, type, created_at")
          .eq("conversation_id", ctx.conversationId as string)
          .order("created_at", { ascending: false })
          .limit(limit),
      ).then((r) => {
        const rows = (r.data ?? []) as Array<{ direction: string; content: string | null; type: string | null }>;
        lastMessagesText = rows
          .reverse()
          .map((m) => {
            const who = m.direction === "inbound" ? "Paciente" : "Agente";
            const c = (m.content ?? "") || (m.type ? `[${m.type}]` : "");
            return `${who}: ${c}`;
          })
          .join("\n");
      }),
    );
  }
  if (needKbCompany) {
    promises.push(
      Promise.resolve(
        supabaseAdmin
          .from("ai_agent_knowledge")
          .select("kb_id")
          .eq("agent_id", ctx.agentId as string)
          .eq("kind", "company"),
      ).then(async (linksRes) => {
        const ids = (linksRes.data ?? []).map((l) => l.kb_id as string).filter(Boolean);
        if (ids.length === 0) return;
        const { data } = await supabaseAdmin
          .from("ai_knowledge_company")
          .select("company_name, expert_name")
          .in("id", ids);
        const rows = (data ?? []) as Array<{ company_name: string | null; expert_name: string | null }>;
        if (companyName == null) {
          const first = rows.find((r) => (r.company_name ?? "").trim().length > 0);
          companyName = first?.company_name?.trim() ?? null;
        }
        if (expertName == null) {
          const first = rows.find((r) => (r.expert_name ?? "").trim().length > 0);
          expertName = first?.expert_name?.trim() ?? null;
        }
      }),
    );
  }
  if (needAgentName) {
    promises.push(
      Promise.resolve(
        supabaseAdmin
          .from("ai_agents")
          .select("name")
          .eq("id", ctx.agentId as string)
          .maybeSingle(),
      ).then((r) => {
        const n = (r.data as { name?: string | null } | null)?.name;
        agentName = (n ?? "").trim() || null;
      }),
    );
  }

  await Promise.all(promises);

  // Carrega últimos eventos de plataforma usados nos inputs (1 query por plataforma)
  const neededPlatforms = new Set<AgentInputSource>();
  for (const def of inputs ?? []) {
    if (def?.source && PLATFORM_SOURCES.has(def.source)) {
      neededPlatforms.add(def.source);
    }
  }
  if (ctx.contactId && neededPlatforms.size > 0) {
    await Promise.all(
      Array.from(neededPlatforms).map(async (platform) => {
        const { data } = await supabaseAdmin
          .from("integration_events")
          .select("payload")
          .eq("contact_id", ctx.contactId as string)
          .eq("platform", platform as "hotmart" | "shopify" | "sendflow" | "activecampaign")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        platformPayloads[platform] = (data?.payload as Record<string, unknown> | undefined) ?? null;
      }),
    );
  }

  const nowFmt = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

  const resolveOne = (def: { key: string; source: AgentInputSource; path?: string; fallback?: string }): string => {
    let raw: unknown;
    if (def.source === "contact") {
      raw = getPath(contact ?? {}, def.path ?? def.key.replace(/^contact\./, ""));
    } else if (def.source === "brand") {
      raw = getPath(brand ?? {}, def.path ?? def.key.replace(/^brand\./, ""));
    } else if (def.source === "conversation") {
      const p = def.path ?? def.key;
      if (p === "now") raw = nowFmt;
      else if (p === "last_messages") raw = lastMessagesText ?? "";
      else raw = "";
    } else if (PLATFORM_SOURCES.has(def.source)) {
      const payload = platformPayloads[def.source] ?? null;
      raw = payload ? getPath(payload, def.path ?? "") : undefined;
    } else {
      raw = def.fallback ?? "";
    }
    const s = asString(raw).trim();
    return s.length > 0 ? s : (def.fallback ?? "");
  };

  const out: Record<string, string> = {};

  // 1) Defaults sempre disponíveis
  for (const d of DEFAULT_AGENT_INPUTS) {
    out[d.key] = resolveOne({ key: d.key, source: d.source, path: d.path });
  }

  // 1b) Defaults derivados de fontes externas (KB Empresa + agente atual)
  out["company.name"] = companyName ?? "";
  out["expert.name"] = expertName ?? "";
  out["agent.name"] = agentName ?? "";


  // 2) Inputs customizados (sobrepõem defaults se conflitarem)
  for (const def of inputs ?? []) {
    if (!def?.key) continue;
    out[def.key] = resolveOne(def);
  }

  return out;
}

export function applyVariables(template: string, values: Record<string, string>): string {
  if (!template) return template;
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, k) => {
    if (Object.prototype.hasOwnProperty.call(values, k)) return values[k];
    return ""; // chave desconhecida vira vazio
  });
}

/**
 * Monta um bloco de contexto com todas as variáveis resolvidas para anexar
 * ao final do system prompt. Variáveis vazias são omitidas. Valores
 * multi-linha (ex.: last_messages) são renderizados indentados.
 */
export function buildContextBlock(
  values: Record<string, string>,
  customInputs?: AgentInputDef[] | null,
): string {
  const orderedKeys: string[] = [];
  const seen = new Set<string>();
  for (const d of DEFAULT_AGENT_INPUTS) {
    if (!seen.has(d.key)) { orderedKeys.push(d.key); seen.add(d.key); }
  }
  for (const c of customInputs ?? []) {
    if (c?.key && !seen.has(c.key)) { orderedKeys.push(c.key); seen.add(c.key); }
  }
  for (const k of Object.keys(values)) {
    if (!seen.has(k)) { orderedKeys.push(k); seen.add(k); }
  }

  const lines: string[] = [];
  for (const k of orderedKeys) {
    const v = values[k];
    if (v == null) continue;
    const trimmed = String(v).trim();
    if (!trimmed) continue;
    if (trimmed.includes("\n")) {
      const indented = trimmed.split("\n").map((l) => `    ${l}`).join("\n");
      lines.push(`- ${k}:\n${indented}`);
    } else {
      lines.push(`- ${k}: ${trimmed}`);
    }
  }
  if (lines.length === 0) return "";
  return `---\nContexto disponível:\n${lines.join("\n")}`;
}

