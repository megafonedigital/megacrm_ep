import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, Check, Loader2, Plus, Trash2, Pencil, X, Users, ChevronLeft, ChevronRight, List as ListIcon, LayoutGrid } from "lucide-react";
import { format, isToday, isTomorrow, isPast, startOfWeek, addDays, addWeeks, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useActiveBrand } from "@/lib/active-brand";
import { useMe } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AppointmentFormDialog } from "@/components/agenda/AppointmentFormDialog";
import {
  listAppointments, updateAppointment, deleteAppointment, type AppointmentRow,
} from "@/lib/appointments.functions";
import { formatPhoneDisplay } from "@/lib/phone";
import { avatarColor, initials as toInitials } from "@/lib/avatar-color";

export const Route = createFileRoute("/admin/agenda")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  head: () => ({ meta: [{ title: "Agenda — MegaCRM" }] }),
  component: AgendaPage,
});

type Range = "today" | "week" | "overdue" | "upcoming" | "done";

function AgendaPage() {
  const { activeBrandId } = useActiveBrand();
  const { me } = useMe();
  const qc = useQueryClient();
  const listFn = useServerFn(listAppointments);
  const updateFn = useServerFn(updateAppointment);
  const deleteFn = useServerFn(deleteAppointment);

  const [range, setRange] = useState<Range>("upcoming");
  const [scope, setScope] = useState<"mine" | "workspace">("mine");
  const [view, setView] = useState<"list" | "week">("list");
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AppointmentRow | null>(null);

  const canSeeAll = !!(me?.isAdmin || me?.isSupervisor || me?.isDeveloper);

  const listQ = useQuery({
    queryKey: ["appointments", activeBrandId, scope, view === "week" ? "week-grid" : range],
    enabled: !!activeBrandId,
    queryFn: () =>
      listFn({
        data: {
          brandId: activeBrandId!,
          scope,
          range: view === "week" ? "all" : range,
        },
      }),
    refetchInterval: 60_000,
  });

  const completeMut = useMutation({
    mutationFn: (id: string) => updateFn({ data: { id, status: "done" } }),
    onSuccess: () => {
      toast.success("Agendamento concluído");
      qc.invalidateQueries({ queryKey: ["appointments"] });
      qc.invalidateQueries({ queryKey: ["appointments-due-count"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => updateFn({ data: { id, status: "cancelled" } }),
    onSuccess: () => {
      toast.success("Agendamento cancelado");
      qc.invalidateQueries({ queryKey: ["appointments"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Removido");
      qc.invalidateQueries({ queryKey: ["appointments"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const groups = useMemo(() => {
    const list = listQ.data?.appointments ?? [];
    const by = new Map<string, AppointmentRow[]>();
    for (const a of list) {
      const d = new Date(a.scheduled_at);
      const key = format(d, "yyyy-MM-dd");
      if (!by.has(key)) by.set(key, []);
      by.get(key)!.push(a);
    }
    return Array.from(by.entries()).map(([key, items]) => ({ key, items }));
  }, [listQ.data]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b bg-card px-6 py-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Agenda</h1>
        </div>
        <div className="flex items-center gap-2">
          {canSeeAll && (
            <ToggleGroup type="single" value={scope} onValueChange={(v) => v && setScope(v as any)} size="sm" variant="outline">
              <ToggleGroupItem value="mine" className="gap-1.5 text-xs"><Users className="h-3 w-3" /> Meus</ToggleGroupItem>
              <ToggleGroupItem value="workspace" className="gap-1.5 text-xs">Workspace</ToggleGroupItem>
            </ToggleGroup>
          )}
          <ToggleGroup type="single" value={view} onValueChange={(v) => v && setView(v as any)} size="sm" variant="outline">
            <ToggleGroupItem value="list" className="gap-1.5 text-xs"><ListIcon className="h-3 w-3" /> Lista</ToggleGroupItem>
            <ToggleGroupItem value="week" className="gap-1.5 text-xs"><LayoutGrid className="h-3 w-3" /> Semana</ToggleGroupItem>
          </ToggleGroup>
          <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}>
            <Plus className="mr-1 h-4 w-4" /> Novo agendamento
          </Button>
        </div>
      </header>

      {view === "list" && (
        <div className="border-b bg-card px-6 py-2">
          <Tabs value={range} onValueChange={(v) => setRange(v as Range)}>
            <TabsList>
              <TabsTrigger value="upcoming">Próximos</TabsTrigger>
              <TabsTrigger value="today">Hoje</TabsTrigger>
              <TabsTrigger value="week">Esta semana</TabsTrigger>
              <TabsTrigger value="overdue">Atrasados</TabsTrigger>
              <TabsTrigger value="done">Concluídos</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      )}

      {view === "week" && (
        <div className="flex items-center justify-between border-b bg-card px-6 py-2">
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => setWeekStart((d) => addWeeks(d, -1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>
              Hoje
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setWeekStart((d) => addWeeks(d, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="text-sm font-medium">
            {format(weekStart, "d 'de' MMM", { locale: ptBR })} — {format(addDays(weekStart, 6), "d 'de' MMM yyyy", { locale: ptBR })}
          </div>
          <div className="w-[120px]" />
        </div>
      )}

      <div className="flex-1 overflow-y-auto bg-muted/20 p-6">
        {listQ.isLoading && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando…
          </div>
        )}

        {view === "list" && !listQ.isLoading && (
          <>
            {groups.length === 0 && (
              <div className="rounded-lg border border-dashed py-12 text-center text-muted-foreground">
                <CalendarClock className="mx-auto mb-3 h-10 w-10 opacity-50" />
                <p className="text-sm">Nenhum agendamento {range === "done" ? "concluído" : "no período"}.</p>
              </div>
            )}
            <div className="mx-auto max-w-3xl space-y-6">
              {groups.map((g) => {
                const d = new Date(g.key);
                const dayLabel = isToday(d)
                  ? "Hoje"
                  : isTomorrow(d)
                  ? "Amanhã"
                  : format(d, "EEEE, d 'de' MMMM", { locale: ptBR });
                return (
                  <section key={g.key}>
                    <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {dayLabel}
                    </h2>
                    <div className="space-y-2">
                      {g.items.map((a) => (
                        <AppointmentCard
                          key={a.id}
                          appt={a}
                          onEdit={() => { setEditing(a); setFormOpen(true); }}
                          onComplete={() => completeMut.mutate(a.id)}
                          onCancel={() => cancelMut.mutate(a.id)}
                          onDelete={() => {
                            if (confirm("Excluir este agendamento?")) deleteMut.mutate(a.id);
                          }}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </>
        )}

        {view === "week" && !listQ.isLoading && (
          <WeekGrid
            weekStart={weekStart}
            appointments={listQ.data?.appointments ?? []}
            onPick={(a) => { setEditing(a); setFormOpen(true); }}
          />
        )}
      </div>

      {formOpen && (
        <AppointmentFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          appointment={editing}
        />
      )}
    </div>
  );
}

function WeekGrid({
  weekStart, appointments, onPick,
}: {
  weekStart: Date;
  appointments: AppointmentRow[];
  onPick: (a: AppointmentRow) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const byDay = new Map<string, AppointmentRow[]>();
  for (const a of appointments) {
    const d = new Date(a.scheduled_at);
    for (const day of days) {
      if (isSameDay(d, day)) {
        const key = format(day, "yyyy-MM-dd");
        if (!byDay.has(key)) byDay.set(key, []);
        byDay.get(key)!.push(a);
        break;
      }
    }
  }
  for (const items of byDay.values()) {
    items.sort((a, b) => +new Date(a.scheduled_at) - +new Date(b.scheduled_at));
  }

  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-7">
      {days.map((day) => {
        const key = format(day, "yyyy-MM-dd");
        const items = byDay.get(key) ?? [];
        const today = isToday(day);
        return (
          <div key={key} className={`flex min-h-[200px] flex-col rounded-md border bg-card ${today ? "border-primary" : ""}`}>
            <div className={`border-b px-2 py-1.5 text-center text-xs ${today ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground"}`}>
              <div className="uppercase">{format(day, "EEE", { locale: ptBR })}</div>
              <div className="text-base font-semibold text-foreground">{format(day, "d")}</div>
            </div>
            <div className="flex-1 space-y-1.5 p-2">
              {items.length === 0 && (
                <div className="py-4 text-center text-[10px] text-muted-foreground">—</div>
              )}
              {items.map((a) => {
                const d = new Date(a.scheduled_at);
                const overdue = a.status === "pending" && isPast(d);
                const done = a.status === "done";
                const cancelled = a.status === "cancelled" || a.status === "missed";
                return (
                  <button
                    key={a.id}
                    onClick={() => onPick(a)}
                    className={`block w-full rounded border px-2 py-1.5 text-left text-xs transition hover:bg-muted/50 ${
                      overdue
                        ? "border-destructive/60 bg-destructive/5"
                        : done
                        ? "border-border opacity-60"
                        : cancelled
                        ? "border-dashed opacity-50 line-through"
                        : "border-border"
                    }`}
                  >
                    <div className="font-medium">{format(d, "HH:mm")}</div>
                    <div className="truncate text-muted-foreground">
                      {a.contact?.name ?? "Contato"}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AppointmentCard({
  appt, onEdit, onComplete, onCancel, onDelete,
}: {
  appt: AppointmentRow;
  onEdit: () => void;
  onComplete: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const d = new Date(appt.scheduled_at);
  const isOverdue = appt.status === "pending" && isPast(d);
  const name = appt.contact?.name ?? formatPhoneDisplay(appt.contact?.phone ?? appt.contact?.wa_id ?? "") ?? "Contato";
  const assigneeLabel = appt.assignee?.full_name ?? appt.assignee?.email ?? "—";

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-xs font-semibold ${avatarColor(appt.contact_id)}`}>
          {toInitials(name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="font-medium text-sm">{name}</div>
            <Badge variant={isOverdue ? "destructive" : appt.status === "done" ? "secondary" : "outline"} className="text-[10px]">
              {format(d, "HH:mm")}
            </Badge>
            {appt.status !== "pending" && (
              <Badge variant="secondary" className="text-[10px]">
                {appt.status === "done" ? "Concluído" : appt.status === "missed" ? "Perdido" : "Cancelado"}
              </Badge>
            )}
            {isOverdue && <Badge variant="destructive" className="text-[10px]">Atrasado</Badge>}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {formatPhoneDisplay(appt.contact?.phone ?? appt.contact?.wa_id ?? "") || "—"}
            {" · "}
            <span>Responsável: {assigneeLabel}</span>
            {appt.pipeline && (
              <> {" · "} <span>{appt.pipeline.name}{appt.stage ? ` / ${appt.stage.name}` : ""}</span></>
            )}
          </div>
          {appt.note && (
            <p className="mt-2 whitespace-pre-wrap rounded bg-muted/40 px-2 py-1.5 text-xs">{appt.note}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {appt.conversation_id && (
              <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
                <Link to="/inbox" search={{ conv: appt.conversation_id } as any}>Abrir conversa</Link>
              </Button>
            )}
            {appt.status === "pending" && (
              <>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onComplete}>
                  <Check className="mr-1 h-3 w-3" /> Concluir
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onEdit}>
                  <Pencil className="mr-1 h-3 w-3" /> Reagendar
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={onCancel}>
                  <X className="mr-1 h-3 w-3" /> Cancelar
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={onDelete}>
              <Trash2 className="mr-1 h-3 w-3" /> Excluir
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
