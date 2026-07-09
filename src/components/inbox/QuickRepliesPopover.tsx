import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Pencil, Plus, Trash2, X, Check, Search } from "lucide-react";
import { toast } from "sonner";
import {
  listQuickReplies,
  createQuickReply,
  updateQuickReply,
  deleteQuickReply,
} from "@/lib/quick-replies.functions";

type Item = { id: string; title: string | null; content: string; position: number };

export function QuickRepliesPopover({ onPick }: { onPick: (text: string) => void }) {
  const qc = useQueryClient();
  const list = useServerFn(listQuickReplies);
  const create = useServerFn(createQuickReply);
  const update = useServerFn(updateQuickReply);
  const remove = useServerFn(deleteQuickReply);

  const { data, isLoading } = useQuery({
    queryKey: ["quick-replies"],
    queryFn: () => list(),
  });
  const items = (data?.items ?? []) as Item[];

  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [formContent, setFormContent] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        (i.title ?? "").toLowerCase().includes(q) ||
        i.content.toLowerCase().includes(q),
    );
  }, [items, search]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["quick-replies"] });

  const createMut = useMutation({
    mutationFn: (vars: { title: string; content: string }) =>
      create({ data: { title: vars.title || null, content: vars.content } }),
    onSuccess: () => { invalidate(); resetForm(); toast.success("Resposta rápida criada"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const updateMut = useMutation({
    mutationFn: (vars: { id: string; title: string; content: string }) =>
      update({ data: { id: vars.id, title: vars.title || null, content: vars.content } }),
    onSuccess: () => { invalidate(); resetForm(); toast.success("Atualizada"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => { invalidate(); toast.success("Removida"); },
    onError: (e: Error) => toast.error(e.message),
  });

  function resetForm() {
    setCreating(false);
    setEditingId(null);
    setFormTitle("");
    setFormContent("");
  }

  function startCreate() {
    setEditingId(null);
    setCreating(true);
    setFormTitle("");
    setFormContent("");
  }

  function startEdit(item: Item) {
    setCreating(false);
    setEditingId(item.id);
    setFormTitle(item.title ?? "");
    setFormContent(item.content);
  }

  function submitForm() {
    const content = formContent.trim();
    if (!content) {
      toast.error("Conteúdo é obrigatório");
      return;
    }
    if (editingId) {
      updateMut.mutate({ id: editingId, title: formTitle.trim(), content });
    } else {
      createMut.mutate({ title: formTitle.trim(), content });
    }
  }

  const showForm = creating || editingId !== null;

  return (
    <div className="flex flex-col">
      <div className="relative border-b p-2">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar..."
          className="h-8 pl-7 text-sm"
        />
      </div>

      <div className="max-h-72 overflow-y-auto p-1">
        {isLoading ? (
          <div className="px-2 py-3 text-xs text-muted-foreground">Carregando...</div>
        ) : filtered.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-muted-foreground">
            {items.length === 0 ? "Crie sua primeira resposta rápida" : "Nenhum resultado"}
          </div>
        ) : (
          filtered.map((item) => (
            <div key={item.id} className="group flex items-start gap-1 rounded px-1 hover:bg-accent">
              <button
                type="button"
                onClick={() => onPick(item.content)}
                className="flex-1 truncate rounded px-1 py-1.5 text-left text-sm"
                title={item.content}
              >
                {item.title ? (
                  <div className="font-medium">{item.title}</div>
                ) : null}
                <div className={item.title ? "truncate text-xs text-muted-foreground" : "truncate"}>
                  {item.content}
                </div>
              </button>
              <div className="flex shrink-0 items-center opacity-0 transition group-hover:opacity-100">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => startEdit(item)}
                  title="Editar"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={() => {
                    if (confirm("Remover esta resposta rápida?")) deleteMut.mutate(item.id);
                  }}
                  title="Excluir"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      {showForm ? (
        <div className="space-y-2 border-t p-2">
          <Input
            value={formTitle}
            onChange={(e) => setFormTitle(e.target.value)}
            placeholder="Título (opcional)"
            maxLength={80}
            className="h-8 text-sm"
          />
          <Textarea
            value={formContent}
            onChange={(e) => setFormContent(e.target.value)}
            placeholder="Conteúdo da resposta"
            maxLength={2000}
            rows={3}
            className="resize-none text-sm"
          />
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={resetForm}>
              <X className="mr-1 h-3.5 w-3.5" /> Cancelar
            </Button>
            <Button
              size="sm"
              onClick={submitForm}
              disabled={createMut.isPending || updateMut.isPending || !formContent.trim()}
            >
              <Check className="mr-1 h-3.5 w-3.5" /> Salvar
            </Button>
          </div>
        </div>
      ) : (
        <div className="border-t p-2">
          <Button size="sm" variant="ghost" className="w-full justify-start" onClick={startCreate}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Nova resposta rápida
          </Button>
        </div>
      )}
    </div>
  );
}
