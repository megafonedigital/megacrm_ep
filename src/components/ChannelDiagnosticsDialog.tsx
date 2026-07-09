import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2, XCircle, Copy, RefreshCw, Loader2, AlertTriangle, Webhook, KeyRound, FileText, Users, ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { callFunction } from "@/lib/api";
import { RegisterChannelDialog } from "@/components/RegisterChannelDialog";

interface Diagnostics {
  channel: {
    id: string;
    name: string;
    phone_number: string | null;
    phone_number_id: string | null;
    waba_id: string | null;
    app_id: string | null;
    token_valid: boolean;
    token_last_validated_at: string | null;
    token_last_error: string | null;
    last_webhook_at: string | null;
    templates_last_sync_at: string | null;
    templates_last_error: string | null;
    webhook_verify_token: string;
    registered_at: string | null;
    registration_last_error: string | null;
    use_global_webhook: boolean;
  };
  webhook_url: string;
  webhook_verify_token: string;
  use_global_webhook: boolean;
  dedicated_webhook_url: string;
  dedicated_verify_token: string;
  global_webhook_url: string;
  global_verify_token: string;
  counts: { webhooks_received: number; templates: number; agents: number };
  has_token: boolean;
}


function rel(ts: string | null) {
  if (!ts) return "nunca";
  const d = new Date(ts);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "há instantes";
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
  return d.toLocaleString("pt-BR");
}

