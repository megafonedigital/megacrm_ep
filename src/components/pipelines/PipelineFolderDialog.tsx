import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/auth";
import { useActiveBrand } from "@/lib/active-brand";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export interface PipelineFolder {
  id: string;
  brand_id: string;
  name: string;
  color: string | null;
  position: number;
}

const COLORS = [
  "#64748b", "#ef4444", "#f59e0b", "#10b981",
  "#3b82f6", "#8b5cf6", "#ec4899", "#06b6d4",
];

export function PipelineFolderDialog({
  open, onOpenChange, folder, onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  folder: PipelineFolder | null;
  onSaved: () => void;
}) {
  const { me } = useMe();
  const { activeBrandId } = useActiveBrand();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(COLORS[0]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(folder?.name ?? "");
      setColor(folder?.color ?? COLORS[0]);
    }
  }, [open, folder]);

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Preencha o nome");
      return;
    }
    if (!folder && !activeBrandId) {
      toast.error("Selecione um workspace no topo antes de criar");
      return;
    }
    setSaving(true);
    try {
      if (folder) {
        const { error } = await supabase.from("pipeline_folders")
          .update({ name: name.trim(), color })
          .eq("id", folder.id);
        if (error) throw error;
        toast.success("Pasta atualizada");
      } else {
        const { error } = await supabase.from("pipeline_folders").insert({
          brand_id: activeBrandId!,
          name: name.trim(),
          color,
          created_by: me?.userId ?? null,
        });
        if (error) throw error;
        toast.success("Pasta criada");
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{folder ? "Editar pasta" : "Nova pasta"}</DialogTitle>
          <DialogDescription>Organize seus pipelines em pastas dentro deste workspace.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Vendas" />
          </div>
          <div>
            <Label>Cor</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Cor ${c}`}
                  className={`h-7 w-7 rounded-full border-2 transition ${color === c ? "border-foreground scale-110" : "border-transparent"}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
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
