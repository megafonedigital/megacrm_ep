import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  RefreshCw,
  UserPlus,
  Bot,
  AlertCircle,
  MessageSquare,
  Clock,
  StickyNote,
  CircleDot,
} from "lucide-react";
import { getConversationHistory } from "@/lib/conversation-history.functions";
import { supabase } from "@/integrations/supabase/client";

type Props = {
  conversationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const STATUS_LABEL: Record<string, string> = {
  aberto: "Aberto",
  pendente: "Pendente",
  resolvido: "Resolvido",
};

const BY_LABEL: Record<string, string> = {
  inbound_message: "mensagem do contato",
  agent_message: "envio do atendente",
  ai_agent_message: "envio do agente de IA",
  outbound_message: "envio outbound",
};

function describeEvent(type: string, payload: Record<string, any>, actor: string | null) {
  switch (type) {
    case "status_changed": {
      const from = STATUS_LABEL[payload.from as string] ?? payload.from ?? "—";
      const to = STATUS_LABEL[payload.to as string] ?? payload.to ?? "—";
      const by = payload.by ? BY_LABEL[payload.by as string] ?? String(payload.by) : null;
      if (by && !actor) {
        return {
          icon: <RefreshCw className="h-4 w-4 text-blue-500" />,
          title: `Reaberta automaticamente (${by})`,
          detail: `${from} → ${to}`,
        };
      }
      if (payload.to === "resolvido") {
        return {
          icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
          title: `Resolvida${actor ? ` por ${actor}` : ""}`,
          detail: `${from} → ${to}`,
        };
      }
      return {
        icon: <CircleDot className="h-4 w-4 text-muted-foreground" />,
        title: `Status alterado${actor ? ` por ${actor}` : ""}${by ? ` (${by})` : ""}`,
        detail: `${from} → ${to}`,
      };
    }
    case "assigned":
      return {
        icon: <UserPlus className="h-4 w-4 text-violet-500" />,
        title: `Atribuída${actor ? ` por ${actor}` : ""}`,
        detail: payload.to_name ? `→ ${payload.to_name}` : payload.to ? `→ ${payload.to}` : null,
      };
    case "unassigned":
      return {
        icon: <UserPlus className="h-4 w-4 text-muted-foreground" />,
        title: `Desatribuída${actor ? ` por ${actor}` : ""}`,
        detail: null,
      };
    case "ai_assigned":
      return {
        icon: <Bot className="h-4 w-4 text-indigo-500" />,
        title: "Agente de IA atribuído",
        detail: payload.agent_name ? String(payload.agent_name) : null,
      };
    case "note_added":
      return {
        icon: <StickyNote className="h-4 w-4 text-amber-500" />,
        title: `Nota interna${actor ? ` por ${actor}` : ""}`,
        detail: null,
      };
    case "window_expired":
      return {
        icon: <Clock className="h-4 w-4 text-destructive" />,
        title: "Janela de 24h expirou",
        detail: null,
      };
    case "escalated":
      return {
        icon: <AlertCircle className="h-4 w-4 text-orange-500" />,
        title: `Escalada${payload.track ? ` (${payload.track})` : ""}`,
        detail: payload.reason ? String(payload.reason) : null,
      };
    default:
      return {
        icon: <MessageSquare className="h-4 w-4 text-muted-foreground" />,
        title: type,
        detail: JSON.stringify(payload).slice(0, 100),
      };
  }
}

export function ConversationHistorySheet({ conversationId, open, onOpenChange }: Props) {
  const fetchHistory = useServerFn(getConversationHistory);
  const query = useQuery({
    queryKey: ["conversation-history", conversationId],
    queryFn: () => fetchHistory({ data: { conversationId } }),
    enabled: open && !!conversationId,
  });

  // Realtime: invalida quando novos eventos chegam
  useEffect(() => {
    if (!open || !conversationId) return;
    const ch = supabase
      .channel(`conv-history-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversation_events",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => query.refetch(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [open, conversationId, query]);

  const entries = query.data ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[420px] sm:max-w-[420px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            Histórico da conversa
            <Badge variant="outline" className="text-[10px]">
              admin/supervisor/dev
            </Badge>
          </SheetTitle>
          <SheetDescription>
            Tudo o que aconteceu nesta conversa: mudanças de status, atribuições, reaberturas automáticas e notas.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4">
          {query.isLoading && (
            <div className="text-sm text-muted-foreground">Carregando…</div>
          )}
          {query.error && (
            <div className="text-sm text-destructive">
              {(query.error as Error).message || "Falha ao carregar histórico"}
            </div>
          )}
          {!query.isLoading && entries.length === 0 && (
            <div className="text-sm text-muted-foreground">
              Nenhum evento registrado ainda nesta conversa.
            </div>
          )}
          <ol className="relative space-y-3 border-l border-border pl-4">
            {entries.map((e) => {
              const d = describeEvent(e.type, e.payload as Record<string, any>, e.actorName);
              const date = new Date(e.at);
              return (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[22px] top-1 flex h-4 w-4 items-center justify-center rounded-full bg-background">
                    {d.icon}
                  </span>
                  <div className="text-sm font-medium leading-tight">{d.title}</div>
                  {d.detail && (
                    <div className="mt-0.5 text-xs text-muted-foreground">{d.detail}</div>
                  )}
                  <div
                    className="mt-0.5 text-[11px] text-muted-foreground"
                    title={date.toLocaleString("pt-BR")}
                  >
                    {date.toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </SheetContent>
    </Sheet>
  );
}
