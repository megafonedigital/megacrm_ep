import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2, Copy, Code, ExternalLink } from "lucide-react";
import { toast } from "sonner";

const DAYS: { key: string; label: string }[] = [
  { key: "mon", label: "Seg" },
  { key: "tue", label: "Ter" },
  { key: "wed", label: "Qua" },
  { key: "thu", label: "Qui" },
  { key: "fri", label: "Sex" },
  { key: "sat", label: "Sáb" },
  { key: "sun", label: "Dom" },
];

type BusinessHours = {
  enabled: boolean;
  timezone: string;
  days: Record<string, { open: string; close: string } | null>;
};

type DisplayMode = "popup" | "inline";
type InlineAlign = "left" | "center" | "right";

interface WidgetData {
  id?: string;
  logo_url: string;
  primary_color: string;
  widget_title: string;
  welcome_message: string;
  position: "bottom-right" | "bottom-left";
  launcher_size: "sm" | "md" | "lg";
  offline_message: string;
  custom_css: string;
  business_hours: BusinessHours;
  display_mode: DisplayMode;
  inline_max_width: number | null;
  inline_height: number | null;
  inline_fill_container: boolean;
  inline_align: InlineAlign;
  require_phone: boolean;
  require_name: boolean;
  collect_email: boolean;
  allow_attachments: boolean;
  header_subtitle_online: string;
  header_subtitle_offline: string;
  form_name_label: string;
  form_name_placeholder: string;
  form_phone_label: string;
  form_phone_placeholder: string;
  form_email_label: string;
  form_email_placeholder: string;
  form_submit_label: string;
  chat_input_placeholder: string;
  powered_by_label: string;
}


const defaultHours: BusinessHours = {
  enabled: false,
  timezone: "America/Sao_Paulo",
  days: {
    mon: { open: "09:00", close: "18:00" },
    tue: { open: "09:00", close: "18:00" },
    wed: { open: "09:00", close: "18:00" },
    thu: { open: "09:00", close: "18:00" },
    fri: { open: "09:00", close: "18:00" },
    sat: null,
    sun: null,
  },
};

const empty: WidgetData = {
  logo_url: "",
  primary_color: "#6366f1",
  widget_title: "Chat",
  welcome_message: "Olá! Como podemos ajudar?",
  position: "bottom-right",
  launcher_size: "md",
  offline_message:
    "No momento estamos fora do horário de atendimento. Deixe sua mensagem que retornaremos em breve.",
  custom_css: "",
  business_hours: defaultHours,
  display_mode: "popup",
  inline_max_width: null,
  inline_height: 600,
  inline_fill_container: false,
  inline_align: "center",
  require_phone: true,
  require_name: true,
  collect_email: false,
  allow_attachments: true,
  header_subtitle_online: "",
  header_subtitle_offline: "",
  form_name_label: "",
  form_name_placeholder: "",
  form_phone_label: "",
  form_phone_placeholder: "",
  form_email_label: "",
  form_email_placeholder: "",
  form_submit_label: "",
  chat_input_placeholder: "",
  powered_by_label: "",
};


