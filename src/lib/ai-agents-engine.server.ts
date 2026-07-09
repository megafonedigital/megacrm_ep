import crypto from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  type AgentInputDef,
  applyVariables,
  buildContextBlock,
  resolveAgentVariables,
} from "./ai-agent-inputs.server";
import { rewriteLinksInText, type UtmParams } from "./tracking-link";
import { computeDelay, normalizeHumanizeConfig, splitReply } from "./ai-humanize";
import {
  generateTtsOgg,
  sendWhatsappAudioByMediaId,
  uploadAudioToMeta,
  type VoiceConfig,
} from "./elevenlabs-tts.server";
import {
  MEMORY_TOOLS,
  MEMORY_TOOL_NAMES,
  MEMORY_PROMPT_HINT,
  loadContactMemory,
  buildMemoryPromptBlock,
  dispatchMemoryTool,
} from "./ellie-memory.server";
import { validateEllieBuyer, buildBuyerStatusBlock } from "./ellie-validation.server";

export const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const GATEWAY_URL = AI_GATEWAY_URL;

const MAX_INPUT_MESSAGES_LOGGED = 30;

// Envia o indicador "digitando..." no WhatsApp Cloud API.
// Marca a última mensagem do paciente como lida e mostra o typing indicator
// (dura ~25s ou até a próxima mensagem ser enviada). Best-effort.
async function sendWhatsappTypingIndicator(args: {
  phoneNumberId: string;
  token: string;
  waMessageId: string;
}): Promise<void> {
  try {
    await fetch(`https://graph.facebook.com/v21.0/${args.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: args.waMessageId,
        typing_indicator: { type: "text" },
      }),
    });
  } catch (e) {
    console.warn("[ai-agent] typing indicator failed", (e as Error).message);
  }
}

const META_MESSAGE_TIMEOUT_MS = 8_000;

type MetaMessageResult = {
  ok: boolean;
  status: number;
  json: any;
  code?: string;
  message?: string;
};

async function postMetaMessageWithTimeout(args: {
  phoneNumberId: string;
  token: string;
  body: unknown;
  timeoutMs?: number;
}): Promise<MetaMessageResult> {
  const timeoutMs = args.timeoutMs ?? META_MESSAGE_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${args.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${args.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args.body),
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        json,
        code: String(json?.error?.code ?? `META_${res.status}`),
        message: String(json?.error?.message ?? "Falha ao enviar via Meta"),
      };
    }
    return { ok: true, status: res.status, json };
  } catch (e) {
    const message = timedOut
      ? `Timeout ao enviar via Meta após ${timeoutMs}ms`
      : String((e as Error).message ?? e);
    return {
      ok: false,
      status: 0,
      json: {},
      code: timedOut ? "META_TIMEOUT" : "META_EXCEPTION",
      message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function generateTtsWithRetry(
  text: string,
  voiceCfg: VoiceConfig,
  attempts = 2,
  timeoutMs = 18_000,
): Promise<ArrayBuffer | Uint8Array> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await generateTtsOgg(text, voiceCfg, { timeoutMs });
    } catch (e) {
      lastError = e;
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 700));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

// Variantes E.164 considerando BR com/sem o 9 após o DDD.
function phoneE164Variants(input?: string | null): string[] {
  const d = (input ?? "").replace(/\D+/g, "");
  if (!d) return [];
  const out = new Set<string>();
  out.add("+" + d);
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    const rest = d.slice(4);
    if (rest.length === 9 && rest.startsWith("9")) out.add("+55" + ddd + rest.slice(1));
    else if (rest.length === 8) out.add("+55" + ddd + "9" + rest);
  }
  return Array.from(out);
}

async function isContactBlocklistedAdmin(
  brandId: string | null | undefined,
  phone: string | null | undefined,
  email: string | null | undefined,
): Promise<boolean> {
  if (!brandId) return false;
  const phones = phoneE164Variants(phone);
  const e = (email ?? "").trim().toLowerCase() || null;
  if (phones.length === 0 && !e) return false;
  if (phones.length) {
    const { data } = await supabaseAdmin
      .from("contact_blocklist")
      .select("id")
      .eq("brand_id", brandId)
      .eq("kind", "phone")
      .in("value", phones)
      .limit(1);
    if (data && data.length > 0) return true;
  }
  if (e) {
    const { data } = await supabaseAdmin
      .from("contact_blocklist")
      .select("id")
      .eq("brand_id", brandId)
      .eq("kind", "email")
      .eq("value", e)
      .limit(1);
    if (data && data.length > 0) return true;
  }
  return false;
}


export type LogAgentRunInput = {
  brand_id: string;
  agent_id: string;
  conversation_id?: string | null;
  contact_id?: string | null;
  triggered_by: "automation" | "manual_test" | "scenario" | "assign_block" | "message";
  status: "success" | "error" | "escalated" | "rate_limited";
  model?: string | null;
  temperature?: number | null;
  max_output_tokens?: number | null;
  input_messages?: Array<{ role: string; content: unknown }>;
  input_variables?: Record<string, string> | null;
  output_text?: string | null;
  tool_call?: unknown;
  tokens_in?: number | null;
  tokens_out?: number | null;
  latency_ms?: number | null;
  error_code?: string | null;
  error_message?: string | null;
  escalation_track?: string | null;
  version_id?: string | null;
  ab_test_id?: string | null;
  ab_variant?: "a" | "b" | null;
};

export async function logAgentRun(input: LogAgentRunInput): Promise<void> {
  try {
    const trimmed = (input.input_messages ?? []).slice(-MAX_INPUT_MESSAGES_LOGGED);
    await supabaseAdmin.from("ai_agent_runs").insert({
      brand_id: input.brand_id,
      agent_id: input.agent_id,
      conversation_id: input.conversation_id ?? null,
      contact_id: input.contact_id ?? null,
      triggered_by: input.triggered_by,
      status: input.status,
      model: input.model ?? null,
      temperature: input.temperature ?? null,
      max_output_tokens: input.max_output_tokens ?? null,
      input_messages: trimmed,
      input_variables: input.input_variables ?? null,
      output_text: input.output_text ?? null,
      tool_call: input.tool_call ?? null,

      tokens_in: input.tokens_in ?? null,
      tokens_out: input.tokens_out ?? null,
      latency_ms: input.latency_ms ?? null,
      error_code: input.error_code ?? null,
      error_message: input.error_message ?? null,
      escalation_track: input.escalation_track ?? null,
      version_id: input.version_id ?? null,
      ab_test_id: input.ab_test_id ?? null,
      ab_variant: input.ab_variant ?? null,
    } as never);
  } catch (e) {
    console.error("[ai-agent] logAgentRun failed", (e as Error).message);
  }
}

export type AgentRow = {
  id: string;
  brand_id: string;
  name: string;
  status: "off" | "test" | "on";
  whitelist: string[] | null;
  system_prompt: string;
  model: string;
  temperature: number;
  max_output_tokens: number;
  context_window_messages: number;
  escalation_target_vendas: string | null;
  escalation_target_suporte: string | null;
  inputs?: AgentInputDef[] | null;
  rate_limit_per_conversation?: number | null;
  rate_limit_window_minutes?: number | null;
  rate_limit_per_agent_hour?: number | null;
  tracking_tag?: string | null;
};


export const NEED_HUMAN_TOOL = {
  type: "function" as const,
  function: {
    name: "need_human",
    description:
      "Transfere o atendimento para um humano (Vendas ou Suporte). Use quando o system prompt mandar escalar. Sempre envie message_to_patient — é a frase que será mandada ao usuário no mesmo turno. NUNCA escale só porque o paciente disse que é aluno: use submit_hotmart_email para validar o e-mail. NUNCA escale por 'contexto_ausente' relacionado a validação de aluno.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description:
            "Motivo curto (ex.: pediu_humano, emergencia_medica, duvida_clinica_fora_escopo, objecao_financeira_persistente, produto_inexistente, problema_tecnico, suporte_emocional, problema_produto, pedido_operacional, sem_prescricao_vinculada). NUNCA escale por áudio, imagem, ou alegação de ser aluno — para alegação de aluno use submit_hotmart_email.",
        },
        escalation_track: {
          type: "string",
          enum: ["vendas", "suporte"],
          description: "Trilha de destino. 'vendas' p/ comercial; 'suporte' p/ clínico/operacional/técnico.",
        },
        message_to_patient: {
          type: "string",
          description: "Frase curta a ser enviada ao usuário no mesmo turno informando a transferência.",
        },
      },
      required: ["reason", "escalation_track", "message_to_patient"],
      additionalProperties: false,
    },
  },
};

export const SUBMIT_HOTMART_EMAIL_TOOL = {
  type: "function" as const,
  function: {
    name: "submit_hotmart_email",
    description:
      "Valida na Hotmart o e-mail informado pelo paciente. Chame SEMPRE que o paciente mandar um e-mail alegando ser aluno / já ter comprado. O sistema salva o e-mail no contato, consulta a Hotmart e retorna { status: 'aluno' | 'lead' }. Se 'aluno', agradeça e retome a aula. Se 'lead', o sistema entra em MODO VENDAS automaticamente — apresente as ofertas em português, sem aulas de inglês, sem áudio, sem imagens, sem menus.",
    parameters: {
      type: "object",
      properties: {
        email: {
          type: "string",
          description: "E-mail informado pelo paciente (será normalizado para lowercase).",
        },
      },
      required: ["email"],
      additionalProperties: false,
    },
  },
};

export const TOOL_USAGE_HINT = `

# Ferramentas disponíveis
Você tem acesso à tool need_human(reason, escalation_track, message_to_patient) e, quando aplicável, submit_hotmart_email(email).
- escalation_track DEVE ser "vendas" OU "suporte".
- Sempre que decidir escalar, CHAME a tool no MESMO turno e inclua message_to_patient (frase curta de transferência ao usuário). Não basta escrever "vou transferir" no texto — sem chamar a tool, a transferência NÃO acontece.

# Mensagens de áudio
Áudios do paciente chegam já transcritos no formato "🎙️ (áudio transcrito): <texto>". Trate exatamente como mensagem de texto comum e responda normalmente. NUNCA chame need_human só porque a mensagem veio em áudio — isso não é motivo de escalação.
Se você ver "[audio]" sem transcrição, a transcrição falhou: peça gentilmente em uma frase curta para o paciente reenviar por escrito, sem escalar.

# Imagens e stickers
Quando o paciente envia uma foto ou sticker, você recebe a imagem diretamente — descreva o que vê, leia textos visíveis (ex.: prescrição, print de outro app) e responda no mesmo turno. NUNCA chame need_human só porque a mensagem veio em imagem.

# Alegação de aluno (Hotmart)
Se o paciente afirmar que já é aluno / já comprou / já tem acesso, e o bloco "[STATUS DO CONTATO NA HOTMART]" indicar status: lead:
- Peça, em UMA linha curta, o e-mail cadastrado na compra da Hotmart. Ex.: "Para liberar seu acesso automaticamente, me envie por favor o e-mail que você usou na compra da Hotmart."
- Assim que o paciente mandar um e-mail (mesmo turno em que ele aparecer), CHAME imediatamente submit_hotmart_email(email) ANTES de qualquer resposta.
- Se a tool retornar status: aluno → agradeça e retome a aula normalmente.
- Se a tool retornar status: lead → o sistema entra em MODO VENDAS automaticamente. Responda em português apenas sobre as ofertas, sem aulas de inglês, sem áudio, sem imagens, sem menus.
- Se o paciente recusar mandar o e-mail, siga em MODO VENDAS ofertando a Ellie. NUNCA chame need_human por esse motivo — nem por "contexto_ausente", nem para "suporte".
- Se o status já for aluno, trate normalmente como aluno — não peça e-mail nem escale.`;




function normalizeWa(s: string | null | undefined): string {
  return String(s ?? "").replace(/\D+/g, "");
}

/**
 * Carrega produtos vinculados ao agente com o conteúdo necessário para
 * casar URLs do reply do LLM com a config UTM do produto correspondente.
 */
export async function loadAgentProductLinks(agentId: string): Promise<Array<{
  utm_params: UtmParams | null;
  haystack: string;
}>> {
  const { data: links } = await supabaseAdmin
    .from("ai_agent_knowledge")
    .select("kb_id, kind")
    .eq("agent_id", agentId);
  const productIds = (links ?? [])
    .filter((l) => l.kind === "product")
    .map((l) => l.kb_id as string);
  if (productIds.length === 0) return [];
  const { data } = await supabaseAdmin
    .from("ai_knowledge_products")
    .select("description, summary, notes, faq, utm_params")
    .in("id", productIds);
  return (data ?? []).map((p: any) => {
    const faqText = Array.isArray(p.faq)
      ? p.faq.map((f: { q: string; a: string }) => `${f.q}\n${f.a}`).join("\n")
      : "";
    return {
      utm_params: (p.utm_params ?? null) as UtmParams | null,
      haystack: [p.description, p.summary, p.notes, faqText].filter(Boolean).join("\n"),
    };
  });
}

/** Tenta achar o produto cujo conteúdo da KB contém o link bruto. */
export function matchProductForLink(
  rawLink: string,
  products: Array<{ utm_params: UtmParams | null; haystack: string }>,
): UtmParams | null {
  // Match por substring exata da URL (ou prefixo até a query string).
  const noQuery = rawLink.split("?")[0];
  for (const p of products) {
    if (!p.haystack) continue;
    if (p.haystack.includes(rawLink) || p.haystack.includes(noQuery)) {
      return p.utm_params ?? null;
    }
  }
  return null;
}

export async function buildAgentSystemPrompt(agent: AgentRow): Promise<string> {
  // 1) Pega vínculos do agente
  const { data: links, error: linksErr } = await supabaseAdmin
    .from("ai_agent_knowledge")
    .select("kind, kb_id")
    .eq("agent_id", agent.id);
  if (linksErr) throw new Error(linksErr.message);

  const companyIds = (links ?? []).filter((l) => l.kind === "company").map((l) => l.kb_id as string);
  const contextIds = (links ?? []).filter((l) => l.kind === "context").map((l) => l.kb_id as string);
  const productIds = (links ?? []).filter((l) => l.kind === "product").map((l) => l.kb_id as string);

  const nowIso = new Date().toISOString();
  const [companyRes, contextRes, productsRes] = await Promise.all([
    companyIds.length
      ? supabaseAdmin.from("ai_knowledge_company").select("name, content, faq").in("id", companyIds)
      : Promise.resolve({ data: [], error: null }),
    contextIds.length
      ? supabaseAdmin.from("ai_knowledge_context")
          .select("title, content, starts_at, ends_at")
          .in("id", contextIds)
          .lte("starts_at", nowIso)
          .gte("ends_at", nowIso)
      : Promise.resolve({ data: [], error: null }),
    productIds.length
      ? supabaseAdmin.from("ai_knowledge_products")
          .select("product_name, summary, description, utm_default, utm_params, faq, notes")
          .in("id", productIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const parts: string[] = [];
  if (agent.system_prompt?.trim()) parts.push(agent.system_prompt.trim());

  const companies = (companyRes.data ?? []) as Array<{ name: string; content: string; faq: Array<{ q: string; a: string }> | null }>;
  if (companies.length > 0) {
    const block = companies
      .map((c) => {
        const lines = [`## ${c.name}`];
        if ((c.content ?? "").trim()) lines.push((c.content ?? "").trim());
        const faq = Array.isArray(c.faq) ? c.faq : [];
        if (faq.length > 0) {
          lines.push("FAQ:");
          for (const item of faq) lines.push(`- P: ${item.q}\n  R: ${item.a}`);
        }
        return lines.join("\n");
      })
      .filter((b) => b.length > 0)
      .join("\n\n");
    if (block) parts.push(`# Sobre a empresa / expert\n${block}`);
  }

  const products = (productsRes.data ?? []) as Array<{
    product_name: string;
    summary: string | null;
    description: string | null;
    utm_default: string | null;
    utm_params: UtmParams | null;
    faq: Array<{ q: string; a: string }> | null;
    notes: string | null;
  }>;
  if (products.length > 0) {
    const block = products
      .map((p) => {
        const lines = [`## Produto: ${p.product_name}`];
        if (p.summary && p.summary.trim()) lines.push(`Resumo: ${p.summary.trim()}`);
        if (p.description && p.description.trim()) lines.push(`Descrição:\n${p.description.trim()}`);
        if (p.notes) lines.push(`Notas: ${p.notes}`);
        const faq = Array.isArray(p.faq) ? p.faq : [];
        if (faq.length > 0) {
          lines.push("FAQ:");
          for (const item of faq) lines.push(`- P: ${item.q}\n  R: ${item.a}`);
        }
        return lines.join("\n");
      })
      .join("\n\n");
    parts.push(`# Bases por produto\n${block}`);
  }

  const contexts = (contextRes.data ?? []) as Array<{ title: string; content: string }>;
  if (contexts.length > 0) {
    const block = contexts.map((c) => `## ${c.title}\n${c.content}`).join("\n\n");
    parts.push(`# Contexto atual (vigente)\n${block}`);
  }

  return parts.join("\n\n");
}

