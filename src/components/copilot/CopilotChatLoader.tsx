import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { type UIMessage } from "ai";
import { getCopilotMessages } from "@/lib/copilot-threads.functions";
import { CopilotChat } from "./CopilotChat";

interface Props {
  threadId: string;
  brandId: string;
  onTitleChange?: () => void;
}

export function CopilotChatLoader({ threadId, brandId, onTitleChange }: Props) {
  const q = useQuery({
    queryKey: ["copilot-messages", threadId],
    queryFn: () => getCopilotMessages({ data: { threadId } }),
  });

  if (q.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (q.error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm">
        <p className="text-destructive">Não foi possível carregar o histórico desta conversa.</p>
        <p className="text-muted-foreground">{(q.error as Error).message}</p>
        <button
          onClick={() => q.refetch()}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  const initial: UIMessage[] = (q.data ?? []).map((m: any) => ({
    id: m.id,
    role: m.role,
    parts: m.parts ?? [],
  }));

  return (
    <CopilotChat
      key={threadId}
      threadId={threadId}
      brandId={brandId}
      initialMessages={initial}
      onTitleChange={onTitleChange}
    />
  );
}
