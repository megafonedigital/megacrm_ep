import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const searchPipelineContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        pipelineId: z.string().uuid(),
        search: z.string().default(""),
        limit: z.number().int().min(1).max(50).default(20),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { pipelineId, search, limit } = data;
    const { userId } = context;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Busca + visibilidade aplicadas em uma única consulta SQL no banco.
    // Usa o mesmo critério do RLS (can_view_contact_assignment) e não sofre
    // do limite padrão de 1000 linhas do PostgREST.
    const { data: rows, error } = await supabaseAdmin.rpc(
      "search_pipeline_contacts",
      {
        _user_id: userId,
        _pipeline_id: pipelineId,
        _search: (search ?? "").trim(),
        _limit: limit,
      },
    );
    if (error) throw new Error(error.message);

    return {
      contacts: ((rows ?? []) as Array<{
        id: string;
        name: string | null;
        profile_name: string | null;
        phone: string | null;
        wa_id: string;
      }>).map((c) => ({
        id: c.id,
        name: c.name ?? null,
        profile_name: c.profile_name ?? null,
        phone: c.phone ?? null,
        wa_id: c.wa_id,
      })),
    };
  });

export const getPipelineContactById = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        pipelineId: z.string().uuid(),
        contactId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { pipelineId, contactId } = data;
    const { userId } = context;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: pipe } = await supabaseAdmin
      .from("pipelines")
      .select("id, brand_id")
      .eq("id", pipelineId)
      .maybeSingle();
    if (!pipe) return { contact: null };

    const { data: access } = await supabaseAdmin.rpc("has_brand_access", {
      _user_id: userId,
      _brand_id: pipe.brand_id as string,
    });
    if (!access) return { contact: null };

    const { data: c } = await supabaseAdmin
      .from("contacts")
      .select("id, name, profile_name, phone, wa_id")
      .eq("id", contactId)
      .maybeSingle();
    return { contact: c ?? null };
  });
