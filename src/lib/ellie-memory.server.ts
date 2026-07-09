// Server-only helpers for AI long-term per-contact memory.
// Loaded by the agent engine — exposes tool definitions, a system-prompt
// block, and dispatch handlers for remember/update_memory/forget.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type MemoryRow = {
  id: string;
  key: string;
  value: string;
  category: string;
  confidence: number;
  last_mentioned_at: string;
  updated_at: string;
};

const CATEGORIES = ["identity", "preference", "pain", "goal", "restriction", "history", "other"] as const;
type Category = (typeof CATEGORIES)[number];

const CATEGORY_LABEL: Record<Category, string> = {
  identity: "Identidade",
  preference: "Preferências",
  pain: "Dores",
  goal: "Objetivos",
  restriction: "Restrições",
  history: "Histórico",
  other: "Outros",
};

export const MEMORY_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "remember",
      description:
        "Salva um fato durável sobre o contato (nome, apelido, gosto, objetivo, dor, restrição, histórico). Use chaves curtas em snake_case em português. Use APENAS para informações estáveis — não para mensagens efêmeras. Não anuncie ao usuário que está salvando.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "Identificador curto em snake_case, ex.: preferred_name, dor_principal, gosto_chocolate." },
          value: { type: "string", description: "Texto livre com o fato a ser lembrado." },
          category: {
            type: "string",
            enum: [...CATEGORIES],
            description: "Categoria do fato.",
          },
          confidence: {
            type: "number",
            description: "Confiança de 0 a 1. Use 0.9+ quando o contato afirmou diretamente, 0.5–0.7 quando inferido.",
          },
        },
        required: ["key", "value", "category"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_memory",
      description: "Atualiza o valor de uma chave já existente na memória do contato.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string" },
          value: { type: "string" },
        },
        required: ["key", "value"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "forget",
      description: "Remove uma chave da memória do contato (use quando o fato foi contradito, revogado ou ficou obsoleto).",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string" },
        },
        required: ["key"],
        additionalProperties: false,
      },
    },
  },
];

export const MEMORY_TOOL_NAMES = new Set(MEMORY_TOOLS.map((t) => t.function.name));

export const MEMORY_PROMPT_HINT = `

# Memória de longo prazo do contato
Você tem memória persistente sobre este contato. Use as tools remember / update_memory / forget para manter um perfil estável (nome, apelido, gostos, dores, objetivos, restrições, fatos relevantes).

## Gatilhos OBRIGATÓRIOS de remember (chame a tool ANTES de responder)
1. **Dislike / restrição / pedido de parar** — sempre que o contato disser "não gosto", "não quero", "odeio", "pare de", "chega de", "never", "don't", "stop", "I hate", "I don't like": salve como category="restriction", confidence=0.95, chave em snake_case com prefixo \`nao_\` (ex.: \`nao_gosta_quiz\`, \`nao_quer_audio_longo\`, \`nao_quer_correcao\`).
2. **Preferência ativa** — sempre que afirmar gosto/preferência ("I like", "prefiro", "adoro", "só quero", "I prefer", "love"): salve como category="preference", confidence=0.9 (ex.: \`prefere_historias\`, \`ritmo_estudo\`).
3. **Identidade** — nome, apelido, idade, profissão, país, idioma nativo: category="identity" (ex.: \`preferred_name\`, \`pais\`, \`profissao\`).
4. **Objetivo de estudo / dor** — por que estuda inglês, o que quer alcançar, o que dificulta: category="goal" ou "pain".
5. **Sinal de correção** — se o contato disser "já te disse", "I already told you", "como falei antes", "you forgot", "te falei isso": é uma FALHA de memória. Chame remember (ou update_memory se a chave existe) IMEDIATAMENTE naquele turno, antes de qualquer resposta, e SÓ depois peça desculpa naturalmente.

## Regras gerais
- Salve apenas fatos estáveis afirmados ou claramente inferidos. Nunca salve mensagens efêmeras, perguntas em aberto ou estados temporários.
- Chaves curtas em snake_case em português. Exemplos canônicos: \`preferred_name\`, \`nao_gosta_quiz\`, \`prefere_historias\`, \`ritmo_estudo\`, \`objetivo_estudo\`, \`dor_principal\`, \`pais\`, \`profissao\`.
- Se o fato já existe com outra redação, use update_memory em vez de criar nova chave.
- Use forget quando o contato contradisser ou revogar um fato salvo.
- Execute em silêncio — NUNCA escreva ao usuário "vou guardar isso" ou similar.
- Quando a memória já contém um fato, use-o naturalmente (chamar pelo apelido, respeitar restrições, lembrar a dor mencionada antes).`;

