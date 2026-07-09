import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const COLORS = ["#ef4444", "#f59e0b", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899", "#64748b"];

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  brandId: string;
  defaultName?: string;
  onCreated: (tag: { id: string; name: string; color: string | null }) => void;
}

export function QuickCreateTagDialog({ open, onOpenChange, brandId, defaultName = "", onCreated }: Props) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLORS[5]);
  const [folderId, setFolderId] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setName(defaultName); setColor(COLORS[5]); setFolderId(null); }
  }, [open, defaultName]);

  const foldersQ = useQuery({
    queryKey: ["tag-folders", brandId],
    enabled: open && !!brandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tag_folders").select("id, name, color, position").eq("brand_id", brandId)
        .order("position").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const mut = useMutation({
    mutationFn: async () => {
      const n = name.trim();
      if (!n) throw new Error("Nome obrigatório");
      const { data, error } = await supabase.from("tags")
        .insert({ brand_id: brandId, name: n, color, folder_id: folderId })
        .select("id, name, color").single();
      if (error) throw error;
      return data;
    },
    onSuccess: (row: any) => {
      toast.success("Tag criada");
      qc.invalidateQueries({ queryKey: ["tags-picker", brandId] });
      qc.invalidateQueries({ queryKey: ["tags-all", brandId] });
      onCreated(row);
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao criar tag"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Nova tag</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>Pasta</Label>
            <select
              value={folderId ?? ""}
              onChange={(e) => setFolderId(e.target.value || null)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
            >
              <option value="">Sem pasta</option>
              {(foldersQ.data ?? []).map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Cor</Label>
            <div className="flex flex-wrap gap-1.5">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={cn("h-7 w-7 rounded-full border-2", color === c ? "border-foreground" : "border-transparent")}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || !name.trim()}>
            {mut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Criar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