export async function runAgentForConversation(conversationId: string): Promise<{
  ok: boolean;
  reason?: string;
}> {
  const { data: conv, error: convErr } = await supabaseAdmin
    .from("conversations")
    .select("id, brand_id, ai_agent_id, contact_id, channel_id, status")
    .eq("id", conversationId)
    .maybeSingle();
  if (convErr) throw new Error(convErr.message);
  if (!conv) return { ok: false, reason: "conversation_not_found" };
  // If ai_agent_id is missing (e.g. conversation created before an agent was
  // attached to the channel), resolve the current channel agent on-the-fly
  // and persist it. Same selection rule as `webchat_start_session`.
  if (!conv.ai_agent_id && conv.channel_id) {
    const { data: pick } = await supabaseAdmin
      .from("ai_agent_channel_assignments")
      .select("agent_id, weight, created_at, ai_agents!inner(status)")
      .eq("channel_id", conv.channel_id as string)
      .gt("weight", 0)
      .neq("ai_agents.status", "off")
      .order("weight", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const pickedAgentId = (pick as { agent_id?: string } | null)?.agent_id ?? null;
    if (pickedAgentId) {
      await supabaseAdmin
        .from("conversations")
        .update({ ai_agent_id: pickedAgentId })
        .eq("id", conversationId);
      (conv as { ai_agent_id: string | null }).ai_agent_id = pickedAgentId;
    }
  }
  if (!conv.ai_agent_id) return { ok: false, reason: "no_agent" };
  if (conv.status === "resolvido") return { ok: false, reason: "conversation_resolved" };

  const { data: agent, error: agentErr } = await supabaseAdmin
    .from("ai_agents")
    .select(
      "id, brand_id, name, status, whitelist, system_prompt, model, temperature, max_output_tokens, context_window_messages, escalation_target_vendas, escalation_target_suporte, inputs, rate_limit_per_conversation, rate_limit_window_minutes, rate_limit_per_agent_hour, current_version_id, tracking_tag, help_me_enabled, help_me_slow_speed, process_inbound_images, long_term_memory_enabled, lead_free_message_limit, lead_mode_prompt, lead_offer_prompt",
    )
    .eq("id", conv.ai_agent_id)
    .maybeSingle();
  if (agentErr) throw new Error(agentErr.message);
  if (!agent) return { ok: false, reason: "agent_not_found" };
  const a = agent as unknown as AgentRow & { current_version_id?: string | null; help_me_enabled?: boolean; help_me_slow_speed?: number; process_inbound_images?: boolean; long_term_memory_enabled?: boolean; lead_free_message_limit?: number | null; lead_mode_prompt?: string | null; lead_offer_prompt?: string | null };
  if (a.status === "off") return { ok: false, reason: "agent_off" };

  // === Help me! shortcut: o último inbound foi clique em item do menu? ===
  {
    const { data: lastIn } = await supabaseAdmin
      .from("messages")
      .select("id, raw")
      .eq("conversation_id", conversationId)
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const payload: string | null =
      ((lastIn as any)?.raw?.interactive?.list_reply?.id as string | null) ?? null;
    if (payload && payload.startsWith("helpme:")) {
      return runHelpMeAction(conversationId, a, payload);
    }
  }

  // Blocklist guard: contato bloqueado neste workspace não é processado nem
  // recebe resposta da IA. Registra um run com status `skipped`/`blocklisted`
  // para que o evento fique visível no painel de runs do agente.
  {
    const { data: contact } = await supabaseAdmin
      .from("contacts")
      .select("wa_id, phone, metadata")
      .eq("id", conv.contact_id as string)
      .maybeSingle();
    const phoneCand = (contact as any)?.phone ?? (contact as any)?.wa_id ?? null;
    const emailCand = ((contact as any)?.metadata?.email ?? null) || null;
    if (await isContactBlocklistedAdmin(conv.brand_id as string, phoneCand, emailCand)) {
      await logAgentRun({
        brand_id: conv.brand_id as string,
        agent_id: a.id,
        conversation_id: conversationId,
        contact_id: conv.contact_id as string | null,
        triggered_by: "message",
        status: "error",
        model: a.model,
        temperature: a.temperature ?? null,
        max_output_tokens: a.max_output_tokens ?? null,
        input_messages: [],
        input_variables: {},
        latency_ms: 0,
        error_code: "blocklisted",
        error_message: "Contato no blocklist deste workspace; IA não respondeu.",
        version_id: a.current_version_id ?? null,
        ab_test_id: null,
        ab_variant: null,
      });
      return { ok: false, reason: "blocklisted" };
    }
  }

  if (a.status === "test") {
    const { data: contact } = await supabaseAdmin
      .from("contacts")
      .select("wa_id, phone")
      .eq("id", conv.contact_id as string)
      .maybeSingle();
    const allowed = (a.whitelist ?? []).map(normalizeWa);
    const candidates = [normalizeWa(contact?.wa_id as string), normalizeWa(contact?.phone as string)];
    if (!allowed.some((w) => w && candidates.includes(w))) {
      return { ok: false, reason: "not_in_whitelist" };
    }
  }

  // ===== A/B test variant resolution =====
  let abTestId: string | null = null;
  let abVariant: "a" | "b" | null = null;
  let effectiveVersionId: string | null = a.current_version_id ?? null;

  const { data: abTest } = await supabaseAdmin
    .from("ai_agent_ab_tests")
    .select("id, version_a_id, version_b_id, traffic_b_percent")
    .eq("agent_id", a.id)
    .eq("status", "running")
    .maybeSingle();

  if (abTest) {
    const t = abTest as { id: string; version_a_id: string; version_b_id: string; traffic_b_percent: number };
    const hash = crypto.createHash("sha1").update(`${t.id}:${conversationId}`).digest();
    const bucket = hash.readUInt32BE(0) % 100;
    abTestId = t.id;
    abVariant = bucket < t.traffic_b_percent ? "b" : "a";
    const versionId = abVariant === "b" ? t.version_b_id : t.version_a_id;

    const { data: ver } = await supabaseAdmin
      .from("ai_agent_versions")
      .select("id, system_prompt, model, temperature, max_output_tokens, context_window_messages, escalation_target_vendas, escalation_target_suporte, inputs, rate_limit_per_conversation, rate_limit_window_minutes, rate_limit_per_agent_hour")
      .eq("id", versionId)
      .maybeSingle();
    if (ver) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const v = ver as any;
      a.system_prompt = v.system_prompt ?? a.system_prompt;
      a.model = v.model ?? a.model;
      a.temperature = v.temperature ?? a.temperature;
      a.max_output_tokens = v.max_output_tokens ?? a.max_output_tokens;
      a.context_window_messages = v.context_window_messages ?? a.context_window_messages;
      a.escalation_target_vendas = v.escalation_target_vendas ?? a.escalation_target_vendas;
      a.escalation_target_suporte = v.escalation_target_suporte ?? a.escalation_target_suporte;
      a.inputs = v.inputs ?? a.inputs;
      a.rate_limit_per_conversation = v.rate_limit_per_conversation ?? a.rate_limit_per_conversation;
      a.rate_limit_window_minutes = v.rate_limit_window_minutes ?? a.rate_limit_window_minutes;
      a.rate_limit_per_agent_hour = v.rate_limit_per_agent_hour ?? a.rate_limit_per_agent_hour;
      effectiveVersionId = v.id as string;
    }
  }


  // ===== Rate limiting =====
  const perConv = a.rate_limit_per_conversation ?? 0;
  const winMin = Math.max(1, a.rate_limit_window_minutes ?? 60);
  const perHour = a.rate_limit_per_agent_hour ?? 0;
  if (perConv > 0 || perHour > 0) {
    const sinceConv = new Date(Date.now() - winMin * 60_000).toISOString();
    const since1h = new Date(Date.now() - 60 * 60_000).toISOString();
    const [convCount, hourCount] = await Promise.all([
      perConv > 0
        ? supabaseAdmin
            .from("ai_agent_runs")
            .select("id", { count: "exact", head: true })
            .eq("agent_id", a.id)
            .eq("conversation_id", conversationId)
            .in("status", ["success", "escalated"])
            .gte("created_at", sinceConv)
        : Promise.resolve({ count: 0 } as { count: number }),
      perHour > 0
        ? supabaseAdmin
            .from("ai_agent_runs")
            .select("id", { count: "exact", head: true })
            .eq("agent_id", a.id)
            .in("status", ["success", "escalated"])
            .gte("created_at", since1h)
        : Promise.resolve({ count: 0 } as { count: number }),
    ]);
    const cConv = (convCount as { count: number | null }).count ?? 0;
    const cHour = (hourCount as { count: number | null }).count ?? 0;
    const overConv = perConv > 0 && cConv >= perConv;
    const overHour = perHour > 0 && cHour >= perHour;
    if (overConv || overHour) {
      const code = overConv ? "rate_limit_conversation" : "rate_limit_agent_hour";
      await logAgentRun({
        brand_id: conv.brand_id as string,
        agent_id: a.id,
        conversation_id: conversationId,
        contact_id: conv.contact_id as string | null,
        triggered_by: "message",
        status: "rate_limited",
        model: a.model,
        temperature: a.temperature ?? null,
        max_output_tokens: a.max_output_tokens ?? null,
        input_messages: [],
        input_variables: {},
        latency_ms: 0,
        error_code: code,
        error_message: overConv
          ? `Limite de ${perConv} respostas em ${winMin}min para esta conversa atingido.`
          : `Limite global de ${perHour} respostas/hora para o agente atingido.`,
        version_id: effectiveVersionId,
        ab_test_id: abTestId,
        ab_variant: abVariant,
      });
      return { ok: false, reason: code };
    }
  }

  const windowSize = Math.max(1, Math.min(100, a.context_window_messages ?? 20));
  const { data: msgs } = await supabaseAdmin
    .from("messages")
    .select("direction, content, created_at, type, raw, media_url")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(windowSize);
  const history = (msgs ?? []).slice().reverse();

  // Dedup defensivo: se já existe um outbound deste agente depois do último
  // inbound, outro worker já respondeu (ou está respondendo) — abortar para
  // evitar duplicação de mensagens vista nos casos Victor/Afonso.
  {
    const lastInb = [...history].reverse().find((m) => (m.direction as string) === "inbound");
    if (lastInb?.created_at) {
      const lastInbAt = String(lastInb.created_at);
      const dup = history.some(
        (m) =>
          (m.direction as string) === "outbound" &&
          String(m.created_at) > lastInbAt &&
          ((m.raw as any)?.ai_agent_id as string | undefined) === a.id,
      );
      if (dup) {
        console.warn("[ai-agent] dedup_skipped: outbound already exists after last inbound", {
          conversationId,
          last_inbound_at: lastInbAt,
        });
        return { ok: false, reason: "dedup_concurrent_outbound" };
      }
    }
  }


  const baseSystem = await buildAgentSystemPrompt(a);
  const variables = await resolveAgentVariables(a.inputs ?? null, {
    brandId: a.brand_id,
    agentId: a.id,
    contactId: conv.contact_id as string | null,
    conversationId,
    contextWindow: windowSize,
  });
  const replaced = applyVariables((baseSystem ? baseSystem : "") + TOOL_USAGE_HINT, variables);
  const contextBlock = buildContextBlock(variables, a.inputs ?? null);

  // Long-term per-contact memory: load, format and inject if enabled.
  const longTermEnabled = !!a.long_term_memory_enabled && !!conv.contact_id;
  const memoryRows = longTermEnabled
    ? await loadContactMemory(a.id, conv.contact_id as string)
    : [];
  const memoryBlock = longTermEnabled ? buildMemoryPromptBlock(memoryRows) : "";
  const memoryHint = longTermEnabled ? MEMORY_PROMPT_HINT : "";

  // Buyer validation (Hotmart + manual allow-list). Cached 30d per (brand,email).
  let buyerBlock = "";
  let buyerStatus: "aluno" | "lead" | null = null;
  if (conv.contact_id) {
    try {
      const { data: c } = await supabaseAdmin
        .from("contacts")
        .select("phone, wa_id, metadata")
        .eq("id", conv.contact_id as string)
        .maybeSingle();
      const emailC = ((c as any)?.metadata?.email ?? null) || null;
      const phoneC = ((c as any)?.phone ?? (c as any)?.wa_id ?? null) || null;
      if (emailC || phoneC) {
        const r = await validateEllieBuyer({
          brandId: a.brand_id as string,
          email: emailC,
          phone: phoneC,
        });
        buyerBlock = buildBuyerStatusBlock(r);
        buyerStatus = r.status;
      }
    } catch (e) {
      console.warn("[ai-agent] buyer validation failed", (e as Error).message);
    }
  }

  // Lead mode: counter + lead/offer prompt switch (only when not aluno)
  let leadBlock = "";
  let leadExhausted = false;
  let leadOfferPromptEffective = "";
  let leadCatalog = "";
  if (buyerStatus !== "aluno" && conv.contact_id) {
    try {
      const limit = Number(a.lead_free_message_limit ?? 10);
      const { data: usageRow, error: incErr } = await supabaseAdmin.rpc(
        "increment_ellie_lead_usage",
        {
          _agent_id: a.id,
          _brand_id: a.brand_id,
          _contact_id: conv.contact_id as string,
        },
      );
      if (incErr) throw new Error(incErr.message);
      const used = Number(usageRow ?? 0);
      const exhausted = limit > 0 && used >= limit;
      if (exhausted) {
        const { data: offers } = await supabaseAdmin
          .from("ellie_lead_offers")
          .select("title, description, checkout_url")
          .eq("agent_id", a.id)
          .eq("active", true)
          .order("sort_order", { ascending: true });
        const catalog = (offers ?? [])
          .map((o: any, i: number) => {
            const lines = [`${i + 1}. ${o.title}`];
            if (o.description) lines.push(`   ${o.description}`);
            if (o.checkout_url) lines.push(`   Link: ${o.checkout_url}`);
            return lines.join("\n");
          })
          .join("\n\n");
        const promptBase =
          (a.lead_offer_prompt ?? "").trim() ||
          [
            "Você é a Ellie no MODO OFERTA. O lead atingiu o limite gratuito de mensagens.",
            "REGRAS INEGOCIÁVEIS:",
            "- NÃO dê mais aulas, correções gramaticais, dicas ou continuação de tópicos anteriores.",
            "- NÃO faça perguntas fora do tema comercial.",
            "- Responda SEMPRE em português.",
            "- Apresente as ofertas do catálogo abaixo, tire dúvidas apenas sobre elas e envie o link de checkout.",
            "- Se o lead insistir em conversar sobre outro assunto, recuse educadamente e reforce a oferta.",
          ].join("\n");
        leadExhausted = true;
        leadOfferPromptEffective = promptBase;
        leadCatalog = catalog || "(nenhum produto cadastrado)";
        leadBlock = `[MODO OFERTA — LEAD ESGOTOU ${used}/${limit} MENSAGENS]\n${promptBase}\n\n[CATÁLOGO DE OFERTAS]\n${leadCatalog}`;
        console.log("[ai-agent] lead mode = offer", { agentId: a.id, contactId: conv.contact_id, used, limit, mode: "hard-override" });
      } else {
        const promptBase = (a.lead_mode_prompt ?? "").trim();
        if (promptBase) {
          leadBlock = `[MODO LEAD — ${used}/${limit} mensagens usadas]\n${promptBase}`;
        }
      }
    } catch (e) {
      console.warn("[ai-agent] lead mode handling failed", (e as Error).message);
    }
  }

  const systemPrompt = leadExhausted
    ? [
        `[MODO OFERTA — HARD OVERRIDE]\n${leadOfferPromptEffective}`,
        memoryBlock,
        buyerBlock,
        `[CATÁLOGO DE OFERTAS]\n${leadCatalog}`,
      ]
        .filter((p) => p && p.trim().length > 0)
        .join("\n\n")
    : [replaced, memoryHint, memoryBlock, buyerBlock, leadBlock, contextBlock]
        .filter((p) => p && p.trim().length > 0)
        .join("\n\n");

  type ChatPart =
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } };
  type ChatToolCall = {
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  };
  type ChatMsg =
    | { role: "system" | "user"; content: string | ChatPart[] }
    | { role: "assistant"; content: string | ChatPart[] | null; tool_calls?: ChatToolCall[] }
    | { role: "tool"; content: string; tool_call_id: string };
  const messages: Array<ChatMsg> = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });

  const visionEnabled = !!a.process_inbound_images;
  for (const m of history) {
    const transcript = (m as any).raw?.transcription?.text as string | undefined;
    const mediaUrl = (m as any).media_url as string | null | undefined;
    const isImage = m.type === "image" || m.type === "sticker";
    const isInbound = (m.direction as string) === "inbound";

    // Mensagem inbound de imagem/sticker com visão ligada → conteúdo multimodal.
    if (isInbound && visionEnabled && isImage && mediaUrl) {
      const caption = (m.content as string | null) || (m.type === "sticker" ? "(sticker recebido)" : "(imagem recebida)");
      messages.push({
        role: "user",
        content: [
          { type: "text", text: caption },
          { type: "image_url", image_url: { url: mediaUrl } },
        ],
      });
      continue;
    }

    let content = (m.content as string | null) || "";
    if (!content && m.type === "audio" && transcript) {
      content = `🎙️ (áudio transcrito): ${transcript}`;
    }
    if (!content) content = m.type ? `[${m.type}]` : "";
    if (!content) continue;
    messages.push({
      role: isInbound ? "user" : "assistant",
      content,
    });
  }

  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

  const startedAt = Date.now();
  const modelUsed = a.model || "google/gemini-3-flash-preview";

  const toolset: any[] = [NEED_HUMAN_TOOL];
  if (longTermEnabled) toolset.push(...MEMORY_TOOLS);

  // Hotmart on-demand validation tool — habilitada quando o workspace tem
  // produtos Hotmart cadastrados (efetivamente Ellie). Permite que o modelo
  // valide o e-mail dentro do turno e o sistema alterne para Modo Vendas
  // automaticamente se a compra não for encontrada.
  let hotmartEnabled = false;
  if (conv.contact_id) {
    try {
      const { count } = await supabaseAdmin
        .from("ellie_hotmart_products")
        .select("id", { count: "exact", head: true })
        .eq("brand_id", a.brand_id as string)
        .eq("active", true);
      hotmartEnabled = (count ?? 0) > 0;
    } catch {}
  }
  if (hotmartEnabled) toolset.push(SUBMIT_HOTMART_EMAIL_TOOL);

  // Tool-calling loop: up to 4 turns to let the model execute remember/update_memory/forget
  // e submit_hotmart_email antes da resposta final. `need_human` sempre encerra o loop.
  const MAX_TOOL_TURNS = 4;
  let body: {
    choices?: Array<{
      message?: {
        content?: string;
        tool_calls?: Array<{
          id?: string;
          type?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  } = {};
  let choice: { content?: string; tool_calls?: Array<{ id?: string; type?: string; function?: { name?: string; arguments?: string } }> } | undefined;
  let textReply = "";
  let toolCalls: Array<{ id?: string; type?: string; function?: { name?: string; arguments?: string } }> = [];
  let totalTokensIn = 0;
  let totalTokensOut = 0;

  for (let turn = 1; turn <= MAX_TOOL_TURNS; turn++) {
    const res = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelUsed,
        messages,
        temperature: a.temperature ?? 0.7,
        max_tokens: a.max_output_tokens ?? 1024,
        tools: toolset,
        tool_choice: "auto",
      }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error("[ai-agent] gateway error", res.status, txt);
      await logAgentRun({
        brand_id: conv.brand_id as string,
        agent_id: a.id,
        conversation_id: conversationId,
        contact_id: conv.contact_id as string | null,
        triggered_by: "message",
        status: "error",
        model: modelUsed,
        temperature: a.temperature ?? null,
        max_output_tokens: a.max_output_tokens ?? null,
        input_messages: messages,
        input_variables: variables,
        latency_ms: Date.now() - startedAt,
        error_code: `gateway_${res.status}`,
        error_message: txt.slice(0, 500),
        version_id: effectiveVersionId,
        ab_test_id: abTestId,
        ab_variant: abVariant,
      });
      return { ok: false, reason: `gateway_${res.status}` };
    }

    body = (await res.json()) as typeof body;
    choice = body.choices?.[0]?.message;
    textReply = choice?.content?.trim() ?? "";
    toolCalls = choice?.tool_calls ?? [];
    totalTokensIn += body.usage?.prompt_tokens ?? 0;
    totalTokensOut += body.usage?.completion_tokens ?? 0;

    // Separa tool calls por tipo.
    const memCalls = toolCalls.filter((tc) => tc?.function?.name && MEMORY_TOOL_NAMES.has(tc.function.name));
    const hotmartCalls = hotmartEnabled
      ? toolCalls.filter((tc) => tc?.function?.name === "submit_hotmart_email")
      : [];
    const hasNeedHuman = toolCalls.some((tc) => tc?.function?.name === "need_human");

    // need_human ou nenhuma tool acionável → sai do loop.
    if (hasNeedHuman || (memCalls.length === 0 && hotmartCalls.length === 0)) break;

    const dispatchedCalls = [...memCalls, ...hotmartCalls];
    messages.push({
      role: "assistant",
      content: textReply || null,
      tool_calls: dispatchedCalls,
    });

    for (const tc of memCalls) {
      const result = await dispatchMemoryTool({
        brandId: conv.brand_id as string,
        agentId: a.id,
        contactId: conv.contact_id as string,
        sourceMessageId: null,
        toolName: tc.function?.name ?? "",
        rawArguments: tc.function?.arguments ?? "{}",
      });
      messages.push({
        role: "tool",
        tool_call_id: tc.id ?? `mem_${turn}_${Math.random().toString(36).slice(2, 8)}`,
        content: JSON.stringify(result),
      });
    }

    for (const tc of hotmartCalls) {
      let toolResult: { status: "aluno" | "lead"; matchedProductIds: string[]; error?: string } = {
        status: "lead",
        matchedProductIds: [],
      };
      try {
        const rawArgs = JSON.parse(tc.function?.arguments ?? "{}") as { email?: string };
        const email = String(rawArgs.email ?? "").trim().toLowerCase();
        const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
        if (!emailOk) {
          toolResult = { status: "lead", matchedProductIds: [], error: "invalid_email" };
        } else if (!conv.contact_id) {
          toolResult = { status: "lead", matchedProductIds: [], error: "no_contact" };
        } else {
          // Persistir e-mail em contacts.metadata.email (merge preservando chaves).
          const { data: cRow } = await supabaseAdmin
            .from("contacts")
            .select("metadata")
            .eq("id", conv.contact_id as string)
            .maybeSingle();
          const prevMeta = ((cRow as any)?.metadata ?? {}) as Record<string, unknown>;
          await supabaseAdmin
            .from("contacts")
            .update({ metadata: { ...prevMeta, email } })
            .eq("id", conv.contact_id as string);

          const r = await validateEllieBuyer({
            brandId: a.brand_id as string,
            email,
            forceRefresh: true,
          });
          toolResult = { status: r.status, matchedProductIds: r.matchedProductIds };
          buyerStatus = r.status;

          if (r.status === "aluno") {
            // Reverte HARD OVERRIDE de MODO VENDAS/OFERTA para o restante do turno:
            // reescreve o system prompt inicial para a Ellie normal (professora),
            // já que o messages[0] pode ter sido setado como MODO OFERTA no início.
            leadExhausted = false;
            leadBlock = "";
            leadOfferPromptEffective = "";
            leadCatalog = "";
            const freshBuyerBlock = buildBuyerStatusBlock({
              status: "aluno",
              source: r.source,
              matchedProductIds: r.matchedProductIds,
            });
            const ellieSystemPrompt = [
              replaced,
              memoryHint,
              memoryBlock,
              freshBuyerBlock,
              contextBlock,
            ]
              .filter((p) => p && p.trim().length > 0)
              .join("\n\n");
            if (messages[0]?.role === "system") {
              messages[0] = { ...messages[0], content: ellieSystemPrompt };
            } else {
              messages.unshift({ role: "system", content: ellieSystemPrompt });
            }
            // Refletir novo status como system message para o próximo turno.
            messages.push({
              role: "system",
              content:
                "[STATUS ATUALIZADO] O e-mail foi VALIDADO na Hotmart — o contato agora é ALUNO. Descarte quaisquer instru\u00e7\u00f5es anteriores de MODO VENDAS/OFERTA. Agrade\u00e7a e retome a aula normalmente, no idioma e m\u00e9todo habituais da Ellie (ingl\u00eas). N\u00c3O ofere\u00e7a produtos e N\u00c3O responda em portugu\u00eas.",
            });

          } else {
            // Modo Vendas: injeta catálogo + regras e força leadExhausted no envio.
            leadExhausted = true;
            try {
              const { data: offers } = await supabaseAdmin
                .from("ellie_lead_offers")
                .select("title, description, checkout_url")
                .eq("agent_id", a.id)
                .eq("active", true)
                .order("sort_order", { ascending: true });
              leadCatalog =
                (offers ?? [])
                  .map((o: any, i: number) => {
                    const lines = [`${i + 1}. ${o.title}`];
                    if (o.description) lines.push(`   ${o.description}`);
                    if (o.checkout_url) lines.push(`   Link: ${o.checkout_url}`);
                    return lines.join("\n");
                  })
                  .join("\n\n") || "(nenhum produto cadastrado)";
            } catch {
              leadCatalog = leadCatalog || "(catálogo indisponível)";
            }
            leadOfferPromptEffective =
              (a.lead_offer_prompt ?? "").trim() ||
              [
                "Você é a Ellie no MODO VENDAS. O e-mail informado NÃO possui compra ativa na Hotmart.",
                "REGRAS INEGOCIÁVEIS:",
                "- NÃO dê aulas, correções gramaticais, dicas ou continuação de tópicos anteriores.",
                "- Responda SEMPRE em português, apenas texto.",
                "- Apresente as ofertas do catálogo abaixo e envie o link de checkout.",
                "- NÃO transfira para humano; NÃO chame need_human.",
                "- Se o paciente insistir em outro assunto, recuse educadamente e reforce a oferta.",
              ].join("\n");
            messages.push({
              role: "system",
              content: [
                "[MODO VENDAS — HARD OVERRIDE]",
                "A validação Hotmart do e-mail informado retornou LEAD (sem compra ativa).",
                leadOfferPromptEffective,
                "",
                "[CATÁLOGO DE OFERTAS]",
                leadCatalog,
              ].join("\n"),
            });
            console.log("[ai-agent] hotmart validation = lead → sales mode", {
              agentId: a.id,
              contactId: conv.contact_id,
            });
          }
        }
      } catch (e) {
        toolResult = { status: "lead", matchedProductIds: [], error: (e as Error).message };
        console.error("[ai-agent] submit_hotmart_email failed", e);
      }
      messages.push({
        role: "tool",
        tool_call_id: tc.id ?? `htm_${turn}_${Math.random().toString(36).slice(2, 8)}`,
        content: JSON.stringify(toolResult),
      });
    }
    // Continue to next turn so the model produces the final reply.
  }




  // Parse need_human tool call (priority over text reply)
  let escalation: { reason: string; track: "vendas" | "suporte"; messageToPatient: string } | null = null;
  for (const tc of toolCalls) {
    if (tc?.function?.name === "need_human") {
      try {
        const args = JSON.parse(tc.function.arguments ?? "{}") as {
          reason?: string;
          escalation_track?: string;
          message_to_patient?: string;
        };
        const track = args.escalation_track === "vendas" ? "vendas" : "suporte";
        escalation = {
          reason: String(args.reason ?? "pediu_humano"),
          track,
          messageToPatient: String(args.message_to_patient ?? "").trim(),
        };
      } catch (e) {
        console.error("[ai-agent] failed to parse need_human args", e);
      }
      break;
    }
  }

  // Guarda-rail: nunca escalar só porque a última mensagem do paciente foi áudio
  // ou imagem (quando visão está ligada). Se o modelo insistir em chamar
  // need_human nesses casos, descartamos a escalação e seguimos com o textReply.
  const lastInbound = [...history].reverse().find((m) => (m.direction as string) === "inbound");
  const lastInboundIsAudio = !!(lastInbound && lastInbound.type === "audio");
  const lastInboundIsImage = !!(lastInbound && (lastInbound.type === "image" || lastInbound.type === "sticker"));
  if (escalation && (lastInboundIsAudio || (visionEnabled && lastInboundIsImage))) {
    console.warn("[ai-agent] dropping need_human escalation triggered by media message", {
      reason: escalation.reason,
      track: escalation.track,
      media_type: lastInbound?.type,
      conversation_id: conversationId,
    });
    escalation = null;
  }

  // Guarda-rail Hotmart: nunca escalar quando o paciente acabou de mandar um
  // e-mail alegando ser aluno. O caminho correto é submit_hotmart_email.
  if (escalation && hotmartEnabled) {
    const lastInboundText =
      typeof lastInbound?.content === "string" ? (lastInbound!.content as string) : "";
    const hasEmail = /[^\s@]+@[^\s@]+\.[^\s@]+/.test(lastInboundText);
    const reasonLooksStudent = /aluno|hotmart|contexto_ausente/i.test(escalation.reason);
    if (hasEmail || reasonLooksStudent) {
      console.warn("[ai-agent] dropping need_human — student-claim path handled by submit_hotmart_email", {
        reason: escalation.reason,
        track: escalation.track,
        has_email: hasEmail,
        conversation_id: conversationId,
      });
      escalation = null;
    }
  }


  const rawReply = (escalation?.messageToPatient && escalation.messageToPatient.length > 0)
    ? escalation.messageToPatient
    : textReply;

  // Reescreve links da KB de produtos com UTMs configuradas + tracking_tag do agente.
  let reply = rawReply;
  if (rawReply) {
    try {
      const productLinks = await loadAgentProductLinks(a.id);
      reply = rewriteLinksInText({
        text: rawReply,
        matchProduct: (link) => matchProductForLink(link, productLinks),
        agentTrackingTag: a.tracking_tag ?? null,
      });
    } catch (e) {
      console.error("[ai-agent] tracking-link rewrite failed", e);
      reply = rawReply;
    }
  }

  const baseLog: LogAgentRunInput = {
    brand_id: conv.brand_id as string,
    agent_id: a.id,
    conversation_id: conversationId,
    contact_id: conv.contact_id as string | null,
    triggered_by: "message",
    status: "success",
    model: modelUsed,
    temperature: a.temperature ?? null,
    max_output_tokens: a.max_output_tokens ?? null,
    input_messages: messages,
    input_variables: variables,

    output_text: reply,
    tool_call: escalation
      ? { name: "need_human", reason: escalation.reason, escalation_track: escalation.track, message_to_patient: escalation.messageToPatient }
      : null,
    tokens_in: totalTokensIn || null,
    tokens_out: totalTokensOut || null,
    latency_ms: Date.now() - startedAt,
    escalation_track: escalation?.track ?? null,
    version_id: effectiveVersionId,
    ab_test_id: abTestId,
    ab_variant: abVariant,
  };

  if (!reply) {
    await logAgentRun({ ...baseLog, status: "error", error_code: "empty_reply" });
    return { ok: false, reason: "empty_reply" };
  }

  // Resolve channel + contact info p/ enviar via Meta
  const { data: chanRow } = await supabaseAdmin
    .from("brand_channels")
    .select("phone_number_id")
    .eq("id", conv.channel_id as string)
    .maybeSingle();
  const phoneNumberId = (chanRow as any)?.phone_number_id as string | null;

  const { data: secretRow } = await supabaseAdmin
    .from("channel_secrets")
    .select("system_user_token")
    .eq("channel_id", conv.channel_id as string)
    .maybeSingle();
  const token = (secretRow as any)?.system_user_token as string | null;

  const { data: contactRow } = await supabaseAdmin
    .from("contacts")
    .select("wa_id")
    .eq("id", conv.contact_id as string)
    .maybeSingle();
  const to = (contactRow as any)?.wa_id as string | null;

  // Webchat channels não têm phone_number_id/token/wa_id — entregam via polling.
  // Detecta o tipo do canal para pular o guard Meta abaixo.
  const { data: channelTypeRow } = await supabaseAdmin
    .from("brand_channels")
    .select("type")
    .eq("id", conv.channel_id as string)
    .maybeSingle();
  const isWebchatChannel = ((channelTypeRow as any)?.type as string | null) === "webchat";

  // Carrega config de humanização do workspace (default desligada).
  const { data: brandRow } = await supabaseAdmin
    .from("brands")
    .select("ai_humanize")
    .eq("id", conv.brand_id as string)
    .maybeSingle();
  const humanize = normalizeHumanizeConfig((brandRow as any)?.ai_humanize);

  // Carrega config de voz do agente. Sem linha, sem voice_id, ou send_mode='text' => fluxo atual (texto puro).
  const { data: voiceRow } = await supabaseAdmin
    .from("ai_agent_voice_configs")
    .select("voice_id, model_id, stability, similarity_boost, style, speed, send_mode")
    .eq("agent_id", a.id)
    .maybeSingle();
  const voiceSendMode = ((voiceRow as any)?.send_mode ?? "text") as
    | "text"
    | "audio"
    | "text_and_audio"
    | "llm_decides";
  const voiceCfg: VoiceConfig | null =
    voiceRow && (voiceRow as any).voice_id
      ? {
          voice_id: (voiceRow as any).voice_id,
          model_id: (voiceRow as any).model_id ?? "eleven_multilingual_v2",
          stability: Number((voiceRow as any).stability ?? 0.5),
          similarity_boost: Number((voiceRow as any).similarity_boost ?? 0.75),
          style: Number((voiceRow as any).style ?? 0),
          speed: Number((voiceRow as any).speed ?? 1.0),
        }
      : null;
  // llm_decides ainda não implementado: tratar como text_and_audio por padrão.
  // Se o último inbound foi áudio e há voiceCfg, força text_and_audio para que a
  // resposta espelhe o canal usado pelo paciente (texto + áudio + botão Help me).
  const inboundWasAudio = lastInboundIsAudio;
  const inboundWasImage = visionEnabled && lastInboundIsImage;
  const baseEffectiveSendMode = voiceCfg
    ? voiceSendMode === "llm_decides"
      ? "text_and_audio"
      : voiceSendMode
    : "text";
  const effectiveSendMode = leadExhausted
    ? "text"
    : voiceCfg && (inboundWasAudio || inboundWasImage)
      ? "text_and_audio"
      : baseEffectiveSendMode;
  if (leadExhausted) {
    console.log("[ai-agent] lead mode = offer", { agentId: a.id, mode: "hard-override", tts: "skipped" });
  }
  const sendText = effectiveSendMode !== "audio";
  const sendAudio = effectiveSendMode === "audio" || effectiveSendMode === "text_and_audio";

  const parts = humanize.enabled ? splitReply(reply, humanize) : [reply];
  const totalParts = parts.length;

  if (!isWebchatChannel && (!phoneNumberId || !token || !to)) {
    // Registra ao menos a falha em uma row pra o admin ver no histórico.
    const { data: failRow } = await supabaseAdmin
      .from("messages")
      .insert({
        brand_id: conv.brand_id as string,
        conversation_id: conversationId,
        channel_id: conv.channel_id as string,
        direction: "outbound",
        type: "text",
        content: reply,
        status: "failed",
        error_code: "AI_SEND_CONFIG",
        error_message: "Canal sem phone_number_id/token ou contato sem wa_id.",
        sent_by: null,
        raw: { ai_agent_id: a.id, ai_agent_name: a.name },
      })
      .select("id")
      .single();
    await logAgentRun({
      ...baseLog,
      status: "error",
      error_code: "AI_SEND_CONFIG",
      error_message: "Canal sem phone_number_id/token ou contato sem wa_id.",
    });
    return { ok: false, reason: "send_config_missing" };
  }

  // Entrega robusta: a IA apenas planeja a resposta e grava jobs persistentes.
  // O cron envia texto → última mensagem com botão → áudio em ciclos separados,
  // com retry/backoff e sem depender do tempo de vida desta execução.
  {
    const attachHelpMeForQueue = !escalation && !!a.help_me_enabled && sendText && !leadExhausted;
    const textParts = parts.map((partText, i) => {
      const rawDelayMs = humanize.enabled ? computeDelay(partText, i, humanize) : 0;
      const delayMs = inboundWasAudio || inboundWasImage
        ? Math.min(rawDelayMs, i === totalParts - 1 && attachHelpMeForQueue ? 200 : 350)
        : rawDelayMs;
      return {
        text: partText,
        partIndex: i,
        totalParts,
        delayMs,
        rawDelayMs,
      };
    });
    let queued: { groupId: string; queued: number; lastMessageId: string | null };
    try {
      queued = await enqueueAgentDeliveryJobs({
        conversationId,
        brandId: conv.brand_id as string,
        channelId: conv.channel_id as string | null,
        agentId: a.id,
        agentName: a.name,
        textParts,
        sendText,
        attachHelpMe: attachHelpMeForQueue,
        audioText: sendAudio && voiceCfg && !escalation ? reply : null,
        voiceCfg: sendAudio && voiceCfg && !escalation ? voiceCfg : null,
        extraRaw: escalation ? { escalation: { reason: escalation.reason, track: escalation.track } } : {},
      });
    } catch (enqueueErr) {
      const errMsg = (enqueueErr as Error)?.message ?? String(enqueueErr);
      await logDeliveryEnqueueError({
        brandId: conv.brand_id as string,
        conversationId,
        groupId: "unknown",
        stage: "caller_abort",
        sequence: -1,
        totalParts,
        error: enqueueErr,
      });
      await logAgentRun({
        ...baseLog,
        status: "error",
        error_code: "DELIVERY_ENQUEUE_ABORT",
        error_message: errMsg.slice(0, 500),
      });
      throw enqueueErr;
    }

    await supabaseAdmin.rpc("reopen_conversation_on_outbound", {
      _conv_id: conversationId,
      _actor_id: null as unknown as string,
      _by: "ai_agent_message",
    });

    if (escalation) {
      const targetUserId =
        escalation.track === "vendas"
          ? a.escalation_target_vendas
          : a.escalation_target_suporte;

      const convUpdate: { ai_agent_id: null; assigned_to?: string } = { ai_agent_id: null };
      if (targetUserId) convUpdate.assigned_to = targetUserId;

      await supabaseAdmin.from("conversations").update(convUpdate).eq("id", conversationId);
      await supabaseAdmin
        .from("ai_agent_pending_runs")
        .delete()
        .eq("conversation_id", conversationId);
      await supabaseAdmin.from("conversation_events").insert({
        conversation_id: conversationId,
        event_type: "ai_escalation",
        payload: {
          reason: escalation.reason,
          escalation_track: escalation.track,
          target_user_id: targetUserId,
          ai_agent_id: a.id,
          ai_agent_name: a.name,
          delivery_group_id: queued.groupId,
          ...(targetUserId ? {} : { fallback_reason: "missing_escalation_target" }),
        },
      });
      if (!targetUserId) {
        console.warn("[ai-agent] escalation without target", {
          conversationId,
          track: escalation.track,
        });
      }
      await logAgentRun({ ...baseLog, status: "escalated" });
      return { ok: true, reason: `escalated_${escalation.track}` };
    }

    await logAgentRun({ ...baseLog, status: "success" });
    return { ok: true, reason: "delivery_jobs_queued" };
  }


}

