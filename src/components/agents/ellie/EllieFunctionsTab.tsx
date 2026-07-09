import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  listAgentFunctions,
  upsertAgentFunction,
  deleteAgentFunction,
} from "@/lib/ellie-config.functions";

type Fn = {
  id: string;
  name: string;
  description: string;
  action_type: "custom" | "save_to_memory" | "call_automation" | "buyer_detector" | "send_image";
  parameters_schema: any;
  target_automation_id: string | null;
  save_results: boolean;
  enabled: boolean;
};

const ACTION_LABEL: Record<string, string> = {
  custom: "Custom",
  save_to_memory: "Salvar na memória",
  call_automation: "Chamar automação",
  buyer_detector: "Validar aluno",
  send_image: "Enviar imagem",
};

export function EllieFunctionsTab({ agentId }: { agentId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listAgentFunctions);
  const upsertFn = useServerFn(upsertAgentFunction);
  const deleteFn = useServerFn(deleteAgentFunction);

  const { data, isLoading } = useQuery({
    queryKey: ["ellie-functions", agentId],
    queryFn: () => listFn({ data: { agentId } }),
  });

  const [editing, setEditing] = useState<Partial<Fn> | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["ellie-functions", agentId] });

  const onSave = async () => {
    if (!editing?.name) {
      toast.error("Nome é obrigatório");
      return;
    }
    let parsedSchema: any = { type: "object", properties: {} };
    if (editing.parameters_schema && typeof editing.parameters_schema === "string") {
      try {
        parsedSchema = JSON.parse(editing.parameters_schema as any);
      } catch {
        toast.error("JSON schema inválido");
        return;
      }
    } else if (editing.parameters_schema) {
      parsedSchema = editing.parameters_schema;
    }
    try {
      await upsertFn({
        data: {
          id: editing.id,
          agentId,
          name: editing.name!,
          description: editing.description ?? "",
          action_type: (editing.action_type as any) ?? "custom",
          parameters_schema: parsedSchema,
          target_automation_id: editing.target_automation_id ?? null,
          save_results: editing.save_results ?? false,
          enabled: editing.enabled ?? true,
        },
      });
      toast.success("Função salva");
      setEditing(null);
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao salvar");
    }
  };

  const onDelete = async (id: string) => {
    if (!confirm("Excluir esta função?")) return;
    await deleteFn({ data: { id, agentId } });
    toast.success("Função removida");
    refresh();
  };

  if (isLoading) return <div className="p-6 flex justify-center"><Loader2 className="animate-spin" /></div>;
  const fns = (data?.functions ?? []) as Fn[];

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold">Funções (Tools)</h3>
            <p className="text-xs text-muted-foreground">
              Ferramentas que o LLM pode chamar para tomar ações: salvar na memória, executar
              automação, validar aluno, enviar imagem, etc.
            </p>
          </div>
          <Button size="sm" onClick={() => setEditing({ enabled: true, action_type: "custom" })}>
            <Plus className="h-4 w-4 mr-1" /> Nova função
          </Button>
        </div>
      </Card>

      <div className="grid gap-2">
        {fns.length === 0 && (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            Nenhuma função cadastrada ainda.
          </Card>
        )}
        {fns.map((f) => (
          <Card key={f.id} className="p-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono">{f.name}</code>
                <Badge variant="outline" className="text-[10px]">{ACTION_LABEL[f.action_type]}</Badge>
                {!f.enabled && <Badge variant="secondary" className="text-[10px]">desativada</Badge>}
              </div>
              <p className="text-xs text-muted-foreground truncate">{f.description || "—"}</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setEditing({ ...f, parameters_schema: JSON.stringify(f.parameters_schema, null, 2) as any })}>
              Editar
            </Button>
            <Button size="icon" variant="ghost" onClick={() => onDelete(f.id)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </Card>
        ))}
      </div>

      {editing && (
        <Card className="p-4 space-y-3 border-primary/40">
          <h4 className="font-semibold">{editing.id ? "Editar função" : "Nova função"}</h4>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>Nome</Label>
              <Input
                value={editing.name ?? ""}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="ex: save_lead_email"
              />
            </div>
            <div>
              <Label>Tipo de ação</Label>
              <Select
                value={editing.action_type ?? "custom"}
                onValueChange={(v) => setEditing({ ...editing, action_type: v as any })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(ACTION_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Descrição (o LLM lê para decidir quando chamar)</Label>
            <Textarea
              rows={2}
              value={editing.description ?? ""}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              placeholder="ex: Salva o email do lead quando ele compartilhar"
            />
          </div>
          <div>
            <Label>Parâmetros (JSON Schema)</Label>
            <Textarea
              rows={6}
              className="font-mono text-xs"
              value={
                typeof editing.parameters_schema === "string"
                  ? (editing.parameters_schema as any)
                  : JSON.stringify(editing.parameters_schema ?? { type: "object", properties: {} }, null, 2)
              }
              onChange={(e) => setEditing({ ...editing, parameters_schema: e.target.value as any })}
            />
          </div>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={editing.enabled ?? true}
                onCheckedChange={(v) => setEditing({ ...editing, enabled: v })}
              />
              Ativa
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={editing.save_results ?? false}
                onCheckedChange={(v) => setEditing({ ...editing, save_results: v })}
              />
              Salvar resultado no histórico
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={onSave}>Salvar</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
