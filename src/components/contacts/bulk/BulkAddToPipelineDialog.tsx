import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { bulkAddToPipeline } from "@/lib/contacts-bulk.functions";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { BulkContext } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ctx: BulkContext;
  onDone: () => void;
}

export function BulkAddToPipelineDialog({ open, onOpenChange, ctx, onDone }: Props) {
  const [pipelineId, setPipelineId] = useState("");
  const [stageId, setStageId] = useState("");
  const qc = useQueryClient();
  const fn = useServerFn(bulkAddToPipeline);

  useEffect(() => { if (open) { setPipelineId(""); setStageId(""); } }, [open]);

  const pipelinesQ = useQuery({
    queryKey: ["pipelines-list", ctx.brandId],
    enabled: open && !!ctx.brandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipelines").select("id, name").eq("brand_id", ctx.brandId).order("position");
      if (error) throw error;
      return data ?? [];
    },
  });

  const stagesQ = useQuery({
    queryKey: ["pipeline-stages-list", pipelineId],
    enabled: open && !!pipelineId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipeline_stages").select("id, name, color")
        .eq("pipeline_id", pipelineId).order("position");
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => { setStageId(""); }, [pipelineId]);

  const mut = useMutation({
    mutationFn: async () => fn({ data: { scope: ctx.scope, pipelineId, stageId } }),
    onSuccess: (res: any) => {
      let msg = `${res.added} contato(s) adicionado(s).`;
      if (res.alreadyInPipeline) msg += ` ${res.alreadyInPipeline} já estavam no pipeline.`;
      toast.success(msg);
      qc.invalidateQueries({ queryKey: ["contacts"] });
      onDone();
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao adicionar ao pipeline"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar {ctx.count} contato(s) em pipeline</DialogTitle>
          <DialogDescription>Contatos que já estão no pipeline são mantidos onde estão.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Pipeline</Label>
            <Select value={pipelineId} onValueChange={setPipelineId}>
              <SelectTrigger><SelectValue placeholder="Selecione um pipeline" /></SelectTrigger>
              <SelectContent>
                {(pipelinesQ.data ?? []).map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Etapa</Label>
            <Select value={stageId} onValueChange={setStageId} disabled={!pipelineId}>
              <SelectTrigger><SelectValue placeholder="Selecione uma etapa" /></SelectTrigger>
              <SelectContent>
                {(stagesQ.data ?? []).map((s: any) => (
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => mut.mutate()} disabled={!pipelineId || !stageId || mut.isPending}>
            {mut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Adicionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
