import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface QueueHealthResult {
  level: "ok" | "warn" | "critical";
  reasons: string[];
  pending: number;
  processing: number;
  processedLastMin: number;
  failedLastMin: number;
  tier: string | null;
  autoThrottle: { until: string; tier: string } | null;
  config: {
    tier: string;
    rpm: number;
    burst: number;
    minShare: number;
    distributionMode: "equal" | "weighted";
  };
  lastSnapshotAt: string | null;
}

export const getQueueHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<QueueHealthResult> => {
    const { userId, supabase } = context;

    // Apenas admin/supervisor/dev — checagem leve
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const allowed = (roles ?? []).some((r: any) => ["admin", "supervisor", "developer"].includes(r.role));
    if (!allowed) {
      throw new Response("Forbidden", { status: 403 });
    }

    const [{ data: cfgRow }, { data: snap }] = await Promise.all([
      supabaseAdmin
        .from("integration_global_limits" as any)
        .select("tier, global_rate_limit_per_minute, global_burst, min_share_per_account, distribution_mode, auto_throttle_until, auto_throttle_tier")
        .eq("id", true)
        .maybeSingle(),
      supabaseAdmin
        .from("integration_queue_health_snapshots" as any)
        .select("taken_at, pending, processing, processed_last_min, failed_last_min, tier, level, reasons")
        .order("taken_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const cfg = (cfgRow as any) ?? {
      tier: "equilibrado",
      global_rate_limit_per_minute: 300,
      global_burst: 60,
      min_share_per_account: 10,
      distribution_mode: "equal",
      auto_throttle_until: null,
      auto_throttle_tier: null,
    };
    const s = snap as any;

    const autoActive =
      cfg.auto_throttle_until && new Date(cfg.auto_throttle_until).getTime() > Date.now() && cfg.auto_throttle_tier
        ? { until: cfg.auto_throttle_until as string, tier: cfg.auto_throttle_tier as string }
        : null;

    return {
      level: (s?.level as any) ?? "ok",
      reasons: ((s?.reasons as any) ?? []) as string[],
      pending: s?.pending ?? 0,
      processing: s?.processing ?? 0,
      processedLastMin: s?.processed_last_min ?? 0,
      failedLastMin: s?.failed_last_min ?? 0,
      tier: s?.tier ?? null,
      autoThrottle: autoActive,
      config: {
        tier: cfg.tier,
        rpm: cfg.global_rate_limit_per_minute,
        burst: cfg.global_burst,
        minShare: cfg.min_share_per_account,
        distributionMode: cfg.distribution_mode,
      },
      lastSnapshotAt: s?.taken_at ?? null,
    };
  });

export const updateGlobalLimits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    tier: "conservador" | "equilibrado" | "alto" | "intenso" | "turbo" | "maximo" | "custom";
    rpm: number;
    burst: number;
    minShare: number;
    distributionMode: "equal" | "weighted";
    clearAutoThrottle?: boolean;
  }) => {
    if (!["conservador", "equilibrado", "alto", "intenso", "turbo", "maximo", "custom"].includes(d.tier)) throw new Error("Faixa inválida");
    if (!Number.isFinite(d.rpm) || d.rpm < 30 || d.rpm > 20000) throw new Error("RPM fora do intervalo (30–20000)");
    if (!Number.isFinite(d.burst) || d.burst < 10 || d.burst > 5000) throw new Error("Burst fora do intervalo (10–5000)");
    if (!Number.isFinite(d.minShare) || d.minShare < 1 || d.minShare > 200) throw new Error("Piso fora do intervalo (1–200)");
    if (!["equal", "weighted"].includes(d.distributionMode)) throw new Error("Modo inválido");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { userId, supabase } = context;
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (!(roles ?? []).some((r: any) => r.role === "admin")) {
      throw new Response("Forbidden", { status: 403 });
    }

    const patch: any = {
      tier: data.tier,
      global_rate_limit_per_minute: Math.round(data.rpm),
      global_burst: Math.round(data.burst),
      min_share_per_account: Math.round(data.minShare),
      distribution_mode: data.distributionMode,
      updated_at: new Date().toISOString(),
    };
    if (data.clearAutoThrottle) {
      patch.auto_throttle_until = null;
      patch.auto_throttle_tier = null;
    }

    const { error } = await supabaseAdmin
      .from("integration_global_limits" as any)
      .update(patch)
      .eq("id", true);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const clearAutoThrottle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId, supabase } = context;
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (!(roles ?? []).some((r: any) => r.role === "admin")) {
      throw new Response("Forbidden", { status: 403 });
    }
    const { error } = await supabaseAdmin
      .from("integration_global_limits" as any)
      .update({ auto_throttle_until: null, auto_throttle_tier: null, updated_at: new Date().toISOString() })
      .eq("id", true);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
