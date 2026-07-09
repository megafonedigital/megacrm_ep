import { supabaseAdmin } from "@/integrations/supabase/client.server";

import {
  AI_GATEWAY_URL,
  NEED_HUMAN_TOOL,
  TOOL_USAGE_HINT,
  buildAgentSystemPrompt,
  logAgentRun,
  type AgentRow,
} from "./ai-agents-engine.server";
import { applyVariables, buildContextBlock, resolveAgentVariables } from "./ai-agent-inputs.server";


export type ScenarioTurn = { role: "user" | "assistant"; content: string };

export type ScenarioRunInput = {
  scenarioId: string;
};

export type ScenarioRunResult = {
  ok: boolean;
  reason?: string;
  status: "pass" | "fail" | "error" | "escalated";
  reply: string;
  failures: string[];
  judge_verdict: { passed: boolean; reason: string } | null;
  tool_call: { name: string; reason: string | null; message_to_patient: string | null; escalation_track: string | null } | null;
  tokens_in: number | null;
  tokens_out: number | null;
  duration_ms: number;
  model: string;
};

const STOPWORDS_PT = new Set([
  "a","o","as","os","de","da","do","das","dos","e","ou","um","uma","uns","umas","para","pra","por",
  "no","na","nos","nas","em","com","sem","que","se","sua","seu","suas","seus","esse","essa","esses",
  "essas","este","esta","estes","estas","isso","isto","aquilo","aquele","aquela","muito","muita",
  "mais","menos","ja","já","só","so","tambem","também","quando","onde","como","qual","quais","quanto",
  "tem","ter","temos","tem","ser","sou","é","e","são","sao","foi","era","ele","ela","eles","elas",
  "voce","você","vc","te","lhe","me","mim","seu","sua","at","até","ate","porque","pois","mas","entao",
  "então","aí","ai","la","lá","sim","não","nao","aqui","alí","ali","todo","toda","todos","todas",
  "qualquer","quaisquer","ate","cada","do","da","aos","às","as",
]);

export function extractFaqKeywords(answer: string, max = 3): string[] {
  const tokens = (answer ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 5 && !STOPWORDS_PT.has(t));
  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, max)
    .map(([t]) => t);
}

export type DeterministicResult = {
  passed: boolean;
  failures: string[];
};

export function evaluateDeterministic(opts: {
  reply: string;
  toolCalledNeedHuman: boolean;
  toolReason: string | null;
  expect: {
    must_contain: string[];
    must_not_contain: string[];
    need_human: boolean;
    need_human_reason: string | null;
  };
}): DeterministicResult {
  const failures: string[] = [];
  const lower = (opts.reply ?? "").toLowerCase();
  for (const phrase of opts.expect.must_contain) {
    if (!phrase.trim()) continue;
    if (!lower.includes(phrase.toLowerCase())) {
      failures.push(`Deveria conter: "${phrase}"`);
    }
  }
  for (const phrase of opts.expect.must_not_contain) {
    if (!phrase.trim()) continue;
    if (lower.includes(phrase.toLowerCase())) {
      failures.push(`Não deveria conter: "${phrase}"`);
    }
  }
  if (opts.expect.need_human) {
    if (!opts.toolCalledNeedHuman) {
      failures.push("Deveria ter chamado need_human (não chamou).");
    } else if (opts.expect.need_human_reason && opts.toolReason && opts.expect.need_human_reason !== opts.toolReason) {
      failures.push(`Reason esperado: "${opts.expect.need_human_reason}" — obtido: "${opts.toolReason}"`);
    }
  } else if (opts.toolCalledNeedHuman) {
    failures.push(`Não deveria ter chamado need_human (chamou com reason="${opts.toolReason ?? ""}")`);
  }
  return { passed: failures.length === 0, failures };
}

type ScenarioRow = {
  id: string;
  agent_id: string;
  brand_id: string;
  turns: ScenarioTurn[];
  expect_must_contain: string[];
  expect_must_not_contain: string[];
  expect_need_human: boolean;
  expect_need_human_reason: string | null;
  judge_criteria: string | null;
};

export type RunScenarioOpts = {
  versionId?: string | null;
  persistOnScenario?: boolean;
};

function emptyResult(status: "error", reason: string, model = ""): ScenarioRunResult {
  return {
    ok: false,
    reason,
    status,
    reply: "",
    failures: [reason],
    judge_verdict: null,
    tool_call: null,
    tokens_in: null,
    tokens_out: null,
    duration_ms: 0,
    model,
  };
}

