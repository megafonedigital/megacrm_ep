import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, Trash2, Upload, AlertCircle, Variable } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { callFunction } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TemplatePreview, type TemplateButton, type TemplatePreviewData } from "./TemplatePreview";
import {
  BINDING_SOURCE_LABELS,
  PLATFORM_SOURCES,
  getFieldsForSource,
  type BindingSource,
  type VariableBinding,
} from "@/lib/template-bindings";

export interface TemplateRow {
  id: string;
  brand_id: string;
  channel_id: string | null;
  meta_template_id: string | null;
  name: string;
  language: string;
  category: string;
  status: string;
  components: any[];
  variables_count: number;
  header_type: string | null;
  header_handle: string | null;
  variable_bindings?: VariableBinding[] | null;
}

export interface TemplateChannel {
  id: string;
  brand_id: string;
  name: string;
  app_id: string | null;
  waba_id: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  channel: TemplateChannel | null;
  template: TemplateRow | null;
  onSaved: () => void;
}

const CATEGORIES = ["UTILITY", "MARKETING", "AUTHENTICATION"] as const;
const LANGUAGES = [
  { code: "pt_BR", label: "Português (BR)" },
  { code: "en_US", label: "Inglês (US)" },
  { code: "es_ES", label: "Espanhol (ES)" },
];

// Limites Meta
const LIMITS = {
  name: 512,
  headerText: 60,
  body: 1024,
  footer: 60,
  buttonText: 25,
  buttonUrl: 2000,
};

function extractVarNumbers(text: string): number[] {
  const matches = text.match(/\{\{\s*(\d+)\s*\}\}/g) ?? [];
  const nums = matches.map((m) => parseInt(m.replace(/[^\d]/g, ""), 10));
  return Array.from(new Set(nums)).sort((a, b) => a - b);
}

function validateVarSequence(text: string): string | null {
  const nums = extractVarNumbers(text);
  if (nums.length === 0) return null;
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] !== i + 1) {
      return `Variáveis devem ser sequenciais começando em {{1}} (sem pular números). Ex.: {{1}}, {{2}}, {{3}}.`;
    }
  }
  // não pode ter duas variáveis adjacentes (sem texto/espaço entre elas)
  if (/\}\}\s*\{\{/.test(text)) {
    return "Não é permitido colocar duas variáveis coladas. Coloque um texto entre elas.";
  }
  return null;
}

function validateExample(v: string): string | null {
  if (/\{\{|\}\}/.test(v)) return "Os exemplos não podem conter {{ ou }}. Use texto real.";
  if (/[\n\r\t]/.test(v)) return "Os exemplos não podem ter quebras de linha ou tabulações.";
  return null;
}

// Meta exige uma proporção mínima de palavras "reais" por variável.
// Heurística: pelo menos 5 palavras de texto (excluindo variáveis) para cada {{n}}.
function validateWordRatio(text: string): string | null {
  const vars = extractVarNumbers(text);
  if (vars.length === 0) return null;
  const stripped = text.replace(/\{\{\s*\d+\s*\}\}/g, " ");
  const words = stripped.split(/\s+/).filter((w) => w.replace(/[^\p{L}\p{N}]/gu, "").length > 0);
  const minWords = vars.length * 5;
  if (words.length < minWords) {
    return `A Meta exige mais texto em relação ao número de variáveis. Seu texto tem ${words.length} palavra(s) e ${vars.length} variável(is); adicione pelo menos ${minWords - words.length} palavra(s) a mais, ou reduza variáveis.`;
  }
  return null;
}

