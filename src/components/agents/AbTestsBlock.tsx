import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Loader2, Play, Square, Trash2, FlaskConical, Trophy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  listAgentAbTests,
  createAbTest,
  startAbTest,
  stopAbTest,
  deleteAbTest,
  getAbTestResults,
} from "@/lib/ai-agent-ab-tests.functions";

type Version = { id: string; version_number: number; label: string | null };

type AbTest = {
  id: string;
  name: string;
  description: string | null;
  status: "draft" | "running" | "stopped" | "completed";
  traffic_b_percent: number;
  version_a_id: string;
  version_b_id: string;
  starts_at: string | null;
  ends_at: string | null;
  winner: "a" | "b" | "tie" | null;
  created_at: string;
  version_a: { version_number: number; label: string | null } | null;
  version_b: { version_number: number; label: string | null } | null;
};

function StatRow({ label, a, b, suffix }: { label: string; a: string | number; b: string | number; suffix?: string }) {
  return (
    <div className="grid grid-cols-3 gap-2 text-xs py-1 border-b last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-mono">{a}{suffix}</span>
      <span className="text-right font-mono">{b}{suffix}</span>
    </div>
  );
}

function ResultsBlock({ testId }: { testId: string }) {
  const fn = useServerFn(getAbTestResults);
  const { data, isLoading } = useQuery({
    queryKey: ["ai-agent-ab-results", testId],
    queryFn: () => fn({ data: { id: testId } }),
    refetchInterval: 15000,
  });
  if (isLoading) return <div className="text-xs text-muted-foreground py-2">Carregando métricas…</div>;
  if (!data) return null;
  const a = data.a;
  const b = data.b;
  const successRate = (s: typeof a) => s.runs ? Math.round((s.success / s.runs) * 100) : 0;
  const escRate = (s: typeof a) => s.runs ? Math.round((s.escalated / s.runs) * 100) : 0;
  return (
    <div className="mt-3 border rounded-md p-3 bg-muted/30">
      <div className="grid grid-cols-3 gap-2 text-xs font-semibold pb-1 border-b">
        <span></span>
        <span className="text-right">Variante A</span>
        <span className="text-right">Variante B</span>
      </div>
      <StatRow label="Runs" a={a.runs} b={b.runs} />
      <StatRow label="Conversas" a={a.conversations} b={b.conversations} />
      <StatRow label="Sucesso" a={successRate(a)} b={successRate(b)} suffix="%" />
      <StatRow label="Escalonadas" a={escRate(a)} b={escRate(b)} suffix="%" />
      <StatRow label="Erros" a={a.error} b={b.error} />
      <StatRow label="Rate-limited" a={a.rate_limited} b={b.rate_limited} />
      <StatRow label="Tokens in" a={a.tokens_in} b={b.tokens_in} />
      <StatRow label="Tokens out" a={a.tokens_out} b={b.tokens_out} />
      <StatRow label="Latência média" a={a.avg_latency_ms} b={b.avg_latency_ms} suffix="ms" />
    </div>
  );
}

const STATUS_LABEL: Record<AbTest["status"], string> = {
  draft: "Rascunho",
  running: "Rodando",
  stopped: "Parado",
  completed: "Concluído",
};

const STATUS_VARIANT: Record<AbTest["status"], "default" | "secondary" | "outline"> = {
  draft: "outline",
  running: "default",
  stopped: "secondary",
  completed: "secondary",
};