export async function drainAgentPendingRuns(maxItems = 20): Promise<{ processed: number; results: Array<{ conversation_id: string; ok: boolean; reason?: string }> }> {
  const nowIso = new Date().toISOString();
  const { data: rows, error } = await supabaseAdmin
    .from("ai_agent_pending_runs")
    .select("conversation_id, run_after")
    .lte("run_after", nowIso)
    .order("run_after", { ascending: true })
    .limit(maxItems);
  if (error) throw new Error(error.message);

  console.log("[ai-agent] drain start", { picked: rows?.length ?? 0 });
  let processed = 0;
  const results: Array<{ conversation_id: string; ok: boolean; reason?: string }> = [];
  for (const row of rows ?? []) {
    const cid = row.conversation_id as string;
    // Claim atômico: DELETE…RETURNING garante que apenas UM worker pega a linha
    // mesmo se dois ticks do cron rodarem em paralelo. Workers que perdem a
    // corrida recebem rowcount=0 e pulam o item — sem dupla execução do agente.
    const { data: claimed, error: claimErr } = await supabaseAdmin
      .from("ai_agent_pending_runs")
      .delete()
      .eq("conversation_id", cid)
      .lte("run_after", nowIso)
      .select("conversation_id");
    if (claimErr) {
      console.error("[ai-agent] drain claim failed", cid, claimErr.message);
      results.push({ conversation_id: cid, ok: false, reason: claimErr.message });
      continue;
    }
    if (!claimed || claimed.length === 0) {
      console.log("[ai-agent] drain skip: already claimed by another worker", cid);
      results.push({ conversation_id: cid, ok: false, reason: "already_claimed" });
      continue;
    }
    try {
      const r = await runAgentForConversation(cid);
      console.log("[ai-agent] drain item", cid, r);
      results.push({ conversation_id: cid, ...r });
      processed++;
    } catch (e) {
      const reason = (e as Error).message;
      console.error("[ai-agent] drain item failed", cid, reason);
      results.push({ conversation_id: cid, ok: false, reason });
    }
  }

  return { processed, results };
}

