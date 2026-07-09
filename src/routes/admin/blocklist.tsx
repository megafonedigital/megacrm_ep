import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus, Trash2, ShieldOff, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useActiveBrand } from "@/lib/active-brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import {
  listBlocklist, addBlocklistEntry, removeBlocklistEntry,
} from "@/lib/blocklist.functions";
import { formatPhoneDisplay } from "@/lib/phone";

export const Route = createFileRoute("/admin/blocklist")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  component: BlocklistPage,
});

function BlocklistPage() {
  const { activeBrandId, activeBrand } = useActiveBrand();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [openAdd, setOpenAdd] = useState(false);

  const listFn = useServerFn(listBlocklist);
  const addFn = useServerFn(addBlocklistEntry);
  const removeFn = useServerFn(removeBlocklistEntry);

  const q = useQuery({
    queryKey: ["blocklist", activeBrandId, search],
    enabled: !!activeBrandId,
    queryFn: () => listFn({ data: { brandId: activeBrandId!, search: search || undefined } }),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => removeFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Entrada removida do blocklist.");
      qc.invalidateQueries({ queryKey: ["blocklist"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao remover."),
  });

  const entries = q.data?.entries ?? [];
  const canManage = q.data?.canManage ?? false;

  if (!activeBrandId) {
    return <div className="p-6 text-sm text-muted-foreground">Selecione um workspace para ver o blocklist.</div>;
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <ShieldOff className="h-5 w-5" />
        <h1 className="text-xl font-semibold flex-1">Blocklist · {activeBrand?.name ?? ""}</h1>
        <Button onClick={() => setOpenAdd(true)}>
          <Plus className="h-4 w-4 mr-1" /> Adicionar entrada
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Telefones e emails listados aqui <strong>não recebem mensagens</strong> deste workspace
        (envio manual, automações ou broadcasts). Mensagens recebidas continuam chegando normalmente.
        Qualquer membro do workspace pode adicionar entradas; apenas admin, supervisor ou developer
        podem remover.
      </p>

      <Card className="p-3">
        <div className="relative max-w-sm">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por telefone ou email…"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </Card>

      <Card>
        {q.isLoading ? (
          <div className="p-10 flex justify-center"><Loader2 className="animate-spin" /></div>
        ) : entries.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            Nenhuma entrada no blocklist.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead>Adicionado por</TableHead>
                <TableHead>Data</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e: any) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <Badge variant={e.kind === "phone" ? "default" : "secondary"}>
                      {e.kind === "phone" ? "Telefone" : "Email"}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {e.kind === "phone" ? formatPhoneDisplay(e.value) : e.value}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{e.reason || "—"}</TableCell>
                  <TableCell className="text-sm">{e.creator?.full_name ?? e.creator?.email ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(e.created_at).toLocaleString("pt-BR")}
                  </TableCell>
                  <TableCell>
                    {canManage && (
                      <Button
                        size="icon" variant="ghost"
                        onClick={() => {
                          if (confirm("Remover esta entrada do blocklist?")) removeMut.mutate(e.id);
                        }}
                        title="Remover"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <AddDialog
        open={openAdd}
        onOpenChange={setOpenAdd}
        onAdd={async (kind, value, reason) => {
          await addFn({ data: { brandId: activeBrandId!, kind, value, reason } });
          toast.success("Adicionado ao blocklist.");
          qc.invalidateQueries({ queryKey: ["blocklist"] });
        }}
      />
    </div>
  );
}

function AddDialog({
  open, onOpenChange, onAdd,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAdd: (kind: "phone" | "email", value: string, reason?: string) => Promise<void>;
}) {
  const [kind, setKind] = useState<"phone" | "email">("phone");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!value.trim()) return;
    setSaving(true);
    try {
      await onAdd(kind, value.trim(), reason.trim() || undefined);
      setValue(""); setReason("");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao adicionar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar ao blocklist</DialogTitle>
          <DialogDescription>
            Contatos com este telefone ou email não receberão mais mensagens deste workspace.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="phone">Telefone</SelectItem>
                <SelectItem value="email">Email</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{kind === "phone" ? "Telefone (com DDD/DDI)" : "Email"}</Label>
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={kind === "phone" ? "+5511999998888" : "contato@email.com"}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Motivo (opcional)</Label>
            <Textarea
              rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="ex: pediu para parar de receber"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={saving || !value.trim()}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Adicionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
