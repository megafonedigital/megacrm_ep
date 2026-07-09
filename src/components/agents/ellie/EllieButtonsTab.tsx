import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { updateEllieAgentExtras } from "@/lib/ellie-config.functions";

type QR = { label: string; payload: string };

export function EllieButtonsTab({
  agentId,
  initialQuickReplies,
  initialDynamic,
  initialHelpMeEnabled,
  initialHelpMeSlowSpeed,
  onSaved,
}: {
  agentId: string;
  initialQuickReplies: QR[];
  initialDynamic: boolean;
  initialHelpMeEnabled?: boolean;
  initialHelpMeSlowSpeed?: number;
  onSaved: () => void;
}) {
  const saveFn = useServerFn(updateEllieAgentExtras);
  const [items, setItems] = useState<QR[]>(initialQuickReplies?.slice(0, 3) ?? []);
  const [dynamic, setDynamic] = useState(initialDynamic);
  const [helpMeEnabled, setHelpMeEnabled] = useState(!!initialHelpMeEnabled);
  const [slowSpeed, setSlowSpeed] = useState<number>(
    typeof initialHelpMeSlowSpeed === "number" ? initialHelpMeSlowSpeed : 0.75,
  );

  const save = async () => {
    try {
      const clean = items
        .filter((i) => i.label.trim() && i.payload.trim())
        .map((i) => ({ label: i.label.slice(0, 20), payload: i.payload.slice(0, 80) }));
      await saveFn({
        data: {
          agentId,
          quick_replies: clean,
          dynamic_quick_replies: dynamic,
          help_me_enabled: helpMeEnabled,
          help_me_slow_speed: Math.max(0.7, Math.min(1, slowSpeed)),
        },
      });
      toast.success("Botões salvos");
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao salvar");
    }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <Card className="p-4 space-y-4">
        <div>
          <h3 className="font-semibold">Botões (Quick Replies)</h3>
          <p className="text-xs text-muted-foreground">
            Até 3 botões fixos enviados em toda mensagem. Use texto curto (máx. 20 chars).
          </p>
        </div>

        <div className="space-y-2">
          {items.map((it, idx) => (
            <div key={idx} className="flex gap-2">
              <Input
                placeholder="Texto do botão"
                maxLength={20}
                value={it.label}
                onChange={(e) => {
                  const c = [...items];
                  c[idx] = { ...c[idx], label: e.target.value };
                  setItems(c);
                }}
              />
              <Input
                placeholder="Payload (envio interno)"
                maxLength={80}
                value={it.payload}
                onChange={(e) => {
                  const c = [...items];
                  c[idx] = { ...c[idx], payload: e.target.value };
                  setItems(c);
                }}
              />
              <Button size="icon" variant="ghost" onClick={() => setItems(items.filter((_, i) => i !== idx))}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
          {items.length < 3 && (
            <Button size="sm" variant="outline" onClick={() => setItems([...items, { label: "", payload: "" }])}>
              <Plus className="h-4 w-4 mr-1" /> Adicionar botão
            </Button>
          )}
        </div>

        <label className="flex items-center gap-3 pt-2 border-t">
          <Switch checked={dynamic} onCheckedChange={setDynamic} />
          <div>
            <div className="text-sm font-medium">Sugerir botões dinâmicos via LLM</div>
            <div className="text-xs text-muted-foreground">
              O LLM gera botões contextuais (<code>{"{{ai_agent.quick_replies}}"}</code>) além dos fixos.
            </div>
          </div>
        </label>
      </Card>

      <Card className="p-4 space-y-4">
        <div>
          <h3 className="font-semibold">Menu "Help me!"</h3>
          <p className="text-xs text-muted-foreground">
            Anexa um menu interativo (WhatsApp List) em toda mensagem do agente com 3 opções:
            <br />
            <b>Translate 🇺🇸👉🇧🇷</b> traduz o último texto para PT-BR ·
            {" "}<b>Simplify 🤩</b> reescreve em inglês simples ·
            {" "}<b>Slowly 🐢</b> reenvia o áudio mais devagar.
          </p>
        </div>

        <label className="flex items-center gap-3">
          <Switch checked={helpMeEnabled} onCheckedChange={setHelpMeEnabled} />
          <div className="text-sm font-medium">Ativar menu "Help me!"</div>
        </label>

        <div className={helpMeEnabled ? "space-y-2" : "space-y-2 opacity-50 pointer-events-none"}>
          <div className="flex justify-between text-sm">
            <span>Velocidade do áudio "Slowly"</span>
            <span className="font-mono">{slowSpeed.toFixed(2)}x</span>
          </div>
          <Slider
            min={0.7}
            max={1}
            step={0.05}
            value={[slowSpeed]}
            onValueChange={(v) => setSlowSpeed(v[0] ?? 0.75)}
          />
          <p className="text-xs text-muted-foreground">
            Velocidade enviada ao ElevenLabs ao clicar em Slowly (0.70x–1.00x). Default 0.75.
          </p>
        </div>
      </Card>

      <div className="flex justify-end max-w-2xl">
        <Button onClick={save}>Salvar</Button>
      </div>
    </div>
  );
}
