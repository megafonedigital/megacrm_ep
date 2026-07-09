import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useServerFn } from "@tanstack/react-start";
import { getPipelineOwners } from "@/lib/pipeline-owners.functions";
import { countPendingByPipeline } from "@/lib/pipeline-activities.functions";
import { transferConversation, bulkTransferConversations } from "@/lib/conversations-transfer.functions";


import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent, useDroppable, useDraggable,
} from "@dnd-kit/core";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { avatarColor } from "@/lib/avatar-color";
import { ArrowLeft, Loader2, Plus, RefreshCw, Settings, UserPlus, Trash2, MessageSquare, Users, Check, X, MoreVertical, ChevronDown, CheckCircle2, RotateCcw, Calendar as CalendarIcon, Zap, XCircle, ArrowRightLeft } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { formatPhoneDisplay } from "@/lib/phone";
import { StagesManagerDialog } from "@/components/pipelines/StagesManagerDialog";
import { AddContactDialog } from "@/components/pipelines/AddContactDialog";
import { ContactFilterCombobox, type ContactSearchResult } from "@/components/contacts/ContactFilterCombobox";
import { searchPipelineContacts, getPipelineContactById } from "@/lib/pipeline-search.functions";
import { TagFilterCombobox, type TagFilterValue } from "@/components/contacts/TagFilterCombobox";
import { useTagFilterContactIds } from "@/lib/tag-filter";
import {
  usePipelineContactIndex,
  useStageCards,
  type PipelineCard,
  type PipelineContactIndexEntry,
} from "@/lib/pipeline-cards";
import { ContactChatDialog } from "@/components/pipelines/ContactChatDialog";
import { MoveToPipelineDialog } from "@/components/pipelines/MoveToPipelineDialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/pipelines/$id")({
  component: PipelineBoard,
});

interface Stage { id: string; name: string; color: string | null; position: number; on_enter_status?: "none" | "resolvido" | "perdido" }
type CardStatus = "aberto" | "resolvido" | "perdido";
// Re-export local Card alias for backwards compatibility in this file
type Card = PipelineCard;

