import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Play, CheckCircle2, XCircle, AlertTriangle, ArrowRightLeft, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { listAgentVersions } from "@/lib/ai-agent-versions.functions";
import { listTestScenarios, runScenariosAB } from "@/lib/ai-agent-tests.functions";

type RunStatus = "pass" | "fail" | "error" | "escalated";
type RunResult = {
  status: RunStatus;
  reply: string;
  failures: string[];
  judge_verdict: { passed: boolean; reason: string } | null;
  tool_call: { name: string; reason: string | null; message_to_patient: string | null; escalation_track: string | null } | null;
  tokens_in: number | null;
  tokens_out: number | null;
  duration_ms: number;
  model: string;
};
type AbResult = { scenarioId: string; name: string; a: RunResult; b: RunResult };
type AbSummary = {
  total: number;
  aPass: number;
  bPass: number;
  aFail: number;
  bFail: number;
  agreement: number;
  avgLatencyA: number;
  avgLatencyB: number;
  avgTokensA: number;
  avgTokensB: number;
};

function StatusBadge({ status }: { status: RunStatus }) {
  if (status === "pass")
    return <Badge className="bg-green-600 hover:bg-green-600 gap-1"><CheckCircle2 className="h-3 w-3" /> pass</Badge>;
  if (status === "escalated")
    return <Badge className="bg-amber-500 hover:bg-amber-500 gap-1"><ArrowRightLeft className="h-3 w-3" /> escalou</Badge>;
  if (status === "fail")
    return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> fail</Badge>;
  return <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" /> erro</Badge>;
}

function SidePanel({ side, r }: { side: "A" | "B"; r: RunResult }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-xs">Versão {side}</span>
        <StatusBadge status={r.status} />
        <span className="text-[11px] text-muted-foreground">
          {r.duration_ms}ms · {(r.tokens_in ?? 0) + (r.tokens_out ?? 0)} tk
        </span>
      </div>
      <div className="text-sm whitespace-pre-wrap rounded border p-2 bg-muted/30 max-h-64 overflow-y-auto">
        {r.reply || <span className="text-muted-foreground italic">(vazio)</span>}
      </div>
      {r.failures && r.failures.length > 0 && (
        <ul className="text-xs space-y-0.5 list-disc list-inside text-destructive">
          {r.failures.map((f, i) => <li key={i}>{f}</li>)}
        </ul>
      )}
      {r.judge_verdict && (
        <div className="text-xs">
          <span className="text-muted-foreground">Juiz IA: </span>
          {r.judge_verdict.passed ? "✓" : "✗"} {r.judge_verdict.reason}
        </div>
      )}
    </div>
  );
}