export async function runScenarioCore(
  scenarioId: string,
  opts: RunScenarioOpts = {},
): Promise<ScenarioRunResult> {
  const persist = opts.persistOnScenario !== false;
  const { data: scen, error: scenErr } = await supabaseAdmin
    .from("ai_agent_test_scenarios")
    .select(
      "id, agent_id, brand_id, turns, expect_must_contain, expect_must_not_contain, expect_need_human, expect_need_human_reason, judge_criteria",
    )
    .eq("id", scenarioId)
    .maybeSingle();
  if (scenErr) throw new Error(scenErr.message);
  if (!scen) return emptyResult("error", "scenario_not_found");
  const s = scen as unknown as ScenarioRow;

  const { data: agent, error: agentErr } = await supabaseAdmin
    .from("ai_agents")
    .select(
      "id, brand_id, name, status, whitelist, system_prompt, model, temperature, max_output_tokens, context_window_messages, escalation_target_vendas, escalation_target_suporte, inputs",
    )

    .eq("id", s.agent_id)
    .maybeSingle();
  if (agentErr) throw new Error(agentErr.message);
  if (!agent) return emptyResult("error", "agent_not_found");
  const a = agent as unknown as AgentRow;

  // Sobrepor com versão específica, se solicitado
  if (opts.versionId) {
    const { data: ver } = await supabaseAdmin
      .from("ai_agent_versions")
      .select(
        "id, system_prompt, model, temperature, max_output_tokens, context_window_messages, escalation_target_vendas, escalation_target_suporte, inputs",
      )
      .eq("id", opts.versionId)
      .maybeSingle();
    if (ver) {
      const v = ver as unknown as Partial<AgentRow> & { id: string };
      a.system_prompt = v.system_prompt ?? a.system_prompt;
      a.model = v.model ?? a.model;
      a.temperature = v.temperature ?? a.temperature;
      a.max_output_tokens = v.max_output_tokens ?? a.max_output_tokens;
      a.context_window_messages = v.context_window_messages ?? a.context_window_messages;
      a.escalation_target_vendas = v.escalation_target_vendas ?? a.escalation_target_vendas;
      a.escalation_target_suporte = v.escalation_target_suporte ?? a.escalation_target_suporte;
      a.inputs = v.inputs ?? a.inputs;
    }
  }

  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) {
    if (persist) await markScenarioError(scenarioId, "LOVABLE_API_KEY ausente");
    return emptyResult("error", "no_api_key");
  }


  const baseSystem = await buildAgentSystemPrompt(a);
  const variables = await resolveAgentVariables(a.inputs ?? null, {
    brandId: a.brand_id,
    agentId: a.id,
    contactId: null,
    conversationId: null,
    contextWindow: a.context_window_messages,
    preloaded: { lastMessagesText: "" },
  });
  const replaced = applyVariables((baseSystem ? baseSystem : "") + TOOL_USAGE_HINT, variables);
  const contextBlock = buildContextBlock(variables, a.inputs ?? null);
  const systemPrompt = contextBlock ? `${replaced}\n\n${contextBlock}` : replaced;


  const turns: ScenarioTurn[] = Array.isArray(s.turns) ? s.turns : [];
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  for (const t of turns) {
    if (!t?.content?.trim()) continue;
    if (t.role !== "user" && t.role !== "assistant") continue;
    messages.push({ role: t.role, content: String(t.content) });
  }
  // último turno deve ser do usuário; se não for, ignorar avaliação
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    if (persist) await markScenarioError(scenarioId, "Cenário deve terminar com um turno do paciente.");
    return emptyResult("error", "no_user_turn");
  }

  const startedAt = Date.now();
  const model = a.model || "google/gemini-3-flash-preview";

  const res = await fetch(AI_GATEWAY_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      temperature: a.temperature ?? 0.7,
      max_tokens: a.max_output_tokens ?? 1024,
      tools: [NEED_HUMAN_TOOL],
      tool_choice: "auto",
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    if (persist) await markScenarioError(scenarioId, `Gateway ${res.status}: ${txt.slice(0, 300)}`);
    return emptyResult("error", `gateway_${res.status}`, model);
  }

  const body = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
        tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
      };
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const duration = Date.now() - startedAt;
  const choice = body.choices?.[0]?.message;
  const textReply = choice?.content?.trim() ?? "";
  const toolCalls = choice?.tool_calls ?? [];
  let toolCalledNeedHuman = false;
  let toolReason: string | null = null;
  let toolMessage: string | null = null;
  let toolTrack: string | null = null;
  for (const tc of toolCalls) {
    if (tc?.function?.name === "need_human") {
      toolCalledNeedHuman = true;
      try {
        const args = JSON.parse(tc.function.arguments ?? "{}") as { reason?: string; message_to_patient?: string; escalation_track?: string };
        toolReason = args.reason ?? null;
        toolMessage = args.message_to_patient ?? null;
        toolTrack = args.escalation_track ?? null;
      } catch { /* ignore */ }
      break;
    }
  }
  const reply = (toolMessage && toolMessage.length > 0) ? toolMessage : textReply;

  // Determinística
  const det = evaluateDeterministic({
    reply,
    toolCalledNeedHuman,
    toolReason,
    expect: {
      must_contain: s.expect_must_contain ?? [],
      must_not_contain: s.expect_must_not_contain ?? [],
      need_human: !!s.expect_need_human,
      need_human_reason: s.expect_need_human_reason ?? null,
    },
  });

  // Juiz IA (só se determinística passou e há critério)
  let judgeVerdict: { passed: boolean; reason: string } | null = null;
  if (det.passed && s.judge_criteria && s.judge_criteria.trim()) {
    judgeVerdict = await runJudge({
      apiKey,
      criteria: s.judge_criteria,
      conversation: turns,
      reply,
    });
  }

  const passed = det.passed && (judgeVerdict ? judgeVerdict.passed : true);
  const failures = [
    ...det.failures,
    ...(judgeVerdict && !judgeVerdict.passed ? [`Juiz IA: ${judgeVerdict.reason}`] : []),
  ];

  const toolCallObj = toolCalledNeedHuman
    ? { name: "need_human", reason: toolReason, message_to_patient: toolMessage, escalation_track: toolTrack }
    : null;
  const finalStatus: ScenarioRunResult["status"] = toolCalledNeedHuman
    ? "escalated"
    : passed
      ? "pass"
      : "fail";

  if (persist) {
    await supabaseAdmin
      .from("ai_agent_test_scenarios")
      .update({
        last_status: passed ? "pass" : "fail",
        last_run_at: new Date().toISOString(),
        last_response: reply,
        last_failures: failures,
        last_judge_verdict: judgeVerdict,
        last_tokens_in: body.usage?.prompt_tokens ?? null,
        last_tokens_out: body.usage?.completion_tokens ?? null,
        last_duration_ms: duration,
        last_model: model,
        last_tool_call: toolCallObj,
      } as never)
      .eq("id", scenarioId);
  }

  await logAgentRun({
    brand_id: s.brand_id,
    agent_id: s.agent_id,
    triggered_by: "scenario",
    status: toolCalledNeedHuman ? "escalated" : passed ? "success" : "error",
    model,
    temperature: a.temperature ?? null,
    max_output_tokens: a.max_output_tokens ?? null,
    input_messages: messages,
    input_variables: variables,

    output_text: reply,
    tool_call: toolCallObj,
    tokens_in: body.usage?.prompt_tokens ?? null,
    tokens_out: body.usage?.completion_tokens ?? null,
    latency_ms: duration,
    error_code: passed ? null : "scenario_failed",
    error_message: failures.length ? failures.join(" | ").slice(0, 500) : null,
    escalation_track: toolTrack,
    version_id: opts.versionId ?? null,
  });

  return {
    ok: true,
    reason: passed ? "pass" : "fail",
    status: finalStatus,
    reply,
    failures,
    judge_verdict: judgeVerdict,
    tool_call: toolCallObj,
    tokens_in: body.usage?.prompt_tokens ?? null,
    tokens_out: body.usage?.completion_tokens ?? null,
    duration_ms: duration,
    model,
  };
}

