import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, ExternalLink, ChevronLeft, ChevronRight, AlertCircle, Zap } from "lucide-react";
import { ConversationView, type ConversationRow } from "@/routes/inbox";
import { ensureContactConversation } from "@/lib/conversations.functions";
import { ContactActivitiesPanel } from "./ContactActivitiesPanel";
import { toast } from "sonner";


type ChannelOpt = { id: string; name: string; phone_number: string | null; type: string };

export function ContactChatDialog({
  open, onOpenChange, contactId, brandId, siblingContactIds, onContactIdChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contactId: string | null;
  brandId: string;
  siblingContactIds?: string[];
  onContactIdChange?: (id: string) => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const ensureFn = useServerFn(ensureContactConversation);

  const siblings = siblingContactIds ?? [];
  const currentIndex = contactId ? siblings.indexOf(contactId) : -1;
  const total = siblings.length;
  const hasNav = total > 1 && currentIndex >= 0 && !!onContactIdChange;
  const canPrev = hasNav && currentIndex > 0;
  const canNext = hasNav && currentIndex < total - 1;

  const goPrev = () => { if (canPrev) onContactIdChange!(siblings[currentIndex - 1]); };
  const goNext = () => { if (canNext) onContactIdChange!(siblings[currentIndex + 1]); };

  const [needsChannel, setNeedsChannel] = useState<ChannelOpt[] | null>(null);
  const [pickedChannelId, setPickedChannelId] = useState<string | null>(null);
  const [ensureError, setEnsureError] = useState<string | null>(null);
  const [showActivities, setShowActivities] = useState(true);


  // Reset state when contact changes
  useEffect(() => {
    setNeedsChannel(null);
    setPickedChannelId(null);
    setEnsureError(null);
  }, [contactId]);

  // Realtime: conversation changes for this contact
  useEffect(() => {
    if (!open || !contactId) return;
    const channel = supabase
      .channel(`pipeline-chat-conv-${contactId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `contact_id=eq.${contactId}` }, () => {
        qc.invalidateQueries({ queryKey: ["pipeline-contact-conv", contactId, brandId] });
        qc.invalidateQueries({ queryKey: ["conversations"] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [open, contactId, brandId, qc]);

  useEffect(() => {
    if (!open || !hasNav) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const el = document.activeElement as HTMLElement | null;
      if (el) {
        const tag = el.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable) return;
      }
      if (e.key === "ArrowLeft") goPrev();
      else goNext();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, hasNav, currentIndex, total]);

  const { data: conv, isLoading, refetch } = useQuery({
    queryKey: ["pipeline-contact-conv", contactId, brandId],
    enabled: open && !!contactId,
    staleTime: 10_000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      if (!contactId) return null;

      // Se já temos uma conversa em cache para este par, pula o ensure
      // e só re-busca a conversa atualizada (evita roundtrip no servidor
      // toda vez que o realtime invalida a query).
      const cached = qc.getQueryData<ConversationRow | null>([
        "pipeline-contact-conv", contactId, brandId,
      ]);

      if (!cached?.id) {
        setEnsureError(null);
        try {
          const result = await ensureFn({
            data: {
              brandId,
              contactId,
              ...(pickedChannelId ? { channelId: pickedChannelId } : {}),
            },
          });
          if ("needsChannel" in result && result.needsChannel) {
            setNeedsChannel(result.channels);
            return null;
          }
          setNeedsChannel(null);
        } catch (e) {
          const msg = (e as Error).message || "Falha ao iniciar conversa.";
          setEnsureError(msg);
          return null;
        }
      }

      // Busca a conversa para renderizar (RLS aplica)
      const { data: convs, error: convErr } = await supabase
        .from("conversations")
        .select(
          "id, brand_id, channel_id, contact_id, status, assigned_to, last_message_at, window_expires_at, unread_count, contact:contacts!conversations_contact_id_fkey(id, name, profile_name, phone, wa_id, metadata), brand:brands!conversations_brand_id_fkey(name), channel:brand_channels!channel_id(name, phone_number, type)"
        )
        .eq("contact_id", contactId)
        .eq("brand_id", brandId)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(1);
      if (convErr) throw convErr;
      return ((convs ?? [])[0] as unknown as ConversationRow) ?? null;
    },
  });

  // Zera unread_count ao abrir a conversa pelo Kanban (paridade com o inbox).
  useEffect(() => {
    if (!open) return;
    const convId = conv?.id;
    const unread = conv?.unread_count ?? 0;
    if (!convId || unread <= 0) return;
    let cancelled = false;
    (async () => {
      const { error } = await supabase
        .from("conversations")
        .update({ unread_count: 0 })
        .eq("id", convId);
      if (cancelled || error) return;
      qc.invalidateQueries({ queryKey: ["pipeline-owners"] });
      qc.invalidateQueries({ queryKey: ["pipeline-board"] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["inbox-overview"] });
      qc.invalidateQueries({ queryKey: ["sidebar-unread"] });
      qc.invalidateQueries({ queryKey: ["pipeline-contact-conv", contactId, brandId] });
    })();
    return () => {
      cancelled = true;
    };
  }, [open, conv?.id, conv?.unread_count, qc, contactId, brandId]);

  async function handlePickChannel() {
    if (!pickedChannelId) {
      toast.error("Selecione um canal.");
      return;
    }
    await refetch();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] w-[95vw] max-w-[1500px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>Conversa do contato</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-end gap-2 border-b border-border px-3 py-2 pr-12">
          {hasNav && (
            <div className="mr-auto flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={goPrev}
                disabled={!canPrev}
                title="Contato anterior (←)"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="px-1 text-xs tabular-nums text-muted-foreground">
                {currentIndex + 1} / {total}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={goNext}
                disabled={!canNext}
                title="Próximo contato (→)"
              >
                Próximo
                <ChevronRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </div>
          )}
          <Button
            variant={showActivities ? "default" : "outline"}
            size="sm"
            onClick={() => setShowActivities((v) => !v)}
            title="Atividades da etapa"
          >
            <Zap className="mr-1.5 h-3.5 w-3.5" />
            Atividades
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onOpenChange(false);
              if (conv?.id) navigate({ to: "/inbox", search: { conv: conv.id } });
              else navigate({ to: "/inbox" });
            }}
          >
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
            Abrir no Inbox
          </Button>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            {isLoading && !conv ? (
              <div className="flex flex-1 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : needsChannel ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
                <div className="text-sm font-medium">Escolha o canal para iniciar a conversa</div>
                <div className="w-full max-w-sm">
                  <Select value={pickedChannelId ?? ""} onValueChange={setPickedChannelId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecionar canal" />
                    </SelectTrigger>
                    <SelectContent>
                      {needsChannel.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}{c.phone_number ? ` · ${c.phone_number}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button size="sm" onClick={handlePickChannel} disabled={!pickedChannelId}>
                  Continuar
                </Button>
              </div>
            ) : ensureError ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
                <AlertCircle className="h-8 w-8 text-destructive" />
                <div className="max-w-md">{ensureError}</div>
                <Button size="sm" variant="outline" onClick={() => refetch()}>
                  Tentar novamente
                </Button>
              </div>
            ) : conv ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <ConversationView key={conv.id} conv={conv} />
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
          {showActivities && contactId && (
            <ContactActivitiesPanel contactId={contactId} brandId={brandId} />
          )}
        </div>
      </DialogContent>

    </Dialog>
  );
}
