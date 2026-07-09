// Helpers compartilhados internamente pelo motor de automação (Deno-only).
// Estes helpers são puros (operam só sobre o grafo) e podem ser reusados
// pelo fluxo normal de execução (executeFlow) e pelo fast-path de broadcast
// (event "broadcast_send" no mesmo arquivo automation-engine/index.ts).
//
// IMPORTANTE: este módulo é a FONTE ÚNICA dos invariantes do walker
// (SIDE_BRANCH_BLOCKING_TYPES, computeFastPathPlan, etc.) — duplicar a
// lista em outro arquivo introduz divergência silenciosa quando o motor
// ganhar novos tipos bloqueantes no futuro. Sempre importe daqui.

export interface FlowNode {
  id: string;
  type:
    | "trigger" | "message" | "question" | "wait" | "condition" | "webhook"
    | "set_status" | "move_to_pipeline" | "activecampaign" | "add_tag"
    | "assign_ai_agent" | "assign_user" | "randomizer" | "send_to_blocklist";
  data: Record<string, any>;
}

export interface FlowEdge {
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
}

export interface Graph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/**
 * Tipos de nó que, quando encontrados percorrendo o ramo `next` inline
 * a partir de um nó de mensagem com botões, interrompem o walk e fazem
 * o motor pausar de volta no nó de mensagem aguardando o clique.
 *
 * O fast-path de broadcast TAMBÉM usa esta lista via runCheapTail — qualquer
 * mudança aqui automaticamente propaga para os dois caminhos.
 */
export const SIDE_BRANCH_BLOCKING_TYPES: ReadonlySet<string> = new Set([
  "message", "question", "wait",
]);

/**
 * Resolve a próxima aresta de um nó. Default: aresta `next` ou a aresta
 * sem `sourceHandle` (que o editor visual usa como saída padrão).
 */
export function nextNode(
  graph: Graph,
  fromId: string,
  handle: string | null = null,
): FlowNode | null {
  const edge = graph.edges.find(
    (e) => e.source === fromId && (handle == null
      ? !e.sourceHandle || e.sourceHandle === "next"
      : e.sourceHandle === handle),
  );
  if (!edge) return null;
  return graph.nodes.find((n) => n.id === edge.target) ?? null;
}

/**
 * Sorteia uma variante do nó randomizer respeitando os pesos definidos.
 * Retorna o índice escolhido + label (para registro em run_steps).
 */
export function pickRandomizerBranch(
  node: FlowNode,
): { index: number; label: string | null } {
  const paths = (Array.isArray(node.data?.paths) ? node.data.paths : []) as {
    label?: string; weight?: number;
  }[];
  const safe = paths.length >= 2 ? paths : [
    { label: "A", weight: 1 }, { label: "B", weight: 1 },
  ];
  const total = safe.reduce((s, p) => s + Math.max(0, Number(p.weight) || 0), 0);
  let idx = 0;
  if (total > 0) {
    let r = Math.random() * total;
    for (let i = 0; i < safe.length; i++) {
      r -= Math.max(0, Number(safe[i].weight) || 0);
      if (r <= 0) { idx = i; break; }
    }
  } else {
    idx = Math.floor(Math.random() * safe.length);
  }
  return { index: idx, label: safe[idx]?.label ?? null };
}

/**
 * Plano do fast-path para um grafo de broadcast.
 *
 * - "randomizer": trigger → randomizer → N variantes message(template+botões)
 * - "single":     trigger → message(template+botões) único
 * - null:         grafo não elegível (cair para o motor normal)
 *
 * Elegibilidade (estrita — quando em dúvida, fallback):
 *  - Trigger existe.
 *  - Caminho do trigger até o primeiro nó de envio NÃO tem `condition`
 *    nem nenhum nó data-dependent (qualquer divergência manda para o motor).
 *  - Primeiro nó de envio é message com mode="template" e templateId.
 *  - No caso randomizer: TODAS as saídas `out:i` levam direto a um
 *    message(template+botões) elegível (sem nós intermediários).
 */
export type FastPathPlan =
  | { kind: "single"; messageNode: FlowNode }
  | { kind: "randomizer"; randomizerNode: FlowNode; variants: Array<{ index: number; messageNode: FlowNode }> }
  | null;

export function computeFastPathPlan(graph: Graph): FastPathPlan {
  const trigger = graph.nodes.find((n) => n.type === "trigger");
  if (!trigger) return null;

  const firstNode = nextNode(graph, trigger.id);
  if (!firstNode) return null;

  // Aceita um único nó de envio direto.
  if (firstNode.type === "message" && isTemplateWithButtons(firstNode, graph)) {
    return { kind: "single", messageNode: firstNode };
  }

  // Aceita randomizer cujas N saídas vão direto a message(template+botões).
  if (firstNode.type === "randomizer") {
    const paths = Array.isArray(firstNode.data?.paths) ? firstNode.data.paths : [];
    const count = paths.length >= 2 ? paths.length : 2;
    const variants: Array<{ index: number; messageNode: FlowNode }> = [];
    for (let i = 0; i < count; i++) {
      const target = nextNode(graph, firstNode.id, `out:${i}`);
      if (!target) return null;
      if (target.type !== "message" || !isTemplateWithButtons(target, graph)) return null;
      variants.push({ index: i, messageNode: target });
    }
    return { kind: "randomizer", randomizerNode: firstNode, variants };
  }

  return null;
}

function isTemplateWithButtons(node: FlowNode, graph: Graph): boolean {
  if (node.type !== "message") return false;
  const mode = node.data?.mode ?? "text";
  if (mode !== "template") return false;
  if (!node.data?.templateId) return false;
  // Precisa ter ao menos uma aresta de botão; caso contrário não há resposta
  // a aguardar e o fast-path perde o sentido (não há `waiting_button`).
  const hasButtonEdges = graph.edges.some(
    (e) => e.source === node.id && e.sourceHandle?.startsWith("btn:"),
  );
  return hasButtonEdges;
}
