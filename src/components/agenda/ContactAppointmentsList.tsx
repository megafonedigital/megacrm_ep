import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { CalendarPlus, Check, Loader2, Pencil, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  listAppointmentsByContact,
  updateAppointment,
  type AppointmentRow,
} from "@/lib/appointments.functions";
import { AppointmentFormDialog } from "@/components/agenda/AppointmentFormDialog";

interface Props {
  brandId: string;
  contactId: string;
}

const statusLabel: Record<AppointmentRow["status"], string> = {
  pending: "Pendente",
  done: "Concluído",
  missed: "Perdido",
  cancelled: "Cancelado",
};

const statusVariant: Record<AppointmentRow["status"], "default" | "secondary" | "destructive" | "outline"> = {
  pending: "default",
  done: "secondary",
  missed: "destructive",
  cancelled: "outline",
};

export function ContactAppointmentsList({ brandId, contactId }: Props) {
  const qc = useQueryClient();
  const listFn = useServerFn(listAppointmentsByContact);
  const updateFn = useServerFn(updateAppointment);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AppointmentRow | null>(null);

  const q = useQuery({
    queryKey: ["contact-appointments", contactId, brandId],
    queryFn: () => listFn({ data: { brandId, contactId } }),
    enabled: !!brandId && !!contactId,
  });

  const setStatusMut = useMutation({
    mutationFn: (vars: { id: string; status: AppointmentRow["status"] }) =>
      updateFn({ data: vars }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contact-appointments", contactId] });
      qc.invalidateQueries({ queryKey: ["appointments"] });
      qc.invalidateQueries({ queryKey: ["due-appointments"] });
    },
    onError: (e) => toast.error((e as Error).message || "Falha ao atualizar"),
  });

  const items = q.data?.appointments ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Agendamentos</div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <CalendarPlus className="mr-1.5 h-3.5 w-3.5" />
          Novo
        </Button>
      </div>

      {q.isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
          Nenhum agendamento para este contato.
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((a) => {
            const when = new Date(a.scheduled_at);
            return (
              <li
                key={a.id}
                className="rounded-md border p-3 text-sm space-y-1.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="font-medium">
                      {format(when, "dd 'de' MMM 'de' yyyy 'às' HH:mm", { locale: ptBR })}
                    </div>
                    {a.assignee?.full_name && (
                      <div className="text-xs text-muted-foreground">
                        Para: {a.assignee.full_name}
                      </div>
                    )}
                  </div>
                  <Badge variant={statusVariant[a.status]}>{statusLabel[a.status]}</Badge>
                </div>
                {a.note && (
                  <div className="text-xs text-muted-foreground line-clamp-2">{a.note}</div>
                )}
                {a.pipeline?.name && (
                  <div className="text-xs text-muted-foreground">
                    Pipeline: {a.pipeline.name}
                    {a.stage?.name ? ` · ${a.stage.name}` : ""}
                  </div>
                )}
                {a.status === "pending" && (
                  <div className="flex gap-1 pt-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        setEditing(a);
                        setOpen(true);
                      }}
                    >
                      <Pencil className="mr-1 h-3 w-3" />
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => setStatusMut.mutate({ id: a.id, status: "done" })}
                      disabled={setStatusMut.isPending}
                    >
                      <Check className="mr-1 h-3 w-3" />
                      Concluir
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                      onClick={() => setStatusMut.mutate({ id: a.id, status: "cancelled" })}
                      disabled={setStatusMut.isPending}
                    >
                      <X className="mr-1 h-3 w-3" />
                      Cancelar
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <AppointmentFormDialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setEditing(null);
        }}
        appointment={editing}
        contactId={contactId}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["contact-appointments", contactId] });
          qc.invalidateQueries({ queryKey: ["appointments"] });
          qc.invalidateQueries({ queryKey: ["due-appointments"] });
        }}
      />
    </div>
  );
}
