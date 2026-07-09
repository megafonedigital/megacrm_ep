import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { GraduationCap, UserRound, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getEllieContactStatus, type EllieContactStatus } from "@/lib/ellie-contact-status.functions";

type Variant = "full" | "compact";

function renderBadge(s: EllieContactStatus, variant: Variant) {
  if (s.status === "aluno") {
    return (
      <Badge
        className="gap-1 bg-emerald-600 hover:bg-emerald-600 text-white"
        title={`Aluno (${s.source ?? "validado"})`}
      >
        <GraduationCap className="h-3 w-3" />
        {variant === "full" ? "Aluno" : "A"}
      </Badge>
    );
  }
  if (s.status === "lead_esgotado") {
    return (
      <Badge
        variant="destructive"
        className="gap-1"
        title={`Lead — limite atingido (${s.used}/${s.limit})`}
      >
        <AlertTriangle className="h-3 w-3" />
        {variant === "full" ? `Lead • limite ${s.used}/${s.limit}` : `${s.used}/${s.limit}`}
      </Badge>
    );
  }
  if (s.status === "lead_ativo") {
    return (
      <Badge
        className="gap-1 bg-amber-500 hover:bg-amber-500 text-white"
        title={`Lead — ${s.used}/${s.limit} mensagens usadas`}
      >
        <UserRound className="h-3 w-3" />
        {variant === "full" ? `Lead ${s.used}/${s.limit}` : `${s.used}/${s.limit}`}
      </Badge>
    );
  }
  return null;
}

export function EllieStatusBadge({
  contactId,
  variant = "full",
  preloaded,
}: {
  contactId: string | null | undefined;
  variant?: Variant;
  preloaded?: EllieContactStatus | null;
}) {
  const fn = useServerFn(getEllieContactStatus);
  const { data } = useQuery({
    queryKey: ["ellie-status", contactId],
    queryFn: () => fn({ data: { contactId: contactId! } }),
    enabled: !!contactId && !preloaded,
    staleTime: 60_000,
  });
  const s = preloaded ?? (data as EllieContactStatus | undefined);
  if (!contactId || !s) return null;
  return renderBadge(s, variant);
}

export function EllieStatusBadgeStatic({
  status,
  variant = "compact",
}: {
  status: EllieContactStatus | null | undefined;
  variant?: Variant;
}) {
  if (!status) return null;
  return renderBadge(status, variant);
}
