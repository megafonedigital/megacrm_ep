import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const SNAPSHOT_FIELDS = [
  "system_prompt",
  "model",
  "temperature",
  "max_output_tokens",
  "response_delay_ms",
  "context_window_messages",
  "escalation_target_suporte",
  "escalation_target_vendas",
  "inputs",
  "rate_limit_per_conversation",
  "rate_limit_window_minutes",
  "rate_limit_per_agent_hour",
] as const;

export async function assertAgentAccess(userId: string, agentId: string) {
  const { data: agent, error } = await supabaseAdmin
    .from("ai_agents")
    .select("*")
    .eq("id", agentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!agent) throw new Response("Not found", { status: 404 });
  const { data: ok, error: e2 } = await supabaseAdmin.rpc("has_brand_access", {
    _user_id: userId,
    _brand_id: agent.brand_id as string,
  });
  if (e2) throw new Error(e2.message);
  if (!ok) throw new Response("Forbidden", { status: 403 });
  return agent as Record<string, unknown>;
}

/**
 * Cria um snapshot da configuração atual do agente em ai_agent_versions.
 */
export async function createVersionSnapshotInternal(opts: {
  agentId: string;
  userId: string | null;
  source: "manual" | "auto_prompt_change" | "restore";
  label?: string | null;
  notes?: string | null;
}) {
  const { data: agent, error } = await supabaseAdmin
    .from("ai_agents")
    .select("*")
    .eq("id", opts.agentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!agent) throw new Error("Agente não encontrado");

  const { data: maxRow } = await supabaseAdmin
    .from("ai_agent_versions")
    .select("version_number")
    .eq("agent_id", opts.agentId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = ((maxRow?.version_number as number | undefined) ?? 0) + 1;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = agent as any;
  const payload = {
    agent_id: opts.agentId,
    brand_id: a.brand_id,
    version_number: nextVersion,
    label: opts.label ?? null,
    notes: opts.notes ?? null,
    source: opts.source,
    system_prompt: a.system_prompt ?? "",
    model: a.model,
    temperature: a.temperature,
    max_output_tokens: a.max_output_tokens,
    response_delay_ms: a.response_delay_ms,
    context_window_messages: a.context_window_messages,
    escalation_target_suporte: a.escalation_target_suporte ?? null,
    escalation_target_vendas: a.escalation_target_vendas ?? null,
    inputs: a.inputs ?? [],
    rate_limit_per_conversation: a.rate_limit_per_conversation ?? 30,
    rate_limit_window_minutes: a.rate_limit_window_minutes ?? 60,
    rate_limit_per_agent_hour: a.rate_limit_per_agent_hour ?? null,
    created_by: opts.userId,
  };

  const { data: row, error: e2 } = await supabaseAdmin
    .from("ai_agent_versions")
    .insert(payload)
    .select("id, version_number")
    .single();
  if (e2) throw new Error(e2.message);

  await supabaseAdmin
    .from("ai_agents")
    .update({ current_version_id: row!.id })
    .eq("id", opts.agentId);

  return { id: row!.id as string, versionNumber: row!.version_number as number };
}
