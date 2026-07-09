import { createFileRoute, redirect } from "@tanstack/react-router";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { TagsManager } from "@/components/settings/TagsManager";
import { CustomFieldsManager } from "@/components/settings/CustomFieldsManager";
import { useActiveBrand } from "@/lib/active-brand";

export const Route = createFileRoute("/admin/configuracoes")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  component: ConfiguracoesPage,
});

function ConfiguracoesPage() {
  const { activeBrandId, activeBrand } = useActiveBrand();
  if (!activeBrandId) {
    return <div className="p-6 text-sm text-muted-foreground">Selecione um workspace.</div>;
  }
  return (
    <div className="page-container space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Campos e Tags</h1>
        <p className="text-sm text-muted-foreground">
          Workspace: <span className="font-medium">{activeBrand?.name}</span>
        </p>
      </div>
      <Tabs defaultValue="tags" className="w-full">
        <TabsList>
          <TabsTrigger value="tags">Tags</TabsTrigger>
          <TabsTrigger value="custom">Campos personalizados</TabsTrigger>
        </TabsList>
        <TabsContent value="tags" className="pt-4">
          <TagsManager brandId={activeBrandId} />
        </TabsContent>
        <TabsContent value="custom" className="pt-4">
          <CustomFieldsManager brandId={activeBrandId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
