import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizeHumanizeConfig, type HumanizeConfig } from "@/lib/ai-humanize";

async function assertBrandAdmin(userId: string, brandId: string) {
  const { data: access, error: accErr } = await supabaseAdmin.rpc("has_brand_access", {
    _user_id: userId,
    _brand_id: brandId,
  });
  if (accErr) throw new Error(accErr.message);
  if (!access) throw new Response("Forbidden", { status: 403 });

  const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  const { data: isDev } = await supabaseAdmin.rpc("has_role", {
    _user_id: userId,
    _role: "developer",
  });
  if (!isAdmin && !isDev) throw new Response("Forbidden", { status: 403 });
}

export const getBrandAiHumanize = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ brandId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertBrandAdmin(context.userId, data.brandId);
    const { data: row, error } = await supabaseAdmin
      .from("brands")
      .select("ai_humanize")
      .eq("id", data.brandId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const cfg: HumanizeConfig = normalizeHumanizeConfig((row as any)?.ai_humanize);
    return { config: cfg };
  });

const ConfigSchema = z.object({
  enabled: z.boolean(),
  split_mode: z.enum(["paragraph", "sentence", "limit", "paragraph_then_limit"]),
  max_chars: z.number().int().min(40).max(1000),
  max_parts: z.number().int().min(1).max(12),
  delay_mode: z.enum(["fixed", "proportional", "random"]),
  delay_fixed_ms: z.number().int().min(0).max(15000),
  delay_chars_per_sec: z.number().int().min(5).max(500),
  delay_min_ms: z.number().int().min(0).max(15000),
  delay_max_ms: z.number().int().min(0).max(20000),
});

export const updateBrandAiHumanize = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ brandId: z.string().uuid(), config: ConfigSchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertBrandAdmin(context.userId, data.brandId);
    const cfg = normalizeHumanizeConfig(data.config);
    const { error } = await supabaseAdmin
      .from("brands")
      .update({ ai_humanize: cfg as any })
      .eq("id", data.brandId);
    if (error) throw new Error(error.message);
    return { ok: true, config: cfg };
  });
