import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, CheckCircle2, XCircle, RefreshCw, Loader2, MoreHorizontal,
  Phone, Trash2, Power, Pencil, Users, FileText, Building2, Activity, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/auth";
import { callFunction } from "@/lib/api";
import { avatarColor, initials } from "@/lib/avatar-color";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChannelDiagnosticsDialog } from "@/components/ChannelDiagnosticsDialog";
import { RegisterChannelDialog } from "@/components/RegisterChannelDialog";
import { EmbeddedSignupButton } from "@/components/EmbeddedSignupButton";
import { WebchatWidgetSection } from "@/components/admin/WebchatWidgetSection";

import { ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/admin/marcas")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  component: MarcasPage,
});

type BsuidMode = "off" | "shadow" | "on";

interface Brand {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  active: boolean;
  bsuid_mode?: BsuidMode | null;
}

type ChannelType = "suporte" | "vendas" | "webchat";

interface Channel {
  id: string;
  brand_id: string;
  name: string;
  type: ChannelType;
  phone_number: string | null;
  phone_number_id: string | null;
  waba_id: string | null;
  business_id: string | null;
  app_id: string | null;
  token_valid: boolean;
  token_last_validated_at: string | null;
  token_last_error: string | null;
  last_webhook_at: string | null;
  templates_last_sync_at: string | null;
  templates_last_error: string | null;
  active: boolean;
}

interface AgentRow { channel_id: string; user_id: string; full_name: string | null; email: string | null }

