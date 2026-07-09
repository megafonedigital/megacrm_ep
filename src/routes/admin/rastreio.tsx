import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Pencil, Trash2, Loader2, Crosshair, User, Workflow as WorkflowIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useActiveBrand } from "@/lib/active-brand";
import { useMe } from "@/lib/auth";
import {
  listTrackers,
  deleteTracker,
} from "@/lib/sales-trackers.functions";
import { TrackerDialog } from "@/components/rastreio/TrackerDialog";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/rastreio")({
  component: RastreioPage,
});

type Tracker = Awaited<ReturnType<typeof listTrackers>>["trackers"][number];

function RastreioPage() {
  const { activeBrandId, activeBrand } = useActiveBrand();
  const { me } = useMe();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Tracker | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const list = useServerFn(listTrackers);
  const del = useServerFn(deleteTracker);

  const canWrite = !!me && (me.roles?.includes("admin") || me.roles?.includes("supervisor") || me.roles?.includes("developer"));

  const { data, isLoading } = useQuery({
    queryKey: ["sales-trackers", activeBrandId],
    enabled: !!activeBrandId,
    queryFn: () => list({ data: { brandId: activeBrandId! } }),
  });

  if (!activeBrandId) {
    return <div className="p-6 text-sm text-muted-foreground">Selecione uma workspace.</div>;
  }

  const trackers = (data?.trackers ?? []).filter((t) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      t.name.toLowerCase().includes(q) ||
      (t.user_name ?? "").toLowerCase().includes(q) ||
      (t.automation_name ?? "").toLowerCase().includes(q) ||
      t.codes.some((c) =>
        (c.sck ?? "").toLowerCase().includes(q) ||
        (c.utm_campaign ?? "").toLowerCase().includes(q) ||
        (c.utm_content ?? "").toLowerCase().includes(q),
      )
    );
  });

  async function handleDelete(t: Tracker) {
    if (!confirm(`Remover "${t.name}"?`)) return;
    try {
      await del({ data: { id: t.id, brandId: activeBrandId! } });
      toast.success("Removido");
      qc.invalidateQueries({ queryKey: ["sales-trackers", activeBrandId] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1200px] mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Crosshair className="h-5 w-5" /> Rastreio
          </h1>
          <p className="text-sm text-muted-foreground">
            {activeBrand?.name ?? "Workspace"} — SCKs e UTMs usados pela equipe de vendas e por automações.
            Apenas vendas com código aqui cadastrado (ou tag de agente IA) entram no dashboard de vendas.
          </p>
        </div>
        {canWrite && (
          <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" /> Novo
          </Button>
        )}
      </div>

      <Input
        placeholder="Buscar por nome, vendedor, automação, SCK ou UTM…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-md"
      />

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : trackers.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Nenhum item de rastreio cadastrado ainda.
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {trackers.map((t) => (
            <Card key={t.id} className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {t.kind === "seller" ? <User className="h-4 w-4 text-muted-foreground" /> : <WorkflowIcon className="h-4 w-4 text-muted-foreground" />}
                    <span className="font-semibold truncate">{t.name}</span>
                    {!t.active && <Badge variant="secondary" className="text-[10px]">inativo</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 truncate">
                    {t.kind === "seller"
                      ? (t.user_name ? `Vendedor — ${t.user_name}` : "Vendedor")
                      : (t.automation_name ? `Automação — ${t.automation_name}` : "Automação")}
                  </div>
                </div>
                {canWrite && (
                  <div className="flex gap-1 shrink-0">
                    <Button size="icon" variant="ghost" onClick={() => { setEditing(t); setDialogOpen(true); }}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => handleDelete(t)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
              {t.codes.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">sem códigos cadastrados</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {t.codes.map((c) => (
                    <Badge key={c.id} variant="outline" className="text-[11px] font-mono">
                      {c.kind === "sck"
                        ? `SCK: ${c.sck}`
                        : `UTM ${[
                            c.utm_source && `s=${c.utm_source}`,
                            c.utm_campaign && `c=${c.utm_campaign}`,
                            c.utm_content && `ct=${c.utm_content}`,
                          ].filter(Boolean).join(" ")}`}
                    </Badge>
                  ))}
                </div>
              )}
              {t.notes && <p className="text-xs text-muted-foreground">{t.notes}</p>}
            </Card>
          ))}
        </div>
      )}

      <TrackerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        tracker={editing}
        brandId={activeBrandId}
        onSaved={() => qc.invalidateQueries({ queryKey: ["sales-trackers", activeBrandId] })}
      />
    </div>
  );
}
