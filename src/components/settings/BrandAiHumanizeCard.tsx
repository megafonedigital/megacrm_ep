import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  getBrandAiHumanize, updateBrandAiHumanize,
} from "@/lib/brand-ai-humanize.functions";
import {
  computeDelay, DEFAULT_HUMANIZE, normalizeHumanizeConfig, splitReply,
  type HumanizeConfig,
} from "@/lib/ai-humanize";

const SAMPLE_REPLY =
  "Oi! Tudo bem? 😊\n\nVi que você tem interesse no curso. Posso te explicar como funciona em poucos passos.\n\nPrimeiro: você assiste às aulas no seu ritmo. Depois: tem suporte da equipe sempre que precisar. Por fim: ganha certificado ao concluir.\n\nQuer que eu te mande o link com mais detalhes?";

export function BrandAiHumanizeCard({ brandId }: { brandId: string }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getBrandAiHumanize);
  const updateFn = useServerFn(updateBrandAiHumanize);

  const q = useQuery({
    queryKey: ["brand-ai-humanize", brandId],
    queryFn: () => getFn({ data: { brandId } }),
  });

  const [cfg, setCfg] = useState<HumanizeConfig>(DEFAULT_HUMANIZE);

  useEffect(() => {
    if (q.data?.config) setCfg(q.data.config);
  }, [q.data]);

  const m = useMutation({
    mutationFn: (next: HumanizeConfig) => updateFn({ data: { brandId, config: next } }),
    onSuccess: () => {
      toast.success("Configuração salva.");
      qc.invalidateQueries({ queryKey: ["brand-ai-humanize", brandId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao salvar."),
  });

  const preview = useMemo(() => {
    const parts = splitReply(SAMPLE_REPLY, normalizeHumanizeConfig(cfg));
    return parts.map((p, i) => ({ text: p, delay: computeDelay(p, i, cfg) }));
  }, [cfg]);

  const set = <K extends keyof HumanizeConfig>(k: K, v: HumanizeConfig[K]) =>
    setCfg((c) => ({ ...c, [k]: v }));

  if (q.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Humanização das mensagens da IA</CardTitle>
          <CardDescription>
            Quebra a resposta da IA em várias mensagens menores e aplica um atraso entre elas,
            simulando como uma pessoa digitaria. Vale apenas para os agentes de IA deste workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between gap-4 rounded-md border p-3">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Ativar humanização</Label>
              <p className="text-xs text-muted-foreground">
                Quando desligado, a IA envia a resposta inteira numa única mensagem (comportamento atual).
              </p>
            </div>
            <Switch checked={cfg.enabled} onCheckedChange={(v) => set("enabled", v)} />
          </div>

          <div className={cfg.enabled ? "space-y-6" : "space-y-6 opacity-60 pointer-events-none"}>
            <div className="grid gap-2">
              <Label>Critério de quebra</Label>
              <Select value={cfg.split_mode} onValueChange={(v) => set("split_mode", v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="paragraph">Por parágrafo (linha em branco)</SelectItem>
                  <SelectItem value="sentence">Por frase (. ! ?)</SelectItem>
                  <SelectItem value="limit">Por limite de caracteres</SelectItem>
                  <SelectItem value="paragraph_then_limit">Misto: parágrafo + limite</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label>Tamanho máximo por mensagem</Label>
                <span className="text-sm tabular-nums text-muted-foreground">{cfg.max_chars} caracteres</span>
              </div>
              <Slider
                min={80} max={400} step={20}
                value={[cfg.max_chars]}
                onValueChange={([v]) => set("max_chars", v)}
              />
              <p className="text-xs text-muted-foreground">
                Aplica nos modos "Por limite" e "Misto".
              </p>
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label>Máximo de partes por resposta</Label>
                <span className="text-sm tabular-nums text-muted-foreground">{cfg.max_parts}</span>
              </div>
              <Slider
                min={2} max={8} step={1}
                value={[cfg.max_parts]}
                onValueChange={([v]) => set("max_parts", v)}
              />
              <p className="text-xs text-muted-foreground">
                Se a resposta gerar mais partes que isso, o restante é juntado na última mensagem.
              </p>
            </div>

            <div className="grid gap-2">
              <Label>Modo de delay entre mensagens</Label>
              <Select value={cfg.delay_mode} onValueChange={(v) => set("delay_mode", v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">Fixo configurável</SelectItem>
                  <SelectItem value="proportional">Proporcional ao tamanho</SelectItem>
                  <SelectItem value="random">Aleatório dentro de faixa</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {cfg.delay_mode === "fixed" && (
              <div className="grid gap-2 max-w-xs">
                <Label>Atraso fixo (ms)</Label>
                <Input
                  type="number" min={0} max={15000} step={100}
                  value={cfg.delay_fixed_ms}
                  onChange={(e) => set("delay_fixed_ms", Number(e.target.value) || 0)}
                />
              </div>
            )}

            {cfg.delay_mode === "proportional" && (
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="grid gap-2">
                  <Label>Caracteres por segundo</Label>
                  <Input
                    type="number" min={5} max={500} step={5}
                    value={cfg.delay_chars_per_sec}
                    onChange={(e) => set("delay_chars_per_sec", Number(e.target.value) || 0)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Mínimo (ms)</Label>
                  <Input
                    type="number" min={0} max={15000} step={100}
                    value={cfg.delay_min_ms}
                    onChange={(e) => set("delay_min_ms", Number(e.target.value) || 0)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Máximo (ms)</Label>
                  <Input
                    type="number" min={0} max={20000} step={100}
                    value={cfg.delay_max_ms}
                    onChange={(e) => set("delay_max_ms", Number(e.target.value) || 0)}
                  />
                </div>
              </div>
            )}

            {cfg.delay_mode === "random" && (
              <div className="grid gap-3 sm:grid-cols-2 max-w-md">
                <div className="grid gap-2">
                  <Label>Mínimo (ms)</Label>
                  <Input
                    type="number" min={0} max={15000} step={100}
                    value={cfg.delay_min_ms}
                    onChange={(e) => set("delay_min_ms", Number(e.target.value) || 0)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Máximo (ms)</Label>
                  <Input
                    type="number" min={0} max={20000} step={100}
                    value={cfg.delay_max_ms}
                    onChange={(e) => set("delay_max_ms", Number(e.target.value) || 0)}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <Button
              onClick={() => m.mutate(normalizeHumanizeConfig(cfg))}
              disabled={m.isPending}
            >
              {m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar configurações"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pré-visualização</CardTitle>
          <CardDescription>
            Mostra como uma resposta de exemplo seria entregue com os ajustes atuais
            (sem precisar salvar).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {preview.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem partes.</p>
          ) : (
            preview.map((p, i) => (
              <div key={i} className="space-y-1">
                {p.delay > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    ⏱ aguarda {Math.round(p.delay)} ms
                  </p>
                )}
                <div className="rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap">
                  {p.text}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
