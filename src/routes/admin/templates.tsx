import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, RefreshCw, Loader2, MoreHorizontal, Pencil, Trash2, Copy, Eye, FileText, Workflow, Sparkles } from "lucide-react";
import { GenerateTemplatesWithAIDialog } from "@/components/templates/GenerateTemplatesWithAIDialog";
import { buildTemplateFlow } from "@/lib/automation-templates";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/auth";
import { useActiveBrand } from "@/lib/active-brand";
import { callFunction } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TemplateFormDialog, type TemplateRow, type TemplateChannel } from "@/components/templates/TemplateFormDialog";
import { TemplatePreview, type TemplatePreviewData } from "@/components/templates/TemplatePreview";

export const Route = createFileRoute("/admin/templates")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  component: TemplatesPage,
});

function statusVariant(s: string): "default" | "secondary" | "destructive" | "outline" {
  if (s === "APPROVED") return "default";
  if (s === "PENDING" || s === "IN_APPEAL") return "secondary";
  if (s === "REJECTED" || s === "DISABLED" || s === "PAUSED") return "destructive";
  return "outline";
}

function TemplatesPage() {
  const { me } = useMe();
  const { activeBrandId } = useActiveBrand();
  const [channelId, setChannelId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const [deleting, setDeleting] = useState<TemplateRow | null>(null);
  const [previewing, setPreviewing] = useState<TemplateRow | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [busyDelete, setBusyDelete] = useState(false);
  const [creatingFlowId, setCreatingFlowId] = useState<string | null>(null);

  const createFlowFromTemplate = async (t: TemplateRow) => {
    if (t.status !== "APPROVED") return;
    setCreatingFlowId(t.id);
    try {
      const { data: u } = await supabase.auth.getUser();
      const graph = buildTemplateFlow(t.id);
      const { data, error } = await supabase
        .from("automations")
        .insert({
          name: `Fluxo — ${t.name}`,
          brand_id: t.brand_id,
          status: "draft",
          trigger_type: "manual",
          trigger_tag: null,
          trigger_config: {},
          created_by: u.user?.id ?? null,
          graph: graph as any,
        })
        .select("id")
        .single();
      if (error || !data) {
        toast.error(error?.message ?? "Erro ao criar fluxo");
        return;
      }
      toast.success("Fluxo criado");
      window.location.href = `/admin/automacoes/${data.id}`;
    } finally {
      setCreatingFlowId(null);
    }
  };

  const channelsQ = useQuery({
    queryKey: ["template-channels", activeBrandId],
    enabled: !!activeBrandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brand_channels")
        .select("id, brand_id, name, app_id, waba_id, brands(name)")
        .eq("brand_id", activeBrandId!)
        .order("name");
      if (error) throw error;
      return data as Array<TemplateChannel & { brands: { name: string } | null }>;
    },
  });

  // resetar canal ao trocar workspace
  useEffect(() => { setChannelId(null); }, [activeBrandId]);
  // selecionar primeiro canal por padrão quando a lista carregar
  useEffect(() => {
    const list = channelsQ.data;
    if (!list) return;
    if (list.length === 0) { if (channelId !== null) setChannelId(null); return; }
    if (!channelId || !list.find((c) => c.id === channelId)) setChannelId(list[0].id);
  }, [channelsQ.data, channelId]);

  const selectedChannel = channelsQ.data?.find((c) => c.id === channelId) ?? null;

  const templatesQ = useQuery({
    queryKey: ["templates", channelId, selectedChannel?.waba_id ?? null, activeBrandId],
    enabled: !!channelId && !!activeBrandId,
    queryFn: async () => {
      // Templates são da WABA: listar todos cujo channel_id pertença a algum
      // brand_channel do workspace que compartilhe a mesma waba_id do canal selecionado.
      let channelIds: string[] = [channelId!];
      if (selectedChannel?.waba_id) {
        const { data: siblings } = await supabase
          .from("brand_channels")
          .select("id")
          .eq("brand_id", activeBrandId!)
          .eq("waba_id", selectedChannel.waba_id);
        const ids = (siblings ?? []).map((c: any) => c.id);
        if (ids.length > 0) channelIds = ids;
      }
      const { data, error } = await supabase
        .from("whatsapp_templates")
        .select("id, brand_id, channel_id, meta_template_id, name, language, category, status, components, variables_count, header_type, header_handle, synced_at, variable_bindings")
        .in("channel_id", channelIds)
        .order("name");
      if (error) throw error;
      return data as TemplateRow[];
    },
  });

  const filtered = useMemo(() => {
    const list = templatesQ.data ?? [];
    return list.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (categoryFilter !== "all" && t.category !== categoryFilter) return false;
      if (search && !t.name.includes(search.toLowerCase())) return false;
      return true;
    });
  }, [templatesQ.data, statusFilter, categoryFilter, search]);

  const handleSync = async () => {
    if (!channelId) return;
    setSyncing(true);
    try {
      const { data, error } = await callFunction<{ synced: number }>("sync-templates", { channel_id: channelId });
      if (error) {
        toast.error(error.message ?? "Falha ao sincronizar templates.");
      } else {
        toast.success(`${data?.synced ?? 0} templates meta sincronizados.`);
        templatesQ.refetch();
      }
    } catch (e: any) {
      toast.error(e?.message?.includes("Failed to fetch")
        ? "Falha de rede ao sincronizar — tente novamente."
        : (e?.message ?? "Erro inesperado ao sincronizar."));
    } finally {
      setSyncing(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setBusyDelete(true);
    const { error } = await callFunction("delete-template", { template_id: deleting.id });
    setBusyDelete(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Template removido.");
    setDeleting(null);
    templatesQ.refetch();
  };

  if (!me?.isAdmin && !me?.isSupervisor && !me?.isDeveloper) {
    return <div className="p-8 text-sm text-muted-foreground">Acesso restrito.</div>;
  }

  return (
    <div className="page-container space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><FileText className="h-6 w-6" /> Templates Meta</h1>
          <p className="text-sm text-muted-foreground">Gerencie modelos aprovados pela Meta para uso fora da janela de 24h.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={channelId ?? ""} onValueChange={(v) => setChannelId(v)}>
            <SelectTrigger className="w-[260px]"><SelectValue placeholder="Selecione um canal WhatsApp" /></SelectTrigger>
            <SelectContent>
              {(channelsQ.data ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={handleSync} disabled={!channelId || syncing}>
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Sincronizar
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAiOpen(true)} disabled={!channelId}>
            <Sparkles className="h-4 w-4" /> Gerar com IA
          </Button>
          <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }} disabled={!channelId}>
            <Plus className="h-4 w-4" /> Novo template
          </Button>
        </div>
      </div>

      {!activeBrandId && (
        <Card className="p-6 text-sm text-muted-foreground">Selecione um workspace no topo para gerenciar templates.</Card>
      )}

      {activeBrandId && !channelsQ.isLoading && (channelsQ.data?.length ?? 0) === 0 && (
        <Card className="p-6 text-sm text-muted-foreground">
          Este workspace ainda não possui canais WhatsApp. Adicione um canal em <a href="/admin/marcas" className="underline text-foreground">Workspaces</a> antes de gerenciar templates.
        </Card>
      )}

      {selectedChannel && !selectedChannel.waba_id && (
        <Card className="p-4 text-sm text-destructive">Este canal não tem WABA ID configurado. Edite o canal em Workspaces.</Card>
      )}

      {channelId && (


      <Card className="p-4">
        <div className="flex flex-wrap gap-2 mb-4">
          <Input placeholder="Buscar por nome..." value={search} onChange={(e) => setSearch(e.target.value.toLowerCase())} className="max-w-xs" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos status</SelectItem>
              <SelectItem value="APPROVED">Aprovado</SelectItem>
              <SelectItem value="PENDING">Pendente</SelectItem>
              <SelectItem value="REJECTED">Rejeitado</SelectItem>
              <SelectItem value="PAUSED">Pausado</SelectItem>
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas categorias</SelectItem>
              <SelectItem value="UTILITY">Utility</SelectItem>
              <SelectItem value="MARKETING">Marketing</SelectItem>
              <SelectItem value="AUTHENTICATION">Authentication</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <TooltipProvider>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Idioma</TableHead>
              <TableHead>Variáveis</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Ação</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templatesQ.isLoading && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8"><Loader2 className="h-4 w-4 animate-spin inline" /> Carregando...</TableCell></TableRow>
            )}
            {!templatesQ.isLoading && filtered.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Nenhum template meta. Sincronize ou crie um novo.</TableCell></TableRow>
            )}
            {filtered.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-mono text-sm">{t.name}</TableCell>
                <TableCell><Badge variant="outline">{t.category}</Badge></TableCell>
                <TableCell className="text-sm">{t.language}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{t.variables_count}</TableCell>
                <TableCell><Badge variant={statusVariant(t.status)}>{t.status}</Badge></TableCell>
                <TableCell>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={t.status !== "APPROVED" || creatingFlowId === t.id}
                          onClick={() => createFlowFromTemplate(t)}
                        >
                          {creatingFlowId === t.id ? (
                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                          ) : (
                            <Workflow className="h-4 w-4 mr-1" />
                          )}
                          Criar fluxo
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t.status === "APPROVED"
                        ? "Criar um fluxo padrão usando este template"
                        : "Disponível apenas para templates aprovados"}
                    </TooltipContent>
                  </Tooltip>
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setPreviewing(t)}>
                        <Eye className="h-4 w-4" /> Pré-visualizar
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { setEditing(t); setFormOpen(true); }} disabled={t.status !== "APPROVED" && t.status !== "PAUSED"}>
                        <Pencil className="h-4 w-4" /> Editar
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { setEditing({ ...t, id: "", meta_template_id: null, name: `${t.name}_copia` } as TemplateRow); setFormOpen(true); }}>
                        <Copy className="h-4 w-4" /> Duplicar
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-destructive" onClick={() => setDeleting(t)}>
                        <Trash2 className="h-4 w-4" /> Excluir
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </TooltipProvider>
      </Card>
      )}

      <TemplateFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        channel={selectedChannel}
        template={editing && editing.id ? editing : null}
        onSaved={() => templatesQ.refetch()}
      />

      <GenerateTemplatesWithAIDialog
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        channel={selectedChannel}
        onSaved={() => templatesQ.refetch()}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir template?</AlertDialogTitle>
            <AlertDialogDescription>
              O template <strong>{deleting?.name}</strong> será removido da Meta e do MegaCRM. Não é possível desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyDelete}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={busyDelete}>
              {busyDelete && <Loader2 className="h-4 w-4 animate-spin" />} Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!previewing} onOpenChange={(o) => !o && setPreviewing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{previewing?.name}</DialogTitle></DialogHeader>
          {previewing && <TemplatePreview data={componentsToPreview(previewing)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function componentsToPreview(t: TemplateRow): TemplatePreviewData {
  const comps = (t.components ?? []) as any[];
  const header = comps.find((c) => c.type === "HEADER");
  const bodyC = comps.find((c) => c.type === "BODY");
  const footerC = comps.find((c) => c.type === "FOOTER");
  const btnC = comps.find((c) => c.type === "BUTTONS");
  return {
    headerKind: !header ? "none" : header.format === "TEXT" ? "text" : "media",
    headerText: header?.text,
    headerMediaType: header?.format && header.format !== "TEXT" ? header.format : undefined,
    headerMediaPreviewUrl: null,
    body: bodyC?.text ?? "",
    footer: footerC?.text ?? "",
    buttons: (btnC?.buttons ?? []).map((b: any) => ({ type: b.type, text: b.text, url: b.url })),
  };
}
