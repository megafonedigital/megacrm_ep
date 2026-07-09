import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";

export const Route = createFileRoute("/definir-senha")({
  component: DefinirSenhaPage,
});

const schema = z
  .object({
    password: z.string().min(8, "Senha deve ter no mínimo 8 caracteres").max(72),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: "As senhas não conferem",
    path: ["confirm"],
  });

function DefinirSenhaPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [flowType, setFlowType] = useState<"invite" | "recovery" | "other">("other");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash.replace(/^#/, "");
    const params = new URLSearchParams(hash || window.location.search);
    const t = params.get("type");
    if (t === "invite" || t === "recovery") setFlowType(t);

    // Supabase processes the hash automatically; check session shortly after mount
    const check = async () => {
      const { data } = await supabase.auth.getSession();
      setHasSession(!!data.session);
    };
    check();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setHasSession(!!session);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse({ password, confirm });
    if (!parsed.success) {
      return toast.error(parsed.error.issues[0]?.message ?? "Dados inválidos");
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({
      password: parsed.data.password,
      data: { must_set_password: false },
    });
    setLoading(false);
    if (error) return toast.error("Falha ao definir senha: " + error.message);
    toast.success("Senha definida! Redirecionando...");
    await navigate({ to: "/", replace: true });
  }

  const title = flowType === "recovery" ? "Redefinir senha" : "Definir senha de acesso";
  const subtitle =
    flowType === "recovery"
      ? "Escolha uma nova senha para sua conta."
      : "Bem-vindo ao MegaCRM. Defina uma senha para acessar sua conta.";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm p-6">
        <h1 className="mb-1 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-sm text-muted-foreground">{subtitle}</p>

        {hasSession === false ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Link inválido ou expirado. Solicite um novo convite ao administrador.
            </p>
            <Link to="/login" className="text-sm text-primary underline-offset-4 hover:underline">
              Ir para o login
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Nova senha</Label>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Confirmar senha</Label>
              <Input
                id="confirm"
                type="password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading || hasSession === null}>
              {loading ? "Salvando..." : "Salvar senha"}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
