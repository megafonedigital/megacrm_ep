import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plug, Plus, Loader2, Copy, Trash2, Settings, ListChecks, Building2, RefreshCw, Gauge, Pause, Play, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { PLATFORMS, PLATFORM_LIST, type IntegrationPlatform, type PlatformDef } from "@/lib/integrations-platforms";
import { useActiveBrand } from "@/lib/active-brand";
import { syncIntegrationAccount } from "@/lib/integrations-sync.functions";
import { testIntegrationConnection } from "@/lib/integrations-test.functions";
import { getGlobalLimitsSummary } from "@/lib/integrations-limits.functions";

const AUTO_SYNC_PLATFORMS = new Set(["hotmart", "activecampaign", "sendflow"]);
const QUEUE_PLATFORMS = new Set(["hotmart", "activecampaign", "sendflow"]);

export const Route = createFileRoute("/admin/integracoes")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  component: IntegrationsPage,
});

function IntegrationsPage() {
  const { me } = useMe();
  const { activeBrandId } = useActiveBrand();
  const [tab, setTab] = useState<IntegrationPlatform>("shopify");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  if (!me?.isAdmin && !me?.isDeveloper) {
    return <div className="p-6 text-sm text-muted-foreground">Apenas administradores podem gerenciar integrações.</div>;
  }

  const platform = PLATFORMS[tab];

  return (
    <div className="page-container space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Plug className="h-6 w-6" /> Integrações
          </h1>
          <p className="text-sm text-muted-foreground">
            Conecte plataformas externas e dispare automações a partir dos eventos delas.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} disabled={!activeBrandId}>
          <Plus className="h-4 w-4 mr-1" /> Nova conta
        </Button>
      </div>

      {!activeBrandId ? (
        <Card className="p-6 text-sm text-muted-foreground">Selecione um workspace no topo para ver as integrações.</Card>
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as IntegrationPlatform)}>
          <TabsList>
            {PLATFORM_LIST.map((p) => (
              <TabsTrigger key={p.id} value={p.id}>{p.label}</TabsTrigger>
            ))}
          </TabsList>
          {PLATFORM_LIST.map((p) => (
            <TabsContent key={p.id} value={p.id} className="mt-4">
              <AccountsTable platform={p} brandId={activeBrandId} onEdit={setEditing} />
            </TabsContent>
          ))}
        </Tabs>
      )}

      <AccountFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        platform={platform}
        account={null}
        brandId={activeBrandId}
      />

      {editing && (
        <AccountDetailsSheet
          account={editing}
          onOpenChange={(o) => { if (!o) setEditing(null); }}
        />
      )}
    </div>
  );
}

