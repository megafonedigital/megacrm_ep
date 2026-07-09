import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScrollText, Loader2, Webhook, Code2, ChevronLeft, ChevronRight, MessageCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ContactFilterCombobox, type ContactSearchResult } from "@/components/contacts/ContactFilterCombobox";
import { useServerFn } from "@tanstack/react-start";
import { searchContactsForLogs, getContactForLogs } from "@/lib/api-logs-contacts.functions";
import { listApiLogs } from "@/lib/api-logs.functions";


export const Route = createFileRoute("/admin/api-logs")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  component: ApiLogsPage,
});

function statusVariant(code: number): "default" | "secondary" | "destructive" {
  if (code >= 500) return "destructive";
  if (code >= 400) return "secondary";
  return "default";
}

function classifyPath(path: string, apiKeyPrefix?: string | null): { kind: "webhook" | "rest" | "whatsapp" | "whatsapp-in" | "other"; platform?: string } {
  const wm = path.match(/^\/api\/public\/webhooks\/([^/]+)/);
  if (wm) return { kind: "webhook", platform: wm[1] };
  if (path.startsWith("/api/public/v1/")) return { kind: "rest" };
  if (path.startsWith("/whatsapp/webhook/meta")) return { kind: "whatsapp-in", platform: "meta" };
  if (path.startsWith("/whatsapp/send/")) return { kind: "whatsapp", platform: path.split("/").pop() };
  if (apiKeyPrefix === "meta-webhook") return { kind: "whatsapp-in", platform: "meta" };
  return { kind: "other" };
}

function platformBadgeClass(platform?: string) {
  switch (platform) {
    case "shopify":        return "bg-green-600  hover:bg-green-600  text-white";
    case "hotmart":        return "bg-orange-600 hover:bg-orange-600 text-white";
    case "sendflow":       return "bg-zinc-900   hover:bg-zinc-900   text-white";
    case "activecampaign": return "bg-blue-600   hover:bg-blue-600   text-white";
    default:               return "bg-primary    hover:bg-primary    text-primary-foreground";
  }
}

