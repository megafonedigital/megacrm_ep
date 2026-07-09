import { useMemo, useState } from "react";
import { Loader2, Sparkles, Trash2, Pencil, ChevronRight, Plus, ArrowUp, ArrowDown, Check } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { callFunction } from "@/lib/api";
import { TemplatePreview, type TemplatePreviewData, type TemplateButton } from "./TemplatePreview";
import { generateTemplatesFromBrief, type GeneratedTemplate } from "@/lib/templates-ai.functions";
import type { TemplateChannel } from "./TemplateFormDialog";
import {
  BINDING_SOURCE_LABELS,
  PLATFORM_SOURCES,
  getFieldsForSource,
  type BindingSource,
  type VariableBinding,
} from "@/lib/template-bindings";

const CATEGORIES = ["MARKETING", "UTILITY", "AUTHENTICATION"] as const;
const LANGUAGES = [
  { code: "pt_BR", label: "Português (BR)" },
  { code: "en_US", label: "Inglês (US)" },
  { code: "es_ES", label: "Espanhol (ES)" },
];
const OPT_OUT_REGEX = /parar|n[ãa]o quero|cancelar|sair|descadastrar|bloquear|unsubscribe|stop/i;
const DEFAULT_OPT_OUT = "Parar de receber";

type Category = (typeof CATEGORIES)[number];

type DraftHeader = { type: "HEADER"; format: "TEXT"; text: string };
type DraftBody = { type: "BODY"; text: string };
type DraftFooter = { type: "FOOTER"; text: string };
type DraftButtons = { type: "BUTTONS"; buttons: Array<{ type: "QUICK_REPLY"; text: string }> };
type DraftComponent = DraftHeader | DraftBody | DraftFooter | DraftButtons;

type Draft = {
  name: string;
  category: Category;
  language: string;
  header: string;          // empty -> no header
  body: string;
  footer: string;          // empty -> no footer
  buttons: string[];       // QUICK_REPLY texts; empty list -> no buttons
  variables_legend: { index: number; label: string }[];
  bodyExamples: Record<number, string>;
  headerExample: string;
  bindings: VariableBinding[];
};

function extractVarNumbers(text: string): number[] {
  const matches = text.match(/\{\{\s*(\d+)\s*\}\}/g) ?? [];
  const nums = matches.map((m) => parseInt(m.replace(/[^\d]/g, ""), 10));
  return Array.from(new Set(nums)).sort((a, b) => a - b);
}

function defaultBindingFor(label: string, example: string): VariableBinding {
  const l = (label || "").toLowerCase();
  const ex = (example || "").trim();
  if (/(produto|curso|treinamento|aula)/.test(l)) {
    return { index: 0, source: "hotmart", path: "data.product.name", fallback: ex };
  }
  if (/(valor|pre[cç]o)/.test(l)) {
    return { index: 0, source: "hotmart", path: "data.purchase.price.value", fallback: ex };
  }
  if (/e-?mail/.test(l)) {
    return { index: 0, source: "contact", path: "metadata.email", fallback: ex };
  }
  if (/(nome|cliente|comprador|aluno)/.test(l)) {
    return { index: 0, source: "contact", path: "name", fallback: ex };
  }
  return { index: 0, source: "static", path: "", fallback: ex };
}

function ensureOptOut(buttons: string[]): string[] {
  if (buttons.length === 0) return buttons;
  if (buttons.some((b) => OPT_OUT_REGEX.test(b))) return buttons;
  if (buttons.length >= 10) return [...buttons.slice(0, 9), DEFAULT_OPT_OUT];
  return [...buttons, DEFAULT_OPT_OUT];
}

