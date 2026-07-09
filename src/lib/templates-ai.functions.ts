import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const InputSchema = z.object({
  brief: z.string().min(10).max(20000),
  namePrefix: z.string().max(40).optional().default(""),
});

const SYSTEM_PROMPT = `Você converte briefings de mensagens em rascunhos de templates HSM do WhatsApp (Meta).

REGRAS OBRIGATÓRIAS:
- Cada "MENSAGEM" do briefing vira UM template separado.
- Variáveis: troque [CAMPO] por {{n}} sequencial começando em {{1}}. O MESMO rótulo dentro do mesmo template REUSA o mesmo número. NUNCA cole duas variáveis ({{1}}{{2}} é proibido — separe com espaço/texto).
- Componentes: sempre inclua um BODY. Se houver linhas com "🔘", agrupe-as em um único componente BUTTONS com type="QUICK_REPLY" e text = texto da opção (sem o 🔘, sem aspas, max 25 chars, max 10 botões). Não use URL nem PHONE_NUMBER.
- SEMPRE QUE O TEMPLATE TIVER COMPONENTE BUTTONS: adicione como ÚLTIMO botão um QUICK_REPLY de opt-out com texto curto e claro (ex.: "Parar de receber", "Não quero mais", "Cancelar contato", "Bloquear contato"). Esse botão conta nos 10 — se já houver 10 botões originais, remova o último e ponha o opt-out no lugar. Varie o texto conforme o tom do template.
- Sem HEADER de mídia. Use HEADER tipo TEXT só se a primeira linha for claramente um título curto (<=60 chars, sem emojis longos); caso contrário, mantenha tudo no BODY.
- FOOTER opcional, curto (<=60 chars), só se houver uma linha final típica de rodapé.
- name: snake_case minúsculo, sem acentos, sem espaços, <=60 chars. Use o prefixo informado + sufixo numérico (_1, _2, ...). Sem prefixo, gere um nome curto a partir do tópico (ex.: compra_expirada_1).
- variables_legend: lista [{index, label, example}] para CADA {{n}} usado no template. "label" é o rótulo original (ex.: "NOME", "NOME DO CURSO"). "example" é um exemplo plausível em pt-BR, curto (<=40 chars), realista mas genérico, sem dados sensíveis (ex.: NOME -> "Maria", NOME DO CURSO -> "Confeitaria Profissional", DATA -> "15/03", VALOR -> "R$ 197", LINK -> "https://exemplo.com/aula").
- BODY.text <= 1024 chars. Preserve emojis e quebras de linha do briefing.

Devolva APENAS JSON válido no schema solicitado, sem comentários.`;

type LegendItem = { index: number; label: string; example: string };
type Component =
  | { type: "HEADER"; format: "TEXT"; text: string }
  | { type: "BODY"; text: string }
  | { type: "FOOTER"; text: string }
  | { type: "BUTTONS"; buttons: Array<{ type: "QUICK_REPLY"; text: string }> };

export type GeneratedTemplate = {
  name: string;
  components: Component[];
  variables_legend: LegendItem[];
};

export const generateTemplatesFromBrief = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<{ templates: GeneratedTemplate[] }> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY não configurada.");

    const userPrompt = `Prefixo de nome: ${data.namePrefix || "(sem prefixo, escolha um nome curto a partir do conteúdo)"}\n\nBRIEFING:\n${data.brief}`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "templates_payload",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["templates"],
              properties: {
                templates: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["name", "components", "variables_legend"],
                    properties: {
                      name: { type: "string" },
                      components: {
                        type: "array",
                        items: {
                          type: "object",
                          additionalProperties: true,
                          required: ["type"],
                          properties: {
                            type: { type: "string", enum: ["HEADER", "BODY", "FOOTER", "BUTTONS"] },
                            format: { type: "string" },
                            text: { type: "string" },
                            buttons: {
                              type: "array",
                              items: {
                                type: "object",
                                additionalProperties: false,
                                required: ["type", "text"],
                                properties: {
                                  type: { type: "string", enum: ["QUICK_REPLY"] },
                                  text: { type: "string" },
                                },
                              },
                            },
                          },
                        },
                      },
                      variables_legend: {
                        type: "array",
                        items: {
                          type: "object",
                          additionalProperties: false,
                          required: ["index", "label", "example"],
                          properties: {
                            index: { type: "integer" },
                            label: { type: "string" },
                            example: { type: "string" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    });

    if (res.status === 429) throw new Error("Limite de requisições da IA atingido. Tente novamente em instantes.");
    if (res.status === 402) throw new Error("Créditos de IA esgotados. Adicione créditos no workspace.");
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Falha na IA (${res.status}): ${txt.slice(0, 300)}`);
    }

    const json = await res.json();
    const content: string = json?.choices?.[0]?.message?.content ?? "";
    let parsed: { templates: GeneratedTemplate[] };
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("A IA não devolveu JSON válido.");
    }
    if (!parsed?.templates?.length) throw new Error("Nenhum template foi gerado a partir do briefing.");
    return parsed;
  });
