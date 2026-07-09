import { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Upload, FileText, ArrowRight, ArrowLeft, Check, X, Download, ChevronsUpDown, Plus, Search } from "lucide-react";
import { toast } from "sonner";

import { Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { enqueueContactImport } from "@/lib/contact-imports.functions";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";

type CustomFieldDef = {
  key: string;
  label: string;
  type: string;
  options: Array<{ value: string; label: string }> | any;
};

const CRM_FIELDS = [
  { value: "name", label: "Nome" },
  { value: "profile_name", label: "Nome de perfil" },
  { value: "phone", label: "Telefone (será normalizado)" },
  { value: "wa_id", label: "WhatsApp ID" },
  { value: "email", label: "E-mail" },
  { value: "activecampaign_id", label: "ID do ActiveCampaign" },
] as const;

type Step = "upload" | "map" | "confirm" | "done";

type ParsedCsv = {
  headers: string[];
  rows: Record<string, string>[];
};

type ImportResult = {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; reason: string }>;
};

function decodeCsvBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}


function suggestMapping(header: string, customKeys: string[]): string {
  const h = header.toLowerCase().trim();
  if (/(^|[^a-z])(name|nome|nome completo|full ?name)([^a-z]|$)/.test(h) && !h.includes("perfil") && !h.includes("profile")) return "name";
  if (/perfil|profile/.test(h)) return "profile_name";
  if (/(e[-_ ]?mail|email)/.test(h)) return "email";
  if (/whats|wa[_ ]?id/.test(h)) return "wa_id";
  if (/phone|tel|fone|celular|whatsapp|número|numero/.test(h)) return "phone";
  if (/^id$|active\s*campaign|ac[_-]?id/.test(h)) return "activecampaign_id";
  for (const k of customKeys) {
    if (h === k.toLowerCase() || h === `custom.${k}`.toLowerCase()) return `custom.${k}`;
  }
  return "__ignore__";
}

