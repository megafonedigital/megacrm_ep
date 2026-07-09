/**
 * MegaCRM Broadcast Worker
 *
 * Substitui os crons HTTP broadcast-loop/tick/drain/reconcile por loops
 * contínuos num processo dedicado — sem deadline de request, sem cold start,
 * com concorrência tunável. Réplicas adicionais são seguras: toda a
 * coordenação (locks, SKIP LOCKED, token bucket) vive no Postgres.
 *
 * Loops:
 *   tick       — a cada TICK_INTERVAL_MS: promove scheduled→running, enfileira
 *   drain      — contínuo: claim+dispatch; dorme DRAIN_IDLE_MS só quando vazio
 *   reconcile  — a cada RECONCILE_INTERVAL_MS
 *   health     — a cada HEALTH_INTERVAL_MS (snapshot + WARN abaixo do alvo)
 */
import http from "node:http";
import { config } from "./config.js";
import { pool } from "./db.js";
import { tickOnce } from "./tick.js";
import { drainOnce } from "./drain.js";
import { reconcileOnce, healthSnapshot } from "./reconcile.js";

let shuttingDown = false;
const stats = {
  startedAt: new Date().toISOString(),
  ticks: 0,
  drains: 0,
  dispatched: 0,
  failed: 0,
  retried: 0,
  skipped: 0,
  lastTickAt: null,
  lastDrainAt: null,
  lastError: null,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Executa fn em loop com intervalo fixo, sobrevivendo a erros. */
async function loopEvery(name, intervalMs, fn) {
  while (!shuttingDown) {
    const t0 = Date.now();
    try {
      await fn();
    } catch (e) {
      stats.lastError = `${name}: ${e.message}`;
      console.error(`[${name}] erro:`, e.message);
    }
    const elapsed = Date.now() - t0;
    await sleep(Math.max(0, intervalMs - elapsed));
  }
}

async function tickLoop() {
  await loopEvery("tick", config.tickIntervalMs, async () => {
    const r = await tickOnce();
    stats.ticks++;
    stats.lastTickAt = new Date().toISOString();
    if (r.enqueued > 0 || r.requeued > 0) {
      console.log(`[tick] running=${r.processed} enqueued=${r.enqueued} requeued=${r.requeued}`);
    }
  });
}

async function drainLoop() {
  while (!shuttingDown) {
    let r;
    try {
      r = await drainOnce();
      stats.drains++;
      stats.dispatched += r.dispatched;
      stats.failed += r.failed;
      stats.retried += r.retried;
      stats.skipped += r.skipped;
      stats.lastDrainAt = new Date().toISOString();
      if (r.claimed > 0) {
        console.log(
          `[drain] claimed=${r.claimed} dispatched=${r.dispatched} ` +
            `skipped=${r.skipped} failed=${r.failed} retried=${r.retried}`,
        );
      }
    } catch (e) {
      stats.lastError = `drain: ${e.message}`;
      console.error("[drain] erro:", e.message);
      await sleep(2000);
      continue;
    }
    // Batch cheio = provavelmente há mais na fila → re-claima imediatamente.
    // Fila vazia/parcial = espera o token bucket encher de novo.
    if (r.claimed < config.drainBatchSize) {
      await sleep(config.drainIdleMs);
    }
  }
}

async function reconcileLoop() {
  await loopEvery("reconcile", config.reconcileIntervalMs, async () => {
    const r = await reconcileOnce();
    if (r.promoted > 0 || r.failedDetected > 0) {
      console.log(
        `[reconcile] promoted=${r.promoted} failedDetected=${r.failedDetected} recounted=${r.recounted}`,
      );
    }
  });
}

async function healthLoop() {
  await loopEvery("health", config.healthIntervalMs, () => healthSnapshot());
}

// Endpoint de health para o EasyPanel/Docker healthcheck.
const healthServer = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    const stale =
      stats.lastDrainAt && Date.now() - new Date(stats.lastDrainAt).getTime() > 60_000;
    res.writeHead(stale ? 503 : 200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(stats));
  } else {
    res.writeHead(404);
    res.end();
  }
});

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] ${signal} recebido — encerrando (itens in-flight são recuperados pelo requeue)`);
  healthServer.close();
  // Dá até 15s para o batch corrente terminar; depois força.
  await Promise.race([sleep(15_000), pool.end()]);
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Boot: valida conexão com o banco antes de iniciar os loops.
try {
  await pool.query("SELECT 1");
} catch (e) {
  console.error("[worker] não conectou ao Postgres:", e.message);
  process.exit(1);
}

healthServer.listen(config.healthPort, () => {
  console.log(
    `[worker] iniciado — tick=${config.tickIntervalMs}ms ` +
      `concurrency=${config.drainConcurrency} batch=${config.drainBatchSize} ` +
      `engine=${config.functionsUrl} health=:${config.healthPort}/healthz`,
  );
});

await Promise.all([tickLoop(), drainLoop(), reconcileLoop(), healthLoop()]);
