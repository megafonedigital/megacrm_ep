import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, Loader2, Trash2, BookOpen, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/auth";
import { useActiveBrand } from "@/lib/active-brand";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

export const Route = createFileRoute("/admin/api-keys")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  component: ApiKeysPage,
});

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function ApiKeysPage() {
  const { me } = useMe();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const keysQ = useQuery({
    queryKey: ["api-keys"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brand_api_keys" as any)
        .select("id, name, key_prefix, brand_id, created_at, last_used_at, revoked_at, brands:brand_id(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const revoke = async (id: string) => {
    const { error } = await supabase.from("brand_api_keys" as any).update({ revoked_at: new Date().toISOString() }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Chave revogada");
    qc.invalidateQueries({ queryKey: ["api-keys"] });
  };

  if (!me?.isAdmin && !me?.isDeveloper) {
    return <div className="p-6 text-sm text-muted-foreground">Apenas administradores podem gerenciar chaves de API.</div>;
  }

  return (
    <div className="page-container space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><KeyRound className="h-6 w-6" /> API Keys</h1>
          <p className="text-sm text-muted-foreground">Chaves para integração externa via API pública (por workspace).</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <a href="/api/public/v1/docs" target="_blank" rel="noopener noreferrer">
              <BookOpen className="h-4 w-4 mr-1" /> Documentação <ExternalLink className="h-3 w-3 ml-1" />
            </a>
          </Button>
          <Button onClick={() => { setCreatedKey(null); setOpen(true); }}><Plus className="h-4 w-4 mr-1" /> Nova chave</Button>
        </div>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Workspace</TableHead>
              <TableHead>Prefixo</TableHead>
              <TableHead>Criada</TableHead>
              <TableHead>Último uso</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[80px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {keysQ.isLoading && <TableRow><TableCell colSpan={7} className="text-center py-6"><Loader2 className="h-4 w-4 animate-spin inline" /></TableCell></TableRow>}
            {keysQ.data?.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-10 text-sm text-muted-foreground">Nenhuma chave criada.</TableCell></TableRow>}
            {keysQ.data?.map((k: any) => (
              <TableRow key={k.id}>
                <TableCell className="font-medium">{k.name}</TableCell>
                <TableCell>{k.brands?.name ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">{k.key_prefix}…</TableCell>
                <TableCell className="text-xs text-muted-foreground">{new Date(k.created_at).toLocaleString("pt-BR")}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{k.last_used_at ? new Date(k.last_used_at).toLocaleString("pt-BR") : "—"}</TableCell>
                <TableCell>{k.revoked_at ? <Badge variant="secondary">Revogada</Badge> : <Badge>Ativa</Badge>}</TableCell>
                <TableCell>
                  {!k.revoked_at && (
                    <Button size="icon" variant="ghost" onClick={() => revoke(k.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <CreateKeyDialog
        open={open} onOpenChange={setOpen}
        createdKey={createdKey}
        setCreatedKey={setCreatedKey}
        onCreated={() => qc.invalidateQueries({ queryKey: ["api-keys"] })}
      />
    </div>
  );
}

function CreateKeyDialog({
  open, onOpenChange, createdKey, setCreatedKey, onCreated,
}: {
  open: boolean; onOpenChange: (o: boolean) => void;
  createdKey: string | null; setCreatedKey: (s: string | null) => void;
  onCreated: () => void;
}) {
  const { activeBrandId, activeBrand } = useActiveBrand();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return toast.error("Preencha o nome");
    if (!activeBrandId) return toast.error("Selecione um workspace no topo");
    setBusy(true);
    const random = crypto.getRandomValues(new Uint8Array(32));
    const hex = Array.from(random).map((b) => b.toString(16).padStart(2, "0")).join("");
    const key = `mck_${hex}`;
    const hash = await sha256Hex(key);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("brand_api_keys" as any).insert({
      brand_id: activeBrandId, name: name.trim(),
      key_hash: hash, key_prefix: key.slice(0, 11),
      created_by: u.user?.id ?? null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    setCreatedKey(key);
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setName(""); setCreatedKey(null); } }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{createdKey ? "Chave criada" : "Nova API Key"}</DialogTitle></DialogHeader>
        {createdKey ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Copie sua chave agora. Por segurança, ela não será mostrada novamente.</p>
            <Input readOnly value={createdKey} className="font-mono text-xs" onClick={(e) => (e.target as HTMLInputElement).select()} />
            <Button onClick={() => { navigator.clipboard.writeText(createdKey); toast.success("Copiada"); }}>Copiar</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div><Label>Nome</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Webapp produção" /></div>
            <div className="text-xs text-muted-foreground">
              Workspace: <strong className="text-foreground">{activeBrand?.name ?? "—"}</strong>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
          {!createdKey && <Button onClick={submit} disabled={busy || !activeBrandId}>{busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Criar</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
