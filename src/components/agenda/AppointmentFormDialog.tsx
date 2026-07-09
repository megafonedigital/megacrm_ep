import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarIcon, Loader2, Search } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

import { useActiveBrand } from "@/lib/active-brand";
import { useMe } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/automations/SearchableSelect";
import { cn } from "@/lib/utils";
import { formatPhoneDisplay } from "@/lib/phone";
import { listAssignableUsers } from "@/lib/automation-assignable-users.functions";
import {
  createAppointment,
  updateAppointment,
  searchContactsForPicker,
  getContactForPicker,
  type AppointmentRow,
} from "@/lib/appointments.functions";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Existing appointment to edit (omit to create). */
  appointment?: AppointmentRow | null;
  /** Pre-selected contact (e.g. when opening from a conversation). */
  contactId?: string | null;
  /** Optional pre-selected conversation. */
  conversationId?: string | null;
  onSaved?: () => void;
}

export function AppointmentFormDialog({
  open, onOpenChange, appointment, contactId: presetContactId, conversationId, onSaved,
}: Props) {
  const { activeBrandId } = useActiveBrand();
  const { me } = useMe();
  const qc = useQueryClient();
  const createFn = useServerFn(createAppointment);
  const updateFn = useServerFn(updateAppointment);
  const listUsersFn = useServerFn(listAssignableUsers);
  const searchContactsFn = useServerFn(searchContactsForPicker);
  const getContactFn = useServerFn(getContactForPicker);


  const isEdit = !!appointment;

  const [contactId, setContactId] = useState<string | null>(presetContactId ?? appointment?.contact_id ?? null);
  const [date, setDate] = useState<Date | undefined>(appointment ? new Date(appointment.scheduled_at) : undefined);
  const [time, setTime] = useState<string>(() => appointment ? format(new Date(appointment.scheduled_at), "HH:mm") : "09:00");
  const [note, setNote] = useState(appointment?.note ?? "");
  const [assigneeId, setAssigneeId] = useState<string>(appointment?.assignee_id ?? me?.userId ?? "");
  const [contactSearch, setContactSearch] = useState("");
  const [contactSearchDeb, setContactSearchDeb] = useState("");
  const [contactPopOpen, setContactPopOpen] = useState(false);
  const contactPopRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setContactSearchDeb(contactSearch), 250);
    return () => clearTimeout(t);
  }, [contactSearch]);

  useEffect(() => {
    if (!contactPopOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!contactPopRef.current?.contains(e.target as Node)) setContactPopOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setContactPopOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [contactPopOpen]);

  // reset when reopening
  useEffect(() => {
    if (!open) return;
    setContactId(presetContactId ?? appointment?.contact_id ?? null);
    setDate(appointment ? new Date(appointment.scheduled_at) : undefined);
    setTime(appointment ? format(new Date(appointment.scheduled_at), "HH:mm") : "09:00");
    setNote(appointment?.note ?? "");
    setAssigneeId(appointment?.assignee_id ?? me?.userId ?? "");
  }, [open, appointment, presetContactId, me?.userId]);

  const selectedContactQ = useQuery({
    queryKey: ["appt-contact", contactId, activeBrandId],
    enabled: !!contactId && !!activeBrandId,
    queryFn: async () => {
      const res = await getContactFn({ data: { brandId: activeBrandId!, contactId: contactId! } });
      return res.contact;
    },
  });

  const contactSearchQ = useQuery({
    queryKey: ["appt-contact-search", contactSearchDeb, activeBrandId],
    enabled: contactPopOpen && contactSearchDeb.trim().length >= 2 && !!activeBrandId,
    queryFn: async () => {
      const res = await searchContactsFn({
        data: { brandId: activeBrandId!, query: contactSearchDeb.trim() },
      });
      return res.contacts;
    },
  });


  const usersQ = useQuery({
    queryKey: ["appt-assignable-users", activeBrandId],
    enabled: !!activeBrandId,
    queryFn: () => listUsersFn({ data: { brandId: activeBrandId! } }),
  });


  const selectedContact = selectedContactQ.data;
  const contactLabel = selectedContact
    ? (selectedContact.name ?? selectedContact.profile_name ?? formatPhoneDisplay(selectedContact.phone ?? selectedContact.wa_id ?? "") ?? "Contato")
    : "Selecione um contato…";

  const scheduledAtIso = useMemo(() => {
    if (!date) return null;
    const [h, m] = time.split(":").map((x) => parseInt(x, 10));
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    const d = new Date(date);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  }, [date, time]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!activeBrandId) throw new Error("Workspace não selecionado");
      if (!contactId) throw new Error("Selecione um contato");
      if (!scheduledAtIso) throw new Error("Selecione data e hora");
      if (isEdit && appointment) {
        await updateFn({
          data: {
            id: appointment.id,
            scheduledAt: scheduledAtIso,
            note: note.trim() || null,
            assigneeId: assigneeId || undefined,
          },
        });
      } else {
        await createFn({
          data: {
            brandId: activeBrandId,
            contactId,
            scheduledAt: scheduledAtIso,
            note: note.trim() || null,
            assigneeId: assigneeId || undefined,
            conversationId: conversationId ?? null,
          },
        });
      }
    },
    onSuccess: () => {
      toast.success(isEdit ? "Agendamento atualizado" : "Agendamento criado");
      qc.invalidateQueries({ queryKey: ["appointments"] });
      qc.invalidateQueries({ queryKey: ["appointments-due-count"] });
      qc.invalidateQueries({ queryKey: ["appointments-by-contact"] });
      onSaved?.();
      onOpenChange(false);
    },
    onError: (e) => toast.error((e as Error).message || "Falha ao salvar"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar agendamento" : "Novo agendamento"}</DialogTitle>
          <DialogDescription>
            Marque um lembrete para retornar o contato em data e hora específicas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Contato</Label>
            {presetContactId && selectedContact ? (
              <div className="flex h-9 items-center rounded-md border border-input bg-muted/40 px-3 text-sm">
                {contactLabel}
              </div>
            ) : (
              <div ref={contactPopRef} className="relative">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-between font-normal"
                  onClick={() => setContactPopOpen((o) => !o)}
                >
                  <span className={cn("truncate", !contactId && "text-muted-foreground")}>{contactLabel}</span>
                </Button>
                {contactPopOpen && (
                  <div className="absolute left-0 top-full z-50 mt-1 w-[380px] rounded-md border bg-popover text-popover-foreground shadow-md">
                    <div className="flex items-center border-b px-2">
                      <Search className="h-4 w-4 opacity-50 shrink-0" />
                      <input
                        autoFocus
                        value={contactSearch}
                        onChange={(e) => setContactSearch(e.target.value)}
                        placeholder="Buscar por nome, email ou telefone…"
                        className="flex h-9 w-full bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
                      />
                    </div>
                    <div className="max-h-72 overflow-auto p-1">
                      {contactSearchQ.isFetching && (
                        <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
                          <Loader2 className="mr-2 h-3 w-3 animate-spin" /> Buscando…
                        </div>
                      )}
                      {!contactSearchQ.isFetching && contactSearchDeb.trim().length < 2 && (
                        <div className="px-2 py-4 text-center text-xs text-muted-foreground">Digite ao menos 2 caracteres</div>
                      )}
                      {!contactSearchQ.isFetching && contactSearchQ.isError && (
                        <div className="px-2 py-4 text-center text-xs text-destructive">Erro ao buscar contatos</div>
                      )}
                      {!contactSearchQ.isFetching && !contactSearchQ.isError && contactSearchDeb.trim().length >= 2 && (contactSearchQ.data ?? []).length === 0 && (
                        <div className="px-2 py-4 text-center text-xs text-muted-foreground">Nenhum contato encontrado</div>
                      )}
                      {(contactSearchQ.data ?? []).map((c: any) => {
                        const phone = formatPhoneDisplay(c.phone ?? c.wa_id ?? "") || "";
                        const meta = [c.email, phone].filter(Boolean).join(" · ") || "—";
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => { setContactId(c.id); setContactPopOpen(false); }}
                            className="flex w-full flex-col items-start rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                          >
                            <span className="text-sm">{c.name ?? c.profile_name ?? "Sem nome"}</span>
                            <span className="text-xs text-muted-foreground">{meta}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Data</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !date && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date ? format(date, "PPP", { locale: ptBR }) : "Escolher data"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={date} onSelect={setDate} initialFocus className="p-3 pointer-events-auto" locale={ptBR} />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label>Hora</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Responsável</Label>
            <SearchableSelect
              value={assigneeId || undefined}
              onValueChange={setAssigneeId}
              placeholder="Selecione um atendente"
              options={(usersQ.data?.users ?? []).map((u) => ({
                value: u.id,
                label: u.full_name ?? u.email ?? u.id,
                keywords: [u.email ?? ""],
              }))}
            />
          </div>


          <div className="space-y-2">
            <Label>Anotação</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ex: ligar para confirmar pagamento, retomar negociação…"
              rows={3}
              maxLength={2000}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !contactId || !scheduledAtIso}>
            {saveMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEdit ? "Salvar" : "Criar agendamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
