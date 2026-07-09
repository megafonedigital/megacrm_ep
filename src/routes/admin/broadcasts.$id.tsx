import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Loader2, Ban, Workflow, AlertTriangle, ArrowUp, ArrowDown, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { getBroadcast, listBroadcastTargets, cancelBroadcast } from "@/lib/broadcasts.functions";
import { formatDuration } from "@/lib/format-duration";
import { RunFlowViewerDialog } from "@/components/automations/RunFlowViewerDialog";
import { BroadcastSpeedChart } from "@/components/broadcasts/BroadcastSpeedChart";

export const Route = createFileRoute("/admin/broadcasts/$id")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  component: BroadcastDetailPage,
});

type StatusFilter = "all" | "dispatched" | "failed" | "skipped" | "pending" | "processing" | "cancelled";

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "dispatched", label: "Enviadas" },
  { id: "failed", label: "Falhas" },
  { id: "skipped", label: "Puladas" },
  { id: "pending", label: "Pendentes" },
  { id: "processing", label: "Processando" },
  { id: "cancelled", label: "Canceladas" },
];

function BroadcastDetailPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<{ column: "dispatched_at" | "status"; direction: "asc" | "desc" }>({
    column: "dispatched_at",
    direction: "desc",
  });
  const [, setNowTick] = useState(0);
  const [selectedTarget, setSelectedTarget] = useState<any | null>(null);
  const [flowOpen, setFlowOpen] = useState(false);

  const toggleSort = (column: "dispatched_at" | "status") => {
    setPage(1);
    setSort((prev) =>
      prev.column === column
        ? { column, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { column, direction: "desc" },
    );
  };

  const runQ = useQuery({
    queryKey: ["broadcast-target-run", selectedTarget?.run_id],
    enabled: !!selectedTarget?.run_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("automation_runs")
        .select("id, automation_id, conversation_id, status, started_at, finished_at, current_node_id, last_error, automations:automation_id(name)")
        .eq("id", selectedTarget.run_id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const stepsQ = useQuery({
    queryKey: ["broadcast-target-steps", selectedTarget?.run_id],
    enabled: !!selectedTarget?.run_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("automation_run_steps")
        .select("id, executed_at, node_id, node_type, payload, error")
        .eq("run_id", selectedTarget.run_id)
        .order("executed_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const runConvId = (runQ.data as any)?.conversation_id ?? null;
  const runStartedAt = (runQ.data as any)?.started_at ?? null;
  const messagesQ = useQuery({
    queryKey: ["broadcast-target-messages", runConvId, runStartedAt],
    enabled: !!runConvId && !!runStartedAt,
    refetchInterval: 5_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("id, direction, type, status, template_name, error_code, error_message, wa_message_id, created_at")
        .eq("conversation_id", runConvId)
        .eq("direction", "outbound")
        .gte("created_at", runStartedAt)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const getFn = useServerFn(getBroadcast);
  const listFn = useServerFn(listBroadcastTargets);
  const cancelFn = useServerFn(cancelBroadcast);

  const bq = useQuery({
    queryKey: ["broadcast", id],
    queryFn: () => getFn({ data: { id } }),
    refetchInterval: (query) => {
      const status = (query.state.data as any)?.row?.status;
      return ["completed", "cancelled", "failed"].includes(status) ? false : 5_000;
    },
    staleTime: 2_000,
  });

  const tq = useQuery({
    queryKey: ["broadcast-targets", id, statusFilter, page, sort.column, sort.direction],
    queryFn: () => listFn({ data: { broadcastId: id, status: statusFilter, page, sort } }),
    refetchInterval: 15_000,
    staleTime: 5_000,
    retry: 1,
  });


  const cancelMut = useMutation({
    mutationFn: () => cancelFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Broadcast cancelado");
      qc.invalidateQueries({ queryKey: ["broadcast", id] });
      qc.invalidateQueries({ queryKey: ["broadcast-targets", id] });
    },
  });

  const b = bq.data?.row as any;
  const total = b?.total_targets ?? 0;
  const done = (b?.dispatched_count ?? 0) + (b?.failed_count ?? 0) + (b?.skipped_count ?? 0);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const canCancel = b && !["completed", "cancelled", "failed"].includes(b.status);
  const lastDispatchMs = b?.last_dispatch_at ? new Date(b.last_dispatch_at).getTime() : 0;
  const hasPendingWork = (b?.pending_count ?? 0) + (b?.processing_count ?? 0) + (b?.queue_pending_count ?? 0) + (b?.queue_processing_count ?? 0) > 0;
  const appearsStuck = b?.status === "running" && hasPendingWork && (!lastDispatchMs || Date.now() - lastDispatchMs > 3 * 60_000);

  useEffect(() => {
    if (b?.status !== "running" || !b?.started_at) return;
    const t = setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [b?.status, b?.started_at]);

  // Reset page on filter change
  useEffect(() => { setPage(1); }, [statusFilter]);

  return (
    <div className="p-6 space-y-4">
      <Link to="/admin/broadcasts" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Link>

      {bq.isLoading && !b ? (
        <div className="p-8 text-center"><Loader2 className="h-5 w-5 animate-spin inline" /></div>
      ) : bq.isError && !b ? (
        <div className="p-8 text-center text-sm text-destructive space-y-2">
          <div>Não foi possível carregar este broadcast.</div>
          <Button size="sm" variant="outline" onClick={() => bq.refetch()}>Tentar novamente</Button>
        </div>
      ) : b ? (

        <>
          <Card className="p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-xl font-semibold">{b.name}</h1>
                <p className="text-sm text-muted-foreground">Fluxo: {b.automations?.name ?? "—"}</p>
              </div>
              <div className="flex gap-2 items-center">
                <Badge>{b.status}</Badge>
                {canCancel && (
                  <Button variant="outline" size="sm" onClick={() => cancelMut.mutate()} disabled={cancelMut.isPending}>
                    <Ban className="h-4 w-4 mr-1" /> Cancelar
                  </Button>
                )}
              </div>
            </div>
            <Progress value={pct} />
            {appearsStuck && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4" />
                Sem envio real há mais de 3 minutos com itens pendentes/fila ativa.
              </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-sm">
              <div><div className="text-muted-foreground text-xs">Total</div><div className="font-semibold">{total}</div></div>
              <div><div className="text-muted-foreground text-xs">Enviadas</div><div className="font-semibold text-green-600">{b.dispatched_count}</div></div>
              <div><div className="text-muted-foreground text-xs">Falhas</div><div className="font-semibold text-destructive">{b.failed_count}</div></div>
              <div><div className="text-muted-foreground text-xs">Puladas</div><div className="font-semibold text-amber-600">{b.skipped_count}</div></div>
              <div><div className="text-muted-foreground text-xs">Pendentes</div><div className="font-semibold">{b.queue_pending_count ?? b.pending_count ?? Math.max(0, total - done)}</div></div>
              <div><div className="text-muted-foreground text-xs">Processando</div><div className="font-semibold">{b.queue_processing_count ?? b.processing_count ?? 0}</div></div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-muted-foreground border-t pt-3">
              <div>
                <div className="uppercase tracking-wide flex items-center gap-1">
                  Velocidade configurada
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3 w-3 cursor-help opacity-70" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-xs">
                      Velocidade-alvo (msg/min). O limite técnico da Meta é ≥4.800/min por número —
                      este valor protege a qualidade do número e respeita seu tier diário.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="text-foreground font-medium">{b.rate_per_minute}/min</div>
              </div>
              <div>
                <div className="uppercase tracking-wide">{["completed","cancelled","failed"].includes(b.status) ? "Taxa final (último minuto)" : "Taxa real (último minuto)"}</div>
                <div className="text-foreground font-medium">{b.rate_last_minute ?? 0}/min</div>
              </div>
              <div>
                <div className="uppercase tracking-wide">{["completed","cancelled","failed"].includes(b.status) ? "Taxa final (10 min)" : "Taxa real (10 min)"}</div>
                <div className="text-foreground font-medium">{b.rate_last_10m ?? 0}/10min</div>
              </div>
              <div>
                <div className="uppercase tracking-wide">Iniciado em</div>
                <div className="text-foreground font-medium">
                  {b.started_at ? new Date(b.started_at).toLocaleString() : (b.scheduled_at ? `Agendado: ${new Date(b.scheduled_at).toLocaleString()}` : "—")}
                </div>
              </div>
              <div>
                <div className="uppercase tracking-wide">Duração</div>
                <div className="text-foreground font-medium">{b.started_at ? formatDuration(b.started_at, b.finished_at) : "—"}</div>
              </div>
            </div>
          </Card>

          <Card className="p-4 space-y-2">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">Velocidade ao longo do tempo</h2>
              <span className="text-xs text-muted-foreground">
                {["completed","cancelled","failed"].includes(b.status)
                  ? "histórico do broadcast"
                  : "últimos 60 min · atualiza a cada 1min"}
              </span>
            </div>
            <BroadcastSpeedChart broadcastId={id} minutes={60} isTerminal={["completed","cancelled","failed"].includes(b.status)} />
          </Card>


          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((f) => (
              <Button
                key={f.id}
                size="sm"
                variant={statusFilter === f.id ? "default" : "outline"}
                onClick={() => setStatusFilter(f.id)}
              >
                {f.label}
              </Button>
            ))}
          </div>

          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contato</TableHead>
                  <TableHead>
                    <button
                      type="button"
                      onClick={() => toggleSort("status")}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                    >
                      Status
                      {sort.column === "status" ? (
                        sort.direction === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                      ) : null}
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      type="button"
                      onClick={() => toggleSort("dispatched_at")}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                    >
                      Quando
                      {sort.column === "dispatched_at" ? (
                        sort.direction === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                      ) : null}
                    </button>
                  </TableHead>
                  <TableHead>Erro</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tq.isError ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-sm py-6 space-y-2">
                      <div className="text-destructive">Falha ao carregar contatos (consulta lenta ou timeout).</div>
                      <Button size="sm" variant="outline" onClick={() => tq.refetch()}>Tentar novamente</Button>
                    </TableCell>
                  </TableRow>
                ) : (tq.data?.rows ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                      {tq.isLoading ? "Carregando…" : "Nenhum contato neste filtro."}
                    </TableCell>
                  </TableRow>
                ) : (tq.data?.rows ?? []).map((t: any) => {

                  const hasRun = !!t.run_id;
                  const row = (
                    <TableRow
                      key={t.id}
                      className={hasRun ? "cursor-pointer hover:bg-muted/50" : "opacity-90"}
                      onClick={hasRun ? () => setSelectedTarget(t) : undefined}
                    >
                      <TableCell>{t.contacts?.name || t.contacts?.profile_name || t.contacts?.phone || t.contacts?.wa_id || t.contact_id}</TableCell>
                      <TableCell><Badge variant="outline">{t.status}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{t.dispatched_at || t.claimed_at ? new Date(t.dispatched_at ?? t.claimed_at).toLocaleString() : "—"}</TableCell>
                      <TableCell className="text-xs text-destructive">{t.error ?? ""}</TableCell>
                    </TableRow>
                  );
                  return hasRun ? row : (
                    <Tooltip key={t.id}>
                      <TooltipTrigger asChild>{row}</TooltipTrigger>
                      <TooltipContent>Sem execução registrada</TooltipContent>
                    </Tooltip>
                  );
                })}
              </TableBody>
            </Table>
            {tq.data && tq.data.total > tq.data.pageSize && (
              <div className="p-3 flex items-center justify-between text-sm">
                <span>Página {page} de {Math.ceil(tq.data.total / tq.data.pageSize)}</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button>
                  <Button size="sm" variant="outline" disabled={page >= Math.ceil(tq.data.total / tq.data.pageSize)} onClick={() => setPage(page + 1)}>Próxima</Button>
                </div>
              </div>
            )}
          </Card>
        </>
      ) : null}


      <Sheet open={!!selectedTarget} onOpenChange={(o) => !o && setSelectedTarget(null)}>
        <SheetContent className="w-[680px] sm:max-w-[680px] overflow-y-auto">
          <SheetHeader>
            <div className="flex items-center justify-between gap-2 pr-8">
              <SheetTitle>Timeline da execução</SheetTitle>
              <Button size="sm" variant="outline" onClick={() => setFlowOpen(true)} disabled={!runQ.data}>
                <Workflow className="h-4 w-4 mr-1.5" /> Ver no fluxo
              </Button>
            </div>
          </SheetHeader>
          {selectedTarget && (
            <div className="space-y-4 mt-4 text-sm">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div><div className="font-medium text-muted-foreground">Contato</div><div>{selectedTarget.contacts?.name || selectedTarget.contacts?.phone || selectedTarget.contact_id}</div></div>
                <div><div className="font-medium text-muted-foreground">Status do envio</div><Badge variant="outline">{selectedTarget.status}</Badge></div>
                {runQ.data && (
                  <>
                    <div><div className="font-medium text-muted-foreground">Automação</div><div>{(runQ.data as any).automations?.name ?? "—"}</div></div>
                    <div><div className="font-medium text-muted-foreground">Status da execução</div><Badge variant="outline">{(runQ.data as any).status}</Badge></div>
                    <div><div className="font-medium text-muted-foreground">Início</div><div>{(runQ.data as any).started_at ? new Date((runQ.data as any).started_at).toLocaleString("pt-BR") : "—"}</div></div>
                    <div><div className="font-medium text-muted-foreground">Fim</div><div>{(runQ.data as any).finished_at ? new Date((runQ.data as any).finished_at).toLocaleString("pt-BR") : "—"}</div></div>
                  </>
                )}
              </div>
              {(runQ.data as any)?.last_error && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">Último erro</div>
                  <pre className="bg-destructive/10 text-destructive p-2 rounded text-xs whitespace-pre-wrap">{(runQ.data as any).last_error}</pre>
                </div>
              )}
              {selectedTarget.error && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">Erro de envio</div>
                  <pre className="bg-destructive/10 text-destructive p-2 rounded text-xs whitespace-pre-wrap">{selectedTarget.error}</pre>
                </div>
              )}
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-2">Mensagens enviadas (WhatsApp)</div>
                {messagesQ.isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                {!messagesQ.isLoading && (messagesQ.data?.length ?? 0) === 0 && (
                  <div className="text-xs text-muted-foreground">Nenhuma mensagem registrada neste envio.</div>
                )}
                <ol className="space-y-2">
                  {messagesQ.data?.map((m: any) => {
                    const failed = m.status === "failed";
                    return (
                      <li key={m.id} className={`border rounded p-2 ${failed ? "border-destructive/40 bg-destructive/5" : ""}`}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs flex items-center gap-2 flex-wrap">
                            <Badge variant={failed ? "destructive" : "outline"}>{m.status ?? "—"}</Badge>
                            <span className="text-muted-foreground">{m.type}</span>
                            {m.template_name && <span className="font-mono">{m.template_name}</span>}
                          </div>
                          <div className="text-[10px] text-muted-foreground">{new Date(m.created_at).toLocaleString("pt-BR")}</div>
                        </div>
                        {failed && (m.error_message || m.error_code) && (
                          <pre className="text-[11px] text-destructive mt-1 whitespace-pre-wrap">
                            {m.error_code ? `[${m.error_code}] ` : ""}{m.error_message ?? "Falha no envio"}
                          </pre>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </div>
              <div>

                <div className="text-xs font-medium text-muted-foreground mb-2">Passos executados</div>
                {stepsQ.isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                {stepsQ.data?.length === 0 && <div className="text-xs text-muted-foreground">Nenhum passo registrado.</div>}
                <ol className="space-y-2">
                  {stepsQ.data?.map((s: any) => (
                    <li key={s.id} className="border rounded p-2">
                      <div className="flex items-center justify-between">
                        <div className="text-xs">
                          <span className="font-mono">{s.node_id}</span>
                          <Badge variant="outline" className="ml-2">{s.node_type}</Badge>
                        </div>
                        <div className="text-[10px] text-muted-foreground">{new Date(s.executed_at).toLocaleString("pt-BR")}</div>
                      </div>
                      {s.error && <pre className="text-[11px] text-destructive mt-1 whitespace-pre-wrap">{s.error}</pre>}
                      {s.payload && (
                        <pre className="text-[11px] bg-muted p-1 rounded mt-1 overflow-auto max-h-32">{JSON.stringify(s.payload, null, 2)}</pre>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <RunFlowViewerDialog
        open={flowOpen}
        onOpenChange={setFlowOpen}
        runId={selectedTarget?.run_id ?? null}
        automationId={(runQ.data as any)?.automation_id ?? null}
        runStatus={(runQ.data as any)?.status}
        currentNodeId={(runQ.data as any)?.current_node_id ?? null}
      />
    </div>
  );
}
