import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Loader2, MessageSquare, FileText, MoveRight, Pencil, X } from "lucide-react";
import {
  BINDING_SOURCE_LABELS,
  getFieldsForSource,
  type VariableBinding,
} from "@/lib/template-bindings";
import { toast } from "sonner";
import {
  listStageActivities, upsertStageActivities,
} from "@/lib/pipeline-activities.functions";

type Activity = {
  id?: string;
  name: string;
  kind: "send_message" | "send_template" | "move_stage";
  mode: "auto" | "manual";
  delay_minutes: number;
  message_text: string | null;
  template_id: string | null;
  template_variables: string[];
  target_stage_id: string | null;
  active: boolean;
  position: number;
};

type DelayUnit = "minutes" | "hours" | "days";

function splitDelay(mins: number): { value: number; unit: DelayUnit } {
  if (mins === 0) return { value: 0, unit: "minutes" };
  if (mins % 1440 === 0) return { value: mins / 1440, unit: "days" };
  if (mins % 60 === 0) return { value: mins / 60, unit: "hours" };
  return { value: mins, unit: "minutes" };
}
function joinDelay(value: number, unit: DelayUnit): number {
  const v = Math.max(0, Math.floor(value || 0));
  return unit === "days" ? v * 1440 : unit === "hours" ? v * 60 : v;
}