function ApiLogsPage() {
  const { me } = useMe();
  const searchFn = useServerFn(searchContactsForLogs);
  const fetchSelectedFn = useServerFn(getContactForLogs);
  const listLogsFn = useServerFn(listApiLogs);
  const [brandId, setBrandId] = useState<string>("all");

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [methodFilter, setMethodFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any | null>(null);
  const [pageSize, setPageSize] = useState<number>(25);
  const [page, setPage] = useState<number>(1);
  const [contactId, setContactId] = useState<string | null>(null);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [brandId, statusFilter, methodFilter, typeFilter, platformFilter, search, pageSize, contactId]);

  const brandsQ = useQuery({
    queryKey: ["brands-logs"],
    queryFn: async () => (await supabase.from("brands").select("id, name").order("name")).data ?? [],
  });

  const logsQ = useQuery({
    queryKey: ["api-logs", brandId, statusFilter, methodFilter, search, typeFilter, platformFilter, page, pageSize, contactId],
    queryFn: async () => {
      return listLogsFn({
        data: { brandId, statusFilter, methodFilter, search, typeFilter, platformFilter, page, pageSize, contactId },
      });
    },
    refetchInterval: 10_000,
  });

  const rows = logsQ.data?.rows ?? [];
  const total = logsQ.data?.total ?? null;
  const hasMore = logsQ.data?.hasMore ?? false;
  const totalPages = total != null
    ? Math.max(1, Math.ceil(total / pageSize))
    : page + (hasMore ? 1 : 0);

  if (!me?.isAdmin && !me?.isSupervisor && !me?.isDeveloper) {
    return <div className="p-6 text-sm text-muted-foreground">Acesso restrito.</div>;
  }

  return (
    <div className="page-container space-y-4">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <ScrollText className="h-6 w-6" /> Logs da API
        </h1>
        <p className="text-sm text-muted-foreground">Chamadas HTTP recebidas/enviadas, incluindo webhooks processados, duplicados, ignorados ou sem automação correspondente.</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        <Input placeholder="Buscar por rota..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            <SelectItem value="webhook">Webhooks (integrações)</SelectItem>
            <SelectItem value="rest">API REST</SelectItem>
            <SelectItem value="whatsapp_in">WhatsApp (entrada)</SelectItem>
            <SelectItem value="whatsapp_out">WhatsApp (saída)</SelectItem>
          </SelectContent>
        </Select>
        <Select value={platformFilter} onValueChange={setPlatformFilter}>
          <SelectTrigger className="w-[170px]"><SelectValue placeholder="Plataforma" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as plataformas</SelectItem>
            <SelectItem value="activecampaign">ActiveCampaign</SelectItem>
            <SelectItem value="hotmart">Hotmart</SelectItem>
            <SelectItem value="sendflow">Sendflow</SelectItem>
            <SelectItem value="shopify">Shopify</SelectItem>
          </SelectContent>
        </Select>
        <Select value={brandId} onValueChange={setBrandId}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Workspace" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as Workspaces</SelectItem>
            {brandsQ.data?.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={methodFilter} onValueChange={setMethodFilter}>
          <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Métodos</SelectItem>
            <SelectItem value="GET">GET</SelectItem>
            <SelectItem value="POST">POST</SelectItem>
            <SelectItem value="DELETE">DELETE</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Status</SelectItem>
            <SelectItem value="2xx">2xx</SelectItem>
            <SelectItem value="4xx">4xx</SelectItem>
            <SelectItem value="5xx">5xx</SelectItem>
          </SelectContent>
        </Select>
        <ContactFilterCombobox
          value={contactId}
          onChange={setContactId}
          brandId={brandId !== "all" ? brandId : null}
          searchFn={async (s) => {
            const rows = await searchFn({ data: { search: s, brandId: brandId !== "all" ? brandId : null } });
            return rows.map((r: any): ContactSearchResult => ({
              id: r.id,
              name: r.name,

              profile_name: r.profile_name,
              phone: r.phone,
              wa_id: r.wa_id,
              subLabel: r.brand_name ?? undefined,
            }));
          }}
          fetchSelectedFn={async (id) => {
            const r = await fetchSelectedFn({ data: { id } });
            if (!r) return null;
            return {
              id: r.id,
              name: r.name,
              profile_name: r.profile_name,
              phone: r.phone,
              wa_id: r.wa_id,
              subLabel: r.brand_name ?? undefined,
            };
          }}
        />

      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Quando</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Método</TableHead>
              <TableHead>Rota</TableHead>
              <TableHead>Evento / Resposta</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Workspace</TableHead>
              <TableHead className="text-right">Duração</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logsQ.isLoading && <TableRow><TableCell colSpan={8} className="text-center py-6"><Loader2 className="h-4 w-4 animate-spin inline" /></TableCell></TableRow>}
            {logsQ.error && <TableRow><TableCell colSpan={8} className="text-center py-6 text-sm text-destructive">Erro ao carregar: {(logsQ.error as Error).message || "Não foi possível carregar os logs."}</TableCell></TableRow>}
            {!logsQ.isLoading && !logsQ.error && rows.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-10 text-sm text-muted-foreground">Nenhum log ainda.</TableCell></TableRow>}
            {rows.map((l: any) => {
              const cls = classifyPath(l.path, l.api_key_prefix);
              const summary = l.response_summary as any;
              const reqBody = l.request_body as any;
              const isWaOut = cls.kind === "whatsapp";
              const isWaIn = cls.kind === "whatsapp-in";
              let eventLabel: string | null = null;
              if (isWaOut) eventLabel = reqBody?.template_name || reqBody?.type || cls.platform || null;
              else if (isWaIn) {
                const parts: string[] = [];
                if (summary?.messages_received) parts.push(`${summary.messages_received} mensagem(ns)`);
                if (summary?.statuses_received) parts.push(`${summary.statuses_received} status`);
                if (summary?.verified != null) parts.push(summary.verified ? "verify ok" : "verify fail");
                eventLabel = parts.length ? parts.join(" · ") : (summary?.event_type ?? null);
              } else {
                eventLabel = summary?.event_type ?? summary?.ignored ?? summary?.error ?? null;
              }
              const startedCount = summary?.started ?? summary?.automations_started ?? null;
              const waError = isWaOut && summary?.error_code ? `${summary.error_code}${summary.error_message ? ": " + summary.error_message : ""}` : null;
              return (
                <TableRow key={l.id} className="cursor-pointer" onClick={() => setSelected(l)}>
                  <TableCell className="text-xs whitespace-nowrap">{new Date(l.created_at).toLocaleString("pt-BR")}</TableCell>
                  <TableCell>
                    {cls.kind === "webhook" ? (
                      <Badge className={`text-[10px] gap-1 ${platformBadgeClass(cls.platform)}`}><Webhook className="h-3 w-3" />{cls.platform}</Badge>
                    ) : cls.kind === "rest" ? (
                      <Badge variant="secondary" className="text-[10px] gap-1"><Code2 className="h-3 w-3" />API REST</Badge>
                    ) : cls.kind === "whatsapp" ? (
                      <Badge variant="default" className="text-[10px] gap-1 bg-emerald-600 hover:bg-emerald-600"><MessageCircle className="h-3 w-3" />WhatsApp →</Badge>
                    ) : cls.kind === "whatsapp-in" ? (
                      <Badge variant="default" className="text-[10px] gap-1 bg-emerald-700 hover:bg-emerald-700"><MessageCircle className="h-3 w-3" />WhatsApp ←</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">outro</Badge>
                    )}
                  </TableCell>
                  <TableCell><Badge variant="outline">{l.method}</Badge></TableCell>
                  <TableCell className="font-mono text-xs max-w-[280px] truncate">
                    {isWaOut ? (l.api_key_prefix ?? "—") : l.path}
                  </TableCell>
                  <TableCell className="text-xs">
                    {eventLabel && <span className="font-mono">{eventLabel}</span>}
                    {startedCount != null && startedCount > 0 && (
                      <Badge variant="default" className="ml-2 text-[10px]">{startedCount} auto.</Badge>
                    )}
                    {waError && <span className="ml-2 text-destructive">{waError}</span>}
                  </TableCell>
                  <TableCell><Badge variant={statusVariant(l.status_code)}>{l.status_code}</Badge></TableCell>
                  <TableCell className="text-xs">{l.brands?.name ?? "—"}</TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">{l.duration_ms ?? 0}ms</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Linhas por página:</span>
          <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
            <SelectTrigger className="h-8 w-[80px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="25">25</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
              <SelectItem value="200">200</SelectItem>
            </SelectContent>
          </Select>
          <span>{total != null ? (total > 0 ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} de ${total}` : "0 resultados") : (rows.length > 0 ? `${(page - 1) * pageSize + 1}–${(page - 1) * pageSize + rows.length}` : "—")}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1 || logsQ.isLoading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            <ChevronLeft className="h-4 w-4" /> Anterior
          </Button>
          <span className="text-xs text-muted-foreground">Página {page} de {totalPages}</span>
          <Button variant="outline" size="sm" disabled={(total != null ? page >= totalPages : !hasMore) || logsQ.isLoading} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
            Próxima <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-[640px] sm:max-w-[640px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Detalhe da chamada</SheetTitle>
          </SheetHeader>
          {selected && (
            <div className="space-y-4 mt-4 text-sm">
              <Field label="Quando" value={new Date(selected.created_at).toLocaleString("pt-BR")} />
              <Field label="Método / Rota" value={`${selected.method} ${selected.path}`} mono />
              <Field label="Status" value={String(selected.status_code)} />
              <Field label="Duração" value={`${selected.duration_ms ?? 0}ms`} />
              <Field label="IP" value={selected.ip ?? "—"} mono />
              <Field label="API Key" value={selected.api_key_prefix ?? "—"} mono />
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">Request body</div>
                <pre className="bg-muted p-2 rounded text-xs overflow-auto max-h-60">{JSON.stringify(selected.request_body, null, 2)}</pre>
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">Response</div>
                <pre className="bg-muted p-2 rounded text-xs overflow-auto max-h-60">{JSON.stringify(selected.response_summary, null, 2)}</pre>
              </div>
              <Button variant="outline" onClick={() => setSelected(null)}>Fechar</Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={mono ? "font-mono text-xs" : "text-sm"}>{value}</div>
    </div>
  );
}
