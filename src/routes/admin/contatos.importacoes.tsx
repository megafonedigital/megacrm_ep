import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Loader2, RefreshCw, X, FileText, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useActiveBrand } from "@/lib/active-brand";
import { listContactImports, getContactImportDetail, cancelContactImport } from "@/lib/contact-imports.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/admin/contatos/importacoes")({
  component: ImportacoesPage,
});

type ImportRow = {
  id: string;
  filename: string | null;
  total_rows: number;
  processed_rows: number;
  created_count: number;
  updated_count: number;
  skipped_count: number;
  error_count: number;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  created_at: string;
  update_existing: boolean;
};

function statusBadge(status: string) {
  const map: Record<string, { label: string; cls: string; icon: any }> = {
    queued: { label: "Na fila", cls: "bg-muted text-muted-foreground", icon: Clock },
    running: { label: "Processando", cls: "bg-blue-500/15 text-blue-700 dark:text-blue-300", icon: Loader2 },
    completed: { label: "Concluída", cls: "bg-green-500/15 text-green-700 dark:text-green-300", icon: CheckCircle2 },
    failed: { label: "Com erros", cls: "bg-destructive/15 text-destructive", icon: AlertTriangle },
    cancelled: { label: "Cancelada", cls: "bg-muted text-muted-foreground", icon: X },
  };
  const s = map[status] ?? map.queued;
  const Icon = s.icon;
  return (
    <Badge variant="secondary" className={s.cls}>
      <Icon className={`h-3 w-3 mr-1 ${status === "running" ? "animate-spin" : ""}`} />
      {s.label}
    </Badge>
  );
}