function PipelineBoard() {
  const { id } = Route.useParams();
  const { me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canManage = !!(me?.isAdmin || me?.isSupervisor || me?.isDeveloper);
  const [stagesOpen, setStagesOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [addContactOpen, setAddContactOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openContext, setOpenContext] = useState<{ contactId: string; stageId: string } | null>(null);
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [moveCard, setMoveCard] = useState<{ contactId: string; contactName: string | null } | null>(null);

  function toggleCardSelection(cardId: string) {
    setSelectedCardIds((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  }
  function clearSelection() { setSelectedCardIds(new Set()); }
  function toggleSelectAllInStage(stageCardIds: string[]) {
    setSelectedCardIds((prev) => {
      const next = new Set(prev);
      const allSelected = stageCardIds.length > 0 && stageCardIds.every((id) => next.has(id));
      if (allSelected) stageCardIds.forEach((id) => next.delete(id));
      else stageCardIds.forEach((id) => next.add(id));
      return next;
    });
  }
  function selectFirstNInStage(stageCardIds: string[], n: number) {
    setSelectedCardIds((prev) => {
      const next = new Set(prev);
      stageCardIds.forEach((id) => next.delete(id));
      stageCardIds.slice(0, Math.max(0, Math.min(n, stageCardIds.length))).forEach((id) => next.add(id));
      return next;
    });
  }

  const { data: pipeline } = useQuery({
    queryKey: ["pipeline", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipelines")
        .select("id, name, brand_id, description, brand:brand_id(name)")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: stages, isLoading: loadingStages } = useQuery({
    queryKey: ["pipeline-stages", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipeline_stages")
        .select("id, name, color, position, on_enter_status")
        .eq("pipeline_id", id)
        .order("position");
      if (error) throw error;
      return (data ?? []) as Stage[];
    },
  });

  const countPendingFn = useServerFn(countPendingByPipeline);
  const { data: pendingByCard } = useQuery({
    queryKey: ["pipeline-activity-counts", id],
    queryFn: () => countPendingFn({ data: { pipelineId: id } }),
    refetchInterval: 30000,
  });



  // Índice leve com TODOS os pipeline_contacts (sem o join pesado de contato).
  // Fonte de verdade para contagem por etapa, seleção, filtros e DnD.
  const { data: indexData } = usePipelineContactIndex(id);
  const contactIndex = useMemo<PipelineContactIndexEntry[]>(() => indexData ?? [], [indexData]);
  const entryById = useMemo(() => {
    const m = new Map<string, PipelineContactIndexEntry>();
    contactIndex.forEach((e) => m.set(e.id, e));
    return m;
  }, [contactIndex]);
  const allContactIds = useMemo(
    () => Array.from(new Set(contactIndex.map((e) => e.contact_id))),
    [contactIndex],
  );
  const brandId = (pipeline as any)?.brand_id as string | undefined;

  // Realtime: atualiza badge de não lidas e donos quando chegam mensagens/conversas mudam
  useEffect(() => {
    if (!brandId) return;
    const invalidateBoard = () => {
      qc.invalidateQueries({ queryKey: ["pipeline-owners", id] });
      qc.invalidateQueries({ queryKey: ["pipeline-contact-index", id] });
      qc.invalidateQueries({ queryKey: ["pipeline-stage-cards", id] });
    };
    const channel = supabase
      .channel(`pipeline-board-${id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `brand_id=eq.${brandId}` },
        invalidateBoard,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "conversations", filter: `brand_id=eq.${brandId}` },
        invalidateBoard,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pipeline_contacts", filter: `brand_id=eq.${brandId}` },
        invalidateBoard,
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [brandId, id, qc]);


  // Mapa contact_id -> { assigned_to, assigned_name } via server fn (bypassa RLS).
  // Agora cobre TODOS os contatos do pipeline (usando o índice leve).
  const fetchPipelineOwners = useServerFn(getPipelineOwners);
  const transferFn = useServerFn(transferConversation);
  const bulkTransferFn = useServerFn(bulkTransferConversations);
  const searchPipelineContactsFn = useServerFn(searchPipelineContacts);
  const getPipelineContactByIdFn = useServerFn(getPipelineContactById);
  const { data: ownersData, error: ownersError } = useQuery({
    queryKey: ["pipeline-owners", id, brandId, allContactIds.length, allContactIds[0] ?? null, allContactIds[allContactIds.length - 1] ?? null],
    enabled: !!brandId && allContactIds.length > 0,
    queryFn: async () => {
      const res = await fetchPipelineOwners({ data: { brandId: brandId!, contactIds: allContactIds } });
      return res.owners;
    },
  });
  useEffect(() => {
    if (ownersError) {
      console.error("[pipeline-owners] failed:", ownersError);
      toast.error("Falha ao carregar donos dos cartões: " + (ownersError as any)?.message);
    }
  }, [ownersError]);
  const ownerByContact = useMemo(() => {
    const m = new Map<string, string | null>();
    (ownersData ?? []).forEach((o) => m.set(o.contact_id, o.assigned_to));
    return m;
  }, [ownersData]);
  const ownerNameFromData = useMemo(() => {
    const m = new Map<string, string>();
    (ownersData ?? []).forEach((o) => {
      if (o.assigned_to && o.assigned_name) m.set(o.assigned_to, o.assigned_name);
    });
    return m;
  }, [ownersData]);
  const unreadByContact = useMemo(() => {
    const m = new Map<string, number>();
    (ownersData ?? []).forEach((o) => {
      const u = (o as { unread_count?: number }).unread_count ?? 0;
      if (u > 0) m.set(o.contact_id, u);
    });
    return m;
  }, [ownersData]);


  // Lista de agentes da workspace para o filtro
  const { data: brandAgents } = useQuery({
    queryKey: ["pipeline-brand-agents", brandId],
    enabled: !!brandId && canManage,
    queryFn: async () => {
      const ids = new Set<string>();
      const { data: channels } = await supabase
        .from("brand_channels")
        .select("id")
        .eq("brand_id", brandId!);
      const channelIds = (channels ?? []).map((c: any) => c.id);
      if (channelIds.length > 0) {
        const { data: ags } = await supabase
          .from("channel_agents")
          .select("user_id")
          .in("channel_id", channelIds);
        (ags ?? []).forEach((r: any) => r.user_id && ids.add(r.user_id));
      }

      let users: Array<{ id: string; full_name: string | null; kind: "user" | "ai" }> = [];
      if (ids.size > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", Array.from(ids))
          .eq("active", true);
        users = ((profs ?? []) as Array<{ id: string; full_name: string | null }>).map((p) => ({
          id: p.id,
          full_name: p.full_name,
          kind: "user" as const,
        }));
      }

      const { data: aiAgents } = await supabase
        .from("ai_agents")
        .select("id, name")
        .eq("brand_id", brandId!);
      const ais: Array<{ id: string; full_name: string | null; kind: "user" | "ai" }> = (aiAgents ?? []).map((a: any) => ({
        id: a.id,
        full_name: a.name,
        kind: "ai" as const,
      }));

      return [...users, ...ais].sort((a, b) =>
        (a.full_name ?? "").localeCompare(b.full_name ?? "")
      );
    },
  });

  // Filtro: Set de agentes selecionados; "__none__" representa "sem dono"
  const [ownerFilter, setOwnerFilter] = useState<Set<string>>(new Set());
  const [contactFilter, setContactFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<TagFilterValue>({ tagId: null, noTag: false });
  // Status: por padrão mostra apenas "aberto"
  const [statusFilter, setStatusFilter] = useState<Set<CardStatus>>(new Set(["aberto"]));
  // Data (created_at do cartão)
  const [dateRange, setDateRange] = useState<{ from?: Date; to?: Date }>({});
  const pipelineBrandId = (pipeline as any)?.brand_id ?? null;
  const tagFilterRes = useTagFilterContactIds(pipelineBrandId, tagFilter);
  const agentNameById = useMemo(() => {
    const m = new Map<string, string>();
    (brandAgents ?? []).forEach((a) => m.set(a.id, a.full_name ?? "Sem nome"));
    // Inclui também os donos vindos dos cartões (caso não estejam na lista de filtro)
    ownerNameFromData.forEach((name, id) => { if (!m.has(id)) m.set(id, name); });
    return m;
  }, [brandAgents, ownerNameFromData]);

  // Resolve todos os filtros ativos em um conjunto único de pipeline_contact.id permitidos.
  // - Sem filtro ativo: null (sem restrição).
  // - Com filtro(s): interseção dos conjuntos.
  const filterAllowedCardIds = useMemo<Set<string> | null>(() => {
    const sets: Set<string>[] = [];

    if (contactFilter) {
      const s = new Set<string>();
      for (const e of contactIndex) if (e.contact_id === contactFilter) s.add(e.id);
      sets.push(s);
    }

    if (tagFilterRes.active) {
      const tagIds = tagFilterRes.contactIds;
      const s = new Set<string>();
      if (tagIds) for (const e of contactIndex) if (tagIds.has(e.contact_id)) s.add(e.id);
      sets.push(s);
    }

    if (ownerFilter.size > 0) {
      const s = new Set<string>();
      for (const e of contactIndex) {
        const owner = ownerByContact.get(e.contact_id) ?? null;
        const key = owner ?? "__none__";
        if (ownerFilter.has(key)) s.add(e.id);
      }
      sets.push(s);
    }

    // Status: sempre ativo (mesmo que default seja só "aberto")
    if (statusFilter.size > 0 && statusFilter.size < 3) {
      const s = new Set<string>();
      for (const e of contactIndex) if (statusFilter.has(e.status)) s.add(e.id);
      sets.push(s);
    }

    // Data: created_at do cartão
    if (dateRange.from || dateRange.to) {
      const fromTs = dateRange.from ? new Date(dateRange.from).setHours(0, 0, 0, 0) : -Infinity;
      const toTs = dateRange.to ? new Date(dateRange.to).setHours(23, 59, 59, 999) : Infinity;
      const s = new Set<string>();
      for (const e of contactIndex) {
        const t = new Date(e.created_at).getTime();
        if (t >= fromTs && t <= toTs) s.add(e.id);
      }
      sets.push(s);
    }

    if (sets.length === 0) return null;
    const [first, ...rest] = sets;
    const out = new Set<string>();
    for (const x of first) if (rest.every((r) => r.has(x))) out.add(x);
    return out;
  }, [contactFilter, tagFilterRes.active, tagFilterRes.contactIds, ownerFilter, statusFilter, dateRange, contactIndex, ownerByContact]);

  // Assinatura estável do filtro para uso em queryKey dos cards por etapa.
  const filterKey = useMemo(() => {
    if (!filterAllowedCardIds) return "none";
    return `f:${filterAllowedCardIds.size}`;
  }, [filterAllowedCardIds]);

  // Mapa etapa -> lista de pipeline_contact.id (ordenados por position), já filtrados.
  // Cartões com mensagens não lidas vão para o topo (mantendo ordem relativa).
  const stageCardIdsByStage = useMemo(() => {
    const m = new Map<string, string[]>();
    (stages ?? []).forEach((s) => m.set(s.id, []));
    for (const e of contactIndex) {
      if (filterAllowedCardIds && !filterAllowedCardIds.has(e.id)) continue;
      const arr = m.get(e.stage_id);
      if (arr) arr.push(e.id);
    }
    // Reordena cada etapa: não lidas primeiro (ordem original preservada entre si)
    for (const [stageId, ids] of m) {
      const unread: string[] = [];
      const read: string[] = [];
      for (const cid of ids) {
        const entry = entryById.get(cid);
        const contactId = entry?.contact_id;
        if (contactId && (unreadByContact.get(contactId) ?? 0) > 0) unread.push(cid);
        else read.push(cid);
      }
      m.set(stageId, [...unread, ...read]);
    }
    return m;
  }, [contactIndex, stages, filterAllowedCardIds, entryById, unreadByContact]);

  // Contact ids por etapa (para sibling navigation no chat) — segue ordem dos cards.
  const stageContactIdsByStage = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const [stageId, cardIds] of stageCardIdsByStage) {
      const arr: string[] = [];
      for (const cid of cardIds) {
        const entry = entryById.get(cid);
        if (entry) arr.push(entry.contact_id);
      }
      m.set(stageId, arr);
    }
    return m;
  }, [stageCardIdsByStage, entryById]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Cartão ativo (para o DragOverlay). Buscamos pelos caches das páginas carregadas.
  const activeCard = useMemo<Card | null>(() => {
    if (!activeId) return null;
    const queries = qc.getQueriesData<{ pages: PipelineCard[][] }>({ queryKey: ["pipeline-stage-cards", id] });
    for (const [, data] of queries) {
      if (!data || !data.pages) continue;
      for (const page of data.pages) {
        const found = page.find((c) => c.id === activeId);
        if (found) return found as Card;
      }
    }
    return null;
  }, [activeId, qc, id]);

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function invalidateStageCards(stageId: string) {
    qc.invalidateQueries({ queryKey: ["pipeline-stage-cards", id, stageId] });
  }
  function invalidateAllStageCards() {
    qc.invalidateQueries({ queryKey: ["pipeline-stage-cards", id] });
  }
  function invalidateIndex() {
    qc.invalidateQueries({ queryKey: ["pipeline-contact-index", id] });
  }

  async function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const cardId = String(e.active.id);
    const overId = e.over?.id ? String(e.over.id) : null;
    if (!overId) return;
    const source = entryById.get(cardId);
    if (!source) return;
    const targetStageId = (stages ?? []).some((s) => s.id === overId)
      ? overId
      : entryById.get(overId)?.stage_id;
    if (!targetStageId || targetStageId === source.stage_id) return;

    // Optimistic: atualiza o índice em cache para refletir nas colunas imediatamente.
    qc.setQueryData<PipelineContactIndexEntry[]>(["pipeline-contact-index", id], (prev) =>
      (prev ?? []).map((x) => (x.id === cardId ? { ...x, stage_id: targetStageId } : x)),
    );

    const { error } = await supabase
      .from("pipeline_contacts")
      .update({ stage_id: targetStageId, moved_by: me?.userId ?? null, moved_at: new Date().toISOString() })
      .eq("id", cardId);
    if (error) {
      toast.error(error.message);
      invalidateIndex();
    }
    // Atualiza páginas carregadas das duas etapas envolvidas.
    invalidateStageCards(source.stage_id);
    invalidateStageCards(targetStageId);
  }

  async function removeCard(cardId: string) {
    const entry = entryById.get(cardId);
    const { error } = await supabase.from("pipeline_contacts").delete().eq("id", cardId);
    if (error) toast.error(error.message);
    else {
      toast.success("Contato removido do pipeline");
      invalidateIndex();
      if (entry) invalidateStageCards(entry.stage_id);
    }
  }

  async function setCardStatus(cardId: string, status: CardStatus) {
    const entry = entryById.get(cardId);
    // Otimista
    qc.setQueryData<PipelineContactIndexEntry[]>(["pipeline-contact-index", id], (prev) =>
      (prev ?? []).map((x) => (x.id === cardId ? { ...x, status } : x)),
    );
    const { error } = await supabase
      .from("pipeline_contacts")
      .update({ status } as any)
      .eq("id", cardId);
    if (error) {
      toast.error(error.message);
      invalidateIndex();
      return;
    }
    toast.success(status === "resolvido" ? "Cartão resolvido" : status === "perdido" ? "Cartão marcado como perdido" : "Cartão reaberto");
    if (entry) invalidateStageCards(entry.stage_id);
  }


  async function bulkMoveToStage(targetStageId: string) {
    const ids = Array.from(selectedCardIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    const { error } = await supabase
      .from("pipeline_contacts")
      .update({ stage_id: targetStageId, moved_by: me?.userId ?? null, moved_at: new Date().toISOString() })
      .in("id", ids);
    setBulkBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${ids.length} cartão(ões) movido(s)`);
    clearSelection();
    invalidateIndex();
    invalidateAllStageCards();
  }

  async function bulkSetStatus(status: CardStatus) {
    const ids = Array.from(selectedCardIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    const { error } = await supabase
      .from("pipeline_contacts")
      .update({ status } as any)
      .in("id", ids);
    setBulkBusy(false);
    if (error) { toast.error(error.message); return; }
    const verb = status === "resolvido" ? "resolvido(s)" : status === "perdido" ? "marcado(s) como perdido" : "reaberto(s)";
    toast.success(`${ids.length} cartão(ões) ${verb}`);
    clearSelection();
    invalidateIndex();
    invalidateAllStageCards();
  }



  async function bulkAssignOwner(agentId: string | null, kind: "user" | "ai" = "user") {
    const ids = Array.from(selectedCardIds);
    const contactIds = Array.from(
      new Set(ids.map((cid) => entryById.get(cid)?.contact_id).filter((x): x is string => !!x)),
    );
    if (contactIds.length === 0 || !brandId) return;
    setBulkBusy(true);
    // Conversa mais recente de cada contato no workspace
    const { data: convs, error: convErr } = await supabase
      .from("conversations")
      .select("id, contact_id, last_message_at")
      .eq("brand_id", brandId)
      .in("contact_id", contactIds)
      .order("last_message_at", { ascending: false, nullsFirst: false });
    if (convErr) { setBulkBusy(false); toast.error(convErr.message); return; }
    const latestByContact = new Map<string, string>();
    for (const row of (convs ?? []) as Array<{ id: string; contact_id: string }>) {
      if (!latestByContact.has(row.contact_id)) latestByContact.set(row.contact_id, row.id);
    }
    const convIds = Array.from(latestByContact.values());
    if (convIds.length === 0) {
      setBulkBusy(false);
      toast.error("Nenhum contato selecionado tem conversa para atribuir.");
      return;
    }
    let updated = 0;
    let failed = 0;
    try {
      const res = await bulkTransferFn({
        data: {
          conversationIds: convIds,
          targetId: agentId,
          kind: agentId === null ? undefined : kind,
        },
      });
      updated = res.updated;
      failed = (res as { failed?: number }).failed ?? 0;
    } catch (e) {
      console.error("[bulkAssignOwner]", (e as Error).message);
      failed = convIds.length;
    }
    setBulkBusy(false);
    if (failed > 0 && updated === 0) {
      toast.error("Falha ao atribuir");
    } else if (updated < convIds.length) {
      toast.warning(`${updated} de ${convIds.length} atribuído(s) (${convIds.length - updated} ignorado(s))`);
    } else {
      toast.success(agentId ? (kind === "ai" ? "Agente de IA atribuído" : "Dono atribuído") : "Dono removido");
    }
    clearSelection();
    qc.invalidateQueries({ queryKey: ["pipeline-owners", id] });
  }

  async function bulkRemove() {
    const ids = Array.from(selectedCardIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    const { error } = await supabase.from("pipeline_contacts").delete().in("id", ids);
    setBulkBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${ids.length} contato(s) removido(s) do pipeline`);
    clearSelection();
    invalidateIndex();
    invalidateAllStageCards();
  }

  if (loadingStages) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button size="icon" variant="ghost" onClick={() => navigate({ to: "/pipelines" })}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">{pipeline?.name ?? "Pipeline"}</h1>
            <p className="truncate text-xs text-muted-foreground">{(pipeline as any)?.brand?.name ?? ""}</p>
          </div>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => setAddContactOpen(true)}>
            <UserPlus className="mr-2 h-4 w-4" /> Adicionar contato
          </Button>
        )}
      </div>

      <div className="flex items-center gap-1 border-b border-border bg-card px-4 py-2">
        <ContactFilterCombobox
          value={contactFilter}
          onChange={setContactFilter}
          brandId={(pipeline as any)?.brand_id ?? null}
          minChars={1}
          placeholder="Buscar contato no pipeline…"
          searchFn={async (s) => {
            const res = await searchPipelineContactsFn({ data: { pipelineId: id, search: s, limit: 30 } });
            return res.contacts as ContactSearchResult[];
          }}
          fetchSelectedFn={async (cid) => {
            const res = await getPipelineContactByIdFn({ data: { pipelineId: id, contactId: cid } });
            return (res.contact ?? null) as ContactSearchResult | null;
          }}
        />
        <div className="mx-1 h-6 w-px bg-border" />
        <DateFilter value={dateRange} onChange={setDateRange} />
        <FilterChipPlaceholder label="Campos" />
        <TagFilterCombobox value={tagFilter} onChange={setTagFilter} brandId={pipelineBrandId} />
        {canManage && (
          <OwnerFilter
            agents={brandAgents ?? []}
            value={ownerFilter}
            onChange={setOwnerFilter}
          />
        )}
        <StatusFilter value={statusFilter} onChange={setStatusFilter} />
        <FilterChipPlaceholder label="Mais filtros" />
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            setRefreshing(true);
            try {
              await Promise.all([
                qc.invalidateQueries({ queryKey: ["pipeline", id] }),
                qc.invalidateQueries({ queryKey: ["pipeline-stages", id] }),
                qc.invalidateQueries({ queryKey: ["pipeline-contact-index", id] }),
                qc.invalidateQueries({ queryKey: ["pipeline-stage-cards", id] }),
                qc.invalidateQueries({ queryKey: ["contact-tags-index"] }),
              ]);
            } finally {
              setRefreshing(false);
            }
          }}
          disabled={refreshing}
          className="mr-2"
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /> Atualizar
        </Button>
        {canManage && (
          <Button variant="outline" size="sm" onClick={() => setStagesOpen(true)}>
            <Settings className="mr-2 h-4 w-4" /> Gerenciar etapas
          </Button>
        )}
      </div>


      <div className="flex-1 overflow-x-auto overflow-y-hidden bg-muted/30">
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="flex h-full min-w-max gap-3 p-4">
            {(stages ?? []).length === 0 ? (
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                Nenhuma etapa criada. {canManage && "Clique em \"Gerenciar etapas\" para começar."}
              </div>
            ) : (
              (stages ?? []).map((s) => {
                const stageCardIds = stageCardIdsByStage.get(s.id) ?? [];
                const stageContactIds = stageContactIdsByStage.get(s.id) ?? [];
                return (
                  <StageColumn
                    key={s.id}
                    pipelineId={id}
                    stage={s}
                    stageCardIds={stageCardIds}
                    stageContactIds={stageContactIds}
                    filterKey={filterKey}
                    ownerByContact={ownerByContact}
                    agentNameById={agentNameById}
                    selectedCardIds={selectedCardIds}
                    onToggleSelect={toggleCardSelection}
                    onToggleSelectAll={toggleSelectAllInStage}
                    onSelectFirstN={selectFirstNInStage}
                    onRemoveCard={removeCard}
                    onSetCardStatus={setCardStatus}
                    onMoveCard={(contactId, contactName) => setMoveCard({ contactId, contactName })}
                    entryById={entryById}
                    pendingByCard={pendingByCard}
                    unreadByContact={unreadByContact}
                    onOpenCard={(contactId, stageId) => setOpenContext({ contactId, stageId })}

                  />
                );
              })
            )}
          </div>
          <DragOverlay>
            {activeCard ? <CardView card={activeCard} dragging /> : null}
          </DragOverlay>
        </DndContext>
      </div>

      {selectedCardIds.size > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-lg">
            <span className="text-sm font-medium">
              {selectedCardIds.size} selecionado(s)
            </span>
            <span className="mx-1 h-4 w-px bg-border" />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={bulkBusy}>Mover para etapa</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center">
                <DropdownMenuLabel>Selecione a etapa</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {(stages ?? []).map((s) => (
                  <DropdownMenuItem key={s.id} onClick={() => bulkMoveToStage(s.id)}>
                    <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: s.color ?? "#94a3b8" }} />
                    {s.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {canManage && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" disabled={bulkBusy}>Atribuir dono</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center" className="max-h-72 overflow-y-auto">
                  <DropdownMenuLabel>Selecione o agente</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => bulkAssignOwner(null)}>
                    <span className="text-muted-foreground">Sem dono</span>
                  </DropdownMenuItem>
                  {(brandAgents ?? []).filter((a) => a.kind === "user").map((a) => (
                    <DropdownMenuItem key={`u-${a.id}`} onClick={() => bulkAssignOwner(a.id, "user")}>
                      {a.full_name ?? "Sem nome"}
                    </DropdownMenuItem>
                  ))}
                  {(brandAgents ?? []).some((a) => a.kind === "ai") && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>Agentes de IA</DropdownMenuLabel>
                      {(brandAgents ?? []).filter((a) => a.kind === "ai").map((a) => (
                        <DropdownMenuItem key={`ai-${a.id}`} onClick={() => bulkAssignOwner(a.id, "ai")}>
                          <span className="mr-2 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">IA</span>
                          {a.full_name ?? "Sem nome"}
                        </DropdownMenuItem>
                      ))}
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={bulkBusy}>Status</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center">
                <DropdownMenuItem onClick={() => bulkSetStatus("resolvido")}>Resolver</DropdownMenuItem>
                <DropdownMenuItem onClick={() => bulkSetStatus("perdido")}>Marcar como Perdido</DropdownMenuItem>
                <DropdownMenuItem onClick={() => bulkSetStatus("aberto")}>Reabrir</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button size="sm" variant="destructive" disabled={bulkBusy} onClick={bulkRemove}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remover
            </Button>


            <Button size="sm" variant="ghost" onClick={clearSelection} disabled={bulkBusy}>
              <X className="mr-1 h-3.5 w-3.5" /> Limpar
            </Button>
          </div>
        </div>
      )}
      {canManage && (
        <StagesManagerDialog
          open={stagesOpen}
          onOpenChange={setStagesOpen}
          pipelineId={id}
          brandId={(pipeline as any)?.brand_id}
          stages={stages ?? []}
          onChanged={() => qc.invalidateQueries({ queryKey: ["pipeline-stages", id] })}
        />
      )}
      {addContactOpen && pipeline && (
        <AddContactDialog
          open={addContactOpen}
          onOpenChange={setAddContactOpen}
          pipelineId={id}
          brandId={(pipeline as any).brand_id}
          stages={(stages ?? []).map((s) => ({ id: s.id, name: s.name, color: s.color }))}
          existingContactIds={allContactIds}
          onAdded={() => {
            invalidateIndex();
            invalidateAllStageCards();
            setAddContactOpen(false);
          }}
        />
      )}
      {pipeline && (() => {
        const liveSiblings = openContext
          ? stageContactIdsByStage.get(openContext.stageId) ?? []
          : [];
        // Auto-advance: se o contato atual saiu da lista filtrada (ex.: virou "resolvido"),
        // pula para o próximo contato disponível, ou fecha o diálogo.
        if (openContext && liveSiblings.length > 0 && !liveSiblings.includes(openContext.contactId)) {
          queueMicrotask(() => {
            setOpenContext((prev) => {
              if (!prev) return prev;
              const sibs = stageContactIdsByStage.get(prev.stageId) ?? [];
              if (sibs.length === 0) return null;
              if (sibs.includes(prev.contactId)) return prev;
              return { ...prev, contactId: sibs[0] };
            });
          });
        } else if (openContext && liveSiblings.length === 0) {
          queueMicrotask(() => setOpenContext(null));
        }
        return (
          <ContactChatDialog
            open={!!openContext}
            onOpenChange={(o) => !o && setOpenContext(null)}
            contactId={openContext?.contactId ?? null}
            siblingContactIds={liveSiblings}
            onContactIdChange={(id) =>
              setOpenContext((prev) => (prev ? { ...prev, contactId: id } : prev))
            }
            brandId={(pipeline as any).brand_id}
          />
        );
      })()}
      {pipeline && moveCard && brandId && (
        <MoveToPipelineDialog
          open={!!moveCard}
          onOpenChange={(o) => { if (!o) setMoveCard(null); }}
          brandId={brandId}
          contactId={moveCard.contactId}
          contactName={moveCard.contactName}
          moveFromPipelineId={id}
          onMoved={() => setMoveCard(null)}
        />
      )}
    </div>
  );
}

function StageColumn({
  pipelineId, stage, stageCardIds, stageContactIds, filterKey,
  ownerByContact, agentNameById, selectedCardIds, entryById, pendingByCard, unreadByContact,
  onToggleSelect, onToggleSelectAll, onSelectFirstN, onRemoveCard, onSetCardStatus, onMoveCard, onOpenCard,
}: {
  pipelineId: string;
  stage: Stage;
  stageCardIds: string[];
  stageContactIds: string[];
  filterKey: string;
  ownerByContact?: Map<string, string | null>;
  agentNameById: Map<string, string>;
  selectedCardIds: Set<string>;
  entryById: Map<string, PipelineContactIndexEntry>;
  pendingByCard?: Record<string, { pending: number; overdue: number }>;
  unreadByContact?: Map<string, number>;
  onToggleSelect: (cardId: string) => void;
  onToggleSelectAll: (stageCardIds: string[]) => void;
  onSelectFirstN: (stageCardIds: string[], n: number) => void;
  onRemoveCard: (id: string) => void;
  onSetCardStatus: (id: string, status: CardStatus) => void;
  onMoveCard: (contactId: string, contactName: string | null) => void;
  onOpenCard: (contactId: string, stageId: string) => void;
}) {

  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const totalCount = stageCardIds.length;
  const selectedInStage = stageCardIds.filter((id) => selectedCardIds.has(id)).length;
  const allSelected = totalCount > 0 && selectedInStage === totalCount;
  const [selectMenuOpen, setSelectMenuOpen] = useState(false);
  const [selectN, setSelectN] = useState<number>(0);

  const stageQuery = useStageCards(pipelineId, stage.id, stageCardIds, filterKey);
  const loadedCards = useMemo<Card[]>(
    () => (stageQuery.data?.pages ?? []).flat() as Card[],
    [stageQuery.data],
  );

  return (
    <div className="flex h-full w-72 shrink-0 flex-col rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: stage.color ?? "#94a3b8" }} />
          <span className="truncate text-sm font-medium">{stage.name}</span>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{totalCount}</span>
        </div>
        <Popover open={selectMenuOpen} onOpenChange={(o) => { setSelectMenuOpen(o); if (o) setSelectN(Math.min(10, totalCount)); }}>
          <PopoverTrigger asChild>
            <Button size="icon" variant="ghost" className="h-7 w-7" title="Opções">
              <MoreVertical className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 p-3">
            <button
              type="button"
              disabled={totalCount === 0}
              className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => { onToggleSelectAll(stageCardIds); setSelectMenuOpen(false); }}
            >
              {allSelected ? "Desmarcar todos" : "Selecionar todos"}
            </button>
            <div className="my-2 h-px bg-border" />
            <div className="px-2 text-xs text-muted-foreground">Selecionar os primeiros</div>
            <div className="mt-1 flex items-center gap-2 px-2">
              <Input
                type="number"
                min={0}
                max={totalCount}
                value={selectN}
                disabled={totalCount === 0}
                onChange={(e) => setSelectN(Math.max(0, Math.min(totalCount, Number(e.target.value) || 0)))}
                className="h-8 w-20"
              />
              <span className="text-xs text-muted-foreground">de {totalCount}</span>
              <Button
                size="sm"
                className="ml-auto h-8"
                disabled={totalCount === 0}
                onClick={() => { onSelectFirstN(stageCardIds, selectN); setSelectMenuOpen(false); }}
              >
                OK
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      <StageCardList
        setNodeRef={setNodeRef}
        isOver={isOver}
        loadedCards={loadedCards}
        totalCount={totalCount}
        stageContactIds={stageContactIds}
        hasNextPage={!!stageQuery.hasNextPage}
        isFetchingNextPage={stageQuery.isFetchingNextPage}
        fetchNextPage={() => { void stageQuery.fetchNextPage(); }}
        ownerByContact={ownerByContact}
        agentNameById={agentNameById}
        selectedCardIds={selectedCardIds}
        entryById={entryById}
        pendingByCard={pendingByCard}
        unreadByContact={unreadByContact}
        onToggleSelect={onToggleSelect}
        onRemoveCard={onRemoveCard}
        onSetCardStatus={onSetCardStatus}
        onMoveCard={onMoveCard}
        onOpenCard={onOpenCard}

      />
    </div>
  );
}

function StageCardList({
  setNodeRef,
  isOver,
  loadedCards,
  totalCount,
  stageContactIds,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  ownerByContact,
  agentNameById,
  selectedCardIds,
  entryById,
  pendingByCard,
  unreadByContact,
  onToggleSelect,
  onRemoveCard,
  onSetCardStatus,
  onMoveCard,
  onOpenCard,
}: {
  setNodeRef: (el: HTMLElement | null) => void;
  isOver: boolean;
  loadedCards: Card[];
  totalCount: number;
  stageContactIds: string[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  ownerByContact?: Map<string, string | null>;
  agentNameById: Map<string, string>;
  selectedCardIds: Set<string>;
  entryById: Map<string, PipelineContactIndexEntry>;
  pendingByCard?: Record<string, { pending: number; overdue: number }>;
  unreadByContact?: Map<string, number>;
  onToggleSelect: (cardId: string) => void;
  onRemoveCard: (id: string) => void;
  onSetCardStatus: (id: string, status: CardStatus) => void;
  onMoveCard: (contactId: string, contactName: string | null) => void;
  onOpenCard: (contactId: string, stageId: string) => void;
}) {

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const ESTIMATED_CARD_HEIGHT = 78;

  const rowVirtualizer = useVirtualizer({
    count: loadedCards.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_CARD_HEIGHT,
    overscan: 3,
    getItemKey: (index) => loadedCards[index]?.id ?? index,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  // Auto-fetch baseado em scroll real do container, evitando cascata de
  // fetches quando o virtualizer ainda não mediu o elemento.
  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    if (!hasNextPage || isFetchingNextPage) return;
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      fetchNextPage();
    }
  }

  const remaining = Math.max(0, totalCount - loadedCards.length);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={(el) => {
          scrollRef.current = el;
          setNodeRef(el);
        }}
        onScroll={handleScroll}
        className={`flex-1 overflow-y-auto p-2 transition-colors ${isOver ? "bg-accent/40" : ""}`}
      >
        {totalCount === 0 ? (
          <div className="rounded-md border border-dashed py-6 text-center text-xs text-muted-foreground">
            Solte cartões aqui
          </div>
        ) : (
          <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative", width: "100%" }}>
            {virtualItems.map((virtualRow) => {
              const c = loadedCards[virtualRow.index];
              if (!c) return null;
              const ownerId = ownerByContact?.get(c.contact_id) ?? null;
              const ownerName = ownerId ? agentNameById.get(ownerId) ?? "Agente" : null;
              const status = entryById.get(c.id)?.status ?? "aberto";
              return (
                <div
                  key={virtualRow.key}
                  ref={rowVirtualizer.measureElement}
                  data-index={virtualRow.index}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                    paddingBottom: 8,
                  }}
                >
                  <DraggableCard
                    card={c}
                    ownerName={ownerName}
                    status={status}
                    pending={pendingByCard?.[c.id]}
                    unread={unreadByContact?.get(c.contact_id) ?? 0}
                    selected={selectedCardIds.has(c.id)}
                    onToggleSelect={() => onToggleSelect(c.id)}
                    onRemove={() => onRemoveCard(c.id)}
                    onSetStatus={(s) => onSetCardStatus(c.id, s)}
                    onMove={() => onMoveCard(c.contact_id, c.contact?.name ?? c.contact?.profile_name ?? null)}
                    onOpen={() => onOpenCard(c.contact_id, c.stage_id)}
                  />

                </div>
              );
            })}
            {isFetchingNextPage && (
              <div
                style={{
                  position: "absolute",
                  top: rowVirtualizer.getTotalSize(),
                  left: 0,
                  width: "100%",
                }}
                className="py-3 text-center text-xs text-muted-foreground"
              >
                Carregando…
              </div>
            )}
          </div>
        )}
      </div>
      {totalCount > 0 && (
        <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          <span>Exibindo {Math.min(loadedCards.length, totalCount)} de {totalCount}</span>
          {hasNextPage && (
            <button
              type="button"
              disabled={isFetchingNextPage}
              onClick={fetchNextPage}
              className="rounded px-2 py-0.5 text-primary hover:bg-accent disabled:opacity-50"
            >
              {isFetchingNextPage ? "Carregando…" : `Carregar mais (${remaining})`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DraggableCard({ card, ownerName, status, pending, unread, selected, onToggleSelect, onRemove, onSetStatus, onMove, onOpen }: { card: Card; ownerName: string | null; status: CardStatus; pending?: { pending: number; overdue: number }; unread?: number; selected: boolean; onToggleSelect: () => void; onRemove: () => void; onSetStatus: (s: CardStatus) => void; onMove: () => void; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: card.id });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, opacity: isDragging ? 0.4 : 1 }
    : { opacity: isDragging ? 0.4 : 1 };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <CardView card={card} ownerName={ownerName} status={status} pending={pending} unread={unread} selected={selected} onToggleSelect={onToggleSelect} onRemove={onRemove} onSetStatus={onSetStatus} onMove={onMove} onOpen={onOpen} />
    </div>
  );
}


function CardView({ card, dragging, ownerName, status, pending, unread, selected, onToggleSelect, onRemove, onSetStatus, onMove, onOpen }: { card: Card; dragging?: boolean; ownerName?: string | null; status?: CardStatus; pending?: { pending: number; overdue: number }; unread?: number; selected?: boolean; onToggleSelect?: () => void; onRemove?: () => void; onSetStatus?: (s: CardStatus) => void; onMove?: () => void; onOpen?: () => void }) {
  const c = card.contact;
  const display = c?.name || c?.profile_name || formatPhoneDisplay(c?.phone || c?.wa_id || "") || "Contato";
  const initials = display.slice(0, 2).toUpperCase();
  const isResolved = status === "resolvido";
  const isLost = status === "perdido";
  return (
    <div
      onClick={onOpen}
      className={`group cursor-pointer rounded-md border bg-background p-2.5 shadow-sm transition hover:border-primary/40 hover:bg-accent/30 ${selected ? "border-primary ring-1 ring-primary" : "border-border"} ${dragging ? "rotate-2 ring-2 ring-primary" : ""} ${isResolved || isLost ? "opacity-70" : ""}`}
    >
      <div className="flex items-start gap-2">
        {onToggleSelect && (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
            className="pt-1"
          >
            <Checkbox checked={!!selected} />
          </div>
        )}
        <Avatar className="h-7 w-7"><AvatarFallback className={`text-[10px] ${avatarColor(c?.id ?? display)}`}>{initials}</AvatarFallback></Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{display}</span>
            {unread && unread > 0 ? (
              <Badge
                className="h-4 shrink-0 bg-primary px-1.5 text-[10px] font-medium text-primary-foreground"
                title={`${unread} mensagem(ns) não lida(s)`}
                aria-label={`${unread} mensagens não lidas`}
              >
                <MessageSquare className="mr-0.5 h-2.5 w-2.5" />
                {unread > 99 ? "99+" : unread}
              </Badge>
            ) : null}
            {pending && pending.pending > 0 && (
              <Badge
                variant={pending.overdue > 0 ? "destructive" : "secondary"}
                className="h-4 shrink-0 px-1.5 text-[10px] font-normal"
                title={`${pending.pending} atividade(s) pendente(s)${pending.overdue ? `, ${pending.overdue} vencida(s)` : ""}`}
              >
                <Zap className="mr-0.5 h-2.5 w-2.5" />
                {pending.pending}
              </Badge>
            )}
            {isResolved && (
              <Badge variant="secondary" className="h-4 shrink-0 bg-emerald-500/15 px-1.5 text-[10px] font-normal text-emerald-700 dark:text-emerald-400">
                Resolvido
              </Badge>
            )}
            {isLost && (
              <Badge variant="secondary" className="h-4 shrink-0 bg-destructive/15 px-1.5 text-[10px] font-normal text-destructive">
                Perdido
              </Badge>
            )}
          </div>
          <div className="truncate text-xs text-muted-foreground">{formatPhoneDisplay(c?.phone || c?.wa_id || "")}</div>
          {ownerName !== undefined && (
            <div className="mt-1 flex items-center gap-1">

              <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal">
                <Users className="mr-1 h-2.5 w-2.5" />
                {ownerName ?? "Sem dono"}
              </Badge>
            </div>
          )}
        </div>
        {(onRemove || onSetStatus || onMove) && (
          <div onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  title="Opções"
                >
                  <MoreVertical className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {onSetStatus && (
                  <>
                    {(isResolved || isLost) && (
                      <DropdownMenuItem onClick={() => onSetStatus("aberto")}>
                        <RotateCcw className="mr-2 h-3.5 w-3.5" /> Reabrir
                      </DropdownMenuItem>
                    )}
                    {!isResolved && (
                      <DropdownMenuItem onClick={() => onSetStatus("resolvido")}>
                        <CheckCircle2 className="mr-2 h-3.5 w-3.5" /> Resolver
                      </DropdownMenuItem>
                    )}
                    {!isLost && (
                      <DropdownMenuItem onClick={() => onSetStatus("perdido")}>
                        <XCircle className="mr-2 h-3.5 w-3.5" /> Marcar como Perdido
                      </DropdownMenuItem>
                    )}
                  </>
                )}
                {onMove && (
                  <>
                    {onSetStatus && <DropdownMenuSeparator />}
                    <DropdownMenuItem onClick={onMove}>
                      <ArrowRightLeft className="mr-2 h-3.5 w-3.5" /> Mover para outro pipeline
                    </DropdownMenuItem>
                  </>
                )}
                {onRemove && (
                  <>
                    {(onSetStatus || onMove) && <DropdownMenuSeparator />}
                    <DropdownMenuItem onClick={onRemove} className="text-destructive">
                      <Trash2 className="mr-2 h-3.5 w-3.5" /> Remover do pipeline
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </div>
  );
}

function OwnerFilter({
  agents,
  value,
  onChange,
}: {
  agents: Array<{ id: string; full_name: string | null; kind?: "user" | "ai" }>;
  value: Set<string>;
  onChange: (v: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const count = value.size;
  const label =
    count === 0
      ? "Dono do negócio"
      : count === 1
        ? (() => {
            const only = Array.from(value)[0];
            if (only === "__none__") return "Sem dono";
            const a = agents.find((x) => x.id === only);
            if (!a) return "Dono do negócio";
            const prefix = a.kind === "ai" ? "IA · " : "";
            return prefix + (a.full_name ?? "Dono do negócio");
          })()
        : "Dono do negócio";

  function toggle(key: string) {
    const next = new Set(value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="font-normal text-foreground">
          {label}
          {count > 0 && (
            <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-xs">{count}</Badge>
          )}
          <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar agente…" />
          <CommandList>
            <CommandEmpty>Nenhum agente.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="__none__" onSelect={() => toggle("__none__")}>
                <Check className={`mr-2 h-4 w-4 ${value.has("__none__") ? "opacity-100" : "opacity-0"}`} />
                <span className="text-muted-foreground">Sem dono</span>
              </CommandItem>
              {agents.map((a) => (
                <CommandItem key={a.id} value={`${a.full_name ?? a.id} ${a.kind === "ai" ? "ia" : ""}`} onSelect={() => toggle(a.id)}>
                  <Check className={`mr-2 h-4 w-4 ${value.has(a.id) ? "opacity-100" : "opacity-0"}`} />
                  <span className="flex-1 truncate">{a.full_name ?? "Sem nome"}</span>
                  {a.kind === "ai" && (
                    <Badge variant="outline" className="ml-2 h-4 px-1 text-[10px]">IA</Badge>
                  )}
                </CommandItem>
              ))}
              {count > 0 && (
                <CommandItem value="__clear__" onSelect={() => onChange(new Set())}>
                  <X className="mr-2 h-4 w-4" />
                  <span className="text-muted-foreground">Limpar seleção</span>
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function FilterChipPlaceholder({ label }: { label: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="font-normal text-foreground">
          {label}
          <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px]" align="start">
        <p className="text-sm text-muted-foreground">Em breve</p>
      </PopoverContent>
    </Popover>
  );
}

function StatusFilter({ value, onChange }: { value: Set<CardStatus>; onChange: (v: Set<CardStatus>) => void }) {
  const showAberto = value.has("aberto");
  const showResolvido = value.has("resolvido");
  const showPerdido = value.has("perdido");
  const activeCount = (showAberto ? 1 : 0) + (showResolvido ? 1 : 0) + (showPerdido ? 1 : 0);
  const label = activeCount === 3
    ? "Todos"
    : activeCount === 1
      ? showAberto ? "Abertos" : showResolvido ? "Resolvidos" : "Perdidos"
      : `${activeCount} selecionados`;
  function toggle(k: CardStatus) {
    const next = new Set(value);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    if (next.size === 0) next.add(k); // mantém ao menos 1
    onChange(next);
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="font-normal text-foreground">
          Status: {label}
          <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-2" align="start">
        <button type="button" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent" onClick={() => toggle("aberto")}>
          <Check className={`h-4 w-4 ${showAberto ? "opacity-100" : "opacity-0"}`} /> Abertos
        </button>
        <button type="button" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent" onClick={() => toggle("resolvido")}>
          <Check className={`h-4 w-4 ${showResolvido ? "opacity-100" : "opacity-0"}`} /> Resolvidos
        </button>
        <button type="button" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent" onClick={() => toggle("perdido")}>
          <Check className={`h-4 w-4 ${showPerdido ? "opacity-100" : "opacity-0"}`} /> Perdidos
        </button>
      </PopoverContent>
    </Popover>
  );
}

function DateFilter({ value, onChange }: { value: { from?: Date; to?: Date }; onChange: (v: { from?: Date; to?: Date }) => void }) {
  const active = !!(value.from || value.to);
  const label = !active
    ? "Data"
    : value.from && value.to
      ? `${format(value.from, "dd/MM", { locale: ptBR })} – ${format(value.to, "dd/MM", { locale: ptBR })}`
      : value.from
        ? `Desde ${format(value.from, "dd/MM/yy", { locale: ptBR })}`
        : `Até ${format(value.to!, "dd/MM/yy", { locale: ptBR })}`;

  function setDays(n: number) {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - n);
    onChange({ from, to });
  }
  function setToday() {
    const d = new Date();
    onChange({ from: d, to: d });
  }
  function setThisMonth() {
    const now = new Date();
    onChange({ from: new Date(now.getFullYear(), now.getMonth(), 1), to: now });
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="font-normal text-foreground">
          <CalendarIcon className="mr-1 h-3.5 w-3.5" />
          {label}
          {active && <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-xs">1</Badge>}
          <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex flex-col gap-1 border-b border-border p-2 text-sm">
          <button className="rounded px-2 py-1 text-left hover:bg-accent" onClick={setToday}>Hoje</button>
          <button className="rounded px-2 py-1 text-left hover:bg-accent" onClick={() => setDays(7)}>Últimos 7 dias</button>
          <button className="rounded px-2 py-1 text-left hover:bg-accent" onClick={() => setDays(30)}>Últimos 30 dias</button>
          <button className="rounded px-2 py-1 text-left hover:bg-accent" onClick={setThisMonth}>Este mês</button>
          {active && (
            <button className="rounded px-2 py-1 text-left text-destructive hover:bg-accent" onClick={() => onChange({})}>Limpar</button>
          )}
        </div>
        <Calendar
          mode="range"
          selected={value as any}
          onSelect={(r: any) => onChange({ from: r?.from, to: r?.to })}
          className="p-3 pointer-events-auto"
          locale={ptBR}
        />
      </PopoverContent>
    </Popover>
  );
}
