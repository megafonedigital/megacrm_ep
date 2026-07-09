import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  contactId: z.string().uuid(),
  brandId: z.string().uuid(),
  limit: z.number().int().min(1).max(200).optional(),
});

export type TimelineItemKind =
  | "message"
  | "template"
  | "ai"
  | "pipeline"
  | "tag"
  | "assignment"
  | "status"
  | "automation"
  | "integration";

export interface TimelineItem {
  id: string;
  kind: TimelineItemKind;
  at: string;
  actor: { name: string; avatar_url: string | null } | null;
  via?: { kind: "automation" | "ai_agent" | "integration"; label: string };
  title: string;
  detail?: string;
}

type Profile = { id: string; full_name: string | null; avatar_url: string | null } | null;

function actorFromProfile(p: Profile): TimelineItem["actor"] {
  if (!p) return null;
  return { name: p.full_name || "Usuário", avatar_url: p.avatar_url };
}

export const getContactTimeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }): Promise<{ items: TimelineItem[] }> => {
    const { supabase } = context;
    const { contactId, brandId } = data;
    const limit = data.limit ?? 100;

    // Conversas do contato (para messages e conversation_events)
    const { data: convs } = await supabase
      .from("conversations")
      .select("id")
      .eq("contact_id", contactId)
      .eq("brand_id", brandId);
    const convIds = (convs ?? []).map((c) => c.id as string);

    const [
      msgsRes,
      pipeRes,
      tagRes,
      convEvRes,
      autoRes,
      intRes,
    ] = await Promise.all([
      convIds.length
        ? supabase
            .from("messages")
            .select(
              "id, conversation_id, direction, type, content, template_name, sent_by, raw, created_at, channel:brand_channels!channel_id(name), sender:profiles!sent_by(id, full_name, avatar_url)",
            )
            .in("conversation_id", convIds)
            .order("created_at", { ascending: false })
            .limit(limit)
        : Promise.resolve({ data: [] as any[] }),
      supabase
        .from("pipeline_contact_events")
        .select(
          "id, event_type, created_at, pipeline:pipelines!pipeline_id(name), from_stage:pipeline_stages!from_stage_id(name,color), to_stage:pipeline_stages!to_stage_id(name,color), actor:profiles!actor_id(id, full_name, avatar_url)",
        )
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase
        .from("contact_tag_events")
        .select(
          "id, event_type, tag_name, created_at, actor:profiles!actor_id(id, full_name, avatar_url)",
        )
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false })
        .limit(limit),
      convIds.length
        ? supabase
            .from("conversation_events")
            .select(
              "id, event_type, payload, created_at, actor:profiles!actor_id(id, full_name, avatar_url)",
            )
            .in("conversation_id", convIds)
            .order("created_at", { ascending: false })
            .limit(limit)
        : Promise.resolve({ data: [] as any[] }),
      supabase
        .from("automation_runs")
        .select(
          "id, status, started_at, finished_at, automation:automations!automation_id(name, created_by, author:profiles!created_by(id, full_name, avatar_url))",
        )
        .eq("contact_id", contactId)
        .eq("brand_id", brandId)
        .order("started_at", { ascending: false })
        .limit(limit),
      supabase
        .from("integration_events")
        .select(
          "id, event_type, created_at, account:integration_accounts!account_id(name, platform)",
        )
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false })
        .limit(limit),
    ]);

    const items: TimelineItem[] = [];

    // Messages
    for (const m of (msgsRes.data ?? []) as any[]) {
      if (m.direction !== "outbound") continue; // entradas são do contato, não autoria interna
      const via = (m.raw as any)?.via as
        | { kind: "automation" | "ai_agent" | "integration"; id?: string; name?: string }
        | undefined;
      const channelName = m.channel?.name as string | undefined;
      let kind: TimelineItemKind = "message";
      let title: string;
      let actor: TimelineItem["actor"] = actorFromProfile(m.sender as Profile);
      const viaLabel = via
        ? {
            kind: via.kind,
            label:
              via.kind === "automation"
                ? `Automação: ${via.name ?? ""}`.trim()
                : via.kind === "ai_agent"
                  ? `Agente IA: ${via.name ?? ""}`.trim()
                  : `Integração: ${via.name ?? ""}`.trim(),
          }
        : undefined;

      if (m.template_name) {
        kind = "template";
        const who = actor?.name ?? "Sistema";
        title = `${who} enviou template **${m.template_name}**${channelName ? ` via ${channelName}` : ""}`;
      } else if (via?.kind === "ai_agent") {
        kind = "ai";
        actor = actor ?? { name: via.name ?? "Agente IA", avatar_url: null };
        title = `${actor.name} respondeu${channelName ? ` via ${channelName}` : ""}`;
      } else {
        const who = actor?.name ?? "Sistema";
        const typeLabel =
          m.type === "image"
            ? "imagem"
            : m.type === "audio"
              ? "áudio"
              : m.type === "video"
                ? "vídeo"
                : m.type === "document"
                  ? "documento"
                  : "mensagem";
        title = `${who} enviou ${typeLabel}${channelName ? ` via ${channelName}` : ""}`;
      }

      const detail =
        m.content && typeof m.content === "string"
          ? m.content.length > 140
            ? m.content.slice(0, 140) + "…"
            : m.content
          : undefined;

      items.push({
        id: `msg-${m.id}`,
        kind,
        at: m.created_at,
        actor,
        via: viaLabel,
        title,
        detail,
      });
    }

    // Pipeline events
    for (const e of (pipeRes.data ?? []) as any[]) {
      const actor = actorFromProfile(e.actor as Profile);
      const who = actor?.name ?? "Sistema";
      const pname = e.pipeline?.name ?? "pipeline";
      const fromName = e.from_stage?.name;
      const toName = e.to_stage?.name;
      let title: string;
      switch (e.event_type) {
        case "added":
          title = `${who} adicionou em **${pname}** → *${toName ?? "etapa"}*`;
          break;
        case "moved":
          title = `${who} moveu em **${pname}**: *${fromName ?? "—"}* → *${toName ?? "—"}*`;
          break;
        case "resolved":
          title = `${who} marcou como resolvido em **${pname}**`;
          break;
        case "reopened":
          title = `${who} reabriu em **${pname}**`;
          break;
        case "removed":
          title = `${who} removeu de **${pname}**${fromName ? ` (estava em *${fromName}*)` : ""}`;
          break;
        default:
          title = `${who} atualizou em **${pname}**`;
      }
      items.push({ id: `pipe-${e.id}`, kind: "pipeline", at: e.created_at, actor, title });
    }

    // Tag events
    for (const e of (tagRes.data ?? []) as any[]) {
      const actor = actorFromProfile(e.actor as Profile);
      const who = actor?.name ?? "Sistema";
      const verb = e.event_type === "added" ? "adicionou" : "removeu";
      items.push({
        id: `tag-${e.id}`,
        kind: "tag",
        at: e.created_at,
        actor,
        title: `${who} ${verb} a tag **${e.tag_name}**`,
      });
    }

    // Conversation events (assignment + status)
    for (const e of (convEvRes.data ?? []) as any[]) {
      const actor = actorFromProfile(e.actor as Profile);
      const who = actor?.name ?? "Sistema";
      const p = e.payload ?? {};
      let kind: TimelineItemKind = "assignment";
      let title = `${who} atualizou a conversa`;
      switch (e.event_type) {
        case "assigned":
          kind = "assignment";
          title = `${who} atribuiu a conversa${p.to_name ? ` para **${p.to_name}**` : ""}`;
          break;
        case "unassigned":
          kind = "assignment";
          title = `${who} desatribuiu a conversa`;
          break;
        case "transferred":
          kind = "assignment";
          title = `${who} transferiu a conversa${p.to_name ? ` para **${p.to_name}**` : ""}`;
          break;
        case "closed":
        case "resolved":
          kind = "status";
          title = `${who} fechou a conversa`;
          break;
        case "reopened":
          kind = "status";
          title = `${who} reabriu a conversa`;
          break;
        default:
          continue; // ignora eventos sem rótulo amigável
      }
      items.push({ id: `cev-${e.id}`, kind, at: e.created_at, actor, title });
    }

    // Automations
    for (const r of (autoRes.data ?? []) as any[]) {
      const author = actorFromProfile(r.automation?.author as Profile);
      const name = r.automation?.name ?? "Automação";
      const statusLabel =
        r.status === "completed"
          ? "concluída"
          : r.status === "failed"
            ? "falhou"
            : r.status === "running"
              ? "em execução"
              : "iniciada";
      items.push({
        id: `auto-${r.id}`,
        kind: "automation",
        at: r.started_at,
        actor: author,
        via: { kind: "automation", label: `Automação: ${name}` },
        title: `Automação **${name}** ${statusLabel}`,
      });
    }

    // Integrations
    for (const e of (intRes.data ?? []) as any[]) {
      const platform = e.account?.platform ?? "integração";
      const accName = e.account?.name ?? "";
      items.push({
        id: `int-${e.id}`,
        kind: "integration",
        at: e.created_at,
        actor: null,
        via: { kind: "integration", label: `Integração: ${accName || platform}` },
        title: `${platform} — ${e.event_type}`,
      });
    }

    items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return { items: items.slice(0, limit) };
  });
