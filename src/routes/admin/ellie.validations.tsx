import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Trash2, Loader2, Search, GraduationCap } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useActiveBrand } from "@/lib/active-brand";
import { isEllie } from "@/lib/ellie";
import {
  listBuyerValidations,
  upsertBuyerValidation,
  deleteBuyerValidation,
} from "@/lib/ellie-config.functions";

export const Route = createFileRoute("/admin/ellie/validations")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  component: BuyerValidationsPage,
});

type Buyer = {
  id: string;
  email: string;
  phone: string | null;
  full_name: string | null;
  product: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
};

function BuyerValidationsPage() {
  const { activeBrandId } = useActiveBrand();
  const qc = useQueryClient();
  const listFn = useServerFn(listBuyerValidations);
  const upsertFn = useServerFn(upsertBuyerValidation);
  const delFn = useServerFn(deleteBuyerValidation);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Partial<Buyer> | null>(null);

  if (!isEllie(activeBrandId)) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <Card className="p-6 text-center text-sm text-muted-foreground">
          Esta página é exclusiva do workspace Ellie. Selecione o workspace correto.
        </Card>
      </div>
    );
  }

  const { data, isLoading } = useQuery({
    queryKey: ["ellie-buyers", activeBrandId, q],
    queryFn: () => listFn({ data: { brandId: activeBrandId!, q } }),
    enabled: !!activeBrandId,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["ellie-buyers", activeBrandId] });

  const save = async () => {
    if (!editing?.email) return toast.error("Email obrigatório");
    try {
      await upsertFn({
        data: {
          id: editing.id,
          brandId: activeBrandId!,
          email: editing.email,
          phone: editing.phone ?? null,
          full_name: editing.full_name ?? null,
          product: editing.product ?? null,
          notes: editing.notes ?? null,
          active: editing.active ?? true,
        },
      });
      toast.success("Salvo");
      setEditing(null);
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Erro");
    }
  };

  const del = async (id: string) => {
    if (!confirm("Remover este registro?")) return;
    await delFn({ data: { id, brandId: activeBrandId! } });
    toast.success("Removido");
    refresh();
  };

  const items = (data?.items ?? []) as Buyer[];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <GraduationCap className="h-5 w-5" />
        <h1 className="text-xl font-semibold flex-1">Validação de alunos (Ellie)</h1>
        <Button onClick={() => setEditing({ active: true })}>
          <Plus className="h-4 w-4 mr-1" /> Adicionar
        </Button>
      </div>

      <Card className="p-3 flex items-center gap-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por email, nome ou telefone…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="border-0 focus-visible:ring-0"
        />
      </Card>

      {isLoading ? (
        <div className="p-10 flex justify-center"><Loader2 className="animate-spin" /></div>
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left p-3">Email</th>
                <th className="text-left p-3">Nome</th>
                <th className="text-left p-3">Telefone</th>
                <th className="text-left p-3">Produto</th>
                <th className="text-left p-3">Ativo</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Nenhum registro.</td></tr>
              )}
              {items.map((b) => (
                <tr key={b.id} className="border-b hover:bg-muted/40">
                  <td className="p-3 font-mono text-xs">{b.email}</td>
                  <td className="p-3">{b.full_name ?? "—"}</td>
                  <td className="p-3">{b.phone ?? "—"}</td>
                  <td className="p-3">{b.product ?? "—"}</td>
                  <td className="p-3">{b.active ? "✓" : "—"}</td>
                  <td className="p-3 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(b)}>Editar</Button>
                    <Button size="icon" variant="ghost" onClick={() => del(b.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Editar aluno" : "Adicionar aluno"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Email *</Label>
              <Input value={editing?.email ?? ""} onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Nome</Label>
                <Input value={editing?.full_name ?? ""} onChange={(e) => setEditing({ ...editing, full_name: e.target.value })} />
              </div>
              <div>
                <Label>Telefone</Label>
                <Input
                  value={editing?.phone ?? ""}
                  onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
                  placeholder="+55 11 99999-8888"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Se preenchido, valida automaticamente quando esse número mandar mensagem.
                </p>
              </div>

            </div>
            <div>
              <Label>Produto / acesso</Label>
              <Input value={editing?.product ?? ""} onChange={(e) => setEditing({ ...editing, product: e.target.value })} />
            </div>
            <div>
              <Label>Notas</Label>
              <Textarea rows={2} value={editing?.notes ?? ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={editing?.active ?? true} onCheckedChange={(v) => setEditing({ ...editing, active: v })} />
              Ativo
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={save}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
