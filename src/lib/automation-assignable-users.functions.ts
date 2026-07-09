import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Lista atendentes (profiles ativos) com acesso ao workspace.
 * Usada pelo inspector do nó "Atribuir atendente" no editor de automações.
 *
 * Acesso ao workspace = ter pelo menos um channel_agents em um brand_channels do workspace,
 * ou ser admin/developer. Mesma semântica de has_brand_access.
 */
export const listAssignableUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ brandId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { brandId } = data;
    const { userId } = context;

    // Requester precisa de acesso ao workspace
    const { data: access, error: accessErr } = await supabaseAdmin.rpc(
      "has_brand_access",
      { _user_id: userId, _brand_id: brandId },
    );
    if (accessErr) throw new Error(accessErr.message);
    if (!access) throw new Response("Sem acesso a este workspace", { status: 403 });

    // 1) Canais do workspace
    const { data: channels, error: chErr } = await supabaseAdmin
      .from("brand_channels")
      .select("id")
      .eq("brand_id", brandId);
    if (chErr) throw new Error(chErr.message);
    const channelIds = (channels ?? []).map((c) => c.id);

    const channelUserIds = new Set<string>();

    if (channelIds.length > 0) {
      const { data: cas, error: caErr } = await supabaseAdmin
        .from("channel_agents")
        .select("user_id")
        .in("channel_id", channelIds);
      if (caErr) throw new Error(caErr.message);
      for (const row of cas ?? []) {
        if (row?.user_id) channelUserIds.add(row.user_id);
      }
    }

    // 2) Admins e developers (têm acesso a tudo)
    const { data: priv, error: privErr } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role")
      .in("role", ["admin", "developer"]);
    if (privErr) throw new Error(privErr.message);
    for (const r of priv ?? []) {
      if (r.user_id) channelUserIds.add(r.user_id);
    }

    if (channelUserIds.size === 0) {
      return { users: [] as Array<{ id: string; full_name: string | null; email: string | null }> };
    }

    const { data: profiles, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", Array.from(channelUserIds))
      .eq("active", true)
      .order("full_name", { ascending: true, nullsFirst: false });
    if (profErr) throw new Error(profErr.message);

    return {
      users: (profiles ?? []) as Array<{
        id: string;
        full_name: string | null;
        email: string | null;
      }>,
    };
  });