type SendConfig = { phoneNumberId: string; token: string; to: string; channelId: string };

type DeliveryJobKind = "text" | "interactive_help_me" | "audio";

type DeliveryPart = {
  text: string;
  partIndex?: number;
  totalParts?: number;
  delayMs?: number;
  rawDelayMs?: number;
};

type DeliveryJobRow = {
  id: string;
  conversation_id: string;
  brand_id: string;
  agent_id: string;
  channel_id: string | null;
  message_id: string | null;
  group_id: string;
  job_kind: DeliveryJobKind;
  sequence: number;
  status: string;
  content: string;
  payload: any;
  attempts: number;
  max_attempts: number;
  created_at: string;
  locked_at: string | null;
};

function buildVoicePayload(voice: VoiceConfig): any {
  return {
    provider: "elevenlabs",
    voice_id: voice.voice_id,
    model_id: normalizeDeliveryVoiceConfig(voice).model_id,
    stability: voice.stability,
    similarity_boost: voice.similarity_boost,
    style: voice.style,
    speed: voice.speed,
  };
}

function normalizeDeliveryVoiceConfig(voice: VoiceConfig): VoiceConfig {
  return {
    ...voice,
    model_id: voice.model_id === "eleven_multilingual_v2" || !voice.model_id
      ? "eleven_turbo_v2_5"
      : voice.model_id,
  };
}

