import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Pencil, Trash2, Loader2, Library, ChevronDown, Upload, Check, ChevronsUpDown, Search } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useActiveBrand } from "@/lib/active-brand";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  listKnowledgeBases,
  upsertKnowledgeCompany, deleteKnowledgeCompany,
  upsertKnowledgeContext, deleteKnowledgeContext,
  upsertKnowledgeProduct, deleteKnowledgeProduct,
  listIntegrationProducts,
} from "@/lib/ai-agents.functions";
import { buildTrackedLink, detectPlatform, type UtmParams } from "@/lib/tracking-link";

export const Route = createFileRoute("/admin/bases-conhecimento")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  component: BasesConhecimentoPage,
});

type KbKind = "company" | "context" | "product";

type KbItem = {
  id: string;
  name?: string;
  title?: string;
  product_name?: string;
  content?: string;
  source?: "hotmart" | "shopify" | "manual";
  summary?: string | null;
  description?: string | null;
  utm_default?: string | null;
  utm_params?: { source?: string | null; medium?: string | null; campaign?: string | null; content?: string | null; term?: string | null; site?: string | null } | null;
  faq?: Array<{ q: string; a: string }> | null;
  notes?: string | null;
  starts_at?: string;
  ends_at?: string;
  external_product_id?: string | null;
  integration_product_id?: string | null;
  company_name?: string | null;
  expert_name?: string | null;
  updated_at?: string;
};

function BasesConhecimentoPage() {
  const { activeBrandId } = useActiveBrand();
  const brandId = activeBrandId;
  const qc = useQueryClient();

  const listFn = useServerFn(listKnowledgeBases);
  const { data, isLoading } = useQuery({
    queryKey: ["ai-kb", brandId],
    queryFn: () => listFn({ data: { brandId: brandId! } }),
    enabled: !!brandId,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["ai-kb", brandId] });

  const [tab, setTab] = useState<KbKind>("company");
  const [editing, setEditing] = useState<{ kind: KbKind; value: KbItem | null } | null>(null);

  if (!brandId) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Selecione um workspace para visualizar as bases.
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <Library className="h-5 w-5" />
        <h1 className="text-xl font-semibold flex-1">Bases de Conhecimento</h1>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-1" /> Nova base de conhecimento
              <ChevronDown className="h-4 w-4 ml-1" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => { setTab("company"); setEditing({ kind: "company", value: null }); }}>
              Empresa / Expert
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => { setTab("context"); setEditing({ kind: "context", value: null }); }}>
              Contexto temporal
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => { setTab("product"); setEditing({ kind: "product", value: null }); }}>
              Produto
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <p className="text-sm text-muted-foreground">
        Bases são compartilhadas entre todos os agentes deste workspace. Crie aqui e vincule no editor do agente.
      </p>

      <Tabs value={tab} onValueChange={(v) => setTab(v as KbKind)}>
        <TabsList>
          <TabsTrigger value="company">Empresa</TabsTrigger>
          <TabsTrigger value="context">Contexto</TabsTrigger>
          <TabsTrigger value="product">Produto</TabsTrigger>
        </TabsList>

        <TabsContent value="company" className="mt-4">
          <KbList
            kind="company"
            items={(data?.company ?? []) as KbItem[]}
            isLoading={isLoading}
            onEdit={(v) => setEditing({ kind: "company", value: v })}
          />
        </TabsContent>
        <TabsContent value="context" className="mt-4">
          <KbList
            kind="context"
            items={(data?.context ?? []) as KbItem[]}
            isLoading={isLoading}
            onEdit={(v) => setEditing({ kind: "context", value: v })}
          />
        </TabsContent>
        <TabsContent value="product" className="mt-4">
          <KbList
            kind="product"
            items={(data?.product ?? []) as unknown as KbItem[]}
            isLoading={isLoading}
            onEdit={(v) => setEditing({ kind: "product", value: v })}
          />
        </TabsContent>
      </Tabs>

      {editing && (
        <KbEditorDialog
          kind={editing.kind}
          brandId={brandId}
          value={editing.value}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      )}
    </div>
  );
}

