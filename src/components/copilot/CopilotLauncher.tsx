import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { Bot, Plus, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useMe } from "@/lib/auth";
import { useActiveBrand } from "@/lib/active-brand";
import {
  listCopilotThreads,
  createCopilotThread,
} from "@/lib/copilot-threads.functions";
import { CopilotChatLoader } from "./CopilotChatLoader";

const HIDDEN_PREFIXES = ["/login", "/cadastro", "/definir-senha", "/admin/copilot"];

export function CopilotLauncher() {
  const { me } = useMe();
  const { activeBrandId } = useActiveBrand();
  const path = useRouterState({ select: (r) => r.location.pathname });
  const [open, setOpen] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const qc = useQueryClient();

  const allowed = !!(me?.isAdmin || me?.isSupervisor || me?.isDeveloper);
  const hidden = HIDDEN_PREFIXES.some((p) => path.startsWith(p));

  const threadsQ = useQuery({
    queryKey: ["copilot-threads", activeBrandId],
    queryFn: () => listCopilotThreads({ data: { brandId: activeBrandId! } }),
    enabled: open && !!activeBrandId,
  });

  const createM = useMutation({
    mutationFn: () => createCopilotThread({ data: { brandId: activeBrandId! } }),
    onSuccess: (row: any) => {
      qc.invalidateQueries({ queryKey: ["copilot-threads", activeBrandId] });
      setActiveThreadId(row.id);
    },
  });

  // pick most recent or create when opening
  const handleOpenChange = async (next: boolean) => {
    setOpen(next);
    if (next && !activeThreadId && activeBrandId) {
      const threads = threadsQ.data;
      if (threads && threads.length > 0) {
        setActiveThreadId((threads[0] as any).id);
      } else {
        createM.mutate();
      }
    }
  };

  if (!allowed || hidden || !activeBrandId) return null;

  return (
    <>
      <button
        onClick={() => handleOpenChange(true)}
        className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-1 ring-primary/30 transition hover:scale-105 hover:shadow-xl"
        title="Abrir Copilot"
        aria-label="Abrir Copilot"
      >
        <Bot className="h-5 w-5" />
      </button>

      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent
          side="right"
          className="flex w-full max-w-md flex-col gap-0 p-0 sm:max-w-md md:max-w-lg"
        >
          <SheetHeader className="flex flex-row items-center justify-between gap-2 border-b border-border px-3 py-2 space-y-0">
            <SheetTitle className="flex items-center gap-2 text-sm">
              <Bot className="h-4 w-4 text-primary" />
              Copilot
            </SheetTitle>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => createM.mutate()}
                disabled={createM.isPending}
                className="h-7 gap-1 text-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                Nova
              </Button>
            </div>
          </SheetHeader>
          <div className="flex-1 min-h-0 overflow-hidden">
            {activeThreadId ? (
              <CopilotChatLoader threadId={activeThreadId} brandId={activeBrandId} />
            ) : (
              <div className="flex h-full items-center justify-center p-4 text-xs text-muted-foreground">
                Carregando…
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
