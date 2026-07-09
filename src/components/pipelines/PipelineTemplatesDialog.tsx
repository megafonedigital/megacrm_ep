import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/auth";
import { useActiveBrand } from "@/lib/active-brand";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Loader2, ArrowUp, ArrowDown, X, LayoutTemplate } from "lucide-react";
import { toast } from "sonner";

export interface TemplateStage {
  name: string;
  color: string;
  position: number;
}

export interface PipelineTemplate {
  id: string;
  brand_id: string;
  name: string;
  description: string | null;
  stages: TemplateStage[];
}

const DEFAULT_STAGES: TemplateStage[] = [
  { name: "Novo", color: "#3b82f6", position: 0 },
  { name: "Prospecção", color: "#06b6d4", position: 1 },
  { name: "Conexão", color: "#8b5cf6", position: 2 },
  { name: "Aguardando pagamento", color: "#f59e0b", position: 3 },
  { name: "Fechado", color: "#10b981", position: 4 },
  { name: "Perdido", color: "#ef4444", position: 5 },
];

export function PipelineTemplatesDialog({
  open, onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { me } = useMe();
  const { activeBrandId } = useActiveBrand();
  const qc = useQueryClient();
  const canManage = !!(me?.isAdmin || me?.isSupervisor || me?.isDeveloper);

  const [editing, setEditing] = useState<PipelineTemplate | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<PipelineTemplate | null>(null);

  const { data: templates, isLoading } = useQuery({
    queryKey: ["pipeline-templates", activeBrandId],
    enabled: open && !!activeBrandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipeline_templates")
        .select("id, brand_id, name, description, stages")
        .eq("brand_id", activeBrandId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as PipelineTemplate[];
    },
  });

  async function handleDelete() {
    if (!deleting) return;
    const { error } = await supabase.from("pipeline_templates").delete().eq("id", deleting.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Modelo excluído");
      qc.invalidateQueries({ queryKey: ["pipeline-templates"] });
    }
    setDeleting(null);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Modelos de pipeline</DialogTitle>
            <DialogDescription>
              Crie modelos com etapas pré-definidas para reutilizar na criação de novos pipelines.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {(templates?.length ?? 0)} modelo(s) neste workspace
            </span>
            {canManage && (
              <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}>
                <Plus className="mr-2 h-4 w-4" /> Novo modelo
              </Button>
            )}
          </div>

          <div className="max-h-[50vh] overflow-y-auto rounded-md border">
            {isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : (templates?.length ?? 0) === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                <LayoutTemplate className="mx-auto mb-2 h-8 w-8 opacity-60" />
                Nenhum modelo criado ainda.
              </div>
            ) : (
              <ul className="divide-y">
                {templates!.map((t) => (
                  <li key={t.id} className="flex items-start gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{t.name}</div>
                      {t.description && (
                        <div className="line-clamp-2 text-xs text-muted-foreground">{t.description}</div>
                      )}
                      <div className="mt-1 flex flex-wrap gap-1">
                        {(t.stages ?? []).map((s, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]"
                            style={{ backgroundColor: `${s.color}22`, color: s.color }}
                          >
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                            {s.name}
                          </span>
                        ))}
                      </div>
                    </div>
                    {canManage && (
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditing(t); setFormOpen(true); }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setDeleting(t)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TemplateFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        template={editing}
        onSaved={() => qc.invalidateQueries({ queryKey: ["pipeline-templates"] })}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir modelo?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleting?.name}" será removido. Pipelines já criados a partir dele não são afetados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function TemplateFormDialog({
  open, onOpenChange, template, onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  template: PipelineTemplate | null;
  onSaved: () => void;
}) {
  const { me } = useMe();
  const { activeBrandId } = useActiveBrand();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [stages, setStages] = useState<TemplateStage[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(template?.name ?? "");
      setDescription(template?.description ?? "");
      setStages(template?.stages?.length ? [...template.stages] : [...DEFAULT_STAGES]);
    }
  }, [open, template]);

  function updateStage(i: number, patch: Partial<TemplateStage>) {
    setStages((prev) => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  }
  function addStage() {
    setStages((prev) => [...prev, { name: "Nova etapa", color: "#64748b", position: prev.length }]);
  }
  function removeStage(i: number) {
    setStages((prev) => prev.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, position: idx })));
  }
  function moveStage(i: number, dir: -1 | 1) {
    setStages((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next.map((s, idx) => ({ ...s, position: idx }));
    });
  }

  async function handleSave() {
    if (!name.trim()) { toast.error("Preencha o nome"); return; }
    if (stages.length === 0) { toast.error("Adicione pelo menos uma etapa"); return; }
    if (stages.some((s) => !s.name.trim())) { toast.error("Toda etapa precisa de um nome"); return; }
    if (!template && !activeBrandId) { toast.error("Selecione um workspace"); return; }
    setSaving(true);
    try {
      const normalized = stages.map((s, i) => ({ name: s.name.trim(), color: s.color, position: i }));
      if (template) {
        const { error } = await supabase.from("pipeline_templates").update({
          name: name.trim(),
          description: description.trim() || null,
          stages: normalized,
        }).eq("id", template.id);
        if (error) throw error;
        toast.success("Modelo atualizado");
      } else {
        const { error } = await supabase.from("pipeline_templates").insert({
          brand_id: activeBrandId!,
          name: name.trim(),
          description: description.trim() || null,
          stages: normalized,
          created_by: me?.userId ?? null,
        });
        if (error) throw error;
        toast.success("Modelo criado");
      }
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{template ? "Editar modelo" : "Novo modelo"}</DialogTitle>
          <DialogDescription>Defina o nome e as etapas que serão criadas no pipeline.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Funil de vendas padrão" />
          </div>
          <div>
            <Label>Descrição (opcional)</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>

          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            <div className="flex items-center justify-between">
              <Label>Etapas</Label>
              <Button size="sm" variant="outline" onClick={addStage}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar etapa
              </Button>
            </div>
            <div className="max-h-[40vh] space-y-2 overflow-y-auto">
              {stages.map((s, i) => (
                <div key={i} className="flex items-center gap-2 rounded border bg-background p-2">
                  <input
                    type="color"
                    value={s.color}
                    onChange={(e) => updateStage(i, { color: e.target.value })}
                    className="h-8 w-8 shrink-0 cursor-pointer rounded border bg-transparent"
                  />
                  <Input
                    value={s.name}
                    onChange={(e) => updateStage(i, { name: e.target.value })}
                    className="flex-1"
                  />
                  <Button size="icon" variant="ghost" className="h-7 w-7" disabled={i === 0} onClick={() => moveStage(i, -1)}>
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" disabled={i === stages.length - 1} onClick={() => moveStage(i, 1)}>
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeStage(i)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              {stages.length === 0 && (
                <p className="py-2 text-center text-xs text-muted-foreground">Nenhuma etapa. Adicione ao menos uma.</p>
              )}
            </div>
            <Button size="sm" variant="ghost" onClick={() => setStages([...DEFAULT_STAGES])}>
              Restaurar etapas padrão
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
