import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/auth";
import { transferConversation } from "@/lib/conversations-transfer.functions";
import { listBrandTemplateChannelIds } from "@/lib/inbox-templates.functions";
import { useActiveBrand } from "@/lib/active-brand";
import { usePresenceHeartbeat } from "@/lib/presence";
import { useRealtimeInbox } from "@/lib/realtime";
import { callFunction, uploadMedia } from "@/lib/api";
import { formatActivity } from "@/lib/integration-event-labels";
import { formatPhoneDisplay, formatContactPhone, isPseudoPhone } from "@/lib/phone";
import { resolveBinding } from "@/lib/template-bindings";
import { EscalationReviewBanner } from "@/components/conversations/EscalationReviewBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  Paperclip, Send, Search, Inbox as InboxIcon, X,
  MoreVertical, UserPlus, ArrowRightLeft, CheckCircle2,
  Phone, Mail, MapPin, Tag, FileText, Image as ImageIcon, Mic,
  Reply, Zap, PanelRightOpen, PanelRightClose, Pencil, Check, User as UserIcon, Link2,
  ChevronRight, ChevronDown, Workflow, ShieldOff, CalendarClock, History, Bot,
} from "lucide-react";
import { ConversationHistorySheet } from "@/components/inbox/ConversationHistorySheet";
import { AppointmentFormDialog } from "@/components/agenda/AppointmentFormDialog";
import { ContactAppointmentsList } from "@/components/agenda/ContactAppointmentsList";
import { addContactToBlocklist } from "@/lib/blocklist.functions";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { avatarColor, initials as toInitials } from "@/lib/avatar-color";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ChevronsUpDown } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { MoveToPipelineDialog } from "@/components/pipelines/MoveToPipelineDialog";
import { ContactTimelineCompact } from "@/components/contacts/ContactTimeline";
import { EllieMemoryPanel } from "@/components/inbox/EllieMemoryPanel";
import { EllieStatusBadge } from "@/components/ellie/EllieStatusBadge";
import { isEllie } from "@/lib/ellie";
import { QuickRepliesPopover } from "@/components/inbox/QuickRepliesPopover";

type AssignmentFilter = "all" | "mine" | "unassigned" | "unread";
type StatusFilter = "all" | "aberto" | "pendente" | "resolvido";

export const Route = createFileRoute("/inbox")({
  validateSearch: (search: Record<string, unknown>): { conv?: string } => ({
    conv: typeof search.conv === "string" ? search.conv : undefined,
  }),
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  component: InboxPage,
});

export interface ConversationRow {
  id: string;
  brand_id: string;
  channel_id?: string | null;
  contact_id?: string | null;
  status: string;
  assigned_to: string | null;
  ai_agent_id: string | null;
  last_message_at: string | null;
  window_expires_at: string | null;
  unread_count: number;
  contact: { id?: string; name: string | null; profile_name: string | null; phone: string | null; wa_id: string; metadata?: any } | null;
  brand: { name: string } | null;
  channel?: { name: string; phone_number: string | null; type: string } | null;
}

