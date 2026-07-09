import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useActiveBrand } from "@/lib/active-brand";
import { useAuth } from "@/lib/auth";
import { listAppointments, markAppointmentNotified, updateAppointment } from "@/lib/appointments.functions";
import megacrmLogo from "@/assets/megacrm-logo.png";

const SOUND_KEY = "megacrm:notif.sound";
const BROWSER_KEY = "megacrm:notif.browser";

type Perm = "default" | "granted" | "denied" | "unsupported";

interface NotificationsValue {
  soundEnabled: boolean;
  browserEnabled: boolean;
  permission: Perm;
  setSoundEnabled: (v: boolean) => void;
  toggleBrowserEnabled: () => Promise<void>;
}

const Ctx = createContext<NotificationsValue>({
  soundEnabled: true,
  browserEnabled: false,
  permission: "default",
  setSoundEnabled: () => {},
  toggleBrowserEnabled: async () => {},
});

export function useNotifications() {
  return useContext(Ctx);
}

function readBool(key: string, defaultValue: boolean) {
  if (typeof window === "undefined") return defaultValue;
  const v = localStorage.getItem(key);
  if (v === null) return defaultValue;
  return v === "1";
}

function writeBool(key: string, v: boolean) {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, v ? "1" : "0");
}

// Debounce coalescente para invalidações disparadas por realtime de mensagens.
// Quando chegam várias mensagens em sequência, evita N refetches consecutivos.
let invalidateTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleInvalidate(qc: ReturnType<typeof useQueryClient>) {
  if (invalidateTimer) return;
  invalidateTimer = setTimeout(() => {
    invalidateTimer = null;
    qc.invalidateQueries({ queryKey: ["pipeline-owners"] });
    qc.invalidateQueries({ queryKey: ["conversations"] });
    qc.invalidateQueries({ queryKey: ["sidebar-unread"] });
  }, 1500);
}



/**
 * Plays a short two-tone "chime" using the Web Audio API — no asset needed.
 * Requires a prior user gesture to unlock audio on most browsers; we do that lazily.
 */
