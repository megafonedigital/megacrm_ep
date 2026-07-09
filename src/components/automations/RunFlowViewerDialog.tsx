import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
  type EdgeProps,
  BaseEdge,
  getBezierPath,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Zap, MessageSquare, Clock, GitBranch, Webhook as WebhookIcon, CheckCircle2,
  KanbanSquare, Tags as TagsIcon, Tag, Bot, Shuffle, AlertTriangle, Loader2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

type NodeKind =
  | "trigger" | "message" | "wait" | "condition" | "webhook"
  | "set_status" | "move_to_pipeline" | "activecampaign"
  | "add_tag" | "assign_ai_agent" | "randomizer";

const NODE_META: Record<string, { label: string; icon: any; tone: string }> = {
  trigger:          { label: "Gatilho",            icon: Zap,           tone: "from-amber-500 to-orange-500" },
  message:          { label: "Mensagem",           icon: MessageSquare, tone: "from-emerald-500 to-emerald-600" },
  wait:             { label: "Aguardar",           icon: Clock,         tone: "from-purple-500 to-purple-600" },
  condition:        { label: "Condicional",        icon: GitBranch,     tone: "from-orange-500 to-orange-600" },
  webhook:          { label: "Webhook",            icon: WebhookIcon,   tone: "from-pink-500 to-pink-600" },
  set_status:       { label: "Status da conversa", icon: CheckCircle2,  tone: "from-green-500 to-green-600" },
  move_to_pipeline: { label: "Pipeline",           icon: KanbanSquare,  tone: "from-indigo-500 to-indigo-600" },
  activecampaign:   { label: "ActiveCampaign",     icon: TagsIcon,      tone: "from-sky-600 to-sky-700" },
  add_tag:          { label: "Tag",                icon: Tag,           tone: "from-yellow-400 to-yellow-500" },
  assign_ai_agent:  { label: "Agente de IA",       icon: Bot,           tone: "from-violet-500 to-violet-600" },
  randomizer:       { label: "Randomizador",       icon: Shuffle,       tone: "from-fuchsia-500 to-fuchsia-600" },
};

type NodeData = {
  kind: NodeKind | string;
  visited: boolean;
  order: number | null;
  isCurrent: boolean;
  hasError: boolean;
  errorMsg: string | null;
};

function ViewNode({ data }: NodeProps) {
  const d = data as unknown as NodeData;
  const meta = NODE_META[d.kind] ?? { label: d.kind, icon: Zap, tone: "from-slate-500 to-slate-600" };
  const Icon = meta.icon;

  let borderClass = "border-border";
  if (d.hasError) borderClass = "border-red-500 ring-2 ring-red-500/40";
  else if (d.isCurrent) borderClass = "border-primary ring-2 ring-primary/40 animate-pulse";
  else if (d.visited) borderClass = "border-emerald-500 ring-1 ring-emerald-500/40";

  const opacityClass = d.visited || d.isCurrent || d.hasError ? "opacity-100" : "opacity-40";

  return (
    <div className={`relative rounded-lg bg-card shadow-sm border-2 ${borderClass} ${opacityClass} min-w-[200px]`}>
      <Handle type="target" position={Position.Top} style={{ visibility: "hidden" }} />
      <div className={`flex items-center gap-2 px-3 py-2 rounded-t-md text-white bg-gradient-to-r ${meta.tone}`}>
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium">{meta.label}</span>
        {d.order !== null && (
          <span className="ml-auto bg-white/95 text-foreground text-[10px] font-bold rounded-full h-5 min-w-5 px-1.5 flex items-center justify-center">
            {d.order}
          </span>
        )}
        {d.hasError && <AlertTriangle className="h-4 w-4 ml-auto" />}
      </div>
      <div className="px-3 py-2 text-xs text-muted-foreground">
        <code className="font-mono text-[10px]">{(data as any).label ?? ""}</code>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ visibility: "hidden" }} />
    </div>
  );
}

function PathEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data } = props;
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const traversed = !!(data as any)?.traversed;
  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={markerEnd}
      style={{
        stroke: traversed ? "hsl(var(--primary))" : "hsl(var(--muted-foreground) / 0.25)",
        strokeWidth: traversed ? 2.5 : 1.5,
        strokeDasharray: traversed ? undefined : "4 4",
      }}
    />
  );
}

const nodeTypes = { view: ViewNode };
const edgeTypes = { path: PathEdge };

type Step = {
  id: string;
  executed_at: string;
  node_id: string;
  node_type: string;
  payload: any;
  error: string | null;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runId: string | null;
  automationId: string | null;
  runStatus?: string;
  currentNodeId?: string | null;
}

