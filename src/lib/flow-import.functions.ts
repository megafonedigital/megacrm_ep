// Server function: analyze a screenshot of an automation flow and return a
// best-effort `{ nodes, edges, unresolved }` description using a vision model
// (Gemini 2.5 Pro) through the Lovable AI Gateway.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { KNOWN_NODE_KINDS, type KnownNodeKind } from "./automation-templates";

const KIND_ENUM = [
  "trigger",
  "message",
  "question",
  "wait",
  "condition",
  "webhook",
  "set_status",
  "move_to_pipeline",
  "activecampaign",
  "add_tag",
  "assign_ai_agent",
  "randomizer",
  "send_to_blocklist",
  "set_variable",
  "comment",
  "unknown",
] as const;

type AnalyzedNode = {
  id: string;
  kind: (typeof KIND_ENUM)[number];
  label: string;
  position: { x: number; y: number };
  data: Record<string, any>;
};

type AnalyzedEdge = {
  source: string;
  target: string;
  sourceHandle?: string | null;
};

type Unresolved = {
  nodeId: string;
  originalLabel: string;
  reason: string;
  suggestion: KnownNodeKind | null;
};

type OcrBlock = {
  blockTitle: string;
  allVisibleText: string[];
  detectedTagNames?: string[];
  detectedTemplateNames?: string[];
  detectedLanguage?: string;
  detectedFunctionName?: string;
  connectsTo?: string[];
};

export type FlowAnalysis = {
  ok: true;
  nodes: AnalyzedNode[];
  edges: AnalyzedEdge[];
  unresolved: Unresolved[];
  notes: string;
  ocr?: OcrBlock[];
};

export type FlowAnalysisError = { ok: false; error: string };

const inputSchema = z.object({
  imageBase64: z.string().min(100).max(15_000_000),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  contextHint: z.string().max(500).optional(),
});

function buildSystemPrompt(): string {
  const catalog = KNOWN_NODE_KINDS.map(
    (n) => `- ${n.kind} (${n.label}, ${n.group}): ${n.description}`
  ).join("\n");

  return `Você é um leitor de fluxogramas para o MegaCRM. O usuário envia um print de um construtor de automações (pode ser de qualquer ferramenta — n8n, ManyChat, Botpress, Make, builders proprietários etc.) e você deve devolver o grafo equivalente no schema do MegaCRM.

Catálogo de nós disponíveis (kind exato):
${catalog}

REGRA DE OURO: se o print exibe um valor (nome de tag, nome de template, texto da mensagem, URL de webhook, tempo de espera), copie-o LITERALMENTE para o data do nó. Só deixe vazio quando o valor não estiver visível no print mesmo.

Shapes de data por kind:

- trigger → data: { triggerType: "manual" } (ou "tag" se for "quando tag X for adicionada", incluindo data.tag: "NOME").
- message (texto livre) → data: { mode: "text", text: "TEXTO LIDO DO PRINT" }.
- message (template Meta/WhatsApp) → data: { mode: "template", templateId: "", templateName: "NOME_LIDO_DO_PRINT", language: "pt_BR" }. SEMPRE copie o identificador visível EXATAMENTE como aparece (ex.: "vgv_onboarding_boas_vindas_api1_v1"), preservando underscores, números e sufixos como "_v1", "_api1". NUNCA deixe templateName vazio quando houver um identificador visível tipo snake_case no bloco. Esse nome é usado para casar com os templates já cadastrados no workspace.
- question → data: { text: "PERGUNTA LIDA", options: ["Opção 1", "Opção 2"] } se os botões forem visíveis.
- wait → data: { minutes: N } ou { seconds: N } ou { hours: N } conforme o print.
- condition → data.kind DEVE ser EXATAMENTE um destes valores:
    • "has_tag"        → data: { kind: "has_tag", tag: "NOME DA TAG LIDA" }
    • "in_pipeline"    → data: { kind: "in_pipeline", pipelineName: "...", stageName: "..." }
    • "in_window"      → data: { kind: "in_window" }   (janela de 24h aberta)
    • "is_blocklisted" → data: { kind: "is_blocklisted" }
    • "field"          → data: { kind: "field", field: { source: "contact", key: "email", type: "text" }, operator: "is", value: "..." }
  NÃO use "tag" sozinho — o valor correto é "has_tag". NÃO invente outros kinds.
- add_tag → data: { tags: ["TAG 1 LIDA", "TAG 2 LIDA"], op: "add" } (use op: "remove" se o bloco for "Remove Tag"). Sempre tente extrair os nomes visíveis no bloco; só use [] se realmente não houver texto legível.
- webhook → data: { method: "POST", url: "https://... lido do print" }.
- set_status → data: { status: "aberto" | "pendente" | "resolvido" }. NUNCA use outros valores (ex.: "Done", "Closed", "Open" — converta para o equivalente em PT). Se não tiver certeza, use "resolvido".
- move_to_pipeline / activecampaign / assign_ai_agent / randomizer / set_variable / send_to_blocklist: copie qualquer parâmetro visível (pipelineName, stageName, listId, agentId, variableName, value, etc.). Se nada estiver visível, devolva data: {}.
- comment → data: { text: "TEXTO DO POST-IT" }.

Heurísticas para rótulos comuns de outras ferramentas (mapeie ANTES de cair em "unknown"):

- "Confere BlockList", "Check Blocklist", "Verifica blacklist", "Is Blocked?", "Está bloqueado?" → condition { kind: "is_blocklisted" }.
- "Goto Sub Flow" / "Run Flow" / "Trigger Flow" / "Call Subflow" — é um INVÓLUCRO. Não crie um nó separado para o invólucro: leia o conteúdo interno (ex.: "Function: Confere BlockList") e mapeie pelo CONTEÚDO, não pelo título do invólucro.
- "Action" com "Add Tag XYZ" / "Tag: XYZ" / "Apply Tag XYZ" → add_tag { tags: ["XYZ"], op: "add" }.
- "Remove Tag XYZ" / "Untag XYZ" → add_tag { tags: ["XYZ"], op: "remove" }.
- "Send Message" + "WhatsApp Message Template" + nome de template → message { mode: "template", templateName: "...", templateId: "" }.
- "Start" / "Trigger" / "When ..." / "Início do fluxo" / "Gatilho" → trigger.
- "Wait N minutes/hours/days" / "Delay" / "Aguardar" → wait com a unidade lida.
- "HTTP Request" / "Webhook" / "Call API" / "POST to URL" → webhook.
- Pino/saída rotulado "If send WhatsApp failed" / "On error" / "Falha" → edge com sourceHandle: "error" saindo do nó message; "Erro Meta" → sourceHandle: "error_meta".
- Pino rotulado "Sim"/"Yes"/"True" saindo de uma condicional → sourceHandle: "true"; "Não"/"No"/"False" → sourceHandle: "false".

Regras gerais:
- Mantenha os IDs estáveis e curtos ("n1", "n2", ...). O primeiro nó deve ser sempre o trigger.
- Posições: trigger em x=400, y=40. Desça ~180px por nível vertical. Use ~300px de distância horizontal entre irmãos.
- Não invente blocos que não estão no print. Se o print tiver 4 blocos efetivos (ignorando invólucros tipo "Goto Sub Flow"), devolva 4 nodes.
- Use "unknown" como kind APENAS quando nenhum item do catálogo for equivalente razoável. Toda entrada "unknown" deve aparecer em unresolved com uma suggestion do kind mais provável e uma reason curta.
- Sempre emita o resultado pela ferramenta emit_flow — nunca responda em texto.`;
}

