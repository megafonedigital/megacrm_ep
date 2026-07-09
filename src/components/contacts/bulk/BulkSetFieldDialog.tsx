import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, ChevronsUpDown, Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { bulkSetCustomField } from "@/lib/contacts-bulk.functions";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { QuickCreateFieldDialog } from "./QuickCreateFieldDialog";
import type { BulkContext } from "./types";

interface FieldRow { id: string; key: string; label: string; type: string; options: string[] }

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ctx: BulkContext;
  onDone: () => void;
}

export function BulkSetFieldDialog({ open, onOpenChange, ctx, onDone }: Props) {
  const [fieldId, setFieldId] = useState<string>("");
  const [value, setValue] = useState<string>("");
  const [boolVal, setBoolVal] = useState<string>("true");
  const [mode, setMode] = useState<"overwrite" | "fill_empty">("overwrite");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const fn = useServerFn(bulkSetCustomField);

  useEffect(() => {
    if (open) { setFieldId(""); setValue(""); setBoolVal("true"); setMode("overwrite"); setSearch(""); }
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

  const fieldsQ = useQuery({
    queryKey: ["custom-fields-list", ctx.brandId],
    enabled: open && !!ctx.brandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("custom_fields").select("id, key, label, type, options")
        .eq("brand_id", ctx.brandId).order("position");
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        ...r, options: Array.isArray(r.options) ? r.options : [],
      })) as FieldRow[];
    },
  });

  const fields = fieldsQ.data ?? [];
  const field = useMemo(() => fields.find((f) => f.id === fieldId), [fields, fieldId]);
  const trimmed = search.trim();
  const exactMatch = trimmed
    ? fields.some((f) => f.label.toLowerCase() === trimmed.toLowerCase())
    : false;
  const filteredFields = trimmed
    ? fields.filter((f) => f.label.toLowerCase().includes(trimmed.toLowerCase()))
    : fields;

  const mut = useMutation({
    mutationFn: async () => {
      if (!field) throw new Error("Selecione um campo.");
      let payloadValue: string | number | boolean | null = value;
      if (field.type === "boolean") payloadValue = boolVal === "true";
      else if (field.type === "number") payloadValue = value === "" ? null : Number(value);
      return fn({ data: { scope: ctx.scope, fieldKey: field.key, value: payloadValue, mode } });
    },
    onSuccess: (res: any) => {
      toast.success(`${res.updated} contato(s) atualizado(s)${res.skipped ? `, ${res.skipped} ignorado(s)` : ""}.`);
      qc.invalidateQueries({ queryKey: ["contacts"] });
      onDone();
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao atualizar campo"),
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Definir campo em {ctx.count} contato(s)</DialogTitle>
            <DialogDescription>Escolha o campo (ou crie um novo), o valor e o modo de aplicação.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Campo</Label>
              <div ref={containerRef} className="relative">
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between font-normal"
                  onClick={() => setPickerOpen((o) => !o)}
                >
                  {field ? field.label : <span className="text-muted-foreground">Selecione um campo</span>}
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
                        placeholder="Buscar campo…"
                        className="flex h-9 w-full bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
                      />
                    </div>
                    <div className="max-h-72 overflow-auto p-1">
                      {filteredFields.length === 0 && (
                        <div className="px-2 py-4 text-center text-xs text-muted-foreground">Nenhum campo encontrado.</div>
                      )}
                      {filteredFields.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => { setFieldId(f.id); setPickerOpen(false); setSearch(""); }}
                          className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                        >
                          <span className="truncate">{f.label}</span>
                          <span className="ml-2 text-xs text-muted-foreground">{f.type}</span>
                          <Check className={cn("ml-auto h-4 w-4 shrink-0", fieldId === f.id ? "opacity-100" : "opacity-0")} />
                        </button>
                      ))}
                      {!exactMatch && (
                        <>
                          {filteredFields.length > 0 && <div className="my-1 h-px bg-border" />}
                          <button
                            type="button"
                            onClick={() => { setPickerOpen(false); setCreateOpen(true); }}
                            className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                          >
                            <Plus className="h-4 w-4 mr-2 shrink-0" />
                            {trimmed ? <>Criar campo <span className="font-medium ml-1">"{trimmed}"</span></> : "Criar novo campo"}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {field && (
              <div className="space-y-1.5">
                <Label>Valor</Label>
                {field.type === "boolean" ? (
                  <Select value={boolVal} onValueChange={setBoolVal}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">Sim</SelectItem>
                      <SelectItem value="false">Não</SelectItem>
                    </SelectContent>
                  </Select>
                ) : field.type === "select" ? (
                  <Select value={value} onValueChange={setValue}>
                    <SelectTrigger><SelectValue placeholder="Selecione uma opção" /></SelectTrigger>
                    <SelectContent>
                      {field.options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : field.type === "number" ? (
                  <Input type="number" value={value} onChange={(e) => setValue(e.target.value)} />
                ) : field.type === "date" ? (
                  <Input type="date" value={value} onChange={(e) => setValue(e.target.value)} />
                ) : (
                  <Input value={value} onChange={(e) => setValue(e.target.value)} />
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Modo</Label>
              <RadioGroup value={mode} onValueChange={(v) => setMode(v as any)}>
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="overwrite" id="m-over" />
                  <Label htmlFor="m-over" className="text-sm font-normal leading-tight">
                    Sobrescrever
                    <span className="block text-xs text-muted-foreground">Substitui o valor atual em todos os contatos.</span>
                  </Label>
                </div>
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="fill_empty" id="m-fill" />
                  <Label htmlFor="m-fill" className="text-sm font-normal leading-tight">
                    Preencher só se vazio
                    <span className="block text-xs text-muted-foreground">Mantém valores existentes; preenche somente onde estiver vazio.</span>
                  </Label>
                </div>
              </RadioGroup>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={() => mut.mutate()} disabled={!field || mut.isPending}>
              {mut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Aplicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <QuickCreateFieldDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        brandId={ctx.brandId}
        defaultLabel={trimmed}
        onCreated={(f) => { setFieldId(f.id); setValue(""); setSearch(""); }}
      />
    </>
  );
}
