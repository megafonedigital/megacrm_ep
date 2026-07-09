// Pre-built automation graph generators used by quick-create shortcuts.
//
// `buildTemplateFlow(templateId)` returns the canonical "send Meta template"
// flow shown to the user as a 1-click scaffold from the Templates Meta table.

// Canonical catalog of node kinds — shared by the AI flow importer prompt and
// the UI mapping selector to guarantee they never drift apart.
export type KnownNodeKind =
  | "trigger"
  | "message"
  | "question"
  | "wait"
  | "condition"
  | "webhook"
  | "set_status"
  | "move_to_pipeline"
  | "activecampaign"
  | "add_tag"
  | "assign_ai_agent"
  | "assign_user"
  | "randomizer"
  | "send_to_blocklist"
  | "set_variable"
  | "comment";


export const KNOWN_NODE_KINDS: Array<{
  kind: KnownNodeKind;
  label: string;
  group: "Gatilho" | "Mensagens" | "Lógica" | "Ações" | "Tags" | "Integrações" | "Anotações";
  description: string;
}> = [
  { kind: "trigger",            label: "Gatilho",              group: "Gatilho",      description: "Início do fluxo (manual/API, tag, webhook, integração)." },
  { kind: "message",            label: "Mensagem",             group: "Mensagens",    description: "Envia mensagem (texto livre ou template Meta aprovado)." },
  { kind: "question",           label: "Pergunta",             group: "Mensagens",    description: "Pergunta com botões/respostas esperadas." },
  { kind: "wait",               label: "Aguardar",             group: "Lógica",       description: "Pausa o fluxo por um tempo determinado." },
  { kind: "condition",          label: "Condicional",          group: "Lógica",       description: "Ramifica em Sim/Não. Tipos: in_window, in_pipeline, is_blocklisted, field, tag." },
  { kind: "randomizer",         label: "Randomizador",         group: "Lógica",       description: "Distribui aleatoriamente entre N saídas (A/B test)." },
  { kind: "set_variable",       label: "Definir variável",     group: "Lógica",       description: "Atribui um valor a uma variável do fluxo." },
  { kind: "webhook",            label: "Webhook",              group: "Ações",        description: "Chama uma URL externa (GET/POST)." },
  { kind: "set_status",         label: "Status da conversa",   group: "Ações",        description: "Muda o status da conversa (resolvido, aberto, etc.)." },
  { kind: "move_to_pipeline",   label: "Pipeline",             group: "Ações",        description: "Move/remove contato de um pipeline." },
  { kind: "send_to_blocklist",  label: "Enviar p/ blocklist",  group: "Ações",        description: "Adiciona o contato ao blocklist." },
  { kind: "assign_ai_agent",    label: "Agente de IA",         group: "Ações",        description: "Encaminha a conversa para um agente de IA." },
  { kind: "assign_user",        label: "Atribuir atendente",   group: "Ações",        description: "Define o atendente responsável pela conversa (ou Ninguém para remover)." },
  { kind: "add_tag",            label: "Tag",                  group: "Tags",         description: "Adiciona/remove tag interna do contato." },
  { kind: "activecampaign",     label: "ActiveCampaign",       group: "Integrações",  description: "Adiciona tag, lista, ou cria contato no ActiveCampaign." },
  { kind: "comment",            label: "Comentário",           group: "Anotações",    description: "Post-it visual para documentar — não é executado." },
];



export type FlowGraph = {
  nodes: Array<{
    id: string;
    type: string;
    position: { x: number; y: number };
    data: Record<string, unknown>;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
    type?: string;
    animated?: boolean;
  }>;
};

export function buildTemplateFlow(templateId: string): FlowGraph {
  const nodes: FlowGraph["nodes"] = [
    {
      id: "trigger-1",
      type: "trigger",
      position: { x: 400, y: 40 },
      data: { triggerType: "manual" },
    },
    {
      id: "tag-entry",
      type: "add_tag",
      position: { x: 400, y: 200 },
      data: { tags: [], op: "add" },
    },
    {
      id: "comment-1",
      type: "comment",
      position: { x: 680, y: 200 },
      data: { text: "Adicionar tags" },
    },
    {
      id: "condition-1",
      type: "condition",
      position: { x: 400, y: 360 },
      data: { kind: "is_blocklisted" },
    },
    {
      id: "tag-sim",
      type: "add_tag",
      position: { x: 200, y: 540 },
      data: { tags: [], op: "add" },
    },
    {
      id: "message-1",
      type: "message",
      position: { x: 560, y: 540 },
      data: { mode: "template", templateId },
    },
    {
      id: "tag-erro",
      type: "add_tag",
      position: { x: 880, y: 540 },
      data: { tags: [], op: "add" },
    },
    {
      id: "tag-erro-meta",
      type: "add_tag",
      position: { x: 880, y: 700 },
      data: { tags: [], op: "add" },
    },
  ];

  const edges: FlowGraph["edges"] = [
    { id: "e-trig-tag", source: "trigger-1", target: "tag-entry", type: "deletable", animated: true },
    { id: "e-tag-cond", source: "tag-entry", target: "condition-1", type: "deletable", animated: true },
    { id: "e-cond-sim", source: "condition-1", sourceHandle: "true", target: "tag-sim", type: "deletable", animated: true },
    { id: "e-cond-nao", source: "condition-1", sourceHandle: "false", target: "message-1", type: "deletable", animated: true },
    { id: "e-msg-err", source: "message-1", sourceHandle: "error", target: "tag-erro", type: "deletable", animated: true },
    { id: "e-msg-errmeta", source: "message-1", sourceHandle: "error_meta", target: "tag-erro-meta", type: "deletable", animated: true },
  ];

  return { nodes, edges };
}
