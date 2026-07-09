import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const guard = async () => {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw redirect({ to: "/login" });
};

function Placeholder({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-4xl">
        <Link to="/" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Link>
        <Card className="p-8 text-center">
          <h1 className="mb-2 text-2xl font-bold">{title}</h1>
          <p className="mb-4 text-muted-foreground">{desc}</p>
          <p className="text-sm text-muted-foreground">
            <strong>Em construção.</strong> O backend desta área já está implementado e funcional via API
            (Edge Functions / banco). A interface é o próximo passo deste sprint.
          </p>
        </Card>
      </div>
    </div>
  );
}

export { guard, Placeholder };
