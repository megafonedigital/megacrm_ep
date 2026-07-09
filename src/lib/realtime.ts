import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveBrand } from "@/lib/active-brand";

const LIST_DEBOUNCE_MS = 2500;

const LIST_KEYS = [
  ["conversations"],
  ["inbox-overview"],
  ["sidebar-unread"],
  ["pipeline-owners"],
  ["pipeline-contact-index"],
  ["pipeline-stage-cards"],
  ["inbox-pipeline-contact-ids"],
] as const;

export function useRealtimeInbox() {
  const qc = useQueryClient();
  const { activeBrandId } = useActiveBrand();
  const listTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!activeBrandId) return;
    const brandFilter = `brand_id=eq.${activeBrandId}`;

    const scheduleListInvalidations = () => {
      if (listTimerRef.current) return; // trailing debounce: coalesce bursts
      listTimerRef.current = setTimeout(() => {
        listTimerRef.current = null;
        for (const key of LIST_KEYS) {
          qc.invalidateQueries({ queryKey: key as unknown as readonly unknown[] });
        }
      }, LIST_DEBOUNCE_MS);
    };

    const channel = supabase
      .channel(`inbox-realtime:${activeBrandId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: brandFilter }, () => {
        // Conversa aberta precisa de tempo real — invalida messages imediatamente.
        qc.invalidateQueries({ queryKey: ["messages"] });
        // Lista/contadores: debounce para não tempestear durante broadcasts.
        scheduleListInvalidations();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: brandFilter }, () => {
        scheduleListInvalidations();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "pipeline_contacts", filter: brandFilter }, () => {
        scheduleListInvalidations();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "internal_notes" }, () => {
        qc.invalidateQueries({ queryKey: ["notes"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "error_logs" }, () => {
        qc.invalidateQueries({ queryKey: ["error_logs"] });
      })
      .subscribe();

    return () => {
      if (listTimerRef.current) {
        clearTimeout(listTimerRef.current);
        listTimerRef.current = null;
      }
      void supabase.removeChannel(channel);
    };
  }, [qc, activeBrandId]);
}
