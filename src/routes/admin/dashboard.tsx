import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Activity, DollarSign, CheckCircle2, ShoppingCart, MessageCircleReply, Workflow, Bot, CalendarIcon, Info } from "lucide-react";
import { format } from "date-fns";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Tooltip as UiTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";

import { useActiveBrand } from "@/lib/active-brand";
import { getWorkspaceDashboard } from "@/lib/dashboard-overview.functions";

export const Route = createFileRoute("/admin/dashboard")({
  component: DashboardPage,
});

type RangeKey = "7d" | "30d" | "90d" | "custom";
type RangeState = { key: RangeKey; from?: string; to?: string };

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

const fmtUsd = (v: number) => {
  const abs = Math.abs(v);
  const digits = abs >= 1 ? 2 : 4;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(v);
};
const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;
const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

function DashboardPage() {
  const { activeBrandId, activeBrand } = useActiveBrand();
  const storageKey = `workspace-dashboard-range`;
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
  }, [range]);

  const dates = useMemo(() => rangeToDates(range), [range]);
  const fn = useServerFn(getWorkspaceDashboard);

  const { data, isLoading } = useQuery({
    queryKey: ["workspace-dashboard", activeBrandId, range],
    enabled: !!activeBrandId,
    queryFn: () => fn({ data: { brandId: activeBrandId!, from: dates.from, to: dates.to } }),
  });

  if (!activeBrandId) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Selecione uma workspace para ver o dashboard.</div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const t = data.totals;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">{activeBrand?.name ?? "Workspace"} — visão consolidada</p>
        </div>
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

      {/* Visão consolidada */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <MetricCard tone="ai" icon={<Activity className="h-4 w-4" />} label="Conversas com IA" value={String(t.conversations)} sub={`${t.ai_activations} ativações`} tooltip="Conversas em que pelo menos um agente de IA atuou no período." />
        <MetricCard tone="success" icon={<CheckCircle2 className="h-4 w-4" />} label="Resolvidas sem humano" value={t.conversations > 0 ? fmtPct(t.resolution_rate) : "—"} sub={`${t.resolved_without_human}/${t.conversations}`} tooltip="Percentual de conversas com IA que terminaram sem precisar de atendente humano." />
        <MetricCard
          tone="warning"
          icon={<MessageCircleReply className="h-4 w-4" />}
          label="Taxa de 1ª resposta"
          value={t.first_reply_total > 0 ? fmtPct(t.first_reply_total > 0 ? t.first_reply_engaged / t.first_reply_total : 0) : "—"}
          sub={`${t.first_reply_engaged}/${t.first_reply_total} engajaram`}
          tooltip="Percentual de contatos que responderam à primeira mensagem enviada pela IA."
        />
        <MetricCard tone="destructive" icon={<ShoppingCart className="h-4 w-4" />} label="Vendas atribuídas" value={String(t.attributed_count)} sub={fmtBRL(t.attributed_value)} tooltip="Vendas creditadas à IA por meio das tags de agente nas conversas (atribuição last-touch)." />
        <MetricCard tone="info" icon={<DollarSign className="h-4 w-4" />} label="Custo IA" value={fmtUsd(t.ai_cost_usd)} sub={`${t.sales_count} vendas no total`} tooltip="Custo estimado em USD do consumo de tokens dos agentes no período." />
      </div>


      {/* Agentes */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
          <SectionIcon tone="ai"><Bot className="h-4 w-4" /></SectionIcon> Agentes de IA
        </h3>
        {data.agents.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Nenhum agente configurado nessa workspace.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agente</TableHead>
                <TableHead className="text-right w-20">Ativações</TableHead>
                <TableHead className="text-right w-20">Sucesso</TableHead>
                <TableHead className="text-right w-20">Escalados</TableHead>
                <TableHead className="text-right w-24">1ª resposta</TableHead>
                <TableHead className="text-right w-24">Custo</TableHead>
                <TableHead className="text-right w-28">Vendas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.agents.map((a) => (
                <TableRow key={a.agent_id} className="cursor-pointer hover:bg-muted/30" onClick={() => { window.location.href = `/admin/agentes/${a.agent_id}`; }}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{a.name}</span>
                      <Badge variant={a.status === "on" ? "default" : "secondary"} className="text-[10px]">{a.status}</Badge>
                    </div>
                    {a.tracking_tag && <div className="text-[11px] text-muted-foreground font-mono">{a.tracking_tag}</div>}
                  </TableCell>
                  <TableCell className="text-right">{a.activations}</TableCell>
                  <TableCell className="text-right">{a.success}</TableCell>
                  <TableCell className="text-right">{a.escalated}</TableCell>
                  <TableCell className="text-right">
                    {a.first_reply_total > 0 ? `${fmtPct(a.first_reply_rate)}` : "—"}
                    <div className="text-[10px] text-muted-foreground">{a.first_reply_engaged}/{a.first_reply_total}</div>
                  </TableCell>
                  <TableCell className="text-right">{fmtUsd(a.cost_usd)}</TableCell>
                  <TableCell className="text-right">
                    {a.attributed_sales_count}
                    <div className="text-[10px] text-muted-foreground">{fmtBRL(a.attributed_sales_value)}</div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {data.agents.length > 0 && (
          <ResponsiveContainer width="100%" height={200} className="mt-4">
            <BarChart data={data.agents.slice(0, 10)}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="activations" fill="hsl(var(--primary))" name="Ativações" />
              <Bar dataKey="first_reply_engaged" fill="hsl(142 76% 36%)" name="Engajaram (1ª resposta)" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Automações */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
          <SectionIcon tone="primary"><Workflow className="h-4 w-4" /></SectionIcon> Automações
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <MetricCard label="Runs" value={String(data.automations.runs)} tooltip="Total de execuções de automações iniciadas no período." />
          <MetricCard label="Concluídos" value={String(data.automations.finished)} sub={data.automations.runs > 0 ? fmtPct(data.automations.finished / data.automations.runs) : "—"} tooltip="Execuções que terminaram com sucesso." />
          <MetricCard label="Falharam" value={String(data.automations.failed)} tooltip="Execuções que terminaram com erro." />
          <MetricCard label="Aguardando" value={String(data.automations.waiting + data.automations.running)} sub={`${data.automations.running} em execução`} tooltip="Execuções aguardando próximo passo ou em andamento agora." />

        </div>
        {data.automations.top.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Automação</TableHead>
                <TableHead className="text-right w-24">Runs</TableHead>
                <TableHead className="text-right w-24">Falhas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.automations.top.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <a href={`/admin/automacoes/${a.id}`} className="hover:underline">{a.name}</a>
                  </TableCell>
                  <TableCell className="text-right">{a.runs}</TableCell>
                  <TableCell className="text-right">{a.failed}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground py-2 text-center">Nenhum run no período.</p>
        )}
      </Card>

      {/* Vendas */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
          <SectionIcon tone="success"><ShoppingCart className="h-4 w-4" /></SectionIcon> Vendas
          <span className="text-[11px] font-normal text-muted-foreground ml-auto">
            apenas vendas atribuíveis a agentes IA ou ao Rastreio
          </span>
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          <MetricCard label="Vendas" value={String(data.sales.count)} sub={`${data.sales.raw_count} no total`} tooltip="Vendas com origem identificada (tag de agente IA, SCK ou UTM cadastrados no Rastreio). O 'total' inclui também vendas sem rastreio." />
          <MetricCard label="Valor bruto" value={fmtBRL(data.sales.value)} sub={Object.keys(data.sales.currency_breakdown).join(", ") || "—"} tooltip="Soma dos valores das vendas atribuídas no período." />
          <MetricCard label="Por agente IA" value={String(data.sales.breakdown.agent.count)} sub={fmtBRL(data.sales.breakdown.agent.value)} tooltip="Vendas atribuídas a um agente de IA via tag de agente na conversa." />
          <MetricCard label="Por vendedor" value={String(data.sales.breakdown.seller.count)} sub={fmtBRL(data.sales.breakdown.seller.value)} tooltip="Vendas atribuídas a um vendedor cadastrado no Rastreio (SCK/UTM)." />
          <MetricCard label="Por automação" value={String(data.sales.breakdown.automation.count)} sub={fmtBRL(data.sales.breakdown.automation.value)} tooltip="Vendas atribuídas a uma automação cadastrada no Rastreio (SCK/UTM)." />

        </div>
        {data.sales.daily.length > 0 && (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.sales.daily}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="agent" stackId="a" fill="hsl(var(--primary))" name="Agente IA" />
              <Bar dataKey="seller" stackId="a" fill="hsl(142 76% 36%)" name="Vendedor" />
              <Bar dataKey="automation" stackId="a" fill="hsl(38 92% 50%)" name="Automação" />
            </BarChart>
          </ResponsiveContainer>
        )}

        {(data.sales.top_sellers.length > 0 || data.sales.top_automations.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            {data.sales.top_sellers.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-muted-foreground mb-2">Top vendedores</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vendedor</TableHead>
                      <TableHead className="text-right w-20">Vendas</TableHead>
                      <TableHead className="text-right w-28">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.sales.top_sellers.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>{s.name}</TableCell>
                        <TableCell className="text-right">{s.count}</TableCell>
                        <TableCell className="text-right">{fmtBRL(s.value)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {data.sales.top_automations.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-muted-foreground mb-2">Top automações (vendas)</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Automação</TableHead>
                      <TableHead className="text-right w-20">Vendas</TableHead>
                      <TableHead className="text-right w-28">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.sales.top_automations.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>{s.name}</TableCell>
                        <TableCell className="text-right">{s.count}</TableCell>
                        <TableCell className="text-right">{fmtBRL(s.value)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
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

type Tone = "primary" | "success" | "warning" | "destructive" | "info" | "ai" | "muted";

const TONE_BG: Record<Tone, string> = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  destructive: "bg-destructive/10 text-destructive",
  info: "bg-info/10 text-info",
  ai: "bg-ai/10 text-ai",
  muted: "bg-muted text-muted-foreground",
};

function SectionIcon({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`flex h-7 w-7 items-center justify-center rounded-md ${TONE_BG[tone]}`}>
      {children}
    </span>
  );
}

function MetricCard({ icon, label, value, sub, tone, tooltip }: { icon?: React.ReactNode; label: string; value: string; sub?: string; tone?: Tone; tooltip?: string }) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
        {icon && (
          <span className={`flex h-7 w-7 items-center justify-center rounded-md ${TONE_BG[tone ?? "muted"]}`}>
            {icon}
          </span>
        )}
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