export function AbScenariosBlock({ agentId }: { agentId: string }) {
  const listVersionsFn = useServerFn(listAgentVersions);
  const listScenariosFn = useServerFn(listTestScenarios);
  const runAbFn = useServerFn(runScenariosAB);

  const [collapsed, setCollapsed] = useState(false);
  const [versionAId, setVersionAId] = useState<string>("");
  const [versionBId, setVersionBId] = useState<string>("");
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<AbResult[] | null>(null);
  const [summary, setSummary] = useState<AbSummary | null>(null);
  const [detail, setDetail] = useState<AbResult | null>(null);

  const { data: versionsData } = useQuery({
    queryKey: ["agent-versions", agentId],
    queryFn: () => listVersionsFn({ data: { agentId } }),
  });
  const versions = (versionsData?.versions ?? []) as Array<{
    id: string;
    version_number: number;
    label: string | null;
  }>;

  const { data: scenariosData } = useQuery({
    queryKey: ["ai-agent-test-scenarios", agentId],
    queryFn: () => listScenariosFn({ data: { agentId } }),
  });
  const scenarios = (scenariosData?.scenarios ?? []) as Array<{ id: string; name: string }>;

  const selectedSet = useMemo(() => {
    if (selected) return selected;
    return new Set(scenarios.map((s) => s.id));
  }, [selected, scenarios]);

  const toggle = (id: string) => {
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const selectAll = () => setSelected(new Set(scenarios.map((s) => s.id)));
  const clearAll = () => setSelected(new Set());

  const handleRun = async () => {
    if (!versionAId || !versionBId) {
      toast.error("Selecione as duas versões");
      return;
    }
    if (versionAId === versionBId) {
      toast.error("As versões devem ser diferentes");
      return;
    }
    if (selectedSet.size === 0) {
      toast.error("Selecione ao menos um cenário");
      return;
    }
    setRunning(true);
    setResults(null);
    setSummary(null);
    try {
      const r = await runAbFn({
        data: {
          agentId,
          versionAId,
          versionBId,
          scenarioIds: Array.from(selectedSet),
        },
      });
      setResults(r.results as AbResult[]);
      setSummary(r.summary as AbSummary);
      toast.success(`Comparação concluída: ${r.results.length} cenário(s)`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const labelFor = (v: { version_number: number; label: string | null }) =>
    v.label ? `v${v.version_number} • ${v.label}` : `v${v.version_number}`;

  return (
    <Card className="p-4 space-y-3 border-primary/40 bg-primary/5">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center gap-2 w-full text-left"
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        <ArrowRightLeft className="h-4 w-4 text-primary" />
        <h3 className="font-semibold">Comparar versões (A/B)</h3>
        <Badge variant="outline" className="text-[10px]">Novo</Badge>
        <span className="text-xs text-muted-foreground hidden sm:inline">
          Roda os cenários selecionados contra duas versões e compara lado a lado
        </span>
      </button>

      {!collapsed && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <div>
              <label className="text-xs text-muted-foreground">Versão A</label>
              <Select value={versionAId} onValueChange={setVersionAId}>
                <SelectTrigger><SelectValue placeholder="Selecionar versão A" /></SelectTrigger>
                <SelectContent>
                  {versions.map((v) => (
                    <SelectItem key={v.id} value={v.id}>{labelFor(v)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Versão B</label>
              <Select value={versionBId} onValueChange={setVersionBId}>
                <SelectTrigger><SelectValue placeholder="Selecionar versão B" /></SelectTrigger>
                <SelectContent>
                  {versions.map((v) => (
                    <SelectItem key={v.id} value={v.id}>{labelFor(v)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={handleRun}
              disabled={running || !versionAId || !versionBId || selectedSet.size === 0}
            >
              {running ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
              Executar comparação
            </Button>
          </div>

          {scenarios.length > 0 && (
            <div className="rounded border bg-background">
              <div className="flex items-center justify-between px-3 py-2 border-b">
                <span className="text-xs text-muted-foreground">
                  {selectedSet.size} de {scenarios.length} cenário(s) selecionado(s)
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={selectAll} className="h-7 text-xs">
                    Selecionar todos
                  </Button>
                  <Button size="sm" variant="ghost" onClick={clearAll} className="h-7 text-xs">
                    Limpar
                  </Button>
                </div>
              </div>
              <div className="max-h-40 overflow-y-auto px-3 py-2 space-y-1">
                {scenarios.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer py-0.5">
                    <Checkbox
                      checked={selectedSet.has(s.id)}
                      onCheckedChange={() => toggle(s.id)}
                    />
                    <span className="truncate">{s.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
              <Card className="p-2">
                <div className="text-xs text-muted-foreground">Aprovação A</div>
                <div className="font-semibold">{summary.aPass}/{summary.total}</div>
              </Card>
              <Card className="p-2">
                <div className="text-xs text-muted-foreground">Aprovação B</div>
                <div className="font-semibold">{summary.bPass}/{summary.total}</div>
              </Card>
              <Card className="p-2">
                <div className="text-xs text-muted-foreground">Concordância</div>
                <div className="font-semibold">{summary.agreement}/{summary.total}</div>
              </Card>
              <Card className="p-2">
                <div className="text-xs text-muted-foreground">Latência média</div>
                <div className="font-semibold">{summary.avgLatencyA}ms · {summary.avgLatencyB}ms</div>
              </Card>
              <Card className="p-2">
                <div className="text-xs text-muted-foreground">Tokens médios</div>
                <div className="font-semibold">{summary.avgTokensA} · {summary.avgTokensB}</div>
              </Card>
            </div>
          )}

          {results && results.length > 0 && (
            <div className="space-y-3">
              {results.map((r) => {
                const same = r.a.status === r.b.status;
                return (
                  <Card key={r.scenarioId} className="p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium truncate" title={r.name}>{r.name}</span>
                        {same ? (
                          <Badge variant="outline" className="text-[10px]">=</Badge>
                        ) : (
                          <Badge className="text-[10px]">≠</Badge>
                        )}
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => setDetail(r)} className="h-7 text-xs">
                        Ver tool call
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <SidePanel side="A" r={r.a} />
                      <SidePanel side="B" r={r.b} />
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {results && results.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum cenário disponível para comparação.</p>
          )}
        </>
      )}

      {detail && (
        <Dialog open onOpenChange={(o) => !o && setDetail(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{detail.name}</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(["a", "b"] as const).map((side) => {
                const r = side === "a" ? detail.a : detail.b;
                return (
                  <div key={side} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">Versão {side.toUpperCase()}</span>
                      <StatusBadge status={r.status} />
                      <span className="text-xs text-muted-foreground">{r.duration_ms}ms · {(r.tokens_in ?? 0) + (r.tokens_out ?? 0)} tk</span>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Resposta</div>
                      <div className="text-sm whitespace-pre-wrap rounded border p-2 bg-muted/30">
                        {r.reply || <span className="text-muted-foreground italic">(vazio)</span>}
                      </div>
                    </div>
                    {r.tool_call && (
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">Tool call</div>
                        <pre className="text-xs rounded border p-2 bg-muted/30 overflow-x-auto">
                          {JSON.stringify(r.tool_call, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}
