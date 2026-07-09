import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Activity, AlertTriangle, DollarSign, Clock, CheckCircle2, ShoppingCart, CalendarIcon, X, MessageCircleReply, Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Tooltip as UiTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, Legend } from "recharts";

import {
  getAgentDashboard,
  listEscalationReviews,
  evaluateEscalationAlerts,
  listActiveAgentAlerts,
  resolveAgentAlert,
  getAgentSalesAttribution,
} from "@/lib/ai-agents-dashboard.functions";
import { toast } from "sonner";
import { format } from "date-fns";

interface Props {
  agentId: string;
}

type RangeKey = "7d" | "30d" | "90d" | "custom";

type RangeState = {
  key: RangeKey;
  from?: string; // ISO date yyyy-mm-dd, only when custom
  to?: string;
};

function rangeToDates(r: RangeState): { from: string; to: string } {
  if (r.key === "custom" && r.from && r.to) {
    const from = new Date(r.from + "T00:00:00");
    const to = new Date(r.to + "T23:59:59");
    return { from: from.toISOString(), to: to.toISOString() };
  }
  const to = new Date();
  const from = new Date();
  const days = r.key === "7d" ? 7 : r.key === "90d" ? 90 : 30;
  from.setDate(to.getDate() - days);
  return { from: from.toISOString(), to: to.toISOString() };
}