export function ImportContactsDialog({
  open, onOpenChange, brandId, onImported,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  brandId: string;
  onImported?: () => void;
}) {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [fixedFields, setFixedFields] = useState<Record<string, any>>({});
  const [updateExisting, setUpdateExisting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; rows: number; totalRows: number } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [enqueuedId, setEnqueuedId] = useState<string | null>(null);

  const enqueueFn = useServerFn(enqueueContactImport);
  const navigate = useNavigate();

  const customFieldsQ = useQuery({
    queryKey: ["custom-fields", brandId],
    enabled: open && !!brandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("custom_fields")
        .select("key, label, type, options, position")
        .eq("brand_id", brandId)
        .order("position");
      if (error) throw error;
      return (data ?? []) as CustomFieldDef[];
    },
  });

  const tagsQ = useQuery({
    queryKey: ["tags-picker", brandId],
    enabled: open && !!brandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tags")
        .select("id, name, color")
        .eq("brand_id", brandId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string; color: string | null }>;
    },
  });

  // reset on open
  useEffect(() => {
    if (open) {
      setStep("upload");
      setFile(null);
      setParsed(null);
      setMapping({});
      setSelectedTagIds([]);
      setFixedFields({});
      setUpdateExisting(false);
      setResult(null);
      setProgress(null);
    }
  }, [open]);

  const customKeys = useMemo(() => (customFieldsQ.data ?? []).map((f) => f.key), [customFieldsQ.data]);

  const finalizeParsed = (headers: string[], rows: Record<string, string>[]) => {
    const cleanHeaders = headers.filter(Boolean);
    if (rows.length === 0 || cleanHeaders.length === 0) {
      toast.error("Arquivo vazio ou sem cabeçalho.");
      return;
    }
    const initialMap: Record<string, string> = {};
    for (const h of cleanHeaders) initialMap[h] = suggestMapping(h, customKeys);
    setParsed({ headers: cleanHeaders, rows });
    setMapping(initialMap);
    setStep("map");
  };

  const handleFile = (f: File) => {
    setFile(f);
    const name = f.name.toLowerCase();
    const isExcel = name.endsWith(".xlsx") || name.endsWith(".xls");
    if (isExcel) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const wb = XLSX.read(data, { type: "array" });
          const firstName = wb.SheetNames[0];
          if (!firstName) { toast.error("Planilha vazia."); return; }
          const ws = wb.Sheets[firstName];
          const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "", raw: false });
          const headers = json.length > 0 ? Object.keys(json[0]) : [];
          const rows: Record<string, string>[] = json.map((r) => {
            const o: Record<string, string> = {};
            for (const h of headers) o[h] = r[h] == null ? "" : String(r[h]);
            return o;
          });
          finalizeParsed(headers, rows);
        } catch (err: any) {
          toast.error(`Falha ao ler Excel: ${err?.message ?? err}`);
        }
      };
      reader.onerror = () => toast.error("Falha ao ler arquivo.");
      reader.readAsArrayBuffer(f);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const buf = e.target?.result as ArrayBuffer;
        const text = decodeCsvBuffer(buf);
        Papa.parse(text, {
          header: true,
          skipEmptyLines: true,
          delimitersToGuess: [",", ";", "\t", "|"],
          complete: (res) => {
            const headers = (res.meta.fields ?? []).filter(Boolean) as string[];
            const rows = res.data as Record<string, string>[];
            finalizeParsed(headers, rows);
          },
          error: (err: any) => {
            toast.error(`Falha ao ler CSV: ${err.message}`);
          },
        });
      } catch (err: any) {
        toast.error(`Falha ao ler CSV: ${err?.message ?? err}`);
      }
    };
    reader.onerror = () => toast.error("Falha ao ler arquivo.");
    reader.readAsArrayBuffer(f);
  };

  const mappedTargets = useMemo(() => new Set(Object.values(mapping).filter((v) => v && v !== "__ignore__")), [mapping]);
  const hasPhoneOrWa = mappedTargets.has("phone") || mappedTargets.has("wa_id");

  const runImport = async () => {
    if (!parsed) return;
    setImporting(true);
    setProgress(null);
    try {
      const allRows = parsed.rows.map((r, idx) => {
        const out: any = { _rowIndex: idx, custom: {} as Record<string, any> };
        for (const [k, v] of Object.entries(fixedFields)) {
          if (v !== undefined && v !== null && v !== "") out.custom[k] = v;
        }
        for (const [header, target] of Object.entries(mapping)) {
          if (!target || target === "__ignore__") continue;
          const val = r[header];
          if (val === undefined || val === "") continue;
          if (target.startsWith("custom.")) {
            out.custom[target.slice("custom.".length)] = val;
          } else {
            out[target] = val;
          }
        }
        return out;
      });

      const res: any = await enqueueFn({
        data: {
          brandId,
          filename: file?.name ?? null,
          rows: allRows,
          tagIds: selectedTagIds,
          updateExisting,
        },
      });

      setEnqueuedId(res.importId);
      onImported?.();
      onOpenChange(false);
      toast.success(
        `Importação enfileirada (${allRows.length.toLocaleString()} linhas em ${res.batches} lote(s)). Acompanhe o progresso aqui.`,
        {
          action: {
            label: "Ver progresso",
            onClick: () => navigate({ to: "/admin/contatos/importacoes" }),
          },
        },
      );
      navigate({ to: "/admin/contatos/importacoes" });
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao enfileirar importação");
    } finally {
      setImporting(false);
    }
  };


  const previewRows = parsed?.rows.slice(0, 5) ?? [];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && importing) return; onOpenChange(o); }}>
      <DialogContent
        className="max-w-3xl max-h-[85vh] flex flex-col"
        onInteractOutside={(e) => { if (importing) e.preventDefault(); }}
        onEscapeKeyDown={(e) => { if (importing) e.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle>Importar contatos</DialogTitle>
          <DialogDescription>
            {step === "upload" && "Selecione um arquivo CSV, XLSX ou XLS com seus contatos."}
            {step === "map" && "Mapeie as colunas do arquivo para os campos do CRM."}
            {step === "confirm" && "Escolha tags e revise as opções de importação."}
            {step === "done" && "Importação concluída."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto -mx-6 px-6">

        {step === "upload" && (
          <div className="space-y-4">
            <label className="block border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:bg-muted/40">
              <input
                type="file"
                accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
              <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
              <p className="text-sm mt-2">Clique para selecionar um arquivo .csv, .xlsx ou .xls</p>
              <p className="text-xs text-muted-foreground mt-1">CSV detecta vírgula, ponto-e-vírgula ou tab automaticamente. Aceita UTF-8 e Windows-1252 (Excel BR) — detecção automática. Arquivos grandes são enviados em lotes.</p>
            </label>
            {file && (
              <p className="text-sm flex items-center gap-2"><FileText className="h-4 w-4" />{file.name}</p>
            )}
          </div>
        )}

        {step === "map" && parsed && (
          <div className="space-y-4">
            <div className="space-y-2">
              {parsed.headers.map((h) => (
                <div key={h} className="grid grid-cols-[1fr_16px_1fr] items-center gap-2">
                  <div className="text-sm truncate">
                    <div className="font-medium">{h}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      ex.: {previewRows.map((r) => r[h]).filter(Boolean).slice(0, 2).join(" · ") || "—"}
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  <Select value={mapping[h] ?? "__ignore__"} onValueChange={(v) => setMapping((prev) => ({ ...prev, [h]: v }))}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__ignore__">Ignorar</SelectItem>
                      {CRM_FIELDS.map((f) => (
                        <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                      ))}
                      {(customFieldsQ.data ?? []).map((f) => (
                        <SelectItem key={f.key} value={`custom.${f.key}`}>Personalizado: {f.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            {!hasPhoneOrWa && (
              <p className="text-xs text-destructive">Mapeie pelo menos uma coluna para Telefone ou WhatsApp ID.</p>
            )}
            <p className="text-xs text-muted-foreground">{parsed.rows.length} linha(s) detectada(s).</p>
          </div>
        )}

        {step === "confirm" && parsed && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Tags a aplicar</Label>
              <TagIdPicker
                brandId={brandId}
                tags={tagsQ.data ?? []}
                selectedIds={selectedTagIds}
                onChange={setSelectedTagIds}
              />
            </div>

            <div className="space-y-2">
              <Label>Valores fixos para campos personalizados</Label>
              <p className="text-xs text-muted-foreground">
                Defina um valor a ser aplicado em todos os contatos importados. Se a planilha já trouxer um valor para o mesmo campo, o valor da planilha prevalece.
              </p>
              <FixedFieldsEditor
                fields={customFieldsQ.data ?? []}
                values={fixedFields}
                onChange={setFixedFields}
              />
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label className="text-sm">Atualizar contatos existentes</Label>
                <p className="text-xs text-muted-foreground">Quando ligado, contatos com o mesmo WhatsApp ID terão dados atualizados. Caso contrário, são pulados.</p>
              </div>
              <Switch checked={updateExisting} onCheckedChange={setUpdateExisting} />
            </div>

            <div className="rounded-md bg-muted/40 p-3 text-sm space-y-1">
              <p><strong>{parsed.rows.length}</strong> linha(s) a processar.</p>
              <p className="text-xs text-muted-foreground">
                Campos mapeados: {Array.from(mappedTargets).join(", ") || "nenhum"}
              </p>
              {Object.keys(fixedFields).length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Valores fixos: {Object.keys(fixedFields).join(", ")}
                </p>
              )}
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/40 p-4 space-y-2">
              <p className="text-sm font-medium flex items-center gap-2">
                <Check className="h-4 w-4 text-green-600" /> Importação enfileirada com sucesso
              </p>
              <p className="text-xs text-muted-foreground">
                {parsed?.rows.length.toLocaleString()} linha(s) estão sendo processadas em segundo plano. Você pode fechar esta janela — acompanhe o progresso e os logs detalhados na tela de importações.
              </p>
              <Link
                to="/admin/contatos/importacoes"
                className="inline-flex items-center text-sm text-primary hover:underline"
                onClick={() => onOpenChange(false)}
              >
                Ver importações <ArrowRight className="h-4 w-4 ml-1" />
              </Link>
            </div>
          </div>
        )}
        </div>

        <DialogFooter className="gap-2">
          {step === "map" && (
            <>
              <Button variant="ghost" onClick={() => setStep("upload")}><ArrowLeft className="h-4 w-4 mr-2" />Voltar</Button>
              <Button onClick={() => setStep("confirm")} disabled={!hasPhoneOrWa}>Próximo<ArrowRight className="h-4 w-4 ml-2" /></Button>
            </>
          )}
          {step === "confirm" && (
            <>
              <Button variant="ghost" onClick={() => setStep("map")} disabled={importing}><ArrowLeft className="h-4 w-4 mr-2" />Voltar</Button>
              <Button onClick={runImport} disabled={importing}>
                {importing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                {importing ? "Enfileirando…" : "Importar em segundo plano"}
              </Button>
            </>
          )}
          {step === "done" && (
            <Button onClick={() => onOpenChange(false)}>Fechar</Button>
          )}
        </DialogFooter>

      </DialogContent>
    </Dialog>
  );
}

type TagRow = { id: string; name: string; color: string | null };

function TagIdPicker({
  brandId, tags, selectedIds, onChange,
}: {
  brandId: string;
  tags: TagRow[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const byId = useMemo(() => {
    const m = new Map<string, TagRow>();
    tags.forEach((t) => m.set(t.id, t));
    return m;
  }, [tags]);

  const createMut = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await supabase
        .from("tags")
        .insert({ brand_id: brandId, name, color: "#64748b" })
        .select("id, name, color")
        .single();
      if (error) throw error;
      return data as TagRow;
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["tags-picker", brandId] });
      onChange([...selectedIds, row.id]);
      setInput("");
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao criar tag"),
  });

  const trimmed = input.trim();
  const available = tags.filter((t) => !selectedIds.includes(t.id));
  const exactMatch = tags.some((t) => t.name.toLowerCase() === trimmed.toLowerCase());

  const remove = (id: string) => onChange(selectedIds.filter((x) => x !== id));
  const add = (id: string) => {
    if (!selectedIds.includes(id)) onChange([...selectedIds, id]);
    setInput("");
  };

  return (
    <div className="space-y-2">
      <div ref={containerRef} className="relative">
        <Button
          type="button"
          variant="outline"
          role="combobox"
          className="w-full justify-between font-normal"
          onClick={() => setOpen((o) => !o)}
        >
          Selecionar ou criar tag…
          <ChevronsUpDown className="h-4 w-4 opacity-50" />
        </Button>
        {open && (() => {
          const q = trimmed.toLowerCase();
          const filtered = q ? available.filter((t) => t.name.toLowerCase().includes(q)) : available;
          return (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border bg-popover text-popover-foreground shadow-md">
              <div className="flex items-center border-b px-2">
                <Search className="h-4 w-4 opacity-50 shrink-0" />
                <input
                  autoFocus
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Buscar tag…"
                  className="flex h-9 w-full bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
              <div className="max-h-72 overflow-auto p-1">
                {filtered.length === 0 && !(trimmed && !exactMatch) && (
                  <div className="px-2 py-4 text-center text-xs text-muted-foreground">Nenhuma tag.</div>
                )}
                {filtered.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => { add(t.id); setOpen(false); }}
                    className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full mr-2 inline-block shrink-0"
                      style={{ backgroundColor: t.color ?? "#94a3b8" }}
                    />
                    <span className="truncate">{t.name}</span>
                  </button>
                ))}
                {trimmed && !exactMatch && (
                  <button
                    type="button"
                    disabled={createMut.isPending}
                    onClick={() => createMut.mutate(trimmed)}
                    className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                  >
                    <Plus className="h-3.5 w-3.5 mr-2 shrink-0" />
                    Criar tag "{trimmed}"
                  </button>
                )}
              </div>
            </div>
          );
        })()}
      </div>
      <div className="flex flex-wrap gap-1">
        {selectedIds.length === 0 ? (
          <span className="text-xs text-muted-foreground">Nenhuma tag selecionada</span>
        ) : (
          selectedIds.map((id) => {
            const t = byId.get(id);
            if (!t) return null;
            return (
              <Badge
                key={id}
                variant="secondary"
                className="gap-1"
                style={t.color ? { backgroundColor: `${t.color}20`, color: t.color } : undefined}
              >
                <span
                  className="h-2 w-2 rounded-full inline-block"
                  style={{ backgroundColor: t.color ?? "#94a3b8" }}
                />
                {t.name}
                <button type="button" onClick={() => remove(id)} className="hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })
        )}
      </div>
    </div>
  );
}

function FixedFieldsEditor({
  fields, values, onChange,
}: {
  fields: CustomFieldDef[];
  values: Record<string, any>;
  onChange: (v: Record<string, any>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const byKey = useMemo(() => {
    const m = new Map<string, CustomFieldDef>();
    fields.forEach((f) => m.set(f.key, f));
    return m;
  }, [fields]);

  const available = fields.filter((f) => !(f.key in values));
  const activeKeys = Object.keys(values);

  const setValue = (key: string, value: any) => onChange({ ...values, [key]: value });
  const removeKey = (key: string) => {
    const next = { ...values };
    delete next[key];
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {activeKeys.length > 0 && (
        <div className="space-y-2">
          {activeKeys.map((key) => {
            const def = byKey.get(key);
            if (!def) return null;
            return (
              <div key={key} className="grid grid-cols-[1fr_2fr_auto] items-center gap-2">
                <Label className="text-sm truncate">{def.label}</Label>
                <FixedFieldInput def={def} value={values[key]} onChange={(v) => setValue(key, v)} />
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeKey(key)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {fields.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum campo personalizado cadastrado.</p>
      ) : available.length === 0 ? null : (
        <div ref={containerRef} className="relative inline-block">
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen((o) => !o)}>
            <Plus className="h-4 w-4 mr-2" /> Adicionar campo
          </Button>
          {open && (() => {
            const q = query.trim().toLowerCase();
            const filtered = q ? available.filter((f) => f.label.toLowerCase().includes(q)) : available;
            return (
              <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-md border bg-popover text-popover-foreground shadow-md">
                <div className="flex items-center border-b px-2">
                  <Search className="h-4 w-4 opacity-50 shrink-0" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Buscar campo..."
                    className="flex h-9 w-full bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
                  />
                </div>
                <div className="max-h-72 overflow-auto p-1">
                  {filtered.length === 0 ? (
                    <div className="px-2 py-4 text-center text-xs text-muted-foreground">Nenhum campo encontrado.</div>
                  ) : (
                    filtered.map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => {
                          setValue(f.key, f.type === "boolean" ? false : "");
                          setOpen(false);
                          setQuery("");
                        }}
                        className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                      >
                        {f.label}
                      </button>
                    ))
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function FixedFieldInput({
  def, value, onChange,
}: {
  def: CustomFieldDef;
  value: any;
  onChange: (v: any) => void;
}) {
  if (def.type === "boolean") {
    return (
      <div className="flex items-center h-9">
        <Switch checked={!!value} onCheckedChange={onChange} />
      </div>
    );
  }
  if (def.type === "select") {
    const opts: Array<{ value: string; label: string }> = Array.isArray(def.options)
      ? def.options.map((o: any) =>
          typeof o === "string" ? { value: o, label: o } : { value: o.value ?? o.label, label: o.label ?? o.value })
      : [];
    return (
      <Select value={value ?? ""} onValueChange={onChange}>
        <SelectTrigger className="h-9"><SelectValue placeholder="Selecione..." /></SelectTrigger>
        <SelectContent>
          {opts.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (def.type === "number") {
    return (
      <Input
        type="number"
        className="h-9"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <Input
      className="h-9"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Valor"
    />
  );
}

