// "Gerar com IA": user drops a screenshot of a flow built in any tool,
// the AI returns a best-effort `{ nodes, edges, unresolved }` graph in the
// MegaCRM schema, the user maps any unresolved blocks to native node kinds,
// and we create a draft automation and open the editor.

import { useCallback, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Sparkles, Upload, X, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel,
  SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { KNOWN_NODE_KINDS, type KnownNodeKind } from "@/lib/automation-templates";
import { analyzeFlowImage, type FlowAnalysis } from "@/lib/flow-import.functions";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  brandId: string | null;
  brandName: string | null;
  folderId: string | null;
  onCreated: () => void;
};

type Step = "upload" | "analyzing" | "mapping";

const IGNORE_VALUE = "__ignore__";

// Group kinds for the Select dropdown
const KIND_GROUPS = (() => {
  const map = new Map<string, typeof KNOWN_NODE_KINDS>();
  for (const n of KNOWN_NODE_KINDS) {
    if (!map.has(n.group)) map.set(n.group, []);
    map.get(n.group)!.push(n);
  }
  return Array.from(map.entries());
})();

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = ["image/png", "image/jpeg", "image/webp"] as const;

type OcrBlock = NonNullable<FlowAnalysis["ocr"]>[number];

function uniq(values: string[]) {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

function findOcrBlock(ocr: OcrBlock[] | undefined, originalLabel: string) {
  if (!ocr?.length) return null;
  const label = originalLabel.toLowerCase();
  return ocr.find((b) => b.blockTitle.toLowerCase().includes(label) || label.includes(b.blockTitle.toLowerCase()))
    ?? ocr.find((b) => b.allVisibleText?.some((t) => t.toLowerCase().includes(label) || label.includes(t.toLowerCase())))
    ?? null;
}

function extractTagNames(block: OcrBlock | null, fallbackText: string) {
  const fromOcr = Array.isArray(block?.detectedTagNames) ? block!.detectedTagNames : [];
  const visible = [fallbackText, block?.blockTitle, ...(block?.allVisibleText ?? [])].filter(Boolean) as string[];
  const candidates = visible.filter((text) => {
    const t = text.trim();
    const low = t.toLowerCase();
    return t.length > 2
      && !["add tag", "tag", "action", "continue to next step", "output #1"].some((x) => low.includes(x))
      && !low.includes("whatsapp")
      && !low.includes("template")
      && !low.includes("language")
      && !low.includes("send message")
      && !low.includes("goto")
      && !low.includes("function")
      && !low.includes("blocklist");
  });
  return uniq([...fromOcr, ...candidates]);
}

function extractTemplateName(block: OcrBlock | null, fallbackText: string) {
  const fromOcr = Array.isArray(block?.detectedTemplateNames) ? block!.detectedTemplateNames : [];
  const visible = [fallbackText, block?.blockTitle, ...(block?.allVisibleText ?? [])].filter(Boolean).join("\n");
  const snake = visible.match(/[a-z0-9]+(?:_[a-z0-9]+){2,}/i)?.[0];
  return (fromOcr[0] ?? snake ?? "").trim();
}

function extractLanguage(block: OcrBlock | null, fallback = "pt_BR") {
  const visible = [block?.detectedLanguage, ...(block?.allVisibleText ?? [])].filter(Boolean).join(" ");
  return visible.match(/\b[A-Z]{2}[_-][A-Z]{2}\b/i)?.[0]?.replace("-", "_") ?? fallback;
}

function inferNodeData(kind: string, originalLabel: string, reason: string, block: OcrBlock | null) {
  const text = [originalLabel, reason, block?.blockTitle, ...(block?.allVisibleText ?? [])].filter(Boolean).join("\n");
  if (kind === "condition") {
    return /block\s*list|blocklist|blacklist/i.test(text) ? { kind: "is_blocklisted" } : { kind: "has_tag", tag: extractTagNames(block, text)[0] ?? "" };
  }
  if (kind === "add_tag") return { tags: extractTagNames(block, text), op: /remove|remover|untag/i.test(text) ? "remove" : "add" };
  if (kind === "message" || kind === "question") {
    const templateName = extractTemplateName(block, text);
    return templateName ? { mode: "template", templateName, templateId: "", language: extractLanguage(block) } : { mode: "text", text };
  }
  if (kind === "wait") return { minutes: Number(text.match(/\b(\d+)\b/)?.[1] ?? 1) };
  return {};
}

function UnresolvedDataFields({
  kind, value, onChange,
}: { kind: string; value: Record<string, any>; onChange: (next: Record<string, any>) => void }) {
  if (!kind || kind === IGNORE_VALUE || kind === "trigger") return null;
  if (kind === "condition") return (
    <div className="grid gap-2 pt-1">
      <Label className="text-[11px]">Condição</Label>
      <Select value={value.kind ?? "is_blocklisted"} onValueChange={(v) => onChange({ ...value, kind: v })}>
        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="is_blocklisted">Está no blocklist?</SelectItem>
          <SelectItem value="has_tag">Contato tem tag</SelectItem>
          <SelectItem value="in_window">Janela 24h aberta</SelectItem>
          <SelectItem value="in_pipeline">Está no pipeline</SelectItem>
          <SelectItem value="field">Campo do contato</SelectItem>
        </SelectContent>
      </Select>
      {value.kind === "has_tag" && <Input className="h-8 text-xs" value={value.tag ?? ""} onChange={(e) => onChange({ ...value, tag: e.target.value })} placeholder="Nome da tag" />}
    </div>
  );
  if (kind === "add_tag") return (
    <div className="grid gap-2 pt-1">
      <Label className="text-[11px]">Tags</Label>
      <Input className="h-8 text-xs" value={(value.tags ?? []).join(", ")} onChange={(e) => onChange({ ...value, tags: e.target.value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean) })} placeholder="Nome da tag" />
      <Select value={value.op ?? "add"} onValueChange={(op) => onChange({ ...value, op })}>
        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="add">Adicionar</SelectItem><SelectItem value="remove">Remover</SelectItem></SelectContent>
      </Select>
    </div>
  );
  if (kind === "message" || kind === "question") return (
    <div className="grid gap-2 pt-1">
      <Label className="text-[11px]">Mensagem</Label>
      <Select value={value.mode ?? "template"} onValueChange={(mode) => onChange({ ...value, mode })}>
        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="template">Template WhatsApp</SelectItem><SelectItem value="text">Texto livre</SelectItem></SelectContent>
      </Select>
      {(value.mode ?? "template") === "template" ? (
        <div className="grid grid-cols-[1fr_96px] gap-2">
          <Input className="h-8 text-xs" value={value.templateName ?? ""} onChange={(e) => onChange({ ...value, templateName: e.target.value, templateId: "" })} placeholder="nome_do_template" />
          <Input className="h-8 text-xs" value={value.language ?? "pt_BR"} onChange={(e) => onChange({ ...value, language: e.target.value })} placeholder="pt_BR" />
        </div>
      ) : <Textarea className="text-xs" rows={2} value={value.text ?? ""} onChange={(e) => onChange({ ...value, text: e.target.value })} placeholder="Texto da mensagem" />}
    </div>
  );
  if (kind === "wait") return <Input className="h-8 text-xs mt-2" type="number" min={1} value={value.minutes ?? 1} onChange={(e) => onChange({ ...value, minutes: Number(e.target.value) || 1 })} placeholder="Minutos" />;
  return null;
}

