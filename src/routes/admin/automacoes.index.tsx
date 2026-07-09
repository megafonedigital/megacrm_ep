import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Pencil, Trash2, Workflow, Power, PowerOff, Loader2, Copy,
  LayoutGrid, List as ListIcon, Folder, FolderPlus, FolderOpen, MoreVertical, FolderInput, Search,
  Sparkles, ChevronRight, ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/auth";
import { useActiveBrand } from "@/lib/active-brand";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ImportFlowFromImageDialog } from "@/components/automations/ImportFlowFromImageDialog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/automacoes/")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  component: AutomacoesPage,
});

type ViewMode = "list" | "grid";
const VIEW_KEY = "automations_view_mode";
const EXPAND_KEY = "automations_folder_expanded";
const INCLUDE_SUB_KEY = "automations_include_subfolders";

type Folder = { id: string; name: string; color: string | null; position: number; parent_id: string | null };
type FolderNode = Folder & { children: FolderNode[]; depth: number };
type Automation = {
  id: string; name: string; status: string; brand_id: string;
  trigger_tag: string | null; trigger_type: string | null; updated_at: string;
  folder_id: string | null; graph: any; description: string | null;
  trigger_config: any; trigger_template_id: string | null;
};

const PLATFORM_LABEL: Record<string, string> = {
  hotmart: "Hotmart",
  shopify: "Shopify",
  sendflow: "SendFlow",
  activecampaign: "ActiveCampaign",
};

// ───────────── helpers de árvore ─────────────

function buildFolderTree(folders: Folder[]): FolderNode[] {
  const byId = new Map<string, FolderNode>();
  folders.forEach((f) => byId.set(f.id, { ...f, children: [], depth: 0 }));
  const roots: FolderNode[] = [];
  byId.forEach((node) => {
    if (node.parent_id && byId.has(node.parent_id)) {
      byId.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  const sortRec = (arr: FolderNode[], depth: number) => {
    arr.sort((a, b) => (a.position - b.position) || a.name.localeCompare(b.name, "pt-BR"));
    arr.forEach((n) => { n.depth = depth; sortRec(n.children, depth + 1); });
  };
  sortRec(roots, 0);
  return roots;
}

function flattenTree(roots: FolderNode[]): FolderNode[] {
  const out: FolderNode[] = [];
  const walk = (arr: FolderNode[]) => arr.forEach((n) => { out.push(n); walk(n.children); });
  walk(roots);
  return out;
}

function getDescendantIds(folders: Folder[], rootId: string): Set<string> {
  const children = new Map<string, string[]>();
  folders.forEach((f) => {
    if (f.parent_id) {
      if (!children.has(f.parent_id)) children.set(f.parent_id, []);
      children.get(f.parent_id)!.push(f.id);
    }
  });
  const out = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    (children.get(id) ?? []).forEach((c) => stack.push(c));
  }
  return out;
}

function getFolderPath(folders: Folder[], id: string): Folder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: Folder[] = [];
  let cur: Folder | undefined = byId.get(id);
  let hops = 0;
  while (cur && hops < 100) {
    path.unshift(cur);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    hops++;
  }
  return path;
}

function TriggerBadge({ a }: { a: Automation }) {
  const t = (a.trigger_type ?? "tag") as string;
  if (t === "manual") return <Badge variant="outline" className="text-[10px]">Manual / Broadcast</Badge>;
  if (t === "api") return <Badge variant="outline" className="text-[10px]">API (REST)</Badge>;
  if (t === "tag") {
    return <span className="text-xs text-muted-foreground truncate">Tag: {a.trigger_tag ?? "—"}</span>;
  }
  const label = PLATFORM_LABEL[t] ?? t;
  const cfg = (a.trigger_config ?? {}) as any;
  const events: string[] = Array.isArray(cfg.events) ? cfg.events.filter(Boolean) : (cfg.event ? [cfg.event] : []);
  const ev = events.length ? events.join(", ") : "qualquer evento";
  const platformTone: Record<string, string> = {
    hotmart: "border-warning/30 bg-warning/10 text-warning",
    shopify: "border-success/30 bg-success/10 text-success",
    sendflow: "border-info/30 bg-info/10 text-info",
    activecampaign: "border-ai/30 bg-ai/10 text-ai",
  };
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground truncate">
      <Badge variant="outline" className={`text-[10px] ${platformTone[t] ?? ""}`}>{label}</Badge>
      <span className="truncate">{ev}</span>
    </span>
  );
}

