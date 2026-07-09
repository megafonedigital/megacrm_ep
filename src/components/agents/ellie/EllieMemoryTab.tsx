import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Brain, Loader2, Search, Trash2, Pencil, Save, X } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  listContactMemory,
  searchContactsForMemory,
  updateContactMemory,
  deleteContactMemory,
  clearContactMemory,
  setLongTermMemoryEnabled,
} from "@/lib/ellie-memory.functions";

const CATEGORY_LABEL: Record<string, string> = {
  identity: "Identidade",
  preference: "Preferências",
  pain: "Dores",
  goal: "Objetivos",
  restriction: "Restrições",
  history: "Histórico",
  other: "Outros",
};

type Agent = { id: string; long_term_memory_enabled?: boolean | null };
type Contact = { id: string; name: string | null; wa_id: string | null; phone: string | null };
type Memory = {
  id: string;
  key: string;
  value: string;
  category: string;
  confidence: number;
  last_mentioned_at: string;
  updated_at: string;
};

export function EllieMemoryTab({ agentId, agent, onSaved }: { agentId: string; agent: Agent; onSaved?: () => void }) {
  const qc = useQueryClient();
  const searchFn = useServerFn(searchContactsForMemory);
  const listFn = useServerFn(listContactMemory);
  const updFn = useServerFn(updateContactMemory);
  const delFn = useServerFn(deleteContactMemory);
  const clearFn = useServerFn(clearContactMemory);
  const toggleFn = useServerFn(setLongTermMemoryEnabled);

  const [enabled, setEnabled] = useState(!!agent.long_term_memory_enabled);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Contact | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");

  const contactsQuery = useQuery({
    queryKey: ["ellie-memory-contacts", agentId, q],
    queryFn: () => searchFn({ data: { agentId, q } }),
  });

  const memoriesQuery = useQuery({
    queryKey: ["ellie-memory-list", agentId, selected?.id],
    queryFn: () => listFn({ data: { agentId, contactId: selected!.id } }),
    enabled: !!selected,
  });

  const grouped = useMemo(() => {
    const items = (memoriesQuery.data?.items ?? []) as Memory[];
    const map = new Map<string, Memory[]>();
    for (const m of items) {
      const k = CATEGORY_LABEL[m.category] ? m.category : "other";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(m);
    }
    return map;
  }, [memoriesQuery.data]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["ellie-memory-list", agentId] });

  const onToggleEnabled = async (v: boolean) => {
    setEnabled(v);
    try {
      await toggleFn({ data: { agentId, enabled: v } });
      toast.success(v ? "Memória de longo prazo ligada" : "Memória de longo prazo desligada");
      onSaved?.();
    } catch (e: any) {
      setEnabled(!v);
      toast.error(e?.message ?? "Erro ao atualizar");
    }
  };

  const onSaveEdit = async (m: Memory) => {
    if (!editingValue.trim()) return;
    try {
      await updFn({ data: { id: m.id, agentId, value: editingValue.trim() } });
      setEditingId(null);
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Erro");
    }
  };

  const onDelete = async (m: Memory) => {
    if (!confirm(`Esquecer "${m.key}"?`)) return;
    await delFn({ data: { id: m.id, agentId } });
    refresh();
  };

  const onClearAll = async () => {
    if (!selected) return;
    if (!confirm(`Apagar TODA a memória deste contato? Esta ação não pode ser desfeita.`)) return;
    await clearFn({ data: { agentId, contactId: selected.id } });
    toast.success("Memória limpa");
    refresh();
  };

  const contacts = (contactsQuery.data?.items ?? []) as Contact[];

  return (
    <div className="space-y-4">
      <Card className="p-4 flex items-center gap-4">
        <Brain className="h-5 w-5 text-primary" />
        <div className="flex-1">
          <div className="font-semibold">Memória de longo prazo por contato</div>
          <p className="text-xs text-muted-foreground">
            A Ellie consolida fatos estáveis (nome, gostos, dores, objetivos) sobre cada contato e usa
            naturalmente nas conversas. Limite de 80 lembranças por contato — as menos confiáveis são
            removidas automaticamente quando excede.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm whitespace-nowrap">
          <Switch checked={enabled} onCheckedChange={onToggleEnabled} />
          {enabled ? "Ligada" : "Desligada"}
        </label>
      </Card>

      <div className="grid md:grid-cols-[320px_1fr] gap-4">
        <Card className="p-3 space-y-3">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar contato…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="border-0 focus-visible:ring-0"
            />
          </div>
          <div className="text-xs text-muted-foreground">
            {q ? "Resultados" : "Contatos com memória"}
          </div>
          <div className="max-h-[60vh] overflow-y-auto space-y-1">
            {contactsQuery.isLoading && (
              <div className="p-4 flex justify-center">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            )}
            {!contactsQuery.isLoading && contacts.length === 0 && (
              <div className="p-4 text-xs text-center text-muted-foreground">
                {q ? "Nenhum contato encontrado." : "Nenhum contato com memória ainda."}
              </div>
            )}
            {contacts.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelected(c)}
                className={`w-full text-left p-2 rounded hover:bg-muted text-sm ${
                  selected?.id === c.id ? "bg-muted" : ""
                }`}
              >
                <div className="font-medium truncate">{c.name || c.wa_id || c.phone || "—"}</div>
                <div className="text-xs text-muted-foreground truncate">{c.phone || c.wa_id || ""}</div>
              </button>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          {!selected ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              Selecione um contato para ver as lembranças.
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-3">
                <div className="flex-1">
                  <Label className="text-xs">Contato</Label>
                  <div className="font-semibold">
                    {selected.name || selected.wa_id || selected.phone || "—"}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={onClearAll}>
                  <Trash2 className="h-4 w-4 mr-1 text-destructive" /> Limpar tudo
                </Button>
              </div>

              {memoriesQuery.isLoading && (
                <div className="p-6 flex justify-center">
                  <Loader2 className="animate-spin" />
                </div>
              )}
              {!memoriesQuery.isLoading && grouped.size === 0 && (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  Nenhuma lembrança ainda. A Ellie vai começar a montar conforme conversar.
                </div>
              )}

              <div className="space-y-4">
                {Array.from(grouped.entries()).map(([cat, items]) => (
                  <div key={cat}>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                      {CATEGORY_LABEL[cat] ?? cat}
                    </div>
                    <div className="space-y-1">
                      {items.map((m) => (
                        <div key={m.id} className="flex items-start gap-2 p-2 rounded border">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <code className="text-xs font-mono">{m.key}</code>
                              <Badge variant="outline" className="text-[10px]">
                                {Math.round(m.confidence * 100)}%
                              </Badge>
                            </div>
                            {editingId === m.id ? (
                              <div className="flex items-center gap-1 mt-1">
                                <Input
                                  value={editingValue}
                                  onChange={(e) => setEditingValue(e.target.value)}
                                  className="h-7 text-sm"
                                />
                                <Button size="icon" variant="ghost" onClick={() => onSaveEdit(m)}>
                                  <Save className="h-4 w-4" />
                                </Button>
                                <Button size="icon" variant="ghost" onClick={() => setEditingId(null)}>
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                            ) : (
                              <div className="text-sm break-words">{m.value}</div>
                            )}
                          </div>
                          {editingId !== m.id && (
                            <>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => {
                                  setEditingId(m.id);
                                  setEditingValue(m.value);
                                }}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button size="icon" variant="ghost" onClick={() => onDelete(m)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