export async function loadContactMemory(
  agentId: string,
  contactId: string,
): Promise<MemoryRow[]> {
  const { data, error } = await supabaseAdmin
    .from("ai_agent_contact_memory" as any)
    .select("id, key, value, category, confidence, last_mentioned_at, updated_at")
    .eq("agent_id", agentId)
    .eq("contact_id", contactId)
    .order("updated_at", { ascending: false })
    .limit(120);
  if (error) {
    console.warn("[ai-agent][memory] load failed", error.message);
    return [];
  }
  return (data ?? []) as unknown as MemoryRow[];
}

export function buildMemoryPromptBlock(rows: MemoryRow[]): string {
  if (rows.length === 0) {
    return "# Memória do contato\n(nenhum fato salvo ainda — use remember para começar a montar o perfil)";
  }
  const grouped = new Map<string, MemoryRow[]>();
  for (const r of rows) {
    const cat = (CATEGORIES as readonly string[]).includes(r.category) ? r.category : "other";
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(r);
  }
  const lines: string[] = ["# Memória do contato"];
  for (const cat of CATEGORIES) {
    const items = grouped.get(cat);
    if (!items || items.length === 0) continue;
    lines.push(`## ${CATEGORY_LABEL[cat]}`);
    for (const r of items) {
      lines.push(`- ${r.key}: ${r.value}`);
    }
  }
  return lines.join("\n");
}

function normalizeKey(input: unknown): string {
  return String(input ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 80);
}

function normalizeCategory(input: unknown): Category {
  const c = String(input ?? "other").toLowerCase().trim();
  return (CATEGORIES as readonly string[]).includes(c) ? (c as Category) : "other";
}

export type MemoryToolResult = { ok: true; key: string; action: string } | { ok: false; error: string };

export async function dispatchMemoryTool(args: {
  brandId: string;
  agentId: string;
  contactId: string;
  sourceMessageId?: string | null;
  toolName: string;
  rawArguments: string;
}): Promise<MemoryToolResult> {
  let parsed: any = {};
  try {
    parsed = JSON.parse(args.rawArguments || "{}");
  } catch {
    return { ok: false, error: "invalid_json_arguments" };
  }

  if (args.toolName === "remember") {
    const key = normalizeKey(parsed.key);
    const value = String(parsed.value ?? "").trim().slice(0, 1000);
    if (!key || !value) return { ok: false, error: "key_and_value_required" };
    const category = normalizeCategory(parsed.category);
    const confidenceRaw = Number(parsed.confidence ?? 0.8);
    const confidence = Number.isFinite(confidenceRaw)
      ? Math.max(0, Math.min(1, confidenceRaw))
      : 0.8;
    const { error } = await supabaseAdmin
      .from("ai_agent_contact_memory" as any)
      .upsert(
        {
          brand_id: args.brandId,
          agent_id: args.agentId,
          contact_id: args.contactId,
          key,
          value,
          category,
          confidence,
          source_message_id: args.sourceMessageId ?? null,
          last_mentioned_at: new Date().toISOString(),
        } as any,
        { onConflict: "agent_id,contact_id,key" },
      );
    if (error) return { ok: false, error: error.message };
    return { ok: true, key, action: "remembered" };
  }

  if (args.toolName === "update_memory") {
    const key = normalizeKey(parsed.key);
    const value = String(parsed.value ?? "").trim().slice(0, 1000);
    if (!key || !value) return { ok: false, error: "key_and_value_required" };
    const { error } = await supabaseAdmin
      .from("ai_agent_contact_memory" as any)
      .update({
        value,
        last_mentioned_at: new Date().toISOString(),
      } as any)
      .eq("agent_id", args.agentId)
      .eq("contact_id", args.contactId)
      .eq("key", key);
    if (error) return { ok: false, error: error.message };
    return { ok: true, key, action: "updated" };
  }

  if (args.toolName === "forget") {
    const key = normalizeKey(parsed.key);
    if (!key) return { ok: false, error: "key_required" };
    const { error } = await supabaseAdmin
      .from("ai_agent_contact_memory" as any)
      .delete()
      .eq("agent_id", args.agentId)
      .eq("contact_id", args.contactId)
      .eq("key", key);
    if (error) return { ok: false, error: error.message };
    return { ok: true, key, action: "forgotten" };
  }

  return { ok: false, error: "unknown_tool" };
}
