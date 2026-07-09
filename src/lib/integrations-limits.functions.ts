import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface GlobalLimitsSummary {
  rpm: number;
  burst: number;
  tier: string;
  accountsAboveCap: number;
}

/**
 * Devolve teto global atual + quantas contas estão acima dele
 * (rpm OU burst). Usado pela UI de Filas para mostrar o aviso e
 * habilitar o botão "Realinhar contas ao teto".
 */
export const getGlobalLimitsSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GlobalLimitsSummary> => {
    const { userId, supabase } = context;
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const allowed = (roles ?? []).some((r: any) => ["admin", "supervisor", "developer"].includes(r.role));
    if (!allowed) throw new Response("Forbidden", { status: 403 });

    const { data: cfg } = await supabaseAdmin
      .from("integration_global_limits" as any)
      .select("tier, global_rate_limit_per_minute, global_burst")
      .eq("id", true)
      .maybeSingle();

    const rpm = (cfg as any)?.global_rate_limit_per_minute ?? 300;
    const burst = (cfg as any)?.global_burst ?? 60;
    const tier = (cfg as any)?.tier ?? "equilibrado";

    const { count } = await supabaseAdmin
      .from("integration_accounts" as any)
      .select("id", { count: "exact", head: true })
      .or(`rate_limit_per_minute.gt.${rpm},rate_limit_burst.gt.${burst}`);

    return { rpm, burst, tier, accountsAboveCap: count ?? 0 };
  });

/**
 * Aplica least(limite_atual, teto_global) em todas as contas.
 * Admin-only. Retorna quantas linhas foram alteradas.
 */
export const realignAccountsToGlobal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId, supabase } = context;
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (!(roles ?? []).some((r: any) => r.role === "admin")) {
      throw new Response("Forbidden", { status: 403 });
    }

    const { data: cfg } = await supabaseAdmin
      .from("integration_global_limits" as any)
      .select("global_rate_limit_per_minute, global_burst")
      .eq("id", true)
      .maybeSingle();
    const rpm = (cfg as any)?.global_rate_limit_per_minute ?? 300;
    const burst = (cfg as any)?.global_burst ?? 60;

    const { data: above } = await supabaseAdmin
      .from("integration_accounts" as any)
      .select("id, rate_limit_per_minute, rate_limit_burst")
      .or(`rate_limit_per_minute.gt.${rpm},rate_limit_burst.gt.${burst}`);

    const rows = ((above ?? []) as any[]);
    let updated = 0;
    for (const r of rows) {
      const newRpm = Math.min(r.rate_limit_per_minute, rpm);
      const newBurst = Math.min(r.rate_limit_burst, burst);
      const { error } = await supabaseAdmin
        .from("integration_accounts" as any)
        .update({ rate_limit_per_minute: newRpm, rate_limit_burst: newBurst })
        .eq("id", r.id);
      if (!error) updated++;
    }
    return { updated };
  });
