import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Loader2,
  MessageSquare,
  FileText,
  KanbanSquare,
  Tag as TagIcon,
  UserCheck,
  Power,
  Bot,
  Plug,
} from "lucide-react";

import { getContactTimeline, type TimelineItem, type TimelineItemKind } from "@/lib/contact-timeline.functions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { avatarColor } from "@/lib/avatar-color";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const KIND_META: Record<
  TimelineItemKind,
  { label: string; icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  message: { label: "Mensagens", icon: MessageSquare, color: "text-blue-600" },
  template: { label: "Templates", icon: FileText, color: "text-violet-600" },
  ai: { label: "Agente IA", icon: Bot, color: "text-fuchsia-600" },
  pipeline: { label: "Pipeline", icon: KanbanSquare, color: "text-emerald-600" },
  tag: { label: "Tags", icon: TagIcon, color: "text-amber-600" },
  assignment: { label: "Atribuição", icon: UserCheck, color: "text-sky-600" },
  status: { label: "Status", icon: Power, color: "text-rose-600" },
  automation: { label: "Automação", icon: Bot, color: "text-indigo-600" },
  integration: { label: "Integração", icon: Plug, color: "text-orange-600" },
};

const ALL_KINDS = Object.keys(KIND_META) as TimelineItemKind[];

function renderTitle(title: string) {
  // Suporta **negrito** e *itálico* simples para textos vindos do servidor
  const parts: Array<{ t: "b" | "i" | "s"; v: string }> = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(title)) !== null) {
    if (m.index > last) parts.push({ t: "s", v: title.slice(last, m.index) });
    const seg = m[0];
    if (seg.startsWith("**")) parts.push({ t: "b", v: seg.slice(2, -2) });
    else parts.push({ t: "i", v: seg.slice(1, -1) });
    last = m.index + seg.length;
  }
  if (last < title.length) parts.push({ t: "s", v: title.slice(last) });
  return parts.map((p, i) =>
    p.t === "b" ? (
      <strong key={i} className="font-semibold text-foreground">{p.v}</strong>
    ) : p.t === "i" ? (
      <em key={i} className="not-italic text-foreground">{p.v}</em>
    ) : (
      <span key={i}>{p.v}</span>
    ),
  );
}

function actorInitials(name: string) {
  return name
    .split(" ")
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function ContactTimeline({ contactId, brandId }: { contactId: string; brandId: string }) {
  const fetchTimeline = useServerFn(getContactTimeline);
  const [enabled, setEnabled] = useState<Set<TimelineItemKind>>(new Set(ALL_KINDS));

  const q = useQuery({
    queryKey: ["contact-timeline", contactId, brandId],
    queryFn: () => fetchTimeline({ data: { contactId, brandId, limit: 150 } }),
  });

  const items: TimelineItem[] = useMemo(
    () => (q.data?.items ?? []).filter((it) => enabled.has(it.kind)),
    [q.data, enabled],
  );

  const toggle = (k: TimelineItemKind) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      // garante ao menos 1 filtro ativo
      if (next.size === 0) return new Set(ALL_KINDS);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {ALL_KINDS.map((k) => {
          const meta = KIND_META[k];
          const Icon = meta.icon;
          const on = enabled.has(k);
          return (
            <Button
              key={k}
              type="button"
              size="sm"
              variant={on ? "secondary" : "outline"}
              className={cn("h-7 gap-1.5 text-xs", !on && "opacity-60")}
              onClick={() => toggle(k)}
            >
              <Icon className={cn("h-3.5 w-3.5", on && meta.color)} />
              {meta.label}
            </Button>
          );
        })}
      </div>

      {q.isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          Nenhuma atividade registrada ainda.
        </p>
      ) : (
        <TooltipProvider delayDuration={200}>
          <ol className="relative space-y-3 border-l border-border pl-5">
            {items.map((it) => {
              const meta = KIND_META[it.kind];
              const Icon = meta.icon;
              return (
                <li key={it.id} className="relative">
                  <span
                    className={cn(
                      "absolute -left-[26px] top-1 flex h-5 w-5 items-center justify-center rounded-full bg-background ring-2 ring-border",
                      meta.color,
                    )}
                  >
                    <Icon className="h-3 w-3" />
                  </span>
                  <div className="flex items-start gap-2.5 rounded-md border border-border/60 bg-card p-2.5 text-sm">
                    <Avatar className="h-7 w-7 shrink-0">
                      {it.actor?.avatar_url && <AvatarImage src={it.actor.avatar_url} />}
                      <AvatarFallback className={`text-[10px] ${it.actor ? avatarColor(it.actor.name) : "bg-muted text-muted-foreground"}`}>
                        {it.actor ? actorInitials(it.actor.name) : "SIS"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="min-w-0 leading-snug">
                          {renderTitle(it.title)}
                        </div>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(it.at), {
                                addSuffix: true,
                                locale: ptBR,
                              })}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {new Date(it.at).toLocaleString("pt-BR")}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      {it.via && (
                        <Badge variant="outline" className="mt-1 text-[10px] font-normal">
                          {it.via.label}
                        </Badge>
                      )}
                      {it.detail && (
                        <p className="mt-1 line-clamp-3 text-xs text-muted-foreground whitespace-pre-wrap">
                          {it.detail}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </TooltipProvider>
      )}
    </div>
  );
}

export function ContactTimelineCompact({
  contactId,
  brandId,
  limit = 20,
}: {
  contactId: string;
  brandId: string;
  limit?: number;
}) {
  const fetchTimeline = useServerFn(getContactTimeline);
  const q = useQuery({
    queryKey: ["contact-timeline-compact", contactId, brandId, limit],
    queryFn: () => fetchTimeline({ data: { contactId, brandId, limit } }),
  });

  if (q.isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-2 animate-pulse">
            <div className="h-5 w-5 rounded-full bg-muted shrink-0" />
            <div className="flex-1 space-y-1">
              <div className="h-3 w-3/4 rounded bg-muted" />
              <div className="h-2 w-1/2 rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const items = q.data?.items ?? [];
  if (items.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">Nenhuma atividade registrada ainda.</p>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <ol className="relative space-y-2.5 border-l border-border pl-4">
        {items.map((it) => {
          const meta = KIND_META[it.kind];
          const Icon = meta.icon;
          return (
            <li key={it.id} className="relative">
              <span
                className={cn(
                  "absolute -left-[21px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-background ring-2 ring-border",
                  meta.color,
                )}
              >
                <Icon className="h-2.5 w-2.5" />
              </span>
              <div className="flex items-start gap-2">
                <Avatar className="h-5 w-5 shrink-0">
                  {it.actor?.avatar_url && <AvatarImage src={it.actor.avatar_url} />}
                  <AvatarFallback className={`text-[8px] ${it.actor ? avatarColor(it.actor.name) : "bg-muted text-muted-foreground"}`}>
                    {it.actor ? actorInitials(it.actor.name) : "SIS"}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 text-xs leading-snug">
                  <div className="break-words">{renderTitle(it.title)}</div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-[10px] text-muted-foreground">
                        {formatDistanceToNow(new Date(it.at), {
                          addSuffix: true,
                          locale: ptBR,
                        })}
                        {it.via ? ` · ${it.via.label}` : ""}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {new Date(it.at).toLocaleString("pt-BR")}
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </TooltipProvider>
  );
}