export function TemplateFormDialog({ open, onClose, channel, template, onSaved }: Props) {
  const isEdit = !!template;

  const [name, setName] = useState("");
  const [category, setCategory] = useState<typeof CATEGORIES[number]>("UTILITY");
  const [language, setLanguage] = useState("pt_BR");
  const [headerKind, setHeaderKind] = useState<"none" | "text" | "media">("none");
  const [headerText, setHeaderText] = useState("");
  const [headerTextExample, setHeaderTextExample] = useState("");
  const [headerMediaType, setHeaderMediaType] = useState<"IMAGE" | "VIDEO" | "DOCUMENT">("IMAGE");
  const [headerHandle, setHeaderHandle] = useState<string | null>(null);
  const [headerMediaUrl, setHeaderMediaUrl] = useState<string | null>(null);
  const [headerMediaMime, setHeaderMediaMime] = useState<string | null>(null);
  const [headerMediaFilename, setHeaderMediaFilename] = useState<string | null>(null);
  const [headerPreviewUrl, setHeaderPreviewUrl] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [bodyExamples, setBodyExamples] = useState<string[]>([]);
  const [footer, setFooter] = useState("");
  const [buttons, setButtons] = useState<TemplateButton[]>([]);
  const [bindings, setBindings] = useState<VariableBinding[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const bodyVars = useMemo(() => extractVarNumbers(body), [body]);
  const headerVars = useMemo(() => extractVarNumbers(headerText), [headerText]);

  // Mantém o tamanho do array de exemplos sincronizado com nº de variáveis
  useEffect(() => {
    setBodyExamples((prev) => {
      const next = [...prev];
      while (next.length < bodyVars.length) next.push("");
      return next.slice(0, bodyVars.length);
    });
    setBindings((prev) => {
      const next: VariableBinding[] = [];
      for (let i = 0; i < bodyVars.length; i++) {
        const idx = bodyVars[i];
        const found = prev.find((b) => b.index === idx);
        next.push(found ?? { index: idx, source: "static", path: "", fallback: "" });
      }
      return next;
    });
  }, [bodyVars.length, bodyVars]);

  useEffect(() => {
    if (!open) return;
    if (template) {
      setName(template.name);
      setCategory((template.category as typeof CATEGORIES[number]) ?? "UTILITY");
      setLanguage(template.language);
      const comps = (template.components ?? []) as any[];
      const header = comps.find((c) => c.type === "HEADER");
      const bodyC = comps.find((c) => c.type === "BODY");
      const footerC = comps.find((c) => c.type === "FOOTER");
      const btnC = comps.find((c) => c.type === "BUTTONS");
      if (header?.format && header.format !== "TEXT") {
        setHeaderKind("media");
        setHeaderMediaType(header.format);
        setHeaderHandle(template.header_handle ?? null);
      } else if (header?.format === "TEXT") {
        setHeaderKind("text");
        setHeaderText(header.text ?? "");
        setHeaderTextExample(header.example?.header_text?.[0] ?? "");
      } else {
        setHeaderKind("none");
      }
      setBody(bodyC?.text ?? "");
      const exArr: string[] = bodyC?.example?.body_text?.[0] ?? [];
      setBodyExamples(Array.isArray(exArr) ? exArr.map((v) => String(v ?? "")) : []);
      setFooter(footerC?.text ?? "");
      setButtons((btnC?.buttons ?? []).map((b: any) => ({ type: b.type, text: b.text, url: b.url })));
      setBindings(Array.isArray(template.variable_bindings) ? template.variable_bindings : []);
    } else {
      setName(""); setCategory("UTILITY"); setLanguage("pt_BR");
      setHeaderKind("none"); setHeaderText(""); setHeaderTextExample(""); setHeaderMediaType("IMAGE");
      setHeaderHandle(null); setHeaderMediaUrl(null); setHeaderMediaMime(null); setHeaderMediaFilename(null); setHeaderPreviewUrl(null);
      setBody(""); setBodyExamples([]); setFooter(""); setButtons([]); setBindings([]);
    }
  }, [open, template]);

  const insertNextVariable = () => {
    const nextN = bodyVars.length + 1;
    const token = `{{${nextN}}}`;
    const el = bodyRef.current;
    if (!el) {
      setBody((b) => b + token);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const before = body.slice(0, start);
    const after = body.slice(end);
    // garante espaço antes/depois para não colar com outra variável/texto
    const needsSpaceBefore = before.length > 0 && !/\s$/.test(before);
    const needsSpaceAfter = after.length > 0 && !/^\s/.test(after);
    const insert = `${needsSpaceBefore ? " " : ""}${token}${needsSpaceAfter ? " " : ""}`;
    const newText = before + insert + after;
    if (newText.length > LIMITS.body) {
      toast.error(`Limite de ${LIMITS.body} caracteres atingido no corpo.`);
      return;
    }
    setBody(newText);
    requestAnimationFrame(() => {
      el.focus();
      const pos = (before + insert).length;
      el.setSelectionRange(pos, pos);
    });
  };

  // Limites duros do WhatsApp para header de template.
  // Meta rejeita non-retryable acima disso e o disparo falha em massa com [131053].
  const HEADER_MAX_MB: Record<"IMAGE" | "VIDEO" | "DOCUMENT", number> = {
    IMAGE: 5,
    VIDEO: 16,
    DOCUMENT: 100,
  };

  const handleUpload = async (file: File) => {
    if (!channel) return;
    if (!channel.app_id) {
      toast.error("Configure o App ID da Meta nas credenciais do canal antes de subir mídia.");
      return;
    }
    const maxMb = HEADER_MAX_MB[headerMediaType];
    const maxBytes = maxMb * 1024 * 1024;
    if (file.size > maxBytes) {
      const actualMb = (file.size / (1024 * 1024)).toFixed(2);
      toast.error(
        `Arquivo de ${actualMb} MB excede o limite de ${maxMb} MB para header ${headerMediaType}. O WhatsApp rejeita mídias acima desse tamanho e o disparo falha com erro [131053]. Comprima ou redimensione o arquivo antes de subir.`,
        { duration: 8000 },
      );
      return;
    }
    setUploading(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const fd = new FormData();
      fd.append("file", file);
      fd.append("channel_id", channel.id);
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-template-header`, {
        method: "POST",
        headers: {
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Falha no upload");
      setHeaderHandle(json.header_handle);
      setHeaderMediaUrl(json.header_media_url ?? null);
      setHeaderMediaMime(json.mime ?? file.type);
      setHeaderMediaFilename(json.filename ?? file.name);
      setHeaderPreviewUrl(URL.createObjectURL(file));
      toast.success("Mídia carregada.");
    } catch (e: any) {
      toast.error(e?.message ?? "Erro no upload");
    } finally {
      setUploading(false);
    }
  };

  const buildComponents = (): Array<Record<string, unknown>> => {
    const comps: Array<Record<string, unknown>> = [];
    if (headerKind === "media" && headerHandle) {
      comps.push({ type: "HEADER", format: headerMediaType, example: { header_handle: [headerHandle] } });
    } else if (headerKind === "text" && headerText.trim()) {
      const h: Record<string, unknown> = { type: "HEADER", format: "TEXT", text: headerText.trim() };
      if (headerVars.length === 1) {
        h.example = { header_text: [headerTextExample.trim()] };
      }
      comps.push(h);
    }
    const bodyComp: Record<string, unknown> = { type: "BODY", text: body };
    if (bodyVars.length > 0) {
      bodyComp.example = { body_text: [bodyExamples.map((v) => v.trim())] };
    }
    comps.push(bodyComp);
    if (footer.trim()) comps.push({ type: "FOOTER", text: footer.trim() });
    if (buttons.length > 0) {
      comps.push({
        type: "BUTTONS",
        buttons: buttons.map((b) => b.type === "URL"
          ? { type: "URL", text: b.text, url: b.url ?? "" }
          : { type: "QUICK_REPLY", text: b.text }),
      });
    }
    return comps;
  };

  const handleSubmit = async () => {
    if (!channel) return;
    if (!isEdit && !/^[a-z0-9_]{1,512}$/.test(name)) {
      toast.error("Nome inválido. Use minúsculas, números e _ (sem espaços).");
      return;
    }
    if (!body.trim()) { toast.error("O corpo é obrigatório."); return; }

    // Validações de variáveis
    const bodyErr = validateVarSequence(body);
    if (bodyErr) { toast.error(bodyErr); return; }
    const ratioErr = validateWordRatio(body);
    if (ratioErr) { toast.error(ratioErr); return; }
    if (bodyVars.length > 0 && bodyExamples.some((e) => !e.trim())) {
      toast.error("Preencha um exemplo para cada variável do corpo.");
      return;
    }
    for (const ex of bodyExamples) {
      const exErr = validateExample(ex);
      if (exErr) { toast.error(exErr); return; }
    }

    if (headerKind === "text") {
      if (headerVars.length > 1 || (headerVars.length === 1 && headerVars[0] !== 1)) {
        toast.error("O header de texto só aceita uma variável e ela precisa ser {{1}}.");
        return;
      }
      if (headerVars.length === 1) {
        if (!headerTextExample.trim()) {
          toast.error("Preencha o exemplo da variável do header.");
          return;
        }
        const hErr = validateExample(headerTextExample);
        if (hErr) { toast.error(hErr); return; }
      }
    }

    if (headerKind === "media" && !headerHandle) { toast.error("Faça upload do arquivo do header."); return; }
    for (const b of buttons) {
      if (!b.text.trim()) { toast.error("Todo botão precisa de texto."); return; }
      if (b.type === "URL" && !b.url?.trim()) { toast.error("Botão URL precisa do link."); return; }
    }

    setSubmitting(true);
    const { data, error } = await callFunction<{ ok: boolean; status: string; subcode?: number; details?: string; error?: string }>(
      "upsert-template",
      {
        channel_id: channel.id,
        template_id: template?.id,
        name,
        category,
        language,
        components: buildComponents(),
        header_type: headerKind === "media" ? headerMediaType : headerKind === "text" ? "TEXT" : null,
        header_handle: headerKind === "media" ? headerHandle : null,
        header_media_url: headerKind === "media" ? headerMediaUrl : null,
        header_media_mime: headerKind === "media" ? headerMediaMime : null,
        header_media_filename: headerKind === "media" ? headerMediaFilename : null,
        variable_bindings: bindings,
      },
    );
    setSubmitting(false);
    if (error) {
      const anyErr = error as unknown as { message?: string; details?: string };
      const msg = [anyErr.message, anyErr.details].filter(Boolean).join(" — ");
      toast.error(msg || "Falha ao enviar template.");
      return;
    }
    if (data?.status === "REJECTED") {
      toast.error("Template rejeitado pela Meta. Revise nome/conteúdo e tente novamente.");
    } else if (data?.status === "PENDING" || data?.status === "updated") {
      toast.success(isEdit ? "Template atualizado e enviado para análise." : "Template enviado para aprovação.");
    } else {
      toast.success(`Status: ${data?.status ?? "ok"}`);
    }
    onSaved();
    onClose();
  };

  const previewData: TemplatePreviewData = {
    headerKind,
    headerText,
    headerTextExample,
    headerMediaType,
    headerMediaPreviewUrl: headerPreviewUrl,
    body,
    bodyExamples,
    footer,
    buttons,
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[88vh] p-0 flex flex-col gap-0">
        <DialogHeader className="px-6 pt-6 pb-3 border-b">
          <DialogTitle>{isEdit ? `Editar template: ${template?.name}` : "Novo template"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Edição via Meta. Apenas corpo, footer e botões podem ser alterados em templates aprovados."
              : "Após enviar, o template fica em análise pela Meta (geralmente alguns minutos)."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-hidden grid md:grid-cols-[minmax(0,1fr)_320px]">
          {/* FORM */}
          <div className="overflow-y-auto px-6 py-4 space-y-3 border-r">
            {channel && !channel.app_id && headerKind === "media" && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Este canal não tem <strong>App ID</strong> configurado. Para subir mídia em headers, edite o canal em Workspaces e adicione o App ID da Meta.
                </AlertDescription>
              </Alert>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Nome</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
                  placeholder="boas_vindas_v1"
                  disabled={isEdit}
                  maxLength={LIMITS.name}
                  className="font-mono text-sm"
                />
              </div>
              <div>
                <Label>Idioma</Label>
                <Select value={language} onValueChange={setLanguage} disabled={isEdit}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((l) => <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Categoria</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as typeof CATEGORIES[number])} disabled={isEdit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Header</Label>
              <Tabs value={headerKind} onValueChange={(v) => setHeaderKind(v as any)} className="mt-1">
                <TabsList className="grid grid-cols-3">
                  <TabsTrigger value="none">Nenhum</TabsTrigger>
                  <TabsTrigger value="text">Texto</TabsTrigger>
                  <TabsTrigger value="media">Mídia</TabsTrigger>
                </TabsList>
                <TabsContent value="text" className="mt-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{headerText.length}/{LIMITS.headerText}</span>
                    {headerVars.length === 0 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7"
                        onClick={() => setHeaderText((t) => (t + (t && !/\s$/.test(t) ? " " : "") + "{{1}}").slice(0, LIMITS.headerText))}
                      >
                        <Variable className="h-3.5 w-3.5" /> Adicionar variável
                      </Button>
                    )}
                  </div>
                  <Input value={headerText} onChange={(e) => setHeaderText(e.target.value)} placeholder="Olá {{1}}" maxLength={LIMITS.headerText} />
                  {headerVars.length === 1 && (
                    <div className="rounded-md border border-border bg-muted/30 p-2">
                      <Label className="text-xs">Exemplo para {"{{1}}"}</Label>
                      <Input
                        value={headerTextExample}
                        onChange={(e) => setHeaderTextExample(e.target.value)}
                        placeholder="Maria"
                        className="mt-1"
                      />
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="media" className="mt-2 space-y-2">
                  <Select value={headerMediaType} onValueChange={(v) => { setHeaderMediaType(v as any); setHeaderHandle(null); setHeaderPreviewUrl(null); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="IMAGE">Imagem</SelectItem>
                      <SelectItem value="VIDEO">Vídeo</SelectItem>
                      <SelectItem value="DOCUMENT">Documento</SelectItem>
                    </SelectContent>
                  </Select>
                  <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border p-4 text-sm hover:bg-accent/50">
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    <span>{headerHandle ? "Mídia carregada — trocar arquivo" : "Selecionar arquivo"}</span>
                    <input
                      type="file"
                      className="hidden"
                      accept={headerMediaType === "IMAGE" ? "image/jpeg,image/png" : headerMediaType === "VIDEO" ? "video/mp4" : "application/pdf"}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }}
                    />
                  </label>
                  <p className="text-[11px] text-muted-foreground">
                    Máx. <strong>{HEADER_MAX_MB[headerMediaType]} MB</strong> para header {headerMediaType}. Arquivos maiores são rejeitados pelo WhatsApp e causam falha [131053] no disparo.
                  </p>
                </TabsContent>
              </Tabs>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <Label>Corpo</Label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{body.length}/{LIMITS.body}</span>
                  <Button type="button" size="sm" variant="outline" className="h-7" onClick={insertNextVariable}>
                    <Variable className="h-3.5 w-3.5" /> Adicionar variável
                  </Button>
                </div>
              </div>
              <Textarea
                ref={bodyRef}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Olá {{1}}, sua compra de {{2}} foi confirmada."
                className="min-h-[120px]"
                maxLength={LIMITS.body}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Variáveis são valores que mudam em cada envio (ex.: nome do cliente). Use o botão acima para inserir.
                Elas precisam ser sequenciais ({"{{1}}, {{2}}…"}), com texto entre cada uma, e não podem ficar no início ou fim da mensagem.
              </p>

              {bodyVars.length > 0 && (
                <div className="mt-3 space-y-2 rounded-md border border-border bg-muted/30 p-3">
                  <p className="text-xs font-medium">Exemplos para aprovação (a Meta exige):</p>
                  {bodyVars.map((n, i) => (
                    <div key={n} className="grid grid-cols-[80px_1fr] items-center gap-2">
                      <Label className="text-xs">{`{{${n}}}`}</Label>
                      <Input
                        value={bodyExamples[i] ?? ""}
                        onChange={(e) => {
                          const next = [...bodyExamples];
                          next[i] = e.target.value;
                          setBodyExamples(next);
                        }}
                        placeholder={`Exemplo para a variável ${n}`}
                      />
                    </div>
                  ))}
                </div>
              )}

              {bodyVars.length > 0 && (
                <div className="mt-3 space-y-2 rounded-md border border-border bg-muted/30 p-3">
                  <p className="text-xs font-medium">Origem das variáveis (preenchimento automático no envio):</p>
                  <p className="text-[11px] text-muted-foreground">
                    Escolha de onde cada variável virá quando o agente enviar o template. Se não houver dado disponível,
                    o exemplo acima é usado como fallback.
                  </p>
                  {bodyVars.map((n, i) => {
                    const b = bindings[i] ?? { index: n, source: "static" as BindingSource, path: "", fallback: "" };
                    const fields = getFieldsForSource(b.source);
                    return (
                      <div key={n} className="grid grid-cols-[60px_140px_1fr] items-center gap-2">
                        <Label className="text-xs">{`{{${n}}}`}</Label>
                        <Select
                          value={b.source}
                          onValueChange={(v) => {
                            const next = [...bindings];
                            next[i] = { index: n, source: v as BindingSource, path: "", fallback: b.fallback ?? "" };
                            setBindings(next);
                          }}
                        >
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {PLATFORM_SOURCES.map((s) => (
                              <SelectItem key={s} value={s}>{BINDING_SOURCE_LABELS[s]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {b.source === "static" ? (
                          <span className="text-[11px] text-muted-foreground">Usa o exemplo acima.</span>
                        ) : (
                          <Select
                            value={b.path}
                            onValueChange={(v) => {
                              const next = [...bindings];
                              next[i] = { ...b, index: n, path: v };
                              setBindings(next);
                            }}
                          >
                            <SelectTrigger className="h-8"><SelectValue placeholder="Selecione o campo" /></SelectTrigger>
                            <SelectContent>
                              {fields.map((f) => (
                                <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between">
                <Label>Footer (opcional)</Label>
                <span className="text-xs text-muted-foreground">{footer.length}/{LIMITS.footer}</span>
              </div>
              <Input value={footer} onChange={(e) => setFooter(e.target.value)} placeholder="Envie SAIR para não receber mais mensagens" maxLength={LIMITS.footer} />
            </div>

            <div>
              <div className="flex items-center justify-between">
                <Label>Botões (até 2)</Label>
                {buttons.length < 2 && (
                  <Button type="button" size="sm" variant="outline" onClick={() => setButtons([...buttons, { type: "QUICK_REPLY", text: "" }])}>
                    <Plus className="h-3.5 w-3.5" /> Adicionar
                  </Button>
                )}
              </div>
              <div className="space-y-2">
                {buttons.map((b, i) => (
                  <div key={i} className="grid grid-cols-[110px_1fr_auto] gap-2">
                    <Select value={b.type} onValueChange={(v) => {
                      const next = [...buttons]; next[i] = { ...next[i], type: v as any }; setButtons(next);
                    }}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="QUICK_REPLY">Resposta</SelectItem>
                        <SelectItem value="URL">Link</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="grid grid-cols-2 gap-2">
                      <Input placeholder="Texto" value={b.text} maxLength={LIMITS.buttonText} onChange={(e) => {
                        const next = [...buttons]; next[i] = { ...next[i], text: e.target.value }; setButtons(next);
                      }} />
                      {b.type === "URL" && (
                        <Input placeholder="https://..." value={b.url ?? ""} maxLength={LIMITS.buttonUrl} onChange={(e) => {
                          const next = [...buttons]; next[i] = { ...next[i], url: e.target.value }; setButtons(next);
                        }} />
                      )}
                    </div>
                    <Button type="button" size="icon" variant="ghost" onClick={() => setButtons(buttons.filter((_, j) => j !== i))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* PREVIEW */}
          <div className="overflow-y-auto px-4 py-4 bg-muted/20 space-y-2">
            <Label>Pré-visualização</Label>
            <TemplatePreview data={previewData} />
            <p className="text-xs text-muted-foreground">Aprovação é feita pela Meta. Status inicial geralmente é PENDING.</p>
          </div>
        </div>

        <DialogFooter className="px-6 py-3 border-t">
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={submitting || uploading}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "Salvar alterações" : "Enviar para aprovação"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
