import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PipelineCardContact {
  id: string;
  name: string | null;
  profile_name: string | null;
  phone: string | null;
  wa_id: string;
}

export interface PipelineCard {
  id: string;
  pipeline_id: string;
  stage_id: string;
  contact_id: string;
  position: number;
  contact: PipelineCardContact | null;
}

export interface PipelineContactIndexEntry {
  id: string; // pipeline_contact.id
  stage_id: string;
  contact_id: string;
  position: number;
  status: "aberto" | "resolvido" | "perdido";
  created_at: string;
}

const PAGE_SIZE = 50;

/**
 * Índice leve de TODOS os cartões do pipeline (sem o join de contato).
 * Usado para: contagem por etapa, seleção em massa, filtros, donos e DnD.
 */
export function usePipelineContactIndex(pipelineId: string | null | undefined) {
  return useQuery({
    queryKey: ["pipeline-contact-index", pipelineId],
    enabled: !!pipelineId,
    queryFn: async () => {
      const all: PipelineContactIndexEntry[] = [];
      const PAGE = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("pipeline_contacts")
          .select("id, stage_id, contact_id, position, status, created_at")
          .eq("pipeline_id", pipelineId!)
          .order("stage_id")
          .order("position")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const rows = (data ?? []) as unknown as PipelineContactIndexEntry[];
        all.push(...rows);
        if (rows.length < PAGE) break;
        from += PAGE;
      }
      return all;
    },
  });
}

/**
 * Páginas de cartões com dados completos do contato.
 * Recebe a lista ordenada de pipeline_contact.id que devem ser carregados
 * (já após filtros). Pagina em fatias de PAGE_SIZE.
 */
export function useStageCards(
  pipelineId: string,
  stageId: string,
  stageCardIds: string[],
  filterKey: string,
) {
  return useInfiniteQuery({
    queryKey: ["pipeline-stage-cards", pipelineId, stageId, filterKey, stageCardIds.join(",")],
    enabled: !!pipelineId && !!stageId,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const from = pageParam as number;
      const slice = stageCardIds.slice(from, from + PAGE_SIZE);
      if (slice.length === 0) return [] as PipelineCard[];
      const { data, error } = await supabase
        .from("pipeline_contacts")
        .select(
          "id, pipeline_id, stage_id, contact_id, position, contact:contact_id(id, name, profile_name, phone, wa_id)",
        )
        .in("id", slice);
      if (error) throw error;
      const byId = new Map<string, PipelineCard>(
        ((data ?? []) as unknown as PipelineCard[]).map((r) => [r.id, r]),
      );
      // Preserva a ordem do slice (Postgres não garante ordem com .in())
      return slice
        .map((cid) => byId.get(cid))
        .filter((x): x is PipelineCard => !!x);
    },
    getNextPageParam: (_last, allPages) => {
      const loaded = allPages.reduce((acc, p) => acc + p.length, 0);
      if (loaded >= stageCardIds.length) return undefined;
      return loaded;
    },
  });
}

export const PIPELINE_CARDS_PAGE_SIZE = PAGE_SIZE;