function buildOcrSystemPrompt(): string {
  return `Você é um OCR estruturado para prints de construtores de fluxo. Sua única tarefa é ler TODO texto visível por bloco, sem interpretar demais e sem converter para o schema do MegaCRM.

Regras:
- Liste cada bloco visual do fluxo na ordem da esquerda para a direita.
- Copie textos literalmente, preservando maiúsculas, acentos, hífens, underscores e sufixos como _v1.
- Se houver "Add Tag", extraia o nome da tag que aparece abaixo dele.
- Se houver "WhatsApp Message Template", extraia o identificador snake_case visível e o idioma visível (ex.: PT_PT).
- Se houver "Goto Sub Flow" com conteúdo interno "Function"/"Confere BlockList", extraia detectedFunctionName.
- Não invente texto. Se não estiver legível, deixe o campo vazio.
- Sempre emita o resultado pela ferramenta emit_ocr — nunca responda em texto.`;
}

const toolSchema = {
  type: "object",
  properties: {
    nodes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          kind: { type: "string", enum: KIND_ENUM as unknown as string[] },
          label: { type: "string" },
          position: {
            type: "object",
            properties: {
              x: { type: "number" },
              y: { type: "number" },
            },
            required: ["x", "y"],
            additionalProperties: false,
          },
          data: { type: "object", additionalProperties: true },
        },
        required: ["id", "kind", "label", "position", "data"],
        additionalProperties: false,
      },
    },
    edges: {
      type: "array",
      items: {
        type: "object",
        properties: {
          source: { type: "string" },
          target: { type: "string" },
          sourceHandle: { type: ["string", "null"] },
        },
        required: ["source", "target"],
        additionalProperties: false,
      },
    },
    unresolved: {
      type: "array",
      items: {
        type: "object",
        properties: {
          nodeId: { type: "string" },
          originalLabel: { type: "string" },
          reason: { type: "string" },
          suggestion: { type: ["string", "null"] },
        },
        required: ["nodeId", "originalLabel", "reason"],
        additionalProperties: false,
      },
    },
    notes: { type: "string" },
  },
  required: ["nodes", "edges", "unresolved", "notes"],
  additionalProperties: false,
};

const ocrToolSchema = {
  type: "object",
  properties: {
    blocks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          blockTitle: { type: "string" },
          allVisibleText: { type: "array", items: { type: "string" } },
          detectedTagNames: { type: "array", items: { type: "string" } },
          detectedTemplateNames: { type: "array", items: { type: "string" } },
          detectedLanguage: { type: "string" },
          detectedFunctionName: { type: "string" },
          connectsTo: { type: "array", items: { type: "string" } },
        },
        required: ["blockTitle", "allVisibleText"],
        additionalProperties: false,
      },
    },
  },
  required: ["blocks"],
  additionalProperties: false,
};