async function markScenarioError(scenarioId: string, msg: string) {
  await supabaseAdmin
    .from("ai_agent_test_scenarios")
    .update({
      last_status: "error",
      last_run_at: new Date().toISOString(),
      last_failures: [msg],
      last_response: null,
      last_judge_verdict: null,
      last_tool_call: null,
    } as never)
    .eq("id", scenarioId);
}

async function runJudge(opts: {
  apiKey: string;
  criteria: string;
  conversation: ScenarioTurn[];
  reply: string;
}): Promise<{ passed: boolean; reason: string }> {
  const conv = opts.conversation
    .map((t) => `${t.role === "user" ? "Paciente" : "Agente"}: ${t.content}`)
    .join("\n");
  const judgeMessages = [
    {
      role: "system" as const,
      content:
        "Você é um juiz que avalia se a resposta de um agente de IA atende ao critério informado. Responda EXCLUSIVAMENTE chamando a tool 'judge'. Seja rigoroso mas justo.",
    },
    {
      role: "user" as const,
      content:
        `Critério a verificar:\n${opts.criteria}\n\n` +
        `Conversa simulada:\n${conv}\n\n` +
        `Resposta final do agente:\n${opts.reply}\n\n` +
        `A resposta atende ao critério?`,
    },
  ];
  const judgeTool = {
    type: "function" as const,
    function: {
      name: "judge",
      description: "Veredito sobre se a resposta atende ao critério.",
      parameters: {
        type: "object",
        properties: {
          passed: { type: "boolean", description: "true se atende, false caso contrário" },
          reason: { type: "string", description: "Motivo curto em português" },
        },
        required: ["passed", "reason"],
        additionalProperties: false,
      },
    },
  };
  try {
    const r = await fetch(AI_GATEWAY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: judgeMessages,
        temperature: 0,
        max_tokens: 300,
        tools: [judgeTool],
        tool_choice: { type: "function", function: { name: "judge" } },
      }),
    });
    if (!r.ok) return { passed: true, reason: `juiz indisponível (${r.status})` };
    const j = (await r.json()) as { choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }> };
    const args = j.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return { passed: true, reason: "juiz não retornou veredito" };
    const parsed = JSON.parse(args) as { passed?: boolean; reason?: string };
    return { passed: !!parsed.passed, reason: String(parsed.reason ?? "") };
  } catch (e) {
    return { passed: true, reason: `juiz erro: ${(e as Error).message}` };
  }
}
