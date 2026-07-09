import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, X, ChevronLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export type CustomFieldType = "text" | "number" | "date" | "boolean" | "select";

export type CustomFieldOperator =
  | "contains" | "eq" | "starts_with"
  | "neq" | "gt" | "lt" | "between"
  | "in" | "is_true" | "is_false"
  | "before" | "after"
  | "empty" | "not_empty";

export type CustomFieldFilterValue = {
  fieldId: string;
  key: string;
  type: CustomFieldType;
  label: string;
  operator: CustomFieldOperator;
  /** primary value (text/number/date/boolean as string, or first value for between) */
  value?: string;
  /** secondary value for `between` */
  value2?: string;
  /** for select `in` operator */
  values?: string[];
};

interface FieldRow {
  id: string;
  key: string;
  label: string;
  type: CustomFieldType;
  options: string[];
  position: number;
}

interface Props {
  value: CustomFieldFilterValue | null;
  onChange: (v: CustomFieldFilterValue | null) => void;
  brandId: string | null | undefined;
  className?: string;
}

const OPERATORS_BY_TYPE: Record<CustomFieldType, { value: CustomFieldOperator; label: string }[]> = {
  text: [
    { value: "contains", label: "contém" },
    { value: "eq", label: "igual a" },
    { value: "starts_with", label: "começa com" },
    { value: "empty", label: "vazio" },
    { value: "not_empty", label: "preenchido" },
  ],
  number: [
    { value: "eq", label: "=" },
    { value: "neq", label: "≠" },
    { value: "gt", label: ">" },
    { value: "lt", label: "<" },
    { value: "between", label: "entre" },
    { value: "empty", label: "vazio" },
    { value: "not_empty", label: "preenchido" },
  ],
  date: [
    { value: "eq", label: "em" },
    { value: "before", label: "antes de" },
    { value: "after", label: "depois de" },
    { value: "between", label: "entre" },
    { value: "empty", label: "vazio" },
    { value: "not_empty", label: "preenchido" },
  ],
  boolean: [
    { value: "is_true", label: "é Sim" },
    { value: "is_false", label: "é Não" },
    { value: "empty", label: "vazio" },
  ],
  select: [
    { value: "in", label: "é um de" },
    { value: "eq", label: "igual a" },
    { value: "empty", label: "vazio" },
    { value: "not_empty", label: "preenchido" },
  ],
};

function defaultOperator(type: CustomFieldType): CustomFieldOperator {
  return OPERATORS_BY_TYPE[type][0].value;
}

function operatorNeedsValue(op: CustomFieldOperator) {
  return !["empty", "not_empty", "is_true", "is_false"].includes(op);
}

function summarize(v: CustomFieldFilterValue): string {
  const op = OPERATORS_BY_TYPE[v.type].find((o) => o.value === v.operator)?.label ?? v.operator;
  if (!operatorNeedsValue(v.operator)) return `${v.label}: ${op}`;
  if (v.operator === "between") return `${v.label}: ${v.value ?? "?"}–${v.value2 ?? "?"}`;
  if (v.operator === "in") return `${v.label}: ${(v.values ?? []).join(", ") || "?"}`;
  return `${v.label}: ${op} ${v.value ?? ""}`.trim();
}