function buildTextMessageBody(to: string, text: string): unknown {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { body: text, preview_url: true },
  };
}

function nextDeliveryRunAfter(attemptNo: number): string {
  const delayMs = Math.min(5 * 60_000, Math.max(2_000, 2_000 * Math.pow(2, Math.max(0, attemptNo - 1))));
  return new Date(Date.now() + delayMs).toISOString();
}

const MAX_INLINE_AUDIO_BASE64_CHARS = 12_000_000;

function audioBufferToBase64(audio: ArrayBuffer | Uint8Array): string {
  const bytes = audio instanceof Uint8Array ? audio : new Uint8Array(audio);
  return Buffer.from(bytes).toString("base64");
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const bytes = Buffer.from(base64, "base64");
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function stripInlineAudioPayload(payload: any): any {
  const next = { ...(payload ?? {}) };
  delete next.audio_base64;
  delete next.audio_mime;
  return next;
}

async function logDeliveryEnqueueError(args: {
  brandId: string;
  conversationId: string;
  groupId: string;
  stage: "text_message_insert" | "text_job_insert" | "audio_message_insert" | "audio_job_insert" | "loop_abort" | "caller_abort" | "webchat_text_insert";
  sequence: number;
  totalParts?: number;
  error: unknown;
}): Promise<void> {
  try {
    const err = args.error as Error | undefined;
    const msg = err?.message ?? String(args.error ?? "unknown");
    await supabaseAdmin.from("error_logs").insert({
      severity: "error",
      category: "internal",
      code: "DELIVERY_ENQUEUE_ABORT",
      message_pt: "Falha ao enfileirar mensagens da IA. Parte da resposta pode não ter sido enviada.",
      technical_message: msg.slice(0, 500),
      brand_id: args.brandId,
      conversation_id: args.conversationId,
      payload: {
        stage: args.stage,
        group_id: args.groupId,
        sequence: args.sequence,
        total_parts: args.totalParts ?? null,
        error_name: err?.name ?? null,
        error_stack: err?.stack?.slice(0, 1500) ?? null,
      },
    } as never);
  } catch (e) {
    console.error("[ai-agent] logDeliveryEnqueueError failed", (e as Error).message);
  }
}

async function enqueueAgentDeliveryJobs(args: {
  conversationId: string;
  brandId: string;
  channelId: string | null;
  agentId: string;
  agentName: string;
  textParts: DeliveryPart[];
  sendText: boolean;
  attachHelpMe: boolean;
  audioText?: string | null;
  voiceCfg?: VoiceConfig | null;
  extraRaw?: Record<string, unknown>;
}): Promise<{ groupId: string; queued: number; lastMessageId: string | null }> {
  const groupId = crypto.randomUUID();
  let sequence = 0;
  let queued = 0;
  let lastMessageId: string | null = null;
  let lastTextMessageId: string | null = null;

  // Detect channel type — webchat channels bypass Meta delivery jobs entirely
  // and deliver outbound text directly via the polling endpoint.
  let channelType: string | null = null;
  if (args.channelId) {
    const { data: chRow } = await supabaseAdmin
      .from("brand_channels")
      .select("type")
      .eq("id", args.channelId)
      .maybeSingle();
    channelType = ((chRow as any)?.type as string | null) ?? null;
  }
  const isWebchat = channelType === "webchat";

  if (isWebchat && args.sendText) {
    for (let i = 0; i < args.textParts.length; i++) {
      const part = args.textParts[i];
      const text = String(part.text ?? "").trim();
      if (!text) continue;
      const raw = {
        ai_agent_id: args.agentId,
        ai_agent_name: args.agentName,
        delivery_group_id: groupId,
        delivery_sequence: sequence,
        delivery_channel: "webchat",
        ...args.extraRaw,
      };
      const { data: msgRow, error: msgErr } = await supabaseAdmin
        .from("messages")
        .insert({
          brand_id: args.brandId,
          conversation_id: args.conversationId,
          channel_id: args.channelId,
          direction: "outbound",
          type: "text",
          content: text,
          status: "delivered",
          sent_by: null,
          raw,
        })
        .select("id, created_at")
        .single();
      if (msgErr || !msgRow) {
        console.error("[ai-agent] webchat outbound insert failed", msgErr?.message);
        await logDeliveryEnqueueError({
          brandId: args.brandId,
          conversationId: args.conversationId,
          groupId,
          stage: "webchat_text_insert",
          sequence,
          totalParts: part.totalParts,
          error: msgErr ?? new Error("messages.insert returned no row"),
        });
        continue;
      }
      lastMessageId = (msgRow as any).id as string;
      lastTextMessageId = lastMessageId;
      await supabaseAdmin
        .from("conversations")
        .update({ last_message_at: (msgRow as any).created_at })
        .eq("id", args.conversationId);
      queued++;
      sequence++;
    }
    // Silence unused-var warning for lastTextMessageId in webchat branch.
    void lastTextMessageId;
    console.log("[ai-agent] webchat outbound queued", {
      conversationId: args.conversationId,
      groupId,
      queued,
    });
    return { groupId, queued, lastMessageId };
  }


  if (args.sendText) {
    for (let i = 0; i < args.textParts.length; i++) {
      const part = args.textParts[i];
      const text = String(part.text ?? "").trim();
      if (!text) continue;
      try {
        const isLast = i === args.textParts.length - 1;
        const sendAsHelpMeList = isLast && args.attachHelpMe;
        const humanizeRaw = part.totalParts && part.totalParts > 1
          ? {
              humanize: {
                part_index: part.partIndex ?? i,
                total_parts: part.totalParts,
                delay_ms: part.delayMs ?? 0,
                ...(part.rawDelayMs != null && part.rawDelayMs !== part.delayMs ? { raw_delay_ms: part.rawDelayMs } : {}),
              },
            }
          : {};
        const raw = {
          ai_agent_id: args.agentId,
          ai_agent_name: args.agentName,
          delivery_managed: true,
          delivery_group_id: groupId,
          delivery_sequence: sequence,
          ...args.extraRaw,
          ...humanizeRaw,
          ...(sendAsHelpMeList
            ? {
                help_me_attached: true,
                help_me_expected: true,
                help_me_send_type: "interactive_list",
                help_me_stage: "queued_for_delivery_job",
              }
            : {}),
        };
        const { data: msgRow, error: msgErr } = await supabaseAdmin
          .from("messages")
          .insert({
            brand_id: args.brandId,
            conversation_id: args.conversationId,
            channel_id: args.channelId,
            direction: "outbound",
            type: sendAsHelpMeList ? "interactive" : "text",
            content: text,
            status: "queued",
            sent_by: null,
            raw,
          })
          .select("id")
          .single();
        if (msgErr || !msgRow) {
          console.error("[ai-agent] delivery message insert failed", msgErr?.message);
          await logDeliveryEnqueueError({
            brandId: args.brandId,
            conversationId: args.conversationId,
            groupId,
            stage: "text_message_insert",
            sequence,
            totalParts: part.totalParts,
            error: msgErr ?? new Error("messages.insert returned no row"),
          });
          continue;
        }
        const messageId = (msgRow as any).id as string;
        lastMessageId = messageId;
        lastTextMessageId = messageId;
        const { data: jobRow, error: jobErr } = await supabaseAdmin
          .from("ai_agent_delivery_jobs")
          .insert({
            conversation_id: args.conversationId,
            brand_id: args.brandId,
            agent_id: args.agentId,
            channel_id: args.channelId,
            message_id: messageId,
            group_id: groupId,
            job_kind: sendAsHelpMeList ? "interactive_help_me" : "text",
            sequence,
            content: text,
            payload: { agent_name: args.agentName, ...humanizeRaw, fallback_to_text: sendAsHelpMeList },
            status: "pending",
          })
          .select("id")
          .single();
        if (jobErr || !jobRow) {
          console.error("[ai-agent] delivery job insert failed", jobErr?.message);
          await supabaseAdmin
            .from("messages")
            .update({ status: "failed", error_code: "DELIVERY_JOB_INSERT", error_message: jobErr?.message ?? "Falha ao criar job." })
            .eq("id", messageId);
          await logDeliveryEnqueueError({
            brandId: args.brandId,
            conversationId: args.conversationId,
            groupId,
            stage: "text_job_insert",
            sequence,
            totalParts: part.totalParts,
            error: jobErr ?? new Error("delivery_jobs.insert returned no row"),
          });
          continue;
        }
        await supabaseAdmin
          .from("messages")
          .update({ raw: { ...raw, delivery_job_id: (jobRow as any).id } })
          .eq("id", messageId);
        queued++;
        sequence++;
      } catch (iterErr) {
        await logDeliveryEnqueueError({
          brandId: args.brandId,
          conversationId: args.conversationId,
          groupId,
          stage: "loop_abort",
          sequence,
          totalParts: part.totalParts,
          error: iterErr,
        });
        throw iterErr;
      }
    }
  }


  const audioText = String(args.audioText ?? "").trim();
  if (audioText && args.voiceCfg) {
    try {
      const voice = buildVoicePayload(args.voiceCfg);
      const raw = {
        ai_agent_id: args.agentId,
        ai_agent_name: args.agentName,
        delivery_managed: true,
        delivery_group_id: groupId,
        delivery_sequence: sequence,
        ...args.extraRaw,
        voice,
        source_text_message_id: lastTextMessageId,
        tts_stage: "queued_for_delivery_job",
      };
      const { data: msgRow, error: msgErr } = await supabaseAdmin
        .from("messages")
        .insert({
          brand_id: args.brandId,
          conversation_id: args.conversationId,
          channel_id: args.channelId,
          direction: "outbound",
          type: "audio",
          content: audioText,
          status: "queued",
          sent_by: null,
          raw,
        })
        .select("id")
        .single();
      if (msgErr || !msgRow) {
        console.error("[ai-agent] delivery audio message insert failed", msgErr?.message);
        await logDeliveryEnqueueError({
          brandId: args.brandId,
          conversationId: args.conversationId,
          groupId,
          stage: "audio_message_insert",
          sequence,
          error: msgErr ?? new Error("audio messages.insert returned no row"),
        });
      } else {
        const messageId = (msgRow as any).id as string;
        lastMessageId = messageId;
        const { data: jobRow, error: jobErr } = await supabaseAdmin
          .from("ai_agent_delivery_jobs")
          .insert({
            conversation_id: args.conversationId,
            brand_id: args.brandId,
            agent_id: args.agentId,
            channel_id: args.channelId,
            message_id: messageId,
            group_id: groupId,
            job_kind: "audio",
            sequence,
            content: audioText,
            payload: { agent_name: args.agentName, voice, source_text_message_id: lastTextMessageId },
            status: "pending",
          })
          .select("id")
          .single();
        if (jobErr || !jobRow) {
          console.error("[ai-agent] delivery audio job insert failed", jobErr?.message);
          await supabaseAdmin
            .from("messages")
            .update({ status: "failed", error_code: "DELIVERY_JOB_INSERT", error_message: jobErr?.message ?? "Falha ao criar job de áudio." })
            .eq("id", messageId);
          await logDeliveryEnqueueError({
            brandId: args.brandId,
            conversationId: args.conversationId,
            groupId,
            stage: "audio_job_insert",
            sequence,
            error: jobErr ?? new Error("audio delivery_jobs.insert returned no row"),
          });
        } else {
          const jobId = (jobRow as any).id as string;
          await supabaseAdmin
            .from("messages")
            .update({ raw: { ...raw, delivery_job_id: jobId } })
            .eq("id", messageId);
          queued++;
          // Prefetch best-effort: gera TTS em background e salva base64 no payload.
          // Quando o worker pegar o job, só precisará fazer upload+envio (~2s),
          // em vez de também aguardar a geração (~3–5s adicionais).
          const voiceForPrefetch = args.voiceCfg;
          const prefetchPromise = (async () => {
            try {
              const audioBuf = await generateTtsWithRetry(audioText, voiceForPrefetch, 1);
              const base64 = audioBufferToBase64(audioBuf);
              if (base64.length > MAX_INLINE_AUDIO_BASE64_CHARS) return;
              await supabaseAdmin
                .from("ai_agent_delivery_jobs")
                .update({
                  payload: {
                    agent_name: args.agentName,
                    voice,
                    source_text_message_id: lastTextMessageId,
                    audio_base64: base64,
                    audio_mime: "audio/ogg",
                    audio_generated_at: new Date().toISOString(),
                    prefetched: true,
                  },
                } as never)
                .eq("id", jobId)
                .eq("status", "pending");
            } catch (e) {
              console.warn("[ai-agent] prefetch TTS failed", (e as Error).message);
            }
          })();
          // Aguarda no máximo ~6s para tentar economizar 1 ciclo de cron; se
          // demorar mais, segue sem bloquear o turno — o worker assume a geração.
          await Promise.race([
            prefetchPromise,
            new Promise<void>((resolve) => setTimeout(resolve, 6_000)),
          ]);
        }
      }
    } catch (audioErr) {
      await logDeliveryEnqueueError({
        brandId: args.brandId,
        conversationId: args.conversationId,
        groupId,
        stage: "loop_abort",
        sequence,
        error: audioErr,
      });
      throw audioErr;
    }
  }


  console.log("[ai-agent] delivery jobs queued", { conversationId: args.conversationId, groupId, queued });
  return { groupId, queued, lastMessageId };
}

async function markDeliveryJobRetry(args: {
  job: DeliveryJobRow;
  messageId?: string | null;
  code: string;
  message: string;
  terminal?: boolean;
  rawPatch?: Record<string, unknown>;
  attemptAlreadyCounted?: boolean;
}): Promise<void> {
  const attemptAlreadyCounted = args.attemptAlreadyCounted ?? args.job.job_kind === "audio";
  const nextAttempts = Number(args.job.attempts ?? 0) + (attemptAlreadyCounted ? 0 : 1);
  const terminal = !!args.terminal || nextAttempts >= Number(args.job.max_attempts ?? 5);
  await supabaseAdmin
    .from("ai_agent_delivery_jobs")
    .update({
      status: terminal ? "failed" : "pending",
      attempts: nextAttempts,
      locked_at: null,
      run_after: terminal ? new Date().toISOString() : nextDeliveryRunAfter(nextAttempts),
      error_code: args.code,
      error_message: args.message.slice(0, 500),
    })
    .eq("id", args.job.id);
  if (args.messageId) {
    const patch: Record<string, unknown> = {
      status: terminal ? "failed" : "queued",
      error_code: args.code,
      error_message: args.message.slice(0, 500),
    };
    if (args.rawPatch) patch.raw = args.rawPatch;
    await supabaseAdmin.from("messages").update(patch as never).eq("id", args.messageId);
  }
}

async function markDeliveryJobSent(args: {
  jobId: string;
  messageId?: string | null;
  waMessageId?: string | null;
  raw?: any;
  type?: "text" | "interactive" | "audio";
}): Promise<void> {
  await supabaseAdmin
    .from("ai_agent_delivery_jobs")
    .update({
      status: "sent",
      locked_at: null,
      sent_at: new Date().toISOString(),
      error_code: null,
      error_message: null,
    })
    .eq("id", args.jobId);
  if (args.messageId) {
    await supabaseAdmin
      .from("messages")
      .update({
        status: "sent",
        wa_message_id: args.waMessageId ?? null,
        error_code: null,
        error_message: null,
        ...(args.type ? { type: args.type } : {}),
        ...(args.raw ? { raw: args.raw } : {}),
      } as never)
      .eq("id", args.messageId);
  }
}

async function processAgentDeliveryJob(job: DeliveryJobRow): Promise<{ ok: boolean; reason?: string }> {
  const { data: priorJobs, error: priorErr } = await supabaseAdmin
    .from("ai_agent_delivery_jobs")
    .select("id, status, sequence")
    .eq("group_id", job.group_id)
    .lt("sequence", job.sequence)
    .order("sequence", { ascending: true });
  if (priorErr) throw new Error(priorErr.message);
  const blocking = (priorJobs ?? []).find((p: any) => p.status !== "sent");
  if (blocking) {
    if ((blocking as any).status === "failed" || (blocking as any).status === "cancelled") {
      await markDeliveryJobRetry({
        job,
        messageId: job.message_id,
        code: "PRIOR_JOB_FAILED",
        message: "Entrega anterior da mesma resposta falhou; esta parte foi cancelada para manter a ordem.",
        terminal: true,
      });
      return { ok: false, reason: "prior_job_failed" };
    }
    await supabaseAdmin
      .from("ai_agent_delivery_jobs")
      .update({ status: "pending", locked_at: null, run_after: new Date(Date.now() + 3_000).toISOString() })
      .eq("id", job.id);
    return { ok: false, reason: "waiting_prior_job" };
  }

  const { data: msgRow } = job.message_id
    ? await supabaseAdmin
        .from("messages")
        .select("id, type, content, raw, created_at")
        .eq("id", job.message_id)
        .maybeSingle()
    : { data: null } as any;
  const msgRaw = ((msgRow as any)?.raw ?? {}) as any;
  const text = String((msgRow as any)?.content ?? job.content ?? "").trim();
  if (!text) {
    await markDeliveryJobRetry({ job, messageId: job.message_id, code: "EMPTY_CONTENT", message: "Job sem conteúdo para enviar.", terminal: true });
    return { ok: false, reason: "empty_content" };
  }

  const cfg = await resolveSendConfigForConversation({ conversationId: job.conversation_id, channelId: job.channel_id });
  if (!cfg) {
    await markDeliveryJobRetry({ job, messageId: job.message_id, code: "AI_SEND_CONFIG", message: "Configuração de envio ausente.", terminal: true });
    return { ok: false, reason: "send_config_missing" };
  }

  if (job.job_kind === "text" || job.job_kind === "interactive_help_me") {
    const shouldSendInteractive = job.job_kind === "interactive_help_me";
    const metaRes = await postMetaMessageWithTimeout({
      phoneNumberId: cfg.phoneNumberId,
      token: cfg.token,
      body: shouldSendInteractive ? buildHelpMeListBody(cfg.to, text) : buildTextMessageBody(cfg.to, text),
      timeoutMs: shouldSendInteractive ? 6_000 : META_MESSAGE_TIMEOUT_MS,
    });
    if (metaRes.ok) {
      await markDeliveryJobSent({
        jobId: job.id,
        messageId: job.message_id,
        waMessageId: metaRes.json?.messages?.[0]?.id ?? null,
        type: shouldSendInteractive ? "interactive" : "text",
        raw: shouldSendInteractive ? { ...msgRaw, help_me_stage: "delivery_job_sent_to_meta" } : { ...msgRaw, delivery_stage: "sent_to_meta" },
      });
      return { ok: true };
    }

    if (shouldSendInteractive) {
      const fallbackRes = await postMetaMessageWithTimeout({
        phoneNumberId: cfg.phoneNumberId,
        token: cfg.token,
        body: buildTextMessageBody(cfg.to, text),
        timeoutMs: META_MESSAGE_TIMEOUT_MS,
      });
      if (fallbackRes.ok) {
        await markDeliveryJobSent({
          jobId: job.id,
          messageId: job.message_id,
          waMessageId: fallbackRes.json?.messages?.[0]?.id ?? null,
          type: "text",
          raw: {
            ...msgRaw,
            help_me_stage: "delivery_job_fallback_text_sent",
            help_me_fallback_text: true,
            failed_help_me_error: { code: metaRes.code, message: metaRes.message },
          },
        });
        return { ok: true, reason: "interactive_fallback_text_sent" };
      }
      await markDeliveryJobRetry({
        job,
        messageId: job.message_id,
        code: String(fallbackRes.code ?? metaRes.code ?? "META_ERR"),
        message: String(fallbackRes.message ?? metaRes.message ?? "Falha ao enviar mensagem interativa e fallback."),
        rawPatch: { ...msgRaw, help_me_stage: "delivery_job_failed" },
      });
      return { ok: false, reason: fallbackRes.code ?? metaRes.code ?? "meta_failed" };
    }

    await markDeliveryJobRetry({
      job,
      messageId: job.message_id,
      code: String(metaRes.code ?? "META_ERR"),
      message: String(metaRes.message ?? "Falha ao enviar texto."),
      rawPatch: { ...msgRaw, delivery_stage: "failed" },
    });
    return { ok: false, reason: metaRes.code ?? "meta_failed" };
  }

  if (job.job_kind === "audio") {
    const voiceCfgRaw = voiceConfigFromRaw(msgRaw) ?? voiceConfigFromRaw(job.payload ?? {});
    const voiceCfg = voiceCfgRaw ? normalizeDeliveryVoiceConfig(voiceCfgRaw) : null;
    if (!voiceCfg) {
      await markDeliveryJobRetry({ job, messageId: job.message_id, code: "TTS_CONFIG", message: "Áudio sem configuração de voz.", terminal: true });
      return { ok: false, reason: "tts_config_missing" };
    }
    const payload = (job.payload ?? {}) as any;
    let mediaId = (msgRaw?.meta_media_id as string | undefined) || (payload?.meta_media_id as string | undefined) || null;
    let inlineAudioBase64 = typeof payload?.audio_base64 === "string" ? payload.audio_base64 : null;
    let nextRaw: Record<string, unknown> = {
      ...msgRaw,
      tts_stage: mediaId
        ? "delivery_job_reusing_meta_media"
        : inlineAudioBase64
          ? "delivery_job_audio_generated"
          : "delivery_job_generating",
      tts_stage_at: new Date().toISOString(),
      voice: buildVoicePayload(voiceCfg),
    };
    await supabaseAdmin.from("messages").update({ raw: nextRaw } as never).eq("id", job.message_id as string);

    // Etapa 1 — gerar TTS se ainda não houver
    if (!mediaId && !inlineAudioBase64) {
      try {
        const audioBuf = await generateTtsWithRetry(text, voiceCfg, 1, 18_000);
        inlineAudioBase64 = audioBufferToBase64(audioBuf);
        if (inlineAudioBase64.length > MAX_INLINE_AUDIO_BASE64_CHARS) {
          throw new Error("Áudio gerado ficou grande demais para a fila persistente.");
        }
        nextRaw = { ...nextRaw, tts_stage: "delivery_job_audio_generated", tts_stage_at: new Date().toISOString() };
        await supabaseAdmin.from("messages").update({ raw: nextRaw } as never).eq("id", job.message_id as string);
      } catch (e) {
        const technical = String((e as Error).message ?? e);
        await markDeliveryJobRetry({
          job,
          messageId: job.message_id,
          code: "TTS_FAIL",
          message: technical,
          rawPatch: { ...nextRaw, tts_stage: "delivery_job_failed", tts_stage_at: new Date().toISOString() },
          attemptAlreadyCounted: true,
        });
        return { ok: false, reason: "tts_fail" };
      }
    }

    // Etapa 2 — upload para a Meta se ainda não houver media_id
    if (!mediaId && inlineAudioBase64) {
      try {
        nextRaw = { ...nextRaw, tts_stage: "delivery_job_uploading_to_meta", tts_stage_at: new Date().toISOString() };
        await supabaseAdmin.from("messages").update({ raw: nextRaw } as never).eq("id", job.message_id as string);
        mediaId = await uploadAudioToMeta({
          phoneNumberId: cfg.phoneNumberId,
          token: cfg.token,
          audio: base64ToArrayBuffer(inlineAudioBase64),
          mime: String(payload.audio_mime ?? "audio/ogg"),
        });
        nextRaw = { ...nextRaw, tts_stage: "delivery_job_uploaded_to_meta", tts_stage_at: new Date().toISOString(), meta_media_id: mediaId };
        await supabaseAdmin.from("messages").update({ raw: nextRaw } as never).eq("id", job.message_id as string);
        // Persiste o base64 + media_id no payload, para que um eventual retry
        // (caso o envio final falhe) já encontre o trabalho feito.
        await supabaseAdmin
          .from("ai_agent_delivery_jobs")
          .update({
            payload: {
              ...payload,
              audio_base64: inlineAudioBase64,
              audio_mime: payload.audio_mime ?? "audio/ogg",
              meta_media_id: mediaId,
              audio_uploaded_at: new Date().toISOString(),
            },
          } as never)
          .eq("id", job.id);
      } catch (e) {
        const technical = String((e as Error).message ?? e);
        // Salva o base64 antes de falhar para o retry pular a geração.
        await supabaseAdmin
          .from("ai_agent_delivery_jobs")
          .update({
            payload: {
              ...payload,
              audio_base64: inlineAudioBase64,
              audio_mime: payload.audio_mime ?? "audio/ogg",
            },
          } as never)
          .eq("id", job.id);
        await markDeliveryJobRetry({
          job,
          messageId: job.message_id,
          code: "TTS_UPLOAD_FAIL",
          message: technical,
          rawPatch: { ...nextRaw, tts_stage: "delivery_job_failed", tts_stage_at: new Date().toISOString() },
          attemptAlreadyCounted: true,
        });
        return { ok: false, reason: "tts_upload_fail" };
      }
    }

    if (!mediaId) {
      await markDeliveryJobRetry({
        job,
        messageId: job.message_id,
        code: "TTS_FAIL",
        message: "Meta media id ausente após geração/upload do áudio.",
        rawPatch: { ...nextRaw, tts_stage: "delivery_job_failed", tts_stage_at: new Date().toISOString() },
        attemptAlreadyCounted: true,
      });
      return { ok: false, reason: "tts_fail" };
    }

    // Etapa 3 — envio final
    nextRaw = { ...nextRaw, tts_stage: "delivery_job_sending_audio", tts_stage_at: new Date().toISOString(), meta_media_id: mediaId };
    await supabaseAdmin.from("messages").update({ raw: nextRaw } as never).eq("id", job.message_id as string);
    const sendRes = await sendWhatsappAudioByMediaId({ phoneNumberId: cfg.phoneNumberId, token: cfg.token, to: cfg.to, mediaId });
    if (!sendRes.ok) {
      // Garante que o media_id está persistido para o retry pular geração+upload.
      await supabaseAdmin
        .from("ai_agent_delivery_jobs")
        .update({
          payload: {
            ...stripInlineAudioPayload(payload),
            meta_media_id: mediaId,
          },
        } as never)
        .eq("id", job.id);
      await markDeliveryJobRetry({
        job,
        messageId: job.message_id,
        code: sendRes.error_code ?? "META_AUDIO_FAIL",
        message: sendRes.error_message ?? "Falha ao enviar áudio.",
        rawPatch: { ...nextRaw, tts_stage: "delivery_job_failed", tts_stage_at: new Date().toISOString() },
        attemptAlreadyCounted: true,
      });
      return { ok: false, reason: sendRes.error_code ?? "meta_audio_failed" };
    }
    await markDeliveryJobSent({
      jobId: job.id,
      messageId: job.message_id,
      waMessageId: sendRes.wa_message_id ?? null,
      type: "audio",
      raw: { ...nextRaw, tts_stage: "delivery_job_sent_to_meta", tts_stage_at: new Date().toISOString() },
    });
    return { ok: true };
  }

  await markDeliveryJobRetry({ job, messageId: job.message_id, code: "UNKNOWN_JOB_KIND", message: `Tipo de job desconhecido: ${job.job_kind}`, terminal: true });
  return { ok: false, reason: "unknown_job_kind" };
}

export async function drainAgentDeliveryJobs(maxItems = 3): Promise<{
  processed: number;
  results: Array<{ job_id: string; ok: boolean; reason?: string }>;
}> {
  const nowIso = new Date().toISOString();
  const staleLockIso = new Date(Date.now() - 45_000).toISOString();
  const { data: rows, error } = await supabaseAdmin
    .from("ai_agent_delivery_jobs")
    .select("id, conversation_id, brand_id, agent_id, channel_id, message_id, group_id, job_kind, sequence, status, content, payload, attempts, max_attempts, created_at, locked_at")
    .or(`and(status.eq.pending,run_after.lte.${nowIso}),and(status.eq.processing,locked_at.lt.${staleLockIso})`)
    .order("run_after", { ascending: true })
    .order("sequence", { ascending: true })
    .limit(Math.max(1, maxItems * 4));
  if (error) throw new Error(error.message);

  let processed = 0;
  const results: Array<{ job_id: string; ok: boolean; reason?: string }> = [];

  for (const row of rows ?? []) {
    if (processed >= maxItems) break;
    const candidate = row as unknown as DeliveryJobRow;
    const { data: claimed, error: claimErr } = await supabaseAdmin
      .from("ai_agent_delivery_jobs")
      .update({
        status: "processing",
        locked_at: new Date().toISOString(),
        attempts: candidate.job_kind === "audio" ? Number(candidate.attempts ?? 0) + 1 : Number(candidate.attempts ?? 0),
      })
      .eq("id", candidate.id)
      .or(`status.eq.pending,and(status.eq.processing,locked_at.lt.${staleLockIso})`)
      .select("id, conversation_id, brand_id, agent_id, channel_id, message_id, group_id, job_kind, sequence, status, content, payload, attempts, max_attempts, created_at, locked_at")
      .maybeSingle();
    if (claimErr) {
      console.error("[ai-agent] delivery claim failed", candidate.id, claimErr.message);
      results.push({ job_id: candidate.id, ok: false, reason: claimErr.message });
      continue;
    }
    if (!claimed) {
      results.push({ job_id: candidate.id, ok: false, reason: "already_claimed" });
      continue;
    }
    try {
      const result = await processAgentDeliveryJob(claimed as unknown as DeliveryJobRow);
      results.push({ job_id: candidate.id, ...result });
      processed++;
    } catch (e) {
      const reason = String((e as Error).message ?? e);
      console.error("[ai-agent] delivery job failed", candidate.id, reason);
      await markDeliveryJobRetry({ job: claimed as unknown as DeliveryJobRow, messageId: (claimed as any).message_id, code: "DELIVERY_EXCEPTION", message: reason });
      results.push({ job_id: candidate.id, ok: false, reason });
      processed++;
    }
  }

  return { processed, results };
}

async function resolveSendConfigForConversation(args: {
  conversationId: string;
  channelId?: string | null;
}): Promise<SendConfig | null> {
  const { data: conv } = await supabaseAdmin
    .from("conversations")
    .select("id, channel_id, contact_id")
    .eq("id", args.conversationId)
    .maybeSingle();
  if (!conv) return null;
  const channelId = (args.channelId ?? (conv as any).channel_id) as string | null;
  const contactId = (conv as any).contact_id as string | null;
  if (!channelId || !contactId) return null;

  const [{ data: chanRow }, { data: secretRow }, { data: contactRow }] = await Promise.all([
    supabaseAdmin.from("brand_channels").select("phone_number_id").eq("id", channelId).maybeSingle(),
    supabaseAdmin.from("channel_secrets").select("system_user_token").eq("channel_id", channelId).maybeSingle(),
    supabaseAdmin.from("contacts").select("wa_id").eq("id", contactId).maybeSingle(),
  ]);

  const phoneNumberId = (chanRow as any)?.phone_number_id as string | null;
  const token = (secretRow as any)?.system_user_token as string | null;
  const to = (contactRow as any)?.wa_id as string | null;
  if (!phoneNumberId || !token || !to) return null;
  return { phoneNumberId, token, to, channelId };
}

async function loadVoiceConfigForAgent(agentId: string): Promise<VoiceConfig | null> {
  const { data: voiceRow } = await supabaseAdmin
    .from("ai_agent_voice_configs")
    .select("voice_id, model_id, stability, similarity_boost, style, speed")
    .eq("agent_id", agentId)
    .maybeSingle();
  return voiceRow && (voiceRow as any).voice_id
    ? {
        voice_id: (voiceRow as any).voice_id,
        model_id: (voiceRow as any).model_id ?? "eleven_multilingual_v2",
        stability: Number((voiceRow as any).stability ?? 0.5),
        similarity_boost: Number((voiceRow as any).similarity_boost ?? 0.75),
        style: Number((voiceRow as any).style ?? 0),
        speed: Number((voiceRow as any).speed ?? 1.0),
      }
    : null;
}

function voiceConfigFromRaw(raw: any): VoiceConfig | null {
  const v = raw?.voice;
  const voiceId = v?.voice_id as string | null | undefined;
  if (!voiceId) return null;
  return {
    voice_id: voiceId,
    model_id: String(v?.model_id ?? "eleven_multilingual_v2"),
    stability: Number(v?.stability ?? 0.5),
    similarity_boost: Number(v?.similarity_boost ?? 0.75),
    style: Number(v?.style ?? 0),
    speed: Number(raw?.helpme?.speed ?? v?.speed ?? 1.0),
  };
}

function buildHelpMeListBody(to: string, text: string): unknown {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: text.slice(0, 1024) },
      action: {
        button: HELP_ME_BUTTON_TITLE,
        sections: [
          {
            title: "Options",
            rows: HELP_ME_ITEMS.map((it) => ({
              id: it.id,
              title: it.title.slice(0, 24),
              ...(it.description ? { description: it.description.slice(0, 72) } : {}),
            })),
          },
        ],
      },
    },
  };
}

