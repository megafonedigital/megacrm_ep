import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

type FieldType = "text" | "number" | "date" | "boolean" | "select";
const TYPE_LABELS: Record<FieldType, string> = {
  text: "Texto", number: "Número", date: "Data", boolean: "Sim/Não", select: "Lista",
};

function slugify(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  brandId: string;
  defaultLabel?: string;
  onCreated: (field: { id: string; key: string; label: string; type: FieldType; options: string[] }) => void;
}

export function QuickCreateFieldDialog({ open, onOpenChange, brandId, defaultLabel = "", onCreated }: Props) {
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [type, setType] = useState<FieldType>("text");
  const [options, setOptions] = useState<string[]>([]);
  const [optInput, setOptInput] = useState("");

  useEffect(() => {
    if (open) {
      setLabel(defaultLabel);
      setKey(slugify(defaultLabel));
      setKeyTouched(false);
      setType("text"); setOptions([]); setOptInput("");
    }
  }, [open, defaultLabel]);

  const addOption = () => {
    const v = optInput.trim();
    if (!v || options.includes(v)) { setOptInput(""); return; }
    setOptions([...options, v]); setOptInput("");
  };

  const mut = useMutation({
    mutationFn: async () => {
      if (!label.trim()) throw new Error("Label obrigatório");
      const finalKey = (key.trim() || slugify(label)).toLowerCase();
      if (!/^[a-z0-9_]+$/.test(finalKey)) throw new Error("Key deve conter apenas letras minúsculas, números e _");
      const { data, error } = await supabase.from("custom_fields").insert({
        brand_id: brandId,
        label: label.trim(),
        key: finalKey,
        type,
        options: type === "select" ? options : [],
      }).select("id, key, label, type, options").single();
      if (error) throw error;
      return data;
    },
    onSuccess: (row: any) => {
      toast.success("Campo criado");
      qc.invalidateQueries({ queryKey: ["custom-fields-list", brandId] });
      qc.invalidateQueries({ queryKey: ["custom-fields", brandId] });
      onCreated({ ...row, options: Array.isArray(row.options) ? row.options : [] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao criar campo"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Novo campo personalizado</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Label</Label>
            <Input
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
                if (!keyTouched) setKey(slugify(e.target.value));
              }}
              placeholder="ex.: Cidade"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>Key (uso em variáveis)</Label>
            <Input
              value={key}
              onChange={(e) => { setKey(e.target.value); setKeyTouched(true); }}
              placeholder="ex.: cidade"
            />
            <p className="text-xs text-muted-foreground">
              Disponível como <code>{`{{custom.${key || "key"}}}`}</code>
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as FieldType)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
            >
              {(Object.keys(TYPE_LABELS) as FieldType[]).map((t) => (
                <option key={t} value={t}>{TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>
          {type === "select" && (
            <div className="space-y-1.5">
              <Label>Opções</Label>
              <div className="flex gap-2">
                <Input
                  value={optInput}
                  onChange={(e) => setOptInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addOption(); } }}
                  placeholder="Adicionar opção e pressionar Enter"
                />
                <Button type="button" variant="outline" onClick={addOption}>Adicionar</Button>
              </div>
              <div className="flex flex-wrap gap-1 pt-1">
                {options.map((o) => (
                  <Badge key={o} variant="secondary" className="gap-1">
                    {o}
                    <button onClick={() => setOptions(options.filter((x) => x !== o))} className="hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || !label.trim()}>
            {mut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Criar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
