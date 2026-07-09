import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/auth";
import { useActiveBrand } from "@/lib/active-brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Plus, Pencil, Trash2, KanbanSquare, Loader2, Search, LayoutTemplate,
  Folder, FolderPlus, MoreHorizontal, FolderInput, Inbox,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { PipelineFormDialog } from "@/components/pipelines/PipelineFormDialog";
import { PipelineTemplatesDialog } from "@/components/pipelines/PipelineTemplatesDialog";
import { PipelineFolderDialog, type PipelineFolder } from "@/components/pipelines/PipelineFolderDialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pipelines/")({
  component: PipelinesIndex,
});

interface PipelineRow {
  id: string;
  brand_id: string;
  name: string;
  description: string | null;
  pos: number;
  distribution_mode: "none" | "round_robin" | "random" | null;
  distribution_user_ids: string[] | null;
  distribution_ai_agent_ids: string[] | null;
  brand_name: string | null;
  stage_count: number;
  card_count: number;
  folder_id: string | null;
}

type FolderFilter = "__all__" | "__none__" | string;

function PipelinesIndex() {
  const { me } = useMe();
  const { activeBrandId, activeBrand } = useActiveBrand();
  const qc = useQueryClient();
  const canManage = !!(me?.isAdmin || me?.isSupervisor || me?.isDeveloper);
  const [openForm, setOpenForm] = useState(false);
  const [openTemplates, setOpenTemplates] = useState(false);
  const [editing, setEditing] = useState<PipelineRow | null>(null);
  const [deleting, setDeleting] = useState<PipelineRow | null>(null);
  const [search, setSearch] = useState("");

  const [folderFilter, setFolderFilter] = useState<FolderFilter>("__all__");
  const [openFolderDialog, setOpenFolderDialog] = useState(false);
  const [editingFolder, setEditingFolder] = useState<PipelineFolder | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<PipelineFolder | null>(null);

  const { data: pipelines, isLoading } = useQuery({
    queryKey: ["pipelines-list", activeBrandId],
    enabled: !!activeBrandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc("get_pipelines_with_counts", { _brand_id: activeBrandId! });
      if (error) throw error;
      return (data ?? []) as unknown as PipelineRow[];
    },
  });

  const { data: folders } = useQuery({
    queryKey: ["pipeline-folders", activeBrandId],
    enabled: !!activeBrandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipeline_folders")
        .select("id, brand_id, name, color, position")
        .eq("brand_id", activeBrandId!)
        .order("position")
        .order("name");
      if (error) throw error;
      return (data ?? []) as PipelineFolder[];
    },
  });

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    let none = 0;
    (pipelines ?? []).forEach((p) => {
      if (!p.folder_id) none += 1;
      else map.set(p.folder_id, (map.get(p.folder_id) ?? 0) + 1);
    });
    return { byFolder: map, none, total: (pipelines ?? []).length };
  }, [pipelines]);

  const filtered = useMemo(() => {
    let list = pipelines ?? [];
    if (folderFilter === "__none__") list = list.filter((p) => !p.folder_id);
    else if (folderFilter !== "__all__") list = list.filter((p) => p.folder_id === folderFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.description ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [pipelines, search, folderFilter]);

  const folderNameById = useMemo(() => {
    const m = new Map<string, PipelineFolder>();
    (folders ?? []).forEach((f) => m.set(f.id, f));
    return m;
  }, [folders]);

  async function handleDelete() {
    if (!deleting) return;
    const { error } = await supabase.from("pipelines").delete().eq("id", deleting.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Pipeline excluído");
      qc.invalidateQueries({ queryKey: ["pipelines-list"] });
    }
    setDeleting(null);
  }

  async function handleDeleteFolder() {
    if (!deletingFolder) return;
    const { error } = await supabase.from("pipeline_folders").delete().eq("id", deletingFolder.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Pasta excluída");
      if (folderFilter === deletingFolder.id) setFolderFilter("__all__");
      qc.invalidateQueries({ queryKey: ["pipeline-folders"] });
      qc.invalidateQueries({ queryKey: ["pipelines-list"] });
    }
    setDeletingFolder(null);
  }

  async function moveToFolder(pipelineId: string, folderId: string | null) {
    const { error } = await supabase.from("pipelines").update({ folder_id: folderId }).eq("id", pipelineId);
    if (error) toast.error(error.message);
    else {
      toast.success(folderId ? "Pipeline movido" : "Pipeline removido da pasta");
      qc.invalidateQueries({ queryKey: ["pipelines-list"] });
    }
  }

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["pipelines-list"] });
    qc.invalidateQueries({ queryKey: ["pipeline-folders"] });
  };

  const FolderRow = ({
    id, label, icon, count, color, folder,
  }: {
    id: FolderFilter; label: string; icon: React.ReactNode; count: number;
    color?: string | null; folder?: PipelineFolder;
  }) => {
    const active = folderFilter === id;
    return (
      <div
        className={cn(
          "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors",
          active ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:bg-muted/50"
        )}
        onClick={() => setFolderFilter(id)}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center" style={color ? { color } : undefined}>
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="text-[11px] text-muted-foreground">{count}</span>
        {folder && canManage && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => { setEditingFolder(folder); setOpenFolderDialog(true); }}>
                <Pencil className="mr-2 h-3.5 w-3.5" /> Renomear
              </DropdownMenuItem>
              <DropdownMenuItem className="text-destructive" onClick={() => setDeletingFolder(folder)}>
                <Trash2 className="mr-2 h-3.5 w-3.5" /> Excluir pasta
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    );
  };

  return (
    <div className="page-container">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pipelines</h1>
          <p className="text-sm text-muted-foreground">Quadros Kanban para organizar contatos por etapa.</p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setOpenTemplates(true)}>
              <LayoutTemplate className="mr-2 h-4 w-4" /> Modelos
            </Button>
            <Button onClick={() => { setEditing(null); setOpenForm(true); }}>
              <Plus className="mr-2 h-4 w-4" /> Novo pipeline
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* Sidebar de pastas */}
        <aside className="w-full shrink-0 lg:w-56">
          <div className="rounded-lg border bg-card p-2">
            <div className="mb-1 flex items-center justify-between px-2 py-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Pastas</span>
              {canManage && (
                <Button
                  size="icon" variant="ghost" className="h-6 w-6"
                  onClick={() => { setEditingFolder(null); setOpenFolderDialog(true); }}
                  title="Nova pasta"
                >
                  <FolderPlus className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <div className="space-y-0.5">
              <FolderRow id="__all__" label="Todos" icon={<Inbox className="h-4 w-4" />} count={counts.total} />
              <FolderRow id="__none__" label="Sem pasta" icon={<Folder className="h-4 w-4" />} count={counts.none} />
              {(folders ?? []).length > 0 && <div className="my-1 border-t" />}
              {(folders ?? []).map((f) => (
                <FolderRow
                  key={f.id}
                  id={f.id}
                  label={f.name}
                  icon={<Folder className="h-4 w-4 fill-current" />}
                  count={counts.byFolder.get(f.id) ?? 0}
                  color={f.color}
                  folder={f}
                />
              ))}
            </div>
          </div>
        </aside>

        {/* Conteúdo */}
        <div className="min-w-0 flex-1">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar pipeline..."
                className="pl-8"
              />
            </div>
            {activeBrand && (
              <span className="text-xs text-muted-foreground">Workspace: <strong>{activeBrand.name}</strong></span>
            )}
          </div>

          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed p-12 text-center">
              <KanbanSquare className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {search.trim()
                  ? "Nenhum pipeline encontrado para os filtros atuais."
                  : folderFilter !== "__all__"
                  ? "Nenhum pipeline nesta pasta."
                  : "Nenhum pipeline ainda neste workspace."}
              </p>
              {canManage && !search.trim() && (
                <Button className="mt-4" onClick={() => { setEditing(null); setOpenForm(true); }}>
                  <Plus className="mr-2 h-4 w-4" /> Criar primeiro pipeline
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((p) => {
                const stages = p.stage_count ?? 0;
                const cards = p.card_count ?? 0;
                const folder = p.folder_id ? folderNameById.get(p.folder_id) : null;
                return (
                  <Card key={p.id} className="group transition-shadow hover:shadow-md">
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <CardTitle className="truncate text-base">{p.name}</CardTitle>
                          <CardDescription className="truncate">
                            {folder ? (
                              <span className="inline-flex items-center gap-1">
                                <Folder className="h-3 w-3" style={folder.color ? { color: folder.color } : undefined} />
                                {folder.name}
                              </span>
                            ) : (
                              p.brand_name ?? "—"
                            )}
                          </CardDescription>
                        </div>
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                          <KanbanSquare className="h-4 w-4" />
                        </span>
                        {canManage && (
                          <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.preventDefault(); setEditing(p); setOpenForm(true); }}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="icon" variant="ghost" className="h-7 w-7">
                                  <MoreHorizontal className="h-3.5 w-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuLabel className="flex items-center gap-2 text-xs">
                                  <FolderInput className="h-3.5 w-3.5" /> Mover para pasta
                                </DropdownMenuLabel>
                                <DropdownMenuItem
                                  disabled={!p.folder_id}
                                  onClick={() => moveToFolder(p.id, null)}
                                >
                                  <Folder className="mr-2 h-3.5 w-3.5" /> Sem pasta
                                </DropdownMenuItem>
                                {(folders ?? []).map((f) => (
                                  <DropdownMenuItem
                                    key={f.id}
                                    disabled={p.folder_id === f.id}
                                    onClick={() => moveToFolder(p.id, f.id)}
                                  >
                                    <Folder className="mr-2 h-3.5 w-3.5" style={f.color ? { color: f.color } : undefined} />
                                    {f.name}
                                  </DropdownMenuItem>
                                ))}
                                {(folders ?? []).length === 0 && (
                                  <DropdownMenuItem disabled className="text-xs">
                                    Nenhuma pasta criada
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onClick={() => setDeleting(p)}
                                >
                                  <Trash2 className="mr-2 h-3.5 w-3.5" /> Excluir pipeline
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent>
                      {p.description && <p className="mb-3 line-clamp-2 text-sm text-muted-foreground">{p.description}</p>}
                      <div className="flex items-end justify-between gap-3">
                        <div className="flex items-baseline gap-4 text-sm">
                          <div>
                            <div className="text-xl font-semibold leading-none">{stages}</div>
                            <div className="mt-1 text-[11px] text-muted-foreground">etapa{stages === 1 ? "" : "s"}</div>
                          </div>
                          <div>
                            <div className="text-xl font-semibold leading-none">{cards.toLocaleString("pt-BR")}</div>
                            <div className="mt-1 text-[11px] text-muted-foreground">contato{cards === 1 ? "" : "s"}</div>
                          </div>
                        </div>
                        <Link to="/pipelines/$id" params={{ id: p.id }} className="text-sm font-medium text-primary hover:underline">
                          Abrir →
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <PipelineFormDialog
        open={openForm}
        onOpenChange={setOpenForm}
        pipeline={editing}
        onSaved={invalidateAll}
      />

      <PipelineTemplatesDialog open={openTemplates} onOpenChange={setOpenTemplates} />

      <PipelineFolderDialog
        open={openFolderDialog}
        onOpenChange={setOpenFolderDialog}
        folder={editingFolder}
        onSaved={invalidateAll}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir pipeline?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleting?.name}" será removido junto com todas as etapas e cartões. Essa ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deletingFolder} onOpenChange={(o) => !o && setDeletingFolder(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir pasta?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deletingFolder?.name}" será removida. Os pipelines desta pasta ficarão em "Sem pasta".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteFolder} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
