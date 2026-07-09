import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Loader2, Workflow, ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/auth";
import { useActiveBrand } from "@/lib/active-brand";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ContactFilterCombobox } from "@/components/contacts/ContactFilterCombobox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AgentRunsTable } from "@/components/agents/AgentRunsTable";
import { RunFlowViewerDialog } from "@/components/automations/RunFlowViewerDialog";

export const Route = createFileRoute("/admin/automacoes/runs")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  component: AutomationRunsPage,
});

function statusBadge(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "failed") return "destructive";
  if (status === "completed") return "default";
  if (status === "waiting") return "secondary";
  return "outline";
}

function AutomationRunsPage() {
  const { me } = useMe();
  const { activeBrandId } = useActiveBrand();
  const [statusFilter, setStatusFilter] = useState("all");
  const [autoFilter, setAutoFilter] = useState("all");
  const [contactId, setContactId] = useState<string | null>(null);
  const [selected, setSelected] = useState<any | null>(null);
  const [flowOpen, setFlowOpen] = useState(false);
  const [pageSize, setPageSize] = useState<number>(25);
  const [page, setPage] = useState<number>(1);

  // Reset page on filter change
  useEffect(() => { setPage(1); }, [activeBrandId, statusFilter, autoFilter, contactId, pageSize]);

  const automationsQ = useQuery({
    queryKey: ["automations-runs-filter", activeBrandId],
    enabled: !!activeBrandId,
    queryFn: async () => (await supabase.from("automations").select("id, name").eq("brand_id", activeBrandId!).order("name")).data ?? [],
  });

  const runsQ = useQuery({
    queryKey: ["automation-runs", activeBrandId, statusFilter, autoFilter, contactId, page, pageSize],
    enabled: !!activeBrandId,
    queryFn: async () => {
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      let q = supabase
        .from("automation_runs")
        .select("id, started_at, finished_at, status, current_node_id, last_error, automation_id, contact_id, brand_id, automations:automation_id(name), contacts:contact_id(name, phone, wa_id)")
        .eq("brand_id", activeBrandId!)
        .order("started_at", { ascending: false })
        .range(from, to);
      if (statusFilter !== "all") q = q.eq("status", statusFilter as any);
      if (autoFilter !== "all") q = q.eq("automation_id", autoFilter);
      if (contactId) q = q.eq("contact_id", contactId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 10_000,
  });

  // Total exato em query separada (padrão da aba Contatos): não bloqueia
  // a tabela. head:true + count:exact retorna só o total.
  const runsCountQ = useQuery({
    queryKey: ["automation-runs-count", activeBrandId, statusFilter, autoFilter, contactId],
    enabled: !!activeBrandId,
    staleTime: 60_000,
    queryFn: async () => {
      let q = supabase
        .from("automation_runs")
        .select("id", { count: "exact", head: true })
        .eq("brand_id", activeBrandId!);
      if (statusFilter !== "all") q = q.eq("status", statusFilter as any);
      if (autoFilter !== "all") q = q.eq("automation_id", autoFilter);
      if (contactId) q = q.eq("contact_id", contactId);
      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    },
  });

  const rows = runsQ.data ?? [];
  const total = runsCountQ.data ?? null;
  const totalPages = total != null
    ? Math.max(1, Math.ceil(total / pageSize))
    : page + (rows.length === pageSize ? 1 : 0);

  const stepsQ = useQuery({
    queryKey: ["automation-run-steps", selected?.id],
    enabled: !!selected?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("automation_run_steps")
        .select("id, executed_at, node_id, node_type, payload, error")
        .eq("run_id", selected.id)
        .order("executed_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  if (!me?.isAdmin && !me?.isSupervisor && !me?.isDeveloper) {
    return <div className="p-6 text-sm text-muted-foreground">Acesso restrito.</div>;
  }

  return (
    <div className="page-container space-y-4">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Activity className="h-6 w-6" /> Execuções de Automações
        </h1>
        <p className="text-sm text-muted-foreground">Histórico de runs com timeline de cada nó executado (atualiza a cada 10s).</p>
      </div>

      {!activeBrandId && (
        <Card className="p-6 text-sm text-muted-foreground">Selecione um workspace no topo para ver as execuções.</Card>
      )}
      {activeBrandId && (<>
      <div className="flex gap-2 flex-wrap">
        <Select value={autoFilter} onValueChange={setAutoFilter}>
          <SelectTrigger className="w-[260px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as automações</SelectItem>
            {automationsQ.data?.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Status</SelectItem>
            <SelectItem value="waiting">waiting</SelectItem>
            <SelectItem value="running">running</SelectItem>
            <SelectItem value="completed">completed</SelectItem>
            <SelectItem value="failed">failed</SelectItem>
          </SelectContent>
        </Select>
        <ContactFilterCombobox value={contactId} onChange={setContactId} brandId={activeBrandId} />
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Início</TableHead>
              <TableHead>Automação</TableHead>
              <TableHead>Contato</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Nó atual</TableHead>
              <TableHead>Erro</TableHead>
              <TableHead className="text-right">Duração</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runsQ.isLoading && <TableRow><TableCell colSpan={7} className="text-center py-6"><Loader2 className="h-4 w-4 animate-spin inline" /></TableCell></TableRow>}
            {!runsQ.isLoading && rows.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-10 text-sm text-muted-foreground">Nenhuma execução ainda.</TableCell></TableRow>}
            {rows.map((r: any) => {
              const dur = r.finished_at ? Math.round((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000) : null;
              return (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => setSelected(r)}>
                  <TableCell className="text-xs whitespace-nowrap">{new Date(r.started_at).toLocaleString("pt-BR")}</TableCell>
                  <TableCell className="text-sm">{r.automations?.name ?? "—"}</TableCell>
                  <TableCell className="text-xs">{r.contacts?.name ?? r.contacts?.phone ?? r.contacts?.wa_id ?? "—"}</TableCell>
                  <TableCell><Badge variant={statusBadge(r.status)}>{r.status}</Badge></TableCell>
                  <TableCell className="text-xs font-mono">{r.current_node_id ?? "—"}</TableCell>
                  <TableCell className="text-xs text-destructive max-w-[240px] truncate">{r.last_error ?? ""}</TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">{dur != null ? `${dur}s` : "—"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Linhas por página:</span>
          <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
            <SelectTrigger className="h-8 w-[80px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="25">25</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
              <SelectItem value="200">200</SelectItem>
            </SelectContent>
          </Select>
          <span>
            {total != null
              ? (total > 0 ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} de ${total}` : "0 resultados")
              : (rows.length > 0 ? `${(page - 1) * pageSize + 1}–${(page - 1) * pageSize + rows.length}` : "—")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1 || runsQ.isLoading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            <ChevronLeft className="h-4 w-4" /> Anterior
          </Button>
          <span className="text-xs text-muted-foreground">Página {page}{total != null ? ` de ${totalPages}` : ""}</span>
          <Button variant="outline" size="sm" disabled={runsQ.isLoading || (total != null ? page >= totalPages : rows.length < pageSize)} onClick={() => setPage((p) => p + 1)}>
            Próxima <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>



      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-[680px] sm:max-w-[680px] overflow-y-auto">
          <SheetHeader>
            <div className="flex items-center justify-between gap-2 pr-8">
              <SheetTitle>Timeline da execução</SheetTitle>
              <Button size="sm" variant="outline" onClick={() => setFlowOpen(true)} disabled={!selected}>
                <Workflow className="h-4 w-4 mr-1.5" /> Ver no fluxo
              </Button>
            </div>
          </SheetHeader>
          {selected && (
            <div className="space-y-4 mt-4 text-sm">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div><div className="font-medium text-muted-foreground">Automação</div><div>{selected.automations?.name}</div></div>
                <div><div className="font-medium text-muted-foreground">Status</div><Badge variant={statusBadge(selected.status)}>{selected.status}</Badge></div>
                <div><div className="font-medium text-muted-foreground">Início</div><div>{new Date(selected.started_at).toLocaleString("pt-BR")}</div></div>
                <div><div className="font-medium text-muted-foreground">Fim</div><div>{selected.finished_at ? new Date(selected.finished_at).toLocaleString("pt-BR") : "—"}</div></div>
              </div>
              {selected.last_error && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">Último erro</div>
                  <pre className="bg-destructive/10 text-destructive p-2 rounded text-xs whitespace-pre-wrap">{selected.last_error}</pre>
                </div>
              )}
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
              <Button variant="outline" onClick={() => setSelected(null)}>Fechar</Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <RunFlowViewerDialog
        open={flowOpen}
        onOpenChange={setFlowOpen}
        runId={selected?.id ?? null}
        automationId={selected?.automation_id ?? null}
        runStatus={selected?.status}
        currentNodeId={selected?.current_node_id ?? null}
      />
      </>)}
    </div>
  );
}