export function AbTestsBlock({ agentId, versions }: { agentId: string; versions: Version[] }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listAgentAbTests);
  const createFn = useServerFn(createAbTest);
  const startFn = useServerFn(startAbTest);
  const stopFn = useServerFn(stopAbTest);
  const deleteFn = useServerFn(deleteAbTest);

  const { data, isLoading } = useQuery({
    queryKey: ["ai-agent-ab-tests", agentId],
    queryFn: () => listFn({ data: { agentId } }),
  });

  const tests = (data?.tests ?? []) as AbTest[];
  const running = tests.find((t) => t.status === "running") ?? null;
  const others = tests.filter((t) => t.status !== "running");

  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [versionA, setVersionA] = useState<string>("");
  const [versionB, setVersionB] = useState<string>("");
  const [trafficB, setTrafficB] = useState(50);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["ai-agent-ab-tests", agentId] });
    qc.invalidateQueries({ queryKey: ["ai-agent-ab-results"] });
  };

  const resetForm = () => {
    setName("");
    setDescription("");
    setVersionA(versions[0]?.id ?? "");
    setVersionB(versions[1]?.id ?? "");
    setTrafficB(50);
  };

  const openCreate = () => {
    resetForm();
    setCreateOpen(true);
  };

  const submit = async (startNow: boolean) => {
    if (!name.trim() || !versionA || !versionB || versionA === versionB) {
      toast.error("Preencha nome e duas versões diferentes");
      return;
    }
    setBusy(true);
    try {
      await createFn({
        data: {
          agentId,
          name: name.trim(),
          versionAId: versionA,
          versionBId: versionB,
          trafficBPercent: trafficB,
          description: description.trim() || undefined,
          startNow,
        },
      });
      toast.success(startNow ? "Teste A/B iniciado" : "Teste salvo como rascunho");
      setCreateOpen(false);
      refresh();
    } catch (e) {
      toast.error((e as Error)?.message ?? "Erro ao criar teste");
    } finally {
      setBusy(false);
    }
  };

  const start = async (id: string) => {
    setBusy(true);
    try {
      await startFn({ data: { id } });
      toast.success("Teste iniciado");
      refresh();
    } catch (e) {
      toast.error((e as Error)?.message ?? "Erro");
    } finally {
      setBusy(false);
    }
  };

  const stop = async (id: string, winner?: "a" | "b") => {
    setBusy(true);
    try {
      await stopFn({ data: { id, winner: winner ?? null } });
      toast.success(winner ? `Marcado vencedor: ${winner.toUpperCase()}` : "Teste parado");
      refresh();
    } catch (e) {
      toast.error((e as Error)?.message ?? "Erro");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir este teste A/B?")) return;
    setBusy(true);
    try {
      await deleteFn({ data: { id } });
      toast.success("Teste excluído");
      refresh();
    } catch (e) {
      toast.error((e as Error)?.message ?? "Erro");
    } finally {
      setBusy(false);
    }
  };

  const versionLabel = (v: { version_number: number; label: string | null } | null) =>
    v ? `v${v.version_number}${v.label ? ` — ${v.label}` : ""}` : "—";

  const canCreate = useMemo(() => versions.length >= 2, [versions.length]);

  if (isLoading) return null;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <FlaskConical className="h-4 w-4" /> Teste A/B entre versões
          </h3>
          <p className="text-xs text-muted-foreground">
            Divida conversas entre duas versões e compare resultados em tempo real.
          </p>
        </div>
        <Button size="sm" onClick={openCreate} disabled={!canCreate}>
          Novo teste A/B
        </Button>
      </div>

      {!canCreate && (
        <p className="text-xs text-muted-foreground italic">
          Você precisa ter pelo menos 2 versões salvas para criar um teste.
        </p>
      )}

      {running && (
        <div className="border rounded-md p-3 bg-primary/5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold">{running.name}</span>
                <Badge>{STATUS_LABEL[running.status]}</Badge>
                <span className="text-xs text-muted-foreground">
                  iniciado {running.starts_at && formatDistanceToNow(new Date(running.starts_at), { locale: ptBR, addSuffix: true })}
                </span>
              </div>
              <div className="text-xs mt-1 text-muted-foreground">
                A: <code>{versionLabel(running.version_a)}</code> {" • "}
                B: <code>{versionLabel(running.version_b)}</code> {" • "}
                {running.traffic_b_percent}% para B
              </div>
              {running.description && <p className="text-xs italic mt-1">{running.description}</p>}
            </div>
            <div className="flex flex-col gap-1 shrink-0">
              <Button size="sm" variant="outline" onClick={() => stop(running.id, "a")} disabled={busy}>
                <Trophy className="h-3.5 w-3.5 mr-1" /> A vence
              </Button>
              <Button size="sm" variant="outline" onClick={() => stop(running.id, "b")} disabled={busy}>
                <Trophy className="h-3.5 w-3.5 mr-1" /> B vence
              </Button>
              <Button size="sm" variant="ghost" onClick={() => stop(running.id)} disabled={busy}>
                <Square className="h-3.5 w-3.5 mr-1" /> Parar
              </Button>
            </div>
          </div>
          <ResultsBlock testId={running.id} />
        </div>
      )}

      {others.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Histórico</p>
          {others.map((t) => (
            <div key={t.id} className="border rounded-md p-2 text-xs">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{t.name}</span>
                  <Badge variant={STATUS_VARIANT[t.status]}>{STATUS_LABEL[t.status]}</Badge>
                  {t.winner && (
                    <Badge variant="outline">
                      <Trophy className="h-3 w-3 mr-1" />
                      Vencedor: {t.winner.toUpperCase()}
                    </Badge>
                  )}
                  <span className="text-muted-foreground">
                    A: {versionLabel(t.version_a)} • B: {versionLabel(t.version_b)} • {t.traffic_b_percent}% B
                  </span>
                </div>
                <div className="flex gap-1">
                  {t.status === "draft" && (
                    <Button size="sm" variant="outline" onClick={() => start(t.id)} disabled={busy}>
                      <Play className="h-3 w-3 mr-1" /> Iniciar
                    </Button>
                  )}
                  {t.status === "stopped" && (
                    <Button size="sm" variant="outline" onClick={() => start(t.id)} disabled={busy}>
                      <Play className="h-3 w-3 mr-1" /> Retomar
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => remove(t.id)} disabled={busy}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              {(t.status === "stopped" || t.status === "completed") && <ResultsBlock testId={t.id} />}
            </div>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo teste A/B</DialogTitle>
            <DialogDescription>
              As conversas serão divididas entre A e B. A mesma conversa fica sempre na mesma variante.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Nome do teste</Label>
              <Input
                placeholder="ex: prompt mais empático vs atual"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Versão A</Label>
                <Select value={versionA} onValueChange={setVersionA}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {versions.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        v{v.version_number}{v.label ? ` — ${v.label}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Versão B</Label>
                <Select value={versionB} onValueChange={setVersionB}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {versions.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        v{v.version_number}{v.label ? ` — ${v.label}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Tráfego para variante B: {trafficB}%</Label>
              <Slider
                value={[trafficB]}
                onValueChange={(v) => setTrafficB(v[0] ?? 50)}
                min={0}
                max={100}
                step={5}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                A receberá {100 - trafficB}% das conversas.
              </p>
            </div>
            <div>
              <Label className="text-xs">Descrição (opcional)</Label>
              <Textarea
                placeholder="hipótese do teste..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={2000}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={busy}>Cancelar</Button>
            <Button variant="secondary" onClick={() => submit(false)} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar rascunho
            </Button>
            <Button onClick={() => submit(true)} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar e iniciar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
