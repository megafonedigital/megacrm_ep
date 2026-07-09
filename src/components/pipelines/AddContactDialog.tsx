import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/auth";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { avatarColor } from "@/lib/avatar-color";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { formatPhoneDisplay } from "@/lib/phone";
import { applyPipelineDistribution } from "@/lib/pipeline-owners.functions";


interface StageOption { id: string; name: string; color: string | null }

export function AddContactDialog({
  open, onOpenChange, pipelineId, brandId, stageId, stages, existingContactIds, onAdded,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pipelineId: string;
  brandId: string;
  /** Optional fixed stage. If omitted, user picks one from `stages`. */
  stageId?: string;
  stages?: StageOption[];
  existingContactIds: string[];
  onAdded: () => void;
}) {
  const { me } = useMe();
  const applyDistribution = useServerFn(applyPipelineDistribution);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [pickedStageId, setPickedStageId] = useState<string>("");

  useEffect(() => {
    if (open) {
      setSearch("");
      setSelected(new Set());
      setPickedStageId(stageId ?? stages?.[0]?.id ?? "");
    }
  }, [open, stageId, stages]);

  const { data: contacts, isLoading } = useQuery({
    queryKey: ["pipeline-add-contacts", brandId, search],
    enabled: open,
    queryFn: async () => {
      let q = supabase
        .from("contacts")
        .select("id, name, profile_name, phone, wa_id")
        .eq("brand_id", brandId)
        .order("updated_at", { ascending: false })
        .limit(60);
      if (search.trim()) {
        const t = `%${search.trim()}%`;
        q = q.or(`name.ilike.${t},profile_name.ilike.${t},phone.ilike.${t},wa_id.ilike.${t}`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function addSelected() {
    const targetStageId = stageId ?? pickedStageId;
    if (!targetStageId) {
      toast.error("Selecione a etapa de destino.");
      return;
    }
    const ids = Array.from(selected).filter((id) => !existingContactIds.includes(id));
    if (ids.length === 0) {
      toast.error("Selecione ao menos um contato disponível.");
      return;
    }
    setSubmitting(true);
    const rows = ids.map((contact_id) => ({
      pipeline_id: pipelineId,
      stage_id: targetStageId,
      contact_id,
      brand_id: brandId,
      moved_by: me?.userId ?? null,
    }));
    const { error } = await supabase.from("pipeline_contacts").insert(rows);
    if (error) {
      setSubmitting(false);
      toast.error(error.message);
      return;
    }
    try {
      await applyDistribution({ data: { pipelineId, brandId, contactIds: ids } });
    } catch (e) {
      console.error("[applyDistribution]", e);
    }
    setSubmitting(false);
    toast.success(`${ids.length} contato(s) adicionado(s)`);
    onAdded();
  }


  const availableSelected = Array.from(selected).filter((id) => !existingContactIds.includes(id)).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar contatos</DialogTitle>
          <DialogDescription>Selecione um ou mais contatos da Workspace para inserir nesta etapa.</DialogDescription>
        </DialogHeader>
        {!stageId && stages && stages.length > 0 && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Etapa de destino</label>
            <Select value={pickedStageId} onValueChange={setPickedStageId}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Selecione uma etapa" />
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
        )}
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar nome ou telefone..." className="pl-8" />
        </div>
        <div className="max-h-[50vh] space-y-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (contacts ?? []).length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">Nenhum contato encontrado.</div>
          ) : (
            (contacts ?? []).map((c: any) => {
              const display = c.name || c.profile_name || formatPhoneDisplay(c.phone || c.wa_id || "") || "Contato";
              const exists = existingContactIds.includes(c.id);
              const isChecked = selected.has(c.id);
              return (
                <label
                  key={c.id}
                  className={`flex items-center gap-2 rounded-md p-2 ${exists ? "opacity-50" : "cursor-pointer hover:bg-accent"}`}
                >
                  <Checkbox
                    checked={isChecked}
                    disabled={exists}
                    onCheckedChange={() => !exists && toggle(c.id)}
                  />
                  <Avatar className="h-8 w-8"><AvatarFallback className={`text-xs ${avatarColor(c.id ?? display)}`}>{display.slice(0,2).toUpperCase()}</AvatarFallback></Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{display}</div>
                    <div className="truncate text-xs text-muted-foreground">{formatPhoneDisplay(c.phone || c.wa_id || "")}</div>
                  </div>
                  {exists && <span className="text-xs text-muted-foreground">Já no pipeline</span>}
                </label>
              );
            })
          )}
        </div>
        <DialogFooter className="items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {availableSelected} selecionado(s)
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
            <Button onClick={addSelected} disabled={submitting || availableSelected === 0}>
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Adicionar {availableSelected > 0 ? `(${availableSelected})` : ""}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
