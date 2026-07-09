import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { bulkTriggerAutomation } from "@/lib/contacts-bulk.functions";
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

export function BulkAutomationDialog({ open, onOpenChange, ctx, onDone }: Props) {
  const [automationId, setAutomationId] = useState("");
  const qc = useQueryClient();
  const fn = useServerFn(bulkTriggerAutomation);

  useEffect(() => { if (open) setAutomationId(""); }, [open]);

  const automationsQ = useQuery({
    queryKey: ["automations-active", ctx.brandId],
    enabled: open && !!ctx.brandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("automations").select("id, name, trigger_type")
        .eq("brand_id", ctx.brandId).eq("status", "active").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const mut = useMutation({
    mutationFn: async () => fn({ data: { scope: ctx.scope, automationId } }),
    onSuccess: (res: any) => {
      let msg = `${res.dispatched} disparo(s) iniciado(s).`;
      if (res.skippedNoConversation) msg += ` ${res.skippedNoConversation} sem conversa.`;
      if (res.failed) msg += ` ${res.failed} falha(s).`;
      toast.success(msg);
      qc.invalidateQueries({ queryKey: ["contacts"] });
      onDone();
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao disparar automação"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Disparar automação para {ctx.count} contato(s)</DialogTitle>
          <DialogDescription>
            Roda a automação selecionada para cada contato. Contatos sem conversa são ignorados.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Automação</Label>
            <Select value={automationId} onValueChange={setAutomationId}>
              <SelectTrigger><SelectValue placeholder="Selecione uma automação ativa" /></SelectTrigger>
              <SelectContent>
                {(automationsQ.data ?? []).map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} <span className="text-xs text-muted-foreground">· {a.trigger_type}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => mut.mutate()} disabled={!automationId || mut.isPending}>
            {mut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Disparar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
