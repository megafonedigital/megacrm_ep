import { createFileRoute, redirect, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Bot, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useActiveBrand } from "@/lib/active-brand";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { listAgents, createAgent, deleteAgent } from "@/lib/ai-agents.functions";

export const Route = createFileRoute("/admin/agentes/")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  component: AgentesPage,
});

const STATUS_LABEL: Record<string, string> = { off: "Desligado", test: "Teste", on: "Ligado" };
const STATUS_VARIANT: Record<string, "secondary" | "default" | "outline"> = {
  off: "secondary", test: "outline", on: "default",
};

function AgentesPage() {
  const { activeBrandId, activeBrand } = useActiveBrand();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const listFn = useServerFn(listAgents);
  const createFn = useServerFn(createAgent);
  const deleteFn = useServerFn(deleteAgent);

  const [openNew, setOpenNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<{ id: string; name: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["ai-agents", activeBrandId],
    queryFn: () => listFn({ data: { brandId: activeBrandId! } }),
    enabled: !!activeBrandId,
  });

  const handleCreate = async () => {
    if (!activeBrandId || !newName.trim()) return;
    setCreating(true);
    try {
      const res = await createFn({ data: { brandId: activeBrandId, name: newName.trim() } });
      toast.success("Agente criado");
      setOpenNew(false);
      setNewName("");
      navigate({ to: "/admin/agentes/$id", params: { id: res.id } });
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao criar");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!toDelete) return;
    try {
      await deleteFn({ data: { agentId: toDelete.id } });
      toast.success("Agente removido");
      setToDelete(null);
      qc.invalidateQueries({ queryKey: ["ai-agents", activeBrandId] });
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao remover");
    }
  };

  if (!activeBrandId) {
    return <div className="p-6 text-muted-foreground">Selecione um workspace.</div>;
  }

  const agents = data?.agents ?? [];

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Bot className="h-6 w-6" /> Agentes de IA
          </h1>
          <p className="text-sm text-muted-foreground">
            {activeBrand?.name ?? "Workspace"} — gerencie agentes, bases de conhecimento e distribuição por canal.
          </p>
        </div>
        <Button onClick={() => setOpenNew(true)}>
          <Plus className="h-4 w-4 mr-2" /> Novo agente
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="animate-spin" /></div>
      ) : agents.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          Nenhum agente criado ainda. Clique em "Novo agente" para começar.
        </Card>
      ) : (
        <div className="grid gap-3">
          {agents.map((a: any) => (
            <Card key={a.id} className="p-4 flex items-center justify-between hover:bg-accent/30 transition">
              <Link
                to="/admin/agentes/$id"
                params={{ id: a.id }}
                className="flex-1 flex items-center gap-3"
              >
                <Bot className="h-5 w-5 text-muted-foreground" />
                <div>
                  <div className="font-medium">{a.name}</div>
                  <div className="text-xs text-muted-foreground">{a.model}</div>
                </div>
              </Link>
              <div className="flex items-center gap-3">
                <Badge variant={STATUS_VARIANT[a.status] ?? "secondary"}>
                  {STATUS_LABEL[a.status] ?? a.status}
                </Badge>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setToDelete({ id: a.id, name: a.name })}
                  aria-label="Remover"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={openNew} onOpenChange={setOpenNew}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo agente</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Nome</Label>
            <Input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Ex: SDR — Curso X"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenNew(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
              {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover agente</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja remover "{toDelete?.name}"? Bases de conhecimento e vínculos com canais também serão excluídos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Remover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
