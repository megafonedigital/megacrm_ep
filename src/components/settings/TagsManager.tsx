import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Folder, FolderPlus, Loader2, Tag as TagIcon, MoreVertical, FolderInput, Search } from "lucide-react";
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
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type TagFolder = { id: string; name: string; color: string | null; position: number };
type TagRow = { id: string; name: string; color: string | null; folder_id: string | null };

const COLORS = ["#ef4444", "#f59e0b", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899", "#64748b"];

export function TagsManager({ brandId }: { brandId: string }) {
  const qc = useQueryClient();
  const [selectedFolder, setSelectedFolder] = useState<string | null | "all">("all");
  const [searchTerm, setSearchTerm] = useState("");

  const foldersQ = useQuery({
    queryKey: ["tag-folders", brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tag_folders").select("*").eq("brand_id", brandId)
        .order("position").order("name");
      if (error) throw error;
      return (data ?? []) as TagFolder[];
    },
  });

  const tagsQ = useQuery({
    queryKey: ["tags-all", brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tags").select("id, name, color, folder_id").eq("brand_id", brandId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as TagRow[];
    },
  });

  const countsQ = useQuery({
    queryKey: ["tag-counts", brandId],
    queryFn: async () => {
      const ids = (tagsQ.data ?? []).map((t) => t.id);
      if (ids.length === 0) return {} as Record<string, number>;
      const { data, error } = await supabase
        .from("contact_tags").select("tag_id").in("tag_id", ids);
      if (error) throw error;
      const map: Record<string, number> = {};
      (data ?? []).forEach((r: any) => { map[r.tag_id] = (map[r.tag_id] ?? 0) + 1; });
      return map;
    },
    enabled: !!tagsQ.data,
  });

  const filteredTags = (tagsQ.data ?? []).filter((t) => {
    const folderOk =
      selectedFolder === "all" ? true :
      selectedFolder === null ? t.folder_id === null :
      t.folder_id === selectedFolder;
    if (!folderOk) return false;
    const q = searchTerm.trim().toLowerCase();
    if (q && !t.name.toLowerCase().includes(q)) return false;
    return true;
  });

  // Folder dialog
  const [folderOpen, setFolderOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState<TagFolder | null>(null);
  const [folderName, setFolderName] = useState("");
  const [folderColor, setFolderColor] = useState<string>(COLORS[5]);

  const openNewFolder = () => { setEditingFolder(null); setFolderName(""); setFolderColor(COLORS[5]); setFolderOpen(true); };
  const openEditFolder = (f: TagFolder) => { setEditingFolder(f); setFolderName(f.name); setFolderColor(f.color ?? COLORS[5]); setFolderOpen(true); };

  const saveFolderMut = useMutation({
    mutationFn: async () => {
      if (!folderName.trim()) throw new Error("Nome obrigatório");
      if (editingFolder) {
        const { error } = await supabase.from("tag_folders").update({ name: folderName.trim(), color: folderColor }).eq("id", editingFolder.id);
        if (error) throw error;
      } else {
        const maxPos = Math.max(0, ...((foldersQ.data ?? []).map((f) => f.position)));
        const { error } = await supabase.from("tag_folders").insert({ brand_id: brandId, name: folderName.trim(), color: folderColor, position: maxPos + 1 });
        if (error) throw error;
      }
    },
    onSuccess: () => { toast.success("Pasta salva"); setFolderOpen(false); qc.invalidateQueries({ queryKey: ["tag-folders", brandId] }); },
    onError: (e: any) => toast.error(e?.message ?? "Falha"),
  });

  const delFolderMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tag_folders").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Pasta removida"); qc.invalidateQueries({ queryKey: ["tag-folders", brandId] }); qc.invalidateQueries({ queryKey: ["tags-all", brandId] }); },
    onError: (e: any) => toast.error(e?.message ?? "Falha"),
  });

  // Tag dialog
  const [tagOpen, setTagOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<TagRow | null>(null);
  const [tagName, setTagName] = useState("");
  const [tagColor, setTagColor] = useState<string>(COLORS[5]);
  const [tagFolderId, setTagFolderId] = useState<string | null>(null);

  const openNewTag = () => {
    setEditingTag(null); setTagName(""); setTagColor(COLORS[5]);
    setTagFolderId(selectedFolder === "all" || selectedFolder === null ? null : selectedFolder);
    setTagOpen(true);
  };
  const openEditTag = (t: TagRow) => { setEditingTag(t); setTagName(t.name); setTagColor(t.color ?? COLORS[5]); setTagFolderId(t.folder_id); setTagOpen(true); };

  const saveTagMut = useMutation({
    mutationFn: async () => {
      const name = tagName.trim();
      if (!name) throw new Error("Nome obrigatório");
      if (editingTag) {
        const { error } = await supabase.from("tags").update({ name, color: tagColor, folder_id: tagFolderId }).eq("id", editingTag.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("tags").insert({ brand_id: brandId, name, color: tagColor, folder_id: tagFolderId });
        if (error) throw error;
      }
    },
    onSuccess: () => { toast.success("Tag salva"); setTagOpen(false); qc.invalidateQueries({ queryKey: ["tags-all", brandId] }); qc.invalidateQueries({ queryKey: ["tag-counts", brandId] }); },
    onError: (e: any) => toast.error(e?.message ?? "Falha"),
  });

  const moveTagMut = useMutation({
    mutationFn: async ({ tagId, folderId }: { tagId: string; folderId: string | null }) => {
      const { error } = await supabase.from("tags").update({ folder_id: folderId }).eq("id", tagId);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Tag movida"); qc.invalidateQueries({ queryKey: ["tags-all", brandId] }); },
    onError: (e: any) => toast.error(e?.message ?? "Falha"),
  });

  const delTagMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tags").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Tag removida"); qc.invalidateQueries({ queryKey: ["tags-all", brandId] }); qc.invalidateQueries({ queryKey: ["tag-counts", brandId] }); },
    onError: (e: any) => toast.error(e?.message ?? "Falha"),
  });

  const [delTagId, setDelTagId] = useState<string | null>(null);
  const [delFolderId, setDelFolderId] = useState<string | null>(null);

  return (
    <div className="flex gap-4 min-h-[60vh]">
      {/* Sidebar pastas */}
      <aside className="w-64 shrink-0 border rounded-md p-2 space-y-1">
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-xs font-medium uppercase text-muted-foreground">Pastas</span>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={openNewFolder} title="Nova pasta"><FolderPlus className="h-4 w-4" /></Button>
        </div>
        <button onClick={() => setSelectedFolder("all")} className={cn("w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-accent", selectedFolder === "all" && "bg-accent")}>
          <TagIcon className="h-4 w-4" /> Todas
          <span className="ml-auto text-xs text-muted-foreground">{(tagsQ.data ?? []).length}</span>
        </button>
        <button onClick={() => setSelectedFolder(null)} className={cn("w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-accent", selectedFolder === null && "bg-accent")}>
          <Folder className="h-4 w-4 text-muted-foreground" /> Sem pasta
          <span className="ml-auto text-xs text-muted-foreground">{(tagsQ.data ?? []).filter((t) => !t.folder_id).length}</span>
        </button>
        {(foldersQ.data ?? []).map((f) => (
          <div key={f.id} className={cn("group flex items-center gap-1 px-2 py-1.5 rounded text-sm hover:bg-accent", selectedFolder === f.id && "bg-accent")}>
            <button onClick={() => setSelectedFolder(f.id)} className="flex flex-1 items-center gap-2 text-left min-w-0">
              <Folder className="h-4 w-4 shrink-0" style={{ color: f.color ?? undefined }} />
              <span className="truncate">{f.name}</span>
              <span className="ml-auto text-xs text-muted-foreground">{(tagsQ.data ?? []).filter((t) => t.folder_id === f.id).length}</span>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100"><MoreVertical className="h-3.5 w-3.5" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openEditFolder(f)}><Pencil className="h-3.5 w-3.5 mr-2" />Renomear</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDelFolderId(f.id)} className="text-destructive"><Trash2 className="h-3.5 w-3.5 mr-2" />Excluir pasta</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
      </aside>

      {/* Lista de tags */}
      <main className="flex-1 border rounded-md">
        <div className="flex items-center justify-between gap-2 p-3 border-b">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar tag…"
              className="pl-8 h-9"
            />
          </div>
          <div className="text-sm text-muted-foreground">{filteredTags.length} tag(s)</div>
          <Button size="sm" onClick={openNewTag}><Plus className="h-4 w-4 mr-1" />Nova tag</Button>
        </div>
        {tagsQ.isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : filteredTags.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-10">Nenhuma tag.</div>
        ) : (
          <ul className="divide-y">
            {filteredTags.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-3 py-2">
                <Badge style={{ backgroundColor: t.color ?? undefined, color: t.color ? "#fff" : undefined, borderColor: t.color ?? undefined }}>
                  {t.name}
                </Badge>
                <span className="text-xs text-muted-foreground">{countsQ.data?.[t.id] ?? 0} contato(s)</span>
                <div className="ml-auto flex items-center gap-1">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" variant="ghost" className="h-8 w-8" title="Mover de pasta"><FolderInput className="h-4 w-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => moveTagMut.mutate({ tagId: t.id, folderId: null })}>Sem pasta</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {(foldersQ.data ?? []).map((f) => (
                        <DropdownMenuItem key={f.id} onClick={() => moveTagMut.mutate({ tagId: t.id, folderId: f.id })}>
                          <Folder className="h-3.5 w-3.5 mr-2" style={{ color: f.color ?? undefined }} />
                          {f.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEditTag(t)}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setDelTagId(t.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>

      {/* Dialog pasta */}
      <Dialog open={folderOpen} onOpenChange={setFolderOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingFolder ? "Editar pasta" : "Nova pasta"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={folderName} onChange={(e) => setFolderName(e.target.value)} autoFocus />
            </div>
            <ColorPicker value={folderColor} onChange={setFolderColor} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFolderOpen(false)}>Cancelar</Button>
            <Button onClick={() => saveFolderMut.mutate()} disabled={saveFolderMut.isPending}>
              {saveFolderMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog tag */}
      <Dialog open={tagOpen} onOpenChange={setTagOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingTag ? "Editar tag" : "Nova tag"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={tagName} onChange={(e) => setTagName(e.target.value)} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label>Pasta</Label>
              <select
                value={tagFolderId ?? ""}
                onChange={(e) => setTagFolderId(e.target.value || null)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              >
                <option value="">Sem pasta</option>
                {(foldersQ.data ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <ColorPicker value={tagColor} onChange={setTagColor} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTagOpen(false)}>Cancelar</Button>
            <Button onClick={() => saveTagMut.mutate()} disabled={saveTagMut.isPending}>
              {saveTagMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!delTagId} onOpenChange={(o) => !o && setDelTagId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir tag?</AlertDialogTitle>
            <AlertDialogDescription>A tag será removida de todos os contatos. Não pode ser desfeito.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (delTagId) delTagMut.mutate(delTagId); setDelTagId(null); }}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!delFolderId} onOpenChange={(o) => !o && setDelFolderId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir pasta?</AlertDialogTitle>
            <AlertDialogDescription>As tags dentro dela ficarão sem pasta (não serão excluídas).</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (delFolderId) delFolderMut.mutate(delFolderId); setDelFolderId(null); }}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label>Cor</Label>
      <div className="flex flex-wrap gap-1.5">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className={cn("h-7 w-7 rounded-full border-2", value === c ? "border-foreground" : "border-transparent")}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
    </div>
  );
}
