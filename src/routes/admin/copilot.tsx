import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveBrand } from "@/lib/active-brand";
import { useMe } from "@/lib/auth";
import { ThreadList } from "@/components/copilot/ThreadList";
import { CopilotChatLoader } from "@/components/copilot/CopilotChatLoader";
import { createCopilotThread, listCopilotThreads } from "@/lib/copilot-threads.functions";
import { Bot, Loader2 } from "lucide-react";

export const Route = createFileRoute("/admin/copilot")({
  component: CopilotPage,
});

function lastThreadStorageKey(userId: string, brandId: string) {
  return `megacrm:copilot:lastThread:${userId}:${brandId}`;
}

function CopilotPage() {
  const { me, loading } = useMe();
  const { activeBrandId } = useActiveBrand();
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const qc = useQueryClient();

  const allowed = !!(me?.isAdmin || me?.isSupervisor || me?.isDeveloper);
  const userId = me?.userId ?? null;

  const threadsQ = useQuery({
    queryKey: ["copilot-threads", activeBrandId],
    queryFn: () => listCopilotThreads({ data: { brandId: activeBrandId! } }),
    enabled: !!activeBrandId && allowed,
  });

  const createM = useMutation({
    mutationFn: () => createCopilotThread({ data: { brandId: activeBrandId! } }),
    onSuccess: (row: any) => {
      qc.invalidateQueries({ queryKey: ["copilot-threads", activeBrandId] });
      selectThread(row.id);
    },
  });

  const selectThread = (id: string | null) => {
    setActiveThreadId(id);
    if (!userId || !activeBrandId) return;
    try {
      if (id) localStorage.setItem(lastThreadStorageKey(userId, activeBrandId), id);
      else localStorage.removeItem(lastThreadStorageKey(userId, activeBrandId));
    } catch {
      /* ignore */
    }
  };

  // Restaura a última conversa do usuário neste workspace ao abrir a página.
  useEffect(() => {
    if (!userId || !activeBrandId) return;
    if (activeThreadId) return;
    if (threadsQ.isLoading || !threadsQ.data) return;

    const threads = threadsQ.data as Array<{ id: string }>;
    if (threads.length === 0) return;

    let restored: string | null = null;
    try {
      restored = localStorage.getItem(lastThreadStorageKey(userId, activeBrandId));
    } catch {
      restored = null;
    }
    const exists = restored && threads.some((t) => t.id === restored);
    setActiveThreadId(exists ? restored! : threads[0].id);
  }, [userId, activeBrandId, threadsQ.isLoading, threadsQ.data, activeThreadId]);

  // Se a thread ativa for apagada, cai para a próxima mais recente.
  useEffect(() => {
    if (!activeThreadId || !threadsQ.data) return;
    const exists = (threadsQ.data as Array<{ id: string }>).some((t) => t.id === activeThreadId);
    if (!exists) selectThread(null);
  }, [activeThreadId, threadsQ.data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return null;
  if (!allowed) {
    return <div className="p-6 text-sm text-muted-foreground">Acesso restrito.</div>;
  }
  if (!activeBrandId) {
    return <div className="p-6 text-sm text-muted-foreground">Selecione um workspace.</div>;
  }

  const threads = (threadsQ.data ?? []) as Array<{ id: string }>;
  const noThreads = !threadsQ.isLoading && threads.length === 0;

  return (
    <div className="flex h-[calc(100vh-3rem)] w-full">
      <aside className="hidden w-72 shrink-0 flex-col border-r border-border bg-card md:flex">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Bot className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Copilot</span>
        </div>
        <ThreadList
          brandId={activeBrandId}
          activeThreadId={activeThreadId}
          onSelect={(id) => selectThread(id || null)}
        />
      </aside>
      <section className="flex min-w-0 flex-1 flex-col bg-background">
        {activeThreadId ? (
          <CopilotChatLoader
            threadId={activeThreadId}
            brandId={activeBrandId}
            onTitleChange={() => qc.invalidateQueries({ queryKey: ["copilot-threads", activeBrandId] })}
          />
        ) : threadsQ.isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : noThreads ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <Bot className="h-10 w-10 text-primary" />
            <div className="text-sm text-muted-foreground">
              Você ainda não tem conversas neste workspace. Crie uma para começar.
            </div>
            <button
              onClick={() => createM.mutate()}
              disabled={createM.isPending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Nova conversa
            </button>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <Bot className="h-10 w-10 text-primary" />
            <div className="text-sm text-muted-foreground">
              Selecione uma conversa ou crie uma nova para começar.
            </div>
            <button
              onClick={() => createM.mutate()}
              disabled={createM.isPending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Nova conversa
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
