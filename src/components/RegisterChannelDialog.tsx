import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { callFunction } from "@/lib/api";

interface Props {
  channelId: string | null;
  channelName?: string;
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function RegisterChannelDialog({ channelId, channelName, open, onClose, onSuccess }: Props) {
  const [pin, setPin] = useState("");
  const qc = useQueryClient();

  const mut = useMutation({
    mutationFn: async () => {
      const { error } = await callFunction("register-phone-number", {
        channel_id: channelId,
        pin,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Número registrado na Cloud API.");
      qc.invalidateQueries({ queryKey: ["channel-diagnostics", channelId] });
      qc.invalidateQueries({ queryKey: ["brand-channels"] });
      setPin("");
      onSuccess?.();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const valid = /^\d{6}$/.test(pin);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !mut.isPending && (setPin(""), onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" /> Registrar número
          </DialogTitle>
          <DialogDescription>
            {channelName ? <>Canal <strong>{channelName}</strong>. </> : null}
            Use após alterar o <em>display name</em> na Meta ou ao conectar um número novo.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div>
            <Label htmlFor="pin">PIN de 6 dígitos</Label>
            <Input
              id="pin"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              className="mt-1 font-mono text-lg tracking-widest"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              PIN da verificação em duas etapas do número. Se ainda não houver, este PIN será definido agora.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mut.isPending}>
            Cancelar
          </Button>
          <Button onClick={() => mut.mutate()} disabled={!valid || mut.isPending}>
            {mut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Registrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
