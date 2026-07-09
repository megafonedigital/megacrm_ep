import { useState, useMemo, useRef, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Megaphone, Users, Clock, Gauge, ChevronRight, ChevronLeft, AlertTriangle, ChevronsUpDown, Check, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { createBroadcast, previewBroadcastAudience } from "@/lib/broadcasts.functions";
import { TIERS } from "@/lib/integrations-tiers";
import { getGlobalLimitsSummary } from "@/lib/integrations-limits.functions";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  brandId: string;
  lockedAutomationId?: string;
  lockedAutomationName?: string;
  lockedTagId?: string;
  lockedTagName?: string;
  defaultName?: string;
  title?: string;
}

function TagPickerCombobox({
  tags,
  value,
  onChange,
  placeholder,
  clearLabel,
}: {
  tags: { id: string; name: string }[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  clearLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = tags.find((t) => t.id === value);

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

  const filtered = tags.filter((t) => t.name.toLowerCase().includes(query.toLowerCase()));

  const pick = (id: string) => { onChange(id); setOpen(false); setQuery(""); };

  return (
    <div ref={containerRef} className="relative">
      <Button
        type="button"
        variant="outline"
        role="combobox"
        className="w-full justify-between font-normal"
        onClick={() => setOpen((o) => !o)}
      >
        <span className={cn("truncate", !selected && "text-muted-foreground")}>
          {selected ? selected.name : placeholder}
        </span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border bg-popover text-popover-foreground shadow-md">
          <div className="flex items-center border-b px-2">
            <Search className="h-4 w-4 opacity-50 shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar tag…"
              className="flex h-9 w-full bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="max-h-72 overflow-auto p-1">
            <button
              type="button"
              onClick={() => pick("")}
              className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
            >
              <Check className={cn("mr-2 h-4 w-4", !value ? "opacity-100" : "opacity-0")} />
              {clearLabel}
            </button>
            {filtered.length === 0 ? (
              <div className="px-2 py-6 text-center text-sm text-muted-foreground">Nenhuma tag encontrada.</div>
            ) : (
              filtered.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => pick(t.id)}
                  className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                >
                  <Check className={cn("mr-2 h-4 w-4", value === t.id ? "opacity-100" : "opacity-0")} />
                  {t.name}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}


export function NewBroadcastDialog({ open, onOpenChange, brandId, lockedAutomationId, lockedAutomationName, lockedTagId, lockedTagName, defaultName, title }: Props) {
  const qc = useQueryClient();
  const [step, setStep] = useState(1);
  const [name, setName] = useState(defaultName ?? "");
  const [automationId, setAutomationId] = useState<string>(lockedAutomationId ?? "");
  const [tagInclude, setTagInclude] = useState<string>(lockedTagId ?? "");
  const [tagExclude, setTagExclude] = useState<string>("");
  
  const [scheduleMode, setScheduleMode] = useState<"now" | "later">("now");
  const [scheduledAt, setScheduledAt] = useState<string>("");
  const [rate, setRate] = useState(60);

  const automationsQ = useQuery({
    queryKey: ["broadcast-automations", brandId],
    enabled: open && !!brandId,
    queryFn: async () => {
      const { data } = await supabase
        .from("automations")
        .select("id, name, status, graph, trigger_type")
        .eq("brand_id", brandId)
        .eq("trigger_type", "manual")
        .order("name");
      return data ?? [];
    },
  });

  const tagsQ = useQuery({
    queryKey: ["broadcast-tags", brandId],
    enabled: open && !!brandId,
    queryFn: async () => {
      const { data } = await supabase.from("tags").select("id, name").eq("brand_id", brandId).order("name");
      return data ?? [];
    },
  });

  const limitsQ = useQuery({
    queryKey: ["broadcast-global-limits"],
    enabled: open,
    queryFn: () => getGlobalLimitsSummary(),
  });

  const previewFn = useServerFn(previewBroadcastAudience);
  const previewQ = useQuery({
    queryKey: ["broadcast-preview", brandId, tagInclude || null, tagExclude || null],
    enabled: open && !!brandId && step >= 2,
    queryFn: () =>
      previewFn({
        data: {
          brandId,
          audience: {
            tagIdInclude: tagInclude || null,
            tagIdExclude: tagExclude || null,
          },
        },
      }),
  });

  const createFn = useServerFn(createBroadcast);
  const createMut = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          brandId,
          automationId,
          name,
          audience: {
            tagIdInclude: tagInclude || null,
            tagIdExclude: tagExclude || null,
          },
          scheduledAt: scheduleMode === "later" && scheduledAt ? new Date(scheduledAt).toISOString() : null,
          ratePerMinute: rate,
          skipNoWindow: false,
        },
      }),
    onSuccess: () => {
      toast.success("Broadcast criado!");
      qc.invalidateQueries({ queryKey: ["broadcasts-list"] });
      onOpenChange(false);
      reset();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao criar broadcast"),
  });

  function reset() {
    setStep(1);
    setName(defaultName ?? "");
    setAutomationId(lockedAutomationId ?? "");
    setTagInclude(lockedTagId ?? "");
    setTagExclude("");
    
    setScheduleMode("now");
    setScheduledAt("");
    setRate(60);
  }

  const totalAudience = previewQ.data?.count ?? 0;
  const etaMinutes = totalAudience > 0 ? Math.ceil(totalAudience / Math.max(1, rate)) : 0;
  const globalRpm = limitsQ.data?.rpm ?? 300;
  const overGlobal = rate > globalRpm;

  const canNext = useMemo(() => {
    if (step === 1) return name.trim().length > 0 && !!automationId;
    if (step === 2) return totalAudience > 0;
    if (step === 3) return scheduleMode === "now" || (!!scheduledAt);
    return true;
  }, [step, name, automationId, totalAudience, scheduleMode, scheduledAt]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5" />
            {title ?? "Novo broadcast"} — passo {step} de 4
          </DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome interno do broadcast</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Black Friday 25/11" />
            </div>
            <div className="space-y-2">
              <Label>Fluxo de automação</Label>
              {lockedAutomationId ? (
                <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                  <Badge variant="outline" className="text-[10px]">Manual</Badge>
                  <span className="truncate">{lockedAutomationName ?? (automationsQ.data ?? []).find((a: any) => a.id === lockedAutomationId)?.name ?? lockedAutomationId}</span>
                </div>
              ) : (
                <Select value={automationId} onValueChange={setAutomationId}>
                  <SelectTrigger><SelectValue placeholder="Selecione uma automação" /></SelectTrigger>
                  <SelectContent>
                    {(automationsQ.data ?? []).map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>
                        <span className="inline-flex items-center gap-2">
                          {a.trigger_type === "manual" && (
                            <Badge variant="outline" className="text-[10px]">Manual</Badge>
                          )}
                          {a.name}
                          <span className="text-muted-foreground text-xs">({(a.graph?.nodes?.length ?? 0)} nós)</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <p className="text-xs text-muted-foreground">A automação será disparada no contato como "manual_trigger". Use templates aprovados se houver chance da janela 24h estar fechada.</p>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Incluir contatos com a tag</Label>
                {lockedTagId ? (
                  <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                    <Badge variant="outline" className="text-[10px]">Travado</Badge>
                    <span className="truncate">{lockedTagName ?? (tagsQ.data ?? []).find((t: any) => t.id === lockedTagId)?.name ?? lockedTagId}</span>
                  </div>
                ) : (
                  <TagPickerCombobox
                    tags={(tagsQ.data ?? []) as any}
                    value={tagInclude}
                    onChange={setTagInclude}
                    placeholder="— Qualquer —"
                    clearLabel="— Qualquer —"
                  />
                )}
              </div>
              <div className="space-y-2">
                <Label>Excluir contatos com a tag</Label>
                <TagPickerCombobox
                  tags={(tagsQ.data ?? []) as any}
                  value={tagExclude}
                  onChange={setTagExclude}
                  placeholder="— Nenhuma —"
                  clearLabel="— Nenhuma —"
                />
              </div>
            </div>


            <div className="rounded-md border p-3 bg-muted/40">
              <div className="flex items-center gap-2 text-sm">
                <Users className="h-4 w-4" />
                {previewQ.isLoading ? (
                  <span className="text-muted-foreground">Calculando…</span>
                ) : (
                  <>
                    <strong>{totalAudience}</strong> contato(s) selecionado(s)
                  </>
                )}
              </div>
              {previewQ.data && previewQ.data.sample.length > 0 && (
                <div className="mt-2 text-xs text-muted-foreground">
                  Amostra: {previewQ.data.sample.slice(0, 5).map((c: any) => c.name || c.profile_name || c.phone || c.wa_id).filter(Boolean).join(", ")}
                  {previewQ.data.sample.length > 5 && "…"}
                </div>
              )}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <RadioGroup value={scheduleMode} onValueChange={(v) => setScheduleMode(v as any)}>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="now" id="now" />
                <Label htmlFor="now">Enviar agora</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="later" id="later" />
                <Label htmlFor="later">Agendar para</Label>
              </div>
            </RadioGroup>
            {scheduleMode === "later" && (
              <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
            )}

          </div>
        )}


        {step === 4 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-2"><Gauge className="h-4 w-4" /> Velocidade ({rate} msgs/min)</Label>
              <Slider value={[rate]} onValueChange={([v]) => setRate(v)} min={10} max={Math.max(globalRpm, 1200)} step={10} />
              <div className="flex flex-wrap gap-2 mt-2">
                {TIERS.map((t) => (
                  <Button key={t.id} type="button" variant={rate === t.rpm ? "default" : "outline"} size="sm" onClick={() => setRate(t.rpm)}>
                    {t.label} ({t.rpm}/min)
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Teto global atual: <strong>{globalRpm}</strong> msgs/min ({limitsQ.data?.tier ?? "—"}).</p>
              {overGlobal && (
                <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                  <AlertTriangle className="h-4 w-4 mt-0.5" />
                  <span>Velocidade acima do teto global. Reduza ou ajuste o tier em <a href="/admin/filas" className="underline">Filas & Limites</a>.</span>
                </div>
              )}
            </div>



            <div className="rounded-md border p-3 bg-muted/40 text-sm space-y-1">
              <div><strong>Resumo:</strong></div>
              <div>• Fluxo: {(automationsQ.data ?? []).find((a: any) => a.id === automationId)?.name}</div>
              <div>• Público: {totalAudience} contato(s)</div>
              <div>• Início: {scheduleMode === "now" ? "agora" : new Date(scheduledAt).toLocaleString()}</div>
              <div>• Velocidade: {rate} msgs/min — <Clock className="inline h-3 w-3" /> ≈ {etaMinutes} min</div>
              {overGlobal && <Badge variant="destructive">Acima do teto global</Badge>}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {step > 1 && (
            <Button type="button" variant="outline" onClick={() => setStep(step - 1)}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Voltar
            </Button>
          )}
          {step < 4 ? (
            <Button type="button" onClick={() => setStep(step + 1)} disabled={!canNext}>
              Próximo <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button type="button" onClick={() => createMut.mutate()} disabled={createMut.isPending || overGlobal}>
              {createMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {scheduleMode === "now" ? "Iniciar envio" : "Agendar"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
