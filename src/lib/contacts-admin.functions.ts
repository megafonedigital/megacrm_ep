import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({ ids: z.array(z.string().uuid()).min(1).max(1000) });

export const deleteContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }) => {
    const { data: deleted, error } = await context.supabase.rpc(
      "admin_delete_contacts",
      { _ids: data.ids },
    );
    if (error) {
      if (error.code === "42501") throw new Error("Apenas administradores podem excluir contatos.");
      throw new Error(error.message);
    }
    return { deleted: (deleted as number | null) ?? data.ids.length };
  });
