import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Play, RefreshCw, Plus, Pencil, Trash2, CheckCircle2, XCircle, Clock, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  listTestScenarios, upsertTestScenario, deleteTestScenario,
  runTestScenario, runAllTestScenarios, syncTestScenariosFromFaq,
} from "@/lib/ai-agent-tests.functions";
import { AbScenariosBlock } from "./AbScenariosBlock";

type Turn = { role: "user" | "assistant"; content: string };
type Scenario = {
  id: string;
  agent_id: string;
  name: string;
  description: string;
  source: "manual" | "faq";
  turns: Turn[];
  expect_must_contain: string[];
  expect_must_not_contain: string[];
  expect_need_human: boolean;
  expect_need_human_reason: string | null;
  judge_criteria: string | null;
  last_status: "pending" | "pass" | "fail" | "error";
  last_run_at: string | null;
  last_response: string | null;
  last_failures: string[] | null;
  last_judge_verdict: { passed: boolean; reason: string } | null;
  last_tool_call: { name: string; reason: string | null; message_to_patient: string | null; escalation_track: string | null } | null;
};

export function TestsTab({ agentId }: { agentId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listTestScenarios);
  const runFn = useServerFn(runTestScenario);
  const runAllFn = useServerFn(runAllTestScenarios);
  const syncFn = useServerFn(syncTestScenariosFromFaq);
  const deleteFn = useServerFn(deleteTestScenario);

  const { data, isLoading } = useQuery({
    queryKey: ["agent-tests", agentId],
    queryFn: () => listFn({ data: { agentId } }),
  });

  const [busyAll, setBusyAll] = useState<null | "all" | "failed" | "sync">(null);
  const [editing, setEditing] = useState<Scenario | "new" | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["agent-tests", agentId] });

  const scenarios = (data?.scenarios ?? []) as unknown as Scenario[];
  const counts = {
    total: scenarios.length,
    pass: scenarios.filter((s) => s.last_status === "pass").length,
    fail: scenarios.filter((s) => s.last_status === "fail" || s.last_status === "error").length,
    pending: scenarios.filter((s) => s.last_status === "pending").length,
  };

  const handleSync = async () => {
    setBusyAll("sync");
    try {
      const r = await syncFn({ data: { agentId } });
      toast.success(`Sincronizado: ${r.created} novos, ${r.kept} mantidos, ${r.removed} removidos`);
      refresh();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusyAll(null); }
  };

  const handleRunAll = async (only: "all" | "failed") => {
    setBusyAll(only);
    try {
      const r = await runAllFn({ data: { agentId, only } });
      toast.success(`Rodou ${r.ran} cenário(s)`);
      refresh();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusyAll(null); }
  };

  const handleRun = async (id: string) => {
    setRunningId(id);
    try {
      await runFn({ data: { scenarioId: id } });
      refresh();
    } catch (e) { toast.error((e as Error).message); }
    finally { setRunningId(null); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir este cenário?")) return;
    try {
      await deleteFn({ data: { scenarioId: id } });
      toast.success("Excluído");
      refresh();
    } catch (e) { toast.error((e as Error).message); }
  };

  if (isLoading) return <div className="flex justify-center p-10"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <AbScenariosBlock agentId={agentId} />
      <Card className="p-4 flex flex-wrap gap-2 items-center">
        <div className="flex-1 min-w-fit">
          <h3 className="font-semibold">Cenários de teste</h3>
          <p className="text-xs text-muted-foreground">
            {counts.total} cenário(s) • {counts.pass} passaram • {counts.fail} falharam • {counts.pending} pendente(s)
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={handleSync} disabled={!!busyAll}>
          {busyAll === "sync" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
          Sincronizar com FAQ
        </Button>
        <Button size="sm" variant="outline" onClick={() => handleRunAll("failed")} disabled={!!busyAll || counts.fail + counts.pending === 0}>
          {busyAll === "failed" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
          Rodar pendentes/falhas
        </Button>
        <Button size="sm" onClick={() => handleRunAll("all")} disabled={!!busyAll || counts.total === 0}>
          {busyAll === "all" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
          Rodar todos
        </Button>
        <Button size="sm" variant="default" onClick={() => setEditing("new")}>
          <Plus className="h-4 w-4 mr-1" /> Novo cenário
        </Button>
      </Card>

      {scenarios.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Nenhum cenário ainda. Use "Sincronizar com FAQ" para gerar a partir das bases vinculadas, ou crie manualmente.
        </Card>
      ) : (
        scenarios.map((s) => (
          <ScenarioCard
            key={s.id}
            scenario={s}
            running={runningId === s.id}
            onRun={() => handleRun(s.id)}
            onEdit={() => setEditing(s)}
            onDelete={() => handleDelete(s.id)}
          />
        ))
      )}

      {editing && (
        <ScenarioDialog
          agentId={agentId}
          scenario={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { refresh(); setEditing(null); }}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Scenario["last_status"] }) {
  if (status === "pass") return <Badge className="bg-green-600 hover:bg-green-600 gap-1"><CheckCircle2 className="h-3 w-3" /> Passou</Badge>;
  if (status === "fail") return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> Falhou</Badge>;
  if (status === "error") return <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" /> Erro</Badge>;
  return <Badge variant="outline" className="gap-1"><Clock className="h-3 w-3" /> Pendente</Badge>;
}

function ScenarioCard({ scenario, running, onRun, onEdit, onDelete }: {
  scenario: Scenario;
  running: boolean;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const lastUser = [...scenario.turns].reverse().find((t) => t.role === "user");
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start gap-2 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-semibold truncate">{scenario.name}</h4>
            {scenario.source === "faq" && <Badge variant="secondary">FAQ</Badge>}
            <StatusBadge status={scenario.last_status} />
          </div>
          {scenario.description && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{scenario.description}</p>
          )}
          {scenario.last_run_at && (
            <p className="text-xs text-muted-foreground mt-1">
              Última execução: {new Date(scenario.last_run_at).toLocaleString()}
            </p>
          )}
        </div>
        <div className="flex gap-1">
          <Button size="icon" variant="ghost" onClick={onEdit}><Pencil className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>
          <Button size="sm" onClick={onRun} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
            Rodar
          </Button>
        </div>
      </div>

      {lastUser && (
        <div className="text-xs bg-muted/50 rounded p-2">
          <span className="font-medium">Paciente:</span> {lastUser.content}
        </div>
      )}

      {scenario.last_response && (
        <div className="text-xs border-l-2 border-primary pl-3 py-1">
          <span className="font-medium">Agente respondeu:</span> {scenario.last_response}
          {scenario.last_tool_call && (
            <div className="mt-1 text-muted-foreground">
              🔧 Tool: {scenario.last_tool_call.name} — reason: <code>{scenario.last_tool_call.reason}</code>
              {scenario.last_tool_call.escalation_track && <> ({scenario.last_tool_call.escalation_track})</>}
            </div>
          )}
        </div>
      )}

      {scenario.last_failures && scenario.last_failures.length > 0 && (
        <ul className="text-xs space-y-0.5">
          {scenario.last_failures.map((f, i) => (
            <li key={i} className="text-destructive flex gap-1"><XCircle className="h-3 w-3 mt-0.5 shrink-0" /> {f}</li>
          ))}
        </ul>
      )}
      {scenario.last_status === "pass" && scenario.last_judge_verdict && (
        <p className="text-xs text-green-700 dark:text-green-500">✓ Juiz IA: {scenario.last_judge_verdict.reason}</p>
      )}
    </Card>
  );
}

function ScenarioDialog({ agentId, scenario, onClose, onSaved }: {
  agentId: string;
  scenario: Scenario | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const upsertFn = useServerFn(upsertTestScenario);
  const [name, setName] = useState(scenario?.name ?? "");
  const [description, setDescription] = useState(scenario?.description ?? "");
  const [turns, setTurns] = useState<Turn[]>(
    scenario?.turns?.length ? scenario.turns : [{ role: "user", content: "" }],
  );
  const [mustContain, setMustContain] = useState((scenario?.expect_must_contain ?? []).join("\n"));
  const [mustNotContain, setMustNotContain] = useState((scenario?.expect_must_not_contain ?? []).join("\n"));
  const [needHuman, setNeedHuman] = useState(scenario?.expect_need_human ?? false);
  const [needHumanReason, setNeedHumanReason] = useState(scenario?.expect_need_human_reason ?? "");
  const [judgeCriteria, setJudgeCriteria] = useState(scenario?.judge_criteria ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const cleanTurns = turns.filter((t) => t.content.trim().length > 0);
    if (cleanTurns.length === 0) { toast.error("Adicione ao menos um turno"); return; }
    if (cleanTurns[cleanTurns.length - 1].role !== "user") {
      toast.error("O último turno precisa ser do paciente"); return;
    }
    setSaving(true);
    try {
      await upsertFn({
        data: {
          id: scenario?.id,
          agentId,
          name: name.trim() || "Sem nome",
          description,
          turns: cleanTurns,
          expect_must_contain: mustContain.split("\n").map((s) => s.trim()).filter(Boolean),
          expect_must_not_contain: mustNotContain.split("\n").map((s) => s.trim()).filter(Boolean),
          expect_need_human: needHuman,
          expect_need_human_reason: needHuman && needHumanReason.trim() ? needHumanReason.trim() : null,
          judge_criteria: judgeCriteria.trim() ? judgeCriteria.trim() : null,
        },
      });
      toast.success("Salvo");
      onSaved();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{scenario ? "Editar cenário" : "Novo cenário"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Descrição</Label>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Conversa simulada</Label>
              <Button type="button" size="sm" variant="outline"
                onClick={() => setTurns([...turns, { role: turns[turns.length - 1]?.role === "user" ? "assistant" : "user", content: "" }])}>
                <Plus className="h-3 w-3 mr-1" /> Turno
              </Button>
            </div>
            {turns.map((t, i) => (
              <div key={i} className="flex gap-2">
                <Select value={t.role} onValueChange={(v) => {
                  const next = [...turns]; next[i] = { ...t, role: v as Turn["role"] }; setTurns(next);
                }}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">Paciente</SelectItem>
                    <SelectItem value="assistant">Agente</SelectItem>
                  </SelectContent>
                </Select>
                <Textarea rows={2} className="flex-1" value={t.content}
                  onChange={(e) => { const next = [...turns]; next[i] = { ...t, content: e.target.value }; setTurns(next); }} />
                <Button type="button" size="icon" variant="ghost"
                  onClick={() => setTurns(turns.filter((_, j) => j !== i))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">O último turno precisa ser do paciente — é o que será enviado ao agente para ele responder.</p>
          </div>

          <div className="border rounded p-3 space-y-3">
            <div className="flex items-center gap-2">
              <Switch checked={needHuman} onCheckedChange={setNeedHuman} />
              <Label className="cursor-pointer">Agente deve transferir para humano</Label>
            </div>
            {needHuman && (
              <div className="space-y-1">
                <Label className="text-xs">Reason esperado (opcional)</Label>
                <Input value={needHumanReason} onChange={(e) => setNeedHumanReason(e.target.value)}
                  placeholder="ex: pediu_humano, duvida_clinica_fora_escopo" />
              </div>
            )}
          </div>

          <div className="space-y-1">
            <Label>Deve conter (uma frase por linha)</Label>
            <Textarea rows={3} value={mustContain} onChange={(e) => setMustContain(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>NÃO deve conter (uma frase por linha)</Label>
            <Textarea rows={3} value={mustNotContain} onChange={(e) => setMustNotContain(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Critério para juiz IA (opcional)</Label>
            <Textarea rows={3} value={judgeCriteria} onChange={(e) => setJudgeCriteria(e.target.value)}
              placeholder="ex: A resposta deve responder à pergunta sobre cupom orientando a área de membros, sem prometer descontos." />
            <p className="text-xs text-muted-foreground">Se preenchido, um modelo extra avalia se a resposta atende ao critério (só roda se as checagens determinísticas passarem).</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
