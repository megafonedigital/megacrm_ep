import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listQuickReplies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("user_quick_replies")
      .select("id, title, content, position, updated_at")
      .eq("user_id", userId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return { items: data ?? [] };
  });

export const createQuickReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      title: z.string().trim().max(80).optional().nullable(),
      content: z.string().trim().min(1).max(2000),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: maxRow } = await supabase
      .from("user_quick_replies")
      .select("position")
      .eq("user_id", userId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextPos = (maxRow?.position ?? 0) + 1;
    const { data: row, error } = await supabase
      .from("user_quick_replies")
      .insert({
        user_id: userId,
        title: data.title?.trim() || null,
        content: data.content,
        position: nextPos,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row!.id as string };
  });

export const updateQuickReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      id: z.string().uuid(),
      title: z.string().trim().max(80).optional().nullable(),
      content: z.string().trim().min(1).max(2000),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("user_quick_replies")
      .update({ title: data.title?.trim() || null, content: data.content })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteQuickReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("user_quick_replies").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