function KbList({ kind, items, isLoading, onEdit }: {
  kind: KbKind; items: KbItem[]; isLoading: boolean;
  onEdit: (v: KbItem) => void;
}) {
  if (isLoading) {
    return <div className="flex justify-center p-10"><Loader2 className="animate-spin" /></div>;
  }
  if (items.length === 0) {
    return (
      <Card className="p-10 text-center text-sm text-muted-foreground">
        Nenhuma base cadastrada. Use o botão "Nova base de conhecimento" acima.
      </Card>
    );
  }
  return (
    <div className="space-y-2">
      {items.map((item) => {
        const label =
          kind === "company" ? (item.name ?? "(sem nome)")
          : kind === "context" ? (item.title ?? "(sem título)")
          : (item.product_name ?? "(sem nome)");
        const sub =
          kind === "product"
            ? [item.source, item.summary, item.utm_default && `UTM ${item.utm_default}`]
                .filter(Boolean).join(" • ")
            : kind === "context" && item.starts_at && item.ends_at
              ? `${new Date(item.starts_at).toLocaleDateString()} → ${new Date(item.ends_at).toLocaleDateString()}`
              : item.updated_at ? `Atualizado em ${new Date(item.updated_at).toLocaleDateString()}` : "";
        return (
          <Card key={item.id} className="p-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{label}</div>
              {sub && <div className="text-xs text-muted-foreground truncate">{sub}</div>}
            </div>
            <Button size="icon" variant="ghost" onClick={() => onEdit(item)}>
              <Pencil className="h-4 w-4" />
            </Button>
          </Card>
        );
      })}
    </div>
  );
}