function MarcasPage() {
  const { me, loading } = useMe();
  const qc = useQueryClient();
  const [brandWizardOpen, setBrandWizardOpen] = useState(false);
  const [editingBrand, setEditingBrand] = useState<Brand | null>(null);
  const [deletingBrand, setDeletingBrand] = useState<Brand | null>(null);
  const [confirmSlug, setConfirmSlug] = useState("");
  const [channelDialog, setChannelDialog] = useState<{ brand: Brand; channel: Channel | null } | null>(null);
  const [diagChannelId, setDiagChannelId] = useState<string | null>(null);
  const [registerChannel, setRegisterChannel] = useState<Channel | null>(null);
  

  const brandsQ = useQuery<Brand[]>({
    queryKey: ["brands"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brands")
        .select("id,slug,name,description,active,bsuid_mode")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Brand[];
    },
  });

  const channelsQ = useQuery<Channel[]>({
    queryKey: ["brand-channels"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brand_channels")
        .select("id,brand_id,name,type,phone_number,phone_number_id,waba_id,business_id,app_id,token_valid,token_last_validated_at,token_last_error,last_webhook_at,templates_last_sync_at,templates_last_error,active")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as Channel[];
    },
  });

  const agentsQ = useQuery<AgentRow[]>({
    queryKey: ["channel-agents-list"],
    queryFn: async () => {
      const { data: ca, error } = await supabase.from("channel_agents").select("channel_id,user_id");
      if (error) throw error;
      const ids = Array.from(new Set((ca ?? []).map((r) => r.user_id)));
      if (ids.length === 0) return [];
      const { data: profs, error: pe } = await supabase
        .from("profiles").select("id,full_name,email").in("id", ids);
      if (pe) throw pe;
      const byId = new Map((profs ?? []).map((p) => [p.id, p]));
      return (ca ?? []).map((r) => {
        const p = byId.get(r.user_id);
        return { channel_id: r.channel_id, user_id: r.user_id, full_name: p?.full_name ?? null, email: p?.email ?? null };
      });
    },
  });

  const toggleActive = useMutation({
    mutationFn: async (b: Brand) => {
      const { error } = await supabase.from("brands").update({ active: !b.active }).eq("id", b.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["brands"] }); toast.success("Status atualizado."); },
    onError: (e: Error) => toast.error(e.message),
  });

  const revalidateChannel = useMutation({
    mutationFn: async (channelId: string) => {
      const { error } = await callFunction("validate-brand-token", { channel_id: channelId });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brand-channels"] });
      toast.success("Token revalidado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const syncTemplates = useMutation({
    mutationFn: async (channelId: string) => {
      const { data: res, error } = await callFunction<{ synced: number }>("sync-templates", { channel_id: channelId });
      if (error) throw new Error(error.message);
      return res?.synced ?? 0;
    },
    onSuccess: (n) => toast.success(`${n} templates meta sincronizados.`),
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleChannelActive = useMutation({
    mutationFn: async (c: Channel) => {
      const { error } = await supabase.from("brand_channels").update({ active: !c.active }).eq("id", c.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["brand-channels"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteChannel = useMutation({
    mutationFn: async (c: Channel) => {
      const { count } = await supabase
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("channel_id", c.id);
      if ((count ?? 0) > 0) throw new Error(`Canal tem ${count} conversa(s). Desative em vez de excluir.`);
      const { error } = await supabase.from("brand_channels").delete().eq("id", c.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brand-channels"] });
      qc.invalidateQueries({ queryKey: ["all-channels"] });
      toast.success("Canal excluído.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteBrand = useMutation({
    mutationFn: async (b: Brand) => {
      const { error } = await callFunction("delete-brand", { brand_id: b.id });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brands"] });
      qc.invalidateQueries({ queryKey: ["brand-channels"] });
      toast.success("Marca excluída.");
      setDeletingBrand(null);
      setConfirmSlug("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loading) return <div className="p-8 text-muted-foreground">Carregando...</div>;
  if (!me?.isAdmin && !me?.isDeveloper) return <div className="p-8 text-destructive">Acesso restrito a administradores.</div>;

  const channelsByBrand: Record<string, Channel[]> = {};
  for (const c of channelsQ.data ?? []) (channelsByBrand[c.brand_id] ??= []).push(c);

  const agentsByChannel: Record<string, AgentRow[]> = {};
  for (const a of agentsQ.data ?? []) (agentsByChannel[a.channel_id] ??= []).push(a);

  const isEmpty = !brandsQ.isLoading && (brandsQ.data?.length ?? 0) === 0;

  return (
    <div className="page-container">
      <div className="w-full">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Workspaces</h1>
            <p className="text-sm text-muted-foreground">
              Cadastre workspaces e adicione canais (WhatsApp). Atribua agentes a cada canal em <strong>Usuários</strong>.
            </p>
          </div>
          {me?.isAdmin && (
            <Button onClick={() => { setEditingBrand(null); setBrandWizardOpen(true); }}>
              <Plus className="h-4 w-4" /> Novo workspace
            </Button>
          )}
        </div>

        {brandsQ.isLoading ? (
          <div className="text-muted-foreground">Carregando workspaces...</div>
        ) : isEmpty ? (
          <Card className="flex flex-col items-center gap-3 p-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary">
              <Building2 className="h-7 w-7 text-muted-foreground" />
            </div>
            <div>
              <h3 className="font-semibold">Nenhum workspace ainda</h3>
              <p className="text-sm text-muted-foreground">
                Crie seu primeiro workspace para começar a configurar canais e atender clientes.
              </p>
            </div>
            <Button onClick={() => { setEditingBrand(null); setBrandWizardOpen(true); }}>
              <Plus className="h-4 w-4" /> Criar primeiro workspace
            </Button>
          </Card>
        ) : (
          <div className="grid gap-4">
            {brandsQ.data?.map((b) => {
              const channels = channelsByBrand[b.id] ?? [];
              return (
                <BrandCard
                  key={b.id}
                  brand={b}
                  channels={channels}
                  agentsByChannel={agentsByChannel}
                  onEdit={() => { setEditingBrand(b); setBrandWizardOpen(true); }}
                  onToggle={() => toggleActive.mutate(b)}
                  onDelete={() => { setDeletingBrand(b); setConfirmSlug(""); }}
                  onAddChannel={() => setChannelDialog({ brand: b, channel: null })}
                  onEditChannel={(c) => setChannelDialog({ brand: b, channel: c })}
                  onToggleChannel={(c) => toggleChannelActive.mutate(c)}
                  onDeleteChannel={(c) => deleteChannel.mutate(c)}
                  onRevalidate={(c) => revalidateChannel.mutate(c.id)}
                  onSyncTemplates={(c) => syncTemplates.mutate(c.id)}
                  onDiagnose={(c) => setDiagChannelId(c.id)}
                  onRegister={(c) => setRegisterChannel(c)}
                  
                  revalidating={revalidateChannel.isPending}
                />
              );
            })}
          </div>
        )}
      </div>

      <BrandDialog
        open={brandWizardOpen}
        editing={editingBrand}
        onClose={() => setBrandWizardOpen(false)}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["brands"] });
          setBrandWizardOpen(false);
        }}
      />

      <ChannelDialog
        ctx={channelDialog}
        onClose={() => setChannelDialog(null)}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["brand-channels"] });
          qc.invalidateQueries({ queryKey: ["all-channels"] });
          setChannelDialog(null);
        }}
      />

      <ChannelDiagnosticsDialog
        channelId={diagChannelId}
        open={!!diagChannelId}
        onClose={() => setDiagChannelId(null)}
      />

      <RegisterChannelDialog
        channelId={registerChannel?.id ?? null}
        channelName={registerChannel?.name}
        open={!!registerChannel}
        onClose={() => setRegisterChannel(null)}
      />


      <AlertDialog open={!!deletingBrand} onOpenChange={(o) => { if (!o) { setDeletingBrand(null); setConfirmSlug(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir workspace {deletingBrand?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove o workspace, seus canais, templates e segredos. Para confirmar, digite o slug
              <strong className="ml-1">{deletingBrand?.slug}</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input value={confirmSlug} onChange={(e) => setConfirmSlug(e.target.value)} placeholder={deletingBrand?.slug ?? ""} />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!deletingBrand || confirmSlug !== deletingBrand.slug || deleteBrand.isPending}
              onClick={() => deletingBrand && deleteBrand.mutate(deletingBrand)}
            >
              {deleteBrand.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function BrandCard({
  brand: b, channels, agentsByChannel,
  onEdit, onToggle, onDelete,
  onAddChannel, onEditChannel, onToggleChannel, onDeleteChannel, onRevalidate, onSyncTemplates, onDiagnose, onRegister, revalidating,
}: {
  brand: Brand; channels: Channel[]; agentsByChannel: Record<string, AgentRow[]>;
  onEdit: () => void; onToggle: () => void; onDelete: () => void;
  onAddChannel: () => void;
  onEditChannel: (c: Channel) => void;
  onToggleChannel: (c: Channel) => void;
  onDeleteChannel: (c: Channel) => void;
  onRevalidate: (c: Channel) => void;
  onSyncTemplates: (c: Channel) => void;
  onDiagnose: (c: Channel) => void;
  onRegister: (c: Channel) => void;
  revalidating: boolean;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-4 p-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${avatarColor(b.slug)}`}>
            {initials(b.name, b.slug.slice(0, 2).toUpperCase())}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-base font-semibold">{b.name}</h3>
              <Badge variant="outline" className="font-mono text-[10px]">{b.slug}</Badge>
              <span
                className={`h-2 w-2 rounded-full ${b.active ? "bg-success" : "bg-muted-foreground/40"}`}
                title={b.active ? "Ativa" : "Inativa"}
              />
            </div>
            {b.description && (
              <div className="mt-0.5 truncate text-sm text-muted-foreground">{b.description}</div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="outline" onClick={onAddChannel}>
            <Plus className="h-3.5 w-3.5" /> Canal
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost"><MoreHorizontal className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}><Pencil className="h-4 w-4" /> Editar</DropdownMenuItem>
              
              <DropdownMenuItem onClick={onToggle}><Power className="h-4 w-4" /> {b.active ? "Desativar" : "Ativar"}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
                <Trash2 className="h-4 w-4" /> Excluir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="border-t border-border bg-muted/30">
        {channels.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Nenhum canal. <button className="font-medium text-primary hover:underline" onClick={onAddChannel}>Adicionar um número de WhatsApp</button> para começar.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-9">Canal</TableHead>
                <TableHead className="h-9">Tipo</TableHead>
                <TableHead className="h-9">Número</TableHead>
                <TableHead className="h-9">Token</TableHead>
                <TableHead className="h-9">Agentes</TableHead>
                <TableHead className="h-9 w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {channels.map((c) => {
                const agents = agentsByChannel[c.id] ?? [];
                return (
                  <TableRow key={c.id} className={c.active ? "" : "opacity-60"}>
                    <TableCell className="py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button className="font-medium hover:underline" onClick={() => onDiagnose(c)}>{c.name}</button>
                        {!c.active && <Badge variant="secondary" className="text-[10px]">inativo</Badge>}
                        {!c.last_webhook_at && (
                          <Badge variant="outline" className="gap-1 border-warning/50 text-warning text-[10px]" title="Nenhum webhook recebido da Meta ainda">
                            <AlertTriangle className="h-2.5 w-2.5" /> sem webhook
                          </Badge>
                        )}
                        {(agentsByChannel[c.id]?.length ?? 0) === 0 && (
                          <Badge variant="outline" className="gap-1 border-warning/50 text-warning text-[10px]">
                            <Users className="h-2.5 w-2.5" /> sem agentes
                          </Badge>
                        )}
                        {c.templates_last_error && (
                          <Popover>
                            <PopoverTrigger asChild>
                              <Badge variant="outline" className="cursor-pointer gap-1 border-destructive/50 text-destructive text-[10px]">
                                <FileText className="h-2.5 w-2.5" /> templates
                              </Badge>
                            </PopoverTrigger>
                            <PopoverContent className="w-72 text-xs">{c.templates_last_error}</PopoverContent>
                          </Popover>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="py-2">
                      <Badge variant="outline" className="capitalize">{c.type}</Badge>
                    </TableCell>
                    <TableCell className="py-2">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Phone className="h-3 w-3" />
                        {c.phone_number ?? "—"}
                      </div>
                    </TableCell>
                    <TableCell className="py-2">
                      {c.token_valid ? (
                        <Badge className="gap-1 bg-success text-success-foreground">
                          <CheckCircle2 className="h-3 w-3" /> OK
                        </Badge>
                      ) : (
                        <Popover>
                          <PopoverTrigger asChild>
                            <Badge variant="destructive" className="cursor-pointer gap-1">
                              <XCircle className="h-3 w-3" /> Inválido
                            </Badge>
                          </PopoverTrigger>
                          <PopoverContent className="w-72 text-xs">
                            {c.token_last_error ?? "Token não validado."}
                          </PopoverContent>
                        </Popover>
                      )}
                    </TableCell>
                    <TableCell className="py-2">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                            <Users className="h-3 w-3" /> {agents.length}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64">
                          {agents.length === 0 ? (
                            <p className="text-xs text-muted-foreground">Nenhum agente. Atribua em Usuários.</p>
                          ) : (
                            <div className="grid gap-1.5">
                              {agents.map((a) => (
                                <div key={a.user_id} className="flex items-center gap-2 text-sm">
                                  <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold ${avatarColor(a.user_id)}`}>
                                    {initials(a.full_name ?? a.email)}
                                  </div>
                                  <span className="truncate">{a.full_name ?? a.email}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </PopoverContent>
                      </Popover>
                    </TableCell>
                    <TableCell className="py-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-7 w-7">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onDiagnose(c)}><Activity className="h-4 w-4" /> Diagnóstico</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onEditChannel(c)}><Pencil className="h-4 w-4" /> Editar</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onRevalidate(c)} disabled={revalidating}>
                            {revalidating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Revalidar token
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onSyncTemplates(c)}>
                            <FileText className="h-4 w-4" /> Sincronizar templates
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onRegister(c)}>
                            <ShieldCheck className="h-4 w-4" /> Registrar número
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onToggleChannel(c)}>
                            <Power className="h-4 w-4" /> {c.active ? "Desativar" : "Ativar"}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => onDeleteChannel(c)} className="text-destructive focus:text-destructive">
                            <Trash2 className="h-4 w-4" /> Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </Card>
  );
}

function BrandDialog({
  open, editing, onClose, onSaved,
}: { open: boolean; editing: Brand | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [bsuidMode, setBsuidMode] = useState<BsuidMode>("off");
  const [busy, setBusy] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setSlug(editing?.slug ?? "");
    setDescription(editing?.description ?? "");
    setBsuidMode((editing?.bsuid_mode as BsuidMode) ?? "off");
    setSlugTouched(!!editing);
  }, [open, editing]);

  const onName = (v: string) => {
    setName(v);
    if (!slugTouched && !editing) {
      setSlug(v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
    }
  };

  const submit = async () => {
    if (!name || !slug) return toast.error("Preencha nome e slug.");
    setBusy(true);
    const payload = { name, slug, description: description || null, bsuid_mode: bsuidMode };
    if (editing) {
      const { error } = await supabase.from("brands").update(payload).eq("id", editing.id);
      setBusy(false);
      if (error) return toast.error(error.message);
      toast.success("Workspace atualizado.");
    } else {
      const { error } = await supabase.from("brands").insert(payload);
      setBusy(false);
      if (error) return toast.error(error.message);
      toast.success("Workspace criado. Adicione canais para começar a atender.");
    }
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar workspace" : "Novo workspace"}</DialogTitle>
          <DialogDescription>
            Workspace é o agrupamento de cima. Cada workspace pode ter múltiplos canais (números).
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => onName(e.target.value)} placeholder="Ex.: Megafone" />
          </div>
          <div>
            <Label>Slug</Label>
            <Input
              value={slug}
              onChange={(e) => { setSlugTouched(true); setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-")); }}
              placeholder="megafone"
              className="font-mono"
            />
            <p className="mt-1 text-xs text-muted-foreground">Identificador único, sem espaços.</p>
          </div>
          <div>
            <Label>Descrição</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Opcional" />
          </div>
          <div className="rounded-lg border border-border p-3">
            <Label>Modo BSUID (Meta 2026)</Label>
            <Select value={bsuidMode} onValueChange={(v) => setBsuidMode(v as BsuidMode)}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Desligado — ignora BSUID/username (padrão)</SelectItem>
                <SelectItem value="shadow">Shadow — grava BSUID/username, envia por telefone</SelectItem>
                <SelectItem value="on">Ligado — usa BSUID para envio quando disponível</SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-2 text-xs text-muted-foreground">
              A partir de Jul/2026 a Meta começa a entregar identificadores Business-Scoped (BSUID) no lugar do telefone. Mantenha em <strong>Desligado</strong> até a virada; use <strong>Shadow</strong> para começar a coletar sem alterar disparos.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ChannelData {
  name: string;
  type: ChannelType;
  phone_number: string;
  phone_number_id: string;
  waba_id: string;
  business_id: string;
  app_id: string;
  token: string;
}

const emptyChannel: ChannelData = {
  name: "", type: "suporte",
  phone_number: "", phone_number_id: "", waba_id: "", business_id: "", app_id: "", token: "",
};

function ChannelDialog({
  ctx, onClose, onSaved,
}: { ctx: { brand: Brand; channel: Channel | null } | null; onClose: () => void; onSaved: () => void }) {
  const open = !!ctx;
  const editing = ctx?.channel ?? null;
  const [data, setData] = useState<ChannelData>(emptyChannel);
  const [busy, setBusy] = useState(false);
  const [validating, setValidating] = useState(false);
  const [credsOpen, setCredsOpen] = useState(true);
  const [validation, setValidation] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setValidation(null);
    if (editing) {
      setData({
        name: editing.name, type: editing.type,
        phone_number: editing.phone_number ?? "",
        phone_number_id: editing.phone_number_id ?? "",
        waba_id: editing.waba_id ?? "",
        business_id: editing.business_id ?? "",
        app_id: editing.app_id ?? "",
        token: "",
      });
      setCredsOpen(false);
    } else {
      setData(emptyChannel);
      setCredsOpen(true);
    }
  }, [open, editing]);

  const set = <K extends keyof ChannelData>(k: K, v: ChannelData[K]) =>
    setData((d) => ({ ...d, [k]: v }));

  const save = async (): Promise<string | null> => {
    if (!ctx) return null;
    if (!data.name) { toast.error("Informe o nome do canal."); return null; }
    if (!editing && data.type !== "webchat" && (!data.phone_number_id || !data.waba_id)) {
      toast.error("Phone Number ID e WABA ID são obrigatórios."); return null;
    }
    const payload = {
      brand_id: ctx.brand.id,
      name: data.name,
      type: data.type,
      phone_number: data.phone_number || null,
      phone_number_id: data.phone_number_id || null,
      waba_id: data.waba_id || null,
      business_id: data.business_id || null,
      app_id: data.app_id || null,
    };
    if (editing) {
      const { error } = await supabase.from("brand_channels").update(payload).eq("id", editing.id);
      if (error) { toast.error(error.message); return null; }
      return editing.id;
    }
    const { data: created, error } = await supabase.from("brand_channels").insert(payload).select("id").single();
    if (error) { toast.error(error.message); return null; }
    return created.id;
  };

  const handleSave = async () => {
    setBusy(true);
    const id = await save();
    setBusy(false);
    if (!id) return;
    toast.success(editing ? "Canal atualizado." : "Canal criado.");
    onSaved();
  };

  const handleValidate = async () => {
    setValidating(true);
    const id = await save();
    if (!id) { setValidating(false); return; }
    const { error } = await callFunction("validate-brand-token", {
      channel_id: id,
      ...(data.token ? { token: data.token } : {}),
    });
    setValidating(false);
    if (error) {
      setValidation({ ok: false, msg: error.message });
      toast.error(error.message);
    } else {
      setValidation({ ok: true, msg: "Token válido. Conexão com a Meta confirmada." });
      toast.success("Token validado.");
    }
  };

  const handleSyncTpl = async () => {
    const id = editing?.id ?? await save();
    if (!id) return;
    setBusy(true);
    const { data: res, error } = await callFunction<{ synced: number }>("sync-templates", { channel_id: id });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success(`${res?.synced ?? 0} templates sincronizados.`);
  };

  if (!ctx) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar canal" : "Novo canal"}</DialogTitle>
          <DialogDescription>
            Workspace: <strong>{ctx.brand.name}</strong>. Atribua agentes em Usuários após salvar.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {/* Identificação */}
          <section className="grid gap-3 rounded-lg border border-border p-4">
            <h4 className="text-sm font-semibold">Identificação</h4>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label>Nome do canal</Label>
                <Input value={data.name} onChange={(e) => set("name", e.target.value)} placeholder="Ex.: Megafone Vendas" />
              </div>
              <div>
                <Label>Tipo</Label>
                <Select value={data.type} onValueChange={(v) => set("type", v as ChannelType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="suporte">Suporte (WhatsApp)</SelectItem>
                    <SelectItem value="vendas">Vendas (WhatsApp)</SelectItem>
                    <SelectItem value="webchat">Webchat (site)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          {/* Embedded Signup — só ao criar canal novo. Disponível quando virarmos Tech Provider. */}
          {!editing && data.type !== "webchat" && (
            <section className="grid gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
              <div>
                <h4 className="text-sm font-semibold">Conectar via Embedded Signup</h4>
                <p className="text-xs text-muted-foreground">
                  Conexão guiada pela Meta: cria a WhatsApp Business Account, adiciona o número e
                  retorna o token automaticamente. Disponível apenas para apps aprovados como BSP/Tech Provider —
                  enquanto isso, use o cadastro manual abaixo.
                </p>
              </div>
              <div>
                <EmbeddedSignupButton
                  brandId={ctx.brand.id}
                  name={data.name}
                  type={data.type as "suporte" | "vendas"}
                  onSuccess={() => {
                    onSaved();
                  }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Ou preencha manualmente as credenciais abaixo se você já tem WABA e token criados.
              </p>
            </section>
          )}

          {/* Credenciais Meta — só para canais WhatsApp */}
          {data.type !== "webchat" && (
            <Collapsible open={credsOpen} onOpenChange={setCredsOpen}>
              <div className="rounded-lg border border-border">
                <CollapsibleTrigger className="flex w-full items-center justify-between p-4 text-left">
                  <div>
                    <h4 className="text-sm font-semibold">Credenciais Meta</h4>
                    <p className="text-xs text-muted-foreground">
                      {editing ? "Mantenha em branco para preservar o token atual." : "Necessário para enviar mensagens."}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-[10px]">{credsOpen ? "Recolher" : "Expandir"}</Badge>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="grid gap-3 border-t border-border p-4 md:grid-cols-2">
                    <div>
                      <Label>Número (display)</Label>
                      <Input value={data.phone_number} onChange={(e) => set("phone_number", e.target.value)} placeholder="+55 11 99999-0000" />
                    </div>
                    <div>
                      <Label>Phone Number ID</Label>
                      <Input value={data.phone_number_id} onChange={(e) => set("phone_number_id", e.target.value)} className="font-mono text-sm" />
                    </div>
                    <div>
                      <Label>WABA ID</Label>
                      <Input value={data.waba_id} onChange={(e) => set("waba_id", e.target.value)} className="font-mono text-sm" />
                    </div>
                    <div>
                      <Label>Business ID</Label>
                      <Input value={data.business_id} onChange={(e) => set("business_id", e.target.value)} className="font-mono text-sm" />
                    </div>
                    <div className="md:col-span-2">
                      <Label>App ID da Meta <span className="text-xs text-muted-foreground">(necessário para upload de mídia em templates)</span></Label>
                      <Input value={data.app_id} onChange={(e) => set("app_id", e.target.value)} className="font-mono text-sm" placeholder="ex.: 1074007127749337" />
                    </div>
                    <div className="md:col-span-2">
                      <Label>System User Token {editing && <span className="text-xs text-muted-foreground">(deixe em branco para manter)</span>}</Label>
                      <Input type="password" value={data.token} onChange={(e) => set("token", e.target.value)} placeholder="EAA..." />
                    </div>
                    <div className="md:col-span-2 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={handleValidate} disabled={validating || busy}>
                        {validating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                        Validar token
                      </Button>
                      <Button size="sm" variant="outline" onClick={handleSyncTpl} disabled={busy || validating}>
                        <FileText className="h-3.5 w-3.5" /> Sincronizar templates
                      </Button>
                    </div>
                    {validation && (
                      <div className={`md:col-span-2 rounded-md p-2 text-xs ${validation.ok ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                        {validation.msg}
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          )}

          {/* Configuração do Widget — só para canais Webchat */}
          {data.type === "webchat" && (
            editing ? (
              <WebchatWidgetSection channelId={editing.id} brandId={ctx.brand.id} />
            ) : (
              <section className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
                Salve o canal primeiro para configurar a aparência do widget e gerar o snippet de embed.
              </section>
            )
          )}

          {/* Distribuição automática */}
          {editing ? (
            <DistributionSection channelId={editing.id} />
          ) : (
            <section className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
              Salve o canal primeiro para configurar a distribuição automática entre atendentes.
            </section>
          )}
        </div>


        <DialogFooter className="mt-4">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={busy || validating}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Salvar canal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


interface AssigneeRow {
  kind: "human" | "ai";
  id: string; // user_id or agent_id
  name: string;
  subtitle: string | null;
  weight: number;
}

function DistributionSection({ channelId }: { channelId: string }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<AssigneeRow[]>([]);
  const [enabled, setEnabled] = useState<boolean>(false);
  const [savingFlag, setSavingFlag] = useState(false);

  const channelQ = useQuery({
    queryKey: ["channel-rr", channelId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brand_channels")
        .select("round_robin_enabled,brand_id")
        .eq("id", channelId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const brandId = (channelQ.data as { brand_id?: string } | undefined)?.brand_id;

  const assigneesQ = useQuery<AssigneeRow[]>({
    queryKey: ["channel-assignees", channelId, brandId],
    enabled: !!brandId,
    queryFn: async () => {
      // humanos vinculados ao canal
      const { data: ca, error: caErr } = await supabase
        .from("channel_agents")
        .select("user_id,weight")
        .eq("channel_id", channelId);
      if (caErr) throw caErr;
      const userIds = (ca ?? []).map((r) => r.user_id);
      let profs: Array<{ id: string; full_name: string | null; email: string | null }> = [];
      if (userIds.length > 0) {
        const { data, error } = await supabase
          .from("profiles").select("id,full_name,email").in("id", userIds);
        if (error) throw error;
        profs = data ?? [];
      }
      const byUser = new Map(profs.map((p) => [p.id, p]));
      const humans: AssigneeRow[] = (ca ?? []).map((r) => {
        const p = byUser.get(r.user_id);
        return {
          kind: "human" as const,
          id: r.user_id,
          name: p?.full_name ?? "(sem nome)",
          subtitle: p?.email ?? null,
          weight: r.weight ?? 0,
        };
      });

      // agentes de IA do workspace
      const { data: agents, error: agErr } = await supabase
        .from("ai_agents")
        .select("id,name,status")
        .eq("brand_id", brandId!);
      if (agErr) throw agErr;
      const { data: aca, error: acaErr } = await supabase
        .from("ai_agent_channel_assignments")
        .select("agent_id,weight")
        .eq("channel_id", channelId);
      if (acaErr) throw acaErr;
      const byAgent = new Map((aca ?? []).map((r) => [r.agent_id, r.weight ?? 0]));
      const ais: AssigneeRow[] = (agents ?? []).map((a) => ({
        kind: "ai" as const,
        id: a.id,
        name: a.name,
        subtitle: `Agente de IA · ${a.status}`,
        weight: byAgent.get(a.id) ?? 0,
      }));

      return [...humans, ...ais].sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  useEffect(() => {
    if (channelQ.data) setEnabled(!!(channelQ.data as { round_robin_enabled: boolean }).round_robin_enabled);
  }, [channelQ.data]);

  useEffect(() => {
    if (assigneesQ.data) setRows(assigneesQ.data);
  }, [assigneesQ.data]);

  const totalWeight = rows.reduce((s, r) => s + (Number.isFinite(r.weight) ? r.weight : 0), 0);

  const updatePercent = (kind: "human" | "ai", id: string, value: number) => {
    const v = Math.max(0, Math.min(100, Math.round(value || 0)));
    setRows((rs) => rs.map((r) => (r.kind === kind && r.id === id ? { ...r, weight: v } : r)));
  };

  const distributeEqually = () => {
    setRows((rs) => {
      const n = rs.length;
      if (n === 0) return rs;
      const base = Math.floor(100 / n);
      const remainder = 100 - base * n;
      return rs.map((r, i) => ({ ...r, weight: base + (i < remainder ? 1 : 0) }));
    });
  };

  const zeroAll = () => {
    setRows((rs) => rs.map((r) => ({ ...r, weight: 0 })));
  };

  const toggleEnabled = async (next: boolean) => {
    setSavingFlag(true);
    setEnabled(next);
    const { error } = await supabase
      .from("brand_channels")
      .update({ round_robin_enabled: next })
      .eq("id", channelId);
    setSavingFlag(false);
    if (error) {
      setEnabled(!next);
      toast.error(error.message);
    } else {
      qc.invalidateQueries({ queryKey: ["channel-rr", channelId] });
      qc.invalidateQueries({ queryKey: ["brand-channels"] });
    }
  };

  const saveWeights = useMutation({
    mutationFn: async () => {
      const humanOps = rows
        .filter((r) => r.kind === "human")
        .map((r) =>
          supabase.from("channel_agents")
            .update({ weight: r.weight })
            .eq("channel_id", channelId)
            .eq("user_id", r.id)
        );
      const aiRows = rows.filter((r) => r.kind === "ai");
      const aiUpserts = aiRows.length === 0 ? [] : [
        supabase.from("ai_agent_channel_assignments").upsert(
          aiRows.map((r) => ({ channel_id: channelId, agent_id: r.id, weight: r.weight })),
          { onConflict: "channel_id,agent_id" }
        ),
      ];
      const results = await Promise.all([...humanOps, ...aiUpserts]);
      const err = results.find((r) => r.error)?.error;
      if (err) throw new Error(err.message);
    },
    onSuccess: () => {
      toast.success("Distribuição atualizada.");
      qc.invalidateQueries({ queryKey: ["channel-assignees", channelId, brandId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="grid gap-3 rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="text-sm font-semibold">Distribuição automática</h4>
          <p className="text-xs text-muted-foreground">
            Defina o percentual de conversas que cada atendente (humano ou agente de IA) recebe automaticamente. A distribuição respeita o percentual mesmo quando o atendente está offline.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{enabled ? "Ativada" : "Desativada"}</span>
          <Switch checked={enabled} disabled={savingFlag} onCheckedChange={toggleEnabled} />
        </div>
      </div>

      {enabled && (
        <>
          {assigneesQ.isLoading ? (
            <div className="text-xs text-muted-foreground">Carregando atendentes...</div>
          ) : rows.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
              Nenhum atendente vinculado a este canal. Vincule humanos em <strong>Usuários</strong> ou crie um agente em <strong>Agentes de IA</strong>.
            </div>
          ) : (
            <>
              <div className="overflow-hidden rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Atendente</TableHead>
                      <TableHead className="w-32">Percentual (%)</TableHead>
                      <TableHead className="w-24 text-right">% efetivo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => {
                      const pct = totalWeight > 0 ? (r.weight / totalWeight) * 100 : 0;
                      return (
                        <TableRow key={`${r.kind}:${r.id}`}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Badge variant={r.kind === "ai" ? "secondary" : "outline"} className="text-[10px]">
                                {r.kind === "ai" ? "IA" : "Humano"}
                              </Badge>
                              <div>
                                <div className="font-medium">{r.name}</div>
                                <div className="text-xs text-muted-foreground">{r.subtitle ?? ""}</div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                min={0}
                                max={100}
                                step={1}
                                value={r.weight}
                                onChange={(e) => updatePercent(r.kind, r.id, Number(e.target.value))}
                                className="h-8 w-20"
                              />
                              <span className="text-xs text-muted-foreground">%</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {totalWeight === 0 ? "—" : `${pct.toFixed(1)}%`}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <Button size="sm" variant="outline" onClick={distributeEqually}>Distribuir igualmente</Button>
                  <Button size="sm" variant="outline" onClick={zeroAll}>Zerar</Button>
                  <span className={`text-xs ${totalWeight === 100 ? "text-muted-foreground" : "text-amber-600"}`}>
                    Soma: {totalWeight}%{totalWeight !== 100 && totalWeight > 0 ? " (será ajustada proporcionalmente)" : ""}
                  </span>
                </div>
                <Button size="sm" onClick={() => saveWeights.mutate()} disabled={saveWeights.isPending}>
                  {saveWeights.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Salvar
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Atendentes com 0% não recebem novas conversas. Agentes de IA com status "off" são ignorados na distribuição.
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}