function InboxPage() {
  usePresenceHeartbeat();
  useRealtimeInbox();
  const { me } = useMe();
  const { activeBrandId } = useActiveBrand();
  const qc = useQueryClient();
  const navigate = useNavigate({ from: "/inbox" });
  const searchParams = Route.useSearch();
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.conv ?? null);

  useEffect(() => {
    if (searchParams.conv && searchParams.conv !== selectedId) {
      setSelectedId(searchParams.conv);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.conv]);

  // Mantém a URL sincronizada com a conversa selecionada para gerar links compartilháveis.
  useEffect(() => {
    if (selectedId === (searchParams.conv ?? null)) return;
    navigate({
      search: (prev) => ({ ...prev, conv: selectedId ?? undefined }),
      replace: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);
  const [assignment, setAssignment] = useState<AssignmentFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("aberto");
  const [userIds, setUserIds] = useState<string[]>([]);
  const [aiAgentIds, setAiAgentIds] = useState<string[]>([]);
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [pipelineIds, setPipelineIds] = useState<string[]>([]);
  const [stageIds, setStageIds] = useState<string[]>([]);
  const [expandedPipelines, setExpandedPipelines] = useState<Set<string>>(new Set());

  async function selectConversation(id: string) {
    setSelectedId(id);
    const conv = (convQuery.data ?? []).find((c) => c.id === id);
    if (conv && (conv.unread_count ?? 0) > 0) {
      const { error } = await supabase.from("conversations").update({ unread_count: 0 }).eq("id", id);
      if (!error) {
        qc.invalidateQueries({ queryKey: ["conversations"] });
        qc.invalidateQueries({ queryKey: ["inbox-overview"] });
        qc.invalidateQueries({ queryKey: ["sidebar-unread"] });
        qc.invalidateQueries({ queryKey: ["pipeline-owners"] });
        qc.invalidateQueries({ queryKey: ["pipeline-board"] });
      }
    }
  }

  const PAGE_SIZE = 100;

  // Quando há filtro de pipeline/stage, primeiro buscamos os contact_ids
  // que pertencem aos pipelines/stages selecionados. Depois usamos esses
  // contact_ids para filtrar `conversations`. Sem filtro de pipeline,
  // a query é null (nenhum filtro extra).
  const sortedPipelineIds = useMemo(() => [...pipelineIds].sort(), [pipelineIds]);
  const sortedStageIds = useMemo(() => [...stageIds].sort(), [stageIds]);

  const pipelineContactIdsQuery = useQuery({
    queryKey: ["inbox-pipeline-contact-ids", activeBrandId, sortedPipelineIds, sortedStageIds],
    enabled: !!activeBrandId && sortedPipelineIds.length > 0,
    queryFn: async () => {
      const MAX = 20000;
      const CHUNK = 1000;
      const ids = new Set<string>();
      let from = 0;
      // paginação simples por range; ordena por id pra ter determinismo
      // suficiente.
      while (ids.size < MAX) {
        let q = supabase
          .from("pipeline_contacts")
          .select("contact_id")
          .eq("brand_id", activeBrandId!)
          .in("pipeline_id", sortedPipelineIds)
          .order("id", { ascending: true })
          .range(from, from + CHUNK - 1);
        if (sortedStageIds.length > 0) q = q.in("stage_id", sortedStageIds);
        const { data, error } = await q;
        if (error) throw error;
        const batch = (data ?? []) as Array<{ contact_id: string }>;
        for (const r of batch) ids.add(r.contact_id);
        if (batch.length < CHUNK) break;
        from += CHUNK;
      }
      return Array.from(ids);
    },
  });

  const sortedUserIds = useMemo(() => [...userIds].sort(), [userIds]);
  const sortedAiAgentIds = useMemo(() => [...aiAgentIds].sort(), [aiAgentIds]);
  const sortedChannelIds = useMemo(() => [...channelIds].sort(), [channelIds]);

  const canSeeAllAssignments = !!me && (me.isAdmin || me.isSupervisor || me.isDeveloper);
  type CursorVal = { ts: string; id: string } | null;
  const convInfinite = useInfiniteQuery({
    queryKey: [
      "conversations",
      me?.userId,
      activeBrandId,
      { status, assignment, userIds: sortedUserIds, aiAgentIds: sortedAiAgentIds, channelIds: sortedChannelIds, pipelineIds: sortedPipelineIds, stageIds: sortedStageIds, scoped: !canSeeAllAssignments, search: debouncedSearch.trim().length >= 2 ? debouncedSearch.trim().toLowerCase() : "" },
    ],
    enabled:
      !!me &&
      !!activeBrandId &&
      (sortedPipelineIds.length === 0 || pipelineContactIdsQuery.isSuccess),
    initialPageParam: null as CursorVal,
    getNextPageParam: (lastPage: { rows: any[]; nextCursor: CursorVal }) => lastPage.nextCursor,
    staleTime: 10_000,
    retry: 1,
    queryFn: async ({ pageParam, signal }) => {
      if (sortedPipelineIds.length > 0) {
        const contactIds = pipelineContactIdsQuery.data ?? [];
        if (contactIds.length === 0) return { rows: [], nextCursor: null as CursorVal };
      }

      // Mapeia sentinela __none__ para os flags do RPC
      const includeNoneUser = sortedUserIds.includes("__none__");
      const concreteUserIds = sortedUserIds.filter((x) => x !== "__none__");
      const includeNoneAi = sortedAiAgentIds.includes("__none__");
      const concreteAiIds = sortedAiAgentIds.filter((x) => x !== "__none__");
      const includeNoneChannel = sortedChannelIds.includes("__none__");
      const concreteChannelIds = sortedChannelIds.filter((x) => x !== "__none__");
      const contactIds = sortedPipelineIds.length > 0 ? (pipelineContactIdsQuery.data ?? []) : null;

      const cursor = pageParam as { ts: string; id: string } | null;

      const { data, error } = await supabase
        .rpc("inbox_list_conversations", {
          p_brand_id: activeBrandId!,
          p_status: status === "all" ? null : status,
          p_assignment: assignment === "all" ? null : assignment,
          p_user_ids: concreteUserIds.length > 0 ? concreteUserIds : null,
          p_include_none_user: includeNoneUser,
          p_ai_agent_ids: concreteAiIds.length > 0 ? concreteAiIds : null,
          p_include_none_ai_agent: includeNoneAi,
          p_contact_ids: contactIds && contactIds.length > 0 ? contactIds : null,
          p_cursor_ts: cursor?.ts ?? null,
          p_cursor_id: cursor?.id ?? null,
          p_limit: PAGE_SIZE,
          p_search: debouncedSearch.trim().length >= 2 ? debouncedSearch.trim() : null,
          p_channel_ids: concreteChannelIds.length > 0 ? concreteChannelIds : null,
          p_include_none_channel: includeNoneChannel,
        } as any)
        .abortSignal(signal);
      if (error) throw error;
      const rows = (data ?? []) as any[];
      const last = rows[rows.length - 1];
      const nextCursor: CursorVal =
        rows.length === PAGE_SIZE && last?.last_message_at && last?.id
          ? { ts: last.last_message_at as string, id: last.id as string }
          : null;
      return { rows, nextCursor };
    },
  });


  // Linhas cruas vindas do servidor (sem embeds)
  const convRows = useMemo(
    () => (convInfinite.data?.pages.flatMap((p) => p.rows) ?? []) as any[],
    [convInfinite.data],
  );

  // IDs únicos para enriquecimento em lote (contatos + canais).
  const visibleContactIds = useMemo(() => {
    const s = new Set<string>();
    for (const r of convRows) if (r.contact_id) s.add(r.contact_id);
    return Array.from(s).sort();
  }, [convRows]);
  const visibleChannelIds = useMemo(() => {
    const s = new Set<string>();
    for (const r of convRows) if (r.channel_id) s.add(r.channel_id);
    return Array.from(s).sort();
  }, [convRows]);

  const contactsByIdQuery = useQuery({
    queryKey: ["inbox-contacts-batch", activeBrandId, visibleContactIds],
    enabled: !!activeBrandId && visibleContactIds.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const map = new Map<string, any>();
      const CHUNK = 200;
      for (let i = 0; i < visibleContactIds.length; i += CHUNK) {
        const slice = visibleContactIds.slice(i, i + CHUNK);
        const { data, error } = await supabase
          .from("contacts")
          .select("id, name, profile_name, phone, wa_id, metadata")
          .in("id", slice);
        if (error) throw error;
        for (const c of (data ?? []) as any[]) map.set(c.id, c);
      }
      return map;
    },
  });

  const channelsByIdQuery = useQuery({
    queryKey: ["inbox-channels-batch", activeBrandId, visibleChannelIds],
    enabled: !!activeBrandId && visibleChannelIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const map = new Map<string, any>();
      const { data, error } = await supabase
        .from("brand_channels")
        .select("id, name, phone_number, type")
        .in("id", visibleChannelIds);
      if (error) throw error;
      for (const c of (data ?? []) as any[]) map.set(c.id, c);
      return map;
    },
  });

  const brandName = useActiveBrand().activeBrand?.name ?? null;

  const convData = useMemo<ConversationRow[]>(() => {
    const contactsMap = contactsByIdQuery.data;
    const channelsMap = channelsByIdQuery.data;
    return convRows.map((r) => {
      const contact = r.contact_id ? contactsMap?.get(r.contact_id) ?? null : null;
      const channel = r.channel_id ? channelsMap?.get(r.channel_id) ?? null : null;
      return {
        ...r,
        contact: contact
          ? {
              id: contact.id,
              name: contact.name ?? null,
              profile_name: contact.profile_name ?? null,
              phone: contact.phone ?? null,
              wa_id: contact.wa_id,
              metadata: contact.metadata ?? null,
            }
          : null,
        brand: brandName ? { name: brandName } : null,
        channel: channel
          ? {
              name: channel.name,
              phone_number: channel.phone_number ?? null,
              type: channel.type,
            }
          : null,
      } as ConversationRow;
    });
  }, [convRows, contactsByIdQuery.data, channelsByIdQuery.data, brandName]);

  // Compat wrapper para o restante do componente que ainda usa convQuery.data / .isLoading
  const convQuery = { data: convData, isLoading: convInfinite.isLoading } as {
    data: ConversationRow[];
    isLoading: boolean;
  };


  const directConvQuery = useQuery({
    queryKey: ["conversation-direct", selectedId, activeBrandId],
    enabled: !!selectedId && !!activeBrandId && !(convQuery.data ?? []).some((c) => c.id === selectedId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select(
          "id, brand_id, channel_id, contact_id, status, assigned_to, ai_agent_id, last_message_at, window_expires_at, unread_count, contact:contacts!conversations_contact_id_fkey(id, name, profile_name, phone, wa_id, metadata), brand:brands!conversations_brand_id_fkey(name), channel:brand_channels!channel_id(name, phone_number, type)"
        )
        .eq("id", selectedId!)
        .eq("brand_id", activeBrandId!)
        .maybeSingle();
      if (error) {
        const r2 = await supabase
          .from("conversations")
          .select("id, brand_id, channel_id, contact_id, status, assigned_to, ai_agent_id, last_message_at, window_expires_at, unread_count")
          .eq("id", selectedId!)
          .eq("brand_id", activeBrandId!)
          .maybeSingle();
        if (r2.error) throw r2.error;
        return r2.data ? ({ ...(r2.data as any), contact: null, brand: null, channel: null } as ConversationRow) : null;
      }
      return (data ?? null) as unknown as ConversationRow | null;
    },
  });


  // Workspaces são isolados: NÃO trocar workspace automaticamente.
  // Se a conversa pertencer a outro workspace, o painel direito mostra um aviso.


  const agentsQuery = useQuery({
    queryKey: ["agents-for-filter", activeBrandId],
    enabled: !!activeBrandId,
    queryFn: async () => {
      const { data: channels, error: chErr } = await supabase
        .from("brand_channels")
        .select("id")
        .eq("brand_id", activeBrandId!);
      if (chErr) throw chErr;
      const channelIds = (channels ?? []).map((c) => c.id);
      const [agentsRes, adminsRes] = await Promise.all([
        channelIds.length
          ? supabase.from("channel_agents").select("user_id").in("channel_id", channelIds)
          : Promise.resolve({ data: [] as Array<{ user_id: string }>, error: null }),
        supabase.from("user_roles").select("user_id").eq("role", "admin"),
      ]);
      if (agentsRes.error) throw agentsRes.error;
      if (adminsRes.error) throw adminsRes.error;
      const allowed = new Set<string>();
      for (const a of agentsRes.data ?? []) if (a.user_id) allowed.add(a.user_id);
      for (const a of adminsRes.data ?? []) if (a.user_id) allowed.add(a.user_id);
      const ids = Array.from(allowed);
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .eq("active", true)
        .in("id", ids)
        .order("full_name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const referencedAiAgentIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of convQuery.data ?? []) {
      if (c.ai_agent_id) set.add(c.ai_agent_id);
    }
    return Array.from(set).sort();
  }, [convQuery.data]);

  const aiAgentsQuery = useQuery({
    queryKey: ["ai-agents-for-filter", activeBrandId, referencedAiAgentIds.join(",")],
    enabled: !!activeBrandId,
    queryFn: async () => {
      const map = new Map<string, { id: string; name: string; status: string }>();
      const activeRes = await supabase
        .from("ai_agents")
        .select("id, name, status")
        .eq("brand_id", activeBrandId!)
        .in("status", ["on", "test"]);
      if (activeRes.error) throw activeRes.error;
      for (const a of activeRes.data ?? []) map.set(a.id, a as any);
      const missing = referencedAiAgentIds.filter((id) => !map.has(id));
      if (missing.length > 0) {
        const refRes = await supabase.from("ai_agents").select("id, name, status").in("id", missing);
        if (refRes.error) throw refRes.error;
        for (const a of refRes.data ?? []) map.set(a.id, a as any);
      }
      return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  const channelsForFilterQuery = useQuery({
    queryKey: ["channels-for-filter", activeBrandId],
    enabled: !!activeBrandId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brand_channels")
        .select("id, name, phone_number, type")
        .eq("brand_id", activeBrandId!)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string; phone_number: string | null; type: string }>;
    },
  });




  const pipelinesQuery = useQuery({
    queryKey: ["inbox-pipelines", activeBrandId],
    enabled: !!activeBrandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipelines")
        .select("id, name, brand_id, position, stages:pipeline_stages(id, name, color, position)")
        .eq("brand_id", activeBrandId!)
        .order("position", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; name: string; brand_id: string; position: number;
        stages: Array<{ id: string; name: string; color: string | null; position: number }>;
      }>;
    },
  });

  // Contadores contextuais: refletem a combinação de status/assignment ativa
  // e o escopo de visibilidade do usuário (agente comum vê só próprias + sem dono).
  type OverviewPayload = {
    all: number; mine: number; unassigned: number; unread: number;
    aberto: number; pendente: number; resolvido: number; all_status: number;
    no_assignee: number; no_ai_agent: number; no_channel: number;
    per_user: Array<{ user_id: string; count: number }>;
    per_ai_agent: Array<{ ai_agent_id: string; count: number }>;
    per_channel: Array<{ channel_id: string; count: number }>;
    per_pipeline: Array<{ pipeline_id: string; count: number }>;
    per_stage: Array<{ stage_id: string; count: number }>;
  };
  const inboxOverviewQuery = useQuery({
    queryKey: ["inbox-overview", activeBrandId, me?.userId, status, assignment],
    enabled: !!activeBrandId && !!me?.userId,
    staleTime: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("inbox_overview" as any, {
        p_brand_id: activeBrandId!,
        p_status: status,
        p_assignment: assignment,
      } as any);
      if (error) throw error;
      return (data ?? {}) as OverviewPayload;
    },
  });

  // Busca textual agora é feita server-side via p_search no RPC.
  // Mantemos `filtered` como alias da lista já filtrada pelo servidor.
  const filtered = useMemo(() => convQuery.data ?? [], [convQuery.data]);

  const counts = useMemo(() => {
    const ov = inboxOverviewQuery.data;
    const perUserMap = new Map<string, number>();
    for (const r of ov?.per_user ?? []) perUserMap.set(r.user_id, r.count);
    const perAiMap = new Map<string, number>();
    for (const r of ov?.per_ai_agent ?? []) perAiMap.set(r.ai_agent_id, r.count);
    const perChannelMap = new Map<string, number>();
    for (const r of ov?.per_channel ?? []) perChannelMap.set(r.channel_id, r.count);
    return {
      all: ov?.all ?? 0,
      allStatus: ov?.all_status ?? ov?.all ?? 0,
      mine: ov?.mine ?? 0,
      unassigned: ov?.unassigned ?? 0,
      unread: ov?.unread ?? 0,
      aberto: ov?.aberto ?? 0,
      pendente: ov?.pendente ?? 0,
      resolvido: ov?.resolvido ?? 0,
      perUser: (uid: string) => perUserMap.get(uid) ?? 0,
      noAssignee: ov?.no_assignee ?? 0,
      perAiAgent: (aid: string) => perAiMap.get(aid) ?? 0,
      noAiAgent: ov?.no_ai_agent ?? 0,
      perChannel: (cid: string) => perChannelMap.get(cid) ?? 0,
      noChannel: ov?.no_channel ?? 0,
    };
  }, [inboxOverviewQuery.data]);

  const pipelineCounts = useMemo(() => {
    const perPipeline = new Map<string, number>();
    const perStage = new Map<string, number>();
    for (const r of inboxOverviewQuery.data?.per_pipeline ?? []) perPipeline.set(r.pipeline_id, r.count);
    for (const r of inboxOverviewQuery.data?.per_stage ?? []) perStage.set(r.stage_id, r.count);
    return { perPipeline, perStage };
  }, [inboxOverviewQuery.data]);

  const selected =
    filtered.find((c) => c.id === selectedId) ??
    (convQuery.data ?? []).find((c) => c.id === selectedId) ??
    (directConvQuery.data && directConvQuery.data.id === selectedId ? directConvQuery.data : null);
  const selectedFromDirect = !!selected && !(convQuery.data ?? []).some((c) => c.id === selected.id);





  function toggleUser(id: string) {
    setUserIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }
  function toggleAiAgent(id: string) {
    setAiAgentIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }
  function toggleChannel(id: string) {
    setChannelIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }
  function togglePipeline(id: string) {
    setPipelineIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }
  function toggleStage(id: string) {
    setStageIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    // Auto-seleciona o pipeline pai ao clicar em uma etapa
    const parent = (pipelinesQuery.data ?? []).find((p) => p.stages.some((s) => s.id === id));
    if (parent && !pipelineIds.includes(parent.id)) {
      setPipelineIds((prev) => [...prev, parent.id]);
      setExpandedPipelines((prev) => {
        const next = new Set(prev);
        next.add(parent.id);
        return next;
      });
    }
  }
  function toggleExpanded(id: string) {
    setExpandedPipelines((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex h-[calc(100vh-3rem)]">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-card md:flex xl:w-64">
        <ScrollArea className="flex-1 [&>[data-radix-scroll-area-viewport]>div]:!block [&>[data-radix-scroll-area-viewport]>div]:!w-full">
          <FilterSection title="Caixa de entrada">
            <FilterRow label="Todas as conversas" count={counts.all} active={assignment === "all"} onClick={() => setAssignment("all")} />
            <FilterRow label="Minhas conversas" count={counts.mine} active={assignment === "mine"} onClick={() => setAssignment("mine")} />
            <FilterRow label="Sem atribuição" count={counts.unassigned} active={assignment === "unassigned"} onClick={() => setAssignment("unassigned")} variant="warning" />
            <FilterRow label="Não lidas" count={counts.unread} active={assignment === "unread"} onClick={() => setAssignment("unread")} />
          </FilterSection>

          <FilterSection title="Por status">
            <FilterRow label="Abertas" count={counts.aberto} active={status === "aberto"} onClick={() => setStatus("aberto")} dot="info" />
            <FilterRow label="Pendentes" count={counts.pendente} active={status === "pendente"} onClick={() => setStatus("pendente")} dot="warning" />
            <FilterRow label="Resolvidas" count={counts.resolvido} active={status === "resolvido"} onClick={() => setStatus("resolvido")} dot="success" />
            <FilterRow label="Todos status" count={counts.allStatus} active={status === "all"} onClick={() => setStatus("all")} dot="muted" />
          </FilterSection>

          <FilterSection
            title="Por usuário"
            action={userIds.length > 0 ? (
              <button onClick={() => setUserIds([])} className="text-[11px] font-medium text-primary hover:underline">limpar</button>
            ) : null}
          >
            <UserFilterRow label="Sem atribuição" initials="—" count={counts.noAssignee} active={userIds.includes("__none__")} onClick={() => toggleUser("__none__")} />
            {(agentsQuery.data ?? []).map((u) => {
              const name = u.full_name ?? u.email ?? "Sem nome";
              const initials = name.split(" ").filter(Boolean).slice(0, 2).map((p: string) => p[0]?.toUpperCase()).join("");
              return (
                <UserFilterRow key={u.id} label={name} initials={initials || "?"} count={counts.perUser(u.id)} active={userIds.includes(u.id)} onClick={() => toggleUser(u.id)} seed={u.id} />
              );
            })}
          </FilterSection>

          <FilterSection
            title="Agentes de IA"
            action={aiAgentIds.length > 0 ? (
              <button onClick={() => setAiAgentIds([])} className="text-[11px] font-medium text-primary hover:underline">limpar</button>
            ) : null}
          >
            {(aiAgentsQuery.data ?? []).length === 0 && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">Nenhum agente ativo.</div>
            )}
            {(aiAgentsQuery.data ?? []).length > 0 && (
              <UserFilterRow label="Sem agente IA" initials="—" count={counts.noAiAgent} active={aiAgentIds.includes("__none__")} onClick={() => toggleAiAgent("__none__")} />
            )}
            {(aiAgentsQuery.data ?? []).map((a) => {
              const initials = a.name.split(" ").filter(Boolean).slice(0, 2).map((p: string) => p[0]?.toUpperCase()).join("") || "IA";
              const dim = a.status === "off" ? " opacity-70" : "";
              return (
                <div key={a.id} className={`flex items-center gap-1${dim}`}>
                  <div className="flex-1">
                    <UserFilterRow
                      label={a.name}
                      initials={initials}
                      count={counts.perAiAgent(a.id)}
                      active={aiAgentIds.includes(a.id)}
                      onClick={() => toggleAiAgent(a.id)}
                      seed={a.id}
                    />
                  </div>
                  <span className={`mr-2 shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold ${
                    a.status === "on" ? "bg-emerald-500/15 text-emerald-600" :
                    a.status === "test" ? "bg-amber-500/15 text-amber-600" :
                    "bg-muted text-muted-foreground"
                  }`}>{a.status === "on" ? "ATIVO" : a.status === "test" ? "TESTE" : "OFF"}</span>
                </div>
              );
            })}
          </FilterSection>

          <FilterSection
            title="Por canal"
            action={channelIds.length > 0 ? (
              <button onClick={() => setChannelIds([])} className="text-[11px] font-medium text-primary hover:underline">limpar</button>
            ) : null}
          >
            {(channelsForFilterQuery.data ?? []).length === 0 && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">Nenhum canal.</div>
            )}
            {(channelsForFilterQuery.data ?? []).length > 0 && (
              <UserFilterRow label="Sem canal" initials="—" count={counts.noChannel} active={channelIds.includes("__none__")} onClick={() => toggleChannel("__none__")} />
            )}
            {(channelsForFilterQuery.data ?? []).map((ch) => {
              const initials = ch.name.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "CH";
              return (
                <UserFilterRow
                  key={ch.id}
                  label={ch.name}
                  initials={initials}
                  count={counts.perChannel(ch.id)}
                  active={channelIds.includes(ch.id)}
                  onClick={() => toggleChannel(ch.id)}
                  seed={ch.id}
                />
              );
            })}
          </FilterSection>





          <FilterSection
            title="Por pipeline"
            action={(pipelineIds.length > 0 || stageIds.length > 0) ? (
              <button onClick={() => { setPipelineIds([]); setStageIds([]); }} className="text-[11px] font-medium text-primary hover:underline">limpar</button>
            ) : null}
          >
            {(pipelinesQuery.data ?? []).length === 0 && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">Nenhum pipeline.</div>
            )}
            {(pipelinesQuery.data ?? []).map((p) => {
              const isOpen = expandedPipelines.has(p.id);
              const isActive = pipelineIds.includes(p.id);
              const stages = [...(p.stages ?? [])].sort((a, b) => a.position - b.position);
              return (
                <div key={p.id} className="flex flex-col">
                  <div className={`flex items-center gap-1 rounded-md pr-2 transition hover:bg-accent ${isActive ? "bg-accent" : ""}`}>
                    {stages.length > 0 ? (
                      <button
                        onClick={() => toggleExpanded(p.id)}
                        className="flex h-7 w-6 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
                        aria-label={isOpen ? "Recolher" : "Expandir"}
                      >
                        {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </button>
                    ) : (
                      <span className="w-6 shrink-0" />
                    )}
                    <button
                      onClick={() => togglePipeline(p.id)}
                      className="flex flex-1 items-center gap-2 py-1.5 text-left text-sm"
                    >
                      <Workflow className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate">{p.name}</span>
                      <span className="text-xs text-muted-foreground">{pipelineCounts.perPipeline.get(p.id) ?? 0}</span>
                    </button>
                  </div>
                  {isOpen && stages.length > 0 && (
                    <div className="ml-6 flex flex-col border-l border-border pl-1">
                      {stages.map((st) => {
                        const stActive = stageIds.includes(st.id);
                        return (
                          <button
                            key={st.id}
                            onClick={() => toggleStage(st.id)}
                            className={`flex items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition hover:bg-accent ${stActive ? "bg-accent ring-1 ring-primary" : ""}`}
                          >
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: st.color ?? "var(--muted-foreground)" }} />
                            <span className="flex-1 truncate">{st.name}</span>
                            <span className="text-[11px] text-muted-foreground">{pipelineCounts.perStage.get(st.id) ?? 0}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </FilterSection>
        </ScrollArea>
      </aside>

      <aside className="flex w-64 lg:w-72 xl:w-80 2xl:w-96 shrink-0 flex-col border-r border-border bg-card">
        <div className="border-b border-border p-3">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <InboxIcon className="h-4 w-4" /> Conversas
            {(() => {
              const total =
                status === "aberto" ? counts.aberto :
                status === "pendente" ? counts.pendente :
                status === "resolvido" ? counts.resolvido :
                counts.allStatus;
              return (
                <Badge variant="secondary" className="ml-auto h-5 px-1.5 text-[10px]" title={`${filtered.length} carregadas de ${total} no filtro`}>
                  {filtered.length}/{total}
                </Badge>
              );
            })()}
          </h2>
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 pr-7" />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {search.trim().length === 1 && (
            <p className="mt-1.5 text-[10px] leading-tight text-muted-foreground">
              Digite ao menos 2 caracteres para buscar.
            </p>
          )}
          {debouncedSearch.trim().length >= 2 && convInfinite.isFetching && (
            <p className="mt-1.5 text-[10px] leading-tight text-muted-foreground">
              Buscando em todo o workspace…
            </p>
          )}
        </div>
        <ScrollArea className="flex-1">
          {convQuery.isLoading && <div className="p-4 text-sm text-muted-foreground">Carregando...</div>}
          {!convQuery.isLoading && convInfinite.isError && (
            <div className="p-4 text-sm text-destructive space-y-2">
              <div>Não foi possível carregar as conversas.</div>
              <Button size="sm" variant="outline" onClick={() => convInfinite.refetch()}>
                Tentar novamente
              </Button>
            </div>
          )}
          {!convQuery.isLoading && !convInfinite.isError && filtered.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground">Nenhuma conversa.</div>
          )}

          <ul className="w-full min-w-0 pr-2">
            {filtered.map((c) => {
              const name = c.contact?.name ?? c.contact?.profile_name ?? formatContactPhone(c.contact?.phone, c.contact?.wa_id) ?? "Sem nome";
              const isActive = selectedId === c.id;
              return (
                <li key={c.id}>
                  <button
                    onClick={() => selectConversation(c.id)}
                    className={`flex w-full min-w-0 items-start gap-2.5 border-b border-border py-2.5 pl-3 pr-3 text-left transition hover:bg-accent ${isActive ? "bg-accent" : ""}`}
                  >
                    <Avatar className="h-9 w-9 shrink-0">
                      <AvatarFallback className={`text-[11px] font-semibold ${avatarColor(c.contact_id ?? name)}`}>
                        {toInitials(name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1 overflow-hidden">
                      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                        <span className="min-w-0 truncate text-sm font-medium">{name}</span>
                        {c.unread_count > 0 && (
                          <span className="inline-flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                            {c.unread_count}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex min-w-0 items-center gap-1 overflow-hidden text-[11px] text-muted-foreground">
                        <span className="min-w-0 truncate">{c.brand?.name ?? "—"}</span>
                        <span className="shrink-0">•</span>
                        <span className="min-w-0 truncate">{c.channel?.name ?? "—"}</span>
                      </div>
                      {c.channel?.phone_number && (
                        <div className="mt-0.5 min-w-0">
                          <Badge variant="outline" className="h-4 max-w-full truncate px-1 text-[9px]">{c.channel.phone_number}</Badge>
                        </div>
                      )}
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {c.last_message_at ? new Date(c.last_message_at).toLocaleString("pt-BR") : "Sem mensagens ainda"}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
          {convInfinite.hasNextPage && (
            <div className="p-3">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => convInfinite.fetchNextPage()}
                disabled={convInfinite.isFetchingNextPage}
              >
                {convInfinite.isFetchingNextPage ? "Carregando..." : "Carregar mais conversas"}
              </Button>
            </div>
          )}
        </ScrollArea>
      </aside>


      <main className="flex min-w-0 flex-1 flex-col bg-background">
        {selected ? (
          <div className="flex min-h-0 flex-1 flex-col">
            {selectedFromDirect && (
              <div className="border-b border-border bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground">
                Esta conversa ainda não aparece na lista (sem mensagens ou fora dos filtros atuais).
              </div>
            )}
            <div className="flex min-h-0 flex-1 flex-col">
              <ConversationView key={selected.id} conv={selected} />
            </div>
          </div>
        ) : selectedId && directConvQuery.isLoading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Carregando conversa…
          </div>

        ) : selectedId && !directConvQuery.isLoading && directConvQuery.data === null ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Conversa não encontrada ou sem permissão de acesso.
          </div>

        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Selecione uma conversa para começar.
          </div>
        )}
      </main>
    </div>
  );
}

function FilterSection({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="border-b border-border px-2 py-2">
      <div className="flex items-center justify-between px-2 pb-1.5 pt-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
        {action}
      </div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function FilterRow({ label, count, active, onClick, dot, variant }: {
  label: string; count: number; active?: boolean; onClick: () => void;
  dot?: "muted" | "info" | "warning" | "success"; variant?: "warning";
}) {
  const dotClass =
    dot === "muted" ? "bg-muted-foreground"
    : dot === "info" ? "bg-blue-500"
    : dot === "warning" ? "bg-amber-500"
    : dot === "success" ? "bg-emerald-500"
    : null;
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-accent ${
        active ? (variant === "warning" ? "bg-amber-500/10 text-foreground" : "bg-accent") : ""
      }`}
    >
      {dotClass && <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} />}
      <span className="flex-1 truncate">{label}</span>
      <span className="text-xs text-muted-foreground">{count}</span>
    </button>
  );
}

function UserFilterRow({ label, initials, count, active, onClick, seed }: {
  label: string; initials: string; count: number; active?: boolean; onClick: () => void; seed?: string;
}) {
  const tone = seed ? avatarColor(seed) : "bg-muted text-muted-foreground";
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-accent ${active ? "ring-1 ring-primary bg-accent" : ""}`}
    >
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${tone}`}>{initials}</span>
      <span className="flex-1 truncate">{label}</span>
      <span className="text-xs text-muted-foreground">{count}</span>
    </button>
  );
}

interface MessageRow {
  id: string;
  direction: "inbound" | "outbound";
  type: string;
  content: string | null;
  media_url: string | null;
  media_mime: string | null;
  media_filename: string | null;
  status: string;
  error_message: string | null;
  template_name: string | null;
  template_language: string | null;
  template_variables: string[] | null;
  reply_to_wa_id: string | null;
  created_at: string;
  raw: any | null;
}


interface NoteRow {
  id: string;
  body: string;
  author_id: string;
  created_at: string;
}

interface EventRow {
  id: string;
  event_type: string;
  payload: any;
  actor_id: string | null;
  created_at: string;
}

interface TemplateRow {
  id: string;
  name: string;
  language: string;
  status: string;
  variables_count: number;
  components?: Array<Record<string, any>> | null;
  header_type?: string | null;
  header_media_url?: string | null;
  variable_bindings?: import("@/lib/template-bindings").VariableBinding[] | null;
}


function formatWindow(expires: string | null): { open: boolean; label: string } {
  if (!expires) return { open: false, label: "Sem janela" };
  const diff = new Date(expires).getTime() - Date.now();
  if (diff <= 0) return { open: false, label: "Janela 24h expirada" };
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return { open: true, label: `Janela aberta · ${h}h ${m}m` };
}

export function ConversationView({ conv }: { conv: ConversationRow }) {
  const { me } = useMe();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [tab, setTab] = useState<"reply" | "note">("reply");
  const [transferOpen, setTransferOpen] = useState(false);
  const [pipelineDialogOpen, setPipelineDialogOpen] = useState(false);
  const [appointmentOpen, setAppointmentOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const canSeeHistory = !!me && (me.isAdmin || me.isSupervisor || me.isDeveloper);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const msgQuery = useQuery({
    queryKey: ["messages", conv.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("id, direction, type, content, media_url, media_mime, media_filename, status, error_message, template_name, template_language, template_variables, reply_to_wa_id, created_at, raw")
        .eq("conversation_id", conv.id)
        .order("created_at", { ascending: true })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as MessageRow[];
    },
  });

  const tplBodiesQuery = useQuery({
    queryKey: ["template-bodies", conv.brand_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_templates")
        .select("name, language, components, header_type, header_media_url")
        .eq("brand_id", conv.brand_id);
      if (error) throw error;
      const map = new Map<string, TemplateMeta>();
      for (const t of data ?? []) {
        const comps = (t.components as Array<Record<string, any>> | null) ?? [];
        const bodyComp = comps.find((c) => String(c?.type).toUpperCase() === "BODY");
        const headerComp = comps.find((c) => String(c?.type).toUpperCase() === "HEADER");
        const buttonsComp = comps.find((c) => String(c?.type).toUpperCase() === "BUTTONS");
        const text = (bodyComp?.text as string | undefined) ?? null;
        const explicitHt = ((t as any).header_type ?? "").toString().toUpperCase();
        const fmtHt = (headerComp?.format ?? "").toString().toUpperCase();
        const headerType = explicitHt || fmtHt || null;
        // headerMediaUrl removido: nunca devemos exibir a imagem aprovada na Meta
        // (header_handle) — só a que foi de fato enviada pela automação (m.media_url).
        const headerMediaUrl = null;

        const buttons = Array.isArray(buttonsComp?.buttons)
          ? (buttonsComp!.buttons as Array<any>).map((b) => ({
              text: String(b?.text ?? ""),
              type: String(b?.type ?? "QUICK_REPLY").toUpperCase(),
              url: b?.url ? String(b.url) : null,
              phone_number: b?.phone_number ? String(b.phone_number) : null,
            })).filter((b) => b.text)
          : [];
        map.set(`${t.name}::${t.language}`, {
          body: text,
          headerType,
          headerMediaUrl,
          buttons,
        });
      }
      return map;
    },
  });
  const templateBodyByKey = tplBodiesQuery.data ?? new Map<string, TemplateMeta>();



  const notesQuery = useQuery({
    queryKey: ["notes", conv.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("internal_notes")
        .select("id, body, author_id, created_at")
        .eq("conversation_id", conv.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as NoteRow[];
    },
  });

  const eventsQuery = useQuery({
    queryKey: ["contact-activity", conv.contact_id, conv.id],
    enabled: !!conv.contact_id,
    queryFn: async () => {
      const [intRes, convRes] = await Promise.all([
        supabase
          .from("integration_events")
          .select("id, event_type, payload, created_at, account:integration_accounts(platform, name)")
          .eq("contact_id", conv.contact_id!)
          .order("created_at", { ascending: false })
          .limit(30),
        supabase
          .from("conversation_events")
          .select("id, event_type, payload, actor_id, created_at")
          .eq("conversation_id", conv.id)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      if (intRes.error) throw intRes.error;
      if (convRes.error) throw convRes.error;
      const integration = (intRes.data ?? []).map((r: any) => ({
        id: `i:${r.id}`,
        kind: "integration" as const,
        event_type: r.event_type as string,
        payload: r.payload,
        created_at: r.created_at as string,
        platform: (r.account?.platform as string | undefined) ?? null,
        account_name: (r.account?.name as string | undefined) ?? null,
      }));
      const internal = (convRes.data ?? []).map((r: any) => ({
        id: `c:${r.id}`,
        kind: "internal" as const,
        event_type: r.event_type as string,
        payload: r.payload,
        created_at: r.created_at as string,
        platform: null,
        account_name: null,
      }));
      return [...integration, ...internal]
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        .slice(0, 40);
    },
  });

  const prevQuery = useQuery({
    queryKey: ["prev-convs", conv.contact_id, conv.id],
    enabled: !!conv.contact_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("id, status, last_message_at")
        .eq("contact_id", conv.contact_id!)
        .neq("id", conv.id)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(5);
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgQuery.data, notesQuery.data]);

  const isWebchat = conv.channel?.type === "webchat";
  const win = formatWindow(conv.window_expires_at);
  const windowOpen = isWebchat ? true : win.open;
  const contactName = conv.contact?.name ?? conv.contact?.profile_name ?? (isPseudoPhone(conv.contact?.phone) ? null : conv.contact?.phone) ?? (isPseudoPhone(conv.contact?.wa_id) ? null : conv.contact?.wa_id) ?? "Sem nome";
  const initials = contactName.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";
  const tags: string[] = Array.isArray(conv.contact?.metadata?.tags) ? conv.contact!.metadata.tags : [];

  function refreshConv() {
    qc.invalidateQueries({ queryKey: ["conversations"] });
    qc.invalidateQueries({ queryKey: ["inbox-overview"] });
    qc.invalidateQueries({ queryKey: ["sidebar-unread"] });
    qc.invalidateQueries({ queryKey: ["conv-events", conv.id] });
  }

  async function handleSend() {
    if (!text.trim() || sending) return;
    setSending(true);
    if (isWebchat) {
      const { error } = await supabase.from("messages").insert({
        conversation_id: conv.id,
        brand_id: conv.brand_id!,
        channel_id: conv.channel_id ?? null,
        direction: "outbound",
        type: "text",
        content: text.trim(),
        status: "sent",
        sent_by: me?.userId ?? null,
      });
      if (!error) {
        await supabase
          .from("conversations")
          .update({ last_message_at: new Date().toISOString() })
          .eq("id", conv.id);
      }
      setSending(false);
      if (error) { toast.error(error.message); return; }
      setText("");
      qc.invalidateQueries({ queryKey: ["messages", conv.id] });
      return;
    }
    const { error } = await callFunction("send-message", {
      conversation_id: conv.id, type: "text", text: text.trim(),
    });
    setSending(false);
    if (error) { toast.error(error.message); return; }
    setText("");
    qc.invalidateQueries({ queryKey: ["messages", conv.id] });
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = "";
    setSending(true);
    try {
      const up = await uploadMedia(f, conv.id);
      const type = up.mime.startsWith("image/") ? "image"
        : up.mime.startsWith("video/") ? "video"
        : up.mime.startsWith("audio/") ? "audio"
        : "document";
      if (isWebchat) {
        const { error } = await supabase.from("messages").insert({
          conversation_id: conv.id,
          brand_id: conv.brand_id!,
          channel_id: conv.channel_id ?? null,
          direction: "outbound",
          type,
          content: up.url,
          media_url: up.url,
          media_mime: up.mime,
          media_filename: up.filename,
          status: "sent",
          sent_by: me?.userId ?? null,
        });
        if (error) toast.error(error.message);
        else {
          await supabase
            .from("conversations")
            .update({ last_message_at: new Date().toISOString() })
            .eq("id", conv.id);
          qc.invalidateQueries({ queryKey: ["messages", conv.id] });
        }
        return;
      }
      const { error } = await callFunction("send-message", {
        conversation_id: conv.id, type, media_url: up.url, media_mime: up.mime, media_filename: up.filename,
      });
      if (error) toast.error(error.message);
      else qc.invalidateQueries({ queryKey: ["messages", conv.id] });
    } catch (err: any) {

      toast.error(err.message ?? "Falha no upload");
    } finally {
      setSending(false);
    }
  }

  async function handleAddNote() {
    if (!text.trim() || !me?.userId) return;
    setSending(true);
    const { error } = await supabase.from("internal_notes").insert({
      conversation_id: conv.id, author_id: me.userId, body: text.trim(),
    });
    setSending(false);
    if (error) { toast.error(error.message); return; }
    setText("");
    qc.invalidateQueries({ queryKey: ["notes", conv.id] });
  }

  const [resolveCardsOpen, setResolveCardsOpen] = useState(false);
  const [resolvableCards, setResolvableCards] = useState<Array<{ id: string; pipeline_id: string; pipeline_name: string }>>([]);
  const [selectedCardsToResolve, setSelectedCardsToResolve] = useState<Set<string>>(new Set());

  async function setStatus(newStatus: string) {
    const { error } = await supabase.from("conversations").update({ status: newStatus as "aberto" | "pendente" | "resolvido" }).eq("id", conv.id);
    if (error) { toast.error(error.message); return; }
    await supabase.from("conversation_events").insert({
      conversation_id: conv.id, event_type: "status_changed",
      actor_id: me?.userId ?? null, payload: { to: newStatus },
    });
    toast.success(`Status alterado para ${newStatus}`);
    refreshConv();

    // Sincronização com cartões de pipeline ao resolver conversa
    if (newStatus === "resolvido" && conv.contact_id && conv.brand_id) {
      const { data: cards } = await supabase
        .from("pipeline_contacts")
        .select("id, pipeline_id, pipelines:pipeline_id(name)")
        .eq("contact_id", conv.contact_id)
        .eq("brand_id", conv.brand_id)
        .eq("status" as any, "aberto");
      const list = ((cards ?? []) as any[]).map((r) => ({
        id: r.id as string,
        pipeline_id: r.pipeline_id as string,
        pipeline_name: r.pipelines?.name ?? "Pipeline",
      }));
      if (list.length === 1) {
        await supabase.from("pipeline_contacts").update({ status: "resolvido" } as any).eq("id", list[0].id);
        qc.invalidateQueries({ queryKey: ["pipeline-contact-index"] });
        qc.invalidateQueries({ queryKey: ["pipeline-stage-cards"] });
        qc.invalidateQueries({ queryKey: ["inbox-pipeline-contacts"] });
        toast.success(`Cartão em "${list[0].pipeline_name}" também resolvido`);
      } else if (list.length > 1) {
        setResolvableCards(list);
        setSelectedCardsToResolve(new Set(list.map((c) => c.id)));
        setResolveCardsOpen(true);
      }
    }
  }

  async function confirmResolveCards() {
    const ids = Array.from(selectedCardsToResolve);
    setResolveCardsOpen(false);
    if (ids.length === 0) return;
    const { error } = await supabase.from("pipeline_contacts").update({ status: "resolvido" } as any).in("id", ids);
    if (error) toast.error(error.message);
    else {
      qc.invalidateQueries({ queryKey: ["pipeline-contact-index"] });
      qc.invalidateQueries({ queryKey: ["pipeline-stage-cards"] });
      qc.invalidateQueries({ queryKey: ["inbox-pipeline-contacts"] });
      toast.success(`${ids.length} cartão(ões) resolvido(s)`);
    }
  }

  const transferFn = useServerFn(transferConversation);
  async function assignToMe() {
    if (!me) return;
    try {
      await transferFn({ data: { conversationId: conv.id, targetUserId: me.userId } });
    } catch (e) {
      toast.error((e as Error).message || "Erro ao atribuir");
      return;
    }
    toast.success("Conversa atribuída a você");
    qc.invalidateQueries({ queryKey: ["pipeline-owners"] });
    qc.invalidateQueries({ queryKey: ["pipeline-cards"] });
    refreshConv();
  }

  const aiAgentsQuery = useQuery({
    queryKey: ["brand-ai-agents-active", conv.brand_id],
    enabled: !!conv.brand_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_agents")
        .select("id, name")
        .eq("brand_id", conv.brand_id)
        .eq("status", "on")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const activeAiAgents = aiAgentsQuery.data ?? [];
  const canReturnToAi =
    activeAiAgents.length > 0 &&
    activeAiAgents.some((a) => a.id !== conv.ai_agent_id);

  async function assignToAi(agentId: string) {
    try {
      await transferFn({ data: { conversationId: conv.id, targetId: agentId, kind: "ai" } });
    } catch (e) {
      toast.error((e as Error).message || "Erro ao devolver para IA");
      return;
    }
    toast.success("Conversa devolvida para a IA");
    qc.invalidateQueries({ queryKey: ["pipeline-owners"] });
    qc.invalidateQueries({ queryKey: ["pipeline-cards"] });
    refreshConv();
  }


  async function markUnread() {
    const { error } = await supabase.from("conversations").update({ unread_count: 1 }).eq("id", conv.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Marcada como não lida");
    refreshConv();
  }

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* HEADER */}
        <header className="flex items-center justify-between border-b border-border bg-card px-4 py-2">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar className="h-9 w-9">
              <AvatarFallback className={avatarColor(conv.contact_id ?? contactName)}>{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="flex items-center gap-2 truncate">
                <span className="truncate font-semibold">{contactName}</span>
                {isEllie(conv.brand_id) && <EllieStatusBadge contactId={conv.contact_id ?? null} variant="full" />}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {formatContactPhone(conv.contact?.phone, conv.contact?.wa_id)} • {conv.brand?.name ?? "—"} • {conv.channel?.name ?? "—"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Badge className={`shrink-0 ${isWebchat ? "bg-sky-500 hover:bg-sky-500" : windowOpen ? "bg-emerald-500 hover:bg-emerald-500" : "bg-destructive hover:bg-destructive"}`} title={isWebchat ? "Webchat" : win.label}>
              <span className="xl:hidden">{isWebchat ? "Webchat" : windowOpen ? "Aberta" : "Fechada"}</span>
              <span className="hidden xl:inline">{isWebchat ? "Webchat" : win.label}</span>
            </Badge>
            <Select value={conv.status} onValueChange={setStatus}>
              <SelectTrigger className="h-8 w-[110px] xl:w-[130px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="aberto">🔵 Aberto</SelectItem>
                <SelectItem value="pendente">🟡 Pendente</SelectItem>
                <SelectItem value="resolvido">🟢 Resolvido</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" variant="default" onClick={() => setStatus("resolvido")}>
              <CheckCircle2 className="h-3.5 w-3.5 xl:mr-1" /> <span className="hidden xl:inline">Resolver</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline">Ações</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={assignToMe}>
                  <UserPlus className="mr-2 h-3.5 w-3.5" /> Atribuir a mim
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTransferOpen(true)}>
                  <ArrowRightLeft className="mr-2 h-3.5 w-3.5" /> Transferir
                </DropdownMenuItem>
                {canReturnToAi && activeAiAgents.length === 1 && (
                  <DropdownMenuItem onClick={() => assignToAi(activeAiAgents[0].id)}>
                    <Bot className="mr-2 h-3.5 w-3.5" /> Devolver para IA
                  </DropdownMenuItem>
                )}
                {canReturnToAi && activeAiAgents.length > 1 && (
                  <>
                    <DropdownMenuLabel className="text-xs text-muted-foreground">Devolver para IA</DropdownMenuLabel>
                    {activeAiAgents
                      .filter((a) => a.id !== conv.ai_agent_id)
                      .map((a) => (
                        <DropdownMenuItem key={a.id} onClick={() => assignToAi(a.id)}>
                          <Bot className="mr-2 h-3.5 w-3.5" /> {a.name}
                        </DropdownMenuItem>
                      ))}
                  </>
                )}
                <DropdownMenuItem onClick={() => setPipelineDialogOpen(true)}>
                  <Workflow className="mr-2 h-3.5 w-3.5" /> Mover para pipeline
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setAppointmentOpen(true)} disabled={!conv.contact_id}>
                  <CalendarClock className="mr-2 h-3.5 w-3.5" /> Agendar follow-up
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={async () => {
                    if (!conv.contact_id) return;
                    if (!confirm("Adicionar este contato ao blocklist? Envios futuros serão bloqueados.")) return;
                    try {
                      const r = await addContactToBlocklist({ data: { contactId: conv.contact_id, channels: ["phone", "email"] } });
                      toast.success(`Adicionado ao blocklist (${r.added} entrada${r.added === 1 ? "" : "s"})`);
                    } catch (e) {
                      toast.error((e as Error).message || "Falha ao adicionar ao blocklist");
                    }
                  }}
                >
                  <ShieldOff className="mr-2 h-3.5 w-3.5" /> Adicionar ao blocklist
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="inline-flex h-8 w-8"
                    onClick={async () => {
                      const url = `${window.location.origin}/inbox?conv=${conv.id}`;
                      try {
                        await navigator.clipboard.writeText(url);
                        toast.success("Link da conversa copiado");
                      } catch {
                        toast.error("Não foi possível copiar o link");
                      }
                    }}
                    aria-label="Copiar link da conversa"
                  >
                    <Link2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Copiar link da conversa</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="inline-flex h-8 w-8"
                    onClick={() => setShowSidebar((s) => !s)}
                    aria-label={showSidebar ? "Ocultar painel do contato" : "Mostrar painel do contato"}
                  >
                    {showSidebar ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{showSidebar ? "Ocultar painel do contato" : "Mostrar painel do contato"}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {canSeeHistory && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => setHistoryOpen(true)}
                      aria-label="Histórico da conversa"
                    >
                      <History className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Histórico da conversa</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="h-8 w-8"><MoreVertical className="h-4 w-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Conversa</DropdownMenuLabel>
                <DropdownMenuItem onClick={markUnread}>Marcar como não lida</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setStatus("aberto")}>Reabrir</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setShowSidebar((s) => !s)}>
                  {showSidebar ? "Ocultar" : "Mostrar"} painel do contato
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* MENSAGENS */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto bg-muted/30 p-4">
          <div className="mx-auto flex max-w-3xl flex-col gap-2">
            <EscalationReviewBanner conversationId={conv.id} />
            {msgQuery.isLoading && <div className="text-sm text-muted-foreground">Carregando mensagens...</div>}
            {msgQuery.data?.map((m) => <Bubble key={m.id} m={m} templateBodyByKey={templateBodyByKey} />)}
            {(notesQuery.data ?? []).map((n) => (
              <div key={n.id} className="self-center max-w-[80%] rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
                <div className="mb-0.5 font-semibold text-amber-700 dark:text-amber-400">📝 Nota interna</div>
                <div className="whitespace-pre-wrap break-words">{n.body}</div>
                <div className="mt-1 text-[10px] text-muted-foreground">
                  {new Date(n.created_at).toLocaleString("pt-BR")}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* COMPOSER */}
        <div className="border-t border-border bg-card">
          <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
            <div className="flex items-center justify-between border-b border-border px-3">
              <TabsList className="h-9 bg-transparent p-0">
                <TabsTrigger value="reply" className="data-[state=active]:bg-accent">💬 Responder</TabsTrigger>
                <TabsTrigger value="note" className="data-[state=active]:bg-amber-500/10 data-[state=active]:text-amber-700">
                  📝 Nota interna
                </TabsTrigger>
              </TabsList>
              <Popover>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="ghost" className="h-7 text-xs">
                    <Zap className="mr-1 h-3.5 w-3.5" /> Respostas rápidas
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-96 p-0">
                  <QuickRepliesPopover onPick={(t) => setText(t)} />
                </PopoverContent>
              </Popover>
            </div>
            <TabsContent value="reply" className="m-0 p-3">
              {!windowOpen && (
                <div className="mb-2 text-xs text-muted-foreground">
                  Janela de 24h expirada. Apenas templates aprovados podem ser enviados.
                </div>
              )}
              <Textarea
                placeholder={windowOpen ? "Digite sua resposta..." : "Janela expirada — use templates"}
                value={text}
                disabled={!windowOpen || sending}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
                }}
                rows={3}
                className="resize-none"
              />
              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <input ref={fileRef} type="file" hidden onChange={handleFile} />
                  <Button size="icon" variant="ghost" className="h-8 w-8" disabled={!windowOpen || sending} onClick={() => fileRef.current?.click()}>
                    <Paperclip className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" disabled={!windowOpen || sending} onClick={() => fileRef.current?.click()}>
                    <ImageIcon className="h-4 w-4" />
                  </Button>
                  <Separator orientation="vertical" className="mx-1 h-5" />
                  <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setTemplateOpen(true)}>
                    <FileText className="mr-1 h-3.5 w-3.5" /> Template
                  </Button>
                </div>
                <Button onClick={handleSend} disabled={sending || !text.trim() || !windowOpen}>
                  <Send className="mr-1 h-4 w-4" /> Enviar
                </Button>
              </div>
            </TabsContent>
            <TabsContent value="note" className="m-0 bg-amber-500/5 p-3">
              <Textarea
                placeholder="Nota interna (visível apenas para a equipe)..."
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                className="resize-none border-amber-500/40"
                disabled={sending}
              />
              <div className="mt-2 flex justify-end">
                <Button onClick={handleAddNote} disabled={sending || !text.trim()}>
                  Adicionar nota
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* PAINEL DO CONTATO */}
      {showSidebar && (
        <aside className="hidden w-72 2xl:w-80 shrink-0 flex-col overflow-hidden border-l border-border bg-card xl:flex">
          <ScrollArea className="flex-1 [&>[data-radix-scroll-area-viewport]>div]:!block [&>[data-radix-scroll-area-viewport]>div]:!w-full">
            <div className="flex flex-col items-center gap-2 p-5 text-center">
              <Avatar className="h-16 w-16">
                <AvatarFallback className={`text-lg ${avatarColor(conv.contact_id ?? contactName)}`}>{initials}</AvatarFallback>
              </Avatar>
              <div className="font-semibold">{contactName}</div>
              <div className="text-xs text-muted-foreground">WhatsApp: {formatPhoneDisplay(conv.contact?.wa_id) || "—"}</div>
            </div>
            <Separator />
            <Section title="Detalhes do contato">
              <EditableContactField
                icon={<UserIcon className="h-3.5 w-3.5" />}
                label="Nome"
                value={conv.contact?.name ?? ""}
                placeholder="Adicionar nome"
                onSave={async (v) => {
                  if (!conv.contact?.id) return;
                  const { error } = await supabase.from("contacts").update({ name: v.trim() || null }).eq("id", conv.contact.id);
                  if (error) throw error;
                  qc.invalidateQueries({ queryKey: ["conversations"] });
                }}
              />
              <Field icon={<Phone className="h-3.5 w-3.5" />} label="Telefone" value={formatContactPhone(conv.contact?.phone, conv.contact?.wa_id) || "—"} />
              <EditableContactField
                icon={<Mail className="h-3.5 w-3.5" />}
                label="E-mail"
                value={conv.contact?.metadata?.email ?? ""}
                placeholder="Adicionar e-mail"
                type="email"
                onSave={async (v) => {
                  if (!conv.contact?.id) return;
                  const trimmed = v.trim().toLowerCase();
                  if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) throw new Error("E-mail inválido");
                  const meta = { ...(conv.contact?.metadata ?? {}) } as any;
                  if (trimmed) meta.email = trimmed; else delete meta.email;
                  const { error } = await supabase.from("contacts").update({ metadata: meta }).eq("id", conv.contact.id);
                  if (error) throw error;
                  qc.invalidateQueries({ queryKey: ["conversations"] });
                }}
              />
              <EditableContactField
                icon={<MapPin className="h-3.5 w-3.5" />}
                label="Cidade"
                value={conv.contact?.metadata?.city ?? ""}
                placeholder="Adicionar cidade"
                onSave={async (v) => {
                  if (!conv.contact?.id) return;
                  const trimmed = v.trim();
                  const meta = { ...(conv.contact?.metadata ?? {}) } as any;
                  if (trimmed) meta.city = trimmed; else delete meta.city;
                  const { error } = await supabase.from("contacts").update({ metadata: meta }).eq("id", conv.contact.id);
                  if (error) throw error;
                  qc.invalidateQueries({ queryKey: ["conversations"] });
                }}
              />
            </Section>
            <Section
              title="Tags"
              action={
                <TagAdder
                  contactId={conv.contact?.id}
                  current={tags}
                  currentMetadata={conv.contact?.metadata ?? {}}
                  onSaved={() => qc.invalidateQueries({ queryKey: ["conversations"] })}
                />
              }
            >
              <div className="flex flex-wrap gap-1">
                {tags.length === 0 && <span className="text-xs text-muted-foreground">Sem tags</span>}
                {tags.map((t) => (
                  <Badge key={t} variant="secondary"><Tag className="mr-1 h-3 w-3" />{t}</Badge>
                ))}
              </div>
            </Section>
            <Section title="Atribuição">
              <Field label="Agente" value={<AgentName id={conv.assigned_to} />} />
              <Field label="Canal" value={conv.channel?.name ?? "—"} />
              <Field label="Workspace" value={conv.brand?.name ?? "—"} />
            </Section>
            <Section title="Conversas anteriores">
              <div className="space-y-1.5">
                {(prevQuery.data ?? []).length === 0 && (
                  <span className="text-xs text-muted-foreground">Nenhuma</span>
                )}
                {(prevQuery.data ?? []).map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between rounded-md border border-border px-2 py-1.5 text-xs">
                    <span className="truncate">{p.last_message_at ? new Date(p.last_message_at).toLocaleDateString("pt-BR") : "—"}</span>
                    <Badge variant="outline" className="text-[10px]">{p.status}</Badge>
                  </div>
                ))}
              </div>
            </Section>
            <Section title="Agendamentos">
              {conv.contact_id ? (
                <ContactAppointmentsList brandId={conv.brand_id} contactId={conv.contact_id} />
              ) : (
                <span className="text-xs text-muted-foreground">Sem contato vinculado.</span>
              )}
            </Section>
            {isEllie(conv.brand_id) && (
              <Section title="O que a IA sabe">
                <EllieMemoryPanel agentId={conv.ai_agent_id ?? null} contactId={conv.contact_id ?? null} />
              </Section>
            )}
            <Section title="Atividade do contato">
              {conv.contact_id ? (
                <ContactTimelineCompact
                  contactId={conv.contact_id}
                  brandId={conv.brand_id}
                  limit={20}
                />
              ) : (
                <span className="text-xs text-muted-foreground">Sem atividades.</span>
              )}
            </Section>
          </ScrollArea>
        </aside>
      )}

      <TransferDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        channelId={conv.channel_id ?? null}
        conversationId={conv.id}
        currentAssignee={conv.assigned_to}
        onAssigned={refreshConv}
      />
      <TemplateDialog
        open={templateOpen}
        onOpenChange={setTemplateOpen}
        brandId={conv.brand_id}
        channelId={conv.channel_id ?? null}
        conversationId={conv.id}
        contactId={conv.contact_id ?? null}
        onSent={() => qc.invalidateQueries({ queryKey: ["messages", conv.id] })}
      />
      {conv.contact_id && (
        <MoveToPipelineDialog
          open={pipelineDialogOpen}
          onOpenChange={setPipelineDialogOpen}
          brandId={conv.brand_id}
          contactId={conv.contact_id}
          contactName={contactName}
          onMoved={() => {
            qc.invalidateQueries({ queryKey: ["inbox-pipeline-contacts", conv.brand_id] });
            qc.invalidateQueries({ queryKey: ["pipeline-contact-index"] });
            qc.invalidateQueries({ queryKey: ["pipeline-stage-cards"] });
          }}
        />
      )}
      {conv.contact_id && (
        <AppointmentFormDialog
          open={appointmentOpen}
          onOpenChange={setAppointmentOpen}
          contactId={conv.contact_id}
          conversationId={conv.id}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["appointments"] });
            qc.invalidateQueries({ queryKey: ["due-appointments"] });
            qc.invalidateQueries({ queryKey: ["contact-appointments", conv.contact_id] });
          }}
        />
      )}
      {canSeeHistory && (
        <ConversationHistorySheet
          conversationId={conv.id}
          open={historyOpen}
          onOpenChange={setHistoryOpen}
        />
      )}
      <Dialog open={resolveCardsOpen} onOpenChange={setResolveCardsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolver cartões em outros pipelines?</DialogTitle>
            <DialogDescription>
              Este contato tem cartões abertos em mais de um pipeline. Selecione quais deseja marcar como resolvidos.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            {resolvableCards.map((c) => {
              const checked = selectedCardsToResolve.has(c.id);
              return (
                <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-md border border-border p-2 hover:bg-accent">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      setSelectedCardsToResolve((prev) => {
                        const n = new Set(prev);
                        if (n.has(c.id)) n.delete(c.id); else n.add(c.id);
                        return n;
                      });
                    }}
                  />
                  <span className="text-sm">{c.pipeline_name}</span>
                </label>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveCardsOpen(false)}>Pular</Button>
            <Button onClick={confirmResolveCards}>Resolver selecionados</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AgentName({ id }: { id: string | null }) {
  const { data } = useQuery({
    queryKey: ["agent-name", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("full_name, email").eq("id", id!).maybeSingle();
      return data;
    },
  });
  if (!id) return <>—</>;
  return <>{data?.full_name ?? data?.email ?? "—"}</>;
}

function TagAdder({ contactId, current, currentMetadata, onSaved }: { contactId?: string; current: string[]; currentMetadata?: Record<string, unknown>; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState("");
  if (!contactId) return null;
  async function save() {
    const v = val.trim();
    if (!v) return;
    // Re-fetch latest metadata from DB to avoid clobbering email/city saved after page load
    const { data: fresh } = await supabase.from("contacts").select("metadata").eq("id", contactId!).maybeSingle();
    const latestMeta = (fresh?.metadata as Record<string, unknown> | null) ?? currentMetadata ?? {};
    const latestTags: string[] = Array.isArray((latestMeta as any).tags) ? (latestMeta as any).tags : current;
    if (latestTags.includes(v)) { setVal(""); setOpen(false); return; }
    const next = Array.from(new Set([...latestTags, v]));
    const meta = { ...latestMeta, tags: next };
    const { error } = await supabase.from("contacts").update({ metadata: meta }).eq("id", contactId!);
    if (error) { toast.error(error.message); return; }
    // Trigger automations listening to this tag (fire-and-forget)
    supabase.functions.invoke("automation-engine", {
      body: { event: "tag_added", contact_id: contactId, tag: v },
    }).catch(() => {});
    setVal(""); setOpen(false); onSaved();
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="h-6 text-xs">+ tag</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 space-y-2 p-2">
        <Input placeholder="Nova tag" value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
        <Button size="sm" className="w-full" onClick={save}>Adicionar</Button>
      </PopoverContent>
    </Popover>
  );
}

function TransferDialog({ open, onOpenChange, channelId, conversationId, currentAssignee, onAssigned }: {
  open: boolean; onOpenChange: (b: boolean) => void;
  channelId: string | null; conversationId: string; currentAssignee: string | null; onAssigned: () => void;
}) {
  const qc = useQueryClient();
  const [pick, setPick] = useState<string>(currentAssignee ?? "");
  const agentsQuery = useQuery({
    queryKey: ["channel-agents", channelId],
    enabled: open && !!channelId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("channel_agents")
        .select("user_id, profile:profiles!channel_agents_user_id_fkey(id, full_name, email)")
        .eq("channel_id", channelId!);
      if (error) {
        const r2 = await supabase.from("profiles").select("id, full_name, email").eq("active", true);
        if (r2.error) throw r2.error;
        return (r2.data ?? []).map((p: any) => ({ user_id: p.id, profile: p }));
      }
      return data ?? [];
    },
  });
  const transferFn = useServerFn(transferConversation);
  async function transfer() {
    if (!pick) return;
    try {
      await transferFn({ data: { conversationId: conversationId, targetUserId: pick } });
    } catch (e) {
      toast.error((e as Error).message || "Erro ao transferir");
      return;
    }
    toast.success("Conversa transferida");
    qc.invalidateQueries({ queryKey: ["pipeline-owners"] });
    qc.invalidateQueries({ queryKey: ["pipeline-cards"] });
    onOpenChange(false); onAssigned();
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transferir conversa</DialogTitle>
          <DialogDescription>Escolha um agente do canal para receber esta conversa.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Select value={pick} onValueChange={setPick}>
            <SelectTrigger><SelectValue placeholder="Selecione um agente" /></SelectTrigger>
            <SelectContent>
              {(agentsQuery.data ?? []).map((a: any) => (
                <SelectItem key={a.user_id} value={a.user_id}>
                  {a.profile?.full_name ?? a.profile?.email ?? a.user_id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={transfer} disabled={!pick}>Transferir</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplateCombobox({ templates, value, onChange, loading }: {
  templates: TemplateRow[];
  value: string;
  onChange: (id: string) => void;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = templates.find((t) => t.id === value);
  const filtered = templates.filter((t) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${t.name} ${t.language}`.toLowerCase().includes(q);
  });
  return (
    <div className="w-full">
      <Button
        type="button"
        variant="outline"
        role="combobox"
        aria-expanded={open}
        className="w-full justify-between font-normal"
        disabled={loading}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="truncate">
          {selected ? `${selected.name} · ${selected.language}` : (loading ? "Carregando..." : "Selecione um template")}
        </span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>
      {open && (
        <div className="mt-1 rounded-md border bg-popover text-popover-foreground shadow-md">
          <div className="flex items-center border-b px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar template..."
              className="flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="max-h-80 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">Nenhum template encontrado.</div>
            ) : (
              filtered.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { onChange(t.id); setOpen(false); setQuery(""); }}
                  className="relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                >
                  <Check className={`mr-2 h-4 w-4 ${value === t.id ? "opacity-100" : "opacity-0"}`} />
                  <span className="truncate">{t.name} · {t.language}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}



function TemplateDialog({ open, onOpenChange, brandId, channelId, conversationId, contactId, onSent }: {
  open: boolean; onOpenChange: (b: boolean) => void;
  brandId: string; channelId: string | null; conversationId: string; contactId: string | null; onSent: () => void;
}) {
  const [pickId, setPickId] = useState<string>("");
  const [vars, setVars] = useState<string[]>([]);
  const [headerText, setHeaderText] = useState("");
  const [sending, setSending] = useState(false);

  const listChannelIdsFn = useServerFn(listBrandTemplateChannelIds);
  const tplQuery = useQuery({
    queryKey: ["templates", brandId, channelId],
    enabled: open && !!brandId,
    queryFn: async () => {
      // Templates Meta são vinculados à WABA. Resolvemos os channel_ids
      // elegíveis numa server fn (supabaseAdmin após has_brand_access), pois
      // agentes podem não ter channel_agents nos canais irmãos da mesma WABA
      // e o lookup direto via cliente seria bloqueado por RLS.
      let channelIds: string[] | null = null;
      try {
        const res = await listChannelIdsFn({
          data: { brandId, currentChannelId: channelId ?? null },
        });
        channelIds = res.channelIds ?? null;
      } catch (e) {
        // Fallback: usa apenas o canal atual se a fn falhar.
        channelIds = channelId ? [channelId] : null;
      }
      let q = supabase
        .from("whatsapp_templates")
        .select("id, name, language, status, variables_count, components, header_type, header_media_url, variable_bindings, channel_id")
        .eq("brand_id", brandId)
        .eq("status", "APPROVED");
      if (channelIds && channelIds.length > 0) q = q.in("channel_id", channelIds);
      const { data, error } = await q.order("name");
      if (error) throw error;
      const rows = (data ?? []) as (TemplateRow & { channel_id: string })[];
      // Deduplica por (name, language), preferindo o canal da conversa quando houver.
      const byKey = new Map<string, TemplateRow & { channel_id: string }>();
      for (const r of rows) {
        const key = `${r.name}::${r.language}`;
        const cur = byKey.get(key);
        if (!cur) { byKey.set(key, r); continue; }
        if (channelId && r.channel_id === channelId && cur.channel_id !== channelId) {
          byKey.set(key, r);
        }
      }
      return Array.from(byKey.values()) as TemplateRow[];
    },
  });

  // Carrega contato + últimos eventos de integração para pré-preencher variáveis
  const prefillQuery = useQuery({
    queryKey: ["template-prefill", contactId],
    enabled: open && !!contactId,
    queryFn: async () => {
      const [contactRes, eventsRes] = await Promise.all([
        supabase.from("contacts").select("name, profile_name, phone, wa_id, metadata").eq("id", contactId!).maybeSingle(),
        supabase
          .from("integration_events")
          .select("payload, created_at, platform")
          .eq("contact_id", contactId!)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      const eventsByPlatform: Record<string, unknown> = {};
      for (const ev of (eventsRes.data ?? []) as any[]) {
        const platform = ev.platform as string | undefined;
        if (platform && !(platform in eventsByPlatform)) {
          eventsByPlatform[platform] = ev.payload;
        }
      }
      return { contact: contactRes.data ?? null, eventsByPlatform };
    },
  });

  const tpl = (tplQuery.data ?? []).find((t) => t.id === pickId);

  const headerInfo = useMemo(() => {
    const comps = Array.isArray(tpl?.components) ? tpl!.components : [];
    const header = comps.find((c: any) => c?.type === "HEADER");
    if (!header) return { kind: "none" as const };
    const fmt = String((header as any).format ?? "").toUpperCase();
    if (fmt === "TEXT") {
      const hasVar = /\{\{\d+\}\}/.test(String((header as any).text ?? ""));
      return { kind: "text" as const, hasVar };
    }
    if (fmt === "IMAGE" || fmt === "VIDEO" || fmt === "DOCUMENT") {
      return { kind: "media" as const, format: fmt as "IMAGE" | "VIDEO" | "DOCUMENT" };
    }
    return { kind: "none" as const };
  }, [tpl]);

  const mediaReady = headerInfo.kind === "media" && !!tpl?.header_media_url;

  useEffect(() => {
    if (!tpl) { setVars([]); setHeaderText(""); return; }
    const count = tpl.variables_count ?? 0;
    const bindings = Array.isArray(tpl.variable_bindings) ? tpl.variable_bindings : [];
    const ctx = {
      contact: prefillQuery.data?.contact ?? null,
      eventsByPlatform: (prefillQuery.data?.eventsByPlatform ?? {}) as Partial<Record<import("@/lib/template-bindings").BindingSource, unknown>>,
    };
    const bodyComp = (tpl.components ?? []).find((c: any) => c.type === "BODY") as any;
    const examples: string[] = bodyComp?.example?.body_text?.[0] ?? [];
    const next = Array.from({ length: count }, (_, i) => {
      const idx = i + 1;
      const binding = bindings.find((b) => b.index === idx);
      if (!binding) return "";
      return resolveBinding(binding, ctx, examples[i]);
    });
    setVars(next);
    setHeaderText("");
  }, [pickId, tpl, prefillQuery.data]);

  async function send() {
    if (!tpl) return;
    if (headerInfo.kind === "media" && !mediaReady) {
      toast.error("Este template tem header de mídia mas não há mídia cadastrada. Edite o template e anexe o arquivo.");
      return;
    }
    if (headerInfo.kind === "text" && headerInfo.hasVar && !headerText.trim()) {
      toast.error("Preencha a variável do header.");
      return;
    }
    setSending(true);
    const { error } = await callFunction("send-message", {
      conversation_id: conversationId,
      type: "template",
      template_id: tpl.id,
      template_name: tpl.name,
      template_language: tpl.language,
      template_variables: vars,
      template_header_text: headerInfo.kind === "text" && headerInfo.hasVar ? headerText : null,
    });
    setSending(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Template enviado");
    onOpenChange(false); onSent();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enviar template aprovado</DialogTitle>
          <DialogDescription>Templates Meta aprovados para este Workspace/Canal.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <TemplateCombobox
            templates={tplQuery.data ?? []}
            value={pickId}
            onChange={setPickId}
            loading={tplQuery.isLoading}
          />
          {!tplQuery.isLoading && (
            (tplQuery.data?.length ?? 0) === 0 ? (
              <p className="text-xs text-destructive">
                Nenhum template aprovado para este canal. Cadastre/aprove em Templates Meta.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {tplQuery.data!.length} template{tplQuery.data!.length === 1 ? "" : "s"} aprovado{tplQuery.data!.length === 1 ? "" : "s"} neste canal.
              </p>
            )
          )}

          {tpl && headerInfo.kind === "media" && (
            mediaReady ? (
              <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                📎 Mídia ({headerInfo.format.toLowerCase()}) do template será enviada automaticamente.
              </div>
            ) : (
              <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-xs text-destructive">
                Este template tem header de {headerInfo.format.toLowerCase()} mas a mídia não está cadastrada.
                Edite o template em Templates Meta e anexe o arquivo.
              </div>
            )
          )}

          {tpl && headerInfo.kind === "text" && headerInfo.hasVar && (
            <Input
              placeholder="Variável do cabeçalho"
              value={headerText}
              onChange={(e) => setHeaderText(e.target.value)}
            />
          )}

          {tpl && tpl.variables_count > 0 && (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">Preencha as variáveis ({tpl.variables_count})</div>
              {vars.map((v, i) => (
                <Input key={i} placeholder={`{{${i + 1}}}`} value={v} onChange={(e) => {
                  const next = [...vars]; next[i] = e.target.value; setVars(next);
                }} />
              ))}
            </div>
          )}

          {tpl && (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Pré-visualização</div>
              <TemplatePreview
                tpl={tpl}
                vars={vars}
                headerText={headerText}
                headerInfo={headerInfo}
              />
            </div>
          )}

          {tplQuery.data && tplQuery.data.length === 0 && (
            <div className="text-xs text-muted-foreground">Nenhum template aprovado encontrado.</div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={send} disabled={!tpl || sending}>Enviar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function renderWithVars(text: string, values: string[]): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /\{\{(\d+)\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={key++}>{text.slice(last, m.index)}</span>);
    const idx = parseInt(m[1], 10) - 1;
    const val = values[idx]?.trim();
    if (val) {
      parts.push(<span key={key++} className="rounded bg-primary/15 px-1 font-medium text-primary">{val}</span>);
    } else {
      parts.push(<span key={key++} className="italic text-muted-foreground">{`{{${idx + 1}}}`}</span>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<span key={key++}>{text.slice(last)}</span>);
  return parts;
}

function TemplatePreview({ tpl, vars, headerText, headerInfo }: {
  tpl: TemplateRow;
  vars: string[];
  headerText: string;
  headerInfo: { kind: "none" } | { kind: "text"; hasVar: boolean } | { kind: "media"; format: "IMAGE" | "VIDEO" | "DOCUMENT" };
}) {
  const components = (tpl.components ?? []) as any[];
  const header = components.find((c) => c.type === "HEADER");
  const body = components.find((c) => c.type === "BODY");
  const footer = components.find((c) => c.type === "FOOTER");
  const buttons = components.find((c) => c.type === "BUTTONS");

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
      {headerInfo.kind === "media" && (
        <div className="mb-2 flex items-center gap-2 rounded bg-background/60 px-2 py-3 text-xs text-muted-foreground">
          📎 {headerInfo.format === "IMAGE" ? "Imagem" : headerInfo.format === "VIDEO" ? "Vídeo" : "Documento"}
        </div>
      )}
      {headerInfo.kind === "text" && header?.text && (
        <div className="mb-1 font-semibold">
          {headerInfo.hasVar ? renderWithVars(String(header.text), [headerText]) : String(header.text)}
        </div>
      )}
      {body?.text && (
        <div className="whitespace-pre-wrap leading-relaxed">
          {renderWithVars(String(body.text), vars)}
        </div>
      )}
      {footer?.text && (
        <div className="mt-2 text-xs text-muted-foreground">{String(footer.text)}</div>
      )}
      {Array.isArray(buttons?.buttons) && buttons.buttons.length > 0 && (
        <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
          {buttons.buttons.map((b: any, i: number) => (
            <div key={i} className="rounded bg-background/60 px-2 py-1 text-center text-xs text-primary">{b.text}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function renderTemplateBody(template: string, vars: string[] | null): string {
  if (!template) return "";
  return template.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => {
    const idx = Number(n) - 1;
    const v = vars?.[idx];
    return v != null && v !== "" ? v : `{{${n}}}`;
  });
}

type TemplateButton = { text: string; type: string; url: string | null; phone_number: string | null };
type TemplateMeta = { body: string | null; headerType: string | null; headerMediaUrl: string | null; buttons: TemplateButton[] };


function Bubble({ m, templateBodyByKey }: { m: MessageRow; templateBodyByKey: Map<string, TemplateMeta> }) {
  const out = m.direction === "outbound";
  const tick =
    m.status === "read" ? "✓✓"
    : m.status === "delivered" ? "✓✓"
    : m.status === "sent" ? "✓"
    : m.status === "failed" ? "!"
    : "";
  const tickColor =
    m.status === "read" ? "text-blue-300"
    : m.status === "failed" ? "text-destructive"
    : "opacity-70";

  const tplMeta =
    m.type === "template" && m.template_name && m.template_language
      ? templateBodyByKey.get(`${m.template_name}::${m.template_language}`) ?? null
      : null;
  const renderedTemplate = tplMeta?.body ? renderTemplateBody(tplMeta.body, m.template_variables) : null;

  // Header de mídia do template: usa SOMENTE o que foi gravado na mensagem.
  // Mensagens antigas sem media_url simplesmente não mostram header — é
  // preferível a exibir a imagem de exemplo aprovada na Meta.
  const tplHeaderUrl = m.type === "template" ? (m.media_url ?? null) : null;
  const tplHeaderTypeRaw = m.type === "template" ? (tplMeta?.headerType ?? "").toString().toUpperCase() : "";
  const tplHeaderKind: "image" | "video" | "document" | null = tplHeaderUrl
    ? (tplHeaderTypeRaw === "IMAGE" ? "image"
      : tplHeaderTypeRaw === "VIDEO" ? "video"
      : tplHeaderTypeRaw === "DOCUMENT" ? "document"
      : "image") // default: assume imagem quando não sabemos o tipo
    : null;


  return (
    <div className={`group flex ${out ? "justify-end" : "justify-start"}`}>
      <div className={`relative max-w-[75%] 2xl:max-w-[60%] rounded-lg px-3 py-2 shadow-sm ${out ? "bg-primary text-primary-foreground" : "bg-card"}`}>
        {m.reply_to_wa_id && (
          <div className={`mb-1 rounded border-l-2 px-2 py-1 text-[11px] ${out ? "border-primary-foreground/40 bg-primary-foreground/10" : "border-primary/40 bg-muted"}`}>
            <Reply className="mr-1 inline h-3 w-3" /> Respondendo a mensagem anterior
          </div>
        )}
        {m.type === "image" && m.media_url && (
          <img src={m.media_url} alt="" className="mb-1 max-h-64 rounded" />
        )}
        {m.type === "video" && m.media_url && (
          <video src={m.media_url} controls className="mb-1 max-h-64 rounded" />
        )}
        {m.type === "audio" && m.media_url && (
          <div className="mb-1">
            <div className="flex items-center gap-2">
              <Mic className="h-3.5 w-3.5" />
              <audio src={m.media_url} controls className="h-8" />
            </div>
            {(m as any).raw?.transcription?.text && (
              <div className="mt-1 flex items-start gap-1 text-xs italic opacity-70">
                <span aria-hidden>🎙️</span>
                <span>{(m as any).raw.transcription.text}</span>
              </div>
            )}
          </div>
        )}
        {m.type === "document" && m.media_url && (
          <a href={m.media_url} target="_blank" rel="noreferrer" className="mb-1 flex items-center gap-2 rounded bg-background/20 px-2 py-1.5 text-xs underline">
            <FileText className="h-3.5 w-3.5" /> {m.media_filename ?? "Documento"}
          </a>
        )}
        {m.type === "template" && (
          <>
            {tplHeaderUrl && tplHeaderKind === "image" && (
              <img src={tplHeaderUrl} alt="" className="mb-1 max-h-64 rounded" />
            )}
            {tplHeaderUrl && tplHeaderKind === "video" && (
              <video src={tplHeaderUrl} controls className="mb-1 max-h-64 rounded" />
            )}
            {tplHeaderUrl && tplHeaderKind === "document" && (
              <a href={tplHeaderUrl} target="_blank" rel="noreferrer" className="mb-1 flex items-center gap-2 rounded bg-background/20 px-2 py-1.5 text-xs underline">
                <FileText className="h-3.5 w-3.5" /> {m.media_filename ?? "Documento"}
              </a>
            )}
            <div className="mb-1 text-[10px] uppercase opacity-70">📋 Template · {m.template_name}</div>
            {renderedTemplate && (
              <div className="whitespace-pre-wrap break-words text-sm">{renderedTemplate}</div>
            )}
            {tplMeta?.buttons && tplMeta.buttons.length > 0 && (
              <div className={`mt-2 flex flex-col gap-1 border-t pt-2 ${out ? "border-primary-foreground/20" : "border-border"}`}>
                {tplMeta.buttons.map((b, i) => {
                  const icon = b.type === "URL" ? "🔗" : b.type === "PHONE_NUMBER" ? "📞" : "↩";
                  return (
                    <div
                      key={i}
                      className={`flex items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs ${out ? "bg-primary-foreground/10 text-primary-foreground" : "bg-muted text-primary"}`}
                    >
                      <span className="opacity-70">{icon}</span>
                      <span>{b.text}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
        {(() => {
          const isButtonReply = m.direction === "inbound" && (m.type === "button" || m.type === "interactive");
          if (!isButtonReply) {
            return m.content ? (
              <div className="whitespace-pre-wrap break-words text-sm">{m.content}</div>
            ) : null;
          }
          // raw pode vir como objeto (jsonb) ou string — normaliza
          let raw: any = m.raw;
          if (typeof raw === "string") {
            try { raw = JSON.parse(raw); } catch { raw = null; }
          }
          const fallback =
            m.content
            ?? raw?.button?.text
            ?? raw?.interactive?.button_reply?.title
            ?? raw?.interactive?.list_reply?.title
            ?? raw?.button_reply?.title
            ?? null;
          return (
            <div>
              <div className="mb-0.5 flex items-center gap-1 text-[10px] uppercase opacity-70">
                <Reply className="h-3 w-3" /> Resposta de botão
              </div>
              <div className="whitespace-pre-wrap break-words text-sm font-medium">
                {fallback ?? <span className="italic opacity-70">(botão sem título)</span>}
              </div>
            </div>
          );
        })()}


        <div className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${out ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
          {new Date(m.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          {tick && <span className={tickColor}>{tick}</span>}
        </div>
        {m.status === "failed" && (
          <div className={`mt-1.5 rounded border ${out ? "border-destructive/40 bg-destructive/10 text-destructive-foreground" : "border-destructive/40 bg-destructive/5"} px-2 py-1 text-[11px] text-destructive`}>
            <div className="font-medium">❌ Não entregue</div>
            <div className="opacity-90">{m.error_message || "Falha desconhecida ao enviar."}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-border px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

function Field({ icon, label, value }: { icon?: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex items-start gap-2 text-xs">
      {icon && <span className="mt-0.5 text-muted-foreground">{icon}</span>}
      <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{value}</span>
    </div>
  );
}

function EditableContactField({
  icon, label, value, placeholder, type = "text", onSave,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  placeholder?: string;
  type?: string;
  onSave: (v: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

  const submit = async () => {
    if (saving) return;
    if (draft === value) { setEditing(false); return; }
    setSaving(true);
    try {
      await onSave(draft);
      toast.success(`${label} atualizado`);
      setEditing(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="group mb-1.5 flex items-start gap-2 text-xs">
      {icon && <span className="mt-0.5 text-muted-foreground">{icon}</span>}
      <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
      {editing ? (
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <Input
            autoFocus
            type={type}
            value={draft}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); void submit(); }
              if (e.key === "Escape") { e.preventDefault(); setEditing(false); setDraft(value); }
            }}
            className="h-7 text-xs"
            disabled={saving}
          />
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => void submit()} disabled={saving}>
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditing(false); setDraft(value); }} disabled={saving}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <>
          <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">
            {value || <span className="text-muted-foreground">{placeholder ?? "—"}</span>}
          </span>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="opacity-0 transition-opacity group-hover:opacity-100"
            aria-label={`Editar ${label}`}
          >
            <Pencil className="h-3 w-3 text-muted-foreground hover:text-foreground" />
          </button>
        </>
      )}
    </div>
  );
}
