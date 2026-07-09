import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getAgentVoiceConfig, upsertAgentVoiceConfig } from "@/lib/ellie-config.functions";

type V = {
  voice_id: string | null;
  model_id: string;
  stability: number;
  similarity_boost: number;
  style: number;
  speed: number;
  send_mode: "text" | "audio" | "text_and_audio" | "llm_decides";
};

const DEFAULTS: V = {
  voice_id: null,
  model_id: "eleven_multilingual_v2",
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0,
  speed: 1.0,
  send_mode: "text",
};

const SEND_MODE_LABEL: Record<string, string> = {
  text: "Só texto",
  audio: "Só áudio",
  text_and_audio: "Texto + áudio (em sequência)",
  llm_decides: "LLM decide por mensagem",
};

export function EllieVoiceTab({ agentId }: { agentId: string }) {
  const getFn = useServerFn(getAgentVoiceConfig);
  const saveFn = useServerFn(upsertAgentVoiceConfig);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["ellie-voice", agentId],
    queryFn: () => getFn({ data: { agentId } }),
  });
  const [v, setV] = useState<V>(DEFAULTS);
  useEffect(() => {
    if (data?.voice) setV({ ...DEFAULTS, ...(data.voice as any) });
  }, [data]);

  if (isLoading) return <div className="p-6 flex justify-center"><Loader2 className="animate-spin" /></div>;

  const save = async () => {
    try {
      await saveFn({ data: { agentId, ...v } });
      toast.success("Configuração de voz salva");
      refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao salvar");
    }
  };

  return (
    <Card className="p-4 space-y-4 max-w-2xl">
      <div>
        <h3 className="font-semibold">Voz (ElevenLabs)</h3>
        <p className="text-xs text-muted-foreground">
          Define a voz, modo de envio e parâmetros de síntese. Usado quando o agente envia áudio
          (TTS) na resposta.
        </p>
      </div>

      <div>
        <Label>Modo de envio</Label>
        <Select value={v.send_mode} onValueChange={(x) => setV({ ...v, send_mode: x as any })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(SEND_MODE_LABEL).map(([k, l]) => (
              <SelectItem key={k} value={k}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1">
          "Texto + áudio" envia primeiro a mensagem de texto e em seguida o áudio (igual ao Uchat).
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label>Voice ID (ElevenLabs)</Label>
          <Input
            value={v.voice_id ?? ""}
            onChange={(e) => setV({ ...v, voice_id: e.target.value || null })}
            placeholder="ex: EXAVITQu4vr4xnSDxMaL"
          />
        </div>
        <div>
          <Label>Modelo</Label>
          <Input
            value={v.model_id}
            onChange={(e) => setV({ ...v, model_id: e.target.value })}
          />
        </div>
      </div>

      {([
        ["Estabilidade", "stability", 0, 1, 0.05],
        ["Similaridade", "similarity_boost", 0, 1, 0.05],
        ["Estilo", "style", 0, 1, 0.05],
        ["Velocidade", "speed", 0.7, 1.2, 0.05],
      ] as const).map(([label, key, min, max, step]) => (
        <div key={key}>
          <div className="flex justify-between">
            <Label>{label}</Label>
            <span className="text-xs text-muted-foreground">{(v as any)[key].toFixed(2)}</span>
          </div>
          <Slider
            min={min}
            max={max}
            step={step}
            value={[(v as any)[key]]}
            onValueChange={([val]) => setV({ ...v, [key]: val } as V)}
          />
        </div>
      ))}

      <div className="flex justify-end">
        <Button onClick={save}>Salvar</Button>
      </div>
    </Card>
  );
}
