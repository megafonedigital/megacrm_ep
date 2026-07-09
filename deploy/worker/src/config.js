/**
 * Configuração do worker via env. Todas as cadências e limites são tunáveis
 * sem rebuild — ajuste no EasyPanel e reinicie o serviço.
 */
function int(name, def) {
  const v = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) ? v : def;
}

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[worker] env obrigatória ausente: ${name}`);
    process.exit(1);
  }
  return v;
}

export const config = {
  /** Postgres direto (sem PostgREST). Ex.: postgres://postgres:senha@db:5432/postgres */
  databaseUrl: required("DATABASE_URL"),
  /** Base das edge functions. Ex.: http://functions:9000 (self-hosted) ou https://xxx.supabase.co/functions/v1 */
  functionsUrl: (
    process.env.FUNCTIONS_URL ??
    `${required("SUPABASE_URL").replace(/\/$/, "")}/functions/v1`
  ).replace(/\/$/, ""),
  serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),

  /** Cadência do tick (promove scheduled→running + enfileira). */
  tickIntervalMs: int("TICK_INTERVAL_MS", 5000),
  /** Pausa do drain quando a fila está vazia. Com itens, ele re-claima direto. */
  drainIdleMs: int("DRAIN_IDLE_MS", 750),
  /** Cadência da reconciliação (falhas async da Meta + recount). */
  reconcileIntervalMs: int("RECONCILE_INTERVAL_MS", 120_000),
  /** Cadência do snapshot de saúde (log WARN quando abaixo do alvo). */
  healthIntervalMs: int("HEALTH_INTERVAL_MS", 60_000),

  /** Chamadas paralelas ao automation-engine por batch. */
  drainConcurrency: int("DRAIN_CONCURRENCY", 100),
  /** Itens por claim. Sem PostgREST não há limite de URL — pode ser alto. */
  drainBatchSize: int("DRAIN_BATCH_SIZE", 300),
  /** Timeout por chamada ao engine (async:true só precisa do POST chegar). */
  engineTimeoutMs: int("ENGINE_TIMEOUT_MS", 800),
  /** Tentativas máximas por item antes de failed definitivo. */
  maxAttempts: int("MAX_ATTEMPTS", 4),
  /** Conexões do pool pg. */
  pgPoolSize: int("PG_POOL_SIZE", 20),
  /** Porta do endpoint de health (GET /healthz). */
  healthPort: int("HEALTH_PORT", 8080),
};