export async function drainStuckAgentOutgoingMessages(maxItems = 1): Promise<{
  processed: number;
  results: Array<{ message_id: string; ok: boolean; reason?: string }>;
}> {
  const cutoffIso = new Date(Date.now() - 30_000).toISOString();
  const recentIso = new Date(Date.now() - 2 * 60 * 60 * 1_000).toISOString();
  const { data: rows, error } = await supabaseAdmin
    .from("messages")
    .select("id, brand_id, conversation_id, channel_id, type, content, created_at, raw")
    .eq("direction", "outbound")
    .eq("status", "queued")
    .in("type", ["text", "interactive", "audio"])
    .gte("created_at", recentIso)
    .lte("created_at", cutoffIso)
    .order("created_at", { ascending: true })
    .limit(Math.max(1, maxItems * 8));
  if (error) throw new Error(error.message);

  let processed = 0;
  const results: Array<{ message_id: string; ok: boolean; reason?: string }> = [];

  for (const row of rows ?? []) {
    if (processed >= maxItems) break;
    const msg = row as any;
    const raw = msg.raw ?? {};
    if (raw.delivery_managed) continue;
    const isAgentMessage = !!raw.ai_agent_id;
    const shouldRecoverHelpMe = isAgentMessage && (raw.help_me_expected || raw.help_me_attached);
    const shouldRecoverAudio = isAgentMessage && msg.type === "audio" && !!raw.voice;
    if (!shouldRecoverHelpMe && !shouldRecoverAudio) continue;

    const messageId = msg.id as string;
    const { data: newerOut } = await supabaseAdmin
      .from("messages")
      .select("id")
      .eq("conversation_id", msg.conversation_id as string)
      .eq("direction", "outbound")
      .gt("created_at", msg.created_at as string)
      .neq("status", "queued")
      .limit(1)
      .maybeSingle();
    if (newerOut) {
      await supabaseAdmin
        .from("messages")
        .update({
          status: "failed",
          error_code: "SUPERSEDED",
          error_message: "Mensagem antiga não recuperada porque já houve resposta posterior.",
          raw: {
            ...raw,
            ...(shouldRecoverHelpMe ? { help_me_stage: "recovery_skipped_superseded" } : {}),
            ...(shouldRecoverAudio ? { tts_stage: "recovery_skipped_superseded" } : {}),
          },
        })
        .eq("id", messageId);
      processed++;
      results.push({ message_id: messageId, ok: false, reason: "superseded" });
      continue;
    }
    const cfg = await resolveSendConfigForConversation({
      conversationId: msg.conversation_id as string,
      channelId: msg.channel_id as string | null,
    });
    if (!cfg) {
      await supabaseAdmin
        .from("messages")
        .update({ status: "failed", error_code: "AI_SEND_CONFIG", error_message: "Configuração de envio ausente." })
        .eq("id", messageId);
      processed++;
      results.push({ message_id: messageId, ok: false, reason: "send_config_missing" });
      continue;
    }

    if (shouldRecoverHelpMe && msg.type !== "audio") {
      const text = String(msg.content ?? "").trim();
      if (!text) {
        await supabaseAdmin
          .from("messages")
          .update({ status: "failed", error_code: "EMPTY_CONTENT", error_message: "Mensagem interativa sem conteúdo." })
          .eq("id", messageId);
        processed++;
        results.push({ message_id: messageId, ok: false, reason: "empty_content" });
        continue;
      }
      const metaRes = await postMetaMessageWithTimeout({
        phoneNumberId: cfg.phoneNumberId,
        token: cfg.token,
        body: buildHelpMeListBody(cfg.to, text),
        timeoutMs: 6_000,
      });
      if (!metaRes.ok) {
        await supabaseAdmin
          .from("messages")
          .update({
            status: "failed",
            error_code: metaRes.code ?? "META_ERR",
            error_message: metaRes.message ?? "Falha ao recuperar mensagem com botões.",
            raw: { ...raw, help_me_stage: "recovery_failed" },
          })
          .eq("id", messageId);
        processed++;
        results.push({ message_id: messageId, ok: false, reason: metaRes.code ?? "meta_failed" });
        continue;
      }
      await supabaseAdmin
        .from("messages")
        .update({
          status: "sent",
          type: "interactive",
          wa_message_id: metaRes.json?.messages?.[0]?.id ?? null,
          raw: { ...raw, help_me_stage: "recovered_sent_to_meta" },
        })
        .eq("id", messageId);

      const totalParts = Number(raw?.humanize?.total_parts ?? 0);
      const agentId = raw.ai_agent_id as string | undefined;
      if (agentId && totalParts > 0) {
        const fromIso = new Date(new Date(msg.created_at as string).getTime() - 5 * 60 * 1_000).toISOString();
        const { data: partRows } = await supabaseAdmin
          .from("messages")
          .select("id, content, raw, created_at")
          .eq("conversation_id", msg.conversation_id as string)
          .eq("direction", "outbound")
          .gte("created_at", fromIso)
          .lte("created_at", msg.created_at as string)
          .not("content", "is", null)
          .order("created_at", { ascending: true })
          .limit(20);
        const parts = new Map<number, string>();
        for (const p of partRows ?? []) {
          const pRaw = (p as any).raw ?? {};
          if (pRaw.ai_agent_id !== agentId) continue;
          if (Number(pRaw?.humanize?.total_parts ?? 0) !== totalParts) continue;
          const idx = Number(pRaw?.humanize?.part_index ?? -1);
          if (idx >= 0 && idx < totalParts) parts.set(idx, String((p as any).content ?? ""));
        }
        if (parts.size === totalParts) {
          const fullReply = Array.from({ length: totalParts }, (_, idx) => parts.get(idx) ?? "").join("\n\n").trim();
          const { data: existingAudio } = await supabaseAdmin
            .from("messages")
            .select("id")
            .eq("conversation_id", msg.conversation_id as string)
            .eq("direction", "outbound")
            .eq("type", "audio")
            .eq("content", fullReply)
            .gte("created_at", fromIso)
            .limit(1)
            .maybeSingle();
          const voiceCfg = existingAudio ? null : await loadVoiceConfigForAgent(agentId);
          if (voiceCfg && fullReply) {
            const { data: audioRow } = await supabaseAdmin
              .from("messages")
              .insert({
                brand_id: msg.brand_id as string,
                conversation_id: msg.conversation_id as string,
                channel_id: cfg.channelId,
                direction: "outbound",
                type: "audio",
                content: fullReply,
                status: "queued",
                sent_by: null,
                raw: {
                  ai_agent_id: agentId,
                  ai_agent_name: raw.ai_agent_name,
                  voice: { provider: "elevenlabs", voice_id: voiceCfg.voice_id, model_id: voiceCfg.model_id },
                  source_text_message_id: messageId,
                  tts_stage: "recovery_queued_after_help_me",
                },
              })
              .select("id")
              .single();
            const audioMsgId = (audioRow as any)?.id as string | undefined;
            if (audioMsgId) {
              try {
                const audioBuf = await generateTtsWithRetry(fullReply, voiceCfg);
                const mediaId = await uploadAudioToMeta({ phoneNumberId: cfg.phoneNumberId, token: cfg.token, audio: audioBuf as any });
                const sendRes = await sendWhatsappAudioByMediaId({ phoneNumberId: cfg.phoneNumberId, token: cfg.token, to: cfg.to, mediaId });
                await supabaseAdmin
                  .from("messages")
                  .update(
                    sendRes.ok
                      ? {
                          status: "sent",
                          wa_message_id: sendRes.wa_message_id ?? null,
                          raw: {
                            ai_agent_id: agentId,
                            ai_agent_name: raw.ai_agent_name,
                            voice: { provider: "elevenlabs", voice_id: voiceCfg.voice_id, model_id: voiceCfg.model_id },
                            source_text_message_id: messageId,
                            tts_stage: "recovered_sent_to_meta",
                            meta_media_id: mediaId,
                          },
                        }
                      : {
                          status: "failed",
                          error_code: sendRes.error_code ?? "META_AUDIO_FAIL",
                          error_message: sendRes.error_message ?? "Falha ao recuperar áudio.",
                        },
                  )
                  .eq("id", audioMsgId);
              } catch (e) {
                await supabaseAdmin
                  .from("messages")
                  .update({ status: "failed", error_code: "TTS_FAIL", error_message: String((e as Error).message ?? e) })
                  .eq("id", audioMsgId);
              }
            }
          }
        }
      }
      processed++;
      results.push({ message_id: messageId, ok: true });
      continue;
    }

    if (shouldRecoverAudio) {
      const voiceCfg = voiceConfigFromRaw(raw);
      const text = String(msg.content ?? "").trim();
      if (!voiceCfg || !text) {
        await supabaseAdmin
          .from("messages")
          .update({ status: "failed", error_code: "TTS_CONFIG", error_message: "Áudio sem texto ou configuração de voz." })
          .eq("id", messageId);
        processed++;
        results.push({ message_id: messageId, ok: false, reason: "tts_config_missing" });
        continue;
      }
      try {
        await supabaseAdmin
          .from("messages")
          .update({ raw: { ...raw, tts_stage: "recovery_generating" } })
          .eq("id", messageId);
        const audioBuf = await generateTtsWithRetry(text, voiceCfg);
        await supabaseAdmin
          .from("messages")
          .update({ raw: { ...raw, tts_stage: "recovery_uploading_to_meta" } })
          .eq("id", messageId);
        const mediaId = await uploadAudioToMeta({ phoneNumberId: cfg.phoneNumberId, token: cfg.token, audio: audioBuf as any });
        const sendRes = await sendWhatsappAudioByMediaId({
          phoneNumberId: cfg.phoneNumberId,
          token: cfg.token,
          to: cfg.to,
          mediaId,
        });
        if (!sendRes.ok) {
          await supabaseAdmin
            .from("messages")
            .update({
              status: "failed",
              error_code: sendRes.error_code ?? "META_AUDIO_FAIL",
              error_message: sendRes.error_message ?? "Falha ao recuperar áudio.",
              raw: { ...raw, tts_stage: "recovery_failed", meta_media_id: mediaId },
            })
            .eq("id", messageId);
          processed++;
          results.push({ message_id: messageId, ok: false, reason: sendRes.error_code ?? "meta_audio_failed" });
          continue;
        }
        await supabaseAdmin
          .from("messages")
          .update({
            status: "sent",
            wa_message_id: sendRes.wa_message_id ?? null,
            raw: { ...raw, tts_stage: "recovered_sent_to_meta", meta_media_id: mediaId },
          })
          .eq("id", messageId);
        processed++;
        results.push({ message_id: messageId, ok: true });
      } catch (e) {
        await supabaseAdmin
          .from("messages")
          .update({
            status: "failed",
            error_code: "TTS_FAIL",
            error_message: String((e as Error).message ?? e),
            raw: { ...raw, tts_stage: "recovery_failed" },
          })
          .eq("id", messageId);
        processed++;
        results.push({ message_id: messageId, ok: false, reason: "tts_fail" });
      }
    }
  }

  return { processed, results };
}

