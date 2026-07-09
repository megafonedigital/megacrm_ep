import { createFileRoute, redirect, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Loader2, Save, Bot, Check, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  getAgent, updateAgent,
  listKnowledgeBases, setAgentKnowledge,
} from "@/lib/ai-agents.functions";
import { TestsTab } from "@/components/agents/TestsTab";
import { AgentRunsTable } from "@/components/agents/AgentRunsTable";
import { InputsTab, type AgentInputDef } from "@/components/agents/InputsTab";
import { VersionsTab } from "@/components/agents/VersionsTab";
import { DashboardTab } from "@/components/agents/DashboardTab";
import { BrandAiHumanizeCard } from "@/components/settings/BrandAiHumanizeCard";
import { EllieFunctionsTab } from "@/components/agents/ellie/EllieFunctionsTab";
import { EllieVoiceTab } from "@/components/agents/ellie/EllieVoiceTab";
import { EllieButtonsTab } from "@/components/agents/ellie/EllieButtonsTab";
import { EllieThreadTab } from "@/components/agents/ellie/EllieThreadTab";
import { EllieValidationTab } from "@/components/agents/ellie/EllieValidationTab";
import { EllieMemoryTab } from "@/components/agents/ellie/EllieMemoryTab";
import { EllieLeadModeTab } from "@/components/agents/ellie/EllieLeadModeTab";
import { isEllie } from "@/lib/ellie";
import { useMe } from "@/lib/auth";


export const Route = createFileRoute("/admin/agentes/$id")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  component: AgenteEditor,
});

const MODELS = [
  "google/gemini-3-flash-preview",
  "google/gemini-2.5-flash",
  "google/gemini-2.5-pro",
  "openai/gpt-5-mini",
  "openai/gpt-5",
];

type KbKind = "company" | "context" | "product";

type KbItem = {
  id: string;
  name?: string;
  title?: string;
  product_name?: string;
  source?: string;
  summary?: string | null;
  utm_default?: string | null;
  utm_params?: {
    source?: string | null;
    medium?: string | null;
    campaign?: string | null;
    content?: string | null;
    term?: string | null;
    site?: string | null;
  } | null;
  starts_at?: string;
  ends_at?: string;
};

