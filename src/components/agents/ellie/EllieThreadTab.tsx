import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { updateEllieAgentExtras } from "@/lib/ellie-config.functions";

const MODE_OPTS = [
  { v: "ignore", l: "Ignorar" },
  { v: "transcribe", l: "Transcrever e continuar" },
  { v: "respond", l: "Responder diretamente" },
];

export function EllieThreadTab({
  agentId,
  agent,
  onSaved,
}: {
  agentId: string;
  agent: any;
  onSaved: () => void;
}) {
  const saveFn = useServerFn(updateEllieAgentExtras);
  const [group, setGroup] = useState<number>(agent.group_inputs_seconds ?? 0);
  const [followup, setFollowup] = useState<string>(
    agent.followup_minutes != null ? String(agent.followup_minutes) : "",
  );
  const [defaultMsg, setDefaultMsg] = useState<string>(agent.default_user_message ?? "");
  const [imageMode, setImageMode] = useState<string>(agent.image_mode ?? "ignore");
  const [audioMode, setAudioMode] = useState<string>(agent.audio_mode ?? "ignore");
  const [processImages, setProcessImages] = useState<boolean>(!!agent.process_inbound_images);
  const [ctxWindow, setCtxWindow] = useState<string>(
    agent.ellie_context_window != null ? String(agent.ellie_context_window) : "",
  );

  const save = async () => {
    try {
      await saveFn({
        data: {
          agentId,
          group_inputs_seconds: Number(group) || 0,
          followup_minutes: followup ? Number(followup) : null,
          default_user_message: defaultMsg || null,
          image_mode: imageMode as any,
          audio_mode: audioMode as any,
          process_inbound_images: processImages,
          ellie_context_window: ctxWindow ? Number(ctxWindow) : null,
        },
      });
      toast.success("Configurações da thread salvas");
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao salvar");
    }
  };

  return (
    <Card className="p-4 space-y-4 max-w-2xl">
      <div>
        <h3 className="font-semibold">Thread & Contexto</h3>
        <p className="text-xs text-muted-foreground">
          Controla como a Ellie agrupa mensagens, faz follow-up e processa mídia. Uma thread por
          contato mantém todo o histórico de conversa.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label>Agrupar inputs por (segundos)</Label>
          <Input
            type="number"
            min={0}
            max={600}
            value={group}
            onChange={(e) => setGroup(Number(e.target.value))}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Aguarda X segundos antes de processar, juntando mensagens rápidas.
          </p>
        </div>
        <div>
          <Label>Follow-up automático (minutos)</Label>
          <Input
            type="number"
            min={0}
            value={followup}
            onChange={(e) => setFollowup(e.target.value)}
            placeholder="vazio = desligado"
          />
        </div>
      </div>

      <div>
        <Label>Janela de contexto (mensagens) — Ellie</Label>
        <Input
          type="number"
          min={1}
          max={500}
          value={ctxWindow}
          onChange={(e) => setCtxWindow(e.target.value)}
          placeholder="ex: 50 (default 50 quando vazio)"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Quantas mensagens da thread o LLM recebe a cada chamada.
        </p>
      </div>

      <div className="flex items-start justify-between rounded-md border p-3">
        <div className="space-y-0.5 pr-4">
          <Label className="text-sm">Processar imagens recebidas (visão)</Label>
          <p className="text-xs text-muted-foreground">
            Quando ligado, a Ellie interpreta fotos e stickers enviados pelo paciente
            (descreve, lê texto na imagem) e responde no mesmo fluxo de texto + áudio + botões.
            Desligado, imagens são ignoradas.
          </p>
        </div>
        <Switch checked={processImages} onCheckedChange={setProcessImages} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label>Modo imagem (legado)</Label>
          <Select value={imageMode} onValueChange={setImageMode}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {MODE_OPTS.map((o) => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Modo áudio</Label>
          <Select value={audioMode} onValueChange={setAudioMode}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {MODE_OPTS.map((o) => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label>Mensagem padrão (quando input vazio)</Label>
        <Textarea
          rows={2}
          value={defaultMsg}
          onChange={(e) => setDefaultMsg(e.target.value)}
          placeholder="ex: Continue por favor"
        />
      </div>

      <div className="flex justify-end">
        <Button onClick={save}>Salvar</Button>
      </div>
    </Card>
  );
}
