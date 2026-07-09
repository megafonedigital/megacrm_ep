import pg from "pg";
import { config } from "./config.js";

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: config.pgPoolSize,
  idleTimeoutMillis: 30_000,
  // Nenhuma query do motor deve passar de 15s; se passar, algo está errado
  // e é melhor soltar a conexão do que travar o pool.
  statement_timeout: 15_000,
});

pool.on("error", (err) => {
  console.error("[db] erro em conexão ociosa do pool:", err.message);
});

/** SELECT de função SQL que devolve um escalar (int, bool...). */
export async function callScalar(fn, params = []) {
  const placeholders = params.map((_, i) => `$${i + 1}`).join(", ");
  const { rows } = await pool.query(
    `SELECT public.${fn}(${placeholders}) AS result`,
    params,
  );
  return rows[0]?.result ?? null;
}

/** SELECT * FROM função SQL que devolve linhas. */
export async function callRows(fn, params = []) {
  const placeholders = params.map((_, i) => `$${i + 1}`).join(", ");
  const { rows } = await pool.query(
    `SELECT * FROM public.${fn}(${placeholders})`,
    params,
  );
  return rows;
}