export function CustomFieldFilterCombobox({ value, onChange, brandId, className }: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"pick" | "edit">("pick");
  const [draft, setDraft] = useState<CustomFieldFilterValue | null>(value);

  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => {
    if (open) setStep(value ? "edit" : "pick");
  }, [open, value]);

  const fieldsQ = useQuery({
    queryKey: ["custom-fields-filter", brandId],
    enabled: !!brandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("custom_fields")
        .select("id, key, label, type, options, position")
        .eq("brand_id", brandId!)
        .order("position").order("label");
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        ...r,
        options: Array.isArray(r.options) ? r.options : [],
      })) as FieldRow[];
    },
  });

  const isActive = !!value;
  const label = useMemo(() => (value ? summarize(value) : "Campos"), [value]);

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null);
  };

  const pickField = (f: FieldRow) => {
    const op = defaultOperator(f.type);
    setDraft({
      fieldId: f.id, key: f.key, type: f.type, label: f.label,
      operator: op,
      value: f.type === "select" ? "" : "",
      values: f.type === "select" ? [] : undefined,
    });
    setStep("edit");
  };

  const apply = () => {
    if (!draft) return;
    // Validate that value is present when needed
    if (operatorNeedsValue(draft.operator)) {
      if (draft.operator === "between" && (!draft.value || !draft.value2)) return;
      if (draft.operator === "in" && (!draft.values || draft.values.length === 0)) return;
      if (!["between", "in"].includes(draft.operator) && !draft.value) return;
    }
    onChange(draft);
    setOpen(false);
  };

  const currentField = draft && fieldsQ.data?.find((f) => f.id === draft.fieldId);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={isActive ? "secondary" : "ghost"}
          size="sm"
          className={cn("font-normal text-foreground", className)}
        >
          <span className="max-w-[220px] truncate">{label}</span>
          {isActive ? (
            <span
              role="button"
              tabIndex={0}
              onClick={clear}
              className="ml-1 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Limpar filtro de campo"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          ) : (
            <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-60" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        {step === "pick" ? (
          <Command>
            <CommandInput placeholder="Buscar campo..." />
            <CommandList className="max-h-[320px]">
              <CommandEmpty>
                {fieldsQ.isLoading ? "Carregando..." : "Nenhum campo personalizado."}
              </CommandEmpty>
              <CommandGroup>
                {(fieldsQ.data ?? []).map((f) => (
                  <CommandItem key={f.id} value={f.label} onSelect={() => pickField(f)}>
                    <span className="flex flex-col">
                      <span className="text-sm">{f.label}</span>
                      <span className="text-[10px] text-muted-foreground font-mono">{f.key} · {f.type}</span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        ) : (
          <div className="p-3 space-y-3">
            <div className="flex items-center gap-1">
              <Button
                type="button" variant="ghost" size="icon" className="h-6 w-6"
                onClick={() => setStep("pick")}
                aria-label="Voltar"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm font-medium truncate">{draft?.label}</span>
            </div>

            {draft && (
              <>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Operador</label>
                  <Select
                    value={draft.operator}
                    onValueChange={(v) =>
                      setDraft({ ...draft, operator: v as CustomFieldOperator, value: "", value2: "", values: [] })
                    }
                  >
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {OPERATORS_BY_TYPE[draft.type].map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {operatorNeedsValue(draft.operator) && (
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Valor</label>
                    {draft.type === "select" ? (
                      draft.operator === "in" ? (
                        <div className="space-y-1 max-h-[180px] overflow-auto rounded border p-2">
                          {(currentField?.options ?? []).map((opt) => {
                            const checked = (draft.values ?? []).includes(opt);
                            return (
                              <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer">
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={(c) => {
                                    const cur = new Set(draft.values ?? []);
                                    if (c) cur.add(opt); else cur.delete(opt);
                                    setDraft({ ...draft, values: Array.from(cur) });
                                  }}
                                />
                                <span>{opt}</span>
                              </label>
                            );
                          })}
                          {(currentField?.options ?? []).length === 0 && (
                            <p className="text-xs text-muted-foreground">Sem opções configuradas.</p>
                          )}
                        </div>
                      ) : (
                        <Select
                          value={draft.value ?? ""}
                          onValueChange={(v) => setDraft({ ...draft, value: v })}
                        >
                          <SelectTrigger className="h-8"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                          <SelectContent>
                            {(currentField?.options ?? []).map((opt) => (
                              <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )
                    ) : draft.operator === "between" ? (
                      <div className="flex gap-2">
                        <Input
                          type={draft.type === "number" ? "number" : draft.type === "date" ? "date" : "text"}
                          value={draft.value ?? ""}
                          onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                          className="h-8"
                        />
                        <Input
                          type={draft.type === "number" ? "number" : draft.type === "date" ? "date" : "text"}
                          value={draft.value2 ?? ""}
                          onChange={(e) => setDraft({ ...draft, value2: e.target.value })}
                          className="h-8"
                        />
                      </div>
                    ) : (
                      <Input
                        type={draft.type === "number" ? "number" : draft.type === "date" ? "date" : "text"}
                        value={draft.value ?? ""}
                        onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                        className="h-8"
                        autoFocus
                        onKeyDown={(e) => { if (e.key === "Enter") apply(); }}
                      />
                    )}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="ghost" size="sm" onClick={() => { onChange(null); setOpen(false); }}>
                    Limpar
                  </Button>
                  <Button type="button" size="sm" onClick={apply}>Aplicar</Button>
                </div>
              </>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
