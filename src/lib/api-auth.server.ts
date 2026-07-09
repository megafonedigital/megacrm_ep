// Server-only helper for public API key authentication.
// Validates `Authorization: Bearer <key>` against brand_api_keys.
import { createHash, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface ApiAuthResult {
  ok: true;
  brandId: string;
  keyId: string;
  keyPrefix: string;
}

export type ApiAuthError = { ok: false; status: number; error: string };

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  // 32 bytes hex = 64 chars, prefixed for identification
  const random = crypto.getRandomValues(new Uint8Array(32));
  const hex = Array.from(random).map((b) => b.toString(16).padStart(2, "0")).join("");
  const key = `mck_${hex}`;
  return { key, prefix: key.slice(0, 11), hash: hashApiKey(key) };
}

export async function authenticateApiKey(request: Request): Promise<ApiAuthResult | ApiAuthError> {
  const auth = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) {
    return { ok: false, status: 401, error: "Missing Authorization: Bearer <api_key>" };
  }
  const key = auth.slice(7).trim();
  if (!key) return { ok: false, status: 401, error: "Empty API key" };
  const hash = hashApiKey(key);

  const { data, error } = await supabaseAdmin
    .from("brand_api_keys")
    .select("id, brand_id, key_hash, key_prefix, revoked_at")
    .eq("key_hash", hash)
    .maybeSingle();

  if (error || !data) return { ok: false, status: 401, error: "Invalid API key" };
  if (data.revoked_at) return { ok: false, status: 401, error: "API key revoked" };

  // Constant-time comparison as defense-in-depth
  try {
    const a = Buffer.from(hash);
    const b = Buffer.from(data.key_hash);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, status: 401, error: "Invalid API key" };
    }
  } catch {
    return { ok: false, status: 401, error: "Invalid API key" };
  }

  // Await: Workers cancel pending promises after the response is sent
  await supabaseAdmin
    .from("brand_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);

  return { ok: true, brandId: data.brand_id, keyId: data.id, keyPrefix: data.key_prefix };
}

export function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function jsonOk(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

import { toE164Digits } from "./phone";

/**
 * Normalize a raw phone string for storage in `contacts.wa_id`.
 * Returns the E.164 digits (no leading "+"), or "" when unparseable.
 */
export function normalizePhone(input: string): string {
  return toE164Digits(input) ?? "";
}
