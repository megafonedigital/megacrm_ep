import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { syncAccount } from "./integrations-sync.server";

export const syncIntegrationAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ accountId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    // admin OU developer podem sincronizar
    const { data: roleRow } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .in("role", ["admin", "developer"])
      .maybeSingle();
    if (!roleRow) throw new Error("Apenas admin ou developer podem sincronizar integrações.");

    return syncAccount(data.accountId);
  });
