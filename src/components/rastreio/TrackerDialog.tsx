import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { upsertTracker, listTrackerOptions } from "@/lib/sales-trackers.functions";
import { toast } from "sonner";

type CodeRow = {
  id?: string;
  kind: "sck" | "utm";
  sck?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  platform_hint?: "hotmart" | "shopify" | null;
  active: boolean;
};

type TrackerInput = {
  id: string;
  name: string;
  kind: "seller" | "automation";
  user_id: string | null;
  automation_id: string | null;
  active: boolean;
  notes: string | null;
  user_name: string | null;
  automation_name: string | null;
  codes: Array<{
    id: string; kind: "sck" | "utm";
    sck: string | null; utm_source: string | null; utm_medium: string | null;
    utm_campaign: string | null; utm_content: string | null; utm_term: string | null;
    platform_hint: string | null; active: boolean;
  }>;
};

export function TrackerDialog({
  open, onOpenChange, tracker, brandId, onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tracker: TrackerInput | null;
  brandId: string;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"seller" | "automation">("seller");
  const [userId, setUserId] = useState<string | null>(null);
  const [automationId, setAutomationId] = useState<string | null>(null);
  const [active, setActive] = useState(true);
  const [notes, setNotes] = useState("");
  const [codes, setCodes] = useState<CodeRow[]>([]);
  const [saving, setSaving] = useState(false);

  const optionsFn = useServerFn(listTrackerOptions);
  const upsertFn = useServerFn(upsertTracker);

  const { data: options } = useQuery({
    queryKey: ["tracker-options", brandId],
    enabled: open,
    queryFn: () => optionsFn({ data: { brandId } }),
  });

  useEffect(() => {
    if (!open) return;
    if (tracker) {
      setName(tracker.name);
      setKind(tracker.kind);
      setUserId(tracker.user_id);
      setAutomationId(tracker.automation_id);
      setActive(tracker.active);
      setNotes(tracker.notes ?? "");
      setCodes(tracker.codes.map((c) => ({
        id: c.id, kind: c.kind,
        sck: c.sck, utm_source: c.utm_source, utm_medium: c.utm_medium,
        utm_campaign: c.utm_campaign, utm_content: c.utm_content, utm_term: c.utm_term,
        platform_hint: (c.platform_hint as "hotmart" | "shopify" | null) ?? null,
        active: c.active,
      })));
    } else {
      setName(""); setKind("seller"); setUserId(null); setAutomationId(null);
      setActive(true); setNotes(""); setCodes([]);
    }
  }, [open, tracker]);

  function addCode(kind: "sck" | "utm") {
    setCodes((c) => [...c, { kind, active: true, platform_hint: kind === "sck" ? "hotmart" : "shopify" }]);
  }

  function updateCode(idx: number, patch: Partial<CodeRow>) {
    setCodes((c) => c.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  }

  function removeCode(idx: number) {
    setCodes((c) => c.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    if (!name.trim()) { toast.error("Informe um nome"); return; }
    // Validate codes
    for (const c of codes) {
      if (c.kind === "sck" && !c.sck?.trim()) { toast.error("SCK vazio"); return; }
      if (c.kind === "utm" && ![c.utm_source, c.utm_medium, c.utm_campaign, c.utm_content, c.utm_term].some((v) => v?.trim())) {
        toast.error("Preencha ao menos um campo de UTM"); return;
      }
    }
    setSaving(true);
    try {
      await upsertFn({
        data: {
          id: tracker?.id,
          brandId,
          name: name.trim(),
          kind,
          user_id: kind === "seller" ? userId : null,
          automation_id: kind === "automation" ? automationId : null,
          active,
          notes: notes.trim() || null,
          codes: codes.map((c) => ({
            id: c.id,
            kind: c.kind,
            sck: c.sck ?? null,
            utm_source: c.utm_source ?? null,
            utm_medium: c.utm_medium ?? null,
            utm_campaign: c.utm_campaign ?? null,
            utm_content: c.utm_content ?? null,
            utm_term: c.utm_term ?? null,
            platform_hint: c.platform_hint ?? null,
            active: c.active,
          })),
        },
      });
      toast.success("Salvo");
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{tracker ? "Editar item de rastreio" : "Novo item de rastreio"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <Tabs value={kind} onValueChange={(v) => setKind(v as "seller" | "automation")}>
            <TabsList className="grid grid-cols-2">
              <TabsTrigger value="seller">Vendedor</TabsTrigger>
              <TabsTrigger value="automation">Automação</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Maria — equipe SP" />
            </div>
            {kind === "seller" ? (
              <div className="space-y-1.5">
                <Label>Vincular a usuário (opcional)</Label>
                <Select value={userId ?? "_none"} onValueChange={(v) => setUserId(v === "_none" ? null : v)}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">Sem vínculo</SelectItem>
                    {(options?.users ?? []).map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>Automação</Label>
                <Select value={automationId ?? "_none"} onValueChange={(v) => setAutomationId(v === "_none" ? null : v)}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">Sem vínculo</SelectItem>
                    {(options?.automations ?? []).map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Observações</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>

          <div className="flex items-center gap-2">
            <Switch checked={active} onCheckedChange={setActive} id="active" />
            <Label htmlFor="active">Ativo (códigos inativos não atribuem vendas)</Label>
          </div>

          <div className="border-t pt-3">
            <div className="flex items-center justify-between mb-2">
              <Label>Códigos</Label>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => addCode("sck")}>
                  <Plus className="h-3 w-3 mr-1" /> SCK
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => addCode("utm")}>
                  <Plus className="h-3 w-3 mr-1" /> UTM
                </Button>
              </div>
            </div>
            {codes.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">Adicione ao menos um código para que vendas sejam atribuídas.</p>
            ) : (
              <div className="space-y-2">
                {codes.map((c, idx) => (
                  <div key={idx} className="border rounded-md p-3 space-y-2 bg-muted/20">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase">{c.kind === "sck" ? "SCK (Hotmart)" : "UTM (Shopify/genérico)"}</span>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1">
                          <Switch checked={c.active} onCheckedChange={(v) => updateCode(idx, { active: v })} />
                          <span className="text-[11px] text-muted-foreground">ativo</span>
                        </div>
                        <Button type="button" size="icon" variant="ghost" onClick={() => removeCode(idx)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    {c.kind === "sck" ? (
                      <Input
                        placeholder="ex.: maria-sp01"
                        value={c.sck ?? ""}
                        onChange={(e) => updateCode(idx, { sck: e.target.value })}
                      />
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <Input placeholder="utm_source" value={c.utm_source ?? ""} onChange={(e) => updateCode(idx, { utm_source: e.target.value })} />
                        <Input placeholder="utm_medium" value={c.utm_medium ?? ""} onChange={(e) => updateCode(idx, { utm_medium: e.target.value })} />
                        <Input placeholder="utm_campaign" value={c.utm_campaign ?? ""} onChange={(e) => updateCode(idx, { utm_campaign: e.target.value })} />
                        <Input placeholder="utm_content" value={c.utm_content ?? ""} onChange={(e) => updateCode(idx, { utm_content: e.target.value })} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
