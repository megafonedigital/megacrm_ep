import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertRole(supabase: any, userId: string) {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "supervisor", "developer"]);
  if (!data || data.length === 0) {
    throw new Response("Forbidden: copilot é para admin, supervisor ou desenvolvedor.", { status: 403 });
  }
}

export const listCopilotThreads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ brandId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertRole(context.supabase, context.userId);
    const { data: rows, error } = await context.supabase
      .from("copilot_threads")
      .select("id, title, last_message_at, created_at")
      .eq("brand_id", data.brandId)
      .eq("user_id", context.userId)
      .order("last_message_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const createCopilotThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ brandId: z.string().uuid(), title: z.string().max(200).optional() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertRole(context.supabase, context.userId);
    const { data: row, error } = await context.supabase
      .from("copilot_threads")
      .insert({
        user_id: context.userId,
        brand_id: data.brandId,
        title: data.title ?? "Nova conversa",
      })
      .select("id, title, last_message_at, created_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const getCopilotMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ threadId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertRole(context.supabase, context.userId);
    const { data: rows, error } = await context.supabase
      .from("copilot_messages")
      .select("id, sdk_message_id, role, parts, created_at, seq")
      .eq("thread_id", data.threadId)
      .order("seq", { ascending: true });
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({
      id: r.sdk_message_id ?? r.id,
      role: r.role,
      parts: r.parts,
      created_at: r.created_at,
    }));
  });


export const renameCopilotThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ threadId: z.string().uuid(), title: z.string().min(1).max(200) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertRole(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("copilot_threads")
      .update({ title: data.title })
      .eq("id", data.threadId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteCopilotThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ threadId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertRole(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("copilot_threads")
      .delete()
      .eq("id", data.threadId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveCopilotAssistantMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        threadId: z.string().uuid(),
        sdkMessageId: z.string().min(1),
        parts: z.array(z.any()),
        aborted: z.boolean().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertRole(context.supabase, context.userId);

    // Verifica ownership da thread
    const { data: thread, error: thErr } = await context.supabase
      .from("copilot_threads")
      .select("id, user_id")
      .eq("id", data.threadId)
      .maybeSingle();
    if (thErr) throw new Error(thErr.message);
    if (!thread || thread.user_id !== context.userId) {
      throw new Response("Thread not found", { status: 404 });
    }

    // Acrescenta marcador "_Interrompida._" na última text part quando abortada
    let parts = data.parts as any[];
    if (data.aborted) {
      parts = parts.map((p) => ({ ...p }));
      let lastTextIdx = -1;
      parts.forEach((p, i) => {
        if (p?.type === "text") lastTextIdx = i;
      });
      if (lastTextIdx >= 0) {
        const t = parts[lastTextIdx] as { type: "text"; text: string };
        if (!t.text?.includes("_Interrompida._")) {
          t.text = `${t.text ?? ""}\n\n_Interrompida._`;
        }
      } else {
        parts.push({ type: "text", text: "_Interrompida._" });
      }
    }

    const { error: upErr } = await context.supabase
      .from("copilot_messages")
      .upsert(
        {
          thread_id: data.threadId,
          sdk_message_id: data.sdkMessageId,
          role: "assistant",
          parts: parts as any,
        },
        { onConflict: "thread_id,sdk_message_id" },
      );
    if (upErr) throw new Error(upErr.message);
    return { ok: true };
  });
