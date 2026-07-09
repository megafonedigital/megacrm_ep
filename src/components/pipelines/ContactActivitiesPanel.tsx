import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Send, SkipForward, MessageSquare, FileText, MoveRight, CheckCircle2, AlertCircle, Clock, RotateCw,
} from "lucide-react";
import { toast } from "sonner";
import {
  listContactActivities, executeActivityNow, skipActivity,
} from "@/lib/pipeline-activities.functions";

export function ContactActivitiesPanel({
  contactId, brandId,
}: {
  contactId: string;
  brandId: string;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(listContactActivities);
  const execFn = useServerFn(executeActivityNow);
  const skipFn = useServerFn(skipActivity);

  const { data, isLoading } = useQuery({
    queryKey: ["contact-activities", contactId, brandId, "current-stage"],
    enabled: !!contactId && !!brandId,
    queryFn: () => listFn({ data: { contactId, brandId, currentStageOnly: true } }),
    refetchInterval: 15000,
  });

  const payload = (data ?? {}) as { items?: any[]; currentStageName?: string | null };
  const items = (payload.items ?? []) as any[];
  const stageName = payload.currentStageName ?? null;

  const sorted = [...items].sort((a, b) => {
    const ap = a.status === "pending" ? 0 : 1;
    const bp = b.status === "pending" ? 0 : 1;
    if (ap !== bp) return ap - bp;
    if (ap === 0) {
      return new Date(a.due_at ?? 0).getTime() - new Date(b.due_at ?? 0).getTime();
    }
    return new Date(b.executed_at ?? b.due_at ?? 0).getTime() - new Date(a.executed_at ?? a.due_at ?? 0).getTime();
  });
  const pendingCount = items.filter((a) => a.status === "pending").length;

  async function execute(id: string) {
    try {
      await execFn({ data: { id } });
      toast.success("Atividade executada");
      qc.invalidateQueries({ queryKey: ["contact-activities", contactId, brandId] });
      qc.invalidateQueries({ queryKey: ["pipeline-activity-counts"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao executar");
    }
  }
  async function skip(id: string) {
    try {
      await skipFn({ data: { id } });
      qc.invalidateQueries({ queryKey: ["contact-activities", contactId, brandId] });
      qc.invalidateQueries({ queryKey: ["pipeline-activity-counts"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao pular");
    }
  }

  return (
    <div className="flex h-full w-80 flex-col border-l border-border bg-muted/20">
      <div className="border-b border-border bg-background px-3 py-2">
        <div className="text-sm font-semibold">
          Atividades{stageName ? ` — ${stageName}` : ""}
        </div>
        <div className="text-xs text-muted-foreground">
          {pendingCount} pendente{pendingCount === 1 ? "" : "s"} · {items.length} no total
        </div>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            Nenhuma atividade configurada para esta etapa.
          </div>
        ) : (
          sorted.map((a) => (
            <ActivityItem
              key={a.id}
              a={a}
              onExecute={a.status === "pending" || a.status === "failed" ? () => execute(a.id) : undefined}
              onSkip={a.status === "pending" || a.status === "failed" ? () => skip(a.id) : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ActivityItem({
  a, onExecute, onSkip,
}: {
  a: any;
  onExecute?: () => void;
  onSkip?: () => void;
}) {
  const isPending = a.status === "pending";
  const due = a.due_at ? new Date(a.due_at) : null;
  const overdue = isPending && due && due.getTime() <= Date.now();

  const statusBadge = (() => {
    switch (a.status) {
      case "pending":
        return (
          <Badge variant={overdue ? "destructive" : "secondary"} className="text-[10px]">
            <Clock className="mr-1 h-3 w-3" />
            {overdue ? "Vencida" : "Pendente"}
          </Badge>
        );
      case "done":
        return (
          <Badge variant="default" className="bg-emerald-600 text-[10px] hover:bg-emerald-600">
            <CheckCircle2 className="mr-1 h-3 w-3" /> Enviada
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="destructive" className="text-[10px]">
            <AlertCircle className="mr-1 h-3 w-3" /> Falhou
          </Badge>
        );
      case "cancelled":
        return <Badge variant="outline" className="text-[10px]">Cancelada</Badge>;
      case "skipped":
        return <Badge variant="outline" className="text-[10px]">Pulada</Badge>;
      default:
        return <Badge variant="outline" className="text-[10px]">{a.status}</Badge>;
    }
  })();

  return (
    <div className="rounded-md border border-border bg-background p-2.5 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            {a.kind === "send_template" ? (
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
            ) : a.kind === "move_stage" ? (
              <MoveRight className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span className="truncate">{a.name}</span>
          </div>
          {a.stage?.name && (
            <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: a.stage.color ?? "#94a3b8" }}
              />
              {a.stage.name}
              {a.mode === "manual" && <span className="ml-1">· manual</span>}
            </div>
          )}
        </div>
        {statusBadge}
      </div>

      {a.kind === "send_message" && a.message_text && (
        <div className="line-clamp-3 rounded bg-muted/50 p-1.5 text-xs text-muted-foreground">
          {a.message_text}
        </div>
      )}

      {a.kind === "move_stage" && a.target_stage?.name && (
        <div className="flex items-center gap-1.5 rounded bg-muted/50 p-1.5 text-xs text-muted-foreground">
          <MoveRight className="h-3 w-3" />
          <span>Mover para</span>
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: a.target_stage.color ?? "#94a3b8" }}
          />
          <span className="font-medium text-foreground">{a.target_stage.name}</span>
        </div>
      )}

      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          {isPending && due ? (
            <>Para: {due.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</>
          ) : a.executed_at ? (
            <>Em: {new Date(a.executed_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</>
          ) : null}
        </span>
        {a.error_message && (
          <span className="ml-2 truncate text-destructive" title={a.error_message}>
            {a.error_message}
          </span>
        )}
      </div>

      {isPending && onExecute && onSkip && (
        <div className="flex gap-1.5">
          <Button size="sm" className="h-7 flex-1 text-xs" onClick={onExecute}>
            <Send className="mr-1 h-3 w-3" /> Executar
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onSkip}>
            <SkipForward className="mr-1 h-3 w-3" /> Pular
          </Button>
        </div>
      )}

      {a.status === "failed" && onExecute && onSkip && (
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" className="h-7 flex-1 text-xs" onClick={onExecute}>
            <RotateCw className="mr-1 h-3 w-3" /> Reenviar
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onSkip}>
            <SkipForward className="mr-1 h-3 w-3" /> Pular
          </Button>
        </div>
      )}
    </div>
  );
}
