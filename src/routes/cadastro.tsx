import { createFileRoute, redirect, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";

export const Route = createFileRoute("/cadastro")({
  component: CadastroPage,
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/" });
  },
});

const schema = z
  .object({
    fullName: z.string().trim().min(2, "Informe seu nome completo").max(100),
    email: z.string().trim().toLowerCase().email("E-mail inválido").max(255),
    phone: z
      .string()
      .transform((v) => v.replace(/\D/g, ""))
      .refine((v) => v.length >= 10 && v.length <= 11, "Telefone inválido"),
    password: z.string().min(8, "Senha deve ter no mínimo 8 caracteres").max(72),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: "As senhas não conferem",
    path: ["confirm"],
  });

function maskPhone(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 10) {
    return d
      .replace(/^(\d{0,2})/, "($1")
      .replace(/^(\(\d{2})(\d)/, "$1) $2")
      .replace(/(\d{4})(\d)/, "$1-$2");
  }
  return d
    .replace(/^(\d{0,2})/, "($1")
    .replace(/^(\(\d{2})(\d)/, "$1) $2")
    .replace(/(\d{5})(\d)/, "$1-$2");
}

function CadastroPage() {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse({ fullName, email, phone, password, confirm });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return toast.error(first?.message ?? "Dados inválidos");
    }
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: {
          full_name: parsed.data.fullName,
          phone: parsed.data.phone,
        },
      },
    });
    setLoading(false);
    if (error) {
      const msg = /megafone\.digital/i.test(error.message)
        ? "Apenas e-mails @megafone.digital podem se cadastrar."
        : error.message.includes("registered")
          ? "Este e-mail já está cadastrado."
          : "Falha no cadastro: " + error.message;
      return toast.error(msg);
    }
    toast.success("Conta criada! Redirecionando...");
    await navigate({ to: "/", replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm p-6">
        <h1 className="mb-1 text-2xl font-bold">Criar conta</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          MegaCRM
        </p>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fullName">Nome completo</Label>
            <Input
              id="fullName"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              placeholder="seunome@megafone.digital"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Telefone</Label>
            <Input
              id="phone"
              inputMode="tel"
              placeholder="(11) 99999-9999"
              required
              value={phone}
              onChange={(e) => setPhone(maskPhone(e.target.value))}
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
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Criando..." : "Criar conta"}
          </Button>
        </form>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Já tem conta?{" "}
          <Link to="/login" className="text-primary underline-offset-4 hover:underline">
            Entrar
          </Link>
        </p>
      </Card>
    </div>
  );
}
