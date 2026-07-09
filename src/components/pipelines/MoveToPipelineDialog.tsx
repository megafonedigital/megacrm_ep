import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/auth";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { applyPipelineDistribution } from "@/lib/pipeline-owners.functions";
import type { PipelineContactIndexEntry } from "@/lib/pipeline-cards";


interface Stage { id: string; name: string; color: string | null; position: number }
interface Pipeline {
  id: string;
  name: string;
  position: number;
  stages: Stage[];
}

type ExistingRow = { pipeline_id: string; stage_id: string; status: string | null; moved_at: string | null };

export function MoveToPipelineDialog({
  open, onOpenChange, brandId, contactId, contactName, lockedPipelineId, moveFromPipelineId, onMoved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  brandId: string;
  contactId: string;
  contactName?: string | null;
  /** Quando definido, trava o campo Pipeline nesse id (usado a partir da página de pipelines). */
  lockedPipelineId?: string;
  /** Quando definido, opera em modo "transferência": move o card do pipeline origem para o destino. */
  moveFromPipelineId?: string;
  onMoved?: () => void;
}) {
  const { me } = useMe();
  const qc = useQueryClient();
  const applyDistribution = useServerFn(applyPipelineDistribution);
  const [pipelineId, setPipelineId] = useState<string>("");
  const [stageId, setStageId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const initializedRef = useRef(false);

  const { data: pipelines, isLoading } = useQuery({
    queryKey: ["move-pipeline-list", brandId],
    enabled: open && !!brandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipelines")
        .select("id, name, position, stages:pipeline_stages(id, name, color, position)")
        .eq("brand_id", brandId)
        .order("position");
      if (error) throw error;
      const list = (data ?? []) as unknown as Pipeline[];
      list.forEach((p) => p.stages.sort((a, b) => a.position - b.position));
      return list;
    },
  });

  const { data: existing } = useQuery({
    queryKey: ["move-pipeline-existing", contactId],
    enabled: open && !!contactId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipeline_contacts")
        .select("pipeline_id, stage_id, status, moved_at")
        .eq("contact_id", contactId)
        .order("moved_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as ExistingRow[];
    },
  });

  // Lista de opções de pipeline a mostrar no Select:
  //  - Modo transferência: todos os pipelines da workspace EXCETO o de origem.
  //  - Com lockedPipelineId: apenas esse pipeline.
  //  - Modo Inbox e contato tem cards: apenas pipelines onde o contato já está.
  //  - Modo Inbox e contato sem cards: lista completa (para criar).
  const pipelineOptions = useMemo<Pipeline[]>(() => {
    const list = pipelines ?? [];
    if (moveFromPipelineId) return list.filter((p) => p.id !== moveFromPipelineId);
    if (lockedPipelineId) return list.filter((p) => p.id === lockedPipelineId);
    const ex = existing ?? [];
    if (ex.length === 0) return list;
    const ids = new Set(ex.map((e) => e.pipeline_id));
    return list.filter((p) => ids.has(p.id));
  }, [pipelines, existing, lockedPipelineId, moveFromPipelineId]);

  const isTransferMode = !!moveFromPipelineId;
  const isCreateMode = !isTransferMode && !lockedPipelineId && (existing?.length ?? 0) === 0;

  // Pré-seleção determinística por abertura.
  useEffect(() => {
    if (!open) {
      initializedRef.current = false;
      return;
    }
    if (initializedRef.current) return;
    const list = pipelines ?? [];
    if (list.length === 0) return;
    if (existing === undefined) return; // aguarda existing

    let initialPipeline: string;
    if (isTransferMode) {
      const others = list.filter((p) => p.id !== moveFromPipelineId);
      if (others.length === 0) return;
      // Prefere um pipeline em que o contato já tenha card; senão, o primeiro outro.
      const existingOther = (existing ?? []).find((e) => e.pipeline_id !== moveFromPipelineId);
      initialPipeline = existingOther?.pipeline_id ?? others[0].id;
    } else if (lockedPipelineId) {
      initialPipeline = lockedPipelineId;
    } else if ((existing ?? []).length > 0) {
      // moved_at mais recente (já ordenado desc)
      initialPipeline = existing![0].pipeline_id;
    } else {
      initialPipeline = list[0].id;
    }
    setPipelineId(initialPipeline);
    const p = list.find((x) => x.id === initialPipeline);
    const cur = (existing ?? []).find((e) => e.pipeline_id === initialPipeline);
    setStageId(cur?.stage_id ?? p?.stages[0]?.id ?? "");
    initializedRef.current = true;
  }, [open, pipelines, existing, lockedPipelineId, isTransferMode, moveFromPipelineId]);

  const stages = useMemo(
    () => (pipelines ?? []).find((p) => p.id === pipelineId)?.stages ?? [],
    [pipelines, pipelineId]
  );

  const currentRow = useMemo(
    () => (existing ?? []).find((e) => e.pipeline_id === pipelineId),
    [existing, pipelineId]
  );

  const selectedPipeline = useMemo(
    () => (pipelines ?? []).find((p) => p.id === pipelineId) ?? null,
    [pipelines, pipelineId]
  );

  const currentStageName = useMemo(() => {
    if (!currentRow) return null;
    return selectedPipeline?.stages.find((s) => s.id === currentRow.stage_id)?.name ?? null;
  }, [currentRow, selectedPipeline]);

  const newStageName = useMemo(
    () => selectedPipeline?.stages.find((s) => s.id === stageId)?.name ?? null,
    [selectedPipeline, stageId],
  );

  const noChange = !isTransferMode && !!currentRow && currentRow.stage_id === stageId;

  function onPipelineChange(id: string) {
    setPipelineId(id);
    const p = (pipelines ?? []).find((x) => x.id === id);
    const cur = (existing ?? []).find((e) => e.pipeline_id === id);
    setStageId(cur?.stage_id ?? p?.stages[0]?.id ?? "");
  }

  async function save() {
    if (!pipelineId || !stageId) return;
    if (isTransferMode && pipelineId === moveFromPipelineId) return;
    setSaving(true);
    const cur = (existing ?? []).find((e) => e.pipeline_id === pipelineId);
    const nowIso = new Date().toISOString();
    const { error } = cur
      ? await supabase
          .from("pipeline_contacts")
          .update({ stage_id: stageId, moved_by: me?.userId ?? null, moved_at: nowIso })
          .eq("contact_id", contactId)
          .eq("pipeline_id", pipelineId)
      : await supabase.from("pipeline_contacts").insert({
          pipeline_id: pipelineId,
          stage_id: stageId,
          contact_id: contactId,
          brand_id: brandId,
          moved_by: me?.userId ?? null,
        });
    if (error) {
      setSaving(false);
      toast.error(error.message);
      return;
    }

    // Modo transferência: remove o card do pipeline de origem.
    if (isTransferMode && moveFromPipelineId) {
      const { error: delErr } = await supabase
        .from("pipeline_contacts")
        .delete()
        .eq("contact_id", contactId)
        .eq("pipeline_id", moveFromPipelineId);
      if (delErr) {
        setSaving(false);
        toast.error("Card criado no destino mas falha ao remover da origem: " + delErr.message);
        return;
      }
      qc.setQueryData<PipelineContactIndexEntry[]>(
        ["pipeline-contact-index", moveFromPipelineId],
        (prev) => (prev ? prev.filter((x) => x.contact_id !== contactId) : prev),
      );
      qc.invalidateQueries({ queryKey: ["pipeline-contact-index", moveFromPipelineId] });
      qc.invalidateQueries({ queryKey: ["pipeline-stage-cards", moveFromPipelineId] });
      qc.invalidateQueries({ queryKey: ["pipeline-owners", moveFromPipelineId] });
    }

    if (!cur) {
      try {
        await applyDistribution({ data: { pipelineId, brandId, contactIds: [contactId] } });
      } catch (e) {
        console.error("[applyDistribution]", e);
      }
    }
    qc.setQueryData<PipelineContactIndexEntry[]>(
      ["pipeline-contact-index", pipelineId],
      (prev) => {
        if (!prev) return prev;
        if (cur) {
          return prev.map((x) =>
            x.contact_id === contactId && x.id
              ? { ...x, stage_id: stageId }
              : x,
          );
        }
        return [
          ...prev,
          {
            id: `optimistic-${contactId}-${Date.now()}`,
            stage_id: stageId,
            contact_id: contactId,
            position: 0,
            status: "aberto",
            created_at: nowIso,
          },
        ];
      },
    );
    qc.invalidateQueries({ queryKey: ["pipeline-stage-cards", pipelineId] });
    qc.invalidateQueries({ queryKey: ["pipeline-owners", pipelineId] });

    setSaving(false);
    const destName = (pipelines ?? []).find((p) => p.id === pipelineId)?.name ?? "pipeline";
    toast.success(
      isTransferMode
        ? `Card movido para ${destName}`
        : cur ? "Etapa atualizada" : "Card criado no pipeline",
    );
    onMoved?.();
    onOpenChange(false);
  }

  const noPipelinesAtAll = !isLoading && (pipelines ?? []).length === 0;
  const noOtherPipelines = isTransferMode && !isLoading && pipelineOptions.length === 0;
  const dialogTitle = isTransferMode
    ? "Mover para outro pipeline"
    : isCreateMode ? "Criar card no pipeline" : "Mover para pipeline";
  const dialogDescription = isTransferMode
    ? (contactName ? `Mova ${contactName} para outro pipeline da workspace.` : "Mova o contato para outro pipeline da workspace.")
    : isCreateMode
      ? (contactName ? `Crie um card para ${contactName} em um pipeline.` : "Crie um card para este contato em um pipeline.")
      : (contactName ? `Coloque ${contactName} em uma etapa de pipeline.` : "Coloque o contato em uma etapa de pipeline.");
  const saveLabel = isTransferMode ? "Mover" : isCreateMode ? "Criar card" : "Salvar";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : noPipelinesAtAll ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Nenhum pipeline criado nesta Workspace.
          </div>
        ) : noOtherPipelines ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Não há outro pipeline nesta Workspace para onde mover o contato.
          </div>
        ) : (
          <div className="space-y-3">
            {isCreateMode && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                Este contato ainda não está em nenhum pipeline. Selecione um pipeline e uma etapa para criar o card.
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Pipeline</label>
              {lockedPipelineId ? (
                <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                  {selectedPipeline?.name ?? "—"}
                </div>
              ) : (
                <Select
                  value={pipelineId}
                  onValueChange={onPipelineChange}
                  disabled={pipelineOptions.length <= 1 && !isCreateMode && !isTransferMode}
                >
                  <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                  <SelectContent>
                    {pipelineOptions.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Etapa</label>
              <Select value={stageId} onValueChange={setStageId} disabled={stages.length === 0}>
                <SelectTrigger>
                  <SelectValue placeholder={stages.length ? "Selecione…" : "Pipeline sem etapas"} />
                </SelectTrigger>
                <SelectContent>
                  {stages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      <span className="inline-flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ background: s.color ?? "#94a3b8" }} />
                        {s.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isTransferMode && currentRow && (
              <div className="rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">
                O contato já tem um card em <strong>{selectedPipeline?.name}</strong> (etapa <strong>{currentStageName ?? "—"}</strong>). Esse card será atualizado para <strong>{newStageName ?? "—"}</strong> e o card de origem será removido.
              </div>
            )}

            {!isTransferMode && currentRow && (
              <div className="rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">
                {noChange
                  ? <>Já está em <strong>{selectedPipeline?.name}</strong> · <strong>{currentStageName}</strong>. Nenhuma mudança.</>
                  : <>Atualizando etapa em <strong>{selectedPipeline?.name}</strong> (atual: {currentStageName ?? "—"} → nova: {newStageName ?? "—"}).</>}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            onClick={save}
            disabled={saving || !pipelineId || !stageId || noChange || noPipelinesAtAll || noOtherPipelines}
          >
            {saving ? "Salvando…" : saveLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
