// Server-only helper to record API public calls into api_request_logs.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface LogInput {
  request: Request;
  response: Response;
  startedAt: number;
  brandId?: string | null;
  brandIds?: string[] | null;
  apiKeyId?: string | null;
  apiKeyPrefix?: string | null;
  requestBody?: unknown;
  responseSummary?: unknown;
}

const SENSITIVE_KEYS = new Set([
  "authorization",
  "password",
  "token",
  "secret",
  "key",
  "api_key",
  "apikey",
  "hottok",
  "access_token",
  "refresh_token",
]);
const MAX_BODY_BYTES = 4096;

function sanitize(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? "[redacted]" : sanitize(v);
    }
    return out;
  }
  return value;
}

function truncate(value: unknown): unknown {
  try {
    const s = JSON.stringify(value);
    if (s && s.length > MAX_BODY_BYTES) {
      return { _truncated: true, preview: s.slice(0, MAX_BODY_BYTES) };
    }
    return value;
  } catch {
    return null;
  }
}

/**
 * Insere um log por workspace vinculado (fan-out) quando `brandIds` vem populado.
 * Se vier apenas `brandId` (ou nada), mantém o comportamento antigo de uma linha.
 * Uma mesma request compartilhada por várias contas fica visível em todas as
 * telas de logs (filtradas por brand_id).
 */
export async function logApiRequest(input: LogInput): Promise<void> {
  const { request, response, startedAt } = input;
  const url = new URL(request.url);
  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null;
  const ua = request.headers.get("user-agent");

  // Normalize brandIds: prefer explicit array; fall back to single brandId.
  const rawIds = input.brandIds ?? (input.brandId ? [input.brandId] : []);
  const uniqueBrandIds = Array.from(new Set(rawIds.filter((b): b is string => !!b)));
  const targets: (string | null)[] = uniqueBrandIds.length > 0 ? uniqueBrandIds : [null];

  const base = {
    api_key_id: input.apiKeyId ?? null,
    api_key_prefix: input.apiKeyPrefix ?? null,
    method: request.method,
    path: url.pathname,
    status_code: response.status,
    duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
    ip,
    user_agent: ua,
    request_body: input.requestBody !== undefined ? truncate(sanitize(input.requestBody)) : null,
    response_summary: input.responseSummary !== undefined ? truncate(sanitize(input.responseSummary)) : null,
  };

  const rows = targets.map((brand_id) => ({ brand_id, ...base }));

  const { error } = await supabaseAdmin.from("api_request_logs" as any).insert(rows as any);
  if (error) {
    // Propaga: quem chamar (withApiLogging) captura e registra em error_logs
    // para não repetir o silêncio de 20 dias que tivemos com o path da Hotmart.
    throw new Error(`api_request_logs insert failed: ${error.message}`);
  }
}

/**
 * Wrap a route handler to add timing + automatic logging.
 * Awaits the log insert before returning the response — Cloudflare Workers
 * cancel pending promises after the Response is sent.
 *
 * Auto-skips logging when the call is a "no-op" 2xx for the system:
 *   - responseSummary.ignored is set (unknown event type / topic)
 *   - responseSummary.status === "no_match" (no automation listens)
 *   - responseSummary.status === "duplicate" (idempotent re-delivery)
 * Errors (status >= 400) are always logged. Pass forceLog=true to override.
 */
export async function withApiLogging(
  request: Request,
  run: (ctx: {
    startedAt: number;
    setMeta: (m: {
      brandId?: string;
      brandIds?: string[];
      apiKeyId?: string;
      apiKeyPrefix?: string;
      requestBody?: unknown;
      responseSummary?: unknown;
      skipLog?: boolean;
      forceLog?: boolean;
    }) => void;
  }) => Promise<Response>,
): Promise<Response> {
  const startedAt = performance.now();
  let meta: {
    brandId?: string;
    brandIds?: string[];
    apiKeyId?: string;
    apiKeyPrefix?: string;
    requestBody?: unknown;
    responseSummary?: unknown;
    skipLog?: boolean;
    forceLog?: boolean;
  } = {};
  const setMeta = (m: typeof meta) => {
    meta = { ...meta, ...m };
  };
  let response: Response;
  try {
    response = await run({ startedAt, setMeta });
  } catch (err) {
    response = new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  if (meta.responseSummary === undefined) {
    try {
      const cloned = response.clone();
      const text = await cloned.text();
      if (text) {
        try {
          meta.responseSummary = JSON.parse(text);
        } catch {
          meta.responseSummary = { raw: text.slice(0, 500) };
        }
      }
    } catch { /* ignore */ }
  }

  // Auto-skip irrelevant 2xx calls. Errors are always kept.
  let autoSkip = false;
  if (!meta.forceLog && response.status < 400) {
    const s = meta.responseSummary as Record<string, unknown> | undefined;
    if (s && typeof s === "object") {
      if (s.ignored !== undefined) autoSkip = true;
      else if (s.status === "no_match" || s.status === "duplicate") autoSkip = true;
    }
  }
  if (meta.skipLog || autoSkip) return response;

  try {
    await logApiRequest({
      request,
      response,
      startedAt,
      brandId: meta.brandId ?? null,
      brandIds: meta.brandIds ?? null,
      apiKeyId: meta.apiKeyId ?? null,
      apiKeyPrefix: meta.apiKeyPrefix ?? null,
      requestBody: meta.requestBody,
      responseSummary: meta.responseSummary,
    });
  } catch (e) {
    // Não silencia mais: registra no error_logs para monitoramento.
    console.error("[api-logger] insert failed:", e);
    try {
      const url = new URL(request.url);
      const firstBrand = meta.brandIds?.[0] ?? meta.brandId ?? null;
      await supabaseAdmin.from("error_logs" as any).insert({
        severity: "error",
        category: "api_logger",
        code: "api_request_logs_insert_failed",
        message_pt: "Falha ao persistir log de API pública",
        technical_message: e instanceof Error ? e.message : String(e),
        brand_id: firstBrand,
        payload: {
          path: url.pathname,
          method: request.method,
          status_code: response.status,
          brand_ids: meta.brandIds ?? (meta.brandId ? [meta.brandId] : []),
        },
      } as any);
    } catch (inner) {
      console.error("[api-logger] error_logs insert also failed:", inner);
    }
  }
  return response;
}