export function WebchatWidgetSection({
  channelId,
  brandId,
}: {
  channelId: string;
  brandId: string;
}) {
  const [data, setData] = useState<WidgetData>(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: row, error } = await supabase
        .from("webchat_widgets")
        .select("*")
        .eq("channel_id", channelId)
        .maybeSingle();
      if (cancelled) return;
      if (error) toast.error(error.message);
      if (row) {
        const r = row as Record<string, unknown>;
        const bh = (r.business_hours as unknown as BusinessHours) ?? defaultHours;
        setData({
          id: r.id as string,
          logo_url: (r.logo_url as string | null) ?? "",
          primary_color: r.primary_color as string,
          widget_title: r.widget_title as string,
          welcome_message: r.welcome_message as string,
          position: r.position as "bottom-right" | "bottom-left",
          launcher_size: r.launcher_size as "sm" | "md" | "lg",
          offline_message: r.offline_message as string,
          custom_css: (r.custom_css as string | null) ?? "",
          business_hours: bh.enabled !== undefined ? bh : defaultHours,
          display_mode: ((r.display_mode as DisplayMode | null) ?? "popup") as DisplayMode,
          inline_max_width: (r.inline_max_width as number | null) ?? null,
          inline_height: (r.inline_height as number | null) ?? 600,
          inline_fill_container: (r.inline_fill_container as boolean | null) ?? false,
          inline_align: ((r.inline_align as InlineAlign | null) ?? "center") as InlineAlign,
          require_phone: (r.require_phone as boolean | null) ?? true,
          require_name: (r.require_name as boolean | null) ?? true,
          collect_email: (r.collect_email as boolean | null) ?? false,
          allow_attachments: (r.allow_attachments as boolean | null) ?? true,
          header_subtitle_online: (r.header_subtitle_online as string | null) ?? "",
          header_subtitle_offline: (r.header_subtitle_offline as string | null) ?? "",
          form_name_label: (r.form_name_label as string | null) ?? "",
          form_name_placeholder: (r.form_name_placeholder as string | null) ?? "",
          form_phone_label: (r.form_phone_label as string | null) ?? "",
          form_phone_placeholder: (r.form_phone_placeholder as string | null) ?? "",
          form_email_label: (r.form_email_label as string | null) ?? "",
          form_email_placeholder: (r.form_email_placeholder as string | null) ?? "",
          form_submit_label: (r.form_submit_label as string | null) ?? "",
          chat_input_placeholder: (r.chat_input_placeholder as string | null) ?? "",
          powered_by_label: (r.powered_by_label as string | null) ?? "",
        });

      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  const set = <K extends keyof WidgetData>(k: K, v: WidgetData[K]) =>
    setData((d) => ({ ...d, [k]: v }));

  const setDay = (day: string, slot: { open: string; close: string } | null) => {
    setData((d) => ({
      ...d,
      business_hours: { ...d.business_hours, days: { ...d.business_hours.days, [day]: slot } },
    }));
  };

  async function save() {
    setSaving(true);
    const payload = {
      brand_id: brandId,
      channel_id: channelId,
      logo_url: data.logo_url || null,
      primary_color: data.primary_color,
      widget_title: data.widget_title,
      welcome_message: data.welcome_message,
      position: data.position,
      launcher_size: data.launcher_size,
      offline_message: data.offline_message,
      custom_css: data.custom_css || null,
      business_hours: data.business_hours,
      display_mode: data.display_mode,
      inline_max_width: data.inline_max_width,
      inline_height: data.inline_height,
      inline_fill_container: data.inline_fill_container,
      inline_align: data.inline_align,
      require_phone: data.require_phone,
      require_name: data.require_name,
      collect_email: data.collect_email,
      allow_attachments: data.allow_attachments,
      header_subtitle_online: data.header_subtitle_online || null,
      header_subtitle_offline: data.header_subtitle_offline || null,
      form_name_label: data.form_name_label || null,
      form_name_placeholder: data.form_name_placeholder || null,
      form_phone_label: data.form_phone_label || null,
      form_phone_placeholder: data.form_phone_placeholder || null,
      form_email_label: data.form_email_label || null,
      form_email_placeholder: data.form_email_placeholder || null,
      form_submit_label: data.form_submit_label || null,
      chat_input_placeholder: data.chat_input_placeholder || null,
      powered_by_label: data.powered_by_label || null,
    } as never;

    let res;
    if (data.id) {
      res = await supabase.from("webchat_widgets").update(payload).eq("id", data.id).select("id").single();
    } else {
      res = await supabase.from("webchat_widgets").insert(payload).select("id").single();
    }
    setSaving(false);
    if (res.error) {
      toast.error(res.error.message);
      return;
    }
    setData((d) => ({ ...d, id: res.data!.id }));
    toast.success("Widget salvo.");
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const popupSnippet = data.id
    ? `<script src="${origin}/widget.js" data-widget-id="${data.id}" async></script>`
    : "";
  const inlineSnippet = data.id
    ? `<div id="megacrm-webchat"></div>
<script src="${origin}/widget.js" data-widget-id="${data.id}" data-mode="inline" data-target="#megacrm-webchat" async></script>`
    : "";
  const snippet = data.display_mode === "inline" ? inlineSnippet : popupSnippet;

  function copySnippet() {
    if (!snippet) {
      toast.error("Salve o widget primeiro.");
      return;
    }
    void navigator.clipboard.writeText(snippet);
    toast.success("Snippet copiado.");
  }

  if (loading) {
    return (
      <section className="grid gap-3 rounded-lg border border-border p-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </section>
    );
  }

  return (
    <section className="grid gap-4 rounded-lg border border-sky-300/40 bg-sky-50/30 p-4 dark:border-sky-900/40 dark:bg-sky-950/10">
      <div>
        <h4 className="text-sm font-semibold">Configuração do Widget</h4>
        <p className="text-xs text-muted-foreground">
          Aparência, mensagens e horário de atendimento. As conversas iniciadas no widget caem direto
          no Inbox e respeitam o round-robin do canal.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label>Título</Label>
          <Input value={data.widget_title} onChange={(e) => set("widget_title", e.target.value)} maxLength={40} />
        </div>
        <div>
          <Label>Cor primária</Label>
          <div className="flex gap-2">
            <Input
              type="color"
              value={data.primary_color}
              onChange={(e) => set("primary_color", e.target.value)}
              className="h-9 w-14 p-1"
            />
            <Input
              value={data.primary_color}
              onChange={(e) => set("primary_color", e.target.value)}
              className="font-mono text-sm"
              maxLength={9}
            />
          </div>
        </div>
        <div className="md:col-span-2">
          <Label>URL do logo (opcional)</Label>
          <Input value={data.logo_url} onChange={(e) => set("logo_url", e.target.value)} placeholder="https://..." maxLength={400} />
        </div>
        <div className="md:col-span-2">
          <Label>Mensagem de boas-vindas</Label>
          <Textarea
            value={data.welcome_message}
            onChange={(e) => set("welcome_message", e.target.value)}
            rows={2}
            maxLength={400}
          />
        </div>
      </div>

      {/* Modo de exibição */}
      <div className="grid gap-3 rounded-md border border-border p-3">
        <div>
          <Label className="text-sm">Modo de exibição</Label>
          <p className="text-[11px] text-muted-foreground">
            Como o widget aparece no site do cliente.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label>Modo</Label>
            <Select
              value={data.display_mode}
              onValueChange={(v) => set("display_mode", v as DisplayMode)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="popup">Popup (bolha flutuante)</SelectItem>
                <SelectItem value="inline">Inline (embedado na página)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {data.display_mode === "popup" && (
            <>
              <div>
                <Label>Posição do botão</Label>
                <Select value={data.position} onValueChange={(v) => set("position", v as WidgetData["position"])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bottom-right">Inferior direito</SelectItem>
                    <SelectItem value="bottom-left">Inferior esquerdo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2">
                <Label>Tamanho do botão</Label>
                <Select value={data.launcher_size} onValueChange={(v) => set("launcher_size", v as WidgetData["launcher_size"])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sm">Pequeno</SelectItem>
                    <SelectItem value="md">Médio</SelectItem>
                    <SelectItem value="lg">Grande</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </div>

        {data.display_mode === "inline" && (
          <div className="grid gap-3 rounded-md border border-dashed border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label className="text-sm">Preencher 100% do container pai</Label>
                <p className="text-[11px] text-muted-foreground">
                  Quando ligado, o chat ignora largura/altura abaixo e ocupa todo o espaço do{" "}
                  <code className="rounded bg-muted px-1">&lt;div&gt;</code> onde o script for colado.
                </p>
              </div>
              <Switch
                checked={data.inline_fill_container}
                onCheckedChange={(v) => set("inline_fill_container", v)}
              />
            </div>

            {!data.inline_fill_container && (
              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <Label>Largura máxima (px)</Label>
                  <Input
                    type="number"
                    min={280}
                    max={1600}
                    placeholder="sem limite"
                    value={data.inline_max_width ?? ""}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      set("inline_max_width", isNaN(n) ? null : n);
                    }}
                  />
                </div>
                <div>
                  <Label>Altura (px)</Label>
                  <Input
                    type="number"
                    min={300}
                    max={1600}
                    placeholder="600"
                    value={data.inline_height ?? ""}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      set("inline_height", isNaN(n) ? null : n);
                    }}
                  />
                </div>
                <div>
                  <Label>Alinhamento</Label>
                  <Select
                    value={data.inline_align}
                    onValueChange={(v) => set("inline_align", v as InlineAlign)}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="left">Esquerda</SelectItem>
                      <SelectItem value="center">Centro</SelectItem>
                      <SelectItem value="right">Direita</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Formulário pré-chat */}
      <div className="grid gap-3 rounded-md border border-border p-3">
        <div>
          <Label className="text-sm">Formulário pré-chat</Label>
          <p className="text-[11px] text-muted-foreground">
            Campos solicitados antes de iniciar a conversa.
          </p>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label className="text-sm">Pedir nome do visitante</Label>
            <p className="text-[11px] text-muted-foreground">Recomendado para personalizar o atendimento.</p>
          </div>
          <Switch checked={data.require_name} onCheckedChange={(v) => set("require_name", v)} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label className="text-sm">Pedir telefone do visitante</Label>
            <p className="text-[11px] text-muted-foreground">
              Recomendado: quando o visitante já tiver conversado pelo WhatsApp, o histórico é
              unificado automaticamente no mesmo contato.
            </p>
          </div>
          <Switch checked={data.require_phone} onCheckedChange={(v) => set("require_phone", v)} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label className="text-sm">Pedir e-mail do visitante (opcional)</Label>
            <p className="text-[11px] text-muted-foreground">
              Exibe um campo de e-mail no formulário. O visitante pode deixar em branco.
            </p>
          </div>
          <Switch checked={data.collect_email} onCheckedChange={(v) => set("collect_email", v)} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label className="text-sm">Permitir anexos de visitantes</Label>
            <p className="text-[11px] text-muted-foreground">
              Exibe um botão de clipe no chat para o visitante enviar imagens, PDFs ou documentos Office (até 10 MB).
            </p>
          </div>
          <Switch checked={data.allow_attachments} onCheckedChange={(v) => set("allow_attachments", v)} />
        </div>
      </div>

      {/* Textos do widget */}
      <div className="grid gap-3 rounded-md border border-border p-3">
        <div>
          <Label className="text-sm">Textos do widget</Label>
          <p className="text-[11px] text-muted-foreground">
            Personalize cada texto exibido. Deixe em branco para usar o padrão mostrado no placeholder.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label className="text-xs">Subtítulo do header (online)</Label>
            <Input value={data.header_subtitle_online} onChange={(e) => set("header_subtitle_online", e.target.value)} placeholder="Online" maxLength={60} />
          </div>
          <div>
            <Label className="text-xs">Subtítulo do header (offline)</Label>
            <Input value={data.header_subtitle_offline} onChange={(e) => set("header_subtitle_offline", e.target.value)} placeholder="Offline" maxLength={60} />
          </div>
          <div>
            <Label className="text-xs">Label do campo Nome</Label>
            <Input value={data.form_name_label} onChange={(e) => set("form_name_label", e.target.value)} placeholder="Nome" maxLength={60} />
          </div>
          <div>
            <Label className="text-xs">Placeholder do campo Nome</Label>
            <Input value={data.form_name_placeholder} onChange={(e) => set("form_name_placeholder", e.target.value)} placeholder="Seu nome" maxLength={80} />
          </div>
          <div>
            <Label className="text-xs">Label do campo Telefone</Label>
            <Input value={data.form_phone_label} onChange={(e) => set("form_phone_label", e.target.value)} placeholder="Telefone (com DDD)" maxLength={60} />
          </div>
          <div>
            <Label className="text-xs">Placeholder do campo Telefone</Label>
            <Input value={data.form_phone_placeholder} onChange={(e) => set("form_phone_placeholder", e.target.value)} placeholder="(11) 99999-9999" maxLength={80} />
          </div>
          <div>
            <Label className="text-xs">Label do campo E-mail</Label>
            <Input value={data.form_email_label} onChange={(e) => set("form_email_label", e.target.value)} placeholder="E-mail" maxLength={60} />
          </div>
          <div>
            <Label className="text-xs">Placeholder do campo E-mail</Label>
            <Input value={data.form_email_placeholder} onChange={(e) => set("form_email_placeholder", e.target.value)} placeholder="voce@email.com" maxLength={80} />
          </div>
          <div>
            <Label className="text-xs">Texto do botão do formulário</Label>
            <Input value={data.form_submit_label} onChange={(e) => set("form_submit_label", e.target.value)} placeholder="Iniciar conversa" maxLength={60} />
          </div>
          <div>
            <Label className="text-xs">Placeholder da caixa de mensagem</Label>
            <Input value={data.chat_input_placeholder} onChange={(e) => set("chat_input_placeholder", e.target.value)} placeholder="Digite uma mensagem…" maxLength={80} />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">Rodapé "powered by"</Label>
            <Input value={data.powered_by_label} onChange={(e) => set("powered_by_label", e.target.value)} placeholder="powered by MegaCRM" maxLength={80} />
          </div>
        </div>
      </div>



      {/* Horário de atendimento */}
      <div className="grid gap-2 rounded-md border border-border p-3">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm">Horário de atendimento</Label>
            <p className="text-[11px] text-muted-foreground">
              Quando desabilitado, o widget mostra-se sempre online.
            </p>
          </div>
          <Switch
            checked={data.business_hours.enabled}
            onCheckedChange={(v) =>
              setData((d) => ({ ...d, business_hours: { ...d.business_hours, enabled: v } }))
            }
          />
        </div>
        {data.business_hours.enabled && (
          <div className="grid gap-2">
            {DAYS.map((d) => {
              const slot = data.business_hours.days[d.key];
              return (
                <div key={d.key} className="flex items-center gap-2 text-xs">
                  <div className="w-10 font-medium">{d.label}</div>
                  <Switch
                    checked={!!slot}
                    onCheckedChange={(v) => setDay(d.key, v ? { open: "09:00", close: "18:00" } : null)}
                  />
                  {slot ? (
                    <>
                      <Input
                        type="time"
                        value={slot.open}
                        onChange={(e) => setDay(d.key, { ...slot, open: e.target.value })}
                        className="h-7 w-24"
                      />
                      <span>–</span>
                      <Input
                        type="time"
                        value={slot.close}
                        onChange={(e) => setDay(d.key, { ...slot, close: e.target.value })}
                        className="h-7 w-24"
                      />
                    </>
                  ) : (
                    <span className="text-muted-foreground">Fechado</span>
                  )}
                </div>
              );
            })}
            <div>
              <Label className="text-xs">Mensagem fora do horário</Label>
              <Textarea
                value={data.offline_message}
                onChange={(e) => set("offline_message", e.target.value)}
                rows={2}
                maxLength={400}
              />
            </div>
          </div>
        )}
      </div>

      {/* CSS customizado */}
      <div>
        <Label className="text-xs">CSS customizado (avançado)</Label>
        <Textarea
          value={data.custom_css}
          onChange={(e) => set("custom_css", e.target.value)}
          rows={3}
          maxLength={8000}
          placeholder=".wc-window { ... }"
          className="font-mono text-xs"
        />
        <p className="mt-1 text-[10px] text-muted-foreground">
          Aplicado dentro do Shadow DOM. <code>@import</code> e <code>url()</code> externos são removidos por segurança.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
          Salvar widget
        </Button>
        <Button size="sm" variant="outline" onClick={copySnippet} disabled={!data.id}>
          <Code className="mr-1 h-3.5 w-3.5" />
          Copiar snippet
        </Button>
        {data.id && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => window.open(`/admin/webchat-preview/${data.id}`, "_blank")}
            title="Abrir página de preview do widget"
          >
            <ExternalLink className="mr-1 h-3.5 w-3.5" />
            Preview
          </Button>
        )}
      </div>

      {data.id && (
        <div className="rounded-md border border-dashed border-border bg-muted/30 p-3">
          <Label className="text-xs">
            {data.display_mode === "inline"
              ? "Cole isto onde o chat deve aparecer no seu site:"
              : "Cole isto no <body> do seu site:"}
          </Label>
          <pre className="mt-1 overflow-x-auto rounded bg-background p-2 text-[11px] font-mono whitespace-pre">
{snippet}
          </pre>
          <Button size="sm" variant="ghost" className="mt-1 h-7" onClick={copySnippet}>
            <Copy className="mr-1 h-3 w-3" /> Copiar
          </Button>
        </div>
      )}
    </section>
  );
}
