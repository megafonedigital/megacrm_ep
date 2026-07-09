// Orchestrates buyer validation for Ellie:
// 1) manual table lookup, 2) Hotmart subscriptions + sales, 3) match against allow-listed product ids.

import {
  fetchSubscriptions,
  fetchSalesHistory,
  extractProductIds,
} from "./hotmart.server";
import { toE164, waIdLookupVariants } from "./phone";


export type EllieValidationResult = {
  status: "aluno" | "lead";
  source: "manual" | "hotmart" | "cache" | "none";
  matchedProductIds: string[];
};

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
const HOTMART_TIMEOUT_MS = 6000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms),
    ),
  ]);
}

export async function validateEllieBuyer(args: {
  brandId: string;
  email?: string | null;
  phone?: string | null;
  forceRefresh?: boolean;
}): Promise<EllieValidationResult> {
  const t0 = Date.now();
  const { brandId, email, phone, forceRefresh } = args;
  if (!email && !phone) {
    return { status: "lead", source: "none", matchedProductIds: [] };
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // 1) Manual allow-list (always wins)
  if (email) {
    const { data: manual } = await supabaseAdmin
      .from("ellie_buyer_validations")
      .select("id, source, validated_at")
      .eq("brand_id", brandId)
      .eq("active", true)
      .eq("source", "manual")
      .ilike("email", email)
      .maybeSingle();
    if (manual) {
      await supabaseAdmin
        .from("ellie_buyer_validations")
        .update({ validated_at: new Date().toISOString() })
        .eq("id", manual.id);
      console.log("[ellie-validation] manual hit", { brandId, email, ms: Date.now() - t0 });
      return { status: "aluno", source: "manual", matchedProductIds: [] };
    }
  }

  // 1b) Manual allow-list by phone (auto-verifies WhatsApp number).
  if (phone) {
    const variants = waIdLookupVariants(phone);
    const e164 = toE164(phone);
    const phoneCandidates = Array.from(
      new Set(
        [
          ...(e164 ? [e164] : []),
          ...variants.map((v) => (v.startsWith("+") ? v : "+" + v)),
        ].filter(Boolean),
      ),
    );
    if (phoneCandidates.length > 0) {
      const { data: manualByPhone } = await supabaseAdmin
        .from("ellie_buyer_validations")
        .select("id, validated_at")
        .eq("brand_id", brandId)
        .eq("active", true)
        .eq("source", "manual")
        .in("phone", phoneCandidates)
        .limit(1)
        .maybeSingle();
      if (manualByPhone) {
        await supabaseAdmin
          .from("ellie_buyer_validations")
          .update({ validated_at: new Date().toISOString() })
          .eq("id", manualByPhone.id);
        console.log("[ellie-validation] manual hit by phone", {
          brandId, phone, ms: Date.now() - t0,
        });
        return { status: "aluno", source: "manual", matchedProductIds: [] };
      }
    }
  }

  if (!email) {
    return { status: "lead", source: "none", matchedProductIds: [] };
  }


  // 2) Cache lookup (hotmart-sourced result within TTL)
  if (!forceRefresh) {
    const { data: cached } = await supabaseAdmin
      .from("ellie_buyer_validations")
      .select("active, matched_product_ids, validated_at, source")
      .eq("brand_id", brandId)
      .eq("source", "hotmart")
      .ilike("email", email)
      .maybeSingle();
    if (cached?.validated_at) {
      const age = Date.now() - new Date(cached.validated_at).getTime();
      if (age < CACHE_TTL_MS) {
        const ids = (cached.matched_product_ids as string[] | null) ?? [];
        console.log("[ellie-validation] cache hit", {
          brandId, email, status: cached.active ? "aluno" : "lead", ageMs: age,
        });
        return {
          status: cached.active ? "aluno" : "lead",
          source: "cache",
          matchedProductIds: ids,
        };
      }
    }
  }

  // 3) Hotmart lookup
  const { data: allowed } = await supabaseAdmin
    .from("ellie_hotmart_products")
    .select("product_id")
    .eq("brand_id", brandId)
    .eq("active", true);
  const allowedSet = new Set((allowed ?? []).map((r) => String(r.product_id)));
  if (allowedSet.size === 0) {
    return { status: "lead", source: "hotmart", matchedProductIds: [] };
  }

  let matched: string[] = [];
  let raw: unknown = null;
  try {
    const [subs, sales] = await Promise.all([
      withTimeout(fetchSubscriptions(brandId, email), HOTMART_TIMEOUT_MS, "subscriptions").catch(
        (e) => ({ __error: (e as Error).message }) as any,
      ),
      withTimeout(fetchSalesHistory(brandId, email), HOTMART_TIMEOUT_MS, "sales").catch(
        (e) => ({ __error: (e as Error).message }) as any,
      ),
    ]);
    raw = { subscriptions: subs, sales };
    const ids = [...extractProductIds(subs as any), ...extractProductIds(sales as any)];
    matched = [...new Set(ids.filter((id) => allowedSet.has(id)))];
  } catch (e) {
    raw = { error: (e as Error).message };
  }

  const status: "aluno" | "lead" = matched.length > 0 ? "aluno" : "lead";

  await supabaseAdmin.from("ellie_buyer_validations").upsert(
    {
      brand_id: brandId,
      email,
      phone: phone ?? null,
      active: status === "aluno",
      source: "hotmart",
      matched_product_ids: matched,
      raw_response: raw as any,
      validated_at: new Date().toISOString(),
    },
    { onConflict: "brand_id,email" },
  );

  console.log("[ellie-validation] hotmart", {
    brandId, email, status, matched, ms: Date.now() - t0,
  });

  return { status, source: "hotmart", matchedProductIds: matched };
}

export function buildBuyerStatusBlock(r: EllieValidationResult | null): string {
  if (!r) return "";
  const lines = [
    "[STATUS DO CONTATO NA HOTMART]",
    `status: ${r.status}`,
    `fonte: ${r.source}`,
  ];
  if (r.matchedProductIds.length > 0) {
    lines.push(`produtos: ${r.matchedProductIds.join(", ")}`);
  }
  lines.push(
    r.status === "aluno"
      ? "Este contato JÁ é aluno. Trate como aluno ativo."
      : "Este contato é LEAD (não comprou). Não confirme matrícula; trate como prospect.",
  );
  return lines.join("\n");
}
