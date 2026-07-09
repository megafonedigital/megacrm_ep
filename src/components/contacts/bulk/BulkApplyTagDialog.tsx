import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, ChevronsUpDown, Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { bulkApplyTag } from "@/lib/contacts-bulk.functions";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { QuickCreateTagDialog } from "./QuickCreateTagDialog";
import type { BulkContext } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ctx: BulkContext;
  onDone: () => void;
}

export function BulkApplyTagDialog({ open, onOpenChange, ctx, onDone }: Props) {
  const [tagId, setTagId] = useState<string>("");
  const [dispatchAutomation, setDispatchAutomation] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const fn = useServerFn(bulkApplyTag);

  useEffect(() => {
    if (open) { setTagId(""); setDispatchAutomation(false); setSearch(""); }
  }, [open]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setPickerOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPickerOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [pickerOpen]);


  const tagsQ = useQuery({
    queryKey: ["tags-picker", ctx.brandId],
    enabled: open && !!ctx.brandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tags").select("id, name, color").eq("brand_id", ctx.brandId).order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string; color: string | null }[];
    },
  });

  const tags = tagsQ.data ?? [];
  const selected = useMemo(() => tags.find((t) => t.id === tagId), [tags, tagId]);
  const trimmed = search.trim();
  const exactMatch = trimmed
    ? tags.some((t) => t.name.toLowerCase() === trimmed.toLowerCase())
    : false;
  const filteredTags = trimmed
    ? tags.filter((t) => t.name.toLowerCase().includes(trimmed.toLowerCase()))
    : tags;

  const mut = useMutation({
    mutationFn: async () => fn({ data: { scope: ctx.scope, tagId, dispatchAutomation } }),
    onSuccess: (res: any) => {
      let msg = `${res.updated} contato(s) marcados.`;
      if (res.automationDispatched) msg += ` ${res.automationDispatched} automação(ões) disparada(s).`;
      if (res.automationFailed) msg += ` ${res.automationFailed} falha(s).`;
      toast.success(msg);
      qc.invalidateQueries({ queryKey: ["contacts"] });
      onDone();
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao aplicar tag"),
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aplicar tag em {ctx.count} contato(s)</DialogTitle>
            <DialogDescription>Selecione a tag ou crie uma nova sem sair daqui.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Tag</Label>
              <div ref={containerRef} className="relative">
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between font-normal"
                  onClick={() => setPickerOpen((o) => !o)}
                >
                  {selected ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: selected.color ?? "#94a3b8" }} />
                      {selected.name}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Selecione uma tag</span>
                  )}
                  <ChevronsUpDown className="h-4 w-4 opacity-50 ml-2" />
                </Button>
                {pickerOpen && (
                  <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border bg-popover text-popover-foreground shadow-md">
                    <div className="flex items-center border-b px-2">
                      <Search className="h-4 w-4 opacity-50 shrink-0" />
                      <input
                        autoFocus
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Buscar tag…"
                        className="flex h-9 w-full bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
                      />
                    </div>
                    <div className="max-h-72 overflow-auto p-1">
                      {filteredTags.length === 0 && (
                        <div className="px-2 py-4 text-center text-xs text-muted-foreground">Nenhuma tag encontrada.</div>
                      )}
                      {filteredTags.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => { setTagId(t.id); setPickerOpen(false); setSearch(""); }}
                          className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                        >
                          <span className="h-2 w-2 rounded-full mr-2 shrink-0" style={{ background: t.color ?? "#94a3b8" }} />
                          <span className="truncate">{t.name}</span>
                          <Check className={cn("ml-auto h-4 w-4 shrink-0", tagId === t.id ? "opacity-100" : "opacity-0")} />
                        </button>
                      ))}
                      {!exactMatch && (
                        <>
                          {filteredTags.length > 0 && <div className="my-1 h-px bg-border" />}
                          <button
                            type="button"
                            onClick={() => { setPickerOpen(false); setCreateOpen(true); }}
                            className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                          >
                            <Plus className="h-4 w-4 mr-2 shrink-0" />
                            {trimmed ? <>Criar tag <span className="font-medium ml-1">"{trimmed}"</span></> : "Criar nova tag"}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Checkbox id="dispatch" checked={dispatchAutomation} onCheckedChange={(v) => setDispatchAutomation(!!v)} />
              <Label htmlFor="dispatch" className="text-sm font-normal leading-tight">
                Disparar automação <code className="text-xs">tag_added</code> para cada contato
                <span className="block text-xs text-muted-foreground">Só funciona em contatos que já têm conversa.</span>
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={() => mut.mutate()} disabled={!tagId || mut.isPending}>
              {mut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Aplicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <QuickCreateTagDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        brandId={ctx.brandId}
        defaultName={trimmed}
        onCreated={(t) => { setTagId(t.id); setSearch(""); }}
      />
    </>
  );
}