function CopyField({ label, value, mono = true, secret = false }: { label: string; value: string; mono?: boolean; secret?: boolean }) {
  const [show, setShow] = useState(!secret);
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="mt-1 flex gap-2">
        <Input
          value={show ? value : value.replace(/./g, "•")}
          readOnly
          className={mono ? "font-mono text-xs" : "text-xs"}
        />
        {secret && (
          <Button variant="outline" size="sm" onClick={() => setShow(!show)}>
            {show ? "Ocultar" : "Mostrar"}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            navigator.clipboard.writeText(value);
            toast.success("Copiado!");
          }}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function Status({ ok, label, warn = false }: { ok: boolean; label: string; warn?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {ok ? (
        <CheckCircle2 className="h-4 w-4 text-success" />
      ) : warn ? (
        <AlertTriangle className="h-4 w-4 text-warning" />
      ) : (
        <XCircle className="h-4 w-4 text-destructive" />
      )}
      <span>{label}</span>
    </div>
  );
}

export function ChannelDiagnosticsDialog({
  channelId,
  open,
  onClose,
}: { channelId: string | null; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [registerOpen, setRegisterOpen] = useState(false);


  const q = useQuery<Diagnostics>({
    queryKey: ["channel-diagnostics", channelId],
    enabled: !!channelId && open,
    queryFn: async () => {
      const { data, error } = await callFunction<Diagnostics>("channel-diagnostics", { channel_id: channelId });
      if (error) throw new Error(error.message);
      return data!;
    },
    refetchInterval: open ? 5000 : false,
  });

  const regen = useMutation({
    mutationFn: async () => {
      const newToken = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      const { error } = await supabase
        .from("brand_channels")
        .update({ webhook_verify_token: newToken })
        .eq("id", channelId!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Novo verify token gerado. Atualize na Meta.");
      qc.invalidateQueries({ queryKey: ["channel-diagnostics", channelId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleMode = useMutation({
    mutationFn: async (useGlobal: boolean) => {
      const { error } = await supabase
        .from("brand_channels")
        .update({ use_global_webhook: useGlobal })
        .eq("id", channelId!);
      if (error) throw error;
      return useGlobal;
    },
    onSuccess: (useGlobal) => {
      toast.success(
        useGlobal
          ? "Modo compartilhado ativado. Use a URL/token globais na Meta."
          : "Modo dedicado ativado. Use a URL/token deste canal na Meta.",
      );
      qc.invalidateQueries({ queryKey: ["channel-diagnostics", channelId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const revalidate = useMutation({
    mutationFn: async () => {
      const { error } = await callFunction("validate-brand-token", { channel_id: channelId });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Token revalidado.");
      qc.invalidateQueries({ queryKey: ["channel-diagnostics", channelId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sync = useMutation({
    mutationFn: async () => {
      const { data, error } = await callFunction<{ synced: number }>("sync-templates", { channel_id: channelId });
      if (error) throw new Error(error.message);
      return data?.synced ?? 0;
    },
    onSuccess: (n) => {
      toast.success(`${n} templates sincronizados.`);
      qc.invalidateQueries({ queryKey: ["channel-diagnostics", channelId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  type SubscribedApp = {
    whatsapp_business_api_data?: { id?: string; name?: string; link?: string };
    override_callback_uri?: string;
  };
  const [subApps, setSubApps] = useState<SubscribedApp[] | null>(null);

  const listSubs = useMutation({
    mutationFn: async () => {
      const { data, error } = await callFunction<{ subscribed_apps: SubscribedApp[] }>(
        "subscribe-waba",
        { channel_id: channelId, action: "list" },
      );
      if (error) throw new Error(error.message);
      return data?.subscribed_apps ?? [];
    },
    onSuccess: (apps) => {
      setSubApps(apps);
      toast.success(
        apps.length
          ? `${apps.length} App(s) inscrito(s) neste WABA.`
          : "Nenhum App inscrito neste WABA — clique em Reinscrever.",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const subscribe = useMutation({
    mutationFn: async () => {
      const { data, error } = await callFunction<{ subscribed_apps: SubscribedApp[] }>(
        "subscribe-waba",
        { channel_id: channelId, action: "subscribe" },
      );
      if (error) throw new Error(error.message);
      return data?.subscribed_apps ?? [];
    },
    onSuccess: (apps) => {
      setSubApps(apps);
      toast.success("WABA inscrito no App. Peça uma mensagem de teste pra confirmar.");
    },
    onError: (e: Error) => toast.error(e.message),
  });


  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Diagnóstico do canal</DialogTitle>
          <DialogDescription>
            Verifique a integração com a Meta. Atualiza automaticamente.
          </DialogDescription>
        </DialogHeader>

        {q.isLoading || !q.data ? (
          <div className="flex items-center gap-2 py-8 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</div>
        ) : (
          <div className="grid gap-5">
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="grid gap-1.5">
                <Status ok={q.data.has_token} label="Token cadastrado" />
                <Status ok={q.data.channel.token_valid} label={`Token válido${q.data.channel.token_last_validated_at ? ` (validado ${rel(q.data.channel.token_last_validated_at)})` : ""}`} />
                <Status ok={!!q.data.channel.last_webhook_at} warn={!q.data.channel.last_webhook_at} label={`Webhook recebendo eventos (${q.data.counts.webhooks_received} no total)`} />
                <Status ok={q.data.counts.agents > 0} warn={q.data.counts.agents === 0} label={`${q.data.counts.agents} agente(s) atribuído(s)`} />
                <Status ok={q.data.counts.templates > 0} warn={q.data.counts.templates === 0} label={`${q.data.counts.templates} template(s) sincronizado(s)`} />
                <Status
                  ok={!!q.data.channel.registered_at}
                  warn={!q.data.channel.registered_at}
                  label={q.data.channel.registered_at
                    ? `Número registrado na Cloud API (${rel(q.data.channel.registered_at)})`
                    : "Número não registrado na Cloud API"}
                />
              </div>
            </div>

            {/* Webhook */}
            <section>
              <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <Webhook className="h-4 w-4" /> Webhook na Meta
              </h4>
              <div className="grid gap-3 rounded-lg border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={q.data.use_global_webhook ? "default" : "outline"}>
                    {q.data.use_global_webhook ? "Modo: compartilhado (1 App p/ vários canais)" : "Modo: dedicado (1 App por canal)"}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => toggleMode.mutate(!q.data!.use_global_webhook)}
                    disabled={toggleMode.isPending}
                  >
                    {toggleMode.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    {q.data.use_global_webhook ? "Trocar para dedicado" : "Trocar para compartilhado"}
                  </Button>
                </div>
                <CopyField label="Callback URL" value={q.data.webhook_url} />
                <div>
                  <CopyField label="Verify Token" value={q.data.webhook_verify_token} secret />
                  {!q.data.use_global_webhook && (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      onClick={() => regen.mutate()}
                      disabled={regen.isPending}
                    >
                      {regen.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                      Gerar novo verify token
                    </Button>
                  )}
                </div>
                <div className="rounded-md bg-muted p-3 text-xs leading-relaxed text-muted-foreground">
                  <strong className="text-foreground">Como configurar na Meta:</strong>
                  <ol className="mt-1 ml-4 list-decimal space-y-0.5">
                    <li>Acesse <em>App &gt; WhatsApp &gt; Configuration &gt; Webhook</em></li>
                    <li>Cole a Callback URL e o Verify Token acima</li>
                    <li>Inscreva-se nos campos <code className="rounded bg-background px-1">messages</code> e <code className="rounded bg-background px-1">message_status</code></li>
                    <li>Em <em>WhatsApp Manager &gt; sua WABA &gt; Subscribed Apps</em>, confirme que o app está inscrito (use o botão "Reinscrever" abaixo)</li>
                  </ol>
                  {q.data.use_global_webhook ? (
                    <p className="mt-2">
                      <strong className="text-foreground">Modo compartilhado:</strong> a mesma Callback URL e o mesmo Verify Token podem ser usados em <strong>1 App único da Meta</strong> para todos os canais/WABAs deste workspace (e de outros que também optarem por este modo). O roteamento é feito pelo <code className="rounded bg-background px-1">phone_number_id</code>.
                    </p>
                  ) : (
                    <p className="mt-2">
                      <strong className="text-foreground">Modo dedicado:</strong> URL e token exclusivos deste canal. Use quando o cliente tem o próprio App da Meta. Para usar 1 App único para vários números, troque para o modo compartilhado.
                    </p>
                  )}
                </div>
                {!q.data.channel.last_webhook_at && (
                  <div className="rounded-md bg-warning/10 p-2 text-xs text-warning-foreground">
                    Nenhum webhook recebido ainda. Verifique a configuração na Meta.
                  </div>
                )}
              </div>
            </section>


            {/* Inscrição do WABA no App */}
            <section>
              <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="h-4 w-4" /> Inscrição do WABA neste App
              </h4>
              <div className="grid gap-3 rounded-lg border p-4">
                <div className="text-xs text-muted-foreground">
                  Após trocar o App da Meta, o WABA precisa ser <strong>reinscrito</strong> no novo App
                  (<code className="rounded bg-muted px-1">POST /{q.data.channel.waba_id ?? "{waba_id}"}/subscribed_apps</code>).
                  Sem isso, a Meta para de enviar mensagens recebidas, mesmo com o webhook configurado.
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => listSubs.mutate()} disabled={listSubs.isPending}>
                    {listSubs.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    Verificar inscrição
                  </Button>
                  <Button size="sm" onClick={() => subscribe.mutate()} disabled={subscribe.isPending}>
                    {subscribe.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                    Reinscrever este WABA
                  </Button>
                </div>
                {subApps !== null && (
                  <div className="rounded-md border bg-muted/40 p-2 text-xs">
                    {subApps.length === 0 ? (
                      <span className="text-destructive">
                        Nenhum App está inscrito neste WABA. Clique em <strong>Reinscrever</strong>.
                      </span>
                    ) : (
                      <ul className="space-y-1">
                        {subApps.map((a, i) => (
                          <li key={i} className="font-mono">
                            <strong>{a.whatsapp_business_api_data?.name ?? "(sem nome)"}</strong>
                            {" — id "}
                            {a.whatsapp_business_api_data?.id ?? "?"}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </section>






            {/* Token */}
            <section>
              <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <KeyRound className="h-4 w-4" /> Token Meta
              </h4>
              <div className="grid gap-2 rounded-lg border p-4">
                {q.data.channel.token_last_error && (
                  <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{q.data.channel.token_last_error}</div>
                )}


                <div className="text-xs text-muted-foreground">
                  Permissões esperadas no System User Token: <Badge variant="outline" className="font-mono text-[10px]">whatsapp_business_messaging</Badge> <Badge variant="outline" className="font-mono text-[10px]">whatsapp_business_management</Badge>
                </div>
                <Button size="sm" variant="outline" onClick={() => revalidate.mutate()} disabled={revalidate.isPending} className="w-fit">
                  {revalidate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Revalidar agora
                </Button>
              </div>
            </section>

            {/* Registro do número */}
            <section>
              <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="h-4 w-4" /> Registro do número (Cloud API)
              </h4>
              <div className="grid gap-2 rounded-lg border p-4">
                <div className="text-xs text-muted-foreground">
                  {q.data.channel.registered_at
                    ? <>Último registro: <strong>{rel(q.data.channel.registered_at)}</strong></>
                    : "Número ainda não registrado nesta conexão."}
                </div>
                {q.data.channel.registration_last_error && (
                  <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                    Último erro: {q.data.channel.registration_last_error}
                  </div>
                )}
                <div className="rounded-md bg-muted p-3 text-xs leading-relaxed text-muted-foreground">
                  Re-registre o número após alterar o <em>display name</em> na Meta, ao migrar/recuperar o número ou ao trocar de App. Será necessário informar o PIN de 6 dígitos da verificação em duas etapas.
                </div>
                <Button size="sm" variant="outline" onClick={() => setRegisterOpen(true)} className="w-fit">
                  <ShieldCheck className="h-3.5 w-3.5" /> Registrar número
                </Button>
              </div>
            </section>

            {/* Templates Meta */}
            <section>
              <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <FileText className="h-4 w-4" /> Templates Meta
              </h4>
              <div className="grid gap-2 rounded-lg border p-4">
                <div className="text-xs text-muted-foreground">
                  Última sincronização: {rel(q.data.channel.templates_last_sync_at)}
                </div>
                {q.data.channel.templates_last_error && (
                  <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                    Último erro: {q.data.channel.templates_last_error}
                  </div>
                )}
                <Button size="sm" variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending} className="w-fit">
                  {sync.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Sincronizar agora
                </Button>
              </div>
            </section>

            {/* Agentes */}
            <section>
              <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <Users className="h-4 w-4" /> Agentes
              </h4>
              <div className="rounded-lg border p-4 text-sm">
                {q.data.counts.agents === 0 ? (
                  <span className="text-warning">Sem agentes — mensagens entrantes ficam sem responsável. Atribua em <strong>Usuários</strong>.</span>
                ) : (
                  <span>{q.data.counts.agents} agente(s) atribuído(s) a este canal.</span>
                )}
              </div>
            </section>
          </div>
        )}
      </DialogContent>
      <RegisterChannelDialog
        channelId={channelId}
        channelName={q.data?.channel.name}
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
      />
    </Dialog>
  );
}
