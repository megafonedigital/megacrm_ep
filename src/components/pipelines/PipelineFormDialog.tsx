import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/auth";
import { useActiveBrand } from "@/lib/active-brand";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";

type DistributionMode = "none" | "round_robin" | "random";

interface Pipeline {
  id: string;
  brand_id: string;
  name: string;
  description: string | null;
  distribution_mode?: DistributionMode | null;
  distribution_user_ids?: string[] | null;
  distribution_ai_agent_ids?: string[] | null;
  folder_id?: string | null;
}

const DEFAULT_STAGES: { name: string; color: string }[] = [
  { name: "Novo", color: "#3b82f6" },
  { name: "Prospecção", color: "#06b6d4" },
  { name: "Conexão", color: "#8b5cf6" },
  { name: "Aguardando pagamento", color: "#f59e0b" },
  { name: "Fechado", color: "#10b981" },
  { name: "Perdido", color: "#ef4444" },
];

export function PipelineFormDialog({
  open, onOpenChange, pipeline, onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pipeline: Pipeline | null;
  onSaved: () => void;
}) {
  const { me } = useMe();
  const { activeBrandId, activeBrand } = useActiveBrand();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<DistributionMode>("none");
  const [userIds, setUserIds] = useState<string[]>([]);
  const [aiAgentIds, setAiAgentIds] = useState<string[]>([]);
  const [templateId, setTemplateId] = useState<string>("__default__");
  const [folderId, setFolderId] = useState<string>("__none__");
  const [saving, setSaving] = useState(false);
  const [ownerPickerOpen, setOwnerPickerOpen] = useState(false);

  const targetBrandId = pipeline?.brand_id ?? activeBrandId ?? null;

  const {
    data: agents,
    isError: agentsFailed,
    isLoading: agentsLoading,
  } = useQuery({
    queryKey: ["pipeline-form-agents", targetBrandId],
    enabled: open && !!targetBrandId,
    queryFn: async () => {
      const ids = new Set<string>();
      const { data: channels, error: channelsError } = await supabase
        .from("brand_channels").select("id").eq("brand_id", targetBrandId!);
      if (channelsError) throw channelsError;
      const channelIds = (channels ?? []).map((c: any) => c.id);
      if (channelIds.length > 0) {
        const { data: ags, error: agentsError } = await supabase
          .from("channel_agents").select("user_id").in("channel_id", channelIds);
        if (agentsError) throw agentsError;
        (ags ?? []).forEach((r: any) => r.user_id && ids.add(r.user_id));
      }
      if (ids.size === 0) return [] as Array<{ id: string; full_name: string | null }>;
      const { data: profs, error: profilesError } = await supabase
        .from("profiles").select("id, full_name").in("id", Array.from(ids)).eq("active", true);
      if (profilesError) throw profilesError;
      return ((profs ?? []) as Array<{ id: string; full_name: string | null }>).sort((a, b) =>
        (a.full_name ?? "").localeCompare(b.full_name ?? ""),
      );
    },
  });

  const {
    data: aiAgents,
    isError: aiAgentsFailed,
    isLoading: aiAgentsLoading,
  } = useQuery({
    queryKey: ["pipeline-form-ai-agents", targetBrandId],
    enabled: open && !!targetBrandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_agents")
        .select("id, name, status")
        .eq("brand_id", targetBrandId!)
        .eq("status", "on")
        .order("name");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
  });

  const { data: templates } = useQuery({
    queryKey: ["pipeline-templates-select", targetBrandId],
    enabled: open && !pipeline && !!targetBrandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipeline_templates")
        .select("id, name, stages")
        .eq("brand_id", targetBrandId!)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string; stages: { name: string; color: string; position: number }[] }>;
    },
  });

  const { data: folders } = useQuery({
    queryKey: ["pipeline-folders-select", targetBrandId],
    enabled: open && !!targetBrandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipeline_folders")
        .select("id, name")
        .eq("brand_id", targetBrandId!)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
  });

  useEffect(() => {
    if (open) {
      setName(pipeline?.name ?? "");
      setDescription(pipeline?.description ?? "");
      setMode((pipeline?.distribution_mode as DistributionMode) ?? "none");
      setUserIds(pipeline?.distribution_user_ids ?? []);
      setAiAgentIds(pipeline?.distribution_ai_agent_ids ?? []);
      setTemplateId("__default__");
      setFolderId(pipeline?.folder_id ?? "__none__");
      setOwnerPickerOpen(false);
    }
  }, [open, pipeline]);

  const totalSelected = userIds.length + aiAgentIds.length;

  const selectedLabel = useMemo(() => {
    const userMap = new Map((agents ?? []).map((a) => [a.id, a.full_name ?? "Sem nome"]));
    const aiMap = new Map((aiAgents ?? []).map((a) => [a.id, a.name]));
    const names = [
      ...userIds.map((id) => userMap.get(id) ?? "—"),
      ...aiAgentIds.map((id) => `${aiMap.get(id) ?? "—"} (IA)`),
    ];
    return names;
  }, [agents, aiAgents, userIds, aiAgentIds]);

  function toggleUser(id: string) {
    setUserIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }
  function toggleAi(id: string) {
    setAiAgentIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Preencha o nome");
      return;
    }
    if (!pipeline && !activeBrandId) {
      toast.error("Selecione um workspace no topo antes de criar");
      return;
    }
    if (mode !== "none" && totalSelected === 0) {
      toast.error("Selecione ao menos um agente ou IA para a distribuição");
      return;
    }
    setSaving(true);
    try {
      const distributionPayload = {
        distribution_mode: mode,
        distribution_user_ids: mode === "none" ? [] : userIds,
        distribution_ai_agent_ids: mode === "none" ? [] : aiAgentIds,
      };
      if (pipeline) {
        const usersChanged =
          (pipeline.distribution_user_ids ?? []).join(",") !== userIds.join(",");
        const aisChanged =
          (pipeline.distribution_ai_agent_ids ?? []).join(",") !== aiAgentIds.join(",");
        const listChanged = usersChanged || aisChanged;
        const { error } = await supabase
          .from("pipelines")
          .update({
            name: name.trim(),
            description: description.trim() || null,
            folder_id: folderId === "__none__" ? null : folderId,
            ...distributionPayload,
            ...(listChanged ? { distribution_cursor: 0 } : {}),
          })
          .eq("id", pipeline.id);
        if (error) throw error;
        toast.success("Pipeline atualizado");
      } else {
        const { data: created, error } = await supabase
          .from("pipelines")
          .insert({
            name: name.trim(),
            description: description.trim() || null,
            brand_id: activeBrandId!,
            created_by: me?.userId ?? null,
            folder_id: folderId === "__none__" ? null : folderId,
            ...distributionPayload,
          })
          .select("id")
          .single();
        if (error) throw error;
        const selectedTemplate = templates?.find((t) => t.id === templateId);
        const stagesToInsert = selectedTemplate
          ? [...(selectedTemplate.stages ?? [])]
              .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
              .map((s, i) => ({ name: s.name, color: s.color, position: i, pipeline_id: created!.id }))
          : DEFAULT_STAGES.map((d, i) => ({ ...d, position: i, pipeline_id: created!.id }));
        await supabase.from("pipeline_stages").insert(stagesToInsert);
        toast.success(selectedTemplate ? `Pipeline criado a partir do modelo "${selectedTemplate.name}"` : "Pipeline criado com etapas padrão");
      }
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  const noUserAgents = (agents ?? []).length === 0;
  const noAiAgents = (aiAgents ?? []).length === 0;
  const noAnyAgent = noUserAgents && noAiAgents;
  const loadingAgents = agentsLoading || aiAgentsLoading;
  const agentLoadFailed = agentsFailed || aiAgentsFailed;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{pipeline ? "Editar pipeline" : "Novo pipeline"}</DialogTitle>
          <DialogDescription>
            {pipeline ? "Atualize as informações do quadro." : "Crie um novo quadro Kanban. Etapas padrão serão criadas e podem ser editadas depois."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Funil de vendas" />
          </div>
          {!pipeline && (
            <div>
              <Label>Modelo (opcional)</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">— Etapas padrão —</SelectItem>
                  {(templates ?? []).map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(() => {
                const tpl = templates?.find((t) => t.id === templateId);
                const stageNames = tpl
                  ? [...(tpl.stages ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((s) => s.name)
                  : DEFAULT_STAGES.map((s) => s.name);
                return (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Etapas iniciais: {stageNames.join(" · ")}
                  </p>
                );
              })()}
            </div>
          )}
          {!pipeline && (
            <div className="text-xs text-muted-foreground">
              Workspace: <strong className="text-foreground">{activeBrand?.name ?? "—"}</strong>
            </div>
          )}
          <div>
            <Label>Pasta (opcional)</Label>
            <Select value={folderId} onValueChange={setFolderId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Sem pasta —</SelectItem>
                {(folders ?? []).map((f) => (
                  <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Descrição (opcional)</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>

          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            <Label>Distribuição de donos</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as DistributionMode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhuma (manter como está)</SelectItem>
                <SelectItem value="round_robin">Round-robin (em ordem)</SelectItem>
                <SelectItem value="random">Aleatória</SelectItem>
              </SelectContent>
            </Select>

            {mode !== "none" && (
              <>
                {agentLoadFailed ? (
                  <p className="text-xs text-destructive">
                    Não foi possível carregar os agentes deste workspace. Tente fechar e abrir novamente.
                  </p>
                ) : loadingAgents ? (
                  <p className="text-xs text-muted-foreground">
                    Carregando agentes…
                  </p>
                ) : noAnyAgent ? (
                  <p className="text-xs text-muted-foreground">
                    Nenhum agente ou IA disponível neste workspace.
                  </p>
                ) : (
                  <div className="relative">
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full justify-between font-normal"
                        aria-expanded={ownerPickerOpen}
                        onClick={() => setOwnerPickerOpen((prev) => !prev)}
                      >
                        <span className="truncate text-left">
                          {totalSelected === 0
                            ? "Selecionar agentes e IAs…"
                            : `${totalSelected} selecionado(s): ${selectedLabel.slice(0, 2).join(", ")}${totalSelected > 2 ? "…" : ""}`}
                        </span>
                        <ChevronDown className="h-4 w-4 opacity-60" />
                      </Button>
                    {ownerPickerOpen && (
                      <div className="mt-1 w-full rounded-md border bg-popover p-2 text-popover-foreground shadow-md">
                        <div className="max-h-64 space-y-2 overflow-y-auto">
                        {!noUserAgents && (
                          <div>
                            <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Usuários
                            </div>
                            {(agents ?? []).map((a) => (
                              <div
                                key={a.id}
                                role="button"
                                tabIndex={0}
                                aria-pressed={userIds.includes(a.id)}
                                onClick={() => toggleUser(a.id)}
                                onKeyDown={(e) => {
                                  if (e.key === " " || e.key === "Enter") {
                                    e.preventDefault();
                                    toggleUser(a.id);
                                  }
                                }}
                                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                              >
                                <Checkbox
                                  checked={userIds.includes(a.id)}
                                  tabIndex={-1}
                                  onClick={(e) => e.stopPropagation()}
                                  onCheckedChange={() => toggleUser(a.id)}
                                />
                                <span className="truncate">{a.full_name ?? "Sem nome"}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {!noAiAgents && (
                          <div>
                            <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Agentes de IA
                            </div>
                            {(aiAgents ?? []).map((a) => (
                              <div
                                key={a.id}
                                role="button"
                                tabIndex={0}
                                aria-pressed={aiAgentIds.includes(a.id)}
                                onClick={() => toggleAi(a.id)}
                                onKeyDown={(e) => {
                                  if (e.key === " " || e.key === "Enter") {
                                    e.preventDefault();
                                    toggleAi(a.id);
                                  }
                                }}
                                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                              >
                                <Checkbox
                                  checked={aiAgentIds.includes(a.id)}
                                  tabIndex={-1}
                                  onClick={(e) => e.stopPropagation()}
                                  onCheckedChange={() => toggleAi(a.id)}
                                />
                                <span className="truncate">{a.name}</span>
                                <Badge variant="secondary" className="ml-auto text-[10px]">IA</Badge>
                              </div>
                            ))}
                          </div>
                        )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Aplica-se a novos cards. Se o contato já tiver dono (humano ou IA), não é substituído. Quando uma IA é sorteada, ela assume a conversa para responder automaticamente.
                </p>
              </>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
