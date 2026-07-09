import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Gauge, Pause, Play, RotateCcw, Loader2, Settings2, Trash2, ExternalLink, AlertTriangle, CheckCircle2, Zap } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { PLATFORMS, type IntegrationPlatform } from "@/lib/integrations-platforms";
import { TIERS, type GlobalTier } from "@/lib/integrations-tiers";
import { getQueueHealth, updateGlobalLimits, clearAutoThrottle } from "@/lib/integrations-health.functions";
import { getGlobalLimitsSummary, realignAccountsToGlobal } from "@/lib/integrations-limits.functions";


export const Route = createFileRoute("/admin/filas")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  component: QueuesPage,
});

interface AccountRow {
  id: string;
  name: string;
  platform: IntegrationPlatform;
  queue_paused: boolean;
  rate_limit_per_minute: number;
  rate_limit_burst: number;
  last_drain_at: string | null;
  status: string;
}

type StatusCounts = { pending: number; processing: number; done: number; failed: number; skipped: number };
const EMPTY_COUNTS: StatusCounts = { pending: 0, processing: 0, done: 0, failed: 0, skipped: 0 };

function QueuesPage() {
  const { me } = useMe();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limitsOpen, setLimitsOpen] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const fetchSummary = useServerFn(getGlobalLimitsSummary);


  const summaryQ = useQuery({
    queryKey: ["queues-global-summary"],
    queryFn: () => fetchSummary(),
    refetchInterval: 10_000,
  });
  const globalRpm = summaryQ.data?.rpm ?? 3000;
  const globalBurst = summaryQ.data?.burst ?? 500;

  const accountsQ = useQuery({
    queryKey: ["queues-accounts"],
    refetchInterval: 5000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integration_accounts" as any)
        .select("id, name, platform, queue_paused, rate_limit_per_minute, rate_limit_burst, last_drain_at, status")
        .order("name");
      if (error) throw error;
      return (data ?? []) as unknown as AccountRow[];
    },
  });

  const queueQ = useQuery({
    queryKey: ["queues-aggregate"],
    refetchInterval: 5000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integration_event_queue" as any)
        .select("account_id, status")
        .limit(20000);
      if (error) throw error;
      const byAccount = new Map<string, StatusCounts>();
      for (const r of (data ?? []) as any[]) {
        const acc = r.account_id as string;
        const cur = byAccount.get(acc) ?? { ...EMPTY_COUNTS };
        if (r.status in cur) (cur as any)[r.status] += 1;
        byAccount.set(acc, cur);
      }
      return byAccount;
    },
  });

  const accounts = accountsQ.data ?? [];
  const counts = queueQ.data ?? new Map<string, StatusCounts>();

  const totals = useMemo<StatusCounts>(() => {
    const t = { ...EMPTY_COUNTS };
    for (const c of counts.values()) {
      t.pending += c.pending;
      t.processing += c.processing;
      t.done += c.done;
      t.failed += c.failed;
      t.skipped += c.skipped;
    }
    return t;
  }, [counts]);

  const pausedCount = accounts.filter((a) => a.queue_paused).length;
  const activeCount = accounts.length - pausedCount;
  const lastDrain = accounts
    .map((a) => a.last_drain_at)
    .filter(Boolean)
    .sort()
    .reverse()[0] as string | undefined;

  const sortedAccounts = useMemo(() => {
    return [...accounts].sort((a, b) => {
      const ca = counts.get(a.id) ?? EMPTY_COUNTS;
      const cb = counts.get(b.id) ?? EMPTY_COUNTS;
      if (cb.failed !== ca.failed) return cb.failed - ca.failed;
      if (cb.pending !== ca.pending) return cb.pending - ca.pending;
      return a.name.localeCompare(b.name);
    });
  }, [accounts, counts]);

  const allSelected = sortedAccounts.length > 0 && selected.size === sortedAccounts.length;
  const toggleAll = (v: boolean) => {
    setSelected(v ? new Set(sortedAccounts.map((a) => a.id)) : new Set());
  };
  const toggleOne = (id: string, v: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (v) next.add(id); else next.delete(id);
      return next;
    });
  };

  const refetch = () => {
    qc.invalidateQueries({ queryKey: ["queues-accounts"] });
    qc.invalidateQueries({ queryKey: ["queues-aggregate"] });
    qc.invalidateQueries({ queryKey: ["queues-global-summary"] });
  };

  const setPause = async (ids: string[], paused: boolean) => {
    if (ids.length === 0) return;
    const { error } = await supabase.from("integration_accounts" as any)
      .update({ queue_paused: paused }).in("id", ids);
    if (error) return toast.error(error.message);
    toast.success(paused ? `${ids.length} fila(s) pausada(s)` : `${ids.length} fila(s) retomada(s)`);
    refetch();
  };

  const pauseAll = () => setPause(accounts.map((a) => a.id), true);
  const resumeAll = () => setPause(accounts.map((a) => a.id), false);

  const reprocessFailed = async (accountIds?: string[]) => {
    const scope = accountIds && accountIds.length > 0 ? accountIds : accounts.map((a) => a.id);
    const msg = accountIds ? "Reenfileirar falhas desta conta?" : "Reenfileirar TODAS as falhas de TODAS as contas?";
    if (!confirm(msg)) return;
    const { error } = await supabase.from("integration_event_queue" as any)
      .update({ status: "pending", attempts: 0, last_error: null, next_attempt_at: new Date().toISOString() })
      .in("account_id", scope)
      .eq("status", "failed");
    if (error) return toast.error(error.message);
    toast.success("Eventos reenfileirados");
    refetch();
  };

  if (!me?.isAdmin && !me?.isDeveloper) {
    return <div className="p-6 text-sm text-muted-foreground">Apenas administradores podem ver esta central.</div>;
  }

  return (
    <div className="page-container space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Gauge className="h-6 w-6" /> Filas & Limites
          </h1>
          <p className="text-sm text-muted-foreground">
            Cada webhook recebido entra numa fila por conta de integração e é processado em lotes pelo worker a cada 1 min.
          </p>
        </div>
      </div>

      <HealthBannerAndGlobalLimits
        accountsAboveCap={summaryQ.data?.accountsAboveCap ?? 0}
        onRealigned={refetch}
      />


      {/* Totais */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        {[
          ["Pendentes", totals.pending, "text-amber-600", "Eventos recebidos via webhook aguardando processamento."],
          ["Processando", totals.processing, "text-blue-600", "Eventos sendo executados pelo worker neste momento."],
          ["Concluídos", totals.done, "text-emerald-600", "Eventos processados com sucesso."],
          ["Falhas", totals.failed, "text-destructive", "Eventos que erraram e precisam ser reprocessados manualmente."],
          ["Ignorados", totals.skipped, "text-muted-foreground", "Eventos descartados por alguma regra (ex: contato não encontrado)."],
          [`Contas (${activeCount} ativas / ${pausedCount} pausadas)`, accounts.length, "text-foreground", "Total de contas de integração cadastradas."],
        ].map(([l, v, c, tip]: any) => (
          <Card key={l} className="p-3" title={tip}>
            <div className="text-[11px] text-muted-foreground">{l}</div>
            <div className={`text-xl font-semibold ${c}`}>{v}</div>
          </Card>
        ))}
      </div>

      {accounts.length > 0 && totals.pending + totals.processing + totals.failed + totals.done + totals.skipped === 0 && (
        <p className="text-xs rounded-md border border-dashed p-2 text-muted-foreground bg-muted/30">
          Nenhum evento na fila no momento. Os números só aparecem quando webhooks são recebidos das integrações.
        </p>
      )}

      <p className="text-[11px] text-muted-foreground">
        Última execução global: {lastDrain ? new Date(lastDrain).toLocaleString("pt-BR") : "—"} · O processador roda a cada 1 minuto e consome até <strong>rpm</strong> eventos por conta.
      </p>

      {/* Ações em massa */}
      <Card className="p-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground mr-2">
          {selected.size > 0 ? `${selected.size} selecionada(s)` : "Ações globais:"}
        </span>
        <Button size="sm" variant="outline" onClick={pauseAll} disabled={accounts.length === 0}>
          <Pause className="h-3 w-3 mr-1" /> Pausar todas
        </Button>
        <Button size="sm" variant="outline" onClick={resumeAll} disabled={accounts.length === 0}>
          <Play className="h-3 w-3 mr-1" /> Retomar todas
        </Button>
        <Button size="sm" variant="outline" onClick={() => reprocessFailed()} disabled={totals.failed === 0}>
          <RotateCcw className="h-3 w-3 mr-1" /> Reprocessar todas as falhas ({totals.failed})
        </Button>
        <Button size="sm" variant="outline" onClick={() => setLimitsOpen(true)} disabled={selected.size === 0}>
          <Settings2 className="h-3 w-3 mr-1" /> Editar limites em massa
        </Button>
        <Button size="sm" variant="outline" onClick={() => setCleanupOpen(true)}>
          <Trash2 className="h-3 w-3 mr-1" /> Limpar concluídos antigos
        </Button>
      </Card>

      {/* Tabela */}
      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <Checkbox checked={allSelected} onCheckedChange={(v) => toggleAll(!!v)} />
              </TableHead>
              <TableHead>Conta</TableHead>
              <TableHead title="Ativa = consumindo eventos. Pausada = nada é processado.">Status</TableHead>
              <TableHead className="text-right" title="Eventos na fila aguardando processamento.">Pendentes</TableHead>
              <TableHead className="text-right" title="Eventos sendo executados agora pelo worker.">Processando</TableHead>
              <TableHead className="text-right" title="Eventos que erraram e precisam ser reprocessados.">Falhas</TableHead>
              <TableHead className="text-right" title="msg/min = throughput sustentado por minuto. Rajada = pico curto permitido em segundos.">Limite (msg/min · rajada)</TableHead>
              <TableHead title="Última vez que o worker processou eventos desta conta (cron a cada 1 min). '—' = nunca rodou ainda.">Última execução</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accountsQ.isLoading && (
              <TableRow><TableCell colSpan={9} className="text-center py-6 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin inline mr-1" /> Carregando…
              </TableCell></TableRow>
            )}
            {!accountsQ.isLoading && sortedAccounts.length === 0 && (
              <TableRow><TableCell colSpan={9} className="text-center py-6 text-xs text-muted-foreground">
                Nenhuma conta de integração cadastrada.
              </TableCell></TableRow>
            )}
            {sortedAccounts.map((a) => {
              const c = counts.get(a.id) ?? EMPTY_COUNTS;
              const platformLabel = PLATFORMS[a.platform]?.label ?? a.platform;
              return (
                <TableRow key={a.id} className={c.failed > 0 ? "bg-destructive/5" : ""}>
                  <TableCell>
                    <Checkbox checked={selected.has(a.id)} onCheckedChange={(v) => toggleOne(a.id, !!v)} />
                  </TableCell>
                  <TableCell>
                    <div className="text-sm font-medium">{a.name}</div>
                    <div className="text-[11px] text-muted-foreground">{platformLabel}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch checked={!a.queue_paused} onCheckedChange={(v) => setPause([a.id], !v)} />
                      <Badge variant={a.queue_paused ? "destructive" : "default"} className="text-[10px]">
                        {a.queue_paused ? "Pausada" : "Ativa"}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-amber-600 font-medium">{c.pending}</TableCell>
                  <TableCell className="text-right text-blue-600 font-medium">{c.processing}</TableCell>
                  <TableCell className="text-right text-destructive font-medium">{c.failed}</TableCell>
                  <TableCell className="text-right text-xs">
                    <div className="flex items-center justify-end gap-1">
                      <span>{a.rate_limit_per_minute} / {a.rate_limit_burst}</span>
                      {(a.rate_limit_per_minute > globalRpm || a.rate_limit_burst > globalBurst) && (
                        <Badge variant="destructive" className="text-[9px] px-1 py-0" title={`Acima do teto global (${globalRpm}/${globalBurst})`}>
                          acima do teto
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {a.last_drain_at ? new Date(a.last_drain_at).toLocaleString("pt-BR") : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" disabled={c.failed === 0}
                        onClick={() => reprocessFailed([a.id])} title="Reprocessar falhas">
                        <RotateCcw className="h-3 w-3" />
                      </Button>
                      <Button size="sm" variant="ghost" asChild title="Abrir detalhes">
                        <Link to="/admin/integracoes"><ExternalLink className="h-3 w-3" /></Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <BulkLimitsDialog
        open={limitsOpen}
        onOpenChange={setLimitsOpen}
        accountIds={Array.from(selected)}
        globalRpm={globalRpm}
        globalBurst={globalBurst}
        onDone={() => { setSelected(new Set()); refetch(); }}
      />
      <CleanupDialog
        open={cleanupOpen}
        onOpenChange={setCleanupOpen}
        onDone={refetch}
      />
    </div>
  );
}

function BulkLimitsDialog({
  open, onOpenChange, accountIds, globalRpm, globalBurst, onDone,
}: { open: boolean; onOpenChange: (v: boolean) => void; accountIds: string[]; globalRpm: number; globalBurst: number; onDone: () => void }) {
  const [rpm, setRpm] = useState<number>(60);
  const [burst, setBurst] = useState<number>(10);
  const [busy, setBusy] = useState(false);

  const overCap = rpm > globalRpm || burst > globalBurst;

  const submit = async () => {
    if (overCap) {
      toast.error(`Valores excedem o teto da faixa global (${globalRpm}/${globalBurst}).`);
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("integration_accounts" as any)
      .update({ rate_limit_per_minute: rpm, rate_limit_burst: burst })
      .in("id", accountIds);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Limites aplicados a ${accountIds.length} conta(s)`);
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar limites em massa</DialogTitle>
          <DialogDescription>
            Aplica os limites abaixo às {accountIds.length} conta(s) selecionada(s).
            Máximo permitido pela faixa global atual: <strong>{globalRpm}/min · burst {globalBurst}</strong>.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Eventos por minuto</Label>
            <Input type="number" min={1} max={globalRpm} value={rpm}
              onChange={(e) => setRpm(Math.min(globalRpm, Math.max(1, Number(e.target.value) || 0)))} />
            <p className="text-[11px] text-muted-foreground mt-1">Throughput sustentado. Máx. {globalRpm}.</p>
          </div>
          <div>
            <Label className="text-xs">Burst (rajada)</Label>
            <Input type="number" min={1} max={globalBurst} value={burst}
              onChange={(e) => setBurst(Math.min(globalBurst, Math.max(1, Number(e.target.value) || 0)))} />
            <p className="text-[11px] text-muted-foreground mt-1">Picos curtos. Máx. {globalBurst}.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={submit} disabled={busy || accountIds.length === 0 || overCap}>
            {busy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />} Aplicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CleanupDialog({
  open, onOpenChange, onDone,
}: { open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const [days, setDays] = useState<number>(7);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
    const { error, count } = await supabase.from("integration_event_queue" as any)
      .delete({ count: "exact" })
      .eq("status", "done")
      .lt("finished_at", cutoff);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`${count ?? 0} registro(s) removido(s)`);
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Limpar concluídos antigos</DialogTitle>
          <DialogDescription>
            Apaga registros da fila com status "done" finalizados há mais de X dias. Não afeta pendentes nem falhas.
          </DialogDescription>
        </DialogHeader>
        <div>
          <Label className="text-xs">Dias</Label>
          <Input type="number" min={1} value={days} onChange={(e) => setDays(Number(e.target.value))} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button variant="destructive" onClick={submit} disabled={busy}>
            {busy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />} Limpar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HealthBannerAndGlobalLimits({ accountsAboveCap, onRealigned }: { accountsAboveCap: number; onRealigned: () => void }) {
  const fetchHealth = useServerFn(getQueueHealth);
  const saveLimits = useServerFn(updateGlobalLimits);
  const clearThrottle = useServerFn(clearAutoThrottle);
  const realign = useServerFn(realignAccountsToGlobal);
  const qc = useQueryClient();
  const [realigning, setRealigning] = useState(false);

  const onRealign = async () => {
    if (!confirm(`Realinhar ${accountsAboveCap} conta(s) ao teto da faixa global atual?`)) return;
    setRealigning(true);
    try {
      const r = await realign();
      toast.success(`${r.updated} conta(s) realinhada(s) ao teto`);
      onRealigned();
    } catch (e) {
      toast.error((e as Error).message ?? "Falha ao realinhar");
    } finally {
      setRealigning(false);
    }
  };

  const healthQ = useQuery({
    queryKey: ["queue-health"],
    queryFn: () => fetchHealth(),
    refetchInterval: 10_000,
  });

  const cfg = healthQ.data?.config;
  const [tier, setTier] = useState<GlobalTier>("equilibrado");
  const [rpm, setRpm] = useState(300);
  const [burst, setBurst] = useState(60);
  const [busy, setBusy] = useState(false);

  // Sincroniza estado local quando a config carrega/muda
  useEffect(() => {
    if (!cfg) return;
    setTier(cfg.tier as GlobalTier);
    setRpm(cfg.rpm);
    setBurst(cfg.burst);
  }, [cfg?.tier, cfg?.rpm, cfg?.burst]);

  const dirty = !!cfg && (tier !== cfg.tier || rpm !== cfg.rpm || burst !== cfg.burst);

  const selectTier = (t: GlobalTier) => {
    setTier(t);
    if (t !== "custom") {
      const preset = TIERS.find((x) => x.id === t)!;
      setRpm(preset.rpm);
      setBurst(preset.burst);
    }
  };

  const onSave = async () => {
    setBusy(true);
    try {
      await saveLimits({
        data: {
          tier,
          rpm,
          burst,
          minShare: cfg?.minShare ?? 10,
          distributionMode: cfg?.distributionMode ?? "equal",
        },
      });
      toast.success("Limite global atualizado");
      qc.invalidateQueries({ queryKey: ["queue-health"] });
    } catch (e) {
      toast.error((e as Error).message ?? "Falha ao salvar");
    } finally {
      setBusy(false);
    }
  };

  const onRevertThrottle = async () => {
    try {
      await clearThrottle();
      toast.success("Auto-throttle revertido");
      qc.invalidateQueries({ queryKey: ["queue-health"] });
    } catch (e) {
      toast.error((e as Error).message ?? "Falha");
    }
  };

  const level = healthQ.data?.level ?? "ok";
  const reasons = healthQ.data?.reasons ?? [];
  const auto = healthQ.data?.autoThrottle;

  return (
    <div className="space-y-3">
      {/* Banner de saúde */}
      {level !== "ok" && (
        <Card
          className={
            level === "critical"
              ? "p-3 border-destructive/50 bg-destructive/10"
              : "p-3 border-amber-500/50 bg-amber-500/10"
          }
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className={level === "critical" ? "h-5 w-5 text-destructive shrink-0" : "h-5 w-5 text-amber-600 shrink-0"} />
            <div className="flex-1 text-sm">
              <div className="font-semibold mb-1">
                {level === "critical"
                  ? "A faixa atual está sobrecarregando o sistema"
                  : "A faixa atual está pressionando o sistema"}
              </div>
              <ul className="list-disc list-inside text-xs space-y-0.5 text-foreground/80">
                {reasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
              {auto && (
                <div className="text-xs mt-2">
                  Processamento reduzido automaticamente para <strong>{auto.tier}</strong> até{" "}
                  {new Date(auto.until).toLocaleTimeString("pt-BR")}.
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1">
              {auto ? (
                <Button size="sm" variant="outline" onClick={onRevertThrottle}>Reverter</Button>
              ) : level === "critical" && tier !== "conservador" ? (
                <Button size="sm" variant="outline" onClick={() => { selectTier("equilibrado"); }}>
                  Reduzir faixa
                </Button>
              ) : null}
            </div>
          </div>
        </Card>
      )}
      {level === "ok" && healthQ.data && (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3 text-emerald-600" />
          Sistema saudável · {healthQ.data.processedLastMin}/min processados, {healthQ.data.pending} pendente(s).
        </p>
      )}

      {/* Card de limite global com faixas */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Limite global de processamento</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Define quantos eventos por minuto o sistema processa no total — esse orçamento é dividido
          dinamicamente entre as integrações com fila pendente.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {TIERS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => selectTier(t.id)}
              className={`text-left rounded-md border p-3 transition-colors ${
                tier === t.id ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted/50"
              }`}
            >
              <div className="text-xs font-semibold">{t.label}</div>
              <div className="text-[11px] text-muted-foreground">{t.rpm}/min · burst {t.burst}</div>
              <div className="text-[10px] text-muted-foreground mt-1 leading-tight">{t.description}</div>
            </button>
          ))}
          <button
            type="button"
            onClick={() => selectTier("custom")}
            className={`text-left rounded-md border p-3 transition-colors ${
              tier === "custom" ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted/50"
            }`}
          >
            <div className="text-xs font-semibold">Personalizado</div>
            <div className="text-[11px] text-muted-foreground">até 20000 / 5000</div>
            <div className="text-[10px] text-muted-foreground mt-1 leading-tight">
              Avançado. Acima de 5000/min observe a carga da instância e das APIs externas.
            </div>
          </button>
        </div>

        {tier === "custom" && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Eventos por minuto (30–20000)</Label>
              <Input type="number" min={30} max={20000} value={rpm} onChange={(e) => setRpm(Number(e.target.value))} />
            </div>
            <div>
              <Label className="text-xs">Burst (10–5000)</Label>
              <Input type="number" min={10} max={5000} value={burst} onChange={(e) => setBurst(Number(e.target.value))} />
            </div>
          </div>
        )}


        {accountsAboveCap > 0 && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs flex items-center justify-between gap-2">
            <span>
              <strong>{accountsAboveCap}</strong> conta(s) com limite acima do teto da faixa global atual.
              Novos limites por conta já são bloqueados; estes valores antigos só mudam manualmente.
            </span>
            <Button size="sm" variant="outline" disabled={realigning} onClick={onRealign}>
              {realigning && <Loader2 className="h-3 w-3 mr-1 animate-spin" />} Realinhar contas ao teto
            </Button>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button size="sm" disabled={!dirty || busy} onClick={onSave}>
            {busy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />} Salvar limite global
          </Button>
        </div>
      </Card>
    </div>
  );
}