function toDraft(g: GeneratedTemplate, fallbackCategory: Category, fallbackLanguage: string): Draft {
  const header = g.components.find((c) => c.type === "HEADER") as DraftHeader | undefined;
  const body = g.components.find((c) => c.type === "BODY") as DraftBody | undefined;
  const footer = g.components.find((c) => c.type === "FOOTER") as DraftFooter | undefined;
  const btns = g.components.find((c) => c.type === "BUTTONS") as DraftButtons | undefined;

  const buttons = ensureOptOut((btns?.buttons ?? []).map((b) => b.text.slice(0, 25)));

  const bodyExamples: Record<number, string> = {};
  const bodyVars = body ? extractVarNumbers(body.text) : [];
  for (const n of bodyVars) {
    const found = g.variables_legend?.find((l) => l.index === n);
    bodyExamples[n] = (found?.example ?? "").slice(0, 60);
  }
  const headerVars = header ? extractVarNumbers(header.text) : [];
  const headerExample = headerVars.length === 1
    ? (g.variables_legend?.find((l) => l.index === headerVars[0])?.example ?? "").slice(0, 60)
    : "";

  const allVarNumbers = Array.from(new Set([...bodyVars, ...headerVars])).sort((a, b) => a - b);
  const bindings: VariableBinding[] = allVarNumbers.map((n) => {
    const legend = g.variables_legend?.find((l) => l.index === n);
    const b = defaultBindingFor(legend?.label ?? "", legend?.example ?? "");
    return { ...b, index: n };
  });

  return {
    name: g.name,
    category: fallbackCategory,
    language: fallbackLanguage,
    header: header?.text ?? "",
    body: body?.text ?? "",
    footer: footer?.text ?? "",
    buttons,
    variables_legend: (g.variables_legend ?? []).map((l) => ({ index: l.index, label: l.label })),
    bodyExamples,
    headerExample,
    bindings,
  };
}

function previewFor(d: Draft): TemplatePreviewData {
  const bodyVars = extractVarNumbers(d.body);
  const orderedExamples = bodyVars.map((n) => d.bodyExamples[n] ?? "");
  const buttons: TemplateButton[] = d.buttons.map((t) => ({ type: "QUICK_REPLY", text: t }));
  return {
    headerKind: d.header.trim() ? "text" : "none",
    headerText: d.header.trim() || undefined,
    headerTextExample: d.headerExample,
    body: d.body,
    bodyExamples: orderedExamples,
    footer: d.footer.trim() || undefined,
    buttons,
  };
}

function buildComponentsForUpsert(d: Draft): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  if (d.header.trim()) {
    const vars = extractVarNumbers(d.header);
    const comp: Record<string, unknown> = { type: "HEADER", format: "TEXT", text: d.header };
    if (vars.length === 1 && d.headerExample.trim()) {
      comp.example = { header_text: [d.headerExample.trim()] };
    }
    out.push(comp);
  }
  const bodyVars = extractVarNumbers(d.body);
  const bodyComp: Record<string, unknown> = { type: "BODY", text: d.body };
  if (bodyVars.length > 0) {
    bodyComp.example = { body_text: [bodyVars.map((n) => (d.bodyExamples[n] ?? "").trim())] };
  }
  out.push(bodyComp);
  if (d.footer.trim()) out.push({ type: "FOOTER", text: d.footer });
  if (d.buttons.length > 0) {
    out.push({
      type: "BUTTONS",
      buttons: d.buttons.map((t) => ({ type: "QUICK_REPLY", text: t })),
    });
  }
  return out;
}

interface Props {
  open: boolean;
  onClose: () => void;
  channel: TemplateChannel | null;
  onSaved: () => void;
}