const fmtMs = (ms: number) => !ms ? "—" : ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60000).toFixed(1)}min`;
const fmtUsd = (v: number) => `$${v.toFixed(4)}`;
const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;
const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

export function DashboardTab({ agentId }: Props) {
  const storageKey = `agent-dashboard-range:${agentId}`;
  const [range, setRange] = useState<RangeState>(() => {
    if (typeof window === "undefined") return { key: "30d" };
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) return JSON.parse(raw) as RangeState;
    } catch { /* ignore */ }
    return { key: "30d" };
  });
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(range)); } catch { /* ignore */ }
  }, [range, storageKey]);

  const dates = useMemo(() => rangeToDates(range), [range]);
  const qc = useQueryClient();

  const dashFn = useServerFn(getAgentDashboard);
  const reviewsFn = useServerFn(listEscalationReviews);
  const evalAlertFn = useServerFn(evaluateEscalationAlerts);
  const listAlertsFn = useServerFn(listActiveAgentAlerts);
  const resolveAlertFn = useServerFn(resolveAgentAlert);
  const salesFn = useServerFn(getAgentSalesAttribution);

  const { data, isLoading } = useQuery({
    queryKey: ["agent-dashboard", agentId, range],
    queryFn: () => dashFn({ data: { agentId, from: dates.from, to: dates.to } }),
  });
  const { data: revData } = useQuery({
    queryKey: ["agent-reviews", agentId, range],
    queryFn: () => reviewsFn({ data: { agentId, from: dates.from, to: dates.to, limit: 100 } }),
  });
  const { data: salesData } = useQuery({
    queryKey: ["agent-sales", agentId, range],
    queryFn: () => salesFn({ data: { agentId, from: dates.from, to: dates.to } }),
  });
  const { data: alertsData, refetch: refetchAlerts } = useQuery({
    queryKey: ["agent-alerts", agentId],
    queryFn: () => listAlertsFn({ data: { agentId } }),
    refetchInterval: 60_000,
  });

  // Avalia alerta no carregamento e a cada minuto
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        await evalAlertFn({ data: { agentId } });
        if (!cancelled) qc.invalidateQueries({ queryKey: ["agent-alerts", agentId] });
      } catch { /* silencioso */ }
    };
    tick();
    const iv = setInterval(tick, 60_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [agentId, evalAlertFn, qc]);

  const onResolveAlert = async (alertId: string) => {
    try {
      await resolveAlertFn({ data: { alertId } });
      toast.success("Alerta resolvido");
      refetchAlerts();
    } catch (e) {
      toast.error((e as Error)?.message ?? "Erro");
    }
  };

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  const t = data.totals;

  return (
    <div className="space-y-4">
      {/* Banners de alerta */}
      {(alertsData?.alerts ?? []).map((a) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const d = a.details as any;
        return (
          <Card key={a.id} className="p-3 border-amber-500/60 bg-amber-50 dark:bg-amber-950/30">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
              <div className="flex-1 text-sm">
                <div className="font-semibold text-amber-900 dark:text-amber-200">
                  Taxa de escalação acima do limite
                </div>
                <div className="text-amber-800 dark:text-amber-300 text-xs mt-0.5">
                  {d.escalated_runs}/{d.total_runs} runs ({d.rate_pct}%) nos últimos {d.window_minutes} min — limite configurado: {d.threshold_pct}%.
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => onResolveAlert(a.id)}>
                <X className="h-3.5 w-3.5 mr-1" /> Resolver
              </Button>
            </div>
          </Card>
        );
      })}

      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold">Dashboard do agente</h3>
        <div className="flex items-center gap-2">
          <Select value={range.key} onValueChange={(v) => setRange((r) => ({ ...r, key: v as RangeKey }))}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Últimos 7 dias</SelectItem>
              <SelectItem value="30d">Últimos 30 dias</SelectItem>
              <SelectItem value="90d">Últimos 90 dias</SelectItem>
              <SelectItem value="custom">Personalizado</SelectItem>
            </SelectContent>
          </Select>
          {range.key === "custom" && <CustomRangePicker range={range} onChange={setRange} />}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <MetricCard icon={<Activity className="h-4 w-4" />} label="Ativações" value={String(t.activations)} sub={`${t.success} ok · ${t.escalated} escalados · ${t.errors} erros`} tooltip="Quantas vezes este agente foi acionado no período. 'ok' = respondeu sem escalar; 'escalados' = transferiu para humano; 'erros' = falhou ao processar." />
        <MetricCard icon={<DollarSign className="h-4 w-4" />} label="Custo estimado" value={fmtUsd(t.cost_usd)} sub={`${t.tokens_in.toLocaleString()} in · ${t.tokens_out.toLocaleString()} out`} tooltip="Custo em USD dos tokens consumidos por este agente. 'in' = tokens enviados ao modelo; 'out' = tokens gerados na resposta." />
        <MetricCard icon={<CheckCircle2 className="h-4 w-4" />} label="Resolvidas sem humano" value={fmtPct(t.resolution_rate)} sub={`${t.resolved_without_human}/${t.total_conversations} conversas`} tooltip="Conversas em que o agente atendeu até o fim sem escalar para um humano." />
        <MetricCard icon={<MessageCircleReply className="h-4 w-4" />} label="Taxa de 1ª resposta" value={t.first_reply_total > 0 ? fmtPct(t.first_reply_rate) : "—"} sub={`${t.first_reply_engaged}/${t.first_reply_total} engajaram${t.avg_time_to_first_reply_ms ? ` · ${fmtMs(t.avg_time_to_first_reply_ms)}` : ""}`} tooltip="Percentual de contatos que responderam à primeira mensagem do agente. Tempo médio é quanto o contato demorou para responder." />
        <MetricCard icon={<Clock className="h-4 w-4" />} label="Tempo até escalar" value={fmtMs(t.avg_time_to_escalate_ms)} sub={`Latência média: ${fmtMs(t.avg_latency_ms)}`} tooltip="Tempo médio entre o início da conversa e a transferência para um humano. Latência média = tempo de resposta do modelo por mensagem." />
      </div>


      {/* Vendas atribuídas */}
      <SalesBlock data={salesData} />

      <Card className="p-4">
        <h4 className="text-sm font-semibold mb-3">Ativações por dia</h4>
        {data.daily.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Sem dados no período</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data.daily}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="activations" stroke="hsl(var(--primary))" name="Ativações" />
              <Line type="monotone" dataKey="success" stroke="hsl(142 76% 36%)" name="Sucesso" />
              <Line type="monotone" dataKey="escalated" stroke="hsl(38 92% 50%)" name="Escalados" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card className="p-4">
        <h4 className="text-sm font-semibold mb-3">Custo por dia (USD)</h4>
        {data.daily.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Sem dados no período</p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data.daily}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => `$${v.toFixed(4)}`} />
              <Bar dataKey="cost" fill="hsl(var(--primary))" name="Custo" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card className="p-4">
        <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          Principais motivos de escalação
        </h4>
        {data.escalation_reasons.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Nenhuma escalação no período</p>
        ) : (
          <div className="space-y-2">
            {data.escalation_reasons.map((r, i) => {
              const max = data.escalation_reasons[0].count;
              const pct = (r.count / max) * 100;
              return (
                <div key={i} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="truncate">{r.reason}</span>
                    <Badge variant="secondary">{r.count}</Badge>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-amber-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {data.ab.length > 0 && (
        <Card className="p-4">
          <h4 className="text-sm font-semibold mb-3">Comparativo A/B</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Variante</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Sucesso</TableHead>
                <TableHead className="text-right">Escalados</TableHead>
                <TableHead className="text-right">Custo</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.ab.map((a) => (
                <TableRow key={a.key}>
                  <TableCell className="font-medium">{a.variant}</TableCell>
                  <TableCell className="text-right">{a.total}</TableCell>
                  <TableCell className="text-right">{a.total > 0 ? fmtPct(a.success / a.total) : "—"}</TableCell>
                  <TableCell className="text-right">{a.total > 0 ? fmtPct(a.escalated / a.total) : "—"}</TableCell>
                  <TableCell className="text-right">{fmtUsd(a.cost)}</TableCell>
                  <TableCell className="text-right">{a.tokens.toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Card className="p-4">
        <h4 className="text-sm font-semibold mb-1">Feedback loop de escalações</h4>
        <p className="text-xs text-muted-foreground mb-3">
          Os atendentes humanos validam se o motivo registrado pelo agente estava correto. Use isso para ajustar o prompt e as bases.
        </p>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">Confirmadas</div>
            <div className="text-2xl font-semibold text-emerald-600">{data.reviews.confirmed}</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">Corrigidas</div>
            <div className="text-2xl font-semibold text-amber-600">{data.reviews.corrected}</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">Pendentes</div>
            <div className="text-2xl font-semibold text-muted-foreground">{data.reviews.pending}</div>
          </div>
        </div>

        {revData && revData.reviews.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Motivo original</TableHead>
                <TableHead>Validado</TableHead>
                <TableHead className="w-32 text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {revData.reviews.slice(0, 20).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">{new Date(r.reviewed_at).toLocaleString()}</TableCell>
                  <TableCell className="text-xs max-w-xs truncate">{r.original_reason ?? "—"}</TableCell>
                  <TableCell className="text-xs max-w-xs truncate">{r.validated_reason ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    {r.was_correct ? (
                      <Badge variant="default" className="bg-emerald-600">Confirmado</Badge>
                    ) : (
                      <Badge variant="secondary" className="bg-amber-500 text-white">Corrigido</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground py-4 text-center">Nenhuma revisão registrada ainda</p>
        )}
      </Card>
    </div>
  );
}

function CustomRangePicker({ range, onChange }: { range: RangeState; onChange: (r: RangeState) => void }) {
  const from = range.from ? new Date(range.from + "T00:00:00") : undefined;
  const to = range.to ? new Date(range.to + "T00:00:00") : undefined;
  const label = from && to ? `${format(from, "dd/MM/yy")} – ${format(to, "dd/MM/yy")}` : "Selecionar período";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <CalendarIcon className="h-3.5 w-3.5" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-0">
        <Calendar
          mode="range"
          numberOfMonths={2}
          defaultMonth={from}
          selected={{ from, to }}
          onSelect={(sel) => {
            if (sel?.from && sel?.to) {
              onChange({
                key: "custom",
                from: format(sel.from, "yyyy-MM-dd"),
                to: format(sel.to, "yyyy-MM-dd"),
              });
            }
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SalesBlock({ data }: { data: any }) {
  if (!data) return null;
  if (!data.tracking_tag) {
    return (
      <Card className="p-4 border-dashed">
        <h4 className="text-sm font-semibold mb-1 flex items-center gap-2">
          <ShoppingCart className="h-4 w-4" /> Vendas atribuídas
        </h4>
        <p className="text-xs text-muted-foreground">
          Configure uma <strong>tag de rastreio</strong> nas configurações do agente (aba Parâmetros) para que possamos cruzar UTM/SCK das vendas com este agente.
        </p>
      </Card>
    );
  }

  const a = data.attributed;
  const ticket = a.count > 0 ? a.gross_value / a.count : 0;
  const totalPeriod = data.total_sales_in_period as number;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h4 className="text-sm font-semibold flex items-center gap-2">
          <ShoppingCart className="h-4 w-4" /> Vendas atribuídas
        </h4>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="font-mono text-[10px]">{data.tracking_tag}</Badge>
          <span>{a.count}/{totalPeriod} vendas no período</span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard icon={<ShoppingCart className="h-4 w-4" />} label="Vendas" value={String(a.count)} tooltip="Vendas atribuídas a este agente no período via tag de agente na conversa (atribuição last-touch)." />
        <MetricCard icon={<DollarSign className="h-4 w-4" />} label="Valor bruto" value={fmtBRL(a.gross_value)} sub={Object.keys(a.currency_breakdown).join(", ") || "—"} tooltip="Soma dos valores das vendas atribuídas. A linha abaixo mostra as moedas envolvidas." />
        <MetricCard icon={<DollarSign className="h-4 w-4" />} label="Ticket médio" value={fmtBRL(ticket)} tooltip="Valor bruto dividido pelo número de vendas atribuídas ao agente." />
        <MetricCard icon={<Activity className="h-4 w-4" />} label="Cobertura" value={totalPeriod > 0 ? fmtPct(a.count / totalPeriod) : "—"} sub="Sobre todas as vendas do período" tooltip="Fatia das vendas totais do workspace no período que foram atribuídas a este agente." />
      </div>


      {a.daily.length > 0 && (
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={a.daily}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="day" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="l" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            <Bar yAxisId="l" dataKey="count" fill="hsl(var(--primary))" name="Vendas" />
            <Bar yAxisId="r" dataKey="value" fill="hsl(142 76% 36%)" name="Valor" />
          </BarChart>
        </ResponsiveContainer>
      )}

      {a.top_products.length > 0 && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Produtos mais vendidos</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead className="text-right w-20">Vendas</TableHead>
                <TableHead className="text-right w-32">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {a.top_products.map((p: { name: string; count: number; value: number }) => (
                <TableRow key={p.name}>
                  <TableCell className="text-sm">{p.name}</TableCell>
                  <TableCell className="text-right text-sm">{p.count}</TableCell>
                  <TableCell className="text-right text-sm">{fmtBRL(p.value)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Atribuição last-touch via tag — busca em <code>sck</code>, <code>src</code>, <code>utm_*</code> e cupons de desconto. Vendas sem rastreio (ex.: pix direto) não entram aqui.
      </p>
    </Card>
  );
}

function MetricCard({ icon, label, value, sub, tooltip }: { icon: React.ReactNode; label: string; value: string; sub?: string; tooltip?: string }) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        {icon}
        <span>{label}</span>
        {tooltip && (
          <TooltipProvider delayDuration={150}>
            <UiTooltip>
              <TooltipTrigger asChild>
                <Info className="h-3 w-3 text-muted-foreground/70 hover:text-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">{tooltip}</TooltipContent>
            </UiTooltip>
          </TooltipProvider>
        )}
      </div>
      <div className="text-xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5 truncate">{sub}</div>}
    </Card>
  );
}

