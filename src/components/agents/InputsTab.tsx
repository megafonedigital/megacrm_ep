import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus, Save, Trash2, Lock, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateAgent } from "@/lib/ai-agents.functions";
import { FieldPathCombobox } from "./FieldPathCombobox";

export type AgentInputDef = {
  key: string;
  label?: string;
  source: "contact" | "brand" | "conversation" | "static" | "hotmart" | "shopify" | "activecampaign" | "sendflow";
  path?: string;
  fallback?: string;
};

const DEFAULTS: Array<{ key: string; label: string; description: string }> = [
  { key: "contact.name", label: "Nome do contato", description: "Auto: contacts.name" },
  { key: "contact.phone", label: "Telefone", description: "Auto: contacts.phone" },
  { key: "contact.wa_id", label: "WhatsApp ID", description: "Auto: contacts.wa_id" },
  { key: "brand.name", label: "Workspace", description: "Auto: brands.name" },
  { key: "brand.slug", label: "Slug", description: "Auto: brands.slug" },
  { key: "agent.name", label: "Nome do agente", description: "Auto: nome configurado do agente" },
  { key: "company.name", label: "Nome da empresa", description: "Auto: base de conhecimento (Empresa) vinculada" },
  { key: "expert.name", label: "Nome do expert", description: "Auto: base de conhecimento (Empresa) vinculada" },
  { key: "now", label: "Data/hora atual", description: "Auto: agora (America/Sao_Paulo)" },
  { key: "last_messages", label: "Últimas mensagens", description: "Auto: histórico recente da conversa" },
];

export function InputsTab({
  agentId,
  brandId,
  initial,
  onSaved,
}: {
  agentId: string;
  brandId: string;
  initial: AgentInputDef[];
  onSaved?: () => void;
}) {
  const updateFn = useServerFn(updateAgent);
  const [items, setItems] = useState<AgentInputDef[]>(initial ?? []);
  const [saving, setSaving] = useState(false);

  const addRow = () => {
    setItems((prev) => [
      ...prev,
      { key: "", label: "", source: "static", path: "", fallback: "" },
    ]);
  };

  const updateRow = (i: number, patch: Partial<AgentInputDef>) => {
    setItems((prev) => prev.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  };

  const removeRow = (i: number) => {
    setItems((prev) => prev.filter((_, j) => j !== i));
  };

  const save = async () => {
    // valida chaves
    for (const it of items) {
      if (!it.key.trim()) return toast.error("Existe variável sem chave.");
      if (!/^[a-zA-Z0-9_.]+$/.test(it.key)) return toast.error(`Chave inválida: ${it.key}`);
    }
    const seen = new Set<string>();
    for (const it of items) {
      if (seen.has(it.key)) return toast.error(`Chave duplicada: ${it.key}`);
      seen.add(it.key);
    }
    setSaving(true);
    try {
      await updateFn({ data: { agentId, patch: { inputs: items } } });
      toast.success("Variáveis salvas");
      onSaved?.();
    } catch (e) {
      toast.error((e as Error)?.message ?? "Erro");
    } finally {
      setSaving(false);
    }
  };

  const copyKey = (k: string) => {
    navigator.clipboard.writeText(`{{${k}}}`);
    toast.success(`Copiado {{${k}}}`);
  };

  return (
    <div className="space-y-4">
      <Card className="p-3 bg-muted/40 border-dashed">
        <p className="text-xs text-muted-foreground">
          Todas as variáveis definidas (padrão e personalizadas) são <strong>automaticamente enviadas ao agente em cada execução</strong>, mesmo quando não aparecem no system prompt. Use <code className="text-[11px]">{`{{chave}}`}</code> apenas se quiser posicionar o valor em um trecho específico do prompt.
        </p>
      </Card>

      <Card className="p-4 space-y-3">
        <div>
          <h3 className="font-semibold">Variáveis padrão</h3>
          <p className="text-xs text-muted-foreground">
            Sempre disponíveis. Use no system prompt como <code className="text-xs">{`{{chave}}`}</code>.
          </p>
        </div>
        <div className="grid gap-2">
          {DEFAULTS.map((d) => (
            <div key={d.key} className="flex items-center gap-3 border rounded p-2">
              <Lock className="h-4 w-4 text-muted-foreground" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{`{{${d.key}}}`}</code>
                  <Badge variant="secondary" className="text-[10px]">padrão</Badge>
                </div>
                <div className="text-xs text-muted-foreground">{d.label} — {d.description}</div>
              </div>
              <Button size="icon" variant="ghost" onClick={() => copyKey(d.key)}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold">Variáveis personalizadas</h3>
            <p className="text-xs text-muted-foreground">
              Adicione variáveis adicionais resolvidas no momento da execução.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={addRow}>
            <Plus className="h-4 w-4 mr-1" /> Adicionar variável
          </Button>
        </div>

        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Nenhuma variável personalizada.
          </p>
        ) : (
          <div className="space-y-3">
            {items.map((it, i) => (
              <div key={i} className="border rounded p-3 grid grid-cols-12 gap-2">
                <div className="col-span-3 space-y-1">
                  <Label className="text-xs">Chave</Label>
                  <Input
                    placeholder="ex: contact.email"
                    value={it.key}
                    onChange={(e) => updateRow(i, { key: e.target.value.trim() })}
                  />
                </div>
                <div className="col-span-3 space-y-1">
                  <Label className="text-xs">Rótulo</Label>
                  <Input
                    placeholder="opcional"
                    value={it.label ?? ""}
                    onChange={(e) => updateRow(i, { label: e.target.value })}
                  />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Fonte</Label>
                  <Select
                    value={it.source}
                    onValueChange={(v) => updateRow(i, { source: v as AgentInputDef["source"] })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="contact">Contato</SelectItem>
                      <SelectItem value="brand">Workspace</SelectItem>
                      <SelectItem value="conversation">Conversa</SelectItem>
                      <SelectItem value="hotmart">Hotmart</SelectItem>
                      <SelectItem value="shopify">Shopify</SelectItem>
                      <SelectItem value="activecampaign">ActiveCampaign</SelectItem>
                      <SelectItem value="sendflow">SendFlow</SelectItem>
                      <SelectItem value="static">Texto fixo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">
                    {it.source === "contact" ? "Campo do contato"
                      : it.source === "brand" ? "Campo do workspace"
                      : it.source === "conversation" ? "Campo"
                      : it.source === "static" ? "—"
                      : "Campo do payload"}
                  </Label>
                  <FieldPathCombobox
                    source={it.source}
                    brandId={brandId}
                    value={it.path ?? ""}
                    onChange={(v) => updateRow(i, { path: v })}
                  />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Fallback</Label>
                  <Input
                    placeholder="se vazio"
                    value={it.fallback ?? ""}
                    onChange={(e) => updateRow(i, { fallback: e.target.value })}
                  />
                </div>
                <div className="col-span-12 flex items-center justify-between">
                  <code className="text-xs text-muted-foreground">
                    {it.key ? `{{${it.key}}}` : "(defina a chave)"}
                  </code>
                  <div className="flex gap-2">
                    {it.key && (
                      <Button size="sm" variant="ghost" onClick={() => copyKey(it.key)}>
                        <Copy className="h-3.5 w-3.5 mr-1" /> Copiar
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => removeRow(i)}>
                      <Trash2 className="h-3.5 w-3.5 mr-1 text-destructive" /> Remover
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end pt-2">
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Salvar variáveis
          </Button>
        </div>
      </Card>
    </div>
  );
}
