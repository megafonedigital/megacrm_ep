// Faixas pré-definidas de processamento global da fila de integrações.
// Usado tanto no worker (server) quanto na UI (/admin/filas).
export type GlobalTier = "conservador" | "equilibrado" | "alto" | "intenso" | "turbo" | "maximo" | "custom";

export interface TierPreset {
  id: GlobalTier;
  label: string;
  rpm: number;
  burst: number;
  description: string;
}

export const TIERS: TierPreset[] = [
  { id: "conservador",  label: "Conservador",  rpm: 120,   burst: 30,   description: "Instância pequena ou pouco volume." },
  { id: "equilibrado",  label: "Equilibrado",  rpm: 300,   burst: 60,   description: "Uso médio, 1–3 integrações ativas." },
  { id: "alto",         label: "Alto",         rpm: 600,   burst: 100,  description: "Várias integrações com volume." },
  { id: "intenso",      label: "Intenso",      rpm: 1200,  burst: 200,  description: "Picos altos / instância maior." },
  { id: "turbo",        label: "Turbo",        rpm: 3000,  burst: 600,  description: "Instância grande, alto volume sustentado." },
  { id: "maximo",       label: "Máximo",       rpm: 6000,  burst: 1200, description: "Picos muito altos; observar APIs externas." },
];

export function tierBelow(tier: GlobalTier): GlobalTier {
  const order: GlobalTier[] = ["conservador", "equilibrado", "alto", "intenso", "turbo", "maximo"];
  const idx = order.indexOf(tier as Exclude<GlobalTier, "custom">);
  if (idx <= 0) return "conservador";
  return order[idx - 1];
}

export function tierPreset(tier: GlobalTier): { rpm: number; burst: number } | null {
  const t = TIERS.find((x) => x.id === tier);
  return t ? { rpm: t.rpm, burst: t.burst } : null;
}