function AutomacoesPage() {
  const { me } = useMe();
  const { activeBrandId, activeBrand } = useActiveBrand();
  const qc = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [aiImportOpen, setAiImportOpen] = useState(false);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedFolder, setSelectedFolder] = useState<string | "all" | "none">("all");
  const [folderDialog, setFolderDialog] = useState<{ open: boolean; folder: Folder | null; defaultParentId: string | null }>({ open: false, folder: null, defaultParentId: null });
  const [folderDelete, setFolderDelete] = useState<Folder | null>(null);
  const [folderDeleteMode, setFolderDeleteMode] = useState<"reparent" | "flatten">("reparent");
  const [searchTerm, setSearchTerm] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [includeSubfolders, setIncludeSubfolders] = useState(true);

  useEffect(() => {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === "grid" || v === "list") setViewMode(v);
    try {
      const e = localStorage.getItem(EXPAND_KEY);
      if (e) setExpanded(JSON.parse(e));
    } catch { /* ignore */ }
    const inc = localStorage.getItem(INCLUDE_SUB_KEY);
    if (inc !== null) setIncludeSubfolders(inc === "1");
  }, []);
  useEffect(() => { localStorage.setItem(VIEW_KEY, viewMode); }, [viewMode]);
  useEffect(() => { localStorage.setItem(EXPAND_KEY, JSON.stringify(expanded)); }, [expanded]);
  useEffect(() => { localStorage.setItem(INCLUDE_SUB_KEY, includeSubfolders ? "1" : "0"); }, [includeSubfolders]);

  const foldersQ = useQuery({
    queryKey: ["automation_folders", activeBrandId],
    enabled: !!activeBrandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("automation_folders")
        .select("id, name, color, position, parent_id")
        .eq("brand_id", activeBrandId!)
        .order("position", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Folder[];
    },
  });

  const automationsQ = useQuery({
    queryKey: ["automations", activeBrandId],
    enabled: !!activeBrandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("automations")
        .select("id, name, status, brand_id, trigger_tag, trigger_type, updated_at, folder_id, graph, description, trigger_config, trigger_template_id")
        .eq("brand_id", activeBrandId!)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Automation[];
    },
  });

  useEffect(() => {
    if (!activeBrandId) return;
    const ch = supabase
      .channel(`automations-${activeBrandId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "automations", filter: `brand_id=eq.${activeBrandId}` },
        () => qc.invalidateQueries({ queryKey: ["automations", activeBrandId] })
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "automation_folders", filter: `brand_id=eq.${activeBrandId}` },
        () => qc.invalidateQueries({ queryKey: ["automation_folders", activeBrandId] })
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [activeBrandId, qc]);

  const folders = foldersQ.data ?? [];
  const tree = useMemo(() => buildFolderTree(folders), [folders]);
  const flatTree = useMemo(() => flattenTree(tree), [tree]);
  const folderById = (id: string | null) => folders.find((f) => f.id === id);

  const folderCount = (id: string, includeDescendants: boolean) => {
    const ids = includeDescendants ? getDescendantIds(folders, id) : new Set([id]);
    return (automationsQ.data ?? []).filter((a) => a.folder_id && ids.has(a.folder_id)).length;
  };

  const filteredAutomations = (automationsQ.data ?? []).filter((a) => {
    if (selectedFolder === "none") {
      if (a.folder_id) return false;
    } else if (selectedFolder !== "all") {
      const allowed = includeSubfolders ? getDescendantIds(folders, selectedFolder) : new Set([selectedFolder]);
      if (!a.folder_id || !allowed.has(a.folder_id)) return false;
    }
    const q = searchTerm.trim().toLowerCase();
    if (q && !(a.name ?? "").toLowerCase().includes(q)) return false;
    return true;
  });

  const toggleStatus = async (id: string, current: string) => {
    setBusy(true);
    const next = current === "active" ? "inactive" : "active";
    const { error } = await supabase.from("automations").update({ status: next }).eq("id", id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(next === "active" ? "Fluxo ativado" : "Fluxo desativado");
    qc.invalidateQueries({ queryKey: ["automations"] });
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    const { error } = await supabase.from("automations").delete().eq("id", deleting.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Fluxo excluído");
    setDeleting(null);
    qc.invalidateQueries({ queryKey: ["automations"] });
  };

  const handleDuplicate = async (a: Automation) => {
    const { data: u } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("automations")
      .insert({
        name: `${a.name} (cópia)`,
        brand_id: a.brand_id,
        folder_id: a.folder_id,
        graph: a.graph,
        trigger_type: a.trigger_type ?? undefined,
        trigger_tag: a.trigger_tag,
        trigger_config: a.trigger_config ?? {},
        trigger_template_id: a.trigger_template_id,
        description: a.description,
        status: "draft",
        created_by: u.user?.id ?? null,
      })
      .select("id")
      .single();
    if (error || !data) return toast.error(error?.message ?? "Erro ao duplicar");
    toast.success("Fluxo duplicado");
    qc.invalidateQueries({ queryKey: ["automations"] });
  };

  const moveToFolder = async (id: string, folderId: string | null) => {
    const { error } = await supabase.from("automations").update({ folder_id: folderId } as any).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(folderId ? "Movido para pasta" : "Removido da pasta");
    qc.invalidateQueries({ queryKey: ["automations"] });
  };

  const handleDeleteFolder = async () => {
    if (!folderDelete) return;
    setBusy(true);
    try {
      if (folderDeleteMode === "flatten") {
        // Achatar: mover TODAS automações descendentes pra "Sem pasta" e deletar a pasta + descendentes
        const descIds = Array.from(getDescendantIds(folders, folderDelete.id));
        if (descIds.length) {
          const { error: e1 } = await supabase.from("automations").update({ folder_id: null }).in("folder_id", descIds);
          if (e1) throw e1;
          const { error: e2 } = await supabase.from("automation_folders").delete().in("id", descIds);
          if (e2) throw e2;
        }
      } else {
        // Reparent: mover automações desta pasta + subpastas filhas diretas para o pai dela
        const targetParent = folderDelete.parent_id; // pode ser null = raiz
        const { error: e1 } = await supabase.from("automations")
          .update({ folder_id: targetParent }).eq("folder_id", folderDelete.id);
        if (e1) throw e1;
        // Filhas diretas viram filhas do pai
        const { error: e2 } = await supabase.from("automation_folders")
          .update({ parent_id: targetParent }).eq("parent_id", folderDelete.id);
        if (e2) throw e2;
        const { error: e3 } = await supabase.from("automation_folders").delete().eq("id", folderDelete.id);
        if (e3) throw e3;
      }
      toast.success("Pasta excluída");
      if (selectedFolder === folderDelete.id) setSelectedFolder("all");
      setFolderDelete(null);
      setFolderDeleteMode("reparent");
      qc.invalidateQueries({ queryKey: ["automation_folders"] });
      qc.invalidateQueries({ queryKey: ["automations"] });
    } catch (err: any) {
      toast.error(err?.message ?? "Erro ao excluir pasta");
    } finally {
      setBusy(false);
    }
  };

  if (!me?.isAdmin && !me?.isSupervisor && !me?.isDeveloper) {
    return <div className="p-6 text-sm text-muted-foreground">Você não tem permissão para acessar automações.</div>;
  }

  const selectedPath = (selectedFolder !== "all" && selectedFolder !== "none") ? getFolderPath(folders, selectedFolder) : [];

  return (
    <div className="page-container space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Workflow className="h-6 w-6" /> Automações
          </h1>
          <p className="text-sm text-muted-foreground">
            Crie fluxos drag &amp; drop disparados quando um template é enviado.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar fluxo…"
              className="pl-8 h-9 w-[240px]"
            />
          </div>
          <div className="flex items-center rounded-md border border-input">
            <Button
              size="sm"
              variant={viewMode === "list" ? "secondary" : "ghost"}
              className="rounded-r-none"
              onClick={() => setViewMode("list")}
              title="Lista"
            >
              <ListIcon className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              className="rounded-l-none"
              onClick={() => setViewMode("grid")}
              title="Blocos"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
          </div>
          <Button
            variant="outline"
            onClick={() => setAiImportOpen(true)}
            className="border-ai/40 text-ai hover:bg-ai/10 hover:text-ai"
          >
            <Sparkles className="h-4 w-4 mr-1" /> Gerar com IA
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Novo fluxo
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-[260px_1fr] gap-4">
        {/* Sidebar de pastas */}
        <Card className="p-2 h-fit">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Pastas</span>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={() => setFolderDialog({ open: true, folder: null, defaultParentId: null })}
              title="Nova pasta"
            >
              <FolderPlus className="h-4 w-4" />
            </Button>
          </div>
          <div className="space-y-0.5">
            <FolderItemSimple
              icon={<FolderOpen className="h-4 w-4" />}
              label="Todas"
              active={selectedFolder === "all"}
              onClick={() => setSelectedFolder("all")}
              count={automationsQ.data?.length ?? 0}
            />
            <FolderItemSimple
              icon={<Folder className="h-4 w-4" />}
              label="Sem pasta"
              active={selectedFolder === "none"}
              onClick={() => setSelectedFolder("none")}
              count={(automationsQ.data ?? []).filter((a) => !a.folder_id).length}
            />
            {tree.map((node) => (
              <FolderTreeNode
                key={node.id}
                node={node}
                selectedId={selectedFolder}
                expanded={expanded}
                onToggleExpand={(id) => setExpanded((s) => ({ ...s, [id]: !s[id] }))}
                onSelect={(id) => setSelectedFolder(id)}
                onEdit={(f) => setFolderDialog({ open: true, folder: f, defaultParentId: f.parent_id })}
                onDelete={(f) => { setFolderDelete(f); setFolderDeleteMode("reparent"); }}
                onCreateChild={(parentId) => setFolderDialog({ open: true, folder: null, defaultParentId: parentId })}
                count={(id) => folderCount(id, false)}
                totalCount={(id) => folderCount(id, true)}
              />
            ))}
            {foldersQ.isLoading && <div className="px-2 py-1 text-xs text-muted-foreground">Carregando…</div>}
          </div>
        </Card>

        {/* Conteúdo */}
        <div className="space-y-3">
          {/* Breadcrumb + toggle subpastas */}
          {selectedPath.length > 0 && (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-1 text-sm flex-wrap">
                <button
                  className="text-muted-foreground hover:text-foreground hover:underline"
                  onClick={() => setSelectedFolder("all")}
                >
                  Todas
                </button>
                {selectedPath.map((f, idx) => (
                  <span key={f.id} className="flex items-center gap-1">
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    <button
                      className={cn(
                        "hover:underline",
                        idx === selectedPath.length - 1 ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
                      )}
                      onClick={() => setSelectedFolder(f.id)}
                    >
                      {f.name}
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch id="include-sub" checked={includeSubfolders} onCheckedChange={setIncludeSubfolders} />
                <Label htmlFor="include-sub" className="cursor-pointer">Incluir subpastas</Label>
              </div>
            </div>
          )}

          {viewMode === "list" ? (
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Pasta</TableHead>
                    <TableHead>Gatilho</TableHead>
                    <TableHead>ID</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Atualizado</TableHead>
                    <TableHead className="w-[60px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {automationsQ.isLoading && (
                    <TableRow><TableCell colSpan={7} className="text-center py-6"><Loader2 className="h-4 w-4 animate-spin inline" /></TableCell></TableRow>
                  )}
                  {!automationsQ.isLoading && filteredAutomations.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center py-10 text-sm text-muted-foreground">
                      Nenhum fluxo nesta visão.
                    </TableCell></TableRow>
                  )}
                  {filteredAutomations.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">
                        <Link to="/admin/automacoes/$id" params={{ id: a.id }} className="hover:underline">{a.name}</Link>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {a.folder_id ? getFolderPath(folders, a.folder_id).map((p) => p.name).join(" › ") : "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        <TriggerBadge a={a} />
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          className="font-mono text-[10px] text-muted-foreground hover:text-foreground"
                          onClick={() => { navigator.clipboard.writeText(a.id); toast.success("ID copiado"); }}
                          title="Copiar ID"
                        >{a.id.slice(0, 8)}…</button>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={
                          a.status === "active"
                            ? "border-success/30 bg-success/10 text-success"
                            : a.status === "inactive"
                              ? "border-border bg-muted text-muted-foreground"
                              : "border-border bg-secondary text-secondary-foreground"
                        }>
                          {a.status === "active" ? "Ativo" : a.status === "inactive" ? "Inativo" : "Rascunho"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(a.updated_at).toLocaleString("pt-BR")}
                      </TableCell>
                      <TableCell>
                        <RowMenu
                          a={a}
                          flatTree={flatTree}
                          busy={busy}
                          onEdit={() => { window.location.href = `/admin/automacoes/${a.id}`; }}
                          onToggle={() => toggleStatus(a.id, a.status)}
                          onDuplicate={() => handleDuplicate(a)}
                          onDelete={() => setDeleting({ id: a.id, name: a.name })}
                          onMove={(fid) => moveToFolder(a.id, fid)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {automationsQ.isLoading && (
                <div className="col-span-full text-center py-10"><Loader2 className="h-4 w-4 animate-spin inline" /></div>
              )}
              {!automationsQ.isLoading && filteredAutomations.length === 0 && (
                <div className="col-span-full text-center py-10 text-sm text-muted-foreground">Nenhum fluxo nesta visão.</div>
              )}
              {filteredAutomations.map((a) => (
                <Card key={a.id} className="p-4 flex flex-col gap-2 hover:border-primary/50 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <Link to="/admin/automacoes/$id" params={{ id: a.id }} className="font-medium hover:underline line-clamp-2">
                      {a.name}
                    </Link>
                    <RowMenu
                      a={a}
                      flatTree={flatTree}
                      busy={busy}
                      onEdit={() => { window.location.href = `/admin/automacoes/${a.id}`; }}
                      onToggle={() => toggleStatus(a.id, a.status)}
                      onDuplicate={() => handleDuplicate(a)}
                      onDelete={() => setDeleting({ id: a.id, name: a.name })}
                      onMove={(fid) => moveToFolder(a.id, fid)}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={a.status === "active" ? "default" : a.status === "inactive" ? "secondary" : "outline"}>
                      {a.status === "active" ? "Ativo" : a.status === "inactive" ? "Inativo" : "Rascunho"}
                    </Badge>
                    {(a.trigger_type ?? "tag") === "manual"
                      ? <Badge variant="outline" className="text-[10px]">Manual / Broadcast</Badge>
                      : (a.trigger_type ?? "tag") === "api"
                        ? <Badge variant="outline" className="text-[10px]">API (REST)</Badge>
                        : (a.trigger_type ?? "tag") === "tag"
                          ? <span className="text-xs text-muted-foreground truncate">Tag: {a.trigger_tag ?? "—"}</span>
                          : <TriggerBadge a={a} />}
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground mt-auto pt-2">
                    <span className="flex items-center gap-1 truncate">
                      <Folder className="h-3 w-3 shrink-0" />
                      <span className="truncate">
                        {a.folder_id ? getFolderPath(folders, a.folder_id).map((p) => p.name).join(" › ") : "Sem pasta"}
                      </span>
                    </span>
                    <span className="shrink-0">{new Date(a.updated_at).toLocaleDateString("pt-BR")}</span>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      <CreateAutomationDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        brandId={activeBrandId}
        brandName={activeBrand?.name ?? null}
        folderId={selectedFolder !== "all" && selectedFolder !== "none" ? selectedFolder : null}
        onCreated={() => qc.invalidateQueries({ queryKey: ["automations"] })}
      />

      <ImportFlowFromImageDialog
        open={aiImportOpen}
        onOpenChange={setAiImportOpen}
        brandId={activeBrandId}
        brandName={activeBrand?.name ?? null}
        folderId={selectedFolder !== "all" && selectedFolder !== "none" ? selectedFolder : null}
        onCreated={() => qc.invalidateQueries({ queryKey: ["automations"] })}
      />

      <FolderDialog
        open={folderDialog.open}
        onOpenChange={(o) => setFolderDialog((s) => ({ ...s, open: o }))}
        folder={folderDialog.folder}
        defaultParentId={folderDialog.defaultParentId}
        brandId={activeBrandId}
        flatTree={flatTree}
        onSaved={() => qc.invalidateQueries({ queryKey: ["automation_folders"] })}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir fluxo</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir &quot;{deleting?.name}&quot;? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={busy}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!folderDelete} onOpenChange={(o) => { if (!o) { setFolderDelete(null); setFolderDeleteMode("reparent"); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir pasta</AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                if (!folderDelete) return null;
                const subCount = getDescendantIds(folders, folderDelete.id).size - 1;
                const autoCount = folderCount(folderDelete.id, true);
                const parentName = folderDelete.parent_id ? (folderById(folderDelete.parent_id)?.name ?? "—") : "Sem pasta";
                return (
                  <>
                    Excluir <strong>&quot;{folderDelete.name}&quot;</strong>
                    {subCount > 0 ? <> com <strong>{subCount}</strong> subpasta(s)</> : null}
                    {autoCount > 0 ? <> contendo <strong>{autoCount}</strong> automação(ões)</> : null}?
                    <div className="mt-4">
                      <RadioGroup value={folderDeleteMode} onValueChange={(v) => setFolderDeleteMode(v as any)}>
                        <div className="flex items-start gap-2 py-1">
                          <RadioGroupItem value="reparent" id="m-reparent" className="mt-1" />
                          <Label htmlFor="m-reparent" className="cursor-pointer font-normal">
                            Mover conteúdo para <strong>{parentName}</strong>
                            <span className="block text-xs text-muted-foreground">Subpastas e automações sobem um nível.</span>
                          </Label>
                        </div>
                        <div className="flex items-start gap-2 py-1">
                          <RadioGroupItem value="flatten" id="m-flatten" className="mt-1" />
                          <Label htmlFor="m-flatten" className="cursor-pointer font-normal">
                            Excluir esta pasta e todas as subpastas
                            <span className="block text-xs text-muted-foreground">Todas as automações vão para &quot;Sem pasta&quot;.</span>
                          </Label>
                        </div>
                      </RadioGroup>
                    </div>
                  </>
                );
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteFolder} disabled={busy}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FolderItemSimple({
  icon, label, active, onClick, count,
}: {
  icon: React.ReactNode; label: string; active: boolean; onClick: () => void; count: number;
}) {
  return (
    <div className={cn(
      "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer",
      active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
    )} onClick={onClick}>
      {icon}
      <span className="flex-1 truncate">{label}</span>
      <span className="text-xs text-muted-foreground">{count}</span>
    </div>
  );
}

function FolderTreeNode({
  node, selectedId, expanded, onToggleExpand, onSelect, onEdit, onDelete, onCreateChild, count, totalCount,
}: {
  node: FolderNode;
  selectedId: string | "all" | "none";
  expanded: Record<string, boolean>;
  onToggleExpand: (id: string) => void;
  onSelect: (id: string) => void;
  onEdit: (f: Folder) => void;
  onDelete: (f: Folder) => void;
  onCreateChild: (parentId: string) => void;
  count: (id: string) => number;
  totalCount: (id: string) => number;
}) {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded[node.id] ?? false;
  const active = selectedId === node.id;
  const own = count(node.id);
  const total = totalCount(node.id);
  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-1 rounded-md px-1.5 py-1.5 text-sm cursor-pointer",
          active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
        )}
        style={{ paddingLeft: `${6 + node.depth * 14}px` }}
        onClick={() => onSelect(node.id)}
      >
        <button
          type="button"
          className={cn(
            "h-4 w-4 flex items-center justify-center text-muted-foreground hover:text-foreground shrink-0",
            !hasChildren && "invisible"
          )}
          onClick={(e) => { e.stopPropagation(); if (hasChildren) onToggleExpand(node.id); }}
          aria-label={isOpen ? "Recolher" : "Expandir"}
        >
          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <Folder className="h-4 w-4 shrink-0" style={{ color: node.color ?? undefined }} />
        <span className="flex-1 truncate">{node.name}</span>
        <span className="text-xs text-muted-foreground tabular-nums" title={hasChildren ? `Total com subpastas: ${total}` : undefined}>
          {hasChildren && total !== own ? `${own}/${total}` : own}
        </span>
        <button
          type="button"
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground p-0.5"
          onClick={(e) => { e.stopPropagation(); onCreateChild(node.id); }}
          title="Nova subpasta"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <button className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground p-0.5">
              <MoreVertical className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onClick={() => onCreateChild(node.id)}>
              <FolderPlus className="h-3.5 w-3.5 mr-2" />Nova subpasta
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onEdit(node)}>
              <Pencil className="h-3.5 w-3.5 mr-2" />Editar
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onDelete(node)} className="text-destructive">
              <Trash2 className="h-3.5 w-3.5 mr-2" />Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {hasChildren && isOpen && (
        <div>
          {node.children.map((child) => (
            <FolderTreeNode
              key={child.id}
              node={child}
              selectedId={selectedId}
              expanded={expanded}
              onToggleExpand={onToggleExpand}
              onSelect={onSelect}
              onEdit={onEdit}
              onDelete={onDelete}
              onCreateChild={onCreateChild}
              count={count}
              totalCount={totalCount}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RowMenu({
  a, flatTree, busy, onEdit, onToggle, onDuplicate, onDelete, onMove,
}: {
  a: Automation; flatTree: FolderNode[]; busy: boolean;
  onEdit: () => void; onToggle: () => void; onDuplicate: () => void; onDelete: () => void;
  onMove: (folderId: string | null) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="h-8 w-8"><MoreVertical className="h-4 w-4" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onEdit}><Pencil className="h-4 w-4 mr-2" />Editar</DropdownMenuItem>
        <DropdownMenuItem onClick={onToggle} disabled={busy}>
          {a.status === "active" ? <><PowerOff className="h-4 w-4 mr-2" />Desativar</> : <><Power className="h-4 w-4 mr-2" />Ativar</>}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onDuplicate}><Copy className="h-4 w-4 mr-2" />Duplicar</DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger><FolderInput className="h-4 w-4 mr-2" />Mover para…</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-[320px] overflow-auto">
            <DropdownMenuLabel className="text-xs">Pastas</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => onMove(null)} disabled={!a.folder_id}>
              <Folder className="h-4 w-4 mr-2 text-muted-foreground" />Sem pasta
            </DropdownMenuItem>
            {flatTree.length > 0 && <DropdownMenuSeparator />}
            {flatTree.map((f) => (
              <DropdownMenuItem
                key={f.id}
                onClick={() => onMove(f.id)}
                disabled={a.folder_id === f.id}
                style={{ paddingLeft: `${8 + f.depth * 14}px` }}
              >
                <Folder className="h-4 w-4 mr-2" style={{ color: f.color ?? undefined }} />{f.name}
              </DropdownMenuItem>
            ))}
            {flatTree.length === 0 && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">Nenhuma pasta criada</div>
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onDelete} className="text-destructive">
          <Trash2 className="h-4 w-4 mr-2" />Excluir
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FolderDialog({
  open, onOpenChange, folder, defaultParentId, brandId, flatTree, onSaved,
}: {
  open: boolean; onOpenChange: (o: boolean) => void;
  folder: Folder | null; defaultParentId: string | null;
  brandId: string | null; flatTree: FolderNode[]; onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>("#64748b");
  const [parentId, setParentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(folder?.name ?? "");
      setColor(folder?.color ?? "#64748b");
      setParentId(folder ? folder.parent_id : defaultParentId);
    }
  }, [open, folder, defaultParentId]);

  // Opções de pai: excluir a própria pasta e seus descendentes (evita ciclo)
  const forbidden = useMemo(() => {
    if (!folder) return new Set<string>();
    return getDescendantIds(flatTree.map((n) => ({ id: n.id, name: n.name, color: n.color, position: n.position, parent_id: n.parent_id })), folder.id);
  }, [folder, flatTree]);

  const parentOptions = flatTree.filter((n) => !forbidden.has(n.id));

  const submit = async () => {
    if (!name.trim()) return toast.error("Preencha o nome");
    if (!folder && !brandId) return toast.error("Selecione um workspace");
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    if (folder) {
      const { error } = await supabase.from("automation_folders")
        .update({ name: name.trim(), color, parent_id: parentId }).eq("id", folder.id);
      setBusy(false);
      if (error) return toast.error(error.message);
      toast.success("Pasta atualizada");
    } else {
      const { error } = await supabase.from("automation_folders")
        .insert({ name: name.trim(), color, brand_id: brandId!, parent_id: parentId, created_by: u.user?.id ?? null });
      setBusy(false);
      if (error) return toast.error(error.message);
      toast.success("Pasta criada");
    }
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{folder ? "Editar pasta" : "Nova pasta"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Boas-vindas" />
          </div>
          <div>
            <Label>Pasta pai</Label>
            <Select
              value={parentId ?? "__root__"}
              onValueChange={(v) => setParentId(v === "__root__" ? null : v)}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Pasta raiz (nenhuma)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__root__">— Pasta raiz —</SelectItem>
                {parentOptions.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    <span style={{ paddingLeft: `${n.depth * 12}px` }}>{n.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {folder && forbidden.size > 1 && (
              <p className="text-[11px] text-muted-foreground mt-1">A própria pasta e suas subpastas não aparecem como pai (evita ciclos).</p>
            )}
          </div>
          <div>
            <Label>Cor</Label>
            <div className="flex items-center gap-2 mt-1">
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-10 rounded border border-input cursor-pointer" />
              <span className="text-xs text-muted-foreground">{color}</span>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}{folder ? "Salvar" : "Criar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateAutomationDialog({
  open, onOpenChange, brandId, brandName, folderId, onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  brandId: string | null;
  brandName: string | null;
  folderId: string | null;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim() || !brandId) return toast.error("Preencha o nome e selecione um workspace");
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("automations")
      .insert({
        name: name.trim(),
        brand_id: brandId,
        folder_id: folderId,
        created_by: u.user?.id ?? null,
        status: "draft",
        graph: {
          nodes: [
            { id: "trigger-1", type: "trigger", position: { x: 100, y: 100 }, data: { tag: "" } },
          ],
          edges: [],
        },
      })
      .select("id")
      .single();
    setBusy(false);
    if (error || !data) return toast.error(error?.message ?? "Erro");
    toast.success("Fluxo criado");
    onOpenChange(false);
    setName("");
    onCreated();
    window.location.href = `/admin/automacoes/${data.id}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Novo fluxo</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Boas-vindas após template promo" />
          </div>
          <div className="text-xs text-muted-foreground">
            Workspace: <strong>{brandName ?? "—"}</strong>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Criar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