// ============= Editor dialog =============
function KbEditorDialog({
  kind, brandId, value, onClose, onSaved,
}: {
  kind: KbKind;
  brandId: string;
  value: KbItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const upsertCompanyFn = useServerFn(upsertKnowledgeCompany);
  const deleteCompanyFn = useServerFn(deleteKnowledgeCompany);
  const upsertContextFn = useServerFn(upsertKnowledgeContext);
  const deleteContextFn = useServerFn(deleteKnowledgeContext);
  const upsertProductFn = useServerFn(upsertKnowledgeProduct);
  const deleteProductFn = useServerFn(deleteKnowledgeProduct);

  const onDelete = async () => {
    if (!value?.id) return;
    if (!confirm("Excluir esta base? Será removida de todos os agentes que a usam.")) return;
    try {
      if (kind === "company") await deleteCompanyFn({ data: { id: value.id } });
      else if (kind === "context") await deleteContextFn({ data: { id: value.id } });
      else await deleteProductFn({ data: { id: value.id } });
      toast.success("Removido");
      onSaved();
    } catch (e) { toast.error((e as Error)?.message ?? "Erro"); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {value?.id ? "Editar base" : "Nova base"} —{" "}
            {kind === "company" ? "Empresa" : kind === "context" ? "Contexto" : "Produto"}
          </DialogTitle>
        </DialogHeader>

        {kind === "company" && (
          <CompanyForm
            brandId={brandId} value={value} onClose={onClose} onDelete={value?.id ? onDelete : undefined}
            onSubmit={async (p) => { await upsertCompanyFn({ data: p }); toast.success("Salvo"); onSaved(); }}
          />
        )}
        {kind === "context" && (
          <ContextForm
            brandId={brandId} value={value} onClose={onClose} onDelete={value?.id ? onDelete : undefined}
            onSubmit={async (p) => { await upsertContextFn({ data: p }); toast.success("Salvo"); onSaved(); }}
          />
        )}
        {kind === "product" && (
          <ProductForm
            brandId={brandId} value={value} onClose={onClose} onDelete={value?.id ? onDelete : undefined}
            onSubmit={async (p) => { await upsertProductFn({ data: p }); toast.success("Salvo"); onSaved(); }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function FormFooter({ onClose, onDelete, onSubmit, saving, canSave }: {
  onClose: () => void; onDelete?: () => void; onSubmit: () => void; saving: boolean; canSave: boolean;
}) {
  return (
    <DialogFooter className="flex justify-between sm:justify-between">
      <div>
        {onDelete && (
          <Button variant="ghost" onClick={onDelete} className="text-destructive">
            <Trash2 className="h-4 w-4 mr-1" /> Excluir
          </Button>
        )}
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button onClick={onSubmit} disabled={saving || !canSave}>
          {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Salvar
        </Button>
      </div>
    </DialogFooter>
  );
}

function CompanyForm({ brandId, value, onSubmit, onDelete, onClose }: {
  brandId: string; value: KbItem | null;
  onSubmit: (p: { id?: string; brandId: string; name: string; content: string; faq: Array<{ q: string; a: string }>; company_name: string | null; expert_name: string | null }) => Promise<void>;
  onDelete?: () => void; onClose: () => void;
}) {
  const [name, setName] = useState(value?.name ?? "");
  const [content, setContent] = useState(value?.content ?? "");
  const [faq, setFaq] = useState<Array<{ q: string; a: string }>>(value?.faq ?? []);
  const [companyName, setCompanyName] = useState(value?.company_name ?? "");
  const [expertName, setExpertName] = useState(value?.expert_name ?? "");
  const [saving, setSaving] = useState(false);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Nome da empresa</Label>
          <Input
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Ex.: Acme Ltda."
          />
        </div>
        <div className="space-y-1">
          <Label>Nome do expert</Label>
          <Input
            value={expertName}
            onChange={(e) => setExpertName(e.target.value)}
            placeholder="Ex.: Dr. João Silva"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Disponíveis nos agentes que usam esta base como <code className="text-[11px]">{`{{company.name}}`}</code> e <code className="text-[11px]">{`{{expert.name}}`}</code>.
      </p>
      <Separator />
      <div className="space-y-1">
        <Label>Nome do documento</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Sobre a empresa" />
      </div>
      <div className="space-y-1">
        <Label>Conteúdo</Label>
        <Textarea rows={12} value={content} onChange={(e) => setContent(e.target.value)} />
      </div>
      <Separator />
      <FaqSection faq={faq} setFaq={setFaq} />
      <FormFooter
        onClose={onClose} onDelete={onDelete} saving={saving}
        canSave={name.trim().length > 0}
        onSubmit={async () => {
          setSaving(true);
          try {
            await onSubmit({
              id: value?.id,
              brandId,
              name: name.trim(),
              content,
              faq,
              company_name: companyName.trim() || null,
              expert_name: expertName.trim() || null,
            });
          }
          catch (e) { toast.error((e as Error)?.message ?? "Erro"); }
          finally { setSaving(false); }
        }}
      />
    </div>
  );
}

function ContextForm({ brandId, value, onSubmit, onDelete, onClose }: {
  brandId: string; value: KbItem | null;
  onSubmit: (p: {
    id?: string; brandId: string; title: string; content: string;
    starts_at: string; ends_at: string;
  }) => Promise<void>;
  onDelete?: () => void; onClose: () => void;
}) {
  const initStart = value?.starts_at ? value.starts_at.slice(0, 16) : new Date().toISOString().slice(0, 16);
  const initEnd = value?.ends_at ? value.ends_at.slice(0, 16) : new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16);
  const [title, setTitle] = useState(value?.title ?? "");
  const [content, setContent] = useState(value?.content ?? "");
  const [startsAt, setStartsAt] = useState(initStart);
  const [endsAt, setEndsAt] = useState(initEnd);
  const [saving, setSaving] = useState(false);
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>Título</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Início</Label>
          <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Fim</Label>
          <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1">
        <Label>Conteúdo</Label>
        <Textarea rows={8} value={content} onChange={(e) => setContent(e.target.value)} />
      </div>
      <FormFooter
        onClose={onClose} onDelete={onDelete} saving={saving}
        canSave={title.trim().length > 0}
        onSubmit={async () => {
          setSaving(true);
          try {
            await onSubmit({
              id: value?.id, brandId, title: title.trim(), content,
              starts_at: new Date(startsAt).toISOString(),
              ends_at: new Date(endsAt).toISOString(),
            });
          } catch (e) { toast.error((e as Error)?.message ?? "Erro"); }
          finally { setSaving(false); }
        }}
      />
    </div>
  );
}

function ProductForm({ brandId, value, onSubmit, onDelete, onClose }: {
  brandId: string; value: KbItem | null;
  onSubmit: (p: {
    id?: string; brandId: string; source: "hotmart" | "shopify" | "manual";
    integration_product_id?: string | null;
    external_product_id?: string | null;
    product_name: string; summary?: string; description?: string;
    utm_default?: string | null;
    utm_params?: { source?: string | null; medium?: string | null; campaign?: string | null; content?: string | null; term?: string | null; site?: string | null } | null;
    notes?: string | null; faq?: Array<{ q: string; a: string }>;
  }) => Promise<void>;
  onDelete?: () => void; onClose: () => void;
}) {
  const [source, setSource] = useState<"hotmart" | "shopify" | "manual">(
    (value?.source as "hotmart" | "shopify" | "manual") ?? "manual",
  );
  const [integrationId, setIntegrationId] = useState<string | null>(value?.integration_product_id ?? null);
  const [productName, setProductName] = useState(value?.product_name ?? "");
  const [externalId, setExternalId] = useState(value?.external_product_id ?? "");
  const [summary, setSummary] = useState(value?.summary ?? "");
  const [description, setDescription] = useState(value?.description ?? "");
  const initialUtm = value?.utm_params ?? {};
  const [utmSource, setUtmSource] = useState(initialUtm.source ?? "");
  const [utmMedium, setUtmMedium] = useState(initialUtm.medium ?? "");
  const [utmCampaign, setUtmCampaign] = useState(initialUtm.campaign ?? value?.utm_default ?? "");
  const [utmContent, setUtmContent] = useState(initialUtm.content ?? "");
  const [utmTerm, setUtmTerm] = useState(initialUtm.term ?? "");
  const [utmSite, setUtmSite] = useState(initialUtm.site ?? "");
  const [notes, setNotes] = useState(value?.notes ?? "");
  const [faq, setFaq] = useState<Array<{ q: string; a: string }>>(
    Array.isArray(value?.faq) ? value!.faq! : [],
  );
  const [saving, setSaving] = useState(false);

  const listProductsFn = useServerFn(listIntegrationProducts);
  const { data: catalog } = useQuery({
    queryKey: ["integration-products", brandId, source],
    queryFn: () => listProductsFn({
      data: { brandId, source: source === "manual" ? undefined : source },
    }),
    enabled: source !== "manual",
  });

  const onPickIntegration = (val: string) => {
    setIntegrationId(val);
    const p = catalog?.products?.find((x) => x.id === val);
    if (p) {
      setProductName(p.name);
      setExternalId(p.external_id ?? "");
    }
  };

  const canSave = useMemo(() => productName.trim().length > 0, [productName]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Origem</Label>
          <SourceCombobox
            value={source}
            onChange={(s) => { setSource(s); setIntegrationId(null); }}
          />
        </div>
        {source !== "manual" && (
          <div className="space-y-1">
            <Label>Produto sincronizado</Label>
            <ProductCombobox
              value={integrationId}
              onChange={onPickIntegration}
              products={catalog?.products ?? []}
              loading={!catalog}
            />
          </div>
        )}
        <div className="space-y-1 col-span-2">
          <Label>Nome do produto</Label>
          <Input value={productName} onChange={(e) => setProductName(e.target.value)}
            disabled={source !== "manual" && !!integrationId} />
        </div>
        <div className="space-y-1 col-span-2">
          <Label>Resumo (chamada curta)</Label>
          <Input value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={500}
            placeholder="Frase curta que descreve o produto" />
        </div>
        <div className="space-y-1 col-span-2">
          <Label>Descrição completa</Label>
          <Textarea rows={10} value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="Tudo o que a IA precisa saber: benefícios, conteúdo, preço, garantia, público, objeções etc." />
          <p className="text-xs text-muted-foreground">Este texto alimenta a IA quando o assunto for este produto.</p>
        </div>
        <div className="col-span-2 space-y-2 rounded-md border p-3">
          <div className="text-sm font-medium">Rastreio / UTMs</div>
          <p className="text-xs text-muted-foreground">
            Para Hotmart só <code>utm_campaign</code> é usado (vai para o campo <code>sck</code>). Para Shopify/site próprio, todos os campos valem.
            A tag do agente é concatenada em <code>utm_content</code> automaticamente (em <code>sck</code> para Hotmart).
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1"><Label className="text-xs">utm_source</Label>
              <Input value={utmSource} onChange={(e) => setUtmSource(e.target.value)} placeholder="ex: whatsapp" /></div>
            <div className="space-y-1"><Label className="text-xs">utm_medium</Label>
              <Input value={utmMedium} onChange={(e) => setUtmMedium(e.target.value)} placeholder="ex: crm" /></div>
            <div className="space-y-1"><Label className="text-xs">utm_campaign</Label>
              <Input value={utmCampaign} onChange={(e) => setUtmCampaign(e.target.value)} placeholder="ex: rec-" /></div>
            <div className="space-y-1"><Label className="text-xs">utm_content</Label>
              <Input value={utmContent} onChange={(e) => setUtmContent(e.target.value)} placeholder="ex: lp-produto (tag do agente é anexada)" /></div>
            <div className="space-y-1"><Label className="text-xs">utm_term</Label>
              <Input value={utmTerm} onChange={(e) => setUtmTerm(e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">utm_site</Label>
              <Input value={utmSite} onChange={(e) => setUtmSite(e.target.value)} /></div>
          </div>
          <UtmPreview
            params={{ source: utmSource, medium: utmMedium, campaign: utmCampaign, content: utmContent, term: utmTerm, site: utmSite }}
          />
        </div>
        {source !== "manual" && (
          <div className="space-y-1">
            <Label>ID externo</Label>
            <Input value={externalId ?? ""} onChange={(e) => setExternalId(e.target.value)} disabled={!!integrationId} />
          </div>
        )}
        <div className="space-y-1 col-span-2">
          <Label>Notas internas</Label>
          <Textarea rows={3} value={notes ?? ""} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      <Separator />
      <FaqSection faq={faq} setFaq={setFaq} />

      <FormFooter
        onClose={onClose} onDelete={onDelete} saving={saving} canSave={canSave}
        onSubmit={async () => {
          setSaving(true);
          try {
            await onSubmit({
              id: value?.id, brandId, source,
              integration_product_id: source === "manual" ? null : integrationId,
              external_product_id: externalId || null,
              product_name: productName.trim(),
              summary: summary.trim(),
              description,
              utm_default: utmCampaign || null,
              utm_params: {
                source: utmSource || null,
                medium: utmMedium || null,
                campaign: utmCampaign || null,
                content: utmContent || null,
                term: utmTerm || null,
                site: utmSite || null,
              },
              notes: notes || null,
              faq,
            });
          } catch (e) { toast.error((e as Error)?.message ?? "Erro"); }
          finally { setSaving(false); }
        }}
      />
    </div>
  );
}

function FaqSection({
  faq, setFaq,
}: {
  faq: Array<{ q: string; a: string }>;
  setFaq: (v: Array<{ q: string; a: string }>) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    try {
      const isCsv = /\.csv$/i.test(file.name) || file.type === "text/csv";
      let wb: XLSX.WorkBook;
      if (isCsv) {
        // Lê CSV como UTF-8 nativo para preservar acentos e emojis.
        let text = await file.text();
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
        wb = XLSX.read(text, { type: "string" });
      } else {
        const buf = await file.arrayBuffer();
        wb = XLSX.read(buf, { type: "array" });
      }
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) throw new Error("Planilha vazia");
      const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "", blankrows: false });
      if (rows.length === 0) throw new Error("Nenhuma linha encontrada");

      // Detect header row
      const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
      const qKeys = new Set(["pergunta", "perguntas", "q", "question"]);
      const aKeys = new Set(["resposta", "respostas", "a", "answer"]);
      const first = rows[0].map(norm);
      let qIdx = first.findIndex((c) => qKeys.has(c));
      let aIdx = first.findIndex((c) => aKeys.has(c));
      let dataRows = rows;
      if (qIdx >= 0 || aIdx >= 0) {
        if (qIdx < 0) qIdx = 0;
        if (aIdx < 0) aIdx = 1;
        dataRows = rows.slice(1);
      } else {
        qIdx = 0;
        aIdx = 1;
      }

      const imported: Array<{ q: string; a: string }> = [];
      for (const r of dataRows) {
        const q = String(r[qIdx] ?? "").trim();
        const a = String(r[aIdx] ?? "").trim();
        if (!q && !a) continue;
        imported.push({ q, a });
      }
      if (imported.length === 0) throw new Error("Nenhuma pergunta válida encontrada");
      setFaq([...faq, ...imported]);
      toast.success(`${imported.length} pergunta(s) importada(s)`);
    } catch (e) {
      toast.error((e as Error)?.message ?? "Falha ao ler a planilha");
    }
  };

  const downloadTemplate = () => {
    const csv = "\uFEFFpergunta,resposta\nQual o prazo de entrega?,Em até 7 dias úteis.\nTem garantia?,\"Sim, 7 dias de garantia incondicional.\"\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "modelo-faq.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Label>FAQ (opcional)</Label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={downloadTemplate}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Baixar modelo
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4 mr-1" /> Importar planilha
          </Button>
          <Button size="sm" variant="outline" onClick={() => setFaq([...faq, { q: "", a: "" }])}>
            <Plus className="h-4 w-4 mr-1" /> Adicionar pergunta
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Aceita CSV ou XLSX com colunas <strong>pergunta</strong> e <strong>resposta</strong>. As linhas são adicionadas ao FAQ atual.
      </p>
      {faq.map((f, idx) => (
        <div key={idx} className="border rounded p-2 space-y-2">
          <Input placeholder="Pergunta" value={f.q}
            onChange={(e) => setFaq(faq.map((x, i) => i === idx ? { ...x, q: e.target.value } : x))} />
          <Textarea placeholder="Resposta" rows={2} value={f.a}
            onChange={(e) => setFaq(faq.map((x, i) => i === idx ? { ...x, a: e.target.value } : x))} />
          <Button size="sm" variant="ghost" onClick={() => setFaq(faq.filter((_, i) => i !== idx))}>
            <Trash2 className="h-4 w-4 mr-1" /> Remover
          </Button>
        </div>
      ))}
    </div>
  );
}

function UtmPreview({ params }: { params: { source: string; medium: string; campaign: string; content: string; term: string; site: string } }) {
  const [link, setLink] = useState("https://exemplo.com.br/produto");
  const [tag, setTag] = useState("priscila");
  const utm: UtmParams = {
    source: params.source || null,
    medium: params.medium || null,
    campaign: params.campaign || null,
    content: params.content || null,
    term: params.term || null,
    site: params.site || null,
  };
  const platform = detectPlatform(link);
  let preview = link;
  try {
    preview = buildTrackedLink({ rawLink: link, utmParams: utm, agentTrackingTag: tag });
  } catch {
    preview = link;
  }
  return (
    <div className="space-y-2 rounded border bg-muted/30 p-2">
      <div className="text-xs font-medium">Preview do link</div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Link de exemplo</Label>
          <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Tag do agente (exemplo)</Label>
          <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="ex: priscila" />
        </div>
      </div>
      <div className="text-xs text-muted-foreground">Plataforma detectada: <code>{platform}</code></div>
      <div className="text-xs break-all rounded bg-background border p-2 font-mono">{preview}</div>
    </div>
  );
}

const SOURCE_OPTIONS: Array<{ value: "hotmart" | "shopify" | "manual"; label: string }> = [
  { value: "hotmart", label: "Hotmart" },
  { value: "shopify", label: "Shopify" },
  { value: "manual", label: "Manual" },
];

function useOutsideClose(open: boolean, ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, ref, onClose]);
}

function SourceCombobox({
  value,
  onChange,
}: {
  value: "hotmart" | "shopify" | "manual";
  onChange: (v: "hotmart" | "shopify" | "manual") => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(open, ref, () => setOpen(false));
  const current = SOURCE_OPTIONS.find((o) => o.value === value);
  const q = query.trim().toLowerCase();
  const filtered = q ? SOURCE_OPTIONS.filter((o) => o.label.toLowerCase().includes(q)) : SOURCE_OPTIONS;
  return (
    <div ref={ref} className="relative">
      <Button
        type="button"
        variant="outline"
        role="combobox"
        className="w-full justify-between font-normal"
        onClick={() => setOpen((o) => !o)}
      >
        {current?.label ?? "Selecione"}
        <ChevronsUpDown className="h-4 w-4 opacity-50 ml-2" />
      </Button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border bg-popover text-popover-foreground shadow-md">
          <div className="flex items-center border-b px-2">
            <Search className="h-4 w-4 opacity-50 shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar origem…"
              className="flex h-9 w-full bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="max-h-72 overflow-auto p-1">
            {filtered.length === 0 ? (
              <div className="px-2 py-4 text-center text-xs text-muted-foreground">Nenhuma origem.</div>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => { onChange(o.value); setOpen(false); setQuery(""); }}
                  className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                >
                  {o.label}
                  <Check className={cn("ml-auto h-4 w-4", value === o.value ? "opacity-100" : "opacity-0")} />
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProductCombobox({
  value,
  onChange,
  products,
  loading,
}: {
  value: string | null;
  onChange: (id: string) => void;
  products: Array<{ id: string; name: string; external_id?: string | null }>;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(open, ref, () => setOpen(false));
  const current = products.find((p) => p.id === value);
  const placeholder = loading ? "Carregando…" : "Selecione…";
  const q = query.trim().toLowerCase();
  const filtered = q
    ? products.filter((p) => `${p.name} ${p.external_id ?? ""}`.toLowerCase().includes(q))
    : products;
  return (
    <div ref={ref} className="relative">
      <Button
        type="button"
        variant="outline"
        role="combobox"
        className="w-full justify-between font-normal"
        onClick={() => setOpen((o) => !o)}
      >
        <span className={cn("truncate", !current && "text-muted-foreground")}>
          {current?.name ?? placeholder}
        </span>
        <ChevronsUpDown className="h-4 w-4 opacity-50 ml-2 shrink-0" />
      </Button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border bg-popover text-popover-foreground shadow-md">
          <div className="flex items-center border-b px-2">
            <Search className="h-4 w-4 opacity-50 shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar produto…"
              className="flex h-9 w-full bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="max-h-72 overflow-auto p-1">
            {products.length === 0 ? (
              <div className="px-2 py-3 text-xs text-muted-foreground">
                {loading ? "Carregando…" : "Nenhum produto sincronizado em \"Integrações\"."}
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-2 py-4 text-center text-xs text-muted-foreground">Nenhum produto encontrado.</div>
            ) : (
              filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { onChange(p.id); setOpen(false); setQuery(""); }}
                  className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                >
                  <div className="flex flex-col min-w-0 flex-1 text-left">
                    <span className="truncate">{p.name}</span>
                    {p.external_id && (
                      <span className="text-xs text-muted-foreground font-mono truncate">{p.external_id}</span>
                    )}
                  </div>
                  <Check className={cn("ml-2 h-4 w-4 shrink-0", value === p.id ? "opacity-100" : "opacity-0")} />
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
