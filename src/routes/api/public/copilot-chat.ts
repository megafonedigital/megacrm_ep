import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";
import { createLovableAiGatewayProvider, getLovableAiGatewayRunId } from "@/lib/ai-gateway.server";
import { buildCopilotTools } from "@/lib/copilot-tools.server";
import type { Database } from "@/integrations/supabase/types";

interface ChatBody {
  threadId: string;
  brandId: string;
  newMessageId?: string;
  messages: UIMessage[];
}

function collapseConsecutiveUserMessages(messages: UIMessage[]) {
  return messages.reduce<UIMessage[]>((acc, message) => {
    const last = acc[acc.length - 1];
    if (message.role === "user" && last?.role === "user") {
      acc[acc.length - 1] = message;
      return acc;
    }
    acc.push(message);
    return acc;
  }, []);
}

export const Route = createFileRoute("/api/public/copilot-chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
          return new Response("Missing Supabase env", { status: 500 });
        }

        const authHeader =
          request.headers.get("authorization") ?? request.headers.get("Authorization");
        if (!authHeader) return new Response("Unauthorized", { status: 401 });

        const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          global: { headers: { Authorization: authHeader } },
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const { data: userRes, error: userErr } = await supabase.auth.getUser();
        if (userErr || !userRes?.user) return new Response("Unauthorized", { status: 401 });
        const userId = userRes.user.id;

        // role check
        const { data: roles } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", userId);
        const allowed = (roles ?? []).some((r) =>
          ["admin", "supervisor", "developer"].includes(r.role as string),
        );
        if (!allowed) return new Response("Forbidden", { status: 403 });

        const body = (await request.json()) as ChatBody;
        if (!body?.threadId || !body?.brandId || !Array.isArray(body.messages)) {
          return new Response("Invalid body", { status: 400 });
        }

        // verify thread ownership + workspace
        const { data: thread } = await supabase
          .from("copilot_threads")
          .select("id, brand_id, user_id")
          .eq("id", body.threadId)
          .maybeSingle();
        if (!thread || thread.user_id !== userId || thread.brand_id !== body.brandId) {
          return new Response("Thread not found", { status: 404 });
        }

        // brand name for system prompt
        const { data: brandRow } = await supabase
          .from("brands")
          .select("name")
          .eq("id", body.brandId)
          .maybeSingle();
        const brandName = brandRow?.name ?? "este workspace";

        // Persiste IMEDIATAMENTE a última mensagem do usuário, antes do stream.
        // Se o cliente desconectar (abort, fechar aba, troca de thread), o
        // Worker é encerrado junto e o onFinish não roda — sem este passo a
        // pergunta seria perdida.
        try {
          const lastUser = body.newMessageId
            ? body.messages.find((m) => m.id === body.newMessageId && m.role === "user")
            : [...body.messages].reverse().find((m) => m.role === "user");
          if (body.newMessageId && !lastUser) {
            return new Response("Mensagem enviada não encontrada no histórico do chat.", {
              status: 400,
            });
          }
          if (lastUser?.id) {
            const { error: userUpErr } = await supabase.from("copilot_messages").upsert(
              {
                thread_id: body.threadId,
                sdk_message_id: lastUser.id,
                role: "user",
                parts: (lastUser.parts ?? []) as never,
              },
              { onConflict: "thread_id,sdk_message_id" },
            );
            if (userUpErr) throw userUpErr;

            // Auto-title na primeira mensagem (executa aqui pra não depender do onFinish)
            const { count } = await supabase
              .from("copilot_messages")
              .select("id", { head: true, count: "exact" })
              .eq("thread_id", body.threadId);
            if ((count ?? 0) <= 1) {
              const firstText =
                lastUser.parts
                  ?.map((p) => (p.type === "text" ? p.text : ""))
                  .join(" ")
                  .trim() ?? "";
              if (firstText) {
                await supabase
                  .from("copilot_threads")
                  .update({ title: firstText.slice(0, 80) })
                  .eq("id", body.threadId);
              }
            }
          }
        } catch (e) {
          console.error("[copilot-chat] pre-stream persist", e);
          return new Response("Não foi possível salvar sua pergunta antes de gerar a resposta.", {
            status: 500,
          });
        }

        const role = (roles ?? []).map((r) => r.role).join(",");

        const systemPrompt = `Você é o Copilot do MegaCRM, um assistente operacional para a equipe do workspace "${brandName}". Sua função é responder perguntas sobre dados do CRM, ajudar a diagnosticar problemas (automações travadas, mensagens não entregues, agentes de IA com falhas), auxiliar na redação de mensagens/templates/prompts e **executar ações no CRM em nome do usuário** (alterar status de conversa, atribuir conversas, aplicar/remover tags, mover contatos em pipelines, definir campos personalizados, adicionar à blocklist, disparar automações).

PAPEL DO USUÁRIO: ${role || "desconhecido"}.
WORKSPACE ATIVO: ${brandName} (id: ${body.brandId}).

REGRAS GERAIS:
- Sempre responda em português brasileiro, conciso e objetivo.
- Para qualquer pergunta sobre dados (contatos, conversas, automações, agentes, broadcasts, logs), CHAME UMA TOOL — não invente números.
- Para investigar motivos de escalação ou falhas de um agente de IA, use \`query_ai_agent_runs\`. Para analisar o diálogo de uma conversa específica, use \`get_conversation_messages\`. Para detalhes de pipelines, use \`query_pipelines\`; para atividades por etapa/dia, use \`query_pipeline_activities\`.
- Para ler/analisar/otimizar o prompt de um agente de IA, use \`get_ai_agent_config\` (passe \`includeKnowledge: true\` se precisar da base de conhecimento). Identifique o agentId via \`query_ai_agents\`.
- As tools já estão escopadas para o workspace ativo. Não peça brand_id ao usuário.
- Para pedidos de redação (mensagens, templates HSM, prompts), responda direto sem tool.
- Se uma tool retornar erro, mencione o erro real e proponha próximos passos.

REGRAS PARA TOOLS DE ESCRITA (mutação):
- Tools que MODIFICAM dados: \`set_conversation_status\`, \`assign_conversation\`, \`add_contact_tag\`, \`remove_contact_tag\`, \`set_contact_custom_field\`, \`move_contact_to_stage\`, \`add_to_blocklist\`, \`trigger_automation_for_contact\`.
- ANTES de chamar qualquer uma delas, **descreva o que você vai fazer em linguagem natural** (entidade afetada, valor antigo → novo) e **PEÇA CONFIRMAÇÃO EXPLÍCITA** do usuário ("Confirma?", "Posso seguir? (sim/não)"). Só execute após o "sim".
- Exceção: \`mark_conversation_read\` pode rodar direto, é trivial e reversível.
- Se o usuário pedir uma ação mas você não tiver o ID exato (ex.: conversa, contato, automação), primeiro use as tools de query para localizar o recurso, confirme com o usuário ("Achei a conversa do Afonso Damasceno (+55 16 99118-5738). Quer que eu mude o status para pendente?") e só então chame a tool de escrita.
- Toda mutação executada é gravada em log de auditoria — explique isso se o usuário perguntar sobre rastreabilidade.
- Se a tool retornar \`ok: false\`, mostre o erro ao usuário e NÃO tente repetir automaticamente.

Hoje é ${new Date().toISOString()}.`;

        const initialRunId = getLovableAiGatewayRunId(request);
        const gateway = createLovableAiGatewayProvider(apiKey, initialRunId);
        const model = gateway("google/gemini-3-flash-preview");

        const tools = buildCopilotTools({
          supabase,
          brandId: body.brandId,
          userId,
          threadId: body.threadId,
        });

        const modelMessages = await convertToModelMessages(
          collapseConsecutiveUserMessages(body.messages),
        );
        const result = streamText({
          model,
          system: systemPrompt,
          messages: modelMessages,
          tools,
          stopWhen: stepCountIs(50),
        });

        return result.toUIMessageStreamResponse({
          originalMessages: body.messages,
          // Persistência PRIMÁRIA da resposta do assistente.
          // O cliente (CopilotChat.tsx) também salva como fallback idempotente
          // (mesmo conflict key thread_id+sdk_message_id), garantindo que se um
          // dos dois falhar, o outro completa.
          onFinish: async ({ messages: finishedMessages, isAborted }) => {
            try {
              const assistant = [...finishedMessages]
                .reverse()
                .find((m) => m.role === "assistant");
              if (!assistant?.id) return;
              let parts = (assistant.parts ?? []) as any[];
              if (isAborted) {
                parts = parts.map((p) => ({ ...p }));
                let lastTextIdx = -1;
                parts.forEach((p, i) => {
                  if (p?.type === "text") lastTextIdx = i;
                });
                if (lastTextIdx >= 0) {
                  const t = parts[lastTextIdx] as { type: "text"; text: string };
                  if (!t.text?.includes("_Interrompida._")) {
                    t.text = `${t.text ?? ""}\n\n_Interrompida._`;
                  }
                } else {
                  parts.push({ type: "text", text: "_Interrompida._" });
                }
              }
              const { error: upErr } = await supabase.from("copilot_messages").upsert(
                {
                  thread_id: body.threadId,
                  sdk_message_id: assistant.id,
                  role: "assistant",
                  parts: parts as never,
                },
                { onConflict: "thread_id,sdk_message_id" },
              );
              if (upErr) {
                console.error("[copilot-chat] server persist assistant", upErr);
              }
            } catch (e) {
              console.error("[copilot-chat] onFinish persist failed", e);
            }
          },
        });
      },
    },
  },
});
