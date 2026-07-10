import { createFileRoute, redirect, useSearch, useNavigate } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Megaphone, Plus, Loader2, X, Ban, FlaskConical } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useActiveBrand } from "@/lib/active-brand";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { listBroadcasts, cancelBroadcast } from "@/lib/broadcasts.functions";
import { seedStressContacts } from "@/lib/stress-seed.functions";
import { NewBroadcastDialog } from "@/components/broadcasts/NewBroadcastDialog";
import { formatDuration } from "@/lib/format-duration";
import { toast } from "sonner";

const searchSchema = z.object({
  automation: z.string().uuid().optional(),
});

export const Route = createFileRoute("/admin/broadcasts/")({
  validateSearch: (s) => searchSchema.parse(s),
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  component: BroadcastsPage,
});

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  scheduled: "secondary",
  running: "default",
  completed: "default",
  cancelled: "outline",
  failed: "destructive",
};

const STRESS_COUNT = 10000;

function BroadcastsPage() {
  const { activeBrandId } = useActiveBrand();
  const [openDialog, setOpenDialog] = useState(false);
  const [openStressDialog, setOpenStressDialog] = useState(false);
  const [stressTagId, setStressTagId] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [, setNowTick] = useState(0);
  const listFn = useServerFn(listBroadcasts);
  const cancelFn = useServerFn(cancelBroadcast);
  const seedFn = useServerFn(seedStressContacts);

  async function handleStressTest() {
    if (!activeBrandId) return;
    setSeeding(true);
    try {
      const r = await seedFn({ data: { brandId: activeBrandId, count: STRESS_COUNT } });
      setStressTagId(r.tag_id);
      if (r.created > 0) {
        toast.success(
          `${r.created.toLocaleString("pt-BR")} contatos fake criados na tag __stress-test-10k. ` +
          `Selecione o fluxo "Stress Test — tag add/remove" no passo 1.`,
        );
      }
      setOpenStressDialog(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao gerar contatos de stress test.");
    } finally {
      setSeeding(false);
    }
  }
  const search = useSearch({ from: "/admin/broadcasts/" });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const automationFilter = search.automation;

  const q = useQuery({
    queryKey: ["broadcasts-list", activeBrandId],
    enabled: !!activeBrandId,
    queryFn: async () => {
      try {
        return await listFn({ data: { brandId: activeBrandId! } });
      } catch (err: any) {
        if (err instanceof Response) {
          if (err.status === 401) {
            await supabase.auth.signOut();
            window.location.href = "/login";
            return { rows: [] };
          }
          const text = await err.text().catch(() => "");
          throw new Error(text || `Erro ${err.status}`);
        }
        throw err;
      }
    },
    retry: false,
    refetchInterval: 8_000,
  });

  // Tick a cada 1s para atualizar duração de broadcasts em execução
  const hasRunning = useMemo(
    () => (q.data?.rows ?? []).some((r: any) => r.status === "running" && r.started_at),
    [q.data],
  );
  useEffect(() => {
    if (!hasRunning) return;
    const t = setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [hasRunning]);

  const cancelMut = useMutation({
    mutationFn: (id: string) => cancelFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Broadcast cancelado");
      setConfirmCancelId(null);
      qc.invalidateQueries({ queryKey: ["broadcasts-list"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao cancelar"),
  });

  const filteredRows = useMemo(() => {
    const rows = q.data?.rows ?? [];
    if (!automationFilter) return rows;
    return rows.filter((r: any) => r.automation_id === automationFilter);
  }, [q.data, automationFilter]);

  const filterAutomationName = useMemo(() => {
    if (!automationFilter) return null;
    const row = (q.data?.rows ?? []).find((r: any) => r.automation_id === automationFilter);
    return row?.automations?.name ?? null;
  }, [q.data, automationFilter]);

  const cancelTarget = confirmCancelId
    ? (q.data?.rows ?? []).find((r: any) => r.id === confirmCancelId) as any
    : null;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Megaphone className="h-6 w-6" /> Broadcasts
          </h1>
          <p className="text-sm text-muted-foreground">Dispare uma automação em massa para um público filtrado.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleStressTest} disabled={!activeBrandId || seeding}>
            {seeding
              ? (<><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Gerando 10k fake…</>)
              : (<><FlaskConical className="h-4 w-4 mr-1" /> Stress Test</>)}
          </Button>
          <Button onClick={() => setOpenDialog(true)} disabled={!activeBrandId}>
            <Plus className="h-4 w-4 mr-1" /> Novo broadcast
          </Button>
        </div>
      </div>

      {automationFilter && (
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1">
            Filtrando por fluxo: {filterAutomationName ?? automationFilter.slice(0, 8) + "…"}
            <button
              type="button"
              onClick={() => navigate({ to: "/admin/broadcasts", search: {} })}
              className="hover:text-destructive"
              aria-label="Remover filtro"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        </div>
      )}

      <Card>
        {q.isLoading ? (
          <div className="p-8 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline mr-2" />Carregando…</div>
        ) : filteredRows.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            {automationFilter ? "Nenhum broadcast deste fluxo ainda." : "Nenhum broadcast ainda."}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Fluxo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Progresso</TableHead>
                <TableHead>Velocidade</TableHead>
                <TableHead>Iniciado em</TableHead>
                <TableHead>Duração</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.map((r: any) => {
                const done = (r.dispatched_count ?? 0) + (r.failed_count ?? 0) + (r.skipped_count ?? 0);
                const canCancel = ["scheduled", "running"].includes(r.status);
                const startedLabel = r.started_at
                  ? new Date(r.started_at).toLocaleString()
                  : (r.scheduled_at ? `Agendado: ${new Date(r.scheduled_at).toLocaleString()}` : "—");
                const duration = r.started_at ? formatDuration(r.started_at, r.finished_at) : "—";
                return (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => window.location.href = `/admin/broadcasts/${r.id}`}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>{r.automations?.name ?? "—"}</TableCell>
                    <TableCell><Badge variant={STATUS_VARIANT[r.status] ?? "outline"}>{r.status}</Badge></TableCell>
                    <TableCell>{done}/{r.total_targets}</TableCell>
                    <TableCell>{r.rate_per_minute}/min</TableCell>
                    <TableCell className="text-xs">{startedLabel}</TableCell>
                    <TableCell className="text-xs">{duration}</TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      {canCancel && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setConfirmCancelId(r.id)}
                          disabled={cancelMut.isPending && confirmCancelId === r.id}
                        >
                          <Ban className="h-3.5 w-3.5 mr-1" /> Cancelar
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      {activeBrandId && (
        <NewBroadcastDialog open={openDialog} onOpenChange={setOpenDialog} brandId={activeBrandId} />
      )}

      {activeBrandId && stressTagId && (
        <NewBroadcastDialog
          open={openStressDialog}
          onOpenChange={setOpenStressDialog}
          brandId={activeBrandId}
          lockedTagId={stressTagId}
          lockedTagName="__stress-test-10k (fake)"
          defaultName={`Stress Test ${new Date().toLocaleString("pt-BR")}`}
          title="Stress Test — Broadcast"
        />
      )}

      <AlertDialog open={!!confirmCancelId} onOpenChange={(v) => !v && setConfirmCancelId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar broadcast?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelTarget ? (
                <>O broadcast <strong>{cancelTarget.name}</strong> será interrompido. Contatos ainda não despachados serão marcados como cancelados. Os já enviados não são afetados.</>
              ) : "Esta ação interrompe o disparo. Os contatos já enviados não são afetados."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelMut.isPending}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); if (confirmCancelId) cancelMut.mutate(confirmCancelId); }}
              disabled={cancelMut.isPending}
            >
              {cancelMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Cancelar broadcast
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
