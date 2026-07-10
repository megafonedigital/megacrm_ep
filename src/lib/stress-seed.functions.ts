import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  brandId: z.string().uuid(),
  count: z.number().int().min(1).max(50000).default(10000),
});

export type StressSeedResult = { tag_id: string; created: number; tagged: number };

export const seedStressContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }) => {
    // rpc criada em migration própria — ausente nos types gerados do Supabase
    const rpc = context.supabase.rpc as (name: string, args: Record<string, unknown>) =>
      PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;
    const { data: result, error } = await rpc("seed_stress_contacts", {
      _brand_id: data.brandId,
      _count: data.count,
    });
    if (error) {
      if (error.code === "42501") throw new Error("Apenas administradores podem gerar contatos de stress test.");
      throw new Error(error.message);
    }
    return result as StressSeedResult;
  });