function useChimePlayer() {
  const ctxRef = useRef<AudioContext | null>(null);
  const unlockedRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const unlock = async () => {
      if (unlockedRef.current) return;
      try {
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        if (!AC) return;
        if (!ctxRef.current) ctxRef.current = new AC();
        if (ctxRef.current.state === "suspended") await ctxRef.current.resume();
        unlockedRef.current = true;
      } catch {
        // ignore
      }
    };
    const events = ["pointerdown", "keydown", "touchstart"];
    events.forEach((e) => window.addEventListener(e, unlock, { once: false, passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, unlock));
  }, []);

  return useCallback(() => {
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      if (!ctxRef.current) ctxRef.current = new AC();
      const ctx = ctxRef.current;
      if (ctx.state === "suspended") void ctx.resume();
      const now = ctx.currentTime;
      const play = (freq: number, start: number, dur: number, vol = 0.15) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, now + start);
        gain.gain.linearRampToValueAtTime(vol, now + start + 0.02);
        gain.gain.linearRampToValueAtTime(0, now + start + dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + start);
        osc.stop(now + start + dur + 0.02);
      };
      play(880, 0, 0.18);
      play(1320, 0.12, 0.22);
    } catch {
      // ignore
    }
  }, []);
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { activeBrandId } = useActiveBrand();
  const qc = useQueryClient();
  const playChime = useChimePlayer();

  const [soundEnabled, setSoundEnabledState] = useState<boolean>(() => readBool(SOUND_KEY, true));
  const [browserEnabled, setBrowserEnabledState] = useState<boolean>(() => readBool(BROWSER_KEY, false));
  const [permission, setPermission] = useState<Perm>(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
    return Notification.permission as Perm;
  });

  const setSoundEnabled = useCallback((v: boolean) => {
    setSoundEnabledState(v);
    writeBool(SOUND_KEY, v);
  }, []);

  const toggleBrowserEnabled = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (browserEnabled) {
      setBrowserEnabledState(false);
      writeBool(BROWSER_KEY, false);
      return;
    }
    let perm: Perm = Notification.permission as Perm;
    if (perm === "default") {
      try {
        perm = (await Notification.requestPermission()) as Perm;
      } catch {
        perm = "denied";
      }
    }
    setPermission(perm);
    if (perm === "granted") {
      setBrowserEnabledState(true);
      writeBool(BROWSER_KEY, true);
    }
  }, [browserEnabled]);

  // Cache de metadados para nome do contato / conversa / dono
  const contactCache = useRef(
    new Map<string, { name: string; conv_id: string | null; assigned_to: string | null }>(),
  );

  // Anti-eco: ignora mensagens criadas há mais de 10s (replays na conexão)
  const isFresh = (createdAt: string) => {
    const t = new Date(createdAt).getTime();
    return Number.isFinite(t) && Date.now() - t < 10_000;
  };

  // Detecta conversa atualmente aberta no Inbox via querystring (?conv=...)
  const getOpenConvId = (): string | null => {
    if (typeof window === "undefined") return null;
    const path = window.location.pathname;
    if (!path.startsWith("/inbox")) return null;
    const params = new URLSearchParams(window.location.search);
    return params.get("conv");
  };

  useEffect(() => {
    if (!user || !activeBrandId) return;

    const channel = supabase
      .channel(`notif-msgs-${activeBrandId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `brand_id=eq.${activeBrandId}`,
        },
        async (payload) => {
          const m = payload.new as {
            id: string;
            direction: string;
            conversation_id: string;
            content: string | null;
            type: string;
            created_at: string;
          };
          if (m.direction !== "inbound") return;
          if (!isFresh(m.created_at)) return;

          // Invalida queries relevantes (debounce para não martelar o banco
          // quando chegam várias mensagens em sequência).
          scheduleInvalidate(qc);

          // Silencia se a aba está visível e a conversa está aberta
          const openConv = getOpenConvId();
          const isFocusedConv =
            !document.hidden && openConv && openConv === m.conversation_id;
          if (isFocusedConv) return;

          // Carrega/atualiza cache da conversa (nome + dono)
          let info = contactCache.current.get(m.conversation_id);
          if (!info) {
            try {
              const { data: conv } = await supabase
                .from("conversations")
                .select("id, assigned_to, contact:contacts!conversations_contact_id_fkey(id, name, profile_name, phone, wa_id)")
                .eq("id", m.conversation_id)
                .maybeSingle();
              const c = (conv as any)?.contact;
              const name =
                c?.name || c?.profile_name || c?.phone || c?.wa_id || "Novo contato";
              info = {
                name,
                conv_id: (conv as any)?.id ?? m.conversation_id,
                assigned_to: ((conv as any)?.assigned_to ?? null) as string | null,
              };
              contactCache.current.set(m.conversation_id, info);
            } catch {
              return;
            }
          }
          if (!info) return;

          // Só toca/notifica se a conversa for atribuída ao usuário logado
          if (info.assigned_to !== user.id) return;

          if (soundEnabled) playChime();

          if (
            browserEnabled &&
            typeof window !== "undefined" &&
            "Notification" in window &&
            Notification.permission === "granted" &&
            document.hidden
          ) {
            try {
              const body =
                m.type === "text"
                  ? (m.content ?? "").slice(0, 140) || "[mensagem]"
                  : `[${m.type}]`;
              const n = new Notification(info.name, {
                body,
                icon: megacrmLogo,
                tag: `conv:${m.conversation_id}`,
              });
              n.onclick = () => {
                window.focus();
                window.location.href = `/inbox?conv=${info!.conv_id}`;
                n.close();
              };
            } catch {
              // ignore
            }
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversations",
          filter: `brand_id=eq.${activeBrandId}`,
        },
        (payload) => {
          // Invalida cache para refletir reatribuição (assigned_to mudou)
          const convId = (payload.new as { id?: string })?.id;
          if (convId) contactCache.current.delete(convId);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user, activeBrandId, qc, soundEnabled, browserEnabled, playChime]);

  // ---- Lembretes de agendamento (follow-ups) ----
  const listAppointmentsFn = useServerFn(listAppointments);
  const markNotifiedFn = useServerFn(markAppointmentNotified);
  const updateAppointmentFn = useServerFn(updateAppointment);
  const notifiedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!user || !activeBrandId) return;
    let cancelled = false;

    const check = async () => {
      try {
        const { appointments } = await listAppointmentsFn({
          data: { brandId: activeBrandId, scope: "mine", range: "upcoming" },
        });
        if (cancelled) return;
        const now = Date.now();
        const due = appointments.filter(
          (a) =>
            a.status === "pending" &&
            a.assignee_id === user.id &&
            !a.notified_at &&
            !notifiedRef.current.has(a.id) &&
            new Date(a.scheduled_at).getTime() <= now,
        );
        for (const a of due) {
          notifiedRef.current.add(a.id);
          const contactName =
            a.contact?.name || a.contact?.phone || a.contact?.wa_id || "Contato";
          const when = format(new Date(a.scheduled_at), "HH:mm", { locale: ptBR });
          if (soundEnabled) playChime();
          toast(`Hora do follow-up · ${when}`, {
            description: `${contactName}${a.note ? ` — ${a.note}` : ""}`,
            duration: 15000,
            action: a.conversation_id
              ? {
                  label: "Abrir conversa",
                  onClick: () => {
                    window.location.href = `/inbox?conv=${a.conversation_id}`;
                  },
                }
              : undefined,
            cancel: {
              label: "Concluir",
              onClick: () => {
                void updateAppointmentFn({ data: { id: a.id, status: "done" } }).then(
                  () => {
                    qc.invalidateQueries({ queryKey: ["appointments"] });
                    qc.invalidateQueries({ queryKey: ["due-appointments"] });
                    qc.invalidateQueries({ queryKey: ["contact-appointments"] });
                  },
                );
              },
            },
          });
          if (
            browserEnabled &&
            typeof window !== "undefined" &&
            "Notification" in window &&
            Notification.permission === "granted"
          ) {
            try {
              const n = new Notification(`Follow-up: ${contactName}`, {
                body: a.note || `Agendamento de ${when}`,
                icon: megacrmLogo,
                tag: `appt:${a.id}`,
              });
              n.onclick = () => {
                window.focus();
                if (a.conversation_id) {
                  window.location.href = `/inbox?conv=${a.conversation_id}`;
                }
                n.close();
              };
            } catch {
              // ignore
            }
          }
          void markNotifiedFn({ data: { id: a.id } }).then(() => {
            qc.invalidateQueries({ queryKey: ["due-appointments"] });
          });
        }
      } catch {
        // ignore polling errors
      }
    };

    void check();
    const t = setInterval(check, 30_000);

    const channel = supabase
      .channel(`notif-appts-${activeBrandId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "appointments", filter: `brand_id=eq.${activeBrandId}` },
        () => {
          qc.invalidateQueries({ queryKey: ["appointments"] });
          qc.invalidateQueries({ queryKey: ["due-appointments"] });
          qc.invalidateQueries({ queryKey: ["contact-appointments"] });
          void check();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      clearInterval(t);
      void supabase.removeChannel(channel);
    };
  }, [user, activeBrandId, qc, soundEnabled, browserEnabled, playChime, listAppointmentsFn, markNotifiedFn, updateAppointmentFn]);


  const value = useMemo<NotificationsValue>(
    () => ({
      soundEnabled,
      browserEnabled,
      permission,
      setSoundEnabled,
      toggleBrowserEnabled,
    }),
    [soundEnabled, browserEnabled, permission, setSoundEnabled, toggleBrowserEnabled],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
