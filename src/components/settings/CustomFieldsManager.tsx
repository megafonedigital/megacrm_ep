import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Loader2, X, Search, Copy } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getVariablesForTrigger } from "@/components/automations/variable-picker";

const INTEGRATION_GROUPS: Array<{ source: string; label: string }> = [
  { source: "hotmart", label: "Hotmart" },
  { source: "shopify", label: "Shopify" },
  { source: "activecampaign", label: "ActiveCampaign" },
  { source: "sendflow", label: "SendFlow" },
];

function SystemFieldsSection() {
  const contactGroups = getVariablesForTrigger(null);
  const integrationGroups = INTEGRATION_GROUPS.flatMap((g) => {
    const groups = getVariablesForTrigger(g.source);
    // pula os grupos "comuns" que já vieram no contactGroups
    return groups.filter((gr) => !contactGroups.some((c) => c.label === gr.label));
  });
  const allGroups = [...contactGroups, ...integrationGroups];

  const copy = (token: string) => {
    navigator.clipboard.writeText(token).then(
      () => toast.success(`Copiado: ${token}`),
      () => toast.error("Falha ao copiar"),
    );
  };

  return (
    <div className="border rounded-md">
      <div className="p-3 border-b">
        <h2 className="text-sm font-medium">Campos do sistema e integrações</h2>
        <p className="text-xs text-muted-foreground">
          Variáveis disponíveis automaticamente em mensagens e automações. Clique para copiar.
        </p>
      </div>
      <div className="p-3 space-y-4 max-h-[420px] overflow-y-auto">
        {allGroups.map((g) => (
          <div key={g.label} className="space-y-1.5">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{g.label}</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
              {g.items.map((it) => {
                const token = `{{${it.key}}}`;
                return (
                  <button
                    key={it.key}
                    type="button"
                    onClick={() => copy(token)}
                    className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-accent group"
                    title="Copiar"
                  >
                    <div className="min-w-0">
                      <code className="text-[11px] text-primary block truncate">{token}</code>
                      <span className="text-[11px] text-muted-foreground block truncate">{it.label}</span>
                    </div>
                    <Copy className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0" />
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export type CustomField = {
  id: string;
  brand_id: string;
  key: string;
  label: string;
  type: "text" | "number" | "date" | "boolean" | "select";
  options: string[];
  position: number;
};

const TYPE_LABELS: Record<CustomField["type"], string> = {
  text: "Texto", number: "Número", date: "Data", boolean: "Sim/Não", select: "Lista",
};

function slugify(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
}

export function CustomFieldsManager({ brandId }: { brandId: string }) {
  const qc = useQueryClient();
  const fieldsQ = useQuery({
    queryKey: ["custom-fields", brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("custom_fields").select("*").eq("brand_id", brandId)
        .order("position").order("label");
      if (error) throw error;
      return (data ?? []).map((r: any) => ({ ...r, options: Array.isArray(r.options) ? r.options : [] })) as CustomField[];
    },
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CustomField | null>(null);
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [type, setType] = useState<CustomField["type"]>("text");
  const [options, setOptions] = useState<string[]>([]);
  const [optInput, setOptInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const filteredFields = (fieldsQ.data ?? []).filter((f) => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return true;
    return f.label.toLowerCase().includes(q) || f.key.toLowerCase().includes(q);
  });

  const openNew = () => {
    setEditing(null); setLabel(""); setKey(""); setKeyTouched(false);
    setType("text"); setOptions([]); setOptInput(""); setOpen(true);
  };
  const openEdit = (f: CustomField) => {
    setEditing(f); setLabel(f.label); setKey(f.key); setKeyTouched(true);
    setType(f.type); setOptions(f.options ?? []); setOptInput(""); setOpen(true);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!label.trim()) throw new Error("Label obrigatório");
      const finalKey = (key.trim() || slugify(label)).toLowerCase();
      if (!/^[a-z0-9_]+$/.test(finalKey)) throw new Error("Key deve conter apenas letras minúsculas, números e _");
      const payload = {
        brand_id: brandId,
        label: label.trim(),
        key: finalKey,
        type,
        options: type === "select" ? options : [],
      };
      if (editing) {
        const { error } = await supabase.from("custom_fields").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("custom_fields").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { toast.success("Campo salvo"); setOpen(false); qc.invalidateQueries({ queryKey: ["custom-fields", brandId] }); },
    onError: (e: any) => toast.error(e?.message ?? "Falha"),
  });

  const [delId, setDelId] = useState<string | null>(null);
  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("custom_fields").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Campo removido"); qc.invalidateQueries({ queryKey: ["custom-fields", brandId] }); },
    onError: (e: any) => toast.error(e?.message ?? "Falha"),
  });

  const addOption = () => {
    const v = optInput.trim();
    if (!v || options.includes(v)) { setOptInput(""); return; }
    setOptions([...options, v]); setOptInput("");
  };

  return (
    <div className="space-y-4">
      <SystemFieldsSection />
      <div className="border rounded-md">

      <div className="flex items-center justify-between gap-3 p-3 border-b">
        <div>
          <h2 className="text-sm font-medium">Campos personalizados</h2>
          <p className="text-xs text-muted-foreground">
            Use em mensagens como <code className="text-[11px]">{"{{custom.key}}"}</code>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar campo…"
              className="pl-8 h-9 w-[220px]"
            />
          </div>
          <Button size="sm" onClick={openNew}><Plus className="h-4 w-4 mr-1" />Novo campo</Button>
        </div>
      </div>
      {fieldsQ.isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : filteredFields.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-10">
          {searchTerm ? "Nenhum campo encontrado." : "Nenhum campo personalizado."}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Opções</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredFields.map((f) => (
              <TableRow key={f.id}>
                <TableCell className="font-medium">{f.label}</TableCell>
                <TableCell><code className="text-xs">{f.key}</code></TableCell>
                <TableCell>{TYPE_LABELS[f.type]}</TableCell>
                <TableCell>
                  {f.type === "select" && f.options.length > 0
                    ? <span className="text-xs">{f.options.join(", ")}</span>
                    : <span className="text-xs text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(f)}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setDelId(f.id)}><Trash2 className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Editar campo" : "Novo campo personalizado"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Label</Label>
              <Input
                value={label}
                onChange={(e) => {
                  setLabel(e.target.value);
                  if (!keyTouched && !editing) setKey(slugify(e.target.value));
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
                disabled={!!editing}
              />
              <p className="text-xs text-muted-foreground">
                Será disponibilizado como <code>{`{{custom.${key || "key"}}}`}</code>
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as CustomField["type"])}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              >
                {(Object.keys(TYPE_LABELS) as CustomField["type"][]).map((t) => (
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
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
              {saveMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!delId} onOpenChange={(o) => !o && setDelId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir campo?</AlertDialogTitle>
            <AlertDialogDescription>
              Os valores já salvos no metadata dos contatos serão mantidos, mas não aparecerão mais na UI nem em variáveis.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (delId) delMut.mutate(delId); setDelId(null); }}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </div>
    </div>
  );
}

