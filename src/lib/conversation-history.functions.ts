import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type HistoryEntry = {
  id: string;
  at: string;
  type: string;
  payload: Record<string, any>;
  actorId: string | null;
  actorName: string | null;
};

export const getConversationHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ conversationId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;

    // 1. Carrega conversa + brand
    const { data: conv, error: convErr } = await supabaseAdmin
      .from("conversations")
      .select("id, brand_id")
      .eq("id", data.conversationId)
      .maybeSingle();
    if (convErr) throw new Error(convErr.message);
    if (!conv) throw new Response("Not found", { status: 404 });

    // 2. Verifica acesso ao brand
    const { data: access } = await supabaseAdmin.rpc("has_brand_access", {
      _user_id: userId,
      _brand_id: conv.brand_id,
    });
    if (!access) throw new Response("Forbidden", { status: 403 });

    // 3. Verifica papel: admin, supervisor ou developer
    const { data: rolesRows } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const roles = (rolesRows ?? []).map((r) => r.role as string);
    const allowed =
      roles.includes("admin") ||
      roles.includes("supervisor") ||
      roles.includes("developer");
    if (!allowed) throw new Response("Forbidden", { status: 403 });

    // 4. Busca eventos
    const { data: events, error: evErr } = await supabaseAdmin
      .from("conversation_events")
      .select("id, event_type, actor_id, payload, created_at")
      .eq("conversation_id", data.conversationId)
      .order("created_at", { ascending: true });
    if (evErr) throw new Error(evErr.message);

    const actorIds = Array.from(
      new Set((events ?? []).map((e) => e.actor_id).filter(Boolean) as string[]),
    );
    let nameMap: Record<string, string> = {};
    if (actorIds.length > 0) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email")
        .in("id", actorIds);
      nameMap = Object.fromEntries(
        (profs ?? []).map((p) => [
          p.id,
          (p.full_name as string | null) ?? (p.email as string | null) ?? "—",
        ]),
      );
    }

    return (events ?? []).map((e) => ({
      id: e.id as string,
      at: e.created_at as string,
      type: e.event_type as string,
      payload: (e.payload as Record<string, any>) ?? {},
      actorId: (e.actor_id as string | null) ?? null,
      actorName: e.actor_id ? nameMap[e.actor_id as string] ?? null : null,
    }));
  });