export function StageActivitiesDialog({
  open, onOpenChange, stageId, stageName, pipelineId, brandId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  stageId: string;
  stageName: string;
  pipelineId: string;
  brandId: string;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(listStageActivities);
  const saveFn = useServerFn(upsertStageActivities);

  const [items, setItems] = useState<Activity[]>([]);
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["stage-activities", stageId],
    enabled: open && !!stageId,
    queryFn: () => listFn({ data: { stageId } }),
  });

  // Templates available for the brand
  const { data: templates } = useQuery({
    queryKey: ["wa-templates-approved", brandId],
    enabled: open && !!brandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_templates")
        .select("id, name, language, status, variables_count, variable_bindings")
        .eq("brand_id", brandId)
        .eq("status", "APPROVED")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  function bindingLabel(b: VariableBinding): string {
    const src = BINDING_SOURCE_LABELS[b.source] ?? b.source;
    if (b.source === "static") {
      return b.fallback ? `Texto fixo · "${b.fallback}"` : "Texto fixo";
    }
    const field = getFieldsForSource(b.source).find((f) => f.key === b.path);
    return `${src} · ${field?.label ?? b.path}`;
  }

  // Pipeline stages (for move_stage target picker)
  const { data: stages } = useQuery({
    queryKey: ["pipeline-stages-for-move", pipelineId],
    enabled: open && !!pipelineId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipeline_stages")
        .select("id, name, color, position")
        .eq("pipeline_id", pipelineId)
        .order("position");
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    if (data) {
      setItems(
        (data as any[]).map((r) => ({
          id: r.id,
          name: r.name,
          kind: r.kind,
          mode: r.mode,
          delay_minutes: r.delay_minutes ?? 0,
          message_text: r.message_text ?? "",
          template_id: r.template_id ?? null,
          template_variables: r.template_variables ?? [],
          target_stage_id: r.target_stage_id ?? null,
          active: r.active ?? true,
          position: r.position ?? 0,
        })),
      );
    }
  }, [data]);

  function update(idx: number, patch: Partial<Activity>) {
    setItems((arr) => arr.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  }
  function add() {
    setItems((arr) => [
      ...arr,
      {
        name: "Nova atividade",
        kind: "send_message",
        mode: "auto",
        delay_minutes: 0,
        message_text: "",
        template_id: null,
        template_variables: [],
        target_stage_id: null,
        active: true,
        position: arr.length,
      },
    ]);
  }
  function remove(idx: number) {
    setItems((arr) => arr.filter((_, i) => i !== idx));
  }

  async function save() {
    // Validate
    for (const a of items) {
      if (a.kind === "send_message" && !(a.message_text ?? "").trim()) {
        toast.error(`"${a.name}": mensagem vazia`);
        return;
      }
      if (a.kind === "send_template" && !a.template_id) {
        toast.error(`"${a.name}": selecione um template`);
        return;
      }
      if (a.kind === "move_stage") {
        if (!a.target_stage_id) {
          toast.error(`"${a.name}": selecione a etapa de destino`);
          return;
        }
        if (a.target_stage_id === stageId) {
          toast.error(`"${a.name}": a etapa de destino deve ser diferente da atual`);
          return;
        }
      }
    }
    setSaving(true);
    try {
      await saveFn({
        data: {
          stageId,
          pipelineId,
          brandId,
          activities: items.map((a, i) => ({ ...a, position: i })),
        },
      });
      toast.success("Atividades salvas");
      qc.invalidateQueries({ queryKey: ["stage-activities", stageId] });
      qc.invalidateQueries({ queryKey: ["pipeline-activity-counts", pipelineId] });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Atividades — {stageName}</DialogTitle>
          <DialogDescription>
            Defina ações executadas quando um contato entra nesta etapa. Atividades
            automáticas disparam sozinhas; manuais ficam pendentes para o agente.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
            {items.length === 0 && (
              <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                Nenhuma atividade configurada para esta etapa.
              </div>
            )}

            {items.map((a, i) => {
              const d = splitDelay(a.delay_minutes);
              return (
                <div key={a.id ?? `new-${i}`} className="rounded-md border border-border p-3 space-y-3">
                  <div className="flex items-start gap-2">
                    <Input
                      value={a.name}
                      onChange={(e) => update(i, { name: e.target.value })}
                      placeholder="Nome da atividade"
                      className="flex-1 font-medium"
                    />
                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground">Ativa</Label>
                      <Switch
                        checked={a.active}
                        onCheckedChange={(v) => update(i, { active: v })}
                      />
                    </div>
                    <Button size="icon" variant="ghost" onClick={() => remove(i)} className="text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <div className="space-y-1">
                      <Label className="text-xs">Tipo</Label>
                      <Select
                        value={a.kind}
                        onValueChange={(v: "send_message" | "send_template" | "move_stage") =>
                          update(i, { kind: v })
                        }
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="send_message">
                            <span className="flex items-center gap-2">
                              <MessageSquare className="h-3.5 w-3.5" /> Mensagem (24h)
                            </span>
                          </SelectItem>
                          <SelectItem value="send_template">
                            <span className="flex items-center gap-2">
                              <FileText className="h-3.5 w-3.5" /> Template HSM
                            </span>
                          </SelectItem>
                          <SelectItem value="move_stage">
                            <span className="flex items-center gap-2">
                              <MoveRight className="h-3.5 w-3.5" /> Mover para Etapa
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">Modo</Label>
                      <Select
                        value={a.mode}
                        onValueChange={(v: "auto" | "manual") => update(i, { mode: v })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto">Automática</SelectItem>
                          <SelectItem value="manual">Manual</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1 col-span-2">
                      <Label className="text-xs">Atraso (após entrar na etapa)</Label>
                      <div className="flex gap-2">
                        <Input
                          type="number"
                          min={0}
                          value={d.value}
                          onChange={(e) =>
                            update(i, {
                              delay_minutes: joinDelay(Number(e.target.value), d.unit),
                            })
                          }
                          className="flex-1"
                        />
                        <Select
                          value={d.unit}
                          onValueChange={(u: DelayUnit) =>
                            update(i, { delay_minutes: joinDelay(d.value, u) })
                          }
                        >
                          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="minutes">Minutos</SelectItem>
                            <SelectItem value="hours">Horas</SelectItem>
                            <SelectItem value="days">Dias</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>

                  {a.kind === "send_message" ? (
                    <div className="space-y-1">
                      <Label className="text-xs">Mensagem</Label>
                      <Textarea
                        rows={3}
                        value={a.message_text ?? ""}
                        onChange={(e) => update(i, { message_text: e.target.value })}
                        placeholder="Texto enviado dentro da janela de 24h"
                      />
                    </div>
                  ) : a.kind === "move_stage" ? (
                    <div className="space-y-1">
                      <Label className="text-xs">Etapa de destino</Label>
                      <Select
                        value={a.target_stage_id ?? ""}
                        onValueChange={(v) => update(i, { target_stage_id: v })}
                      >
                        <SelectTrigger><SelectValue placeholder="Selecionar etapa" /></SelectTrigger>
                        <SelectContent>
                          {(stages ?? [])
                            .filter((s: any) => s.id !== stageId)
                            .map((s: any) => (
                              <SelectItem key={s.id} value={s.id}>
                                <span className="flex items-center gap-2">
                                  <span
                                    className="inline-block h-2.5 w-2.5 rounded-full"
                                    style={{ background: s.color ?? "#94a3b8" }}
                                  />
                                  {s.name}
                                </span>
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Template</Label>
                        <Select
                          value={a.template_id ?? ""}
                          onValueChange={(v) => update(i, { template_id: v })}
                        >
                          <SelectTrigger><SelectValue placeholder="Selecionar template aprovado" /></SelectTrigger>
                          <SelectContent>
                            {(templates ?? []).map((t: any) => (
                              <SelectItem key={t.id} value={t.id}>
                                {t.name} · {t.language}
                                {t.variables_count ? ` · ${t.variables_count} var.` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {(() => {
                        const tpl = (templates ?? []).find((t: any) => t.id === a.template_id) as any;
                        const count = tpl?.variables_count ?? 0;
                        if (!count) return null;
                        const bindings: VariableBinding[] = Array.isArray(tpl?.variable_bindings)
                          ? (tpl.variable_bindings as VariableBinding[])
                          : [];
                        const hasBindings = bindings.length > 0;
                        const vars = a.template_variables ?? [];
                        return (
                          <div className="space-y-1">
                            <Label className="text-xs">Variáveis ({count})</Label>
                            {hasBindings && (
                              <p className="text-[11px] text-muted-foreground">
                                As variáveis seguem o mapeamento definido na edição do template.
                                Edite o template para alterar, ou sobrescreva com texto fixo abaixo.
                              </p>
                            )}
                            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                              {Array.from({ length: count }).map((_, vi) => {
                                const binding = bindings.find((b) => b.index === vi + 1);
                                const overrideValue = vars[vi] ?? "";
                                const hasOverride = overrideValue !== "";
                                const setOverride = (val: string) => {
                                  const next = [...vars];
                                  while (next.length < count) next.push("");
                                  next[vi] = val;
                                  update(i, { template_variables: next.slice(0, count) });
                                };
                                if (!binding || binding.source === "static" || hasOverride) {
                                  return (
                                    <div key={vi} className="space-y-1">
                                      <div className="text-[11px] text-muted-foreground">
                                        {`{{${vi + 1}}}`}
                                        {binding && binding.source !== "static" && hasOverride
                                          ? ` · sobrescrevendo ${bindingLabel(binding)}`
                                          : binding?.source === "static"
                                          ? " · texto fixo"
                                          : ""}
                                      </div>
                                      <div className="flex gap-1">
                                        <Input
                                          value={overrideValue}
                                          onChange={(e) => setOverride(e.target.value)}
                                          placeholder={
                                            binding?.source === "static" && binding.fallback
                                              ? binding.fallback
                                              : `{{${vi + 1}}}`
                                          }
                                        />
                                        {binding && binding.source !== "static" && (
                                          <Button
                                            type="button"
                                            size="icon"
                                            variant="ghost"
                                            onClick={() => setOverride("")}
                                            title="Voltar ao mapeamento do template"
                                          >
                                            <X className="h-3.5 w-3.5" />
                                          </Button>
                                        )}
                                      </div>
                                    </div>
                                  );
                                }
                                return (
                                  <div
                                    key={vi}
                                    className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5"
                                  >
                                    <div className="min-w-0">
                                      <div className="text-[11px] text-muted-foreground">{`{{${vi + 1}}}`}</div>
                                      <div className="truncate text-xs font-medium">
                                        {bindingLabel(binding)}
                                      </div>
                                    </div>
                                    <Button
                                      type="button"
                                      size="icon"
                                      variant="ghost"
                                      onClick={() => setOverride(" ")}
                                      title="Sobrescrever com texto fixo"
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              );
            })}

            <Button variant="outline" size="sm" onClick={add} className="w-full">
              <Plus className="mr-2 h-4 w-4" /> Adicionar atividade
            </Button>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
