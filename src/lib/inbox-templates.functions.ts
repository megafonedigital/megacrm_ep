import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Lista os channel_id elegíveis para listar templates HSM no picker do Inbox.
 *
 * Templates da Meta são vinculados à WABA. Quando o workspace tem múltiplos
 * canais compartilhando o mesmo waba_id, queremos mostrar templates de todos
 * os canais irmãos — não apenas o canal da conversa atual.
 *
 * Roda com a sessão do usuário (RLS aplica via has_brand_access), mas usa
 * supabaseAdmin para ler `brand_channels` mesmo quando o agente não tem
 * channel_agents nos canais irmãos. Antes disso, verifica explicitamente
 * has_brand_access do workspace.
 */
export const listBrandTemplateChannelIds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        brandId: z.string().uuid(),
        currentChannelId: z.string().uuid().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { brandId, currentChannelId } = data;
    const { supabase, userId } = context;

    const { data: access, error: accessErr } = await supabase.rpc(
      "has_brand_access",
      { _user_id: userId, _brand_id: brandId },
    );
    if (accessErr) throw new Error(accessErr.message);
    if (!access) throw new Response("Sem acesso a este workspace", { status: 403 });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Descobre waba_id do canal atual (se informado).
    let wabaId: string | null = null;
    if (currentChannelId) {
      const { data: current, error: curErr } = await supabaseAdmin
        .from("brand_channels")
        .select("waba_id")
        .eq("id", currentChannelId)
        .maybeSingle();
      if (curErr) throw new Error(curErr.message);
      wabaId = current?.waba_id ?? null;
    }

    // Lista canais elegíveis: todos os canais da brand que compartilham a waba_id.
    // Se não há waba_id (canal sem WABA ou conversa sem channel_id), devolve
    // todos os canais da brand — RLS de whatsapp_templates ainda filtra por brand.
    let q = supabaseAdmin.from("brand_channels").select("id").eq("brand_id", brandId);
    if (wabaId) q = q.eq("waba_id", wabaId);
    const { data: rows, error: rowsErr } = await q;
    if (rowsErr) throw new Error(rowsErr.message);

    const channelIds = (rows ?? []).map((r) => r.id);
    return { channelIds };
  });
