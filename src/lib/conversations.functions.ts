import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const ensureContactConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        brandId: z.string().uuid(),
        contactId: z.string().uuid(),
        channelId: z.string().uuid().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { brandId, contactId, channelId: requestedChannelId } = data;
    const { userId } = context;

    // Verifica acesso à workspace
    const { data: access, error: accessErr } = await supabaseAdmin.rpc(
      "has_brand_access",
      { _user_id: userId, _brand_id: brandId },
    );
    if (accessErr) throw new Error(accessErr.message);
    if (!access) throw new Response("Forbidden", { status: 403 });

    // 1. Já existe conversa? Retorna a mais recente.
    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("conversations")
      .select("id, channel_id")
      .eq("brand_id", brandId)
      .eq("contact_id", contactId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1);
    if (existingErr) throw new Error(existingErr.message);
    if (existing && existing.length > 0) {
      const c = existing[0];
      return {
        conversationId: c.id as string,
        channelId: c.channel_id as string,
        created: false as const,
      };
    }

    // 2. Resolver canal
    let channelId: string | null = null;
    if (requestedChannelId) {
      const { data: ch, error: chErr } = await supabaseAdmin
        .from("brand_channels")
        .select("id, active, phone_number_id, brand_id")
        .eq("id", requestedChannelId)
        .maybeSingle();
      if (chErr) throw new Error(chErr.message);
      if (!ch || ch.brand_id !== brandId) {
        throw new Error("Canal inválido para este workspace.");
      }
      if (!ch.active || !ch.phone_number_id) {
        throw new Error("Canal inativo ou sem número configurado.");
      }
      channelId = ch.id as string;
    } else {
      const { data: channels, error: chErr } = await supabaseAdmin
        .from("brand_channels")
        .select("id, name, phone_number, type, active, phone_number_id")
        .eq("brand_id", brandId)
        .eq("active", true)
        .not("phone_number_id", "is", null)
        .order("created_at", { ascending: true });
      if (chErr) throw new Error(chErr.message);
      const usable = (channels ?? []).filter((c) => !!c.phone_number_id);
      if (usable.length === 0) {
        throw new Error(
          "Nenhum canal ativo neste workspace. Configure um canal para iniciar conversas.",
        );
      }
      if (usable.length > 1) {
        return {
          needsChannel: true as const,
          channels: usable.map((c) => ({
            id: c.id as string,
            name: c.name as string,
            phone_number: (c.phone_number as string | null) ?? null,
            type: c.type as string,
          })),
        };
      }
      channelId = usable[0].id as string;
    }

    const assignedTo = userId;

    // 4. Insere conversa "vazia" (last_message_at = null → não aparece no Inbox)
    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("conversations")
      .insert({
        brand_id: brandId,
        contact_id: contactId,
        channel_id: channelId!,
        status: "aberto",
        assigned_to: assignedTo,
        unread_count: 0,
      })
      .select("id, channel_id")
      .single();
    if (insErr) throw new Error(insErr.message);

    return {
      conversationId: inserted.id as string,
      channelId: inserted.channel_id as string,
      created: true as const,
    };
  });