// ============================================================
// Help me! — menu interativo (WhatsApp List Message)
// ============================================================

const HELP_ME_BUTTON_TITLE = "Help me!";
const HELP_ME_ITEMS: Array<{ id: string; title: string; description?: string }> = [
  { id: "helpme:translate", title: "Translate 🇺🇸👉🇧🇷" },
  { id: "helpme:simplify", title: "Simplify 🤩" },
  { id: "helpme:slowly", title: "Slowly 🐢" },
];

async function sendHelpMeList(args: {
  phoneNumberId: string;
  token: string;
  to: string;
}): Promise<void> {
  const res = await fetch(`https://graph.facebook.com/v21.0/${args.phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${args.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: args.to,
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: "🆘 Help me!" },
        action: {
          button: HELP_ME_BUTTON_TITLE,
          sections: [
            {
              title: "Options",
              rows: HELP_ME_ITEMS.map((it) => ({
                id: it.id,
                title: it.title.slice(0, 24),
                ...(it.description ? { description: it.description.slice(0, 72) } : {}),
              })),
            },
          ],
        },
      },
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error("[ai-agent] help_me list send failed", res.status, txt.slice(0, 300));
  }
}

async function runHelpMeAction(
  conversationId: string,
  a: AgentRow & { help_me_enabled?: boolean; help_me_slow_speed?: number },
  payload: string,
): Promise<{ ok: boolean; reason?: string }> {
  const action = payload.slice("helpme:".length) as "translate" | "simplify" | "slowly";

  const { data: conv } = await supabaseAdmin
    .from("conversations")
    .select("id, brand_id, channel_id, contact_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) return { ok: false, reason: "conversation_not_found" };

  const { data: chanRow } = await supabaseAdmin
    .from("brand_channels")
    .select("phone_number_id")
    .eq("id", conv.channel_id as string)
    .maybeSingle();
  const phoneNumberId = (chanRow as any)?.phone_number_id as string | null;

  const { data: secretRow } = await supabaseAdmin
    .from("channel_secrets")
    .select("system_user_token")
    .eq("channel_id", conv.channel_id as string)
    .maybeSingle();
  const token = (secretRow as any)?.system_user_token as string | null;

  const { data: contactRow } = await supabaseAdmin
    .from("contacts")
    .select("wa_id")
    .eq("id", conv.contact_id as string)
    .maybeSingle();
  const to = (contactRow as any)?.wa_id as string | null;

  if (!phoneNumberId || !token || !to) return { ok: false, reason: "send_config_missing" };

  const { data: voiceRow } = await supabaseAdmin
    .from("ai_agent_voice_configs")
    .select("voice_id, model_id, stability, similarity_boost, style, speed")
    .eq("agent_id", a.id)
    .maybeSingle();
  const voiceCfg: VoiceConfig | null =
    voiceRow && (voiceRow as any).voice_id
      ? {
          voice_id: (voiceRow as any).voice_id,
          model_id: (voiceRow as any).model_id ?? "eleven_multilingual_v2",
          stability: Number((voiceRow as any).stability ?? 0.5),
          similarity_boost: Number((voiceRow as any).similarity_boost ?? 0.75),
          style: Number((voiceRow as any).style ?? 0),
          speed: Number((voiceRow as any).speed ?? 1.0),
        }
      : null;

  // Última fala do agente (texto). Pegamos a mensagem outbound mais recente com content.
  const { data: lastOut } = await supabaseAdmin
    .from("messages")
    .select("content, type, created_at")
    .eq("conversation_id", conversationId)
    .eq("direction", "outbound")
    .not("content", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sourceText = ((lastOut as any)?.content as string | null)?.trim() ?? "";
  if (!sourceText) return { ok: false, reason: "helpme_no_source_text" };

  let outText: string | null = null;
  let outAudioText: string | null = null;
  let audioSpeedOverride: number | null = null;

  if (action === "slowly") {
    // Só áudio, mais devagar.
    outAudioText = sourceText;
    audioSpeedOverride = Math.max(0.7, Math.min(1, Number(a.help_me_slow_speed ?? 0.75)));
  } else {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) return { ok: false, reason: "no_lovable_api_key" };
    const sys =
      action === "translate"
        ? "Traduza o texto a seguir para português brasileiro coloquial, mantendo o tom natural. Responda APENAS com a tradução, sem explicações."
        : "Reescreva o texto em inglês usando vocabulário básico (nível A2) e frases curtas para um aluno iniciante. Mantenha o sentido original. Responda APENAS com a versão simplificada em inglês, sem explicações.";
    const llmRes = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: sourceText },
        ],
        temperature: 0.3,
        max_tokens: 600,
      }),
    });
    if (!llmRes.ok) {
      const txt = await llmRes.text().catch(() => "");
      console.error("[ai-agent] helpme llm failed", llmRes.status, txt.slice(0, 300));
      return { ok: false, reason: `helpme_llm_${llmRes.status}` };
    }
    const body = (await llmRes.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const reply = (body.choices?.[0]?.message?.content ?? "").trim();
    if (!reply) return { ok: false, reason: "helpme_empty_reply" };
    outText = reply;
    // Translate: só texto, sem áudio. Simplify: texto + áudio.
    outAudioText = action === "translate" ? null : reply;
  }

  const useVoice: VoiceConfig | null = outAudioText && voiceCfg
    ? (audioSpeedOverride != null ? { ...voiceCfg, speed: audioSpeedOverride } : voiceCfg)
    : null;

  await enqueueAgentDeliveryJobs({
    conversationId,
    brandId: conv.brand_id as string,
    channelId: conv.channel_id as string | null,
    agentId: a.id,
    agentName: a.name,
    textParts: outText ? [{ text: outText, partIndex: 0, totalParts: 1, delayMs: 0, rawDelayMs: 0 }] : [],
    sendText: !!outText,
    attachHelpMe: !!outText && !!a.help_me_enabled && !!useVoice && action !== "translate",
    audioText: outAudioText,
    voiceCfg: useVoice,
    extraRaw: { helpme: { action, ...(useVoice ? { speed: useVoice.speed } : {}) } },
  });

  await supabaseAdmin.rpc("reopen_conversation_on_outbound", {
    _conv_id: conversationId,
    _actor_id: null as unknown as string,
    _by: "ai_agent_message",
  });

  return { ok: true };
}


export async function scheduleAgentRun(
  conversationId: string,
  agentId: string,
  delayMs: number,
): Promise<void> {
  const runAfter = new Date(Date.now() + Math.max(0, delayMs)).toISOString();
  await supabaseAdmin
    .from("ai_agent_pending_runs")
    .upsert(
      { conversation_id: conversationId, agent_id: agentId, run_after: runAfter },
      { onConflict: "conversation_id" },
    );
}
