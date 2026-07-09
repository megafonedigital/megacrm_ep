import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Area, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { Loader2 } from "lucide-react";
import { getBroadcastSpeedSeries } from "@/lib/broadcasts.functions";

interface Props {
  broadcastId: string;
  refetchIntervalMs?: number;
  minutes?: number;
  isTerminal?: boolean;
}

export function BroadcastSpeedChart({ broadcastId, refetchIntervalMs = 60_000, minutes = 60, isTerminal = false }: Props) {
  const fn = useServerFn(getBroadcastSpeedSeries);
  const q = useQuery({
    queryKey: ["broadcast-speed-series", broadcastId, minutes, isTerminal],
    queryFn: () => fn({ data: { broadcastId, minutes } }),
    refetchInterval: isTerminal ? false : refetchIntervalMs,
    staleTime: isTerminal ? Infinity : 5_000,
  });

  const { data, maxY, target } = useMemo(() => {
    const raw = (q.data?.points ?? []).map((p) => ({
      minute: p.minute,
      label: new Date(p.minute).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      dispatched: p.dispatched,
      failed: p.failed,
      // Métrica principal: enviadas + falhas. Falha de Meta consumiu o slot do
      // motor, então conta como "velocidade real" para fins de leitura.
      effective: p.dispatched + p.failed,
      isPartial: p.isPartial,
    }));
    // Pontos plenos vs parciais. Renderizamos duas Areas: a cheia ignora os
    // pontos parciais (deixa null), a tracejada só os preenche, conectando
    // com o último ponto pleno para não criar um "buraco" visual.
    const fullPoints = raw.map((p, i) => ({
      ...p,
      effectiveFull: p.isPartial ? null : p.effective,
      // mantém o último ponto pleno renderizado também no array parcial para
      // a linha tracejada começar dele e não "pular" do zero.
      effectivePartial:
        p.isPartial || (raw[i + 1]?.isPartial ?? false) ? p.effective : null,
    }));
    const target = q.data?.ratePerMinute ?? 0;
    const maxObserved = raw.reduce(
      (m, p) => Math.max(m, p.effective, p.failed),
      0,
    );
    return {
      data: fullPoints,
      maxY: Math.max(maxObserved, target) * 1.2 || 10,
      target,
    };
  }, [q.data]);

  if (q.isLoading && !q.data) {
    return (
      <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando histórico…
      </div>
    );
  }

  if (data.length === 0) {
    return <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">Sem envios registrados ainda.</div>;
  }

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="speedFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--chart-1, 220 90% 56%))" stopOpacity={0.25} />
              <stop offset="100%" stopColor="hsl(var(--chart-1, 220 90% 56%))" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="speedFillPartial" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--chart-1, 220 90% 56%))" stopOpacity={0.25} />
              <stop offset="100%" stopColor="hsl(var(--chart-1, 220 90% 56%))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={32} />
          <YAxis
            tick={{ fontSize: 11 }}
            domain={[0, Math.ceil(maxY)]}
            allowDecimals={false}
            label={{ value: "msg/min", angle: -90, position: "insideLeft", style: { fontSize: 11, fill: "hsl(var(--muted-foreground))" } }}
          />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
            formatter={(value: any, name: string) => {
              if (name === "effectiveFull" || name === "effectivePartial") {
                return [value, "Velocidade (msg/min)"];
              }
              if (name === "failed") return [value, "Falhas"];
              if (name === "target") return [value, "Meta"];
              return [value, name];
            }}
            labelFormatter={(_l, payload) => {
              const p = (payload?.[0]?.payload ?? {}) as any;
              const base = `Minuto ${p.label ?? ""}`;
              return p.isPartial ? `${base} (parcial)` : base;
            }}
          />
          {/* Área cheia: minutos completos */}
          <Area
            type="monotone"
            dataKey="effectiveFull"
            stroke="hsl(var(--chart-1, 220 90% 56%))"
            strokeWidth={2}
            fill="url(#speedFill)"
            connectNulls
            isAnimationActive={false}
          />
          {/* Área tracejada/clarinha: minutos parciais (início/fim/atual) */}
          <Area
            type="monotone"
            dataKey="effectivePartial"
            stroke="hsl(var(--chart-1, 220 90% 56%))"
            strokeOpacity={0.6}
            strokeWidth={2}
            strokeDasharray="4 3"
            fill="url(#speedFillPartial)"
            connectNulls
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="failed"
            stroke="hsl(var(--destructive))"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
          {target > 0 && (
            <ReferenceLine
              y={target}
              stroke="hsl(24 95% 53%)"
              strokeWidth={2.5}
              strokeDasharray="8 4"
              ifOverflow="extendDomain"
              label={{
                value: `meta: ${target}/min`,
                position: "insideTopRight",
                fontSize: 11,
                fontWeight: 600,
                fill: "hsl(24 95% 53%)",
              }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
