import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, MessageSquare } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  listCopilotThreads,
  createCopilotThread,
  deleteCopilotThread,
} from "@/lib/copilot-threads.functions";

interface Props {
  brandId: string;
  activeThreadId: string | null;
  onSelect: (id: string) => void;
}

export function ThreadList({ brandId, activeThreadId, onSelect }: Props) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["copilot-threads", brandId],
    queryFn: () => listCopilotThreads({ data: { brandId } }),
  });

  const createM = useMutation({
    mutationFn: () => createCopilotThread({ data: { brandId } }),
    onSuccess: (row: any) => {
      qc.invalidateQueries({ queryKey: ["copilot-threads", brandId] });
      onSelect(row.id);
    },
  });

  const deleteM = useMutation({
    mutationFn: (threadId: string) => deleteCopilotThread({ data: { threadId } }),
    onSuccess: (_data, threadId) => {
      qc.invalidateQueries({ queryKey: ["copilot-threads", brandId] });
      if (activeThreadId === threadId) onSelect("");
    },
  });

  const threads = q.data ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-2">
        <Button
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => createM.mutate()}
          disabled={createM.isPending}
        >
          <Plus className="h-4 w-4" />
          Nova conversa
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {threads.length === 0 && !q.isLoading && (
          <div className="p-4 text-center text-xs text-muted-foreground">Nenhuma conversa ainda.</div>
        )}
        {threads.map((t: any) => (
          <div
            key={t.id}
            className={cn(
              "group flex items-start gap-2 border-b border-border/60 px-3 py-2 text-sm",
              activeThreadId === t.id ? "bg-accent" : "hover:bg-accent/40",
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(t.id)}
              className="flex min-w-0 flex-1 items-start gap-2 text-left"
            >
              <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-foreground">{t.title}</div>
                <div className="truncate text-[10px] text-muted-foreground">
                  {formatDistanceToNow(new Date(t.last_message_at), { addSuffix: true, locale: ptBR })}
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm("Apagar esta conversa?")) deleteM.mutate(t.id);
              }}
              className="opacity-0 transition group-hover:opacity-100"
              title="Apagar"
            >
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
