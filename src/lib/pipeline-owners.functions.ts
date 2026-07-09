import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const applyPipelineDistribution = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        pipelineId: z.string().uuid(),
        brandId: z.string().uuid(),
        contactIds: z.array(z.string().uuid()).min(1).max(2000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { pipelineId, brandId, contactIds } = data;
    const { userId } = context;

    const { data: access, error: accessErr } = await supabaseAdmin.rpc(
      "has_brand_access",
      { _user_id: userId, _brand_id: brandId },
    );
    if (accessErr) throw new Error(accessErr.message);
    if (!access) throw new Response("Forbidden", { status: 403 });

    let assigned = 0;
    for (const contactId of contactIds) {
      const { data: chosen, error } = await supabaseAdmin.rpc(
        "assign_pipeline_owner",
        {
          p_pipeline_id: pipelineId,
          p_contact_id: contactId,
          p_brand_id: brandId,
        },
      );
      if (error) {
        console.error("[assign_pipeline_owner]", contactId, error.message);
        continue;
      }
      if (chosen) assigned++;
    }
    return { assigned };
  });


export const getPipelineOwners = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        brandId: z.string().uuid(),
        contactIds: z.array(z.string().uuid()).max(5000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { brandId, contactIds } = data;
    const { userId } = context;

    // Verifica acesso à workspace
    const { data: access, error: accessErr } = await supabaseAdmin.rpc(
      "has_brand_access",
      { _user_id: userId, _brand_id: brandId },
    );
    if (accessErr) throw new Error(accessErr.message);
    if (!access) throw new Response("Forbidden", { status: 403 });

    if (contactIds.length === 0) {
      return { owners: [] as Array<{ contact_id: string; assigned_to: string | null; assigned_name: string | null; kind: "user" | "ai"; unread_count: number }> };
    }

    try {
      const map = new Map<string, { assigned_to: string | null; ai_agent_id: string | null; unread_count: number }>();
      const CHUNK = 500;
      for (let i = 0; i < contactIds.length; i += CHUNK) {
        const chunk = contactIds.slice(i, i + CHUNK);
        const { data: rows, error } = await supabaseAdmin
          .from("conversations")
          .select("contact_id, assigned_to, ai_agent_id, unread_count, last_message_at, created_at")
          .eq("brand_id", brandId)
          .in("contact_id", chunk)
          .order("last_message_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .limit(5000);
        if (error) throw new Error(error.message);
        for (const r of rows ?? []) {
          const prev = map.get(r.contact_id as string);
          if (!prev) {
            map.set(r.contact_id as string, {
              assigned_to: (r.assigned_to as string | null) ?? null,
              ai_agent_id: (r.ai_agent_id as string | null) ?? null,
              unread_count: (r.unread_count as number | null) ?? 0,
            });
          }
        }
      }

      const userIds = Array.from(
        new Set(Array.from(map.values()).map((v) => v.assigned_to).filter((x): x is string => !!x)),
      );
      const aiIds = Array.from(
        new Set(Array.from(map.values()).map((v) => v.ai_agent_id).filter((x): x is string => !!x)),
      );
      const nameById = new Map<string, string | null>();
      if (userIds.length > 0) {
        const { data: profs, error: profErr } = await supabaseAdmin
          .from("profiles")
          .select("id, full_name")
          .in("id", userIds);
        if (profErr) throw new Error(profErr.message);
        for (const p of profs ?? []) {
          nameById.set(p.id as string, (p.full_name as string | null) ?? null);
        }
      }
      const aiNameById = new Map<string, string | null>();
      if (aiIds.length > 0) {
        const { data: ais, error: aiErr } = await supabaseAdmin
          .from("ai_agents")
          .select("id, name")
          .in("id", aiIds);
        if (aiErr) throw new Error(aiErr.message);
        for (const a of ais ?? []) {
          aiNameById.set(a.id as string, (a.name as string | null) ?? null);
        }
      }

      const owners = Array.from(map.entries()).map(([contact_id, v]) => {
        if (v.assigned_to) {
          return {
            contact_id,
            assigned_to: v.assigned_to,
            assigned_name: nameById.get(v.assigned_to) ?? null,
            kind: "user" as const,
            unread_count: v.unread_count,
          };
        }
        if (v.ai_agent_id) {
          return {
            contact_id,
            assigned_to: v.ai_agent_id,
            assigned_name: aiNameById.get(v.ai_agent_id) ?? null,
            kind: "ai" as const,
            unread_count: v.unread_count,
          };
        }
        return { contact_id, assigned_to: null, assigned_name: null, kind: "user" as const, unread_count: v.unread_count };
      });

      return { owners };
    } catch (e) {
      console.error("[getPipelineOwners] fetch failed:", (e as Error).message);
      return {
        owners: [] as Array<{ contact_id: string; assigned_to: string | null; assigned_name: string | null; kind: "user" | "ai"; unread_count: number }>,
        error: "SERVICE_UNAVAILABLE" as const,
        fallback: true as const,
      };
    }
  });