export function ImportFlowFromImageDialog({
  open, onOpenChange, brandId, brandName, folderId, onCreated,
}: Props) {
  const analyze = useServerFn(analyzeFlowImage);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [name, setName] = useState("");
  const [contextHint, setContextHint] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<FlowAnalysis | null>(null);
  // nodeId -> chosen kind, or IGNORE_VALUE for "criar comentário"
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [nodeData, setNodeData] = useState<Record<string, Record<string, any>>>({});
  const [busy, setBusy] = useState(false);

  const reset = useCallback(() => {
    setStep("upload");
    setName("");
    setContextHint("");
    setFile(null);
    setPreview(null);
    setAnalysis(null);
    setMapping({});
    setNodeData({});
    setBusy(false);
  }, []);

  const handleClose = (o: boolean) => {
    if (!o && busy) return;
    onOpenChange(o);
    if (!o) setTimeout(reset, 200);
  };

  const handleFiles = (f: File | null) => {
    if (!f) return;
    if (!(ALLOWED as readonly string[]).includes(f.type)) {
      toast.error("Formato inválido. Use PNG, JPG ou WEBP.");
      return;
    }
    if (f.size > MAX_BYTES) {
      toast.error("Imagem muito grande (máx. 8MB).");
      return;
    }
    setFile(f);
    const url = URL.createObjectURL(f);
    setPreview(url);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) handleFiles(f);
  };

  const fileToBase64 = (f: File) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const result = String(r.result ?? "");
        const idx = result.indexOf(",");
        resolve(idx >= 0 ? result.slice(idx + 1) : result);
      };
      r.onerror = () => reject(new Error("Falha ao ler imagem"));
      r.readAsDataURL(f);
    });

  const runAnalyze = async () => {
    if (!file) return toast.error("Selecione um print primeiro.");
    if (!brandId) return toast.error("Selecione um workspace.");
    setStep("analyzing");
    setBusy(true);
    try {
      const b64 = await fileToBase64(file);
      const res = await analyze({
        data: {
          imageBase64: b64,
          mimeType: file.type as (typeof ALLOWED)[number],
          contextHint: contextHint.trim() || undefined,
        },
      });
      if (!res.ok) {
        toast.error(res.error);
        setStep("upload");
        return;
      }
      setAnalysis(res);
      // pre-fill mapping with AI suggestion when available
      const m: Record<string, string> = {};
      const nd: Record<string, Record<string, any>> = {};
      for (const u of res.unresolved) {
        if (u.suggestion) {
          m[u.nodeId] = u.suggestion;
          nd[u.nodeId] = inferNodeData(u.suggestion, u.originalLabel, u.reason, findOcrBlock(res.ocr, u.originalLabel));
        }
      }
      setMapping(m);
      setNodeData(nd);
      if (!name.trim()) setName("Fluxo gerado com IA");
      setStep("mapping");
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao analisar imagem.");
      setStep("upload");
    } finally {
      setBusy(false);
    }
  };

  const allMapped = useMemo(() => {
    if (!analysis) return false;
    return analysis.unresolved.every((u) => !!mapping[u.nodeId]);
  }, [analysis, mapping]);

  const normalizeTemplateName = (s: string) =>
    String(s ?? "")
      .toLowerCase()
      .trim()
      .replace(/[\s\-]+/g, "_")
      .replace(/[^a-z0-9_]/g, "");

  const deriveButtons = (tpl: any): { type: string; text: string; index: number }[] => {
    const comps: any[] = Array.isArray(tpl?.components) ? tpl.components : [];
    const btnComp = comps.find((c) => c?.type === "BUTTONS");
    if (!btnComp?.buttons) return [];
    return btnComp.buttons.map((b: any, i: number) => ({
      type: b.type,
      text: b.text ?? "(botão)",
      index: i,
    }));
  };

  const resolveTemplateMatch = (
    name: string,
    language: string | undefined,
    templates: any[],
  ): any | null => {
    if (!name) return null;
    const target = normalizeTemplateName(name);
    if (!target) return null;
    const candidates = templates.filter((t) => normalizeTemplateName(t.name) === target);
    if (candidates.length === 0) return null;
    const langNorm = (language ?? "").toLowerCase().replace(/-/g, "_");
    const byLang = langNorm
      ? candidates.find((t) => String(t.language ?? "").toLowerCase().replace(/-/g, "_") === langNorm)
      : null;
    const approved = candidates.find((t) => String(t.status ?? "").toUpperCase() === "APPROVED");
    return byLang ?? approved ?? candidates[0];
  };

  const buildGraph = (templates: any[]) => {
    if (!analysis) return { nodes: [], edges: [] };
    const nodes = analysis.nodes.map((n) => {
      let type = n.kind as string;
      let data: Record<string, any> = { ...(n.data ?? {}) };
      if (n.kind === "unknown") {
        const chosen = mapping[n.id];
        if (!chosen || chosen === IGNORE_VALUE) {
          type = "comment";
          data = { text: n.label || "Bloco não reconhecido" };
        } else {
          type = chosen;
          data = { ...data, ...(nodeData[n.id] ?? {}) };
        }
      }
      // Resolve template name → real template row (when visible in print)
      if ((type === "message" || type === "question") && data.mode === "template" && data.templateName) {
        const match = resolveTemplateMatch(data.templateName, data.language ?? data.templateLanguage, templates);
        if (match) {
          data = {
            ...data,
            templateId: match.id,
            templateName: match.name,
            templateLanguage: match.language,
            language: match.language,
            buttons: deriveButtons(match),
            templateHeaderMediaUrl: null,
            templateHeaderMediaMime: null,
            templateHeaderMediaFilename: null,
            _aiTemplateName: data.templateName,
          };
        }
      }
      return {
        id: n.id,
        type,
        position: n.position ?? { x: 100, y: 100 },
        data: { ...data, _aiLabel: n.label },
      };
    });
    const edges = analysis.edges.map((e, i) => ({
      id: `e-${i}-${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      type: "deletable",
      animated: true,
    }));
    return { nodes, edges };
  };

  const createFlow = async () => {
    if (!brandId) return toast.error("Selecione um workspace.");
    if (!name.trim()) return toast.error("Dê um nome ao fluxo.");
    if (!allMapped) return toast.error("Mapeie todos os blocos não reconhecidos.");
    setBusy(true);
    // Fetch templates for this workspace so we can pre-select the template
    // mentioned in the print when it already exists in one of the channels.
    const { data: tplRows } = await supabase
      .from("whatsapp_templates")
      .select("id, name, language, status, channel_id, components, header_type, header_media_url, header_media_filename, header_media_mime")
      .eq("brand_id", brandId);
    const templates = tplRows ?? [];
    const graph = buildGraph(templates);

    // Detect template nodes that came named from the print but had no match,
    // so we can warn the user with a helpful note on the automation.
    const unmatched: string[] = [];
    for (const n of graph.nodes) {
      const d: any = n.data ?? {};
      if ((n.type === "message" || n.type === "question") && d.mode === "template" && d._aiTemplateName && !d.templateId) {
        unmatched.push(d._aiTemplateName);
      }
    }

    const { data: u } = await supabase.auth.getUser();
    const baseNote = analysis?.notes ? `IA: ${analysis.notes}` : "";
    const unmatchedNote = unmatched.length
      ? `${baseNote ? baseNote + " • " : ""}Templates não encontrados no workspace: ${Array.from(new Set(unmatched)).join(", ")}`
      : baseNote;
    const { data, error } = await supabase
      .from("automations")
      .insert({
        name: name.trim(),
        brand_id: brandId,
        folder_id: folderId,
        created_by: u.user?.id ?? null,
        status: "draft",
        graph,
        description: unmatchedNote ? unmatchedNote.slice(0, 500) : null,
      })
      .select("id")
      .single();
    setBusy(false);
    if (error || !data) {
      return toast.error(error?.message ?? "Erro ao criar fluxo.");
    }
    if (unmatched.length) {
      toast.warning(`Fluxo criado, mas ${unmatched.length} template(s) não encontrado(s) no workspace.`);
    } else {
      toast.success("Fluxo criado a partir do print!");
    }
    onCreated();
    onOpenChange(false);
    setTimeout(reset, 200);
    window.location.href = `/admin/automacoes/${data.id}`;
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-ai" />
            Gerar fluxo com IA a partir de um print
          </DialogTitle>
          <DialogDescription>
            Envie um print de qualquer construtor de fluxo. A IA tenta recriar o grafo no MegaCRM.
            Blocos não reconhecidos serão mapeados por você antes de criar.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1">
          {step === "upload" && (
            <div className="space-y-4">
              <div>
                <Label>Nome do fluxo (opcional)</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex.: Boas-vindas (gerado do print)"
                />
              </div>

              <div>
                <Label>Print do fluxo</Label>
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={onDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-1 cursor-pointer rounded-md border-2 border-dashed border-input hover:border-ai/50 transition-colors p-6 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground"
                >
                  {preview ? (
                    <div className="relative w-full">
                      <img src={preview} alt="preview" className="max-h-64 mx-auto rounded" />
                      <Button
                        size="icon"
                        variant="secondary"
                        className="absolute top-1 right-1 h-7 w-7"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFile(null);
                          setPreview(null);
                        }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                      <div className="text-xs text-muted-foreground mt-2 text-center">
                        {file?.name} — {file ? Math.round(file.size / 1024) : 0} KB
                      </div>
                    </div>
                  ) : (
                    <>
                      <Upload className="h-6 w-6" />
                      <div>Clique ou arraste uma imagem (PNG, JPG, WEBP — máx. 8MB)</div>
                    </>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => handleFiles(e.target.files?.[0] ?? null)}
                />
              </div>

              <div>
                <Label>Contexto extra (opcional)</Label>
                <Textarea
                  value={contextHint}
                  onChange={(e) => setContextHint(e.target.value.slice(0, 500))}
                  placeholder="Ex.: este fluxo é de boas-vindas e usa template Meta `promo_2024`."
                  rows={2}
                />
                <div className="text-[10px] text-muted-foreground mt-1">
                  {contextHint.length}/500
                </div>
              </div>

              <div className="text-xs text-muted-foreground">
                Workspace: <strong>{brandName ?? "—"}</strong>
              </div>
            </div>
          )}

          {step === "analyzing" && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-sm text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-ai" />
              <div>Analisando o print (OCR + mapeamento)…</div>
              <div className="text-xs">Pode levar 10-30 segundos para fluxos complexos.</div>
            </div>
          )}

          {step === "mapping" && analysis && (
            <div className="space-y-4">
              <Card className="p-3 bg-muted/30">
                <div className="text-xs text-muted-foreground space-y-1">
                  <div>
                    <strong>{analysis.nodes.length}</strong> blocos identificados,{" "}
                    <strong>{analysis.edges.length}</strong> conexões.
                  </div>
                  {analysis.notes && (
                    <div className="text-[11px] italic">Notas da IA: {analysis.notes}</div>
                  )}
                </div>
              </Card>

              <div>
                <Label>Nome do fluxo</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nome do fluxo"
                />
              </div>

              {analysis.unresolved.length === 0 ? (
                <Card className="p-4 text-sm bg-success/5 border-success/30">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-success" />
                    Todos os blocos foram reconhecidos! Clique em criar.
                  </div>
                </Card>
              ) : (
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <ImageIcon className="h-3.5 w-3.5" />
                    Blocos não reconhecidos ({analysis.unresolved.length})
                  </Label>
                  <div className="text-xs text-muted-foreground">
                    Escolha qual nó do MegaCRM substitui cada bloco original.
                  </div>
                  <div className="space-y-2">
                    {analysis.unresolved.map((u) => (
                      <Card key={u.nodeId} className="p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">
                              {u.originalLabel || u.nodeId}
                            </div>
                            <div className="text-[11px] text-muted-foreground line-clamp-2">
                              {u.reason}
                            </div>
                          </div>
                          {u.suggestion && (
                            <Badge variant="outline" className="text-[10px] shrink-0">
                              Sugestão: {u.suggestion}
                            </Badge>
                          )}
                        </div>
                        <Select
                          value={mapping[u.nodeId] ?? ""}
                          onValueChange={(v) => setMapping((m) => ({ ...m, [u.nodeId]: v }))}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Escolher substituto…" />
                          </SelectTrigger>
                          <SelectContent>
                            {KIND_GROUPS.map(([group, items]) => (
                              <SelectGroup key={group}>
                                <SelectLabel className="text-[10px]">{group}</SelectLabel>
                                {items.map((it) => (
                                  <SelectItem key={it.kind} value={it.kind}>
                                    {it.label}
                                    <span className="text-muted-foreground ml-1">
                                      ({it.kind})
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            ))}
                            <SelectGroup>
                              <SelectLabel className="text-[10px]">Outro</SelectLabel>
                              <SelectItem value={IGNORE_VALUE}>
                                Ignorar (criar comentário no lugar)
                              </SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        {mapping[u.nodeId] && mapping[u.nodeId] !== IGNORE_VALUE && (
                          <UnresolvedDataFields
                            kind={mapping[u.nodeId]}
                            value={nodeData[u.nodeId] ?? {}}
                            onChange={(next) => setNodeData((d) => ({ ...d, [u.nodeId]: next }))}
                          />
                        )}
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="pt-3 border-t">
          {step === "upload" && (
            <>
              <Button variant="outline" onClick={() => handleClose(false)} disabled={busy}>
                Cancelar
              </Button>
              <Button onClick={runAnalyze} disabled={!file || busy}>
                <Sparkles className="h-4 w-4 mr-1" />
                Analisar print
              </Button>
            </>
          )}
          {step === "analyzing" && (
            <Button variant="outline" disabled>
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              Analisando…
            </Button>
          )}
          {step === "mapping" && (
            <>
              <Button variant="outline" onClick={() => setStep("upload")} disabled={busy}>
                Voltar
              </Button>
              <Button onClick={createFlow} disabled={busy || !allMapped}>
                {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Confirmar e criar fluxo
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Re-export for convenience
export type { KnownNodeKind };
