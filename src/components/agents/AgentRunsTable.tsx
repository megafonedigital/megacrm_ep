import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Activity } from "lucide-react";
import { listAgentRuns, getAgentRun } from "@/lib/ai-agents.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

type Status = "success" | "error" | "escalated" | "rate_limited";
type Trigger = "automation" | "manual_test" | "scenario" | "assign_block" | "message";

interface Props {
  brandId: string;
  agentId?: string;
  showAgentColumn?: boolean;
}

function statusBadge(s: string): "default" | "secondary" | "destructive" | "outline" {
  if (s === "success") return "default";
  if (s === "escalated") return "secondary";
  if (s === "rate_limited") return "outline";
  return "destructive";
}

const TRIGGER_LABEL: Record<Trigger, string> = {
  message: "Mensagem",
  automation: "Automação",
  manual_test: "Teste manual",
  scenario: "Cenário",
  assign_block: "Bloco assign",
};

export function AgentRunsTable({ brandId, agentId, showAgentColumn = false }: Props) {
  const listFn = useServerFn(listAgentRuns);
  const getFn = useServerFn(getAgentRun);
  const [status, setStatus] = useState<Status | "all">("all");
  const [trig, setTrig] = useState<Trigger | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const runsQ = useQuery({
    queryKey: ["agent-runs", brandId, agentId, status, trig],
    queryFn: () =>
      listFn({
        data: {
          brandId,
          agentId,
          status: status === "all" ? undefined : status,
          triggeredBy: trig === "all" ? undefined : trig,
          limit: 100,
        },
      }),
    refetchInterval: 10_000,
  });

  const detailQ = useQuery({
    queryKey: ["agent-run", selectedId],
    enabled: !!selectedId,
    queryFn: () => getFn({ data: { runId: selectedId! } }),
  });

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="success">Sucesso</SelectItem>
            <SelectItem value="escalated">Escalado</SelectItem>
            <SelectItem value="error">Erro</SelectItem>
            <SelectItem value="rate_limited">Rate-limited</SelectItem>
          </SelectContent>
        </Select>
        <Select value={trig} onValueChange={(v) => setTrig(v as typeof trig)}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as origens</SelectItem>
            <SelectItem value="message">Mensagem</SelectItem>
            <SelectItem value="automation">Automação</SelectItem>
            <SelectItem value="manual_test">Teste manual</SelectItem>
            <SelectItem value="scenario">Cenário</SelectItem>
            <SelectItem value="assign_block">Bloco assign</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Quando</TableHead>
              {showAgentColumn && <TableHead>Agente</TableHead>}
              <TableHead>Contato</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Modelo</TableHead>
              <TableHead className="text-right">Latência</TableHead>
              <TableHead className="text-right">Tokens (in/out)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runsQ.isLoading && (
              <TableRow><TableCell colSpan={showAgentColumn ? 8 : 7} className="text-center py-8"><Loader2 className="h-4 w-4 animate-spin inline" /></TableCell></TableRow>
            )}
            {runsQ.data?.runs.length === 0 && (
              <TableRow><TableCell colSpan={showAgentColumn ? 8 : 7} className="text-center py-8 text-sm text-muted-foreground">
                <Activity className="h-5 w-5 inline mr-1" /> Nenhuma execução ainda.
              </TableCell></TableRow>
            )}
            {(runsQ.data?.runs ?? []).map((r: any) => (
              <TableRow key={r.id} onClick={() => setSelectedId(r.id)} className="cursor-pointer hover:bg-muted/50">
                <TableCell className="text-xs whitespace-nowrap">{new Date(r.created_at).toLocaleString("pt-BR")}</TableCell>
                {showAgentColumn && <TableCell className="text-sm">{r.ai_agents?.name ?? "—"}</TableCell>}
                <TableCell className="text-sm">{r.contacts?.name ?? r.contacts?.phone ?? r.contacts?.wa_id ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell><Badge variant={statusBadge(r.status)}>{r.status}{r.escalation_track ? ` → ${r.escalation_track}` : ""}</Badge></TableCell>
                <TableCell className="text-xs">{TRIGGER_LABEL[r.triggered_by as Trigger] ?? r.triggered_by}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.model ?? "—"}</TableCell>
                <TableCell className="text-xs text-right">{r.latency_ms != null ? `${r.latency_ms}ms` : "—"}</TableCell>
                <TableCell className="text-xs text-right">{r.tokens_in ?? "—"} / {r.tokens_out ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Sheet open={!!selectedId} onOpenChange={(o) => !o && setSelectedId(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Detalhes da execução</SheetTitle>
          </SheetHeader>
          {detailQ.isLoading && <div className="py-8 text-center"><Loader2 className="h-4 w-4 animate-spin inline" /></div>}
          {detailQ.data?.run && <RunDetail run={detailQ.data.run as any} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function RunDetail({ run }: { run: any }) {
  return (
    <div className="space-y-4 mt-4 text-sm">
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div><span className="text-muted-foreground">Status:</span> <Badge variant={statusBadge(run.status)}>{run.status}</Badge></div>
        <div><span className="text-muted-foreground">Origem:</span> {TRIGGER_LABEL[run.triggered_by as Trigger] ?? run.triggered_by}</div>
        <div><span className="text-muted-foreground">Modelo:</span> {run.model ?? "—"}</div>
        <div><span className="text-muted-foreground">Temperatura:</span> {run.temperature ?? "—"}</div>
        <div><span className="text-muted-foreground">Latência:</span> {run.latency_ms != null ? `${run.latency_ms}ms` : "—"}</div>
        <div><span className="text-muted-foreground">Tokens:</span> {run.tokens_in ?? "—"} in / {run.tokens_out ?? "—"} out</div>
      </div>

      {run.error_code && (
        <Card className="p-3 border-destructive/40 bg-destructive/5">
          <div className="font-semibold text-xs">Erro</div>
          <div className="text-xs"><strong>Código:</strong> {run.error_code}</div>
          {run.error_message && <pre className="text-xs whitespace-pre-wrap mt-1">{run.error_message}</pre>}
        </Card>
      )}

      {run.tool_call && (
        <Card className="p-3">
          <div className="font-semibold text-xs mb-1">Tool call</div>
          <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(run.tool_call, null, 2)}</pre>
        </Card>
      )}

      {run.output_text && (
        <Card className="p-3">
          <div className="font-semibold text-xs mb-1">Resposta</div>
          <div className="text-sm whitespace-pre-wrap">{run.output_text}</div>
        </Card>
      )}

      {run.input_variables && Object.keys(run.input_variables as Record<string, string>).length > 0 && (
        <Card className="p-3">
          <div className="font-semibold text-xs mb-2">Variáveis resolvidas</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1 text-xs">
            {Object.entries(run.input_variables as Record<string, string>).map(([k, v]) => (
              <div key={k} className="border rounded px-2 py-1">
                <code className="text-[10px] text-muted-foreground">{`{{${k}}}`}</code>
                <div className="break-words whitespace-pre-wrap">{v || <span className="text-muted-foreground">(vazio)</span>}</div>
              </div>
            ))}
          </div>
        </Card>
      )}


      <Card className="p-3">
        <div className="font-semibold text-xs mb-2">Mensagens enviadas ao modelo ({Array.isArray(run.input_messages) ? run.input_messages.length : 0})</div>
        <div className="space-y-2">
          {(Array.isArray(run.input_messages) ? run.input_messages : []).map((m: any, i: number) => (
            <div key={i} className="border-l-2 pl-2 text-xs">
              <div className="text-muted-foreground uppercase text-[10px]">{m.role}</div>
              <div className="whitespace-pre-wrap">{m.content}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
