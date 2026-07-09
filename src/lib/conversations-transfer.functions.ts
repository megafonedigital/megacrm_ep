import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const transferConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        conversationId: z.string().uuid(),
        // Back-compat: callers antigos enviam targetUserId; novos podem enviar targetId + kind.
        targetUserId: z.string().uuid().nullable().optional(),
        targetId: z.string().uuid().nullable().optional(),
        kind: z.enum(["user", "ai"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { conversationId } = data;
    const { userId } = context;
    const targetId = (data.targetId ?? data.targetUserId ?? null) as string | null;
    const kind: "user" | "ai" = data.kind ?? "user";

    // Carrega conversa
    const { data: conv, error: convErr } = await supabaseAdmin
      .from("conversations")
      .select("id, brand_id, assigned_to, ai_agent_id, channel_id")
      .eq("id", conversationId)
      .maybeSingle();
    if (convErr) throw new Error(convErr.message);
    if (!conv) throw new Response("Conversa não encontrada", { status: 404 });

    // Requester precisa de acesso ao workspace
    const { data: reqAccess, error: reqAccessErr } = await supabaseAdmin.rpc(
      "has_brand_access",
      { _user_id: userId, _brand_id: conv.brand_id },
    );
    if (reqAccessErr) throw new Error(reqAccessErr.message);
    if (!reqAccess) throw new Response("Sem acesso a este workspace", { status: 403 });

    // Verifica papel do requester
    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    const { data: isSupervisor } = await supabaseAdmin.rpc("has_role", {
      _user_id: userId,
      _role: "supervisor",
    });
    const elevated = !!isAdmin || !!isSupervisor;

    // Agentes comuns só podem mexer em conversas próprias ou sem dono
    if (!elevated) {
      const currentOwner = (conv.assigned_to as string | null) ?? null;
      const currentAi = (conv.ai_agent_id as string | null) ?? null;
      if (currentOwner !== null && currentOwner !== userId) {
        throw new Response(
          "Você só pode transferir conversas atribuídas a você",
          { status: 403 },
        );
      }
      // se há IA atribuída e o usuário não é dono, também não pode reatribuir
      if (currentOwner === null && currentAi !== null) {
        throw new Response(
          "Conversa atribuída a um agente de IA — apenas admin/supervisor pode reatribuir",
          { status: 403 },
        );
      }
    }

    let update: { assigned_to: string | null; ai_agent_id: string | null };
    let eventType: "assigned" | "ai_assigned" | "unassigned";
    let eventPayload: Record<string, string | null>;

    if (targetId === null) {
      update = { assigned_to: null, ai_agent_id: null };
      eventType = "unassigned";
      eventPayload = { by: "transfer" };
    } else if (kind === "ai") {
      // Valida que o agente pertence ao workspace da conversa
      const { data: agent, error: agentErr } = await supabaseAdmin
        .from("ai_agents")
        .select("id, brand_id")
        .eq("id", targetId)
        .maybeSingle();
      if (agentErr) throw new Error(agentErr.message);
      if (!agent || (agent as any).brand_id !== conv.brand_id) {
        throw new Response(
          "O agente de IA escolhido não pertence a este workspace",
          { status: 400 },
        );
      }
      update = { assigned_to: null, ai_agent_id: targetId };
      eventType = "ai_assigned";
      eventPayload = { ai_agent_id: targetId, by: "transfer" };
    } else {
      // user
      const { data: targetAccess, error: targetAccessErr } = await supabaseAdmin.rpc(
        "has_brand_access",
        { _user_id: targetId, _brand_id: conv.brand_id },
      );
      if (targetAccessErr) throw new Error(targetAccessErr.message);
      if (!targetAccess) {
        throw new Response(
          "O usuário escolhido não tem acesso a este workspace",
          { status: 400 },
        );
      }
      update = { assigned_to: targetId, ai_agent_id: null };
      eventType = "assigned";
      eventPayload = { assigned_to: targetId, by: targetId === userId ? "self" : "transfer" };
    }

    const { error: updErr } = await supabaseAdmin
      .from("conversations")
      .update(update)
      .eq("id", conversationId);
    if (updErr) throw new Error(updErr.message);

    await supabaseAdmin.from("conversation_events").insert({
      conversation_id: conversationId,
      event_type: eventType,
      actor_id: userId,
      payload: eventPayload,
    });

    return { ok: true as const };
  });

