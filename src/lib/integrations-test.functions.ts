import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { testConnection, type TestResult } from "./integrations-test.server";

export const testIntegrationConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ accountId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }): Promise<TestResult> => {
    try {
      const { data: roleRow } = await context.supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", context.userId)
        .eq("role", "admin")
        .maybeSingle();
      if (!roleRow) {
        return { ok: false, status: 403, message: "Apenas administradores podem testar conexões." };
      }
      return await testConnection(data.accountId);
    } catch (e: any) {
      // Garante que jamais lançamos um Response — isso vira RUNTIME_ERROR no cliente.
      const message =
        e instanceof Response
          ? `HTTP ${e.status}: ${await e.clone().text().catch(() => e.statusText)}`
          : e?.message ?? String(e);
      return { ok: false, message };
    }
  });