function AccountsTable({ platform, brandId, onEdit }: { platform: PlatformDef; brandId: string; onEdit: (a: any) => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["integration-accounts", platform.id, brandId],
    queryFn: async () => {
      const { data: links } = await supabase
        .from("integration_account_brands" as any)
        .select("account_id")
        .eq("brand_id", brandId);
      const ids = (links ?? []).map((r: any) => r.account_id);
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from("integration_accounts" as any)
        .select("id, name, status, last_event_at, last_polled_at, created_at, polling_enabled")
        .eq("platform", platform.id)
        .in("id", ids)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const remove = async (id: string) => {
    if (!confirm("Excluir esta conta de integração? Os eventos recebidos serão removidos.")) return;
    const { error } = await supabase.from("integration_accounts" as any).delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Conta excluída");
    qc.invalidateQueries({ queryKey: ["integration-accounts", platform.id] });
  };

  return (
    <Card className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nome</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Polling</TableHead>
            <TableHead>Última sync</TableHead>
            <TableHead>Último evento</TableHead>
            <TableHead>Criada</TableHead>
            <TableHead className="w-[140px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {q.isLoading && <TableRow><TableCell colSpan={7} className="text-center py-6"><Loader2 className="h-4 w-4 animate-spin inline" /></TableCell></TableRow>}
          {q.data?.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-10 text-sm text-muted-foreground">Nenhuma conta {platform.label} cadastrada.</TableCell></TableRow>}
          {q.data?.map((a: any) => (
            <TableRow key={a.id}>
              <TableCell className="font-medium">{a.name}</TableCell>
              <TableCell>
                <Badge variant={a.status === "active" ? "default" : a.status === "error" ? "destructive" : "secondary"}>
                  {a.status}
                </Badge>
              </TableCell>
              <TableCell className="text-xs">{a.polling_enabled ? "Sim" : "—"}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{a.last_polled_at ? new Date(a.last_polled_at).toLocaleString("pt-BR") : "—"}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{a.last_event_at ? new Date(a.last_event_at).toLocaleString("pt-BR") : "—"}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString("pt-BR")}</TableCell>
              <TableCell className="flex gap-1">
                <Button size="icon" variant="ghost" onClick={() => onEdit({ ...a, platform: platform.id })}>
                  <Settings className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => remove(a.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function AccountFormDialog({
  open, onOpenChange, platform, account, brandId,
}: {
  open: boolean; onOpenChange: (o: boolean) => void;
  platform: PlatformDef; account: any | null; brandId?: string | null;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(account?.name ?? "");
  const [creds, setCreds] = useState<Record<string, string>>(account?.credentials ?? {});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return toast.error("Informe o nome");
    for (const f of platform.credentialFields) {
      if (f.required && !creds[f.key]?.trim()) return toast.error(`Preencha: ${f.label}`);
    }
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    const row = {
      platform: platform.id,
      name: name.trim(),
      credentials: creds,
      created_by: u.user?.id,
      status: "active",
    };
    let newId: string | null = null;
    if (account) {
      const { error } = await supabase.from("integration_accounts" as any).update(row).eq("id", account.id);
      if (error) { setBusy(false); return toast.error(error.message); }
    } else {
      const { data, error } = await supabase.from("integration_accounts" as any).insert(row).select("id").single();
      if (error) { setBusy(false); return toast.error(error.message); }
      newId = (data as any)?.id ?? null;
      if (newId && brandId) {
        await supabase.from("integration_account_brands" as any).insert({ account_id: newId, brand_id: brandId });
      }
    }
    setBusy(false);
    toast.success(account ? "Atualizada" : "Criada e vinculada ao workspace.");
    qc.invalidateQueries({ queryKey: ["integration-accounts", platform.id] });
    onOpenChange(false);
    setName(""); setCreds({});
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setName(""); setCreds({}); } }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{account ? "Editar" : "Nova"} conta {platform.label}</DialogTitle>
          <DialogDescription>Configure as credenciais. Após salvar, vincule um ou mais Workspaces.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`Ex.: ${platform.label} loja principal`} />
          </div>

          {(["api", "webhook"] as const).map((group) => {
            const fields = platform.credentialFields.filter((f) => f.group === group);
            if (fields.length === 0) return null;
            const isApi = group === "api";
            return (
              <div key={group} className="rounded-lg border p-3 space-y-3 bg-muted/30">
                <div>
                  <div className="text-sm font-semibold">
                    {isApi ? "Credenciais da API" : "Webhook (validação de eventos)"}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {isApi
                      ? (platform.apiCredentialsHelp ?? "Necessárias para o MegaCRM consultar a API da plataforma.") +
                        " Você obtém esses valores dentro da plataforma e cola aqui."
                      : "Token enviado pela plataforma a cada evento. Usado para garantir que o webhook é legítimo."}
                  </p>
                  {isApi && platform.apiCredentialsDocUrl && (
                    <a
                      href={platform.apiCredentialsDocUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-primary underline mt-1 inline-block"
                    >
                      Onde encontrar →
                    </a>
                  )}
                </div>
                {fields.map((f) => (
                  <div key={f.key}>
                    <Label>{f.label}{f.required && <span className="text-destructive ml-1">*</span>}</Label>
                    <Input
                      type={f.type === "password" ? "password" : "text"}
                      value={creds[f.key] ?? ""}
                      onChange={(e) => setCreds((c) => ({ ...c, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                    />
                    {f.hint && <p className="text-[11px] text-muted-foreground mt-1">{f.hint}</p>}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>{busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AccountDetailsSheet({
  account, onOpenChange,
}: { account: any; onOpenChange: (o: boolean) => void }) {
  const platform = PLATFORMS[account.platform as IntegrationPlatform];
  const qc = useQueryClient();
  const webhookSupported = platform.webhookSupported !== false;
  const queueSupported = QUEUE_PLATFORMS.has(account.platform);
  const [section, setSection] = useState<"webhook" | "brands" | "products" | "queue">(webhookSupported ? "webhook" : "products");

  const fullQ = useQuery({
    queryKey: ["integration-account", account.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("integration_accounts" as any)
        .select("id, name, platform, credentials, webhook_secret, polling_enabled, status, rate_limit_per_minute, rate_limit_burst, queue_paused, last_drain_at")
        .eq("id", account.id)
        .single();
      return data;
    },
  });

  const brandsQ = useQuery({
    queryKey: ["all-brands"],
    queryFn: async () => (await supabase.from("brands").select("id, name").order("name")).data ?? [],
  });
  const linksQ = useQuery({
    queryKey: ["account-brand-links", account.id],
    queryFn: async () => {
      const { data } = await supabase.from("integration_account_brands" as any)
        .select("brand_id").eq("account_id", account.id);
      return new Set((data ?? []).map((r: any) => r.brand_id));
    },
  });
  // Painel "Eventos" foi removido — esses dados agora aparecem em Admin → Logs da API.
  const productsQ = useQuery({
    queryKey: ["integration-products", account.id],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      // Supabase default row cap is 1000. Marcelo (AC) tem >1000 registros:
      // páginamos explicitamente pra não truncar silenciosamente.
      const PAGE = 1000;
      const all: any[] = [];
      for (let from = 0; from < 20000; from += PAGE) {
        const { data, error } = await supabase.from("integration_products" as any)
          .select("id, name, external_id, type, last_synced_at")
          .eq("account_id", account.id)
          .order("type")
          .order("name")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const rows = (data ?? []) as any[];
        all.push(...rows);
        if (rows.length < PAGE) break;
      }
      return all;
    },
  });


  const webhookUrl = useMemo(() => {
    // URL pública estável (domínio customizado evita o redirect 302 do *.lovable.app).
    return `https://megacrm.megafone.digital/api/public/webhooks/${account.platform}/${account.id}`;
  }, [account]);
  const usesPlatformSecret = account.platform === "shopify";

  const togglePolling = async (v: boolean) => {
    await supabase.from("integration_accounts" as any).update({ polling_enabled: v }).eq("id", account.id);
    qc.invalidateQueries({ queryKey: ["integration-account", account.id] });
    qc.invalidateQueries({ queryKey: ["integration-accounts", account.platform] });
  };

  const toggleBrand = async (brandId: string, checked: boolean) => {
    if (checked) {
      await supabase.from("integration_account_brands" as any).insert({ account_id: account.id, brand_id: brandId });
    } else {
      await supabase.from("integration_account_brands" as any).delete()
        .eq("account_id", account.id).eq("brand_id", brandId);
    }
    qc.invalidateQueries({ queryKey: ["account-brand-links", account.id] });
  };

  const [addProductOpen, setAddProductOpen] = useState(false);

  const syncFn = useServerFn(syncIntegrationAccount);
  const testFn = useServerFn(testIntegrationConnection);
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [editOpen, setEditOpen] = useState(false);
  const supportsAutoSync = AUTO_SYNC_PLATFORMS.has(account.platform);
  const authHeaders = async (): Promise<Record<string, string>> => {
    const { data } = await supabase.auth.getSession();
    const t = data.session?.access_token;
    return t ? { Authorization: `Bearer ${t}` } : {};
  };
  const runSync = async () => {
    setSyncing(true);
    try {
      const r: any = await syncFn({ data: { accountId: account.id }, headers: await authHeaders() });
      const parts = Object.entries(r.results ?? {}).map(
        ([k, v]: any) => `${k}: +${v.added}/~${v.updated}/-${v.removed}`
      );
      toast.success(`Sincronização ok — ${parts.join(", ") || "nenhum item"}`);
      await qc.refetchQueries({ queryKey: ["integration-products", account.id], type: "active" });
      qc.invalidateQueries({ queryKey: ["integration-accounts", account.platform] });

    } catch (e: any) {
      toast.error(`Falha: ${e?.message ?? e}`);
    } finally {
      setSyncing(false);
    }
  };
  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r: any = await testFn({ data: { accountId: account.id }, headers: await authHeaders() });
      setTestResult(r);
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setTestResult({ ok: false, message: msg });
      toast.error(`Falha: ${msg}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <Sheet open={true} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center justify-between gap-3">
            <span>{account.name} <span className="text-xs text-muted-foreground font-normal">({platform.label})</span></span>
            <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>Editar credenciais</Button>
          </SheetTitle>
        </SheetHeader>
        {editOpen && fullQ.data && (
          <AccountFormDialog
            open={editOpen}
            onOpenChange={(o) => {
              setEditOpen(o);
              if (!o) qc.invalidateQueries({ queryKey: ["integration-account", account.id] });
            }}
            platform={platform}
            account={{ ...account, credentials: (fullQ.data as any).credentials ?? {} }}
          />
        )}
        <div className="mt-4 flex gap-2 border-b pb-2 flex-wrap">
          {([
            ...(webhookSupported ? [["webhook", "Webhook"] as const] : []),
            ["brands", "Workspaces"] as const,
            ["products", platform.productLabel + "s"] as const,
            ...(queueSupported ? [["queue", "Fila & limites"] as const] : []),
          ]).map(([k, l]) => (
            <Button key={k} size="sm" variant={section === k ? "default" : "ghost"} onClick={() => setSection(k as any)}>{l}</Button>
          ))}
        </div>

        {section === "webhook" && fullQ.data && (
          <div className="mt-4 space-y-4">
            <div className="rounded border border-primary/30 bg-primary/5 p-3 text-xs">
              <div className="font-medium mb-1">
                {usesPlatformSecret
                  ? `O segredo de assinatura é gerado pela ${platform.label}`
                  : "Estes valores são gerados pelo MegaCRM"}
              </div>
              <p className="text-muted-foreground">
                {usesPlatformSecret
                  ? `Copie o 'Webhook signing secret' dentro da ${platform.label} e salve em Editar credenciais. O MegaCRM usa esse segredo para validar cada webhook recebido.`
                  : `Copie e cole nos webhooks da ${platform.label}. Você não precisa buscá-los lá — é o MegaCRM que entrega para a plataforma.`}
              </p>
              <p className="text-muted-foreground mt-1">{platform.webhookHint}</p>
            </div>
            <div>
              <Label>URL do webhook</Label>
              <div className="flex gap-2">
                <Input readOnly value={webhookUrl} className="font-mono text-xs" />
                <Button size="icon" variant="outline" onClick={() => { navigator.clipboard.writeText(webhookUrl); toast.success("URL copiada"); }}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {!usesPlatformSecret && (
              <div>
                <Label>Webhook signing secret</Label>
                <div className="flex gap-2">
                  <Input readOnly value={(fullQ.data as any).webhook_secret} className="font-mono text-xs" />
                  <Button size="icon" variant="outline" onClick={() => { navigator.clipboard.writeText((fullQ.data as any).webhook_secret); toast.success("Segredo copiado"); }}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
            {usesPlatformSecret && (
              <div className="rounded border p-3 text-xs">
                <div className="font-medium mb-1">Segredo de assinatura configurado</div>
                <p className="text-muted-foreground">
                  {((fullQ.data as any).credentials?.webhook_signing_secret ?? "").trim()
                    ? "Um segredo já está salvo. Para trocar, clique em 'Editar credenciais' no topo."
                    : "Ainda não há segredo salvo. Clique em 'Editar credenciais' no topo e cole o 'Webhook signing secret' da Shopify."}
                </p>
              </div>
            )}
            <div className="flex items-center justify-between rounded border p-3">
              <div>
                <div className="text-sm font-medium">Polling de fallback</div>
                <div className="text-xs text-muted-foreground">Consulta a API a cada 5 min para garantir captura de eventos perdidos.</div>
              </div>
              <Switch checked={(fullQ.data as any).polling_enabled} onCheckedChange={togglePolling} />
            </div>
          </div>
        )}

        {section === "products" && supportsAutoSync && (
          <div className="rounded border p-3 space-y-2 mt-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Testar credenciais da API</div>
                <div className="text-xs text-muted-foreground">Chama a API da {platform.label} usando as credenciais cadastradas.</div>
              </div>
              <Button size="sm" variant="outline" onClick={runTest} disabled={testing}>
                {testing ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
                Testar agora
              </Button>
            </div>
            {testResult && (
              <div className={`text-xs rounded p-2 ${testResult.ok ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200" : "bg-destructive/10 text-destructive"}`}>
                <div className="font-medium">{testResult.ok ? "OK" : "Falhou"}{testResult.status ? ` · HTTP ${testResult.status}` : ""}</div>
                <div className="mt-0.5 break-all">{testResult.message}</div>
                {testResult.sample && (
                  <pre className="mt-1 text-[10px] opacity-80 overflow-x-auto">{JSON.stringify(testResult.sample, null, 2)}</pre>
                )}
              </div>
            )}
          </div>
        )}

        {section === "brands" && (
          <div className="mt-4 space-y-2">
            <p className="text-xs text-muted-foreground flex items-center gap-1"><Building2 className="h-3 w-3" /> Selecione quais Workspaces usarão esta integração.</p>
            {brandsQ.data?.map((b: any) => (
              <label key={b.id} className="flex items-center gap-2 p-2 rounded border cursor-pointer hover:bg-muted/40">
                <Checkbox
                  checked={linksQ.data?.has(b.id) ?? false}
                  onCheckedChange={(v) => toggleBrand(b.id, !!v)}
                />
                <span className="text-sm">{b.name}</span>
              </label>
            ))}
          </div>
        )}

        {section === "products" && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <ListChecks className="h-3 w-3" /> {platform.productLabel}s usados nos seletores das automações.
              </p>
              {supportsAutoSync ? (
                <Button size="sm" variant="outline" onClick={runSync} disabled={syncing}>
                  {syncing ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                  Sincronizar agora
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setAddProductOpen(true)}>+ Adicionar</Button>
              )}
            </div>
            {supportsAutoSync && (
              <p className="text-[11px] text-muted-foreground">
                Sincronização automática a cada hora. Itens removidos da plataforma são apagados aqui.
              </p>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>ID externo</TableHead>
                  <TableHead>Última sync</TableHead>
                  {!supportsAutoSync && <TableHead className="w-[60px]" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {productsQ.data?.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-6 text-sm text-muted-foreground">{supportsAutoSync ? "Clique em Sincronizar agora para puxar os itens." : "Nenhum cadastrado."}</TableCell></TableRow>}
                {productsQ.data?.map((p: any) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.name}</TableCell>
                    <TableCell><Badge variant="secondary" className="text-[10px]">{p.type}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{p.external_id}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.last_synced_at ? new Date(p.last_synced_at).toLocaleString("pt-BR") : "—"}</TableCell>
                    {!supportsAutoSync && (
                      <TableCell>
                        <Button size="icon" variant="ghost" onClick={async () => {
                          await supabase.from("integration_products" as any).delete().eq("id", p.id);
                          qc.invalidateQueries({ queryKey: ["integration-products", account.id] });
                        }}>
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {section === "queue" && queueSupported && fullQ.data && (
          <QueueSection account={account} full={fullQ.data as any} />
        )}

      </SheetContent>
      <AddProductDialog
        open={addProductOpen}
        onOpenChange={setAddProductOpen}
        account={account}
        platform={platform}
        onCreated={() => qc.invalidateQueries({ queryKey: ["integration-products", account.id] })}
      />
    </Sheet>
  );
}

function AddProductDialog({
  open, onOpenChange, account, platform, onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  account: any;
  platform: PlatformDef;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [externalId, setExternalId] = useState("");
  const [busy, setBusy] = useState(false);
  const label = platform.productLabel.toLowerCase();

  const reset = () => { setName(""); setExternalId(""); setBusy(false); };

  const submit = async () => {
    const n = name.trim();
    const eid = externalId.trim();
    if (!n || !eid) return toast.error("Preencha nome e ID externo.");
    setBusy(true);
    const { error } = await supabase.from("integration_products" as any).insert({
      account_id: account.id, name: n, external_id: eid, type: platform.productType,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`${platform.productLabel} adicionado`);
    onCreated();
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar {label}</DialogTitle>
          <DialogDescription>
            Cadastre manualmente um {label} desta conta {platform.label} para usar nos seletores das automações.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ap-name">Nome</Label>
            <Input id="ap-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={`Ex.: Meu ${platform.productLabel}`} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ap-eid">ID externo na plataforma</Label>
            <Input id="ap-eid" value={externalId} onChange={(e) => setExternalId(e.target.value)} placeholder="Ex.: 8123456789012" />
            <p className="text-xs text-muted-foreground">
              No Shopify, é o ID numérico do produto que aparece na URL do admin (…/products/<strong>1234567890</strong>).
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Adicionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QueueSection({ account, full }: { account: any; full: any }) {
  const qc = useQueryClient();
  const [rpm, setRpm] = useState<number>(full.rate_limit_per_minute ?? 60);
  const [burst, setBurst] = useState<number>(full.rate_limit_burst ?? 10);
  const [saving, setSaving] = useState(false);
  const fetchSummary = useServerFn(getGlobalLimitsSummary);

  const summaryQ = useQuery({
    queryKey: ["queues-global-summary"],
    queryFn: () => fetchSummary(),
    refetchInterval: 30_000,
  });
  const globalRpm = summaryQ.data?.rpm ?? 3000;
  const globalBurst = summaryQ.data?.burst ?? 500;
  const overCap = rpm > globalRpm || burst > globalBurst;

  const metricsQ = useQuery({
    queryKey: ["integration-queue-metrics", account.id],
    refetchInterval: 5000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integration_event_queue" as any)
        .select("status")
        .eq("account_id", account.id)
        .limit(10000);
      if (error) throw error;
      const counts: Record<string, number> = { pending: 0, processing: 0, done: 0, failed: 0, skipped: 0 };
      for (const r of (data ?? []) as any[]) counts[r.status] = (counts[r.status] ?? 0) + 1;
      return counts;
    },
  });

  const recentQ = useQuery({
    queryKey: ["integration-queue-recent", account.id],
    refetchInterval: 5000,
    queryFn: async () => {
      const { data } = await supabase
        .from("integration_event_queue" as any)
        .select("id, status, event_type, attempts, last_error, received_at, finished_at")
        .eq("account_id", account.id)
        .order("received_at", { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });

  const saveLimits = async () => {
    if (overCap) {
      toast.error(`Valores excedem o teto da faixa global (${globalRpm}/${globalBurst}).`);
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("integration_accounts" as any)
      .update({ rate_limit_per_minute: rpm, rate_limit_burst: burst })
      .eq("id", account.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Limites atualizados");
    qc.invalidateQueries({ queryKey: ["integration-account", account.id] });
  };

  const togglePause = async (v: boolean) => {
    await supabase.from("integration_accounts" as any).update({ queue_paused: v }).eq("id", account.id);
    qc.invalidateQueries({ queryKey: ["integration-account", account.id] });
    toast.success(v ? "Fila pausada" : "Fila retomada");
  };

  const reprocessFailed = async () => {
    if (!confirm("Reenfileirar todos os eventos com falha desta conta?")) return;
    const { error } = await supabase.from("integration_event_queue" as any)
      .update({ status: "pending", attempts: 0, last_error: null, next_attempt_at: new Date().toISOString() })
      .eq("account_id", account.id)
      .eq("status", "failed");
    if (error) return toast.error(error.message);
    toast.success("Eventos reenfileirados");
    qc.invalidateQueries({ queryKey: ["integration-queue-metrics", account.id] });
    qc.invalidateQueries({ queryKey: ["integration-queue-recent", account.id] });
  };

  const m = metricsQ.data ?? { pending: 0, processing: 0, done: 0, failed: 0, skipped: 0 };

  return (
    <div className="mt-4 space-y-4">
      <div className="rounded border border-primary/30 bg-primary/5 p-3 text-xs">
        <div className="font-medium mb-1 flex items-center gap-1"><Gauge className="h-3 w-3" /> Como funciona</div>
        <p className="text-muted-foreground">
          Webhooks recebidos são enfileirados imediatamente (resposta &lt; 50ms) e processados por um worker respeitando o limite por minuto desta conta. Isso evita sobrecarga em picos (ex.: milhares de pessoas entrando num grupo ao mesmo tempo).
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {[
          ["Pendentes", m.pending, "text-amber-600"],
          ["Processando", m.processing, "text-blue-600"],
          ["Concluídos", m.done, "text-emerald-600"],
          ["Falhas", m.failed, "text-destructive"],
          ["Ignorados", m.skipped, "text-muted-foreground"],
        ].map(([l, v, c]: any) => (
          <Card key={l} className="p-3">
            <div className="text-[11px] text-muted-foreground">{l}</div>
            <div className={`text-xl font-semibold ${c}`}>{v}</div>
          </Card>
        ))}
      </div>

      <Card className="p-3 space-y-3">
        <div className="text-sm font-medium flex items-center justify-between">
          <span>Limites desta conta</span>
          <span className="text-[11px] font-normal text-muted-foreground">
            Teto da faixa global: <strong>{globalRpm}/min · burst {globalBurst}</strong>
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Eventos por minuto</Label>
            <Input type="number" min={1} max={globalRpm} value={rpm}
              onChange={(e) => setRpm(Math.min(globalRpm, Math.max(1, Number(e.target.value) || 0)))} />
            <p className="text-[11px] text-muted-foreground mt-1">Throughput sustentado. Máx. {globalRpm}.</p>
          </div>
          <div>
            <Label className="text-xs">Burst (rajada)</Label>
            <Input type="number" min={1} max={globalBurst} value={burst}
              onChange={(e) => setBurst(Math.min(globalBurst, Math.max(1, Number(e.target.value) || 0)))} />
            <p className="text-[11px] text-muted-foreground mt-1">Picos curtos. Máx. {globalBurst}.</p>
          </div>
        </div>
        {overCap && (
          <p className="text-[11px] text-destructive">Os valores excedem o teto da faixa global atual.</p>
        )}
        <div className="flex justify-end">
          <Button size="sm" onClick={saveLimits} disabled={saving || overCap}>
            {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />} Salvar limites
          </Button>
        </div>
      </Card>

      <Card className="p-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium flex items-center gap-1">
            {full.queue_paused ? <Pause className="h-4 w-4 text-destructive" /> : <Play className="h-4 w-4 text-emerald-600" />}
            {full.queue_paused ? "Fila pausada" : "Fila ativa"}
          </div>
          <div className="text-xs text-muted-foreground">
            Quando pausada, novos eventos são enfileirados mas não processados.
          </div>
        </div>
        <Switch checked={!!full.queue_paused} onCheckedChange={togglePause} />
      </Card>

      {!!m.failed && (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={reprocessFailed}>
            <RotateCcw className="h-3 w-3 mr-1" /> Reprocessar falhas ({m.failed})
          </Button>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Último drain: {full.last_drain_at ? new Date(full.last_drain_at).toLocaleString("pt-BR") : "—"} · Worker roda a cada 1 min.
      </p>
    </div>
  );
}
