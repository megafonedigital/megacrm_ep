import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  SNAPSHOT_FIELDS,
  assertAgentAccess,
  createVersionSnapshotInternal,
} from "@/lib/ai-agent-versions.server";


export const listAgentVersions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ agentId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAgentAccess(context.userId, data.agentId);
    const { data: rows, error } = await supabaseAdmin
      .from("ai_agent_versions")
      .select("id, version_number, label, notes, source, system_prompt, model, temperature, max_output_tokens, response_delay_ms, context_window_messages, inputs, created_by, created_at")
      .eq("agent_id", data.agentId)
      .order("version_number", { ascending: false });
    if (error) throw new Error(error.message);

    const userIds = Array.from(
      new Set((rows ?? []).map((r) => r.created_by).filter((v): v is string => !!v)),
    );
    let authors: Record<string, { full_name: string | null; email: string | null }> = {};
    if (userIds.length > 0) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds);
      authors = Object.fromEntries(
        (profs ?? []).map((p) => [p.id as string, { full_name: p.full_name as string | null, email: p.email as string | null }]),
      );
    }

    return {
      versions: (rows ?? []).map((r) => ({
        ...r,
        author: r.created_by ? authors[r.created_by as string] ?? null : null,
      })),
    };
  });

export const createAgentVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      agentId: z.string().uuid(),
      label: z.string().max(120).optional(),
      notes: z.string().max(2000).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAgentAccess(context.userId, data.agentId);
    const v = await createVersionSnapshotInternal({
      agentId: data.agentId,
      userId: context.userId,
      source: "manual",
      label: data.label ?? null,
      notes: data.notes ?? null,
    });
    return v;
  });

export const restoreAgentVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ versionId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: ver, error } = await supabaseAdmin
      .from("ai_agent_versions")
      .select("*")
      .eq("id", data.versionId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!ver) throw new Response("Versão não encontrada", { status: 404 });
    await assertAgentAccess(context.userId, ver.agent_id as string);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = ver as any;
    const patch: Record<string, unknown> = {};
    for (const f of SNAPSHOT_FIELDS) patch[f] = v[f];

    const { error: e2 } = await supabaseAdmin
      .from("ai_agents")
      .update(patch as never)
      .eq("id", ver.agent_id as string);
    if (e2) throw new Error(e2.message);

    const snap = await createVersionSnapshotInternal({
      agentId: ver.agent_id as string,
      userId: context.userId,
      source: "restore",
      label: `Restaurada de v${v.version_number}`,
      notes: null,
    });
    return { ok: true, newVersionNumber: snap.versionNumber };
  });
