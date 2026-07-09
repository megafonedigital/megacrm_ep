import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircle, Check, X } from "lucide-react";
import { toast } from "sonner";
import {
  getPendingEscalationForConversation,
  submitEscalationReview,
} from "@/lib/ai-agents-dashboard.functions";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";

const COMMON_REASONS = [
  "Cliente pediu humano",
  "Pergunta fora do escopo",
  "Reclamação ou cancelamento",
  "Erro técnico do agente",
  "Lead qualificado para vendas",
  "Outro",
];

export function EscalationReviewBanner({ conversationId }: { conversationId: string }) {
  const qc = useQueryClient();
  const fetchPending = useServerFn(getPendingEscalationForConversation);
  const submit = useServerFn(submitEscalationReview);
  const [correcting, setCorrecting] = useState(false);
  const [reason, setReason] = useState<string>("");
  const [customReason, setCustomReason] = useState("");

  const { data } = useQuery({
    queryKey: ["escalation-pending", conversationId],
    queryFn: () => fetchPending({ data: { conversationId } }),
  });

  const reviewMut = useMutation({
    mutationFn: async (input: { runId: string; wasCorrect: boolean; validatedReason?: string }) =>
      submit({ data: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["escalation-pending", conversationId] });
      qc.invalidateQueries({ queryKey: ["agent-dashboard"] });
      toast.success("Revisão registrada");
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao registrar"),
  });

  const run = data?.run;
  if (!run) return null;

  const handleConfirm = () => {
    reviewMut.mutate({
      runId: run.id,
      wasCorrect: true,
      validatedReason: run.original_reason ?? undefined,
    });
  };

  const handleSubmitCorrection = () => {
    const final = reason === "Outro" ? customReason.trim() : reason;
    if (!final) {
      toast.error("Selecione ou descreva o motivo correto");
      return;
    }
    reviewMut.mutate({ runId: run.id, wasCorrect: false, validatedReason: final });
  };

  return (
    <div className="mx-auto w-full max-w-3xl rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="flex-1 space-y-2">
          <div>
            <span className="font-medium">{run.agent_name} escalonou esta conversa.</span>{" "}
            <span className="text-muted-foreground">
              Motivo detectado: <em>"{run.original_reason ?? "(sem motivo)"}"</em>
            </span>
          </div>

          {!correcting ? (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleConfirm}
                disabled={reviewMut.isPending}
              >
                <Check className="mr-1 h-3.5 w-3.5" /> Estava correto
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCorrecting(true)}
                disabled={reviewMut.isPending}
              >
                <X className="mr-1 h-3.5 w-3.5" /> Corrigir motivo
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger className="h-8 w-full sm:w-64">
                  <SelectValue placeholder="Motivo correto" />
                </SelectTrigger>
                <SelectContent>
                  {COMMON_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {reason === "Outro" && (
                <Input
                  className="h-8 w-full sm:w-64"
                  placeholder="Descreva o motivo"
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                />
              )}
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSubmitCorrection} disabled={reviewMut.isPending}>
                  Salvar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setCorrecting(false);
                    setReason("");
                    setCustomReason("");
                  }}
                  disabled={reviewMut.isPending}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
