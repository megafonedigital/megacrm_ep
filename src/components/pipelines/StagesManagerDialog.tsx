import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Loader2, Zap, BookmarkPlus } from "lucide-react";
import { toast } from "sonner";
import { StageActivitiesDialog } from "./StageActivitiesDialog";

type OnEnterStatus = "none" | "resolvido" | "perdido";
interface Stage { id: string; name: string; color: string | null; position: number; on_enter_status?: OnEnterStatus | null }
type LocalStage = Stage & { on_enter_status: OnEnterStatus };

const PRESET_COLORS = ["#3b82f6", "#8b5cf6", "#ec4899", "#ef4444", "#f59e0b", "#10b981", "#06b6d4", "#64748b"];


export function StagesManagerDialog({
  open, onOpenChange, pipelineId, brandId, stages, onChanged,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pipelineId: string;
  brandId: string;
  stages: Stage[];
  onChanged: () => void;
}) {
  const [local, setLocal] = useState<LocalStage[]>([]);
  const [saving, setSaving] = useState(false);
  const [activitiesFor, setActivitiesFor] = useState<{ id: string; name: string } | null>(null);
  const [saveAsTemplateOpen, setSaveAsTemplateOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);


  useEffect(() => {
    if (open) setLocal(stages.map((s) => ({ ...s, on_enter_status: (s.on_enter_status ?? "none") as OnEnterStatus })));
  }, [open, stages]);

  function update(id: string, patch: Partial<LocalStage>) {
    setLocal((arr) => arr.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function add() {
    const tempId = `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setLocal((arr) => [...arr, { id: tempId, name: "Nova etapa", color: PRESET_COLORS[arr.length % PRESET_COLORS.length], position: arr.length, on_enter_status: "none" }]);
  }

  function remove(id: string) {
    setLocal((arr) => arr.filter((s) => s.id !== id).map((s, i) => ({ ...s, position: i })));
  }

  function move(id: string, dir: -1 | 1) {
    setLocal((arr) => {
      const idx = arr.findIndex((s) => s.id === id);
      const ni = idx + dir;
      if (idx < 0 || ni < 0 || ni >= arr.length) return arr;
      const next = [...arr];
      [next[idx], next[ni]] = [next[ni], next[idx]];
      return next.map((s, i) => ({ ...s, position: i }));
    });
  }

  async function save() {
    setSaving(true);
    try {
      const originalIds = new Set(stages.map((s) => s.id));
      const localIds = new Set(local.map((s) => s.id));

      // Deletions
      const toDelete = stages.filter((s) => !localIds.has(s.id)).map((s) => s.id);
      if (toDelete.length) {
        const { error } = await supabase.from("pipeline_stages").delete().in("id", toDelete);
        if (error) throw error;
      }

      // Inserts (new ids start with "new-")
      const toInsert = local.filter((s) => s.id.startsWith("new-")).map((s) => ({
        pipeline_id: pipelineId, name: s.name.trim() || "Etapa", color: s.color, position: s.position, on_enter_status: s.on_enter_status,
      }));
      if (toInsert.length) {
        const { error } = await supabase.from("pipeline_stages").insert(toInsert);
        if (error) throw error;
      }

      // Updates (existing)
      const toUpdate = local.filter((s) => originalIds.has(s.id));
      for (const s of toUpdate) {
        const orig = stages.find((o) => o.id === s.id)!;
        if (
          orig.name !== s.name ||
          orig.color !== s.color ||
          orig.position !== s.position ||
          ((orig as Stage).on_enter_status ?? "none") !== s.on_enter_status
        ) {
          const { error } = await supabase
            .from("pipeline_stages")
            .update({ name: s.name.trim() || "Etapa", color: s.color, position: s.position, on_enter_status: s.on_enter_status })
            .eq("id", s.id);
          if (error) throw error;
        }
      }

      toast.success("Etapas atualizadas");
      onChanged();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar etapas");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Gerenciar etapas</DialogTitle>
          <DialogDescription>
            Adicione, renomeie ou reordene as colunas do quadro. Excluir uma etapa remove os cartões dela.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
          {local.map((s, i) => (
            <div key={s.id} className="rounded-md border border-border p-2">
              <div className="flex items-center gap-2">
                <div className="flex flex-col gap-0.5">
                  <button onClick={() => move(s.id, -1)} disabled={i === 0} className="text-xs disabled:opacity-30">▲</button>
                  <button onClick={() => move(s.id, 1)} disabled={i === local.length - 1} className="text-xs disabled:opacity-30">▼</button>
                </div>
                <input
                  type="color"
                  value={s.color ?? "#94a3b8"}
                  onChange={(e) => update(s.id, { color: e.target.value })}
                  className="h-7 w-7 cursor-pointer rounded border border-input"
                />
                <Input
                  value={s.name}
                  onChange={(e) => update(s.id, { name: e.target.value })}
                  className="flex-1"
                />
                {!s.id.startsWith("new-") && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setActivitiesFor({ id: s.id, name: s.name })}
                    title="Atividades desta etapa"
                  >
                    <Zap className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button size="icon" variant="ghost" onClick={() => remove(s.id)} className="text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="ml-9 mt-2 flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Ao entrar nesta etapa:</span>
                <Select
                  value={s.on_enter_status}
                  onValueChange={(v) => update(s.id, { on_enter_status: v as OnEnterStatus })}
                >
                  <SelectTrigger className="h-7 flex-1 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem ação</SelectItem>
                    <SelectItem value="resolvido">Marcar como Resolvido</SelectItem>
                    <SelectItem value="perdido">Marcar como Perdido</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={add} className="w-full">
            <Plus className="mr-2 h-4 w-4" /> Adicionar etapa
          </Button>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            onClick={() => { setTemplateName(""); setTemplateDescription(""); setSaveAsTemplateOpen(true); }}
            disabled={local.length === 0}
          >
            <BookmarkPlus className="mr-2 h-4 w-4" /> Salvar como modelo
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar
            </Button>
          </div>
        </div>
      </DialogContent>
      <Dialog open={saveAsTemplateOpen} onOpenChange={setSaveAsTemplateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Salvar etapas como modelo</DialogTitle>
            <DialogDescription>
              As etapas atuais ({local.length}) serão salvas como um modelo reutilizável neste workspace.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-name">Nome</Label>
              <Input
                id="tpl-name"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="Ex.: Funil de vendas padrão"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-desc">Descrição (opcional)</Label>
              <Textarea
                id="tpl-desc"
                value={templateDescription}
                onChange={(e) => setTemplateDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveAsTemplateOpen(false)} disabled={savingTemplate}>
              Cancelar
            </Button>
            <Button
              onClick={async () => {
                const name = templateName.trim();
                if (!name) { toast.error("Informe um nome"); return; }
                setSavingTemplate(true);
                try {
                  const { data: userData } = await supabase.auth.getUser();
                  const stagesPayload = local.map((s, i) => ({
                    name: s.name.trim() || "Etapa",
                    color: s.color ?? "#94a3b8",
                    position: i,
                  }));
                  const { error } = await supabase.from("pipeline_templates").insert({
                    brand_id: brandId,
                    name,
                    description: templateDescription.trim() || null,
                    stages: stagesPayload,
                    created_by: userData.user?.id ?? null,
                  });
                  if (error) throw error;
                  toast.success("Modelo salvo");
                  setSaveAsTemplateOpen(false);
                } catch (e: any) {
                  toast.error(e.message ?? "Erro ao salvar modelo");
                } finally {
                  setSavingTemplate(false);
                }
              }}
              disabled={savingTemplate}
            >
              {savingTemplate && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar modelo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {activitiesFor && (
        <StageActivitiesDialog
          open={!!activitiesFor}
          onOpenChange={(o) => !o && setActivitiesFor(null)}
          stageId={activitiesFor.id}
          stageName={activitiesFor.name}
          pipelineId={pipelineId}
          brandId={brandId}
        />
      )}
    </Dialog>
  );
}