export function GenerateTemplatesWithAIDialog({ open, onClose, channel, onSaved }: Props) {
  const [brief, setBrief] = useState("");
  const [category, setCategory] = useState<Category>("MARKETING");
  const [language, setLanguage] = useState("pt_BR");
  const [namePrefix, setNamePrefix] = useState("");
  const [generating, setGenerating] = useState(false);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const generate = useServerFn(generateTemplatesFromBrief);

  const handleGenerate = async () => {
    if (!brief.trim()) { toast.error("Cole o briefing primeiro."); return; }
    setGenerating(true);
    try {
      const res = await generate({ data: { brief: brief.trim(), namePrefix: namePrefix.trim() } });
      const list = res.templates.map((g) => toDraft(g, category, language));
      setDrafts(list);
      toast.success(`${list.length} rascunho(s) gerado(s). Revise antes de enviar.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
    } finally {
      setGenerating(false);
    }
  };

  const updateDraft = (i: number, patch: Partial<Draft>) => {
    setDrafts((prev) => prev ? prev.map((d, idx) => idx === i ? { ...d, ...patch } : d) : prev);
  };
  const updateBody = (i: number, text: string) => {
    setDrafts((prev) => prev ? prev.map((d, idx) => {
      if (idx !== i) return d;
      const newBodyVars = extractVarNumbers(text);
      const headerVars = extractVarNumbers(d.header);
      const allVars = Array.from(new Set([...newBodyVars, ...headerVars])).sort((a, b) => a - b);
      const nextExamples: Record<number, string> = {};
      for (const n of newBodyVars) nextExamples[n] = d.bodyExamples[n] ?? "";
      const nextBindings: VariableBinding[] = allVars.map((n) => {
        const existing = d.bindings.find((b) => b.index === n);
        if (existing) return existing;
        const legend = d.variables_legend.find((l) => l.index === n);
        const def = defaultBindingFor(legend?.label ?? "", "");
        return { ...def, index: n };
      });
      return { ...d, body: text, bodyExamples: nextExamples, bindings: nextBindings };
    }) : prev);
  };
  const updateBinding = (i: number, n: number, patch: Partial<VariableBinding>) => {
    setDrafts((prev) => prev ? prev.map((d, idx) => {
      if (idx !== i) return d;
      const next = d.bindings.map((b) => b.index === n ? { ...b, ...patch } : b);
      return { ...d, bindings: next };
    }) : prev);
  };
  const applyBindingsToAll = (i: number) => {
    setDrafts((prev) => {
      if (!prev) return prev;
      const source = prev[i];
      if (!source) return prev;
      return prev.map((d, idx) => {
        if (idx === i) return d;
        const next = d.bindings.map((b) => {
          const match = source.bindings.find((sb) => sb.index === b.index);
          return match ? { ...match, fallback: b.fallback || match.fallback } : b;
        });
        return { ...d, bindings: next };
      });
    });
    toast.success("Mapeamento aplicado aos outros rascunhos.");
  };
  const updateExample = (i: number, n: number, value: string) => {
    setDrafts((prev) => prev ? prev.map((d, idx) => idx === i ? { ...d, bodyExamples: { ...d.bodyExamples, [n]: value } } : d) : prev);
  };
  const updateButton = (i: number, bi: number, value: string) => {
    setDrafts((prev) => prev ? prev.map((d, idx) => {
      if (idx !== i) return d;
      const next = [...d.buttons];
      next[bi] = value.slice(0, 25);
      return { ...d, buttons: next };
    }) : prev);
  };
  const addButton = (i: number) => {
    setDrafts((prev) => prev ? prev.map((d, idx) => {
      if (idx !== i || d.buttons.length >= 10) return d;
      return { ...d, buttons: [...d.buttons, "Nova opção"] };
    }) : prev);
  };
  const removeButton = (i: number, bi: number) => {
    setDrafts((prev) => prev ? prev.map((d, idx) => idx === i ? { ...d, buttons: d.buttons.filter((_, k) => k !== bi) } : d) : prev);
  };
  const moveButton = (i: number, bi: number, dir: -1 | 1) => {
    setDrafts((prev) => prev ? prev.map((d, idx) => {
      if (idx !== i) return d;
      const next = [...d.buttons];
      const j = bi + dir;
      if (j < 0 || j >= next.length) return d;
      [next[bi], next[j]] = [next[j], next[bi]];
      return { ...d, buttons: next };
    }) : prev);
  };
  const removeDraft = (i: number) => {
    setDrafts((prev) => prev ? prev.filter((_, idx) => idx !== i) : prev);
    setEditingIndex((cur) => (cur === i ? null : cur));
  };

  const allFilled = useMemo(() => {
    if (!drafts || drafts.length === 0) return false;
    return drafts.every((d) => {
      if (!d.name.trim() || !d.body.trim()) return false;
      const bodyVars = extractVarNumbers(d.body);
      for (const n of bodyVars) {
        if (!(d.bodyExamples[n] ?? "").trim()) return false;
      }
      const headerVars = extractVarNumbers(d.header);
      if (headerVars.length === 1 && !d.headerExample.trim()) return false;
      if (d.buttons.some((b) => !b.trim())) return false;
      return true;
    });
  }, [drafts]);

  const handleSubmitAll = async () => {
    if (!channel || !drafts) return;
    setSubmitting(true);
    let ok = 0;
    const errors: string[] = [];
    for (const d of drafts) {
      const { data, error } = await callFunction<{ ok: boolean; status: string }>(
        "upsert-template",
        {
          channel_id: channel.id,
          name: d.name.trim().toLowerCase(),
          category: d.category,
          language: d.language,
          components: buildComponentsForUpsert(d),
          header_type: d.header.trim() ? "TEXT" : null,
          variable_bindings: d.bindings,
        },
      );
      if (error) {
        const m = (error as { message?: string; details?: string }).message ?? "erro";
        errors.push(`${d.name}: ${m}`);
      } else if (data?.status === "REJECTED") {
        errors.push(`${d.name}: rejeitado pela Meta`);
      } else {
        ok++;
      }
    }
    setSubmitting(false);
    if (ok > 0) toast.success(`${ok} template(s) enviado(s) para aprovação.`);
    if (errors.length > 0) toast.error(`${errors.length} com erro: ${errors.slice(0, 3).join(" | ")}`);
    if (errors.length === 0) {
      reset();
      onSaved();
      onClose();
    } else {
      onSaved();
    }
  };

  const reset = () => {
    setBrief("");
    setNamePrefix("");
    setDrafts(null);
    setEditingIndex(null);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !submitting && (reset(), onClose())}>
      <DialogContent className="max-w-5xl max-h-[90vh] p-0 flex flex-col gap-0">
        <DialogHeader className="px-6 pt-6 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" /> Gerar templates com IA</DialogTitle>
          <DialogDescription>
            Cole o briefing das mensagens. A IA monta os templates como rascunho — você revisa, edita e só então envia para aprovação da Meta.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
          {!drafts && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Categoria</Label>
                  <Select value={category} onValueChange={(v) => setCategory(v as Category)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Idioma</Label>
                  <Select value={language} onValueChange={setLanguage}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LANGUAGES.map((l) => <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Prefixo do nome (opcional)</Label>
                  <Input
                    value={namePrefix}
                    onChange={(e) => setNamePrefix(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
                    placeholder="compra_expirada"
                    className="font-mono text-sm"
                  />
                </div>
              </div>

              <div>
                <Label>Briefing</Label>
                <Textarea
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  placeholder={"Cole aqui as mensagens. Ex.:\n\nPRIMEIRA MENSAGEM\nOlá, [NOME]! Sua condição especial para o [NOME DO CURSO]...\n\n🔘 QUERO GARANTIR MEU ACESSO\n..."}
                  rows={16}
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Use <code>[CAMPO]</code> para variáveis. A IA agrupa em <code>{"{{1}}"}, {"{{2}}"}</code>, sugere exemplos e adiciona um botão de opt-out quando o template tem botões.
                </p>
              </div>
            </>
          )}

          {drafts && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {drafts.length} rascunho(s). Edite o que precisar e ajuste os exemplos antes de enviar.
                </p>
                <Button variant="ghost" size="sm" onClick={() => { setDrafts(null); setEditingIndex(null); }} disabled={submitting}>
                  Voltar ao briefing
                </Button>
              </div>
              {drafts.map((d, i) => {
                const bodyVars = extractVarNumbers(d.body);
                const isEditing = editingIndex === i;
                return (
                  <Card key={i} className="p-4 grid md:grid-cols-[minmax(0,1fr)_320px] gap-4">
                    <div className="space-y-3 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Input
                          value={d.name}
                          onChange={(e) => updateDraft(i, { name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })}
                          className="font-mono text-sm flex-1 min-w-[180px]"
                          maxLength={60}
                        />
                        {!isEditing && <Badge variant="outline">{d.category}</Badge>}
                        {!isEditing && <Badge variant="outline">{d.language}</Badge>}
                        <Button
                          variant={isEditing ? "default" : "ghost"}
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setEditingIndex(isEditing ? null : i)}
                          title={isEditing ? "Concluir edição" : "Editar"}
                        >
                          {isEditing ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeDraft(i)} title="Remover">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      {isEditing && (
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs">Categoria</Label>
                            <Select value={d.category} onValueChange={(v) => updateDraft(i, { category: v as Category })}>
                              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs">Idioma</Label>
                            <Select value={d.language} onValueChange={(v) => updateDraft(i, { language: v })}>
                              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {LANGUAGES.map((l) => <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      )}

                      {isEditing && (
                        <div>
                          <Label className="text-xs">Cabeçalho (opcional, texto)</Label>
                          <Input
                            value={d.header}
                            onChange={(e) => updateDraft(i, { header: e.target.value })}
                            maxLength={60}
                            placeholder="Ex.: Sua inscrição"
                          />
                        </div>
                      )}

                      {isEditing && (
                        <div>
                          <Label className="text-xs">Corpo</Label>
                          <Textarea
                            value={d.body}
                            onChange={(e) => updateBody(i, e.target.value)}
                            rows={8}
                            maxLength={1024}
                            className="font-mono text-xs"
                          />
                          <p className="text-[10px] text-muted-foreground mt-1">{d.body.length}/1024 — use {"{{1}}"}, {"{{2}}"}... para variáveis.</p>
                        </div>
                      )}

                      {isEditing && (
                        <div>
                          <Label className="text-xs">Rodapé (opcional)</Label>
                          <Input
                            value={d.footer}
                            onChange={(e) => updateDraft(i, { footer: e.target.value })}
                            maxLength={60}
                          />
                        </div>
                      )}

                      {isEditing && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs">Botões de resposta rápida ({d.buttons.length}/10)</Label>
                            <Button type="button" variant="ghost" size="sm" onClick={() => addButton(i)} disabled={d.buttons.length >= 10}>
                              <Plus className="h-3 w-3" /> Adicionar
                            </Button>
                          </div>
                          {d.buttons.map((b, bi) => (
                            <div key={bi} className="flex items-center gap-1">
                              <Input
                                value={b}
                                onChange={(e) => updateButton(i, bi, e.target.value)}
                                maxLength={25}
                                className="text-sm flex-1"
                              />
                              <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => moveButton(i, bi, -1)} disabled={bi === 0} title="Subir">
                                <ArrowUp className="h-3 w-3" />
                              </Button>
                              <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => moveButton(i, bi, 1)} disabled={bi === d.buttons.length - 1} title="Descer">
                                <ArrowDown className="h-3 w-3" />
                              </Button>
                              <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeButton(i, bi)} title="Remover">
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          ))}
                          {d.buttons.length > 0 && !d.buttons.some((b) => OPT_OUT_REGEX.test(b)) && (
                            <p className="text-[10px] text-amber-600 dark:text-amber-400">
                              Dica: inclua um botão de opt-out (ex.: "Parar de receber") para reduzir bloqueios.
                            </p>
                          )}
                        </div>
                      )}

                      {bodyVars.length > 0 && (
                        <div className="space-y-2">
                          <Label className="text-xs">Exemplos das variáveis</Label>
                          {bodyVars.map((n) => {
                            const legend = d.variables_legend.find((l) => l.index === n)?.label ?? `Variável ${n}`;
                            return (
                              <div key={n} className="flex items-center gap-2">
                                <Badge variant="secondary" className="font-mono">{`{{${n}}}`}</Badge>
                                <span className="text-xs text-muted-foreground min-w-[140px] truncate">{legend}</span>
                                <ChevronRight className="h-3 w-3 text-muted-foreground" />
                                <Input
                                  value={d.bodyExamples[n] ?? ""}
                                  onChange={(e) => updateExample(i, n, e.target.value)}
                                  placeholder={`Exemplo para ${legend}`}
                                  className="text-sm flex-1"
                                />
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {extractVarNumbers(d.header).length === 1 && (
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="font-mono">{`Cabeçalho`}</Badge>
                          <ChevronRight className="h-3 w-3 text-muted-foreground" />
                          <Input
                            value={d.headerExample}
                            onChange={(e) => updateDraft(i, { headerExample: e.target.value })}
                            placeholder="Exemplo da variável do cabeçalho"
                            className="text-sm flex-1"
                          />
                        </div>
                      )}

                      {d.bindings.length > 0 && (
                        <div className="rounded-md border p-3 space-y-2 bg-muted/30">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div>
                              <Label className="text-xs">Origem das variáveis (preenchimento automático no envio)</Label>
                              <p className="text-[10px] text-muted-foreground">
                                De onde cada variável virá. Se não houver dado, usa o exemplo como fallback.
                              </p>
                            </div>
                            {drafts.length > 1 && (
                              <Button type="button" variant="outline" size="sm" onClick={() => applyBindingsToAll(i)}>
                                Aplicar a todos
                              </Button>
                            )}
                          </div>
                          {d.bindings.map((b) => {
                            const fields = getFieldsForSource(b.source);
                            return (
                              <div key={b.index} className="grid grid-cols-[auto_140px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2">
                                <Badge variant="secondary" className="font-mono">{`{{${b.index}}}`}</Badge>
                                <Select
                                  value={b.source}
                                  onValueChange={(v) =>
                                    updateBinding(i, b.index, { source: v as BindingSource, path: v === "static" ? "" : "" })
                                  }
                                >
                                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {PLATFORM_SOURCES.map((s) => (
                                      <SelectItem key={s} value={s} className="text-xs">{BINDING_SOURCE_LABELS[s]}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                {b.source === "static" ? (
                                  <div className="text-[10px] text-muted-foreground italic">Sempre usa o texto fallback →</div>
                                ) : (
                                  <Select
                                    value={b.path}
                                    onValueChange={(v) => updateBinding(i, b.index, { path: v })}
                                  >
                                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione um campo" /></SelectTrigger>
                                    <SelectContent>
                                      {fields.map((f) => (
                                        <SelectItem key={f.key} value={f.key} className="text-xs">{f.label}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                )}
                                <Input
                                  value={b.fallback ?? ""}
                                  onChange={(e) => updateBinding(i, b.index, { fallback: e.target.value })}
                                  placeholder="Fallback (texto)"
                                  className="h-8 text-xs"
                                />
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <TemplatePreview data={previewFor(d)} hideEmptyMedia />
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-3 border-t">
          <Button variant="ghost" onClick={() => { reset(); onClose(); }} disabled={submitting || generating}>
            Cancelar
          </Button>
          {!drafts && (
            <Button onClick={handleGenerate} disabled={generating || !brief.trim() || !channel}>
              {generating && <Loader2 className="h-4 w-4 animate-spin" />}
              <Sparkles className="h-4 w-4" /> Gerar rascunhos
            </Button>
          )}
          {drafts && (
            <Button onClick={handleSubmitAll} disabled={submitting || !allFilled || drafts.length === 0}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Enviar {drafts.length} para aprovação
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