export const bulkTransferConversations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        conversationIds: z.array(z.string().uuid()).min(1).max(2000),
        targetId: z.string().uuid().nullable(),
        kind: z.enum(["user", "ai"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { conversationIds, targetId } = data;
    const kind: "user" | "ai" = data.kind ?? "user";
    const { userId } = context;

    // Carrega todas as conversas para validar acesso e workspace.
    const { data: convs, error: convErr } = await supabaseAdmin
      .from("conversations")
      .select("id, brand_id, assigned_to, ai_agent_id")
      .in("id", conversationIds);
    if (convErr) throw new Error(convErr.message);
    if (!convs || convs.length === 0) {
      throw new Response("Nenhuma conversa encontrada", { status: 404 });
    }

    // Todas devem pertencer ao mesmo workspace (caso de uso: pipeline = 1 brand)
    const brandIds = Array.from(new Set(convs.map((c) => c.brand_id as string)));
    if (brandIds.length !== 1) {
      throw new Response("Conversas pertencem a workspaces diferentes", { status: 400 });
    }
    const brandId = brandIds[0];

    // Acesso do requester ao workspace
    const { data: reqAccess, error: reqAccessErr } = await supabaseAdmin.rpc(
      "has_brand_access",
      { _user_id: userId, _brand_id: brandId },
    );
    if (reqAccessErr) throw new Error(reqAccessErr.message);
    if (!reqAccess) throw new Response("Sem acesso a este workspace", { status: 403 });

    // Papel do requester (uma única vez)
    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    const { data: isSupervisor } = await supabaseAdmin.rpc("has_role", {
      _user_id: userId,
      _role: "supervisor",
    });
    const elevated = !!isAdmin || !!isSupervisor;

    // Para usuários comuns: só conversas próprias ou sem dono
    let allowedConvs = convs;
    let skipped = 0;
    if (!elevated) {
      allowedConvs = convs.filter((c) => {
        const owner = (c.assigned_to as string | null) ?? null;
        const ai = (c.ai_agent_id as string | null) ?? null;
        if (owner !== null && owner !== userId) return false;
        if (owner === null && ai !== null) return false;
        return true;
      });
      skipped = convs.length - allowedConvs.length;
    }

    // Valida alvo (uma única vez)
    let update: { assigned_to: string | null; ai_agent_id: string | null };
    let eventType: "assigned" | "ai_assigned" | "unassigned";
    let basePayload: Record<string, string | null>;

    if (targetId === null) {
      update = { assigned_to: null, ai_agent_id: null };
      eventType = "unassigned";
      basePayload = { by: "transfer" };
    } else if (kind === "ai") {
      const { data: agent, error: agentErr } = await supabaseAdmin
        .from("ai_agents")
        .select("id, brand_id")
        .eq("id", targetId)
        .maybeSingle();
      if (agentErr) throw new Error(agentErr.message);
      if (!agent || (agent as { brand_id: string }).brand_id !== brandId) {
        throw new Response("O agente de IA escolhido não pertence a este workspace", { status: 400 });
      }
      update = { assigned_to: null, ai_agent_id: targetId };
      eventType = "ai_assigned";
      basePayload = { ai_agent_id: targetId, by: "transfer" };
    } else {
      const { data: targetAccess, error: targetAccessErr } = await supabaseAdmin.rpc(
        "has_brand_access",
        { _user_id: targetId, _brand_id: brandId },
      );
      if (targetAccessErr) throw new Error(targetAccessErr.message);
      if (!targetAccess) {
        throw new Response("O usuário escolhido não tem acesso a este workspace", { status: 400 });
      }
      update = { assigned_to: targetId, ai_agent_id: null };
      eventType = "assigned";
      basePayload = { assigned_to: targetId, by: targetId === userId ? "self" : "transfer" };
    }

    const ids = allowedConvs.map((c) => c.id as string);
    if (ids.length === 0) {
      return { updated: 0, skipped, failed: 0 };
    }

    // UPDATE em massa
    const { error: updErr } = await supabaseAdmin
      .from("conversations")
      .update(update)
      .in("id", ids);
    if (updErr) throw new Error(updErr.message);

    // INSERT em batch dos eventos
    const events = ids.map((cid) => ({
      conversation_id: cid,
      event_type: eventType,
      actor_id: userId,
      payload: basePayload,
    }));
    const { error: evErr } = await supabaseAdmin.from("conversation_events").insert(events);
    if (evErr) {
      console.error("[bulkTransferConversations events]", evErr.message);
    }

    return { updated: ids.length, skipped, failed: 0 };
  });
