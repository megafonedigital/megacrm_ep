import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Brain } from "lucide-react";
import { listContactMemory } from "@/lib/ellie-memory.functions";

const CATEGORY_LABEL: Record<string, string> = {
  identity: "Identidade",
  preference: "Preferências",
  pain: "Dores",
  goal: "Objetivos",
  restriction: "Restrições",
  history: "Histórico",
  other: "Outros",
};

type Memory = { id: string; key: string; value: string; category: string };

export function EllieMemoryPanel({ agentId, contactId }: { agentId: string | null; contactId: string | null }) {
  const listFn = useServerFn(listContactMemory);
  const { data, isLoading } = useQuery({
    queryKey: ["inbox-memory", agentId, contactId],
    queryFn: () => listFn({ data: { agentId: agentId!, contactId: contactId! } }),
    enabled: !!agentId && !!contactId,
    staleTime: 30_000,
  });

  if (!agentId || !contactId) {
    return <span className="text-xs text-muted-foreground">Sem agente vinculado.</span>;
  }
  if (isLoading) return <span className="text-xs text-muted-foreground">Carregando…</span>;

  const items = (data?.items ?? []) as Memory[];
  if (items.length === 0) {
    return <span className="text-xs text-muted-foreground">A IA ainda não conhece este contato.</span>;
  }

  const grouped = new Map<string, Memory[]>();
  for (const m of items) {
    const cat = CATEGORY_LABEL[m.category] ? m.category : "other";
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(m);
  }

  return (
    <div className="space-y-2">
      {Array.from(grouped.entries()).map(([cat, list]) => (
        <div key={cat}>
          <div className="flex items-center gap-1 text-[10px] uppercase font-semibold text-muted-foreground mb-1">
            <Brain className="h-3 w-3" /> {CATEGORY_LABEL[cat] ?? cat}
          </div>
          <ul className="space-y-1 text-xs">
            {list.map((m) => (
              <li key={m.id} className="leading-snug">
                <span className="text-muted-foreground">{m.key}:</span> {m.value}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