function ImportacoesPage() {
  const { activeBrandId } = useActiveBrand();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listFn = useServerFn(listContactImports);

  const listQ = useQuery({
    queryKey: ["contact-imports", activeBrandId],
    enabled: !!activeBrandId,
    queryFn: () => listFn({ data: { brandId: activeBrandId!, limit: 50 } }),
    refetchInterval: 5000,
  });

  // Realtime — refresca a lista quando algo muda
  useEffect(() => {
    if (!activeBrandId) return;
    const ch = supabase
      .channel(`imports-${activeBrandId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "contact_imports", filter: `brand_id=eq.${activeBrandId}` }, () => {
        qc.invalidateQueries({ queryKey: ["contact-imports", activeBrandId] });
        if (selectedId) qc.invalidateQueries({ queryKey: ["contact-import-detail", selectedId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [activeBrandId, qc, selectedId]);

  const imports = (listQ.data?.imports ?? []) as ImportRow[];

  return (
    <div className="page-container space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/admin/contatos" })}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Contatos
            </Button>
          </div>
          <h1 className="text-2xl font-semibold flex items-center gap-2 mt-2">
            <FileText className="h-6 w-6" /> Importações de contatos
          </h1>
          <p className="text-sm text-muted-foreground">
            Acompanhe o progresso, veja logs e identifique erros. Importações continuam rodando em segundo plano mesmo se você sair desta página.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => listQ.refetch()}>
          <RefreshCw className={`h-4 w-4 mr-2 ${listQ.isFetching ? "animate-spin" : ""}`} /> Atualizar
        </Button>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Arquivo</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[260px]">Progresso</TableHead>
              <TableHead className="text-right">Criados</TableHead>
              <TableHead className="text-right">Atualizados</TableHead>
              <TableHead className="text-right">Pulados</TableHead>
              <TableHead className="text-right">Erros</TableHead>
              <TableHead>Iniciada em</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQ.isLoading && (
              <TableRow><TableCell colSpan={8} className="text-center py-6"><Loader2 className="h-4 w-4 animate-spin inline" /></TableCell></TableRow>
            )}
            {!listQ.isLoading && imports.length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center py-10 text-sm text-muted-foreground">Nenhuma importação ainda.</TableCell></TableRow>
            )}
            {imports.map((imp) => {
              const pct = imp.total_rows > 0 ? Math.min(100, Math.round((imp.processed_rows / imp.total_rows) * 100)) : 0;
              return (
                <TableRow key={imp.id} className="cursor-pointer" onClick={() => setSelectedId(imp.id)}>
                  <TableCell className="font-medium truncate max-w-[280px]">{imp.filename ?? "(sem nome)"}</TableCell>
                  <TableCell>{statusBadge(imp.status)}</TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <Progress value={pct} className="h-2" />
                      <div className="text-xs text-muted-foreground">{imp.processed_rows.toLocaleString()} / {imp.total_rows.toLocaleString()} ({pct}%)</div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-sm">{imp.created_count.toLocaleString()}</TableCell>
                  <TableCell className="text-right text-sm">{imp.updated_count.toLocaleString()}</TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">{imp.skipped_count.toLocaleString()}</TableCell>
                  <TableCell className={`text-right text-sm ${imp.error_count > 0 ? "text-destructive font-medium" : "text-muted-foreground"}`}>{imp.error_count.toLocaleString()}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(imp.started_at ?? imp.created_at).toLocaleString("pt-BR")}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <ImportDetailSheet importId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}

function ImportDetailSheet({ importId, onClose }: { importId: string | null; onClose: () => void }) {
  const detailFn = useServerFn(getContactImportDetail);
  const cancelFn = useServerFn(cancelContactImport);
  const qc = useQueryClient();

  const detailQ = useQuery({
    queryKey: ["contact-import-detail", importId],
    enabled: !!importId,
    queryFn: () => detailFn({ data: { importId: importId! } }),
    refetchInterval: 4000,
  });

  const cancelMut = useMutation({
    mutationFn: () => cancelFn({ data: { importId: importId! } }),
    onSuccess: () => {
      toast.success("Importação cancelada.");
      qc.invalidateQueries({ queryKey: ["contact-import-detail", importId] });
      qc.invalidateQueries({ queryKey: ["contact-imports"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao cancelar"),
  });

  const imp = detailQ.data?.import as any;
  const logs = (detailQ.data?.logs ?? []) as Array<{ id: string; level: string; message: string; row_index: number | null; created_at: string }>;
  const canCancel = imp && (imp.status === "queued" || imp.status === "running");

  return (
    <Sheet open={!!importId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {imp?.filename ?? "Detalhes da importação"}
          </SheetTitle>
          <SheetDescription>
            {imp ? `${imp.total_rows.toLocaleString()} linhas · criada em ${new Date(imp.created_at).toLocaleString("pt-BR")}` : "Carregando…"}
          </SheetDescription>
        </SheetHeader>

        {imp && (
          <div className="space-y-4 mt-4 flex-1 min-h-0 flex flex-col">
            <div className="flex items-center gap-2">
              {statusBadge(imp.status)}
              {canCancel && (
                <Button variant="outline" size="sm" onClick={() => cancelMut.mutate()} disabled={cancelMut.isPending}>
                  <X className="h-3 w-3 mr-1" /> Cancelar
                </Button>
              )}
            </div>

            <div className="grid grid-cols-4 gap-2">
              <Stat label="Criados" value={imp.created_count} color="text-green-600" />
              <Stat label="Atualizados" value={imp.updated_count} color="text-blue-600" />
              <Stat label="Pulados" value={imp.skipped_count} color="text-muted-foreground" />
              <Stat label="Erros" value={imp.error_count} color={imp.error_count > 0 ? "text-destructive" : "text-muted-foreground"} />
            </div>

            <div>
              <Progress value={imp.total_rows > 0 ? Math.round((imp.processed_rows / imp.total_rows) * 100) : 0} className="h-2" />
              <div className="text-xs text-muted-foreground mt-1">
                {imp.processed_rows.toLocaleString()} / {imp.total_rows.toLocaleString()} processadas
              </div>
            </div>

            {imp.error_message && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {imp.error_message}
              </div>
            )}

            <div className="flex-1 min-h-0 flex flex-col">
              <div className="text-sm font-medium mb-2">Logs ({logs.length})</div>
              <ScrollArea className="flex-1 rounded-md border">
                <div className="p-2 font-mono text-xs space-y-1">
                  {logs.length === 0 && <div className="text-muted-foreground p-2">Sem logs ainda.</div>}
                  {logs.map((l) => (
                    <div key={l.id} className={`flex gap-2 ${l.level === "error" ? "text-destructive" : l.level === "warn" ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`}>
                      <span className="text-muted-foreground shrink-0">{new Date(l.created_at).toLocaleTimeString("pt-BR")}</span>
                      {l.row_index !== null && <span className="text-muted-foreground shrink-0">linha {l.row_index + 1}</span>}
                      <span className="break-all">{l.message}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </div>
        )}

        {!imp && detailQ.isLoading && (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-md border p-2 text-center">
      <div className={`text-xl font-semibold ${color}`}>{value.toLocaleString()}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