async function callAiTool(
  apiKey: string,
  body: Record<string, any>,
  toolName: string,
): Promise<{ ok: true; data: any } | { ok: false; error: string; status?: number }> {
  let res: Response;
  try {
    res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.error("flow-import: network error", e);
    return { ok: false, error: "Falha de rede ao contatar a IA." };
  }

  if (res.status === 429) return { ok: false, status: 429, error: "Limite de requisições atingido. Tente em alguns segundos." };
  if (res.status === 402) return { ok: false, status: 402, error: "Créditos de IA esgotados. Adicione créditos para continuar." };
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error("flow-import: AI gateway error", res.status, txt);
    return { ok: false, status: res.status, error: `Erro da IA (${res.status}).` };
  }

  let payload: any;
  try {
    payload = await res.json();
  } catch {
    return { ok: false, error: "Resposta inválida da IA." };
  }

  const toolCall = payload?.choices?.[0]?.message?.tool_calls?.find((t: any) => t?.function?.name === toolName)
    ?? payload?.choices?.[0]?.message?.tool_calls?.[0];
  const argsStr = toolCall?.function?.arguments;
  if (!argsStr) return { ok: false, error: "A IA não retornou dados estruturados. Tente outro print." };

  try {
    return { ok: true, data: typeof argsStr === "string" ? JSON.parse(argsStr) : argsStr };
  } catch {
    return { ok: false, error: "A IA retornou um JSON inválido." };
  }
}

export const analyzeFlowImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      return { ok: false, error: "LOVABLE_API_KEY ausente no servidor." };
    }

    const dataUrl = `data:${data.mimeType};base64,${data.imageBase64}`;
    const ocrResult = await callAiTool(apiKey, {
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: buildOcrSystemPrompt() },
        {
          role: "user",
          content: [
            { type: "text", text: "Leia todo texto visível deste print e emita os blocos pela ferramenta emit_ocr." },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      tools: [{ type: "function", function: { name: "emit_ocr", description: "Emite o OCR estruturado dos blocos visíveis no print.", parameters: ocrToolSchema } }],
      tool_choice: { type: "function", function: { name: "emit_ocr" } },
    }, "emit_ocr");

    if (!ocrResult.ok) return { ok: false, error: ocrResult.error };
    const ocr: OcrBlock[] = Array.isArray(ocrResult.data?.blocks) ? ocrResult.data.blocks : [];
    const userText =
      "Analise este print de fluxo de automação e devolva o grafo equivalente no schema do MegaCRM via a ferramenta emit_flow.\n\n" +
      "OCR estruturado já extraído do print (use estes textos como fonte de verdade; copie nomes de tags/templates literalmente):\n" +
      JSON.stringify(ocr, null, 2) +
      (data.contextHint ? `\n\nContexto extra do usuário: ${data.contextHint}` : "");

    const flowResult = await callAiTool(apiKey, {
      model: "openai/gpt-5",
      messages: [
        { role: "system", content: buildSystemPrompt() },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      tools: [{ type: "function", function: { name: "emit_flow", description: "Emite o grafo do fluxo extraído do print no schema do MegaCRM.", parameters: toolSchema } }],
      tool_choice: { type: "function", function: { name: "emit_flow" } },
    }, "emit_flow");

    if (!flowResult.ok) return { ok: false, error: flowResult.error };
    const parsed = flowResult.data;

    const nodes: AnalyzedNode[] = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
    const edges: AnalyzedEdge[] = Array.isArray(parsed?.edges) ? parsed.edges : [];
    const unresolved: Unresolved[] = Array.isArray(parsed?.unresolved) ? parsed.unresolved : [];
    const notes: string = typeof parsed?.notes === "string" ? parsed.notes : "";

    // Sanitiza set_status: o enum do banco aceita apenas aberto/pendente/resolvido.
    // Modelos costumam devolver "Done", "Closed", "Open" — converte para PT.
    const STATUS_ALIAS: Record<string, string> = {
      done: "resolvido", resolved: "resolvido", closed: "resolvido", solved: "resolvido", complete: "resolvido", completed: "resolvido", finalizado: "resolvido", finalizada: "resolvido", concluido: "resolvido", "concluído": "resolvido",
      open: "aberto", opened: "aberto", reopened: "aberto", abrir: "aberto",
      pending: "pendente", waiting: "pendente", aguardando: "pendente",
      aberto: "aberto", pendente: "pendente", resolvido: "resolvido",
    };
    for (const n of nodes) {
      if (n.kind === "set_status") {
        const raw = String((n.data as any)?.status ?? "resolvido").toLowerCase().trim();
        const mapped = STATUS_ALIAS[raw] ?? "resolvido";
        (n.data as any) = { ...(n.data ?? {}), status: mapped };
      }
    }

    if (nodes.length === 0) {
      return { ok: false, error: "Nenhum nó pôde ser identificado na imagem." };
    }

    return { ok: true, nodes, edges, unresolved, notes, ocr };
  });
