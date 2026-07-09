import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  component: LoginPage,
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash || "";
    if (/type=(invite|recovery)/.test(hash)) {
      throw redirect({ to: "/definir-senha" });
    }
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/admin/dashboard" });
  },
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) return toast.error("Falha no login: " + error.message);
    await navigate({ to: "/admin/dashboard", replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm p-6">
        <h1 className="mb-1 text-2xl font-bold">Entrar</h1>
        <p className="mb-6 text-sm text-muted-foreground">MegaCRM</p>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Entrando..." : "Entrar"}
          </Button>
        </form>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          <Link to="/privacidade" className="hover:text-foreground hover:underline">
            Política de Privacidade
          </Link>
        </p>
      </Card>
    </div>
  );
}
