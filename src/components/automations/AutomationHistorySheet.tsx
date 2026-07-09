import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, History, Eye, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDuration } from "@/lib/format-duration";
import { RunFlowViewerDialog } from "./RunFlowViewerDialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  automationId: string;
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  completed: "default",
  running: "secondary",
  waiting: "secondary",
  sleeping: "secondary",
  waiting_button: "secondary",
  failed: "destructive",
  cancelled: "outline",
};

const STATUS_LABEL: Record<string, string> = {
  completed: "Concluído",
  running: "Em execução",
  waiting: "Aguardando",
  sleeping: "Aguardando",
  waiting_button: "Aguardando botão",
  failed: "Falhou",
  cancelled: "Cancelado",
};

export function AutomationHistorySheet({ open, onOpenChange, automationId }: Props) {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedRun, setSelectedRun] = useState<{ id: string; status: string; currentNodeId: string | null } | null>(null);

  const runsQ = useQuery({
    queryKey: ["automation-history", automationId, statusFilter],
    enabled: open && !!automationId,
    queryFn: async () => {
      let q = supabase
        .from("automation_runs")
        .select("id, status, started_at, finished_at, updated_at, current_node_id, last_error, contact:contact_id(id, name, phone, wa_id)")
        .eq("automation_id", automationId)
        .order("started_at", { ascending: false })
        .limit(100);
      if (statusFilter !== "all") q = q.eq("status", statusFilter as any);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    const rows = runsQ.data ?? [];
    if (!search.trim()) return rows;
    const s = search.toLowerCase();
    return rows.filter((r: any) => {
      const c = r.contact;
      return (
        c?.name?.toLowerCase().includes(s) ||
        c?.phone?.toLowerCase().includes(s) ||
        c?.wa_id?.toLowerCase().includes(s) ||
        r.id.toLowerCase().includes(s)
      );
    });
  }, [runsQ.data, search]);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-2xl p-0 flex flex-col">
          <SheetHeader className="px-6 pt-6 pb-3 border-b">
            <SheetTitle className="flex items-center gap-2">
              <History className="h-5 w-5" /> Histórico de execuções
            </SheetTitle>
            <SheetDescription>Últimas 100 execuções desta automação.</SheetDescription>
          </SheetHeader>

          <div className="px-6 py-3 border-b flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome, telefone ou ID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[170px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                <SelectItem value="completed">Concluído</SelectItem>
                <SelectItem value="running">Em execução</SelectItem>
                <SelectItem value="waiting">Aguardando</SelectItem>
                <SelectItem value="waiting_button">Aguardando botão</SelectItem>
                <SelectItem value="failed">Falhou</SelectItem>
                <SelectItem value="cancelled">Cancelado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1 overflow-y-auto">
            {runsQ.isLoading ? (
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando...
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                Nenhuma execução encontrada.
              </div>
            ) : (
              <ul className="divide-y">
                {filtered.map((r: any) => {
                  const c = r.contact;
                  const variant = STATUS_VARIANT[r.status] ?? "outline";
                  return (
                    <li key={r.id} className="px-6 py-3 flex items-center gap-3 hover:bg-muted/30">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-medium truncate text-sm">
                            {c?.name || c?.phone || c?.wa_id || "Sem contato"}
                          </span>
                          <Badge variant={variant} className="text-[10px]">
                            {STATUS_LABEL[r.status] ?? r.status}
                          </Badge>
                        </div>
                        <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
                          <span>{new Date(r.started_at).toLocaleString("pt-BR")}</span>
                          <span>•</span>
                          <span>{formatDuration(r.started_at, r.finished_at)}</span>
                          {r.last_error && (
                            <>
                              <span>•</span>
                              <span className="text-destructive truncate max-w-[200px]" title={r.last_error}>
                                {r.last_error}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setSelectedRun({ id: r.id, status: r.status, currentNodeId: r.current_node_id })
                        }
                      >
                        <Eye className="h-3.5 w-3.5 mr-1" /> Ver fluxo
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <RunFlowViewerDialog
        open={!!selectedRun}
        onOpenChange={(o) => !o && setSelectedRun(null)}
        runId={selectedRun?.id ?? null}
        automationId={automationId}
        runStatus={selectedRun?.status}
        currentNodeId={selectedRun?.currentNodeId ?? null}
      />
    </>
  );
}