export function RunFlowViewerDialog({ open, onOpenChange, runId, automationId, runStatus, currentNodeId }: Props) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) setSelectedNodeId(null);
  }, [open]);

  const graphQ = useQuery({
    queryKey: ["run-flow-graph", automationId],
    enabled: open && !!automationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("automations")
        .select("graph, name")
        .eq("id", automationId!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const stepsQ = useQuery({
    queryKey: ["run-flow-steps", runId],
    enabled: open && !!runId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("automation_run_steps")
        .select("id, executed_at, node_id, node_type, payload, error")
        .eq("run_id", runId!)
        .order("executed_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Step[];
    },
  });

  const { nodes, edges, stepByNode } = useMemo(() => {
    const graph = (graphQ.data?.graph as any) ?? { nodes: [], edges: [] };
    const steps = stepsQ.data ?? [];

    // Map node_id -> first step (for ordering / payload display)
    const stepByNode = new Map<string, { step: Step; order: number }>();
    steps.forEach((s, i) => {
      if (!stepByNode.has(s.node_id)) stepByNode.set(s.node_id, { step: s, order: i + 1 });
    });

    const visitedIds = new Set(steps.map((s) => s.node_id));

    // Determine traversed edges by looking at consecutive step transitions.
    const traversedEdgeKeys = new Set<string>();
    for (let i = 0; i < steps.length - 1; i++) {
      const from = steps[i].node_id;
      const to = steps[i + 1].node_id;
      traversedEdgeKeys.add(`${from}->${to}`);
    }

    const isWaiting = runStatus === "waiting" || runStatus === "sleeping" || runStatus === "running" || runStatus === "waiting_button";

    const flowNodes: Node[] = (graph.nodes ?? []).filter((n: any) => n.type !== "comment").map((n: any) => {
      const hit = stepByNode.get(n.id);
      const stepErr = hit?.step.error ?? null;
      return {
        id: n.id,
        type: "view",
        position: n.position ?? { x: 0, y: 0 },
        data: {
          kind: n.type,
          visited: visitedIds.has(n.id),
          order: hit?.order ?? null,
          isCurrent: isWaiting && currentNodeId === n.id,
          hasError: !!stepErr,
          errorMsg: stepErr,
          label: n.id,
        },
        draggable: false,
        selectable: true,
      };
    });

    const commentNodeIds = new Set((graph.nodes ?? []).filter((n: any) => n.type === "comment").map((n: any) => n.id));
    const flowEdges: Edge[] = (graph.edges ?? []).filter((e: any) => !commentNodeIds.has(e.source) && !commentNodeIds.has(e.target)).map((e: any) => ({
      id: e.id ?? `${e.source}-${e.target}-${e.sourceHandle ?? "x"}`,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      type: "path",
      data: { traversed: traversedEdgeKeys.has(`${e.source}->${e.target}`) },
    }));

    return { nodes: flowNodes, edges: flowEdges, stepByNode };
  }, [graphQ.data, stepsQ.data, runStatus, currentNodeId]);

  const selectedStep = selectedNodeId ? stepByNode.get(selectedNodeId)?.step ?? null : null;

  const loading = graphQ.isLoading || stepsQ.isLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[95vw] h-[90vh] p-0 flex flex-col">
        <DialogHeader className="px-6 pt-6 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2">
            Fluxo da execução
            {graphQ.data?.name && <span className="text-sm font-normal text-muted-foreground">— {graphQ.data.name}</span>}
          </DialogTitle>
          <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded border-2 border-emerald-500" /> Executado
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded border-2 border-primary" /> Aguardando aqui
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded border-2 border-red-500" /> Erro
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded border-2 border-border opacity-40" /> Não percorrido
            </span>
          </div>
        </DialogHeader>

        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 relative">
            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando fluxo...
              </div>
            ) : nodes.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                Esta automação ainda não tem fluxo salvo.
              </div>
            ) : (
              <ReactFlowProvider>
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  edgeTypes={edgeTypes}
                  nodesDraggable={false}
                  nodesConnectable={false}
                  elementsSelectable
                  onNodeClick={(_, n) => setSelectedNodeId(n.id)}
                  onPaneClick={() => setSelectedNodeId(null)}
                  fitView
                  fitViewOptions={{ padding: 0.2 }}
                >
                  <Background />
                  <Controls showInteractive={false} />
                  <MiniMap pannable zoomable />
                </ReactFlow>
              </ReactFlowProvider>
            )}
          </div>

          <aside className="w-[340px] border-l bg-muted/30 overflow-y-auto p-4 text-sm">
            {!selectedNodeId ? (
              <div className="text-muted-foreground space-y-3">
                <p className="text-xs">Clique em um nó destacado para ver os detalhes daquele passo.</p>
                <div>
                  <div className="text-xs font-medium text-foreground mb-1">Resumo</div>
                  <div className="text-xs">
                    {(stepsQ.data?.length ?? 0)} passo(s) executado(s)
                  </div>
                </div>
              </div>
            ) : !selectedStep ? (
              <div className="text-muted-foreground space-y-2">
                <Badge variant="outline">Não percorrido</Badge>
                <p className="text-xs">Este nó não foi executado nesta run.</p>
                <p className="text-[11px] font-mono break-all">{selectedNodeId}</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <div className="text-xs text-muted-foreground">Nó</div>
                  <div className="font-mono text-xs break-all">{selectedStep.node_id}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{selectedStep.node_type}</Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(selectedStep.executed_at).toLocaleString("pt-BR")}
                  </span>
                </div>
                {selectedStep.error && (
                  <div>
                    <div className="text-xs font-medium text-destructive mb-1">Erro</div>
                    <pre className="bg-destructive/10 text-destructive p-2 rounded text-[11px] whitespace-pre-wrap">{selectedStep.error}</pre>
                  </div>
                )}
                {selectedStep.payload && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">Payload</div>
                    <pre className="bg-muted p-2 rounded text-[11px] whitespace-pre-wrap overflow-auto max-h-[400px]">
                      {JSON.stringify(selectedStep.payload, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
