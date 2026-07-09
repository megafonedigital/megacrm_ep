import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const Input = z.object({
  user_id: z.string().uuid(),
  redirect_origin: z.string().url(),
});

export const sendPasswordReset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }) => {
    const { userId } = context;

    // Admin only
    const { data: isAdminRow, error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdminRow) throw new Error("Apenas administradores podem redefinir senhas.");

    // Get target user's email
    const { data: profile, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("id", data.user_id)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!profile?.email) throw new Error("Usuário sem e-mail cadastrado.");

    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(profile.email, {
      redirectTo: `${data.redirect_origin}/definir-senha`,
    });
    if (error) throw new Error(error.message);

    return { ok: true, email: profile.email };
  });
