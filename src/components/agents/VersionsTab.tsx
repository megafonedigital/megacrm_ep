import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Loader2, Save, RotateCcw, Eye } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  listAgentVersions,
  createAgentVersion,
  restoreAgentVersion,
} from "@/lib/ai-agent-versions.functions";
import { AbTestsBlock } from "./AbTestsBlock";

type Version = {
  id: string;
  version_number: number;
  label: string | null;
  notes: string | null;
  source: string;
  system_prompt: string;
  model: string;
  temperature: number;
  max_output_tokens: number;
  response_delay_ms: number;
  context_window_messages: number;
  inputs: unknown;
  created_at: string;
  author: { full_name: string | null; email: string | null } | null;
};

const SOURCE_LABEL: Record<string, string> = {
  manual: "Manual",
  auto_prompt_change: "Prompt alterado",
  restore: "Restauração",
};

export function VersionsTab({ agentId }: { agentId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listAgentVersions);
  const createFn = useServerFn(createAgentVersion);
  const restoreFn = useServerFn(restoreAgentVersion);

  const { data, isLoading } = useQuery({
    queryKey: ["ai-agent-versions", agentId],
    queryFn: () => listFn({ data: { agentId } }),
  });

  const [saveOpen, setSaveOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const [viewing, setViewing] = useState<Version | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<Version | null>(null);
  const [restoring, setRestoring] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["ai-agent-versions", agentId] });
    qc.invalidateQueries({ queryKey: ["ai-agent", agentId] });
  };

  const saveSnapshot = async () => {
    setSaving(true);
    try {
      const v = await createFn({
        data: { agentId, label: label.trim() || undefined, notes: notes.trim() || undefined },
      });
      toast.success(`Versão v${v.versionNumber} criada`);
      setSaveOpen(false);
      setLabel("");
      setNotes("");
      refresh();
    } catch (e) {
      toast.error((e as Error)?.message ?? "Erro ao salvar versão");
    } finally {
      setSaving(false);
    }
  };

  const doRestore = async () => {
    if (!restoreTarget) return;
    setRestoring(true);
    try {
      const r = await restoreFn({ data: { versionId: restoreTarget.id } });
      toast.success(`Restaurado para v${restoreTarget.version_number} (gerada v${r.newVersionNumber})`);
      setRestoreTarget(null);
      refresh();
    } catch (e) {
      toast.error((e as Error)?.message ?? "Erro ao restaurar");
    } finally {
      setRestoring(false);
    }
  };

  if (isLoading) {
    return <div className="flex justify-center p-10"><Loader2 className="animate-spin" /></div>;
  }

  const versions = (data?.versions ?? []) as Version[];

  return (
    <div className="space-y-4">
      <AbTestsBlock
        agentId={agentId}
        versions={versions.map((v) => ({ id: v.id, version_number: v.version_number, label: v.label }))}
      />

      <Card className="p-4 flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Histórico de versões</h3>
          <p className="text-xs text-muted-foreground">
            Snapshots automáticos são criados quando o system prompt muda. Você também pode salvar uma versão manualmente.
          </p>
        </div>
        <Button onClick={() => setSaveOpen(true)}>
          <Save className="h-4 w-4 mr-2" /> Salvar versão atual
        </Button>
      </Card>

      {versions.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          Nenhuma versão registrada ainda.
        </Card>
      ) : (
        <div className="space-y-2">
          {versions.map((v, idx) => {
            const previous = versions[idx + 1];
            const promptChanged = previous && previous.system_prompt !== v.system_prompt;
            const modelChanged = previous && previous.model !== v.model;
            const authorName = v.author?.full_name || v.author?.email || "—";
            return (
              <Card key={v.id} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">v{v.version_number}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {SOURCE_LABEL[v.source] ?? v.source}
                      </Badge>
                      {v.label && <span className="text-sm">{v.label}</span>}
                      {idx === 0 && <Badge className="text-[10px]">Atual</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {formatDistanceToNow(new Date(v.created_at), { locale: ptBR, addSuffix: true })} • {authorName}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 flex gap-3 flex-wrap">
                      <span>modelo: <code>{v.model}</code></span>
                      <span>temp: {v.temperature}</span>
                      <span>tokens: {v.max_output_tokens}</span>
                      {previous && (
                        <span className="text-foreground/70">
                          {promptChanged && "• prompt alterado"} {modelChanged && "• modelo alterado"}
                        </span>
                      )}
                    </div>
                    {v.notes && <p className="text-xs mt-2 italic">{v.notes}</p>}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button variant="outline" size="sm" onClick={() => setViewing(v)}>
                      <Eye className="h-3.5 w-3.5 mr-1" /> Ver
                    </Button>
                    {idx !== 0 && (
                      <Button variant="outline" size="sm" onClick={() => setRestoreTarget(v)}>
                        <RotateCcw className="h-3.5 w-3.5 mr-1" /> Restaurar
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Salvar versão */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Salvar versão atual</DialogTitle>
            <DialogDescription>
              Cria um snapshot da configuração atual do agente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Rótulo (opcional)</Label>
              <Input
                placeholder="ex: pré black friday"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={120}
              />
            </div>
            <div>
              <Label className="text-xs">Notas (opcional)</Label>
              <Textarea
                placeholder="o que mudou nesta versão..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={2000}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>Cancelar</Button>
            <Button onClick={saveSnapshot} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar versão
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Visualizar versão */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>v{viewing?.version_number} {viewing?.label && `— ${viewing.label}`}</DialogTitle>
            <DialogDescription>
              {viewing && formatDistanceToNow(new Date(viewing.created_at), { locale: ptBR, addSuffix: true })}
            </DialogDescription>
          </DialogHeader>
          {viewing && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Modelo:</span> <code>{viewing.model}</code></div>
                <div><span className="text-muted-foreground">Temperatura:</span> {viewing.temperature}</div>
                <div><span className="text-muted-foreground">Max tokens:</span> {viewing.max_output_tokens}</div>
                <div><span className="text-muted-foreground">Janela contexto:</span> {viewing.context_window_messages}</div>
                <div><span className="text-muted-foreground">Delay (ms):</span> {viewing.response_delay_ms}</div>
              </div>
              <div>
                <Label className="text-xs">System prompt</Label>
                <pre className="text-xs bg-muted p-3 rounded whitespace-pre-wrap font-mono max-h-[40vh] overflow-y-auto">
                  {viewing.system_prompt || "(vazio)"}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirmar restore */}
      <AlertDialog open={!!restoreTarget} onOpenChange={(o) => !o && setRestoreTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restaurar v{restoreTarget?.version_number}?</AlertDialogTitle>
            <AlertDialogDescription>
              Os campos do agente serão sobrescritos com os valores desta versão. Uma nova versão será criada com o rótulo "Restaurada de v{restoreTarget?.version_number}" para preservar a configuração anterior.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={doRestore} disabled={restoring}>
              {restoring && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Restaurar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