function AgenteEditor() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const getFn = useServerFn(getAgent);
  const updateFn = useServerFn(updateAgent);
  const listKbFn = useServerFn(listKnowledgeBases);
  const setKnowledgeFn = useServerFn(setAgentKnowledge);

  const { data, isLoading } = useQuery({
    queryKey: ["ai-agent", id],
    queryFn: () => getFn({ data: { agentId: id } }),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agent = data?.agent as any;
  const brandId = agent?.brand_id as string | undefined;
  const knowledge = data?.knowledge;

  const { data: kbData } = useQuery({
    queryKey: ["ai-kb", brandId],
    queryFn: () => listKbFn({ data: { brandId: brandId! } }),
    enabled: !!brandId,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["ai-agent", id] });
    qc.invalidateQueries({ queryKey: ["ai-kb", brandId] });
  };

  if (isLoading || !agent) {
    return <div className="flex justify-center p-10"><Loader2 className="animate-spin" /></div>;
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate({ to: "/admin/agentes" })}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Bot className="h-5 w-5" />
        <h1 className="text-xl font-semibold flex-1">{agent.name}</h1>
        <Badge variant={agent.status === "on" ? "default" : agent.status === "test" ? "outline" : "secondary"}>
          {agent.status === "on" ? "Ligado" : agent.status === "test" ? "Teste" : "Desligado"}
        </Badge>
      </div>

      <Tabs defaultValue="prompt">
        <div className="overflow-x-auto -mx-1 px-1">
          <TabsList className="w-max">
            <TabsTrigger value="prompt">System Prompt</TabsTrigger>
            <TabsTrigger value="inputs">Inputs</TabsTrigger>
            <TabsTrigger value="bases">Bases de conhecimento</TabsTrigger>
            <TabsTrigger value="testes">Testes</TabsTrigger>
            <TabsTrigger value="status">Status & Whitelist</TabsTrigger>
            <TabsTrigger value="escalacao">Transferência humana</TabsTrigger>
            <TabsTrigger value="parametros">Parâmetros</TabsTrigger>
            <HumanizeTabTrigger />
            {isEllie(brandId) && <TabsTrigger value="ellie-funcoes">Funções</TabsTrigger>}
            {isEllie(brandId) && <TabsTrigger value="ellie-voz">Voz</TabsTrigger>}
            {isEllie(brandId) && <TabsTrigger value="ellie-botoes">Botões</TabsTrigger>}
            {isEllie(brandId) && <TabsTrigger value="ellie-thread">Thread</TabsTrigger>}
            {isEllie(brandId) && <TabsTrigger value="ellie-validacao">Validação aluno</TabsTrigger>}
            {isEllie(brandId) && <TabsTrigger value="ellie-memoria">Memória</TabsTrigger>}
            {isEllie(brandId) && <TabsTrigger value="ellie-lead">Modo Lead</TabsTrigger>}
            <TabsTrigger value="execucoes">Execuções</TabsTrigger>
            <TabsTrigger value="versoes">Versões</TabsTrigger>
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          </TabsList>
        </div>


        <TabsContent value="prompt" className="mt-4">
          <PromptTab agent={agent} updateFn={updateFn} refresh={refresh} />
        </TabsContent>

        <TabsContent value="inputs" className="mt-4">
          <InputsTab
            agentId={id}
            brandId={agent.brand_id}
            initial={(agent.inputs ?? []) as AgentInputDef[]}
            onSaved={refresh}
          />
        </TabsContent>


        <TabsContent value="bases" className="mt-4 space-y-4">
          <Card className="p-4 flex items-center justify-between">
            <div>
              <h3 className="font-semibold">Bases compartilhadas do workspace</h3>
              <p className="text-xs text-muted-foreground">
                Selecione as bases que este agente deve usar. Para criar/editar bases, abra a biblioteca.
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/bases-conhecimento" target="_blank">
                <ExternalLink className="h-4 w-4 mr-1" /> Gerenciar bases
              </Link>
            </Button>
          </Card>

          <KbPicker
            kind="company"
            title="Sobre a empresa / expert"
            agentId={id}
            kbList={kbData?.company ?? []}
            selectedIds={knowledge?.company ?? []}
            setKnowledgeFn={setKnowledgeFn}
            refresh={refresh}
          />
          <KbPicker
            kind="product"
            title="Produtos"
            agentId={id}
            kbList={(kbData?.product ?? []) as unknown as KbItem[]}
            selectedIds={knowledge?.product ?? []}
            setKnowledgeFn={setKnowledgeFn}
            refresh={refresh}
          />
          <KbPicker
            kind="context"
            title="Contexto atual"
            agentId={id}
            kbList={kbData?.context ?? []}
            selectedIds={knowledge?.context ?? []}
            setKnowledgeFn={setKnowledgeFn}
            refresh={refresh}
          />
        </TabsContent>

        <TabsContent value="testes" className="mt-4">
          <TestsTab agentId={id} />
        </TabsContent>

        <TabsContent value="status" className="mt-4">
          <StatusTab agent={agent} updateFn={updateFn} refresh={refresh} />
        </TabsContent>

        <TabsContent value="escalacao" className="mt-4">
          <EscalationTab agent={agent} updateFn={updateFn} refresh={refresh} />
        </TabsContent>

        <HumanizeTabContent brandId={brandId!} />

        <TabsContent value="parametros" className="mt-4">

          <ParamsTab agent={agent} updateFn={updateFn} refresh={refresh} />
        </TabsContent>

        <TabsContent value="execucoes" className="mt-4">
          {brandId && <AgentRunsTable brandId={brandId} agentId={id} />}
        </TabsContent>

        <TabsContent value="versoes" className="mt-4">
          <VersionsTab agentId={id} />
        </TabsContent>

        <TabsContent value="dashboard" className="mt-4">
          <DashboardTab agentId={id} />
        </TabsContent>

        {isEllie(brandId) && (
          <>
            <TabsContent value="ellie-funcoes" className="mt-4">
              <EllieFunctionsTab agentId={id} />
            </TabsContent>
            <TabsContent value="ellie-voz" className="mt-4">
              <EllieVoiceTab agentId={id} />
            </TabsContent>
            <TabsContent value="ellie-botoes" className="mt-4">
              <EllieButtonsTab
                agentId={id}
                initialQuickReplies={(agent.quick_replies ?? []) as any}
                initialDynamic={!!agent.dynamic_quick_replies}
                initialHelpMeEnabled={!!(agent as any).help_me_enabled}
                initialHelpMeSlowSpeed={Number((agent as any).help_me_slow_speed ?? 0.75)}
                onSaved={refresh}
              />
            </TabsContent>
            <TabsContent value="ellie-thread" className="mt-4">
              <EllieThreadTab agentId={id} agent={agent} onSaved={refresh} />
            </TabsContent>
            <TabsContent value="ellie-validacao" className="mt-4">
              <EllieValidationTab agentId={id} agent={agent} onSaved={refresh} />
            </TabsContent>
            <TabsContent value="ellie-memoria" className="mt-4">
              <EllieMemoryTab agentId={id} agent={agent} onSaved={refresh} />
            </TabsContent>
            <TabsContent value="ellie-lead" className="mt-4">
              <EllieLeadModeTab agentId={id} agent={agent} onSaved={refresh} />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}

// ============= Prompt Tab =============
function PromptTab({ agent, updateFn, refresh }: {
  agent: { id: string; name: string; system_prompt: string; tracking_tag?: string | null };
  updateFn: ReturnType<typeof useServerFn<typeof updateAgent>>;
  refresh: () => void;
}) {
  const [name, setName] = useState(agent.name);
  const [prompt, setPrompt] = useState(agent.system_prompt ?? "");
  const [trackingTag, setTrackingTag] = useState(agent.tracking_tag ?? "");
  const [saving, setSaving] = useState(false);
  const [versionDialogOpen, setVersionDialogOpen] = useState(false);
  const [versionLabel, setVersionLabel] = useState("");
  const [versionNotes, setVersionNotes] = useState("");

  const promptChanged = (prompt ?? "") !== (agent.system_prompt ?? "");

  const generateTag = () => {
    const base = (name ?? "agente")
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40);
    setTrackingTag(`agente-${base}`);
  };

  const persist = async (extras?: { version_label?: string; version_notes?: string }) => {
    setSaving(true);
    try {
      await updateFn({
        data: {
          agentId: agent.id,
          patch: {
            name,
            system_prompt: prompt,
            tracking_tag: trackingTag.trim() === "" ? null : trackingTag.trim(),
            ...(extras ?? {}),
          },
        },
      });
      toast.success("Salvo");
      setVersionDialogOpen(false);
      setVersionLabel("");
      setVersionNotes("");
      refresh();
    } catch (e) {
      toast.error((e as Error)?.message ?? "Erro");
    } finally {
      setSaving(false);
    }
  };

  const onSaveClick = () => {
    if (promptChanged) {
      setVersionDialogOpen(true);
    } else {
      persist();
    }
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="space-y-2">
        <Label>Nome</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>System Prompt</Label>
        <Textarea rows={16} value={prompt} onChange={(e) => setPrompt(e.target.value)}
          placeholder="Descreva o papel do agente, regras de tom, limites, quando escalar..." />
        <p className="text-xs text-muted-foreground">
          Bases de conhecimento selecionadas na aba <strong>Bases de conhecimento</strong> são anexadas automaticamente.
          Use <code>{"{{chave}}"}</code> para inserir variáveis (defina-as na aba <strong>Inputs</strong>).
        </p>
      </div>

      <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3">
        <div>
          <Label className="text-sm font-semibold">Tag de rastreio de vendas</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Insira esta tag nos links que o agente envia (em <code>utm_content</code>, <code>sck</code> da Hotmart, ou cupom).
            Vendas com essa tag aparecem como atribuídas no Dashboard.
          </p>
        </div>
        <div className="flex gap-2">
          <Input placeholder="ex: agente-vendas-pri" value={trackingTag} onChange={(e) => setTrackingTag(e.target.value)} />
          <Button type="button" variant="outline" onClick={generateTag}>Gerar do nome</Button>
        </div>
      </div>

      <Button onClick={onSaveClick} disabled={saving}>
        {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        <Save className="h-4 w-4 mr-2" /> Salvar
      </Button>

      <Dialog open={versionDialogOpen} onOpenChange={(o) => !saving && setVersionDialogOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Salvar nova versão</DialogTitle>
            <DialogDescription>
              Esta alteração no system prompt vai gerar uma nova versão. Adicione um rótulo e notas para identificá-la depois (opcional).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Rótulo (opcional)</Label>
              <Input
                placeholder="ex: pré black friday"
                value={versionLabel}
                onChange={(e) => setVersionLabel(e.target.value)}
                maxLength={120}
              />
            </div>
            <div>
              <Label className="text-xs">Notas (opcional)</Label>
              <Textarea
                placeholder="o que mudou nesta versão..."
                value={versionNotes}
                onChange={(e) => setVersionNotes(e.target.value)}
                maxLength={2000}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVersionDialogOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button
              onClick={() => persist({
                version_label: versionLabel.trim() || undefined,
                version_notes: versionNotes.trim() || undefined,
              })}
              disabled={saving}
            >
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar versão
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ============= KB Picker (multi-select read-only) =============
function labelOf(kind: KbKind, item: KbItem): string {
  if (kind === "company") return item.name ?? "(sem nome)";
  if (kind === "context") return item.title ?? "(sem título)";
  return item.product_name ?? "(sem nome)";
}

function KbPicker({
  kind, title, agentId, kbList, selectedIds, setKnowledgeFn, refresh,
}: {
  kind: KbKind;
  title: string;
  agentId: string;
  kbList: KbItem[];
  selectedIds: string[];
  setKnowledgeFn: ReturnType<typeof useServerFn<typeof setAgentKnowledge>>;
  refresh: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(selectedIds));
  const [saving, setSaving] = useState(false);

  useEffect(() => { setSelected(new Set(selectedIds)); }, [selectedIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const persist = async () => {
    setSaving(true);
    try {
      await setKnowledgeFn({ data: { agentId, kind, kbIds: Array.from(selected) } });
      toast.success("Vínculos atualizados");
      refresh();
    } catch (e) {
      toast.error((e as Error)?.message ?? "Erro");
    } finally { setSaving(false); }
  };

  const dirty = useMemo(() => {
    const a = [...selected].sort().join(",");
    const b = [...selectedIds].sort().join(",");
    return a !== b;
  }, [selected, selectedIds]);

  return (
    <Card className="p-4 space-y-3">
      <h3 className="font-semibold">{title}</h3>

      {kbList.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          Nenhuma base cadastrada neste workspace.
        </p>
      ) : (
        <div className="space-y-2">
          {kbList.map((item) => {
            const checked = selected.has(item.id);
            const utmSummary = (() => {
              if (kind !== "product") return "";
              const parts: string[] = [];
              const p = item.utm_params ?? {};
              const entries: Array<[string, string | null | undefined]> = [
                ["source", p.source],
                ["medium", p.medium],
                ["campaign", p.campaign],
                ["content", p.content],
                ["term", p.term],
                ["site", p.site],
              ];
              for (const [k, v] of entries) {
                if (v) parts.push(`${k}=${v}`);
              }
              if (parts.length === 0 && item.utm_default) parts.push(`campaign=${item.utm_default}`);
              return parts.length ? ` • UTM ${parts.join(" ")}` : "";
            })();
            const sub =
              kind === "product"
                ? `${item.source ?? ""}${item.summary ? ` • ${item.summary}` : ""}${utmSummary}`
                : kind === "context" && item.starts_at && item.ends_at
                  ? `${new Date(item.starts_at).toLocaleDateString()} → ${new Date(item.ends_at).toLocaleDateString()}`
                  : "";
            return (
              <label key={item.id} className="border rounded p-3 flex items-center gap-3 cursor-pointer">
                <Checkbox checked={checked} onCheckedChange={() => toggle(item.id)} />
                <div className="flex-1">
                  <div className="font-medium">{labelOf(kind, item)}</div>
                  {sub && <div className="text-xs text-muted-foreground truncate">{sub}</div>}
                </div>
              </label>
            );
          })}
        </div>
      )}

      {dirty && (
        <div className="flex justify-end">
          <Button size="sm" onClick={persist} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            <Check className="h-4 w-4 mr-1" /> Salvar vínculos
          </Button>
        </div>
      )}
    </Card>
  );
}

// ============= Status Tab =============
function StatusTab({ agent, updateFn, refresh }: {
  agent: { id: string; status: string; whitelist: unknown };
  updateFn: ReturnType<typeof useServerFn<typeof updateAgent>>;
  refresh: () => void;
}) {
  const [status, setStatus] = useState<"off" | "test" | "on">((agent.status as "off" | "test" | "on") ?? "off");
  const [whitelist, setWhitelist] = useState<string[]>(Array.isArray(agent.whitelist) ? agent.whitelist as string[] : []);
  const [newNumber, setNewNumber] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await updateFn({ data: { agentId: agent.id, patch: { status, whitelist } } });
      toast.success("Salvo"); refresh();
    } catch (e) { toast.error((e as Error)?.message ?? "Erro"); }
    finally { setSaving(false); }
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="space-y-2">
        <Label>Status</Label>
        <Select value={status} onValueChange={(v) => setStatus(v as "off" | "test" | "on")}>
          <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="off">Desligado — não responde</SelectItem>
            <SelectItem value="test">Teste — responde só whitelist</SelectItem>
            <SelectItem value="on">Ligado — responde a todos</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          A distribuição por canal é configurada em <strong>Workspaces → Editar canal → Distribuição automática</strong>.
        </p>
      </div>
      {status === "test" && (
        <div className="space-y-2">
          <Label>Whitelist (números autorizados em modo teste)</Label>
          <div className="flex gap-2">
            <Input value={newNumber} onChange={(e) => setNewNumber(e.target.value)}
              placeholder="Ex: 5511999999999"
              onKeyDown={(e) => {
                if (e.key === "Enter" && newNumber.trim()) {
                  setWhitelist([...whitelist, newNumber.trim()]); setNewNumber("");
                }
              }} />
            <Button variant="outline" onClick={() => {
              if (newNumber.trim()) { setWhitelist([...whitelist, newNumber.trim()]); setNewNumber(""); }
            }}>Adicionar</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {whitelist.map((n, i) => (
              <Badge key={i} variant="secondary" className="gap-2">
                {n}
                <button onClick={() => setWhitelist(whitelist.filter((_, j) => j !== i))}>×</button>
              </Badge>
            ))}
          </div>
        </div>
      )}
      <Button onClick={save} disabled={saving}>
        {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Salvar
      </Button>
    </Card>
  );
}

// ============= Params Tab =============
function ParamsTab({ agent, updateFn, refresh }: {
  agent: {
    id: string; model: string; temperature: number; max_output_tokens: number;
    response_delay_ms: number; context_window_messages: number;
    rate_limit_per_conversation?: number | null;
    rate_limit_window_minutes?: number | null;
    rate_limit_per_agent_hour?: number | null;
    escalation_alert_threshold_pct?: number | null;
    escalation_alert_window_minutes?: number | null;
    escalation_alert_min_runs?: number | null;
    tracking_tag?: string | null;
    name?: string;
  };
  updateFn: ReturnType<typeof useServerFn<typeof updateAgent>>;
  refresh: () => void;
}) {
  const [model, setModel] = useState(agent.model);
  const [temperature, setTemperature] = useState(String(agent.temperature ?? 0.7));
  const [maxTokens, setMaxTokens] = useState(String(agent.max_output_tokens ?? 1024));
  const [delay, setDelay] = useState(String(agent.response_delay_ms ?? 8000));
  const [windowSize, setWindowSize] = useState(String(agent.context_window_messages ?? 20));
  const [rlConv, setRlConv] = useState(String(agent.rate_limit_per_conversation ?? 30));
  const [rlWindow, setRlWindow] = useState(String(agent.rate_limit_window_minutes ?? 60));
  const [rlHour, setRlHour] = useState(
    agent.rate_limit_per_agent_hour == null ? "" : String(agent.rate_limit_per_agent_hour),
  );
  const [alertPct, setAlertPct] = useState(
    agent.escalation_alert_threshold_pct == null ? "" : String(agent.escalation_alert_threshold_pct),
  );
  const [alertWin, setAlertWin] = useState(String(agent.escalation_alert_window_minutes ?? 60));
  const [alertMin, setAlertMin] = useState(String(agent.escalation_alert_min_runs ?? 10));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await updateFn({ data: { agentId: agent.id, patch: {
        model,
        temperature: Number(temperature),
        max_output_tokens: Number(maxTokens),
        response_delay_ms: Number(delay),
        context_window_messages: Number(windowSize),
        rate_limit_per_conversation: Math.max(0, Number(rlConv) || 0),
        rate_limit_window_minutes: Math.max(1, Number(rlWindow) || 60),
        rate_limit_per_agent_hour: rlHour.trim() === "" ? null : Math.max(0, Number(rlHour) || 0),
        escalation_alert_threshold_pct: alertPct.trim() === "" ? null : Math.max(0, Math.min(100, Number(alertPct) || 0)),
        escalation_alert_window_minutes: Math.max(5, Number(alertWin) || 60),
        escalation_alert_min_runs: Math.max(1, Number(alertMin) || 10),
      } } });
      toast.success("Salvo"); refresh();
    } catch (e) { toast.error((e as Error)?.message ?? "Erro"); }
    finally { setSaving(false); }
  };


  return (
    <div className="space-y-4">
      <Card className="p-4 grid grid-cols-2 gap-4">
        <div className="space-y-1 col-span-2">
          <Label>Modelo</Label>
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {MODELS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Temperatura (0 a 2)</Label>
          <Input type="number" step="0.1" min="0" max="2" value={temperature} onChange={(e) => setTemperature(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Máx tokens de saída</Label>
          <Input type="number" min="64" max="8192" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Delay de resposta (ms)</Label>
          <Input type="number" min="0" max="120000" value={delay} onChange={(e) => setDelay(e.target.value)} />
          <p className="text-xs text-muted-foreground">Tempo de espera para agrupar mensagens curtas seguidas antes de responder.</p>
        </div>
        <div className="space-y-1">
          <Label>Janela de contexto (mensagens)</Label>
          <Input type="number" min="1" max="100" value={windowSize} onChange={(e) => setWindowSize(e.target.value)} />
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div>
          <h3 className="font-semibold">Limites de uso</h3>
          <p className="text-xs text-muted-foreground">
            Quando o limite é atingido, o agente registra a execução como <strong>rate-limited</strong> na aba Execuções e <strong>não responde</strong> à mensagem.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1">
            <Label>Máx respostas por conversa</Label>
            <Input type="number" min="0" max="1000" value={rlConv} onChange={(e) => setRlConv(e.target.value)} />
            <p className="text-xs text-muted-foreground">0 = sem limite por conversa.</p>
          </div>
          <div className="space-y-1">
            <Label>Janela (minutos)</Label>
            <Input type="number" min="1" max="1440" value={rlWindow} onChange={(e) => setRlWindow(e.target.value)} />
            <p className="text-xs text-muted-foreground">Período em que o limite acima é contado.</p>
          </div>
          <div className="space-y-1">
            <Label>Máx respostas por hora (todo o agente)</Label>
            <Input type="number" min="0" max="100000" placeholder="sem limite" value={rlHour} onChange={(e) => setRlHour(e.target.value)} />
            <p className="text-xs text-muted-foreground">Vazio = sem teto global.</p>
          </div>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div>
          <h3 className="font-semibold">Alerta de escalonamento</h3>
          <p className="text-xs text-muted-foreground">
            Avisa no Dashboard quando a taxa de escalações ultrapassa o limite na janela configurada. Deixe o limite vazio para desligar.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1">
            <Label>Limite de escalações (%)</Label>
            <Input type="number" min="0" max="100" placeholder="desligado" value={alertPct} onChange={(e) => setAlertPct(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Janela (minutos)</Label>
            <Input type="number" min="5" max="1440" value={alertWin} onChange={(e) => setAlertWin(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Mínimo de runs na janela</Label>
            <Input type="number" min="1" max="10000" value={alertMin} onChange={(e) => setAlertMin(e.target.value)} />
            <p className="text-xs text-muted-foreground">Evita alarme falso com poucos dados.</p>
          </div>
        </div>
      </Card>


      <div>
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Salvar
        </Button>
      </div>

    </div>
  );
}

// ============= Escalation Tab =============
function EscalationTab({ agent, updateFn, refresh }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agent: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateFn: any;
  refresh: () => void;
}) {
  const brandId = agent.brand_id as string;
  const [vendas, setVendas] = useState<string>(agent.escalation_target_vendas ?? "none");
  const [suporte, setSuporte] = useState<string>(agent.escalation_target_suporte ?? "none");
  const [saving, setSaving] = useState(false);

  const { data: members, isLoading } = useQuery({
    queryKey: ["agent-escalation-members", brandId],
    enabled: !!brandId,
    queryFn: async () => {
      const ids = new Set<string>();
      const { data: channels } = await supabase
        .from("brand_channels")
        .select("id")
        .eq("brand_id", brandId);
      const channelIds = (channels ?? []).map((c) => c.id as string);
      if (channelIds.length > 0) {
        const { data: ca } = await supabase
          .from("channel_agents")
          .select("user_id")
          .in("channel_id", channelIds);
        (ca ?? []).forEach((r) => r.user_id && ids.add(r.user_id as string));
      }

      if (ids.size === 0) return [] as Array<{ id: string; full_name: string | null }>;
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", Array.from(ids))
        .eq("active", true);
      return ((profs ?? []) as Array<{ id: string; full_name: string | null }>).sort(
        (a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? "")
      );
    },
  });

  const save = async () => {
    setSaving(true);
    try {
      await updateFn({
        data: {
          agentId: agent.id,
          patch: {
            escalation_target_vendas: vendas === "none" ? null : vendas,
            escalation_target_suporte: suporte === "none" ? null : suporte,
          },
        },
      });
      toast.success("Destinos de escalação salvos");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-4 space-y-4">
      <div>
        <h3 className="font-semibold">Transferência humana</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Quando o agente decidir transferir o atendimento, a conversa é atribuída ao responsável escolhido conforme a trilha (vendas ou suporte) e a IA para de responder nessa conversa.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label>Responsável por Vendas</Label>
          <Select value={vendas} onValueChange={setVendas} disabled={isLoading}>
            <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— Nenhum —</SelectItem>
              {(members ?? []).map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.full_name ?? m.id}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label>Responsável por Suporte</Label>
          <Select value={suporte} onValueChange={setSuporte} disabled={isLoading}>
            <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— Nenhum —</SelectItem>
              {(members ?? []).map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.full_name ?? m.id}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          <Save className="h-4 w-4 mr-2" /> Salvar
        </Button>
      </div>
    </Card>
  );
}

function HumanizeTabTrigger() {
  const { me } = useMe();
  if (!(me?.isAdmin || me?.isDeveloper)) return null;
  return <TabsTrigger value="humanizacao">Humanização</TabsTrigger>;
}

function HumanizeTabContent({ brandId }: { brandId: string }) {
  const { me } = useMe();
  if (!(me?.isAdmin || me?.isDeveloper)) return null;
  return (
    <TabsContent value="humanizacao" className="mt-4">
      <BrandAiHumanizeCard brandId={brandId} />
    </TabsContent>
  );
}
