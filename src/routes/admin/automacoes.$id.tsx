import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  Handle,
  Position,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  NodeToolbar,
  SelectionMode,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  type EdgeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowLeft, Save, Loader2, MessageSquare, Webhook as WebhookIcon, Zap, Hand, Trash2, Copy,
  GitBranch, Tag, Clock, CheckCircle2, KanbanSquare, Tags as TagsIcon, Upload, X, Check, ChevronsUpDown, Bot,
  Shuffle, Plus, HelpCircle, ShieldOff, Variable, StickyNote, UserPlus, History, AlertTriangle, FolderOpen, FileText, Film,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { listBrandMedia, deleteBrandMedia, type BrandMediaItem, type BrandMediaKind } from "@/lib/brand-media.functions";

import { AutomationHistorySheet } from "@/components/automations/AutomationHistorySheet";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { listAssignableUsers } from "@/lib/automation-assignable-users.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/automations/SearchableSelect";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { TemplatePreview, type TemplateButton, type TemplatePreviewData } from "@/components/templates/TemplatePreview";
import { PLATFORMS, PLATFORM_LIST, type IntegrationPlatform } from "@/lib/integrations-platforms";
import { VarInput, VarTextarea, VariablePicker, getVariablesForTrigger, getAllVariableGroups } from "@/components/automations/variable-picker";
import { getFieldsForSource } from "@/lib/template-bindings";
import { NewBroadcastDialog } from "@/components/broadcasts/NewBroadcastDialog";
import { Megaphone } from "lucide-react";

const PLATFORM_FIELD_GROUPS: Array<{ source: "hotmart" | "shopify" | "activecampaign" | "sendflow"; label: string }> = [
  { source: "hotmart", label: "Hotmart" },
  { source: "shopify", label: "Shopify" },
  { source: "activecampaign", label: "ActiveCampaign" },
  { source: "sendflow", label: "SendFlow" },
];

const normalizeSearchText = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export const Route = createFileRoute("/admin/automacoes/$id")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  component: AutomationEditor,
});

// ===== Node types =====
type NodeKind = "trigger" | "message" | "question" | "wait" | "condition" | "webhook" | "set_status" | "move_to_pipeline" | "activecampaign" | "add_tag" | "assign_ai_agent" | "assign_user" | "randomizer" | "send_to_blocklist" | "set_variable" | "comment";

const NODE_META: Record<NodeKind, { label: string; icon: any; color: string; stripe: string; tone: string }> = {
  trigger:    { label: "Gatilho",          icon: Zap,            color: "bg-gradient-to-r from-amber-500 to-orange-500",       stripe: "bg-amber-500",   tone: "bg-amber-100 text-amber-700" },
  message:    { label: "Mensagem",         icon: MessageSquare,  color: "bg-gradient-to-r from-emerald-500 to-emerald-600",    stripe: "bg-emerald-500", tone: "bg-emerald-100 text-emerald-700" },
  question:   { label: "Pergunta",         icon: HelpCircle,     color: "bg-gradient-to-r from-sky-500 to-sky-600",            stripe: "bg-sky-500",     tone: "bg-sky-100 text-sky-700" },
  wait:       { label: "Aguardar",         icon: Clock,          color: "bg-gradient-to-r from-purple-500 to-purple-600",      stripe: "bg-purple-500",  tone: "bg-purple-100 text-purple-700" },
  condition:  { label: "Condicional",      icon: GitBranch,      color: "bg-gradient-to-r from-orange-500 to-orange-600",      stripe: "bg-orange-500",  tone: "bg-orange-100 text-orange-700" },
  webhook:    { label: "Webhook",          icon: WebhookIcon,    color: "bg-gradient-to-r from-pink-500 to-pink-600",          stripe: "bg-pink-500",    tone: "bg-pink-100 text-pink-700" },
  set_status: { label: "Status da conversa", icon: CheckCircle2, color: "bg-gradient-to-r from-green-500 to-green-600",        stripe: "bg-green-500",   tone: "bg-green-100 text-green-700" },
  move_to_pipeline: { label: "Pipeline", icon: KanbanSquare,     color: "bg-gradient-to-r from-indigo-500 to-indigo-600",      stripe: "bg-indigo-500",  tone: "bg-indigo-100 text-indigo-700" },
  activecampaign: { label: "ActiveCampaign", icon: TagsIcon,     color: "bg-gradient-to-r from-sky-600 to-sky-700",            stripe: "bg-sky-600",     tone: "bg-sky-100 text-sky-700" },
  add_tag:    { label: "Tag", icon: Tag,                         color: "bg-gradient-to-r from-yellow-300 to-yellow-400",      stripe: "bg-yellow-400",  tone: "bg-yellow-100 text-yellow-800" },
  assign_ai_agent: { label: "Agente de IA", icon: Bot,           color: "bg-gradient-to-r from-violet-500 to-violet-600",      stripe: "bg-violet-500",  tone: "bg-violet-100 text-violet-700" },
  assign_user: { label: "Atribuir atendente", icon: UserPlus,    color: "bg-gradient-to-r from-emerald-500 to-teal-600",       stripe: "bg-emerald-500", tone: "bg-emerald-100 text-emerald-700" },
  randomizer: { label: "Randomizador",     icon: Shuffle,        color: "bg-gradient-to-r from-fuchsia-500 to-fuchsia-600",    stripe: "bg-fuchsia-500", tone: "bg-fuchsia-100 text-fuchsia-700" },
  send_to_blocklist: { label: "Enviar p/ blocklist", icon: ShieldOff, color: "bg-gradient-to-r from-rose-600 to-red-700",      stripe: "bg-rose-600",    tone: "bg-rose-100 text-rose-700" },
  set_variable: { label: "Definir variável", icon: Variable,        color: "bg-gradient-to-r from-violet-500 to-purple-600",     stripe: "bg-violet-500",  tone: "bg-violet-100 text-violet-700" },
  comment:    { label: "Comentário",       icon: StickyNote,     color: "bg-gradient-to-r from-amber-300 to-yellow-400",       stripe: "bg-amber-400",   tone: "bg-amber-100 text-amber-800" },
};

const AC_ACTION_LABELS: Record<string, string> = {
  add_tag: "Adicionar tag",
  add_to_list: "Adicionar à lista",
  update_field: "Atualizar campo",
};

const STATUS_LABELS: Record<string, string> = {
  aberto: "Aberto",
  pendente: "Pendente",
  resolvido: "Resolvido",
};

// Parse template buttons from components JSON
function getTemplateButtons(template: any): { type: string; text: string; index: number }[] {
  if (!template?.components) return [];
  const btnComp = (template.components as any[]).find((c) => c.type === "BUTTONS");
  if (!btnComp?.buttons) return [];
  return btnComp.buttons.map((b: any, i: number) => ({
    type: b.type,
    text: b.text ?? "(botão)",
    index: i,
  }));
}

// Derive header type from template — falls back to components when column is empty
function getTemplateHeaderType(tpl: any): "IMAGE" | "VIDEO" | "DOCUMENT" | "TEXT" | null {
  const explicit = (tpl?.header_type ?? "").toString().toUpperCase();
  if (explicit === "IMAGE" || explicit === "VIDEO" || explicit === "DOCUMENT" || explicit === "TEXT") return explicit;
  const comps: any[] = Array.isArray(tpl?.components) ? tpl.components : [];
  const headerComp = comps.find((c) => c?.type === "HEADER");
  const fmt = (headerComp?.format ?? "").toString().toUpperCase();
  if (fmt === "IMAGE" || fmt === "VIDEO" || fmt === "DOCUMENT" || fmt === "TEXT") return fmt;
  return null;
}

// Count {{N}} placeholders in template body
function getTemplateBodyVarCount(tpl: any): number {
  const comps: any[] = Array.isArray(tpl?.components) ? tpl.components : [];
  const body = comps.find((c) => c?.type === "BODY")?.text ?? "";
  const matches = String(body).match(/\{\{\s*(\d+)\s*\}\}/g) ?? [];
  let max = 0;
  for (const m of matches) {
    const n = parseInt(m.replace(/[^\d]/g, ""), 10);
    if (n > max) max = n;
  }
  return max;
}

// Build TemplatePreview data from a saved whatsapp_templates row
function templateToPreview(tpl: any, overrideMediaUrl?: string | null, bodyExamples?: string[]): TemplatePreviewData {
  const comps: any[] = Array.isArray(tpl?.components) ? tpl.components : [];
  const headerComp = comps.find((c) => c.type === "HEADER");
  const bodyComp = comps.find((c) => c.type === "BODY");
  const footerComp = comps.find((c) => c.type === "FOOTER");
  const btnComp = comps.find((c) => c.type === "BUTTONS");

  const headerKind: "none" | "text" | "media" =
    !headerComp ? "none"
    : headerComp.format === "TEXT" ? "text"
    : "media";

  const headerMediaType =
    headerComp?.format === "IMAGE" ? "IMAGE"
    : headerComp?.format === "VIDEO" ? "VIDEO"
    : headerComp?.format === "DOCUMENT" ? "DOCUMENT"
    : undefined;

  const buttons: TemplateButton[] = (btnComp?.buttons ?? []).map((b: any) => ({
    type: b.type === "URL" ? "URL" : "QUICK_REPLY",
    text: b.text ?? "",
    url: b.url,
  }));

  return {
    headerKind,
    headerText: headerComp?.text ?? undefined,
    headerMediaType,
    headerMediaPreviewUrl: overrideMediaUrl ?? null,
    body: bodyComp?.text ?? "",
    bodyExamples,
    footer: footerComp?.text ?? undefined,
    buttons,
  };
}

// Context to expose templates to canvas nodes (for inline preview) without prop-drilling.
const TemplatesContext = createContext<any[]>([]);

// Context for node actions (duplicate/delete) used by the floating toolbar.
const NodeActionsContext = createContext<{
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}>({ onDuplicate: () => {}, onDelete: () => {} });



function NodeShell({ kind, id, children, selected }: { kind: NodeKind; id?: string; children: React.ReactNode; selected?: boolean }) {
  const meta = NODE_META[kind];
  const Icon = meta.icon;
  const widthClass = kind === "message" || kind === "question" ? "w-[360px]" : "min-w-[220px]";
  const actions = useContext(NodeActionsContext);
  const showToolbar = !!selected && kind !== "trigger" && !!id;
  const headerTextClass = kind === "add_tag" ? "text-yellow-950" : "text-white";
  const iconChipClass = kind === "add_tag" ? "bg-yellow-950/10" : "bg-white/20";
  const borderClass = selected ? "border-primary" : "border-border";
  return (
    <div className={`relative ${widthClass} overflow-hidden rounded-xl border-2 bg-card shadow-sm transition-shadow hover:shadow-md ${borderClass}`}>
      {/* Stripe lateral colorida */}
      <div className={`absolute left-0 top-0 h-full w-1 ${meta.stripe}`} aria-hidden />
      {showToolbar && (
        <NodeToolbar position={Position.Top} offset={8} className="flex items-center gap-1 rounded-md border bg-popover px-1 py-1 shadow-md">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); actions.onDuplicate(id!); }}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-foreground hover:bg-muted"
            title="Duplicar nó"
          >
            <Copy className="h-3.5 w-3.5" /> Duplicar
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); actions.onDelete(id!); }}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
            title="Excluir nó"
          >
            <Trash2 className="h-3.5 w-3.5" /> Excluir
          </button>
        </NodeToolbar>
      )}
      <div className={`flex items-center gap-2 px-3 py-2 pl-4 ${headerTextClass} ${meta.color}`}>
        <span className={`inline-flex items-center justify-center rounded-md p-1 ${iconChipClass}`}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-xs font-semibold uppercase tracking-wide">{meta.label}</span>
      </div>
      <div className="p-3 pl-4 text-sm">{children}</div>

    </div>
  );
}

function getTriggerTheme(type?: string) {
  switch (type) {
    case "shopify":
      return {
        headerGradient: "from-green-500 via-green-600 to-emerald-600",
        glow:           "bg-green-400/40",
        badgeGradient:  "from-green-500 to-emerald-600",
        iconGradient:   "from-green-400 to-emerald-600",
        border:         "border-green-500",
      };
    case "hotmart":
      return {
        headerGradient: "from-orange-500 via-red-500 to-orange-600",
        glow:           "bg-orange-400/40",
        badgeGradient:  "from-orange-500 to-red-500",
        iconGradient:   "from-orange-400 to-red-600",
        border:         "border-orange-500",
      };
    case "sendflow":
      return {
        headerGradient: "from-zinc-800 via-black to-zinc-900",
        glow:           "bg-zinc-700/40",
        badgeGradient:  "from-zinc-800 to-black",
        iconGradient:   "from-zinc-700 to-black",
        border:         "border-zinc-800",
      };
    case "activecampaign":
      return {
        headerGradient: "from-blue-500 via-blue-600 to-indigo-600",
        glow:           "bg-blue-400/40",
        badgeGradient:  "from-blue-500 to-indigo-600",
        iconGradient:   "from-blue-400 to-indigo-600",
        border:         "border-blue-600",
      };
    default:
      return {
        headerGradient: "from-amber-500 via-orange-500 to-amber-600",
        glow:           "bg-amber-400/40",
        badgeGradient:  "from-amber-500 to-orange-500",
        iconGradient:   "from-amber-400 to-orange-600",
        border:         "border-amber-500",
      };
  }
}

function TriggerNode({ data, selected }: NodeProps) {
  const d = data as any;
  const type = d.triggerType ?? "tag";
  const isIntegration = ["shopify", "hotmart", "sendflow", "activecampaign"].includes(type);
  const ringClass = selected ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : "";
  const theme = getTriggerTheme(type);
  return (
    <div className={`relative ${ringClass} rounded-[28px]`}>
      {/* Glow pulsante */}
      <div className={`pointer-events-none absolute -inset-1 rounded-[32px] ${theme.glow} blur-md animate-pulse`} aria-hidden />
      {/* Selo "INÍCIO DO FLUXO" */}
      <div className={`absolute -top-3 left-1/2 -translate-x-1/2 z-10 rounded-full bg-gradient-to-r ${theme.badgeGradient} px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-md ring-2 ring-background whitespace-nowrap`}>
        ▶ Início do fluxo
      </div>
      {/* Ícone circular destacado */}
      <div className={`absolute -left-5 top-1/2 -translate-y-1/2 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br ${theme.iconGradient} text-white shadow-lg ring-4 ring-background`}>
        <Zap className="h-6 w-6" fill="currentColor" />
      </div>
      <div className={`relative min-w-[260px] rounded-[28px] border-2 ${theme.border} bg-card shadow-lg overflow-hidden`}>
        <div className={`flex items-center justify-end gap-2 bg-gradient-to-r ${theme.headerGradient} px-4 py-2 pl-12 text-white`}>
          <span className="text-xs font-semibold uppercase tracking-wide">Gatilho</span>
        </div>
        <div className="px-4 py-3 pl-10 text-sm">
          {type === "manual" ? (
            <>
              <div className="text-xs text-muted-foreground">Disparado via API</div>
              <div className="font-medium mt-1 flex items-center gap-1">
                <Hand className="h-3 w-3" /> Manual
              </div>
            </>
          ) : isIntegration ? (
            <>
              <div className="text-xs text-muted-foreground capitalize">{type}</div>
              <div className="font-medium mt-1 text-xs">
                {(() => {
                  const evs: string[] = Array.isArray(d.triggerEvents) ? d.triggerEvents : (d.triggerEvent ? [d.triggerEvent] : []);
                  if (evs.length === 0) return "Selecione o evento";
                  if (evs.length === 1) return evs[0];
                  return `${evs.length} eventos`;
                })()}
              </div>
            </>
          ) : (
            <>
              <div className="text-xs text-muted-foreground">Quando uma tag é adicionada</div>
              <div className="font-medium mt-1 flex items-center gap-1">
                <Tag className="h-3 w-3" />{d.tag || "Defina a tag"}
              </div>
            </>
          )}
        </div>
        <Handle type="source" position={Position.Bottom} />
      </div>
    </div>
  );
}

function MessageNode({ id, data, selected }: NodeProps) {
  const d = data as any;
  const isTemplate = d.mode === "template";
  const templates = useContext(TemplatesContext);
  const tpl = isTemplate && d.templateId ? templates.find((t) => t.id === d.templateId) : null;
  const previewData = tpl ? templateToPreview(tpl, d.templateHeaderMediaUrl ?? null, Array.isArray(d.templateVariables) ? d.templateVariables : undefined) : null;
  // Buttons from saved node data (kept for backward-compat) or derived from preview
  const tplButtons: any[] = (d.buttons ?? (previewData?.buttons ?? [])) as any[];
  const allButtons = tplButtons.map((b: any, i: number) => ({
    type: b.type === "URL" ? "URL" : "QUICK_REPLY",
    text: b.text ?? "",
    url: b.url,
    index: typeof b.index === "number" ? b.index : i,
  }));
  return (
    <NodeShell kind="message" id={id} selected={selected}>
      <Handle type="target" position={Position.Top} />
      {isTemplate ? (
        previewData ? (
          <div className="space-y-2">
            <div className="text-[10px] uppercase text-muted-foreground">{d.templateName ?? "Template"}</div>
            <div className="-mx-1">
              <TemplatePreview data={previewData} hideEmptyMedia hideButtons />
            </div>
            {tpl && (() => { const ht = getTemplateHeaderType(tpl); return (ht === "IMAGE" || ht === "VIDEO" || ht === "DOCUMENT") && !d.templateHeaderMediaUrl; })() && (
              <div className="text-[10px] text-amber-600 dark:text-amber-400">⚠ Faça upload da mídia desta automação no painel à direita.</div>
            )}
          </div>
        ) : (
          <>
            <div className="text-[10px] uppercase text-muted-foreground">Template</div>
            <div className="font-medium text-xs">Selecione um template no painel.</div>
          </>
        )
      ) : (
        <div className="text-xs text-muted-foreground line-clamp-3">{d.text || "Texto da mensagem..."}</div>
      )}
      {/* Default continuation handle */}
      <Handle type="source" position={Position.Bottom} id="next" style={{ left: "50%" }} />
      {/* Per-button rows below; QUICK_REPLY get a right-side handle, URL is visual only */}
      {allButtons.map((b, i) => (
        <div
          key={i}
          className="relative mt-1 flex items-center gap-1.5 px-2 py-1 rounded border text-xs bg-muted/30"
          title={b.type === "URL" ? "Botão de URL — não conecta a outro nó" : "Conecte para definir o próximo passo"}
        >
          {b.type === "URL" ? "🔗" : "▸"} {b.text || <span className="text-muted-foreground">Botão</span>}
          {b.type === "QUICK_REPLY" && (
            <Handle
              type="source"
              position={Position.Right}
              id={`btn:${b.index}`}
              style={{ top: "50%" }}
            />
          )}
        </div>
      ))}
      {/* Saídas de erro */}
      <div className="mt-3 border-t pt-2 space-y-1">
        <div
          className="relative flex items-center gap-1.5 px-2 py-1 rounded border border-rose-300 bg-rose-50 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800"
          title="Erros internos: dados ausentes, janela 24h fechada, exceções"
        >
          <span>⚠ Erro</span>
          <Handle type="source" position={Position.Right} id="error" style={{ top: "50%" }} className="!bg-rose-500" />
        </div>
        <div
          className="relative flex items-center gap-1.5 px-2 py-1 rounded border border-red-400 bg-red-100 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800"
          title="Erros retornados pela API da Meta (ex.: 130472, 131026)"
        >
          <span>⚠ Erro Meta</span>
          <Handle type="source" position={Position.Right} id="error_meta" style={{ top: "50%" }} className="!bg-red-600" />
        </div>
      </div>
    </NodeShell>
  );
}

function QuestionNode({ id, data, selected }: NodeProps) {
  const d = data as any;
  const isTemplate = d.mode === "template";
  const templates = useContext(TemplatesContext);
  const tpl = isTemplate && d.templateId ? templates.find((t) => t.id === d.templateId) : null;
  const previewData = tpl ? templateToPreview(tpl, d.templateHeaderMediaUrl ?? null, Array.isArray(d.templateVariables) ? d.templateVariables : undefined) : null;
  const timeoutMin = Number(d.timeoutMinutes ?? 1440);
  const timeoutLabel = timeoutMin >= 1440 && timeoutMin % 1440 === 0
    ? `${timeoutMin / 1440}d`
    : timeoutMin >= 60 && timeoutMin % 60 === 0
    ? `${timeoutMin / 60}h`
    : `${timeoutMin}min`;
  return (
    <NodeShell kind="question" id={id} selected={selected}>
      <Handle type="target" position={Position.Top} />
      {isTemplate ? (
        previewData ? (
          <div className="space-y-2">
            <div className="text-[10px] uppercase text-muted-foreground">{d.templateName ?? "Template"}</div>
            <div className="-mx-1"><TemplatePreview data={previewData} hideEmptyMedia hideButtons /></div>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">Selecione um template no painel.</div>
        )
      ) : (
        <div className="text-xs text-muted-foreground line-clamp-3">{d.text || "Pergunta a enviar..."}</div>
      )}
      <div className="mt-2 text-[10px] text-muted-foreground">
        Aguarda resposta · timeout {timeoutLabel}
        {d.saveAs ? <> · salva em <code className="text-[10px]">{d.saveAs}</code></> : null}
      </div>
      {((d.buttons as any[]) ?? []).map((b, i) => (
        <div
          key={`qbtn-${i}`}
          className="relative mt-1 flex items-center gap-1.5 px-2 py-1 rounded border text-xs bg-muted/30"
          title="Conecte para definir o próximo passo quando este botão for clicado"
        >
          ▸ {b.text || <span className="text-muted-foreground">Botão</span>}
          <Handle type="source" position={Position.Right} id={`btn:${b.index}`} style={{ top: "50%" }} />
        </div>
      ))}
      <div className="mt-3 space-y-1">
        <div className="relative flex items-center gap-1.5 px-2 py-1 rounded border border-emerald-300 bg-emerald-50 text-xs text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
          <span>✓ Respondeu</span>
          <Handle type="source" position={Position.Right} id="answered" style={{ top: "50%" }} className="!bg-emerald-500" />
        </div>
        <div className="relative flex items-center gap-1.5 px-2 py-1 rounded border border-amber-300 bg-amber-50 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
          <span>⏱ Sem resposta</span>
          <Handle type="source" position={Position.Right} id="timeout" style={{ top: "50%" }} className="!bg-amber-500" />
        </div>
        <div className="relative flex items-center gap-1.5 px-2 py-1 rounded border border-rose-300 bg-rose-50 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800">
          <span>⚠ Erro ao enviar</span>
          <Handle type="source" position={Position.Right} id="error" style={{ top: "50%" }} className="!bg-rose-500" />
        </div>
      </div>
    </NodeShell>
  );
}


function WaitNode({ id, data, selected }: NodeProps) {
  const d = data as any;
  let descr = "—";
  if (d.mode === "duration") descr = `${d.amount ?? 1} ${d.unit ?? "minutes"}`;
  else if (d.mode === "until_date") descr = d.date ? new Date(d.date).toLocaleString("pt-BR") : "Data específica";
  else if (d.mode === "inbound") descr = `Resposta (timeout ${d.timeoutHours ?? 24}h)`;
  return (
    <NodeShell kind="wait" id={id} selected={selected}>
      <Handle type="target" position={Position.Top} />
      <div className="text-[10px] uppercase text-muted-foreground">{d.mode ?? "duration"}</div>
      <div className="font-medium text-xs">{descr}</div>
      <Handle type="source" position={Position.Bottom} />
    </NodeShell>
  );
}

function ConditionNode({ id, data, selected }: NodeProps) {
  const d = data as any;
  let label: string;
  if (d.kind === "in_window") label = "Janela 24h aberta?";
  else if (d.kind === "in_pipeline") label = "Está no pipeline?";
  else if (d.kind === "is_blocklisted") label = "Está no blocklist?";
  else if (d.kind === "field") {
    const fk = d.field?.key || "campo";
    const op = (d.operator || "is").replace(/_/g, " ");
    const val = d.value ? `"${d.value}"` : "";
    label = `${fk} ${op} ${val}`.trim() + "?";
  }
  else label = `Tem tag "${d.tag || "..."}"?`;
  return (
    <NodeShell kind="condition" id={id} selected={selected}>
      <Handle type="target" position={Position.Top} />
      <div className="text-xs">{label}</div>
      {d.kind === "in_window" && (
        <div className="text-[10px] text-muted-foreground mt-1">Não → expirada ou nunca interagiu</div>
      )}
      <div className="mt-3 flex justify-between text-[10px]">
        <div className="relative w-1/2 text-center">
          <span className="px-2 py-0.5 rounded bg-emerald-500 text-white">Sim</span>
          <Handle type="source" position={Position.Bottom} id="true" style={{ left: "25%" }} />
        </div>
        <div className="relative w-1/2 text-center">
          <span className="px-2 py-0.5 rounded bg-rose-500 text-white">Não</span>
          <Handle type="source" position={Position.Bottom} id="false" style={{ left: "75%" }} />
        </div>
      </div>
    </NodeShell>
  );
}

function WebhookNode({ id, data, selected }: NodeProps) {
  const d = data as any;
  return (
    <NodeShell kind="webhook" id={id} selected={selected}>
      <Handle type="target" position={Position.Top} />
      <div className="text-xs text-muted-foreground truncate">{d.method || "POST"} {d.url || "https://..."}</div>
      <Handle type="source" position={Position.Bottom} />
    </NodeShell>
  );
}

function SetStatusNode({ id, data, selected }: NodeProps) {
  const d = data as any;
  return (
    <NodeShell kind="set_status" id={id} selected={selected}>
      <Handle type="target" position={Position.Top} />
      <div className="text-xs text-muted-foreground">Mudar status para</div>
      <div className="font-medium mt-1">{STATUS_LABELS[d.status] ?? "Resolvido"}</div>
      <Handle type="source" position={Position.Bottom} />
    </NodeShell>
  );
}

function MoveToPipelineNode({ id, data, selected }: NodeProps) {
  const d = data as any;
  const isRemove = d.action === "remove";
  const resolveCard = d.resolveCard === true;
  return (
    <NodeShell kind="move_to_pipeline" id={id} selected={selected}>
      <Handle type="target" position={Position.Top} />
      <div className="text-xs text-muted-foreground">{isRemove ? "Remover do pipeline" : "Mover contato para"}</div>
      <div className="font-medium mt-1 truncate">
        {isRemove
          ? (d.pipelineName || "...")
          : `${d.pipelineName || "..."} → ${d.stageName || "..."}`}
      </div>
      {!isRemove && resolveCard && (
        <div className="mt-1 inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-700">
          <CheckCircle2 className="h-2.5 w-2.5" /> Card resolvido
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </NodeShell>
  );
}

function ActiveCampaignNode({ id, data, selected }: NodeProps) {
  const d = data as any;
  return (
    <NodeShell kind="activecampaign" id={id} selected={selected}>
      <Handle type="target" position={Position.Top} />
      <div className="text-[10px] uppercase text-muted-foreground">{d.accountName || "Conta AC"}</div>
      <div className="font-medium text-xs">{AC_ACTION_LABELS[d.action] ?? "Selecione a ação"}</div>
      <div className="text-xs text-muted-foreground truncate">{d.itemName || "—"}</div>
      <Handle type="source" position={Position.Bottom} />
    </NodeShell>
  );
}

function AddTagNode({ id, data, selected }: NodeProps) {
  const d = data as any;
  const tags: string[] = Array.isArray(d.tags) ? d.tags : (d.tag ? [d.tag] : []);
  return (
    <NodeShell kind="add_tag" id={id} selected={selected}>
      <Handle type="target" position={Position.Top} />
      <div className="text-xs text-muted-foreground">Adicionar tag interna</div>
      {tags.length === 0 ? (
        <div className="font-medium text-xs mt-1 flex items-center gap-1">
          <Tag className="h-3 w-3" />Defina as tags
        </div>
      ) : (
        <div className="mt-1 flex flex-wrap gap-1">
          {tags.slice(0, 3).map((t, i) => (
            <span key={i} className="inline-flex items-center gap-1 text-[10px] bg-muted px-1.5 py-0.5 rounded">
              <Tag className="h-2.5 w-2.5" />{t}
            </span>
          ))}
          {tags.length > 3 && (
            <span className="text-[10px] text-muted-foreground">+{tags.length - 3}</span>
          )}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </NodeShell>
  );
}


function AssignAIAgentNode({ id, data, selected }: NodeProps) {
  const d = data as any;
  return (
    <NodeShell kind="assign_ai_agent" id={id} selected={selected}>
      <Handle type="target" position={Position.Top} />
      <div className="text-xs text-muted-foreground">Atribuir agente de IA</div>
      <div className="font-medium text-xs mt-1 truncate flex items-center gap-1">
        <Bot className="h-3 w-3" />{d.agentName || "Selecione o agente"}
      </div>
      {d.agentStatus && (
        <div className="mt-1">
          <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded ${
            d.agentStatus === "on" ? "bg-green-500/20 text-green-700" :
            d.agentStatus === "test" ? "bg-amber-500/20 text-amber-700" :
            "bg-muted text-muted-foreground"
          }`}>
            {d.agentStatus === "on" ? "Ativo" : d.agentStatus === "test" ? "Teste" : "Off"}
          </span>
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </NodeShell>
  );
}

function AssignUserNode({ id, data, selected }: NodeProps) {
  const d = data as any;
  const userId = String(d.userId ?? "").trim();
  const userName = String(d.userName ?? "").trim();
  return (
    <NodeShell kind="assign_user" id={id} selected={selected}>
      <Handle type="target" position={Position.Top} />
      <div className="text-xs text-muted-foreground">Atribuir atendente</div>
      <div className="font-medium text-xs mt-1 truncate flex items-center gap-1">
        <UserPlus className="h-3 w-3" />
        {userId ? (userName || "Atendente selecionado") : "Ninguém (remover atribuição)"}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </NodeShell>
  );
}


function RandomizerNode({ id, data, selected }: NodeProps) {
  const d = data as any;
  const paths: { label?: string; weight?: number }[] = Array.isArray(d.paths) && d.paths.length >= 2
    ? d.paths
    : [{ label: "A", weight: 50 }, { label: "B", weight: 50 }];
  const total = paths.reduce((s, p) => s + Math.max(0, Number(p.weight) || 0), 0);
  return (
    <NodeShell kind="randomizer" id={id} selected={selected}>
      <Handle type="target" position={Position.Top} />
      <div className="text-xs text-muted-foreground">Dividir entre {paths.length} caminhos</div>
      <div className="mt-2 grid gap-1" style={{ gridTemplateColumns: `repeat(${paths.length}, minmax(0, 1fr))` }}>
        {paths.map((p, i) => {
          const w = Math.max(0, Number(p.weight) || 0);
          const pct = total > 0 ? Math.round((w / total) * 100) : 0;
          return (
            <div key={i} className="text-center">
              <div className="px-1.5 py-0.5 rounded bg-fuchsia-500/20 text-fuchsia-700 text-[10px] truncate">
                {p.label || String.fromCharCode(65 + i)}
              </div>
              <div className="text-[9px] text-muted-foreground mt-0.5">{pct}%</div>
            </div>
          );
        })}
      </div>
      {paths.map((_, i) => (
        <Handle
          key={`h-${i}`}
          type="source"
          position={Position.Bottom}
          id={`out:${i}`}
          style={{ left: `${((i + 0.5) / paths.length) * 100}%` }}
        />
      ))}
    </NodeShell>
  );
}



function SendToBlocklistNode({ id, data, selected }: NodeProps) {
  const d = data as any;
  const channels: string[] = Array.isArray(d.channels) ? d.channels : ["phone", "email"];
  return (
    <NodeShell kind="send_to_blocklist" id={id} selected={selected}>
      <Handle type="target" position={Position.Top} />
      <div className="text-xs text-muted-foreground">Adicionar contato ao blocklist</div>
      <div className="text-[10px] mt-1">
        Canais: <strong>{channels.join(", ") || "—"}</strong>
      </div>
      {d.reason && <div className="text-[10px] text-muted-foreground mt-1 truncate">"{d.reason}"</div>}
      <Handle type="source" position={Position.Bottom} />
    </NodeShell>
  );
}

function SetVariableNode({ id, data, selected }: NodeProps) {
  const d = data as any;
  const name = String(d.name || "").trim();
  const value = String(d.value ?? "");
  return (
    <NodeShell kind="set_variable" id={id} selected={selected}>
      <Handle type="target" position={Position.Top} />
      <div className="text-xs">
        <code className="text-[11px]">{`{{${name || "variavel"}}}`}</code> = <span className="text-muted-foreground">"{value.length > 28 ? value.slice(0, 28) + "…" : (value || "...")}"</span>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </NodeShell>
  );
}

function CommentNode({ id, data, selected }: NodeProps) {
  const d = data as any;
  const actions = useContext(NodeActionsContext);
  const [text, setText] = useState<string>(String(d.text ?? ""));
  const { setNodes } = useReactFlow();

  // keep local in sync if data changes externally (undo/redo)
  useEffect(() => { setText(String(d.text ?? "")); }, [d.text]);

  const commit = (val: string) => {
    setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, text: val } } : n)));
  };

  const borderClass = selected ? "border-amber-600 ring-2 ring-amber-400/40" : "border-amber-500/70";

  return (
    <div
      className={`relative w-[240px] -rotate-1 rounded-sm border-2 ${borderClass} bg-yellow-200 text-yellow-950 shadow-[0_8px_18px_-6px_rgba(120,80,0,0.45)] transition-shadow hover:shadow-[0_12px_22px_-6px_rgba(120,80,0,0.55)]`}
      style={{ fontFamily: '"Caveat", "Comic Sans MS", "Segoe Script", cursive' }}
    >
      {selected && id && (
        <NodeToolbar position={Position.Top} offset={8} className="flex items-center gap-1 rounded-md border bg-popover px-1 py-1 shadow-md">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); actions.onDuplicate(id); }}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-foreground hover:bg-muted"
            title="Duplicar comentário"
          >
            <Copy className="h-3.5 w-3.5" /> Duplicar
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); actions.onDelete(id); }}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
            title="Excluir comentário"
          >
            <Trash2 className="h-3.5 w-3.5" /> Excluir
          </button>
        </NodeToolbar>
      )}
      <div className="flex items-center gap-1.5 px-3 pt-2 text-[10px] font-bold uppercase tracking-wider text-amber-900/70">
        <StickyNote className="h-3 w-3" />
        Anotação
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => commit(text)}
        onKeyDown={(e) => e.stopPropagation()}
        placeholder="Escreva uma anotação…"
        className="nodrag w-full resize-none bg-transparent px-3 pb-3 pt-1 text-[17px] leading-tight text-yellow-950 placeholder:text-amber-900/50 focus:outline-none"
        rows={4}
      />
    </div>
  );
}

const nodeTypes = {
  trigger: TriggerNode,
  message: MessageNode,
  question: QuestionNode,
  wait: WaitNode,
  condition: ConditionNode,
  webhook: WebhookNode,
  set_status: SetStatusNode,
  move_to_pipeline: MoveToPipelineNode,
  activecampaign: ActiveCampaignNode,
  add_tag: AddTagNode,
  assign_ai_agent: AssignAIAgentNode,
  assign_user: AssignUserNode,
  randomizer: RandomizerNode,
  send_to_blocklist: SendToBlocklistNode,
  set_variable: SetVariableNode,
  comment: CommentNode,
};

// Custom edge: clean by default, shows delete control on hover or when selected.
function DeletableEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, selected } = props;
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  });
  const { setEdges } = useReactFlow();
  const [hovered, setHovered] = useState(false);
  const active = hovered || selected;

  const baseStyle: CSSProperties = {
    ...style,
    stroke: active ? "var(--primary)" : (style?.stroke as string) ?? "var(--muted-foreground)",
    strokeWidth: active ? 2.5 : 1.5,
    transition: "stroke 120ms, stroke-width 120ms",
  };

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={baseStyle} />
      {/* Wide invisible hit area to make hover/click easier */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        style={{ cursor: "pointer" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      {active && (
        <EdgeLabelRenderer>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setEdges((es) => es.filter((ed) => ed.id !== id)); }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            className="nodrag nopan absolute flex items-center gap-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-medium px-2 py-0.5 shadow hover:brightness-110"
            style={{ transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`, pointerEvents: "all" }}
            aria-label="Excluir conexão"
          >
            <Trash2 className="h-3 w-3" />
            Excluir
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const edgeTypes = { deletable: DeletableEdge };

const CONNECT_MENU_KINDS: NodeKind[] = ["message", "question", "condition", "wait", "webhook", "set_status", "move_to_pipeline", "add_tag", "activecampaign", "assign_ai_agent", "assign_user", "randomizer", "send_to_blocklist", "set_variable"];

type FlowApi = {
  screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number };
  getWrapperRect: () => DOMRect | null;
};

type FlowCanvasProps = {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: any;
  onEdgesChange: any;
  onConnect: (params: Connection) => void;
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  setSelectedId: (id: string | null) => void;
  deleteSelectedMany: () => void;
  duplicateSelectedMany: () => void;
  pushHistory: () => void;
  flowApiRef: React.MutableRefObject<FlowApi | null>;
};

function FlowCanvas({
  nodes, edges, onNodesChange, onEdgesChange, onConnect,
  setNodes, setEdges, setSelectedId, deleteSelectedMany, duplicateSelectedMany, pushHistory, flowApiRef,
}: FlowCanvasProps) {
  const { screenToFlowPosition } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const connectFromRef = useRef<{ nodeId: string; handleId: string | null; handleType: string | null } | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; flowX: number; flowY: number; sourceId: string; sourceHandle: string | null } | null>(null);

  useEffect(() => {
    flowApiRef.current = {
      screenToFlowPosition,
      getWrapperRect: () => wrapperRef.current?.getBoundingClientRect() ?? null,
    };
    return () => { flowApiRef.current = null; };
  }, [screenToFlowPosition, flowApiRef]);

  const selectedCount = nodes.filter((n) => n.selected).length;

  const handleConnectStart = useCallback((_: any, params: { nodeId: string | null; handleId: string | null; handleType: string | null }) => {
    if (!params.nodeId || params.handleType !== "source") {
      connectFromRef.current = null;
      return;
    }
    connectFromRef.current = { nodeId: params.nodeId, handleId: params.handleId, handleType: params.handleType };
    setIsConnecting(true);
  }, []);

  const handleConnectEnd = useCallback((event: MouseEvent | TouchEvent) => {
    const from = connectFromRef.current;
    connectFromRef.current = null;
    setIsConnecting(false);
    if (!from) return;
    const target = (event as any).target as HTMLElement | null;
    // If dropped on a valid handle or node, ReactFlow handled the connection itself.
    const droppedOnPane = !!target?.classList?.contains("react-flow__pane");
    if (!droppedOnPane) return;

    const clientX = "clientX" in event ? (event as MouseEvent).clientX : (event as TouchEvent).changedTouches[0].clientX;
    const clientY = "clientY" in event ? (event as MouseEvent).clientY : (event as TouchEvent).changedTouches[0].clientY;
    const wrapper = wrapperRef.current?.getBoundingClientRect();
    const flow = screenToFlowPosition({ x: clientX, y: clientY });
    setMenu({
      x: clientX - (wrapper?.left ?? 0),
      y: clientY - (wrapper?.top ?? 0),
      flowX: flow.x,
      flowY: flow.y,
      sourceId: from.nodeId,
      sourceHandle: from.handleId,
    });
  }, [screenToFlowPosition]);

  const createNodeFromMenu = useCallback((kind: NodeKind) => {
    if (!menu) return;
    pushHistory();
    const newId = `${kind}-${Date.now()}`;
    const newNode: Node = {
      id: newId,
      type: kind,
      position: { x: menu.flowX, y: menu.flowY },
      data: defaultDataFor(kind),
    };
    setNodes((nds) => [...nds, newNode]);
    setEdges((eds) => addEdge(
      { source: menu.sourceId, sourceHandle: menu.sourceHandle, target: newId, targetHandle: null, type: "deletable", animated: true } as Connection,
      eds,
    ));
    setSelectedId(newId);
    setMenu(null);
  }, [menu, setNodes, setEdges, setSelectedId, pushHistory]);

  return (
    <div ref={wrapperRef} className={`relative w-full h-full flow-canvas ${isConnecting ? "is-connecting" : ""}`}>
      <style>{`
        .flow-canvas .react-flow__handle {
          width: 12px !important;
          height: 12px !important;
          border: 2px solid #ffffff !important;
          background: #1f2937 !important;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
          transition: transform 120ms ease, box-shadow 120ms ease;
        }
        .flow-canvas .react-flow__handle::before {
          content: "";
          position: absolute;
          inset: -8px;
          border-radius: 9999px;
        }
        .flow-canvas .react-flow__handle:hover {
          transform: scale(1.25);
          box-shadow: 0 0 0 4px hsl(var(--primary) / 0.25);
          cursor: crosshair;
        }
        .flow-canvas .react-flow__handle.connectionindicator { cursor: crosshair; }
        .flow-canvas.is-connecting .react-flow__handle[data-handletype="target"] {
          transform: scale(1.2);
          box-shadow: 0 0 0 4px hsl(var(--primary) / 0.35);
          animation: handle-pulse 1.2s ease-in-out infinite;
        }
        @keyframes handle-pulse {
          0%, 100% { box-shadow: 0 0 0 4px hsl(var(--primary) / 0.35); }
          50% { box-shadow: 0 0 0 8px hsl(var(--primary) / 0.15); }
        }
      `}</style>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={handleConnectStart}
        onConnectEnd={handleConnectEnd}
        onNodeClick={(_, n) => setSelectedId(n.id)}
        onNodeDragStart={() => pushHistory()}
        onBeforeDelete={async () => { pushHistory(); return true; }}
        onPaneClick={() => { setSelectedId(null); setMenu(null); }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{ type: "deletable", animated: true }}
        deleteKeyCode={["Backspace", "Delete"]}
        selectionOnDrag
        panOnDrag={[1, 2]}
        selectNodesOnDrag={false}
        selectionMode={SelectionMode.Partial}
        multiSelectionKeyCode={["Meta", "Control", "Shift"]}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>

      {selectedCount > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 rounded-full border bg-popover px-3 py-1.5 shadow-md">
          <span className="text-xs text-muted-foreground">{selectedCount} nós selecionados</span>
          <Button size="sm" variant="outline" className="h-7" onClick={duplicateSelectedMany}>
            <Copy className="h-3.5 w-3.5 mr-1" /> Duplicar seleção
          </Button>
          <Button size="sm" variant="destructive" className="h-7" onClick={deleteSelectedMany}>
            <Trash2 className="h-3.5 w-3.5 mr-1" /> Excluir seleção
          </Button>
        </div>
      )}

      {menu && (
        <div
          className="absolute z-20 w-56 rounded-md border bg-popover shadow-lg"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-2 py-1.5 border-b">
            <span className="text-xs font-medium text-muted-foreground">Adicionar nó</span>
            <button
              type="button"
              onClick={() => setMenu(null)}
              className="rounded p-0.5 hover:bg-muted"
              title="Fechar"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="max-h-72 overflow-auto py-1">
            {CONNECT_MENU_KINDS.map((k) => {
              const meta = NODE_META[k];
              const Icon = meta.icon;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => createNodeFromMenu(k)}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  <span className={`flex h-7 w-7 items-center justify-center rounded-md ${meta.tone}`}>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  {meta.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}



function AutomationEditor() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [brandId, setBrandId] = useState<string>("");
  const [status, setStatus] = useState<"draft" | "active" | "inactive">("draft");
  const [triggerTag, setTriggerTag] = useState<string>("");
  const [triggerType, setTriggerType] = useState<string>("tag");
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);



  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("automations")
        .select("*")
        .eq("id", id)
        .single();
      if (error) { toast.error(error.message); return; }
      setName(data.name);
      setBrandId(data.brand_id);
      setStatus(data.status);
      setTriggerTag((data as any).trigger_tag ?? "");
      setTriggerType(((data as any).trigger_type ?? "tag") as string);
      const g = (data.graph as any) ?? { nodes: [], edges: [] };
      const tCfg = ((data as any).trigger_config ?? {}) as any;
      const tType = (data as any).trigger_type ?? "tag";
      const hasTrigger = (g.nodes ?? []).some((n: any) => n.type === "trigger");
      const initialEvents: string[] = Array.isArray(tCfg.events)
        ? tCfg.events.filter(Boolean)
        : (tCfg.event ? [tCfg.event] : []);
      const initialNodes = hasTrigger ? (g.nodes ?? []).map((n: any) => {
        if (n.type !== "trigger") return n;
        return {
          ...n,
          data: {
            ...(n.data ?? {}),
            productNames: (n.data?.productNames && typeof n.data.productNames === "object")
              ? n.data.productNames
              : (tCfg.product_names ?? {}),
          },
        };
      }) : [
        {
          id: "trigger-1", type: "trigger", position: { x: 100, y: 100 },
          data: {
            tag: (data as any).trigger_tag ?? "",
            triggerType: tType,
            accountId: tCfg.account_id ?? null,
            productIds: Array.isArray(tCfg.product_ids) && tCfg.product_ids.length
              ? tCfg.product_ids.map((x: any) => String(x))
              : (tCfg.product_id ? [String(tCfg.product_id)] : []),
            productNames: tCfg.product_names ?? {},
            triggerEvents: initialEvents,
          },
        },
      ];
      const initialEdges = (g.edges ?? []).map((e: any) => ({ ...e, type: "deletable" }));
      setNodes(initialNodes);
      setEdges(initialEdges);
      setLoading(false);
    })();
  }, [id]);

  const templatesQ = useQuery({
    queryKey: ["templates-for-automation", brandId],
    enabled: !!brandId,
    queryFn: async () => {
      const { data } = await supabase
        .from("whatsapp_templates")
        .select("id, name, language, status, components, header_type, header_media_url, header_media_filename, header_media_mime")
        .eq("brand_id", brandId)
        .order("name");
      return data ?? [];
    },
  });

  type Snapshot = { nodes: Node[]; edges: Edge[] };
  const undoRef = useRef<Snapshot[]>([]);
  const redoRef = useRef<Snapshot[]>([]);
  const clipboardRef = useRef<{ nodes: Node[]; edges: Edge[] } | null>(null);
  const dataDirtyForSelRef = useRef<string | null>(null);
  const HISTORY_LIMIT = 10;

  const pushHistory = useCallback(() => {
    const snap: Snapshot = {
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges)),
    };
    undoRef.current.push(snap);
    if (undoRef.current.length > HISTORY_LIMIT) undoRef.current.shift();
    redoRef.current = [];
  }, [nodes, edges]);

  const handleUndo = useCallback(() => {
    const prev = undoRef.current.pop();
    if (!prev) return;
    redoRef.current.push({
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges)),
    });
    if (redoRef.current.length > HISTORY_LIMIT) redoRef.current.shift();
    setNodes(prev.nodes);
    setEdges(prev.edges);
    setSelectedId(null);
    dataDirtyForSelRef.current = null;
  }, [nodes, edges, setNodes, setEdges]);

  const handleRedo = useCallback(() => {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push({
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges)),
    });
    if (undoRef.current.length > HISTORY_LIMIT) undoRef.current.shift();
    setNodes(next.nodes);
    setEdges(next.edges);
    setSelectedId(null);
    dataDirtyForSelRef.current = null;
  }, [nodes, edges, setNodes, setEdges]);

  const onConnect = useCallback(
    (params: Connection) => {
      pushHistory();
      setEdges((eds) => addEdge({ ...params, type: "deletable", animated: true }, eds));
    },
    [setEdges, pushHistory]
  );

  const flowApiRef = useRef<FlowApi | null>(null);

  const addNode = (kind: NodeKind) => {
    if (kind === "trigger") return;
    pushHistory();
    const newId = `${kind}-${Date.now()}`;
    const api = flowApiRef.current;
    const rect = api?.getWrapperRect();
    let pos: { x: number; y: number };
    if (api && rect && rect.width > 0 && rect.height > 0) {
      const center = api.screenToFlowPosition({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      });
      const offset = (nodes.length % 5) * 24;
      // Center node visually (default node width ~ 280, header ~ 40)
      pos = { x: center.x - 140 + offset, y: center.y - 40 + offset };
    } else {
      const baseY = 100 + nodes.length * 40;
      pos = { x: 350, y: baseY };
    }
    setNodes((nds) => [
      ...nds.map((n) => ({ ...n, selected: false })),
      { id: newId, type: kind, position: pos, data: defaultDataFor(kind), selected: true },
    ]);
    setSelectedId(newId);
  };


  const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedId) ?? null, [nodes, selectedId]);

  useEffect(() => {
    dataDirtyForSelRef.current = null;
  }, [selectedId]);

  const updateSelected = (patch: Record<string, any>) => {
    if (!selectedId) return;
    if (dataDirtyForSelRef.current !== selectedId) {
      pushHistory();
      dataDirtyForSelRef.current = selectedId;
    }
    setNodes((nds) => nds.map((n) => (n.id === selectedId ? { ...n, data: { ...n.data, ...patch } } : n)));
  };

  const deleteNodeById = useCallback((nid: string) => {
    const target = nodes.find((n) => n.id === nid);
    if (!target || target.type === "trigger") return;
    pushHistory();
    setNodes((nds) => nds.filter((n) => n.id !== nid));
    setEdges((eds) => eds.filter((e) => e.source !== nid && e.target !== nid));
    setSelectedId((cur) => (cur === nid ? null : cur));
  }, [nodes, setNodes, setEdges, pushHistory]);

  const duplicateNodeById = useCallback((nid: string) => {
    const src = nodes.find((n) => n.id === nid);
    if (!src || src.type === "trigger") return;
    pushHistory();
    const newId = `${src.type}-${Date.now()}`;
    const clone: Node = {
      ...src,
      id: newId,
      position: { x: (src.position?.x ?? 0) + 40, y: (src.position?.y ?? 0) + 40 },
      data: JSON.parse(JSON.stringify(src.data ?? {})),
      selected: false,
    };
    setNodes((nds) => [...nds, clone]);
    setSelectedId(newId);
    toast.success("Nó duplicado");
  }, [nodes, setNodes, pushHistory]);

  const deleteSelected = () => { if (selectedId) deleteNodeById(selectedId); };
  const duplicateSelected = useCallback(() => { if (selectedId) duplicateNodeById(selectedId); }, [selectedId, duplicateNodeById]);

  const deleteSelectedMany = useCallback(() => {
    const sel = nodes.filter((n) => n.selected && n.type !== "trigger").map((n) => n.id);
    if (sel.length === 0) return;
    pushHistory();
    setNodes((nds) => nds.filter((n) => !sel.includes(n.id)));
    setEdges((eds) => eds.filter((e) => !sel.includes(e.source) && !sel.includes(e.target)));
    setSelectedId(null);
    toast.success(`${sel.length} nó(s) excluído(s)`);
  }, [nodes, setNodes, setEdges, pushHistory]);

  const duplicateSelectedMany = useCallback(() => {
    const sel = nodes.filter((n) => n.selected && n.type !== "trigger");
    if (sel.length === 0) return;
    pushHistory();
    const stamp = Date.now();
    const clones: Node[] = sel.map((src, i) => ({
      ...src,
      id: `${src.type}-${stamp}-${i}`,
      position: { x: (src.position?.x ?? 0) + 40, y: (src.position?.y ?? 0) + 40 },
      data: JSON.parse(JSON.stringify(src.data ?? {})),
      selected: false,
    }));
    setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), ...clones]);
    setSelectedId(null);
    toast.success(`${clones.length} nó(s) duplicado(s)`);
  }, [nodes, setNodes, pushHistory]);

  const handleCopy = useCallback(() => {
    const sel = nodes.filter((n) => n.selected && n.type !== "trigger");
    if (sel.length === 0) return;
    const ids = new Set(sel.map((n) => n.id));
    const innerEdges = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    clipboardRef.current = {
      nodes: JSON.parse(JSON.stringify(sel)),
      edges: JSON.parse(JSON.stringify(innerEdges)),
    };
    toast.success(`${sel.length} nó(s) copiado(s)`);
  }, [nodes, edges]);

  const handleCut = useCallback(() => {
    const sel = nodes.filter((n) => n.selected && n.type !== "trigger");
    if (sel.length === 0) return;
    const ids = new Set(sel.map((n) => n.id));
    const innerEdges = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    clipboardRef.current = {
      nodes: JSON.parse(JSON.stringify(sel)),
      edges: JSON.parse(JSON.stringify(innerEdges)),
    };
    pushHistory();
    setNodes((nds) => nds.filter((n) => !ids.has(n.id)));
    setEdges((eds) => eds.filter((e) => !ids.has(e.source) && !ids.has(e.target)));
    setSelectedId(null);
    toast.success(`${sel.length} nó(s) recortado(s)`);
  }, [nodes, edges, setNodes, setEdges, pushHistory]);

  const handlePaste = useCallback(() => {
    const clip = clipboardRef.current;
    if (!clip || clip.nodes.length === 0) return;
    pushHistory();
    const stamp = Date.now();
    const idMap = new Map<string, string>();
    const newNodes: Node[] = clip.nodes.map((n, i) => {
      const newId = `${n.type}-${stamp}-${i}`;
      idMap.set(n.id, newId);
      return {
        ...n,
        id: newId,
        position: { x: (n.position?.x ?? 0) + 40, y: (n.position?.y ?? 0) + 40 },
        data: JSON.parse(JSON.stringify(n.data ?? {})),
        selected: true,
      };
    });
    const newEdges: Edge[] = clip.edges.map((e, i) => ({
      ...e,
      id: `e-${stamp}-${i}`,
      source: idMap.get(e.source) ?? e.source,
      target: idMap.get(e.target) ?? e.target,
    }));
    setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), ...newNodes]);
    setEdges((eds) => [...eds, ...newEdges]);
    setSelectedId(null);
    toast.success(`${newNodes.length} nó(s) colado(s)`);
  }, [setNodes, setEdges, pushHistory]);

  const nodeActions = useMemo(
    () => ({ onDuplicate: duplicateNodeById, onDelete: deleteNodeById }),
    [duplicateNodeById, deleteNodeById]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      const inField = tag === "INPUT" || tag === "TEXTAREA" || !!t?.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();

      if (k === "d") {
        if (inField) return;
        const selCount = nodes.filter((n) => n.selected && n.type !== "trigger").length;
        if (selCount > 1) { e.preventDefault(); duplicateSelectedMany(); return; }
        if (!selectedId) return;
        e.preventDefault();
        duplicateSelected();
        return;
      }
      if (k === "z" && !e.shiftKey) {
        if (inField) return;
        e.preventDefault(); handleUndo(); return;
      }
      if ((k === "z" && e.shiftKey) || k === "y") {
        if (inField) return;
        e.preventDefault(); handleRedo(); return;
      }
      if (k === "c") {
        if (inField) return;
        const selCount = nodes.filter((n) => n.selected && n.type !== "trigger").length;
        if (selCount === 0) return;
        e.preventDefault(); handleCopy(); return;
      }
      if (k === "x") {
        if (inField) return;
        const selCount = nodes.filter((n) => n.selected && n.type !== "trigger").length;
        if (selCount === 0) return;
        e.preventDefault(); handleCut(); return;
      }
      if (k === "v") {
        if (inField) return;
        if (!clipboardRef.current) return;
        e.preventDefault(); handlePaste(); return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, duplicateSelected, duplicateSelectedMany, handleUndo, handleRedo, handleCopy, handleCut, handlePaste, nodes]);

  const save = async () => {
    setSaving(true);
    const triggerNode = nodes.find((n) => n.type === "trigger");
    const td = (triggerNode?.data as any) ?? {};
    const tType = (td.triggerType ?? "tag") as string;
    const tag = tType === "tag" ? (((td.tag ?? "").toString().trim()) || null) : null;
    const isIntegration = ["shopify", "hotmart", "sendflow", "activecampaign"].includes(tType);
    const events: string[] = Array.isArray(td.triggerEvents)
      ? td.triggerEvents.filter(Boolean)
      : (td.triggerEvent ? [td.triggerEvent] : []);
    const productIds: string[] = Array.isArray(td.productIds)
      ? td.productIds.filter(Boolean).map((x: any) => String(x))
      : (td.productId ? [String(td.productId)] : []);
    const productNames = (td.productNames && typeof td.productNames === "object") ? td.productNames : {};
    const triggerConfig = isIntegration
      ? { account_id: td.accountId ?? null, product_ids: productIds, product_id: productIds[0] ?? null, product_names: productNames, events, event: events[0] ?? null }
      : {};
    const { error } = await supabase
      .from("automations")
      .update({
        name,
        status,
        trigger_type: tType,
        trigger_tag: tag,
        trigger_config: triggerConfig,
        graph: { nodes, edges } as any,
      } as any)
      .eq("id", id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Fluxo salvo");
    setTriggerTag(tag ?? "");
    setTriggerType(tType as any);
  };

  if (loading) return <div className="p-6 flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</div>;

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)]">
      <div className="flex items-center gap-3 border-b px-4 py-2 bg-card">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/admin/automacoes" })}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Input className="max-w-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do fluxo" />
        <Badge variant={status === "active" ? "default" : "secondary"}>
          {status === "active" ? "Ativo" : status === "inactive" ? "Inativo" : "Rascunho"}
        </Badge>
        <div className="flex items-center gap-2 ml-2">
          <Switch checked={status === "active"} onCheckedChange={(v) => setStatus(v ? "active" : "inactive")} />
          <span className="text-xs text-muted-foreground">Ativar</span>
        </div>
        {triggerTag && <Badge variant="outline" className="ml-2"><Tag className="h-3 w-3 mr-1" />{triggerTag}</Badge>}
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)}>
          <History className="h-4 w-4 mr-1" /> Histórico
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
          Salvar
        </Button>
      </div>

      <AutomationHistorySheet open={historyOpen} onOpenChange={setHistoryOpen} automationId={id} />


      <div className="flex-1 grid grid-cols-[200px_1fr_340px] overflow-hidden">
        <aside className="border-r p-3 space-y-2 bg-muted/30 overflow-y-auto">
          <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">Adicionar nó</div>
          {(["message", "question", "condition", "wait", "webhook", "set_status", "move_to_pipeline", "add_tag", "activecampaign", "assign_ai_agent", "assign_user", "randomizer", "send_to_blocklist", "set_variable"] as NodeKind[]).map((k) => {
            const meta = NODE_META[k];
            const Icon = meta.icon;
            return (
              <Button key={k} variant="outline" className="w-full justify-start gap-2 px-2" size="sm" onClick={() => addNode(k)}>
                <span className={`flex h-6 w-6 items-center justify-center rounded-md ${meta.tone}`}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                {meta.label}
              </Button>
            );
          })}
          <div className="pt-3 text-[11px] text-muted-foreground space-y-1">
            <div>Arraste no canvas para selecionar vários nós. Segure Shift/Ctrl/⌘ para somar à seleção.</div>
            <div>Clique no <span className="text-destructive font-bold">×</span> de uma conexão para excluí-la, ou pressione Delete.</div>
            <div>Solte uma conexão no vazio para escolher o próximo nó.</div>
          </div>

          <div className="pt-4 text-xs font-semibold uppercase text-muted-foreground mb-2">Anotações</div>
          <Button
            variant="outline"
            className="w-full justify-start gap-2 px-2 border-amber-400/60 bg-amber-50 hover:bg-amber-100 text-amber-900"
            size="sm"
            onClick={() => addNode("comment")}
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-200 text-amber-800">
              <StickyNote className="h-3.5 w-3.5" />
            </span>
            Comentário
          </Button>
          <div className="pt-1 text-[11px] text-muted-foreground">
            Post-it visual para documentar o fluxo. Não é executado nem conecta a outros nós.
          </div>
        </aside>

        <div className="relative">
          <TemplatesContext.Provider value={templatesQ.data ?? []}>
          <NodeActionsContext.Provider value={nodeActions}>
          <ReactFlowProvider>
            <FlowCanvas
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              setNodes={setNodes}
              setEdges={setEdges}
              setSelectedId={setSelectedId}
              deleteSelectedMany={deleteSelectedMany}
              duplicateSelectedMany={duplicateSelectedMany}
              pushHistory={pushHistory}
              flowApiRef={flowApiRef}
            />
          </ReactFlowProvider>
          </NodeActionsContext.Provider>

          </TemplatesContext.Provider>
        </div>

        <aside className="border-l p-4 overflow-y-auto bg-card">
          {!selectedNode ? (
            <div className="text-sm text-muted-foreground">
              Selecione um nó no canvas para editar suas propriedades.
            </div>
          ) : (
            <NodeProperties
              node={selectedNode}
              templates={templatesQ.data ?? []}
              onChange={updateSelected}
              onDelete={deleteSelected}
              onDuplicate={duplicateSelected}
              automationId={id}
              brandId={brandId}
              triggerType={(nodes.find((n) => n.type === "trigger")?.data as any)?.triggerType ?? "tag"}
              automationStatus={status}
              automationName={name}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

function defaultDataFor(kind: NodeKind): Record<string, any> {
  switch (kind) {
    case "trigger":   return { triggerType: "tag", tag: "" };
    case "message":   return { mode: "text", text: "Olá! Como posso ajudar?" };
    case "question":  return { mode: "text", text: "Qual é a sua resposta?", timeoutMinutes: 1440, saveAs: "" };
    case "wait":      return { mode: "duration", amount: 5, unit: "minutes" };
    case "condition": return { kind: "has_tag", tag: "", pipelineId: "", stageId: "", pipelineName: "", stageName: "", field: { source: "contact", key: "name", type: "text" }, operator: "is", value: "", caseSensitive: false };
    case "webhook":   return { method: "POST", url: "", headers: "", payload: '{\n  "conversation_id": "{{conversation_id}}"\n}' };
    case "set_status": return { status: "resolvido" };
    case "move_to_pipeline": return { action: "move", pipelineId: "", stageId: "", pipelineName: "", stageName: "" };
    case "activecampaign": return { accountId: "", accountName: "", action: "add_tag", itemId: "", itemName: "", value: "" };
    case "add_tag": return { tags: [], op: "add" };
    case "assign_ai_agent": return { agentId: "", agentName: "", agentStatus: "" };
    case "assign_user": return { userId: "", userName: "" };
    case "randomizer": return { paths: [{ label: "A", weight: 50 }, { label: "B", weight: 50 }] };
    case "send_to_blocklist": return { channels: ["phone", "email"], reason: "" };
    case "set_variable": return { name: "", value: "" };
    case "comment": return { text: "" };
    default: return {};
  }
}

function VariableNameCombobox({
  value, onChange, triggerType, brandId,
}: { value: string; onChange: (v: string) => void; triggerType: string; brandId: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const baseGroups = useMemo(() => getAllVariableGroups(), []);
  const customQ = useQuery({
    queryKey: ["custom-fields-varname", brandId],
    enabled: !!brandId && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("custom_fields")
        .select("key, label")
        .eq("brand_id", brandId)
        .order("label");
      if (error) throw error;
      return data ?? [];
    },
  });
  const groups = useMemo(() => {
    const all = [...baseGroups];
    if (customQ.data && customQ.data.length > 0) {
      all.push({
        label: "Campos personalizados",
        items: customQ.data.map((f: any) => ({ key: `custom.${f.key}`, label: f.label })),
      });
    }
    return all;
  }, [baseGroups, customQ.data]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return groups;
    return groups
      .map((g) => ({ ...g, items: g.items.filter((it) => it.key.toLowerCase().includes(needle) || it.label.toLowerCase().includes(needle)) }))
      .filter((g) => g.items.length > 0);
  }, [groups, q]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="w-full justify-between font-normal">
          <span className="truncate">{value || "Escolher ou digitar..."}</span>
          <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
        <div className="border-b p-2 space-y-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar ou digitar nome novo..."
            className="h-8"
            autoFocus
          />
          {q.trim() && (
            <Button
              type="button" size="sm" variant="secondary" className="w-full h-7 text-xs"
              onClick={() => { onChange(q.trim()); setOpen(false); setQ(""); }}
            >
              Usar "{q.trim()}"
            </Button>
          )}
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground">Nenhuma variável.</div>
          ) : filtered.map((g) => (
            <div key={g.label} className="mb-2">
              <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">{g.label}</div>
              {g.items.map((it) => (
                <button
                  key={it.key}
                  type="button"
                  onClick={() => { onChange(it.key); setOpen(false); setQ(""); }}
                  className="flex w-full flex-col items-start rounded px-2 py-1.5 text-left hover:bg-accent"
                >
                  <code className="text-[11px] text-primary">{it.key}</code>
                  <span className="text-[11px] text-muted-foreground">{it.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NodeProperties({
  node, templates, onChange, onDelete, onDuplicate, automationId, brandId, triggerType, automationStatus, automationName,
}: {
  node: Node;
  templates: any[];
  onChange: (patch: Record<string, any>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  automationId: string;
  brandId: string;
  triggerType: string;
  automationStatus?: string;
  automationName?: string;
}) {
  const kind = node.type as NodeKind;
  const d = node.data as any;
  const meta = NODE_META[kind];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">{meta.label}</div>
        {kind !== "trigger" && (
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" onClick={onDuplicate} title="Duplicar (Ctrl+D)">
              <Copy className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={onDelete} title="Excluir">
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        )}
      </div>

      {kind === "trigger" && (
        <TriggerProperties d={d} onChange={onChange} automationId={automationId} brandId={brandId} automationStatus={automationStatus} automationName={automationName} />
      )}

      {kind === "message" && (
        <>
          <div className="space-y-2">
            <Label>Modo</Label>
            <SearchableSelect
              value={d.mode ?? "text"}
              onValueChange={(v) => onChange({ mode: v, buttons: [] })}
              options={[
                { value: "text", label: "Texto livre (apenas se janela 24h aberta)" },
                { value: "template", label: "Template (HSM)" },
              ]}
            />
          </div>

          {d.mode === "template" ? (
            <MessageTemplateProperties d={d} templates={templates} onChange={onChange} brandId={brandId} triggerType={triggerType} />
          ) : (
            <>
              <FreeformMediaEditor d={d} onChange={onChange} brandId={brandId} />
              <div className="space-y-2">
                <Label>{d.mediaUrl ? "Legenda (opcional)" : "Texto da mensagem"}</Label>
                <VarTextarea
                  rows={6}
                  value={d.text ?? ""}
                  onChange={(v) => onChange({ text: v })}
                  placeholder={d.mediaUrl ? "Texto opcional que aparece junto da mídia" : "Digite a mensagem que será enviada"}
                  triggerType={triggerType}
                />
                <p className="text-xs text-muted-foreground">
                  Use o botão <code>{"{ }"}</code> ao lado para inserir variáveis sem erros.
                </p>
              </div>
              {!d.mediaUrl && <QuickReplyButtonsEditor d={d} onChange={onChange} />}
              {d.mediaUrl && (
                <p className="text-[11px] text-muted-foreground">
                  Botões de resposta rápida não são compatíveis com envio de mídia em texto livre. Use um Template HSM se precisar combinar botões com mídia.
                </p>
              )}
            </>
          )}
        </>
      )}


      {kind === "question" && (
        <>
          <div className="space-y-2">
            <Label>Modo da mensagem</Label>
            <SearchableSelect
              value={d.mode ?? "text"}
              onValueChange={(v) => onChange({ mode: v })}
              options={[
                { value: "text", label: "Texto livre (apenas se janela 24h aberta)" },
                { value: "template", label: "Template (HSM)" },
              ]}
            />
          </div>

          {d.mode === "template" ? (
            <MessageTemplateProperties d={d} templates={templates} onChange={onChange} brandId={brandId} triggerType={triggerType} />
          ) : (
            <>
              <FreeformMediaEditor d={d} onChange={onChange} brandId={brandId} />
              <div className="space-y-2">
                <Label>{d.mediaUrl ? "Legenda da pergunta (opcional)" : "Pergunta"}</Label>
                <VarTextarea
                  rows={5}
                  value={d.text ?? ""}
                  onChange={(v) => onChange({ text: v })}
                  placeholder={d.mediaUrl ? "Texto opcional que aparece junto da mídia" : "Digite a pergunta que será enviada"}
                  triggerType={triggerType}
                />
              </div>
              {!d.mediaUrl && <QuickReplyButtonsEditor d={d} onChange={onChange} />}
              {d.mediaUrl && (
                <p className="text-[11px] text-muted-foreground">
                  Botões de resposta rápida não são compatíveis com envio de mídia em texto livre. Use um Template HSM se precisar combinar botões com mídia.
                </p>
              )}
            </>
          )}


          <div className="space-y-2 rounded-md border p-3">
            <div className="flex items-center justify-between gap-2">
              <Label className="cursor-pointer" htmlFor="q-saveas-toggle">Salvar resposta em variável</Label>
              <Switch
                id="q-saveas-toggle"
                checked={!!d.saveAs}
                onCheckedChange={(v) => onChange({ saveAs: v ? (d.saveAs || "resposta") : "" })}
              />
            </div>
            {d.saveAs ? (
              <>
                <Input
                  value={d.saveAs ?? ""}
                  onChange={(e) => onChange({ saveAs: e.target.value.replace(/[^a-zA-Z0-9_]/g, "") })}
                  placeholder="ex: resposta_email"
                />
                <p className="text-xs text-muted-foreground">
                  Use <code>{`{{${d.saveAs || "variavel"}}}`}</code> nos próximos nós para referenciar a resposta.
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Desligado: o fluxo apenas destrava quando o contato responder, sem salvar o conteúdo.
              </p>
            )}
          </div>

          <QuestionSaveToFieldEditor d={d} onChange={onChange} brandId={brandId} />

          <div className="space-y-2">
            <Label>Timeout (minutos)</Label>
            <Input
              type="number"
              min={1}
              max={10080}
              value={d.timeoutMinutes ?? 1440}
              onChange={(e) => onChange({ timeoutMinutes: Math.max(1, Number(e.target.value) || 1440) })}
            />
            <p className="text-xs text-muted-foreground">
              Após esse tempo sem resposta, o fluxo segue pela saída "Sem resposta".
            </p>
          </div>
        </>
      )}


      {kind === "condition" && (
        <>
          <div className="space-y-2">
            <Label>Tipo de condição</Label>
            <SearchableSelect
              value={d.kind ?? "has_tag"}
              onValueChange={(v) => onChange({ kind: v })}
              options={[
                { value: "has_tag", label: "Contato tem tag" },
                { value: "in_pipeline", label: "Está no pipeline" },
                { value: "in_window", label: "Janela 24h aberta" },
                { value: "field", label: "Campo do contato" },
                { value: "is_blocklisted", label: "Está no blocklist?" },
              ]}
            />
          </div>
          {d.kind === "has_tag" && (
            <div className="space-y-2">
              <Label>Tag</Label>
              <TagAutocomplete brandId={brandId} value={d.tag ?? ""} onChange={(v) => onChange({ tag: v })} placeholder="ex: cliente-vip" />
            </div>
          )}
          {d.kind === "in_pipeline" && (
            <PipelineStagePicker
              d={d}
              onChange={onChange}
              brandId={brandId}
              stageOptional
            />
          )}
          {d.kind === "field" && (
            <FieldConditionEditor d={d} onChange={onChange} brandId={brandId} triggerType={triggerType} />
          )}
          {d.kind === "in_window" ? (
            <div className="text-xs text-muted-foreground space-y-1 rounded-md border p-2">
              <div><strong className="text-emerald-600">Sim</strong>: contato enviou mensagem nas últimas 24h (pode receber texto livre).</div>
              <div><strong className="text-rose-600">Não</strong>: janela expirada <em>ou</em> contato nunca interagiu (precisa de template).</div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Conecte os handles "Sim" e "Não" para ramificar o fluxo.
            </p>
          )}
        </>
      )}

      {kind === "wait" && (
        <>
          <div className="space-y-2">
            <Label>Tipo de espera</Label>
            <SearchableSelect
              value={d.mode ?? "duration"}
              onValueChange={(v) => onChange({ mode: v })}
              options={[
                { value: "duration", label: "Tempo corrido" },
                { value: "until_date", label: "Até data específica" },
                { value: "inbound", label: "Aguardar resposta do contato" },
              ]}
            />
          </div>

          {d.mode === "duration" && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Quantidade</Label>
                <Input type="number" min={1} value={d.amount ?? 5} onChange={(e) => onChange({ amount: Number(e.target.value) })} />
              </div>
              <div>
                <Label>Unidade</Label>
                <SearchableSelect
                  value={d.unit ?? "minutes"}
                  onValueChange={(v) => onChange({ unit: v })}
                  options={[
                    { value: "minutes", label: "Minutos" },
                    { value: "hours", label: "Horas" },
                    { value: "days", label: "Dias" },
                  ]}
                />
              </div>
            </div>
          )}

          {d.mode === "until_date" && (
            <div className="space-y-2">
              <Label>Data e hora</Label>
              <Input
                type="datetime-local"
                value={d.date ?? ""}
                onChange={(e) => onChange({ date: e.target.value })}
              />
            </div>
          )}

          {d.mode === "inbound" && (
            <div className="space-y-2">
              <Label>Timeout (horas)</Label>
              <Input type="number" min={1} max={168} value={d.timeoutHours ?? 24}
                onChange={(e) => onChange({ timeoutHours: Number(e.target.value) })} />
            </div>
          )}
        </>
      )}

      {kind === "webhook" && (
        <>
          <div className="space-y-2">
            <Label>Método</Label>
            <SearchableSelect
              value={d.method ?? "POST"}
              onValueChange={(v) => onChange({ method: v })}
              options={[
                { value: "POST", label: "POST" },
                { value: "GET", label: "GET" },
                { value: "PUT", label: "PUT" },
              ]}
            />
          </div>
          <div className="space-y-2">
            <Label>URL</Label>
            <VarInput
              value={d.url ?? ""}
              onChange={(v) => onChange({ url: v })}
              placeholder="https://exemplo.com/webhook"
              triggerType={triggerType}
            />
          </div>
          <div className="space-y-2">
            <Label>Cabeçalhos (JSON)</Label>
            <VarTextarea
              rows={3}
              value={d.headers ?? ""}
              onChange={(v) => onChange({ headers: v })}
              placeholder='{"Authorization": "Bearer ..."}'
              className="font-mono text-xs"
              triggerType={triggerType}
            />
          </div>
          <div className="space-y-2">
            <Label>Payload (JSON)</Label>
            <VarTextarea
              rows={6}
              value={d.payload ?? ""}
              onChange={(v) => onChange({ payload: v })}
              className="font-mono text-xs"
              triggerType={triggerType}
            />
            <p className="text-xs text-muted-foreground">
              Use o botão <code>{"{ }"}</code> ao lado de cada campo para inserir variáveis disponíveis no gatilho.
            </p>
          </div>
        </>
      )}
      {kind === "set_status" && (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Novo status da conversa</Label>
            <SearchableSelect
              value={d.status ?? "resolvido"}
              onValueChange={(v) => onChange({ status: v })}
              options={[
                { value: "aberto", label: "🔵 Aberto" },
                { value: "pendente", label: "🟡 Pendente" },
                { value: "resolvido", label: "🟢 Resolvido" },
              ]}
            />
            <p className="text-xs text-muted-foreground">
              Quando o fluxo passar por este nó, a conversa atual terá o status atualizado.
            </p>
          </div>
          {(d.status ?? "resolvido") === "resolvido" && (
            <div className="flex items-start justify-between gap-3 rounded-md border p-3">
              <div className="space-y-0.5">
                <Label className="text-sm">Resolver cards de pipeline</Label>
                <p className="text-xs text-muted-foreground">
                  Quando ativado, ao resolver a conversa os cards de pipeline abertos deste contato também serão marcados como resolvidos.
                </p>
              </div>
              <Switch
                checked={d.resolve_pipeline_cards === true}
                onCheckedChange={(v) => onChange({ resolve_pipeline_cards: v === true })}
              />
            </div>
          )}

        </div>
      )}

      {kind === "move_to_pipeline" && (
        <MoveToPipelineProperties d={d} onChange={onChange} brandId={brandId} />
      )}
      {kind === "activecampaign" && (
        <ActiveCampaignProperties d={d} onChange={onChange} brandId={brandId} triggerType={triggerType} />
      )}
      {kind === "add_tag" && (
        <AddTagProperties d={d} onChange={onChange} triggerType={triggerType} brandId={brandId} />
      )}
      {kind === "assign_ai_agent" && (
        <AssignAIAgentProperties d={d} onChange={onChange} brandId={brandId} />
      )}
      {kind === "assign_user" && (
        <AssignUserProperties d={d} onChange={onChange} brandId={brandId} />
      )}
      {kind === "randomizer" && (
        <RandomizerProperties d={d} onChange={onChange} />
      )}
      {kind === "send_to_blocklist" && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Adiciona o contato ao blocklist do workspace. Envios futuros para esse telefone/email serão bloqueados.
          </p>
          <div className="space-y-2">
            <Label>Canais a bloquear</Label>
            {(["phone", "email"] as const).map((ch) => {
              const channels: string[] = Array.isArray(d.channels) ? d.channels : ["phone", "email"];
              const checked = channels.includes(ch);
              return (
                <label key={ch} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? Array.from(new Set([...channels, ch]))
                        : channels.filter((c) => c !== ch);
                      onChange({ channels: next });
                    }}
                  />
                  {ch === "phone" ? "Telefone" : "Email"}
                </label>
              );
            })}
          </div>
          <div className="space-y-2">
            <Label>Motivo (opcional)</Label>
            <Input
              value={d.reason ?? ""}
              onChange={(e) => onChange({ reason: e.target.value })}
              placeholder="ex: spam, opt-out"
              maxLength={500}
            />
          </div>
        </div>
      )}
      {kind === "set_variable" && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Cria ou atualiza uma variável da automação. Use <code>{`{{nome}}`}</code> em nós seguintes para referenciar.
          </p>
          <div className="space-y-2">
            <Label>Nome da variável</Label>
            <VariableNameCombobox
              value={d.name ?? ""}
              onChange={(v) => onChange({ name: v.replace(/[^a-zA-Z0-9_.]/g, "").slice(0, 80) })}
              triggerType={triggerType}
              brandId={brandId}
            />
            <p className="text-[10px] text-muted-foreground">Escolha um campo existente ou digite um nome novo (letras, números e <code>_</code>).</p>
          </div>
          <div className="space-y-2">
            <Label>Valor</Label>
            <VarTextarea
              value={d.value ?? ""}
              onChange={(v) => onChange({ value: v })}
              placeholder='ex: {{contact_name}} - VIP'
              triggerType={triggerType}
              rows={3}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function RandomizerProperties({
  d, onChange,
}: { d: any; onChange: (p: Record<string, any>) => void }) {
  const paths: { label?: string; weight?: number }[] = Array.isArray(d.paths) && d.paths.length >= 2
    ? d.paths
    : [{ label: "A", weight: 50 }, { label: "B", weight: 50 }];
  const total = paths.reduce((s, p) => s + Math.max(0, Number(p.weight) || 0), 0);

  const updatePath = (i: number, patch: Partial<{ label: string; weight: number }>) => {
    const next = paths.map((p, idx) => (idx === i ? { ...p, ...patch } : p));
    onChange({ paths: next });
  };
  const addPath = () => {
    if (paths.length >= 5) return;
    const letter = String.fromCharCode(65 + paths.length);
    onChange({ paths: [...paths, { label: letter, weight: 25 }] });
  };
  const removePath = (i: number) => {
    if (paths.length <= 2) return;
    onChange({ paths: paths.filter((_, idx) => idx !== i) });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        A cada execução, sorteia um caminho proporcional aos pesos. Conecte cada saída ao próximo passo.
      </p>
      <div className="space-y-2">
        {paths.map((p, i) => {
          const w = Math.max(0, Number(p.weight) || 0);
          const pct = total > 0 ? Math.round((w / total) * 100) : 0;
          return (
            <div key={i} className="flex items-end gap-2">
              <div className="flex-1">
                <Label className="text-xs">Rótulo</Label>
                <Input
                  value={p.label ?? ""}
                  onChange={(e) => updatePath(i, { label: e.target.value })}
                  placeholder={String.fromCharCode(65 + i)}
                />
              </div>
              <div className="w-20">
                <Label className="text-xs">Peso</Label>
                <Input
                  type="number"
                  min={0}
                  value={w}
                  onChange={(e) => updatePath(i, { weight: Number(e.target.value) })}
                />
              </div>
              <div className="w-12 text-center text-xs text-muted-foreground pb-2">{pct}%</div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => removePath(i)}
                disabled={paths.length <= 2}
                title="Remover caminho"
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          );
        })}
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={addPath}
        disabled={paths.length >= 5}
        className="w-full"
      >
        <Plus className="h-4 w-4 mr-1" />
        Adicionar caminho ({paths.length}/5)
      </Button>
      <p className="text-[11px] text-muted-foreground">
        Cada execução é independente — o mesmo contato pode cair em caminhos diferentes em execuções distintas.
      </p>
    </div>
  );
}

function AssignAIAgentProperties({
  d, onChange, brandId,
}: { d: any; onChange: (p: Record<string, any>) => void; brandId: string }) {
  const agentsQ = useQuery({
    queryKey: ["ai-agents-for-brand", brandId],
    enabled: !!brandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_agents")
        .select("id, name, status, whitelist")
        .eq("brand_id", brandId)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const agents = agentsQ.data ?? [];
  const selected = agents.find((a: any) => a.id === d.agentId) as any;
  const wl: string[] = Array.isArray(selected?.whitelist) ? selected.whitelist : [];

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>Agente</Label>
        <SearchableSelect
          value={d.agentId || undefined}
          onValueChange={(v) => {
            const a = agents.find((x: any) => x.id === v) as any;
            onChange({ agentId: v, agentName: a?.name ?? "", agentStatus: a?.status ?? "" });
          }}
          placeholder={agentsQ.isLoading ? "Carregando..." : "Selecione o agente"}
          options={agents.map((a: any) => ({
            value: a.id,
            label: `${a.name} ${a.status === "on" ? "· Ativo" : a.status === "test" ? "· Teste" : "· Off"}`,
          }))}
        />
        {agents.length === 0 && !agentsQ.isLoading && (
          <p className="text-xs text-muted-foreground">
            Nenhum agente cadastrado neste Workspace. Crie em <code>Agentes de IA</code>.
          </p>
        )}
      </div>

      {selected && (
        <div className="rounded-md border p-3 space-y-2 bg-muted/30">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Status:</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] ${
              selected.status === "on" ? "bg-green-500/20 text-green-700" :
              selected.status === "test" ? "bg-amber-500/20 text-amber-700" :
              "bg-muted text-muted-foreground"
            }`}>
              {selected.status === "on" ? "Ativo" : selected.status === "test" ? "Teste" : "Off"}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            Whitelist: <span className="text-foreground">{wl.length} {wl.length === 1 ? "número" : "números"}</span>
          </div>
          {selected.status === "off" && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              ⚠ Agente desligado — não responderá. Mude para Teste/Ativo na tela de Agentes.
            </p>
          )}
          {selected.status === "test" && (
            <p className="text-xs text-blue-700 dark:text-blue-400">
              ℹ Em modo Teste — responde apenas para números na whitelist.
            </p>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Quando o fluxo passar por este nó, a conversa será atribuída ao agente de IA escolhido. O cron de IA processa a resposta em ~30s, respeitando status e whitelist do agente.
      </p>
    </div>
  );
}

function AssignUserProperties({
  d, onChange, brandId,
}: { d: any; onChange: (p: Record<string, any>) => void; brandId: string }) {
  const listUsersFn = useServerFn(listAssignableUsers);
  const usersQ = useQuery({
    queryKey: ["assignable-users", brandId],
    enabled: !!brandId,
    queryFn: async () => {
      const r = await listUsersFn({ data: { brandId } });
      return r.users;
    },
  });
  const users = usersQ.data ?? [];
  const userId = String(d.userId ?? "").trim();
  const NONE = "__none__";

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Define o responsável humano pela conversa atual. Escolha <strong>Ninguém</strong> para remover qualquer atribuição.
      </p>
      <div className="space-y-2">
        <Label>Atribuir a</Label>
        <SearchableSelect
          value={userId ? userId : NONE}
          onValueChange={(v) => {
            if (v === NONE) {
              onChange({ userId: "", userName: "" });
              return;
            }
            const u = users.find((x: any) => x.id === v);
            onChange({
              userId: v,
              userName: u?.full_name ?? u?.email ?? "",
            });
          }}
          placeholder={usersQ.isLoading ? "Carregando..." : "Selecione"}
          options={[
            { value: NONE, label: "— Ninguém (remover atribuição) —" },
            ...users.map((u: any) => ({
              value: u.id,
              label: u.full_name || u.email || u.id,
              keywords: [u.email].filter(Boolean) as string[],
            })),
          ]}
        />
        {!usersQ.isLoading && users.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Nenhum atendente vinculado a este Workspace.
          </p>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Não altera o status da conversa nem o agente de IA atribuído.
      </p>
    </div>
  );
}



function AddTagProperties({
  d, onChange, triggerType, brandId,
}: { d: any; onChange: (p: Record<string, any>) => void; triggerType: string; brandId: string }) {
  const tags: string[] = Array.isArray(d.tags) ? d.tags : (d.tag ? [d.tag] : []);
  const op: "add" | "remove" = d.op === "remove" ? "remove" : "add";
  const [draft, setDraft] = useState("");
  const commit = (raw: string) => {
    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return;
    const next = Array.from(new Set([...tags, ...parts]));
    onChange({ tags: next, tag: undefined });
    setDraft("");
  };
  const removeAt = (i: number) => {
    const next = tags.filter((_, idx) => idx !== i);
    onChange({ tags: next, tag: undefined });
  };
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>Ação</Label>
        <SearchableSelect
          value={op}
          onValueChange={(v) => onChange({ op: v })}
          options={[
            { value: "add", label: "Adicionar tag" },
            { value: "remove", label: "Remover tag" },
          ]}
        />
      </div>
      <div className="space-y-2">
        <Label>{op === "remove" ? "Tags a remover" : "Tags a adicionar"}</Label>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t, i) => (
              <Badge key={i} variant="secondary" className="gap-1">
                <Tag className="h-3 w-3" />{t}
                <button type="button" onClick={() => removeAt(i)} className="ml-1 hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <TagAutocomplete
              brandId={brandId}
              value={draft}
              onChange={setDraft}
              onCommit={(v) => commit(v)}
              placeholder="Digite uma tag ou insira uma variável…"
              autoCreate={op === "add"}
            />
          </div>
          <VariablePicker
            triggerType={triggerType}
            onPick={(token) => commit(token)}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Selecione uma tag existente, crie uma nova ou use o botão <code>{"{ }"}</code> para inserir uma variável do gatilho (ex.: <code>{"{{data.product.name}}"}</code>). {op === "add" ? "Não dispara automações em cadeia." : "Tags ausentes são ignoradas."}
        </p>
      </div>

    </div>
  );
}

function ActiveCampaignProperties({
  d, onChange, brandId, triggerType,
}: { d: any; onChange: (p: Record<string, any>) => void; brandId: string; triggerType: string }) {
  const accountsQ = useQuery({
    queryKey: ["ac-accounts-for-brand", brandId],
    enabled: !!brandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integration_accounts")
        .select("id, name, integration_account_brands!inner(brand_id)")
        .eq("platform", "activecampaign" as any)
        .eq("integration_account_brands.brand_id", brandId)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const action = (d.action ?? "add_tag") as string;
  const itemType = action === "add_to_list" ? "list" : action === "update_field" ? "field" : "tag";
  const itemLabel = action === "add_to_list" ? "Lista" : action === "update_field" ? "Campo" : "Tag";

  const itemsQ = useQuery({
    queryKey: ["ac-items", d.accountId, itemType],
    enabled: !!d.accountId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integration_products")
        .select("id, external_id, name")
        .eq("account_id", d.accountId)
        .eq("type", itemType)
        .order("name")
        .range(0, 4999);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>Conexão ActiveCampaign</Label>
        <SearchableSelect
          value={d.accountId || undefined}
          onValueChange={(v) => {
            const a = (accountsQ.data ?? []).find((x: any) => x.id === v);
            onChange({ accountId: v, accountName: a?.name ?? "", itemId: "", itemName: "" });
          }}
          placeholder={accountsQ.isLoading ? "Carregando..." : "Selecione a conta"}
          options={(accountsQ.data ?? []).map((a: any) => ({ value: a.id, label: a.name }))}
        />
        {accountsQ.data && accountsQ.data.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Nenhuma conta ActiveCampaign vinculada a este Workspace. Cadastre em Integrações.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label>Ação</Label>
        <SearchableSelect
          value={action}
          onValueChange={(v) => onChange({ action: v, itemId: "", itemName: "" })}
          options={[
            { value: "add_tag", label: "Adicionar tag" },
            { value: "add_to_list", label: "Adicionar à lista" },
            { value: "update_field", label: "Atualizar campo" },
          ]}
        />
      </div>

      <div className="space-y-2">
        <Label>{itemLabel}</Label>
        <SearchableSelect
          value={d.itemId || undefined}
          onValueChange={(v) => {
            const it = (itemsQ.data ?? []).find((x: any) => x.external_id === v);
            onChange({ itemId: v, itemName: it?.name ?? "" });
          }}
          disabled={!d.accountId}
          placeholder={!d.accountId ? "Selecione a conta primeiro" : itemsQ.isLoading ? "Carregando..." : `Selecione ${itemLabel.toLowerCase()}`}
          options={(itemsQ.data ?? []).map((p: any) => ({ value: p.external_id, label: p.name }))}
        />
        {d.accountId && itemsQ.data && itemsQ.data.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Nenhum item sincronizado. Vá em Integrações e clique em "Sincronizar agora".
          </p>
        )}
      </div>

      {action === "update_field" && (
        <div className="space-y-2">
          <Label>Valor</Label>
          <VarInput
            value={d.value ?? ""}
            onChange={(v) => onChange({ value: v })}
            placeholder="Valor a definir no campo"
            triggerType={triggerType}
          />
          <p className="text-xs text-muted-foreground">
            Use o botão <code>{"{ }"}</code> ao lado para inserir variáveis.
          </p>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        O contato é identificado pelo e-mail salvo em <code>contacts.metadata.email</code>. Sem e-mail, o passo é ignorado.
      </p>
    </div>
  );
}

function PipelineStagePicker({
  d, onChange, brandId, stageOptional,
}: { d: any; onChange: (p: Record<string, any>) => void; brandId: string; stageOptional?: boolean }) {
  const pipelinesQ = useQuery({
    queryKey: ["automation-pipelines", brandId],
    enabled: !!brandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipelines")
        .select("id, name")
        .eq("brand_id", brandId)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const stagesQ = useQuery({
    queryKey: ["automation-pipeline-stages", d.pipelineId],
    enabled: !!d.pipelineId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipeline_stages")
        .select("id, name, position")
        .eq("pipeline_id", d.pipelineId)
        .order("position");
      if (error) throw error;
      return data ?? [];
    },
  });
  const ANY = "__any__";
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>Pipeline</Label>
        <SearchableSelect
          value={d.pipelineId || undefined}
          onValueChange={(v) => {
            const p = (pipelinesQ.data ?? []).find((x: any) => x.id === v);
            onChange({ pipelineId: v, pipelineName: p?.name ?? "", stageId: "", stageName: "" });
          }}
          placeholder={pipelinesQ.isLoading ? "Carregando..." : "Selecione um pipeline"}
          options={(pipelinesQ.data ?? []).map((p: any) => ({ value: p.id, label: p.name }))}
        />
      </div>
      <div className="space-y-2">
        <Label>Etapa{stageOptional ? " (opcional)" : ""}</Label>
        <SearchableSelect
          value={d.stageId ? d.stageId : (stageOptional ? ANY : undefined)}
          onValueChange={(v) => {
            if (v === ANY) {
              onChange({ stageId: "", stageName: "" });
              return;
            }
            const s = (stagesQ.data ?? []).find((x: any) => x.id === v);
            onChange({ stageId: v, stageName: s?.name ?? "" });
          }}
          disabled={!d.pipelineId}
          placeholder={!d.pipelineId ? "Selecione um pipeline" : stagesQ.isLoading ? "Carregando..." : "Selecione a etapa"}
          options={[
            ...(stageOptional ? [{ value: ANY, label: "Qualquer etapa" }] : []),
            ...(stagesQ.data ?? []).map((s: any) => ({ value: s.id, label: s.name })),
          ]}
        />
      </div>
    </div>
  );
}

function MoveToPipelineProperties({
  d, onChange, brandId,
}: { d: any; onChange: (p: Record<string, any>) => void; brandId: string }) {
  const action: "move" | "remove" = d.action === "remove" ? "remove" : "move";
  const resolveCard = d.resolveCard === true;
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>Ação</Label>
        <SearchableSelect
          value={action}
          onValueChange={(v) => onChange({ action: v, ...(v === "remove" ? { stageId: "", stageName: "" } : {}) })}
          options={[
            { value: "move", label: "Mover para etapa (cria se não existir)" },
            { value: "remove", label: "Remover do pipeline" },
          ]}
        />
      </div>
      <PipelineStagePicker d={d} onChange={onChange} brandId={brandId} stageOptional={action === "remove"} />
      {action === "move" && (
        <label className="flex items-start gap-2 rounded-md border p-2 text-xs">
          <Switch checked={resolveCard} onCheckedChange={(v) => onChange({ resolveCard: v })} />
          <div className="space-y-0.5">
            <div className="font-medium">Marcar o card como resolvido também</div>
            <div className="text-muted-foreground">
              Ao mover/criar o card nesta etapa, ele já fica com status "Resolvido" e não aparece no filtro padrão de "Abertas".
            </div>
          </div>
        </label>
      )}
      <p className="text-xs text-muted-foreground">
        {action === "remove"
          ? "Quando o fluxo passar por este nó, o contato será removido do pipeline escolhido."
          : "Quando o fluxo passar por este nó, o contato será movido para a etapa escolhida (substituindo a anterior, se existir)."}
      </p>
    </div>
  );
}

function QuickReplyButtonsEditor({
  d, onChange,
}: { d: any; onChange: (p: Record<string, any>) => void }) {
  const buttons: any[] = Array.isArray(d.buttons) ? d.buttons : [];
  const update = (next: any[]) => onChange({ buttons: next });
  const add = () => {
    if (buttons.length >= 3) return;
    const usedIdx = new Set(buttons.map((b) => Number(b.index)));
    let idx = 0;
    while (usedIdx.has(idx)) idx++;
    update([...buttons, { type: "QUICK_REPLY", text: "", index: idx }]);
  };
  const setText = (i: number, text: string) => {
    const next = buttons.slice();
    next[i] = { ...next[i], text: text.slice(0, 20) };
    update(next);
  };
  const remove = (i: number) => {
    const next = buttons.slice();
    next.splice(i, 1);
    update(next);
  };
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <Label>Botões de resposta rápida</Label>
        <span className="text-[10px] text-muted-foreground">{buttons.length}/3</span>
      </div>
      {buttons.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Opcional. Funciona apenas com a janela 24h aberta. Até 3 botões, 20 caracteres cada.
        </p>
      )}
      <div className="space-y-2">
        {buttons.map((b, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              value={b.text ?? ""}
              maxLength={20}
              onChange={(e) => setText(i, e.target.value)}
              placeholder={`Botão ${i + 1}`}
            />
            <span className="text-[10px] text-muted-foreground w-10 text-right">{(b.text ?? "").length}/20</span>
            <Button size="icon" variant="ghost" onClick={() => remove(i)} title="Remover">
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        ))}
      </div>
      {buttons.length < 3 && (
        <Button size="sm" variant="outline" onClick={add} className="w-full">
          <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar botão
        </Button>
      )}
      {buttons.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Conecte cada botão (handle à direita do nó) para ramificar o fluxo conforme o clique do contato.
        </p>
      )}
      {buttons.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] leading-snug text-amber-900 dark:text-amber-200">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <div>
            <strong className="font-semibold">Aguarda clique indefinidamente.</strong>{" "}
            Se o contato não clicar, o run fica parado até alguém cancelar manualmente ou até o job diário expirar runs com mais de 14 dias.
            Em breve será possível configurar um timeout por nó.
            <div className="mt-1 opacity-90">
              🔐 O clique só retoma <em>este</em> run específico (chave + fechadura via wa_message_id). Botões com o mesmo label em outros fluxos não disparam este.
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

type MediaKind = "image" | "video" | "audio" | "document";

const MEDIA_LIMITS: Record<MediaKind, { accept: string; maxMb: number; allowsCaption: boolean }> = {
  image: { accept: "image/jpeg,image/png", maxMb: 5, allowsCaption: true },
  video: { accept: "video/mp4,video/3gpp", maxMb: 16, allowsCaption: true },
  audio: { accept: "audio/aac,audio/mp4,audio/mpeg,audio/amr,audio/ogg", maxMb: 16, allowsCaption: false },
  document: { accept: "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain", maxMb: 100, allowsCaption: true },
};

function mimeToKind(mime: string | null | undefined): MediaKind {
  const m = (mime ?? "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  return "document";
}

function FreeformMediaEditor({
  d, onChange, brandId,
}: { d: any; onChange: (p: Record<string, any>) => void; brandId: string }) {
  const [uploading, setUploading] = useState(false);
  const [kind, setKind] = useState<MediaKind>((d.mediaKind as MediaKind) || "image");
  const currentKind: MediaKind = (d.mediaKind as MediaKind) || kind;
  const cfg = MEDIA_LIMITS[currentKind];

  const handleUpload = async (file: File) => {
    if (!brandId) { toast.error("Workspace não identificado."); return; }
    const maxBytes = cfg.maxMb * 1024 * 1024;
    if (file.size > maxBytes) {
      toast.error(`Arquivo excede o limite de ${cfg.maxMb} MB para ${currentKind}.`);
      return;
    }
    setUploading(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const fd = new FormData();
      fd.append("file", file);
      fd.append("brand_id", brandId);
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-media`, {
        method: "POST",
        headers: {
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: fd,
      });
      const json = await res.json();
      if (!res.ok || !json.url) throw new Error(json?.error ?? "Falha no upload");
      const mime: string = json.mime ?? file.type;
      const detected = mimeToKind(mime);
      onChange({
        mediaUrl: json.url,
        mediaMime: mime,
        mediaFilename: json.filename ?? file.name,
        mediaKind: detected,
      });
      setKind(detected);
      toast.success("Mídia carregada.");
    } catch (e: any) {
      toast.error(e?.message ?? "Erro no upload");
    } finally {
      setUploading(false);
    }
  };

  const remove = () => onChange({ mediaUrl: null, mediaMime: null, mediaFilename: null, mediaKind: null });

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs uppercase text-muted-foreground">Mídia (opcional)</Label>
        {d.mediaUrl && (
          <Button size="sm" variant="ghost" onClick={remove} title="Remover mídia">
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        )}
      </div>

      {!d.mediaUrl ? (
        <>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Tipo</Label>
            <SearchableSelect
              value={currentKind}
              onValueChange={(v) => setKind(v as MediaKind)}
              triggerClassName="h-8 text-xs"
              options={[
                { value: "image", label: "Imagem (JPG/PNG, máx 5 MB)" },
                { value: "video", label: "Vídeo (MP4/3GPP, máx 16 MB)" },
                { value: "audio", label: "Áudio (MP3/AAC/OGG, máx 16 MB)" },
                { value: "document", label: "Documento (PDF/DOC/XLS/PPT/TXT, máx 100 MB)" },
              ]}
            />
          </div>
          <Button asChild type="button" size="sm" variant="outline" disabled={uploading} className="w-full">
            <label className="cursor-pointer">
              {uploading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1" />}
              Carregar arquivo
              <input
                type="file"
                className="hidden"
                accept={cfg.accept}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleUpload(f);
                  e.currentTarget.value = "";
                }}
              />
            </label>
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Envio só ocorre se a janela 24h estiver aberta. {!cfg.allowsCaption && "Áudio não aceita legenda — o texto será ignorado."}
          </p>
        </>
      ) : (
        <div className="space-y-2">
          {currentKind === "image" && (
            <img src={d.mediaUrl} alt="" className="max-h-32 rounded border object-contain bg-muted/30 w-full" />
          )}
          <div className="text-[11px] text-muted-foreground truncate">
            <Badge variant="outline" className="text-[10px] mr-1">{currentKind}</Badge>
            {d.mediaFilename ?? "arquivo"}
          </div>
          <Button asChild type="button" size="sm" variant="outline" disabled={uploading} className="w-full">
            <label className="cursor-pointer">
              {uploading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1" />}
              Substituir
              <input
                type="file"
                className="hidden"
                accept={cfg.accept}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleUpload(f);
                  e.currentTarget.value = "";
                }}
              />
            </label>
          </Button>
          {!cfg.allowsCaption && (
            <p className="text-[11px] text-muted-foreground">Áudio não aceita legenda — o campo de texto será ignorado no envio.</p>
          )}
        </div>
      )}
    </div>
  );
}



function TemplateChannelResolver({
  tpl, brandId, d, onChange,
}: { tpl: any; brandId: string; d: any; onChange: (p: Record<string, any>) => void }) {
  const eligibleQ = useQuery({
    queryKey: ["template-eligible-channels", brandId, tpl?.name, tpl?.language],
    enabled: !!brandId && !!tpl?.name && !!tpl?.language,
    queryFn: async () => {
      // 1) Find approved template rows of same (name, language) in brand → get channel_ids
      const { data: tpls } = await supabase
        .from("whatsapp_templates")
        .select("channel_id")
        .eq("brand_id", brandId)
        .eq("name", tpl.name)
        .eq("language", tpl.language)
        .eq("status", "APPROVED");
      const directChannelIds = Array.from(new Set((tpls ?? []).map((t: any) => t.channel_id).filter(Boolean)));
      if (directChannelIds.length === 0) return [];

      // 2) Resolve waba_ids from those channels
      const { data: tplChans } = await supabase
        .from("brand_channels")
        .select("id, waba_id")
        .in("id", directChannelIds);
      const wabaIds = Array.from(new Set((tplChans ?? []).map((c: any) => c.waba_id).filter(Boolean)));

      // 3) All active brand_channels in this brand that share any of those waba_ids (∪ direct)
      const { data: chans } = await supabase
        .from("brand_channels")
        .select("id, name, phone_number, waba_id, active")
        .eq("brand_id", brandId)
        .eq("active", true);
      const eligible = (chans ?? []).filter((c: any) =>
        (c.waba_id && wabaIds.includes(c.waba_id)) || directChannelIds.includes(c.id)
      );
      return eligible;
    },
  });

  const eligible = eligibleQ.data ?? [];
  const selectedIds: string[] = Array.isArray(d.templateChannelIds) ? d.templateChannelIds : [];
  const follow = d.followContactChannel !== false; // default true
  const mode = (d.templateChannelMode ?? "random") as "random" | "fixed";
  const fallbackId = d.templateChannelFallbackId ?? null;

  // If user hasn't selected any yet, treat all eligible as selected by default
  const effectiveSelected = selectedIds.length > 0
    ? eligible.filter((c: any) => selectedIds.includes(c.id))
    : eligible;

  return (
    <div className="space-y-3 rounded-md border p-3">
      <Label className="text-xs uppercase text-muted-foreground">Canais elegíveis (mesmo WABA)</Label>
      {eligibleQ.isLoading ? (
        <div className="text-xs text-muted-foreground">Carregando…</div>
      ) : eligible.length === 0 ? (
        <div className="text-xs text-rose-600">
          Nenhum canal disponível para este template. Verifique se ele está APROVADO em algum WABA conectado.
        </div>
      ) : (
        <div className="space-y-1.5">
          {eligible.map((c: any) => {
            const checked = selectedIds.length === 0 ? true : selectedIds.includes(c.id);
            return (
              <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const base = selectedIds.length === 0 ? eligible.map((x: any) => x.id) : [...selectedIds];
                    const next = e.target.checked
                      ? Array.from(new Set([...base, c.id]))
                      : base.filter((id) => id !== c.id);
                    onChange({ templateChannelIds: next });
                  }}
                />
                <span>{c.name}</span>
                {c.phone_number && <span className="text-xs text-muted-foreground">· {c.phone_number}</span>}
              </label>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between pt-2 border-t">
        <div className="space-y-0.5">
          <Label className="text-xs">Seguir canal do contato</Label>
          <p className="text-[11px] text-muted-foreground">
            Se o contato já tem conversa ativa em um canal elegível, usar esse canal.
          </p>
        </div>
        <Switch
          checked={follow}
          onCheckedChange={(v) => onChange({ followContactChannel: v })}
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Quando precisar escolher um canal</Label>
        <div className="flex items-center gap-4 text-sm">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              checked={mode === "random"}
              onChange={() => onChange({ templateChannelMode: "random" })}
            />
            Sortear
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              checked={mode === "fixed"}
              onChange={() => onChange({ templateChannelMode: "fixed" })}
            />
            Canal fixo
          </label>
        </div>
        {mode === "fixed" && (
          <SearchableSelect
            value={fallbackId ?? ""}
            onValueChange={(v) => onChange({ templateChannelFallbackId: v })}
            placeholder="Escolha o canal"
            options={effectiveSelected.map((c: any) => ({
              value: c.id,
              label: `${c.name}${c.phone_number ? ` · ${c.phone_number}` : ""}`,
            }))}
          />
        )}
      </div>
    </div>
  );
}

function MessageTemplateProperties({

  d, templates, onChange, brandId, triggerType,
}: { d: any; templates: any[]; onChange: (p: Record<string, any>) => void; brandId: string; triggerType: string }) {
  const [uploading, setUploading] = useState(false);
  const tpl = templates.find((t) => t.id === d.templateId);
  const headerType = tpl ? getTemplateHeaderType(tpl) : null;
  const isMediaHeader = headerType === "IMAGE" || headerType === "VIDEO" || headerType === "DOCUMENT";
  const overrideUrl: string | null = d.templateHeaderMediaUrl ?? null;
  const overrideFilename: string | null = d.templateHeaderMediaFilename ?? null;

  const accept = headerType === "IMAGE" ? "image/jpeg,image/png"
    : headerType === "VIDEO" ? "video/mp4"
    : headerType === "DOCUMENT" ? "application/pdf"
    : "*/*";

  const handleUpload = async (file: File) => {
    if (!brandId) { toast.error("Workspace não identificado."); return; }
    setUploading(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const fd = new FormData();
      fd.append("file", file);
      fd.append("brand_id", brandId);
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-media`, {
        method: "POST",
        headers: {
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: fd,
      });
      const json = await res.json();
      if (!res.ok || !json.url) throw new Error(json?.error ?? "Falha no upload");
      onChange({
        templateHeaderMediaUrl: json.url,
        templateHeaderMediaMime: json.mime ?? file.type,
        templateHeaderMediaFilename: json.filename ?? file.name,
      });
      toast.success("Mídia carregada.");
    } catch (e: any) {
      toast.error(e?.message ?? "Erro no upload");
    } finally {
      setUploading(false);
    }
  };

  const selectedTpl = templates.find((x) => x.id === d.templateId);
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>Template</Label>
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" className="w-full justify-between font-normal">
              <span className="truncate">
                {selectedTpl ? `${selectedTpl.name} (${selectedTpl.language})` : "Selecione"}
              </span>
              <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0 ml-2" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
            <Command>
              <CommandInput placeholder="Buscar template..." />
              <CommandList>
                <CommandEmpty>Nenhum template.</CommandEmpty>
                <CommandGroup>
                  {templates.map((t) => (
                    <CommandItem
                      key={t.id}
                      value={`${t.name} ${t.language}`}
                      onSelect={() => {
                        const varCount = getTemplateBodyVarCount(t);
                        const prev: string[] = Array.isArray(d.templateVariables) ? d.templateVariables : [];
                        const nextVars = prev.slice(0, varCount);
                        while (nextVars.length < varCount) nextVars.push("");
                        onChange({
                          templateId: t.id,
                          templateName: t.name,
                          templateLanguage: t.language,
                          buttons: getTemplateButtons(t),
                          templateHeaderMediaUrl: null,
                          templateHeaderMediaMime: null,
                          templateHeaderMediaFilename: null,
                          templateVariables: nextVars,
                        });
                      }}
                    >
                      <Check className={`mr-2 h-4 w-4 ${d.templateId === t.id ? "opacity-100" : "opacity-0"}`} />
                      {t.name} <span className="text-muted-foreground ml-1">({t.language})</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {tpl && (
        <TemplateChannelResolver
          tpl={tpl}
          brandId={brandId}
          d={d}
          onChange={onChange}
        />
      )}




      {isMediaHeader && tpl && (
        <div className="space-y-2 rounded-md border p-3">
          <Label className="text-xs uppercase text-muted-foreground">
            Mídia do header ({headerType})
          </Label>
          <div className="text-xs text-muted-foreground">
            {overrideUrl
              ? <>Mídia carregada: <span className="text-foreground">{overrideFilename ?? "arquivo"}</span></>
              : "Suba um novo arquivo ou reutilize uma mídia já enviada neste workspace."}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild type="button" size="sm" variant="outline" disabled={uploading}>
              <label className="cursor-pointer">
                {uploading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1" />}
                {overrideUrl ? "Substituir mídia" : "Carregar mídia"}
                <input
                  type="file"
                  className="hidden"
                  accept={accept}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUpload(f);
                    e.currentTarget.value = "";
                  }}
                />
              </label>
            </Button>
            <MediaLibraryPicker
              brandId={brandId}
              kind={
                headerType === "IMAGE" ? "image"
                : headerType === "VIDEO" ? "video"
                : "document"
              }
              onSelect={(item) => onChange({
                templateHeaderMediaUrl: item.url,
                templateHeaderMediaMime: item.mime,
                templateHeaderMediaFilename: item.filename ?? "arquivo",
              })}
            />
            {overrideUrl && (
              <Button
                type="button" size="sm" variant="ghost"
                onClick={() => onChange({ templateHeaderMediaUrl: null, templateHeaderMediaMime: null, templateHeaderMediaFilename: null })}
              >
                Remover
              </Button>
            )}
          </div>
        </div>
      )}


      {tpl && getTemplateBodyVarCount(tpl) > 0 && (
        <div className="space-y-2 rounded-md border p-3">
          <Label className="text-xs uppercase text-muted-foreground">Variáveis do corpo</Label>
          <p className="text-[11px] text-muted-foreground">
            Use texto fixo ou variáveis dinâmicas como <code>{`{{contact_name}}`}</code>,{" "}
            <code>{`{{contact_phone}}`}</code>, <code>{`{{trigger_tag}}`}</code> ou{" "}
            <code>{`{{inbound_text}}`}</code>.
          </p>
          {Array.from({ length: getTemplateBodyVarCount(tpl) }).map((_, i) => {
            const arr: string[] = Array.isArray(d.templateVariables) ? d.templateVariables : [];
            return (
              <div key={i} className="space-y-1">
                <Label className="text-[11px]">{`{{${i + 1}}}`}</Label>
                <VarInput
                  value={arr[i] ?? ""}
                  placeholder={`Valor para {{${i + 1}}}`}
                  triggerType={triggerType}
                  onChange={(val) => {
                    const count = getTemplateBodyVarCount(tpl);
                    const next = Array.isArray(d.templateVariables) ? [...d.templateVariables] : [];
                    while (next.length < count) next.push("");
                    next[i] = val;
                    onChange({ templateVariables: next.slice(0, count) });
                  }}
                />
              </div>
            );
          })}
        </div>
      )}

      {(d.buttons ?? []).length > 0 && (
        <div className="text-xs text-muted-foreground space-y-1">
          <div className="font-semibold">Botões detectados:</div>
          {(d.buttons as any[]).map((b, i) => (
            <div key={i} className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">{b.type}</Badge>
              <span>{b.text}</span>
            </div>
          ))}
          <p className="pt-1">Conecte cada botão (handle à direita do nó) para ramificar o fluxo conforme a resposta do contato.</p>
        </div>
      )}
    </div>
  );
}

function TriggerProperties({
  d, onChange, automationId, brandId, automationStatus, automationName,
}: { d: any; onChange: (p: Record<string, any>) => void; automationId: string; brandId: string; automationStatus?: string; automationName?: string }) {
  const triggerType = (d.triggerType ?? "tag") as string;
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const isIntegration = ["shopify", "hotmart", "sendflow", "activecampaign"].includes(triggerType);
  const platformDef = isIntegration ? PLATFORMS[triggerType as IntegrationPlatform] : null;

  const accountsQ = useQuery({
    queryKey: ["integration-accounts", triggerType, brandId],
    enabled: isIntegration && !!brandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integration_accounts")
        .select("id, name, status, integration_account_brands!inner(brand_id)")
        .eq("platform", triggerType as any)
        .eq("integration_account_brands.brand_id", brandId)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const triggerEvents: string[] = Array.isArray(d.triggerEvents)
    ? d.triggerEvents
    : (d.triggerEvent ? [d.triggerEvent] : []);

  // Para AC, o tipo de produto depende dos eventos selecionados (tag vs list).
  // Se houver mistura, desabilita o seletor.
  const acTypes = triggerType === "activecampaign"
    ? Array.from(new Set(triggerEvents.map((ev) =>
        ev === "list_subscribed" ? "list"
        : (ev === "tag_added" || ev === "tag_removed") ? "tag"
        : null
      ).filter(Boolean) as ("list" | "tag")[]))
    : [];
  const acProductType = acTypes.length === 1 ? acTypes[0] : null;
  const acMixed = acTypes.length > 1;
  const productTypeFilter = triggerType === "activecampaign" ? acProductType : null;
  const productLabel =
    triggerType === "activecampaign"
      ? acProductType === "list"
        ? "Lista"
        : acProductType === "tag"
        ? "Tag"
        : "Tag/Lista"
      : platformDef?.productLabel ?? "Item";

  const productsQ = useQuery({
    queryKey: [
      "integration-products",
      d.accountId,
      productTypeFilter,
      productSearch,
      Array.isArray(d.productIds) ? d.productIds.join(",") : (d.productId ?? ""),
    ],
    enabled: isIntegration && !!d.accountId && (triggerType !== "activecampaign" || !!productTypeFilter),
    queryFn: async () => {
      let q = supabase
        .from("integration_products")
        .select("id, external_id, name, type")
        .eq("account_id", d.accountId)
        .order("name")
        .range(0, 4999);
      if (productTypeFilter) q = q.eq("type", productTypeFilter);
      const search = productSearch.trim();
      if (search) q = q.ilike("name", `%${search.replace(/[%_]/g, "\\$&")}%`);
      const { data, error } = await q;
      if (error) throw error;
      const rows = data ?? [];
      const selectedIds: string[] = Array.isArray(d.productIds)
        ? d.productIds.filter(Boolean).map((x: any) => String(x))
        : (d.productId ? [String(d.productId)] : []);
      const missingSelected = selectedIds.filter((pid) => !rows.some((p: any) => p.external_id === pid));
      if (!missingSelected.length) return rows;

      let selectedQ = supabase
        .from("integration_products")
        .select("id, external_id, name, type")
        .eq("account_id", d.accountId)
        .in("external_id", missingSelected);
      if (productTypeFilter) selectedQ = selectedQ.eq("type", productTypeFilter);
      const { data: selectedRows, error: selectedError } = await selectedQ;
      if (selectedError) throw selectedError;
      const byExternalId = new Map<string, any>();
      for (const row of [...rows, ...(selectedRows ?? [])]) byExternalId.set(row.external_id, row);
      return Array.from(byExternalId.values()).sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
    },
  });

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>Tipo de gatilho</Label>
        <SearchableSelect
          value={triggerType}
          onValueChange={(v) => onChange({ triggerType: v, accountId: null, productIds: [], productNames: {}, triggerEvents: [], triggerEvent: null })}
          options={[
            { value: "tag", label: "Tag adicionada" },
            { value: "manual", label: "Manual / Broadcast" },
            { value: "api", label: "API (REST)" },
            ...PLATFORM_LIST.map((p) => ({ value: p.id, label: p.label })),
          ]}
        />
      </div>

      {triggerType === "tag" && (
        <div className="space-y-2">
          <Label>Tag gatilho</Label>
          <TagAutocomplete
            brandId={brandId}
            value={d.tag ?? ""}
            onChange={(v) => onChange({ tag: v })}
            placeholder="ex: cliente-vip"
          />

          <p className="text-xs text-muted-foreground">
            O fluxo inicia automaticamente quando essa tag for adicionada a um contato.
          </p>
        </div>
      )}

      {triggerType === "manual" && (
        <div className="space-y-3">
          <div className="rounded-md border p-3 bg-muted/30 space-y-2">
            <Label className="text-xs uppercase text-muted-foreground flex items-center gap-1">
              <Megaphone className="h-3.5 w-3.5" /> Disparar para um público
            </Label>
            <p className="text-xs text-muted-foreground">
              Este fluxo é disparado em massa via Broadcast, escolhendo um público filtrado por tag.
              Para acionar via REST, use o gatilho <strong>API (REST)</strong>.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                onClick={() => setBroadcastOpen(true)}
                disabled={automationStatus !== "active"}
                title={automationStatus !== "active" ? "Salve e ative o fluxo antes de criar um broadcast." : undefined}
              >
                <Megaphone className="h-4 w-4 mr-1" /> Criar broadcast com este fluxo
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => { window.location.href = `/admin/broadcasts?automation=${automationId}`; }}
              >
                Ver broadcasts deste fluxo
              </Button>
            </div>
            {automationStatus !== "active" && (
              <p className="text-[11px] text-muted-foreground">Salve e ative o fluxo antes de criar um broadcast.</p>
            )}
          </div>

          {brandId && (
            <NewBroadcastDialog
              open={broadcastOpen}
              onOpenChange={setBroadcastOpen}
              brandId={brandId}
              lockedAutomationId={automationId}
              lockedAutomationName={automationName}
            />
          )}
        </div>
      )}

      {triggerType === "api" && (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>ID da automação</Label>
            <div className="flex gap-2">
              <Input readOnly value={automationId} className="font-mono text-xs" />
              <Button
                type="button" size="sm" variant="outline"
                onClick={() => { navigator.clipboard.writeText(automationId); toast.success("ID copiado"); }}
              >Copiar</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Use este ID na sua chamada de API. Lembre-se de salvar e ativar o fluxo antes.{" "}
              <a href="/admin/api-keys" className="underline">Gerenciar API keys</a>.
            </p>
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <Label className="text-xs uppercase text-muted-foreground">Campos do sistema</Label>
            <p className="text-xs text-muted-foreground">
              Estes campos são recebidos no corpo da chamada e ficam disponíveis em todos os nós seguintes como variáveis.
            </p>
            {[
              { field: "phone", variable: "contact_phone", label: "Telefone", example: "5511999999999" },
              { field: "email", variable: "contact_email", label: "E-mail", example: "cliente@dominio.com" },
            ].map((f) => (
              <div key={f.field} className="flex items-center justify-between gap-2 rounded border bg-muted/30 px-2 py-1.5">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{f.label}</div>
                  <div className="text-[11px] text-muted-foreground font-mono truncate">
                    body.{f.field} → {`{{${f.variable}}}`}
                  </div>
                </div>
                <Button
                  type="button" size="sm" variant="ghost"
                  onClick={() => { navigator.clipboard.writeText(`{{${f.variable}}}`); toast.success("Variável copiada"); }}
                >Copiar variável</Button>
              </div>
            ))}
            <p className="text-[11px] text-muted-foreground">
              Pelo menos um entre <code>phone</code> e <code>email</code> é obrigatório para localizar o contato.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Exemplo de disparo</Label>
            <Textarea
              readOnly rows={10} className="font-mono text-[10px]"
              value={`POST /api/public/v1/automations/${automationId}/trigger
Authorization: Bearer <SUA_API_KEY>
Content-Type: application/json

{
  "phone": "5511999999999",
  "email": "cliente@dominio.com"
}`}
            />
          </div>
        </div>
      )}

      {isIntegration && platformDef && (
        <>
          <div className="space-y-2">
            <Label>Conta {platformDef.label}</Label>
            <SearchableSelect
              value={d.accountId ?? ""}
              onValueChange={(v) => onChange({ accountId: v, productIds: [], productNames: {} })}
              placeholder="Selecione a conta"
              options={(accountsQ.data ?? []).map((a: any) => ({ value: a.id, label: a.name }))}
            />
            {accountsQ.data && accountsQ.data.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Nenhuma conta cadastrada. Vá em Integrações para criar.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Eventos</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" className="w-full justify-between font-normal">
                  <span className="truncate">
                    {triggerEvents.length === 0
                      ? "Selecione um ou mais eventos"
                      : triggerEvents.length === 1
                      ? (platformDef.events.find((e) => e.value === triggerEvents[0])?.label ?? triggerEvents[0])
                      : `${triggerEvents.length} eventos selecionados`}
                  </span>
                  <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0 ml-2" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
                <Command>
                  <CommandInput placeholder="Buscar evento..." />
                  <CommandList>
                    <CommandEmpty>Nenhum evento.</CommandEmpty>
                    <CommandGroup>
                      {platformDef.events.map((e) => {
                        const checked = triggerEvents.includes(e.value);
                        return (
                          <CommandItem
                            key={e.value}
                            onSelect={() => {
                              const next = checked
                                ? triggerEvents.filter((v) => v !== e.value)
                                : [...triggerEvents, e.value];
                              onChange({ triggerEvents: next, triggerEvent: next[0] ?? null, productIds: [], productNames: {} });
                            }}
                          >
                            <Check className={`mr-2 h-4 w-4 ${checked ? "opacity-100" : "opacity-0"}`} />
                            {e.label}
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {triggerEvents.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {triggerEvents.map((ev) => {
                  const lbl = platformDef.events.find((e) => e.value === ev)?.label ?? ev;
                  return (
                    <Badge key={ev} variant="secondary" className="gap-1">
                      {lbl}
                      <button
                        type="button"
                        onClick={() => {
                          const next = triggerEvents.filter((v) => v !== ev);
                          onChange({ triggerEvents: next, triggerEvent: next[0] ?? null, productIds: [], productNames: {} });
                        }}
                        className="hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  );
                })}
              </div>
            )}
            {acMixed && (
              <p className="text-xs text-amber-600">
                Você selecionou eventos de tipos diferentes (tag e lista). Para filtrar por tag/lista específica, escolha apenas eventos de um mesmo tipo.
              </p>
            )}
          </div>

          {(() => {
            const productIds: string[] = Array.isArray(d.productIds)
              ? d.productIds
              : (d.productId ? [String(d.productId)] : []);
            const productNames: Record<string, string> = (d.productNames && typeof d.productNames === "object") ? d.productNames : {};
            const disabled = !d.accountId || (triggerType === "activecampaign" && !productTypeFilter);
            const products = productsQ.data ?? [];
            const productLabelForId = (pid: string) =>
              products.find((p: any) => p.external_id === pid)?.name ?? productNames[pid] ?? pid;
            const productSearchNeedle = normalizeSearchText(productSearch);
            const visibleProducts = productSearchNeedle
              ? products.filter((p: any) =>
                  normalizeSearchText(`${p.name ?? ""} ${p.external_id ?? ""} ${p.type ?? ""}`).includes(productSearchNeedle)
                )
              : products;
            return (
              <div className="space-y-2">
                <Label>{productLabel} (opcional)</Label>
                <Popover onOpenChange={(next) => { if (!next) setProductSearch(""); }}>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="outline" disabled={disabled} className="w-full justify-between font-normal">
                      <span className="truncate">
                        {productIds.length === 0
                          ? `Qualquer ${productLabel.toLowerCase()}`
                          : productIds.length === 1
                          ? productLabelForId(productIds[0])
                          : `${productIds.length} ${productLabel.toLowerCase()}s selecionados`}
                      </span>
                      <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0 ml-2" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <div className="border-b p-2">
                      <Input
                        value={productSearch}
                        onChange={(e) => setProductSearch(e.target.value)}
                        placeholder={`Buscar ${productLabel.toLowerCase()}...`}
                        className="h-8"
                      />
                    </div>
                    <div className="max-h-[300px] overflow-y-auto p-1">
                      {visibleProducts.length === 0 ? (
                        <div className="py-6 text-center text-sm text-muted-foreground">Nenhum item.</div>
                      ) : (
                        visibleProducts.map((p: any) => {
                          const checked = productIds.includes(p.external_id);
                          return (
                            <button
                              key={p.id}
                              type="button"
                              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                              onClick={() => {
                                const next = checked
                                  ? productIds.filter((v) => v !== p.external_id)
                                  : [...productIds, p.external_id];
                                const nextNames = { ...productNames };
                                if (checked) {
                                  delete nextNames[p.external_id];
                                } else {
                                  nextNames[p.external_id] = p.name;
                                }
                                onChange({ productIds: next, productId: next[0] ?? null, productNames: nextNames });
                              }}
                            >
                              <Check className={`h-4 w-4 shrink-0 ${checked ? "opacity-100" : "opacity-0"}`} />
                              <span className="min-w-0 flex-1 truncate">{p.name}</span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
                {productIds.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {productIds.map((pid) => {
                      const lbl = productLabelForId(pid);
                      return (
                        <Badge key={pid} variant="secondary" className="gap-1">
                          {lbl}
                          <button
                            type="button"
                            onClick={() => {
                              const next = productIds.filter((v) => v !== pid);
                              const nextNames = { ...productNames };
                              delete nextNames[pid];
                              onChange({ productIds: next, productId: next[0] ?? null, productNames: nextNames });
                            }}
                            className="hover:text-destructive"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      );
                    })}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Deixe em branco para disparar em qualquer {productLabel.toLowerCase()}.
                </p>
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}

const STANDARD_CONTACT_FIELDS = [
  { key: "name", label: "Nome", type: "text" },
  { key: "phone", label: "Telefone (wa_id)", type: "text" },
  { key: "email", label: "E-mail", type: "text" },
  { key: "id", label: "ID do contato", type: "text" },
] as const;

const OPERATORS_BY_TYPE: Record<string, Array<{ value: string; label: string; noValue?: boolean }>> = {
  text: [
    { value: "is", label: "IS" },
    { value: "is_not", label: "is not" },
    { value: "contains", label: "Contains" },
    { value: "not_contains", label: "Not Contains" },
    { value: "starts_with", label: "Start with" },
    { value: "ends_with", label: "End with" },
    { value: "regex", label: "Match Pattern" },
    { value: "has_value", label: "Has any value", noValue: true },
    { value: "no_value", label: "Has no value", noValue: true },
  ],
  number: [
    { value: "eq", label: "=" },
    { value: "neq", label: "≠" },
    { value: "gt", label: ">" },
    { value: "gte", label: ">=" },
    { value: "lt", label: "<" },
    { value: "lte", label: "<=" },
    { value: "has_value", label: "Has any value", noValue: true },
    { value: "no_value", label: "Has no value", noValue: true },
  ],
  date: [
    { value: "eq", label: "=" },
    { value: "neq", label: "≠" },
    { value: "before", label: "Before" },
    { value: "after", label: "After" },
    { value: "has_value", label: "Has any value", noValue: true },
    { value: "no_value", label: "Has no value", noValue: true },
  ],
  boolean: [
    { value: "is_true", label: "Is true", noValue: true },
    { value: "is_false", label: "Is false", noValue: true },
    { value: "has_value", label: "Has any value", noValue: true },
  ],
};

function QuestionSaveToFieldEditor({
  d, onChange, brandId,
}: {
  d: any;
  onChange: (patch: Record<string, any>) => void;
  brandId: string;
}) {
  const fieldsQ = useQuery({
    queryKey: ["custom-fields", brandId],
    enabled: !!brandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("custom_fields")
        .select("key, label, type")
        .eq("brand_id", brandId)
        .order("label");
      if (error) throw error;
      return data ?? [];
    },
  });
  const fields = fieldsQ.data ?? [];
  const enabled = !!d.saveToField;
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <Label className="cursor-pointer" htmlFor="q-savetofield-toggle">Salvar resposta em campo personalizado</Label>
        <Switch
          id="q-savetofield-toggle"
          checked={enabled}
          onCheckedChange={(v) => onChange({ saveToField: v ? (d.saveToField || (fields[0]?.key ?? "")) : "" })}
        />
      </div>
      {enabled ? (
        fields.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nenhum campo personalizado nesta workspace. Crie em Configurações → Campos personalizados.
          </p>
        ) : (
          <>
            <SearchableSelect
              value={d.saveToField ?? ""}
              onValueChange={(v) => onChange({ saveToField: v })}
              placeholder="Selecione um campo"
              options={fields.map((f: any) => ({ value: f.key, label: f.label }))}
            />
            <p className="text-xs text-muted-foreground">
              O conteúdo da resposta é salvo no campo selecionado do contato.
            </p>
          </>
        )
      ) : (
        <p className="text-xs text-muted-foreground">
          Desligado: a resposta não é gravada em nenhum campo do contato.
        </p>
      )}
    </div>
  );
}



function FieldConditionEditor({
  d, onChange, brandId, triggerType,
}: {
  d: any;
  onChange: (patch: Record<string, any>) => void;
  brandId: string;
  triggerType: string;
}) {
  const customFieldsQ = useQuery({
    queryKey: ["custom-fields", brandId],
    enabled: !!brandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("custom_fields")
        .select("key, label, type")
        .eq("brand_id", brandId)
        .order("label");
      if (error) throw error;
      return data ?? [];
    },
  });

  const field = d.field ?? { source: "contact", key: "name", type: "text" };
  const fieldType = String(field.type ?? "text");
  const operators = OPERATORS_BY_TYPE[fieldType] ?? OPERATORS_BY_TYPE.text;
  const currentOp = operators.find((o) => o.value === d.operator) ?? operators[0];
  const showValue = !currentOp.noValue;

  const fieldId = `${field.source}::${field.key}`;
  const onPickField = (id: string) => {
    const [source, ...keyParts] = id.split("::");
    const key = keyParts.join("::");
    if (source === "contact") {
      const f = STANDARD_CONTACT_FIELDS.find((x) => x.key === key);
      onChange({ field: { source: "contact", key, type: f?.type ?? "text" }, operator: "is", value: "" });
    } else if (source === "custom") {
      const f = (customFieldsQ.data ?? []).find((x: any) => x.key === key);
      const t = f?.type === "number" || f?.type === "date" || f?.type === "boolean" ? f.type : "text";
      onChange({ field: { source: "custom", key, type: t }, operator: t === "boolean" ? "is_true" : "is", value: "" });
    } else {
      // Plataformas (hotmart, shopify, activecampaign, sendflow): tratar como texto
      onChange({ field: { source, key, type: "text" }, operator: "is", value: "" });
    }
  };

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="space-y-2">
        <Label className="text-xs">If (campo)</Label>
        <SearchableSelect
          value={fieldId}
          onValueChange={onPickField}
          placeholder="Selecione um campo"
          groups={[
            {
              heading: "Contato",
              options: STANDARD_CONTACT_FIELDS.map((f) => ({
                value: `contact::${f.key}`,
                label: f.label,
              })),
            },
            ...((customFieldsQ.data ?? []).length > 0
              ? [{
                  heading: "Campos personalizados",
                  options: (customFieldsQ.data ?? []).map((f: any) => ({
                    value: `custom::${f.key}`,
                    label: `${f.label} (${f.type ?? "text"})`,
                  })),
                }]
              : []),
            ...PLATFORM_FIELD_GROUPS.flatMap((group) => {
              const fields = getFieldsForSource(group.source);
              if (fields.length === 0) return [];
              return [{
                heading: group.label,
                options: fields.map((f) => ({
                  value: `${group.source}::${f.key}`,
                  label: `${f.label} (${f.key})`,
                  keywords: [f.key],
                })),
              }];
            }),
          ]}
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Operator</Label>
        <SearchableSelect
          value={d.operator ?? operators[0].value}
          onValueChange={(v) => onChange({ operator: v })}
          options={operators.map((o) => ({ value: o.value, label: o.label }))}
        />
      </div>

      {showValue && (
        <div className="space-y-2">
          <Label className="text-xs">Value</Label>
          {fieldType === "date" ? (
            <Input type="date" value={d.value ?? ""} onChange={(e) => onChange({ value: e.target.value })} />
          ) : fieldType === "number" ? (
            <Input type="number" value={d.value ?? ""} onChange={(e) => onChange({ value: e.target.value })} />
          ) : (
            <VarInput value={d.value ?? ""} onChange={(v) => onChange({ value: v })} triggerType={triggerType} placeholder="valor ou {{variável}}" />
          )}
        </div>
      )}

      {fieldType === "text" && showValue && (
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={!!d.caseSensitive}
            onChange={(e) => onChange({ caseSensitive: e.target.checked })}
          />
          Case Sensitive?
        </label>
      )}
    </div>
  );
}

function TagAutocomplete({
  brandId, value, onChange, onCommit, placeholder, autoCreate = true,
}: {
  brandId: string;
  value: string;
  onChange: (v: string) => void;
  /** Called when user picks an existing tag or creates a new one. Defaults to onChange. */
  onCommit?: (v: string) => void;
  placeholder?: string;
  /** When true and the typed tag doesn't exist, inserts it into public.tags before committing. */
  autoCreate?: boolean;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const tagsQ = useQuery({
    queryKey: ["automation-tags", brandId],
    enabled: !!brandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tags").select("id, name, color")
        .eq("brand_id", brandId).order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string; color: string | null }[];
    },
  });

  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  const allTags = tagsQ.data ?? [];
  const matches = trimmed
    ? allTags.filter((t) => t.name.toLowerCase().includes(lower))
    : allTags;
  const exact = allTags.find((t) => t.name.toLowerCase() === lower);

  const handleCommit = async (name: string) => {
    const v = name.trim();
    if (!v) return;
    // Tokens de variável (ex.: {{data.product.name}}) não devem ser cadastrados como tag real.
    const isVarToken = /^\{\{\s*[\w.]+\s*\}\}$/.test(v);
    const exists = allTags.some((t) => t.name.toLowerCase() === v.toLowerCase());
    if (!exists && autoCreate && !isVarToken) {
      setCreating(true);
      const { error } = await supabase
        .from("tags").insert({ brand_id: brandId, name: v, color: "#64748b" });
      setCreating(false);
      if (error && !/duplicate/i.test(error.message)) {
        toast.error(error.message);
      } else {
        qc.invalidateQueries({ queryKey: ["automation-tags", brandId] });
      }
    }
    (onCommit ?? onChange)(v);
  };


  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative">
          <Input
            value={value}
            onChange={(e) => { onChange(e.target.value); if (!open) setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleCommit(value);
                setOpen(false);
              }
            }}
            placeholder={placeholder ?? "Digite uma tag…"}
          />
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command shouldFilter={false}>
          <CommandList>
            {matches.length > 0 && (
              <CommandGroup heading="Tags existentes">
                {matches.slice(0, 30).map((t) => (
                  <CommandItem
                    key={t.id}
                    value={t.name}
                    onSelect={() => { handleCommit(t.name); setOpen(false); }}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full mr-2 inline-block"
                      style={{ backgroundColor: t.color ?? "#94a3b8" }}
                    />
                    {t.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {trimmed && !exact && autoCreate && (
              <CommandGroup heading="Nova tag">
                <CommandItem
                  value={`__create__${trimmed}`}
                  onSelect={() => { handleCommit(trimmed); setOpen(false); }}
                  disabled={creating}
                >
                  <Tag className="h-3.5 w-3.5 mr-2" />
                  Criar tag "{trimmed}"
                </CommandItem>
              </CommandGroup>
            )}
            {matches.length === 0 && !trimmed && (
              <CommandEmpty>Nenhuma tag cadastrada.</CommandEmpty>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function MediaLibraryPicker({
  brandId, kind, onSelect,
}: { brandId: string; kind: BrandMediaKind; onSelect: (item: BrandMediaItem) => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<BrandMediaItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const listFn = useServerFn(listBrandMedia);
  const deleteFn = useServerFn(deleteBrandMedia);

  const load = useCallback(async () => {
    if (!brandId) return;
    setLoading(true);
    try {
      const rows = await listFn({ data: { brandId, kind } });
      setItems(rows);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao carregar biblioteca");
    } finally {
      setLoading(false);
    }
  }, [brandId, kind, listFn]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const handleDelete = async (id: string) => {
    if (!confirm("Remover esta mídia da biblioteca? Ela deixará de estar disponível em outras automações.")) return;
    setDeletingId(id);
    try {
      await deleteFn({ data: { id } });
      setItems((prev) => (prev ?? []).filter((x) => x.id !== id));
      toast.success("Mídia removida.");
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao remover");
    } finally {
      setDeletingId(null);
    }
  };

  const kindLabel = kind === "image" ? "imagens" : kind === "video" ? "vídeos" : "documentos";

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)} disabled={!brandId}>
        <FolderOpen className="h-3.5 w-3.5 mr-1" /> Escolher da biblioteca
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Biblioteca de mídias</DialogTitle>
            <DialogDescription>
              Reutilize {kindLabel} enviados anteriormente neste workspace. Escolha um item para aplicar ao header do template.
            </DialogDescription>
          </DialogHeader>
          {loading && (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Carregando...
            </div>
          )}
          {!loading && items && items.length === 0 && (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Nenhuma {kind === "image" ? "imagem" : kind === "video" ? "vídeo" : "documento"} na biblioteca ainda — use "Carregar mídia" para começar.
            </div>
          )}
          {!loading && items && items.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[60vh] overflow-y-auto py-2">
              {items.map((it) => (
                <div key={it.id} className="group relative rounded-md border overflow-hidden bg-muted/30">
                  <button
                    type="button"
                    className="block w-full text-left"
                    onClick={() => { onSelect(it); setOpen(false); }}
                  >
                    <div className="aspect-square flex items-center justify-center bg-background">
                      {it.kind === "image" ? (
                        <img src={it.url} alt={it.filename ?? ""} className="w-full h-full object-cover" loading="lazy" />
                      ) : it.kind === "video" ? (
                        <Film className="h-10 w-10 text-muted-foreground" />
                      ) : (
                        <FileText className="h-10 w-10 text-muted-foreground" />
                      )}
                    </div>
                    <div className="px-2 py-1.5 text-[11px]">
                      <div className="truncate font-medium">{it.filename ?? "sem nome"}</div>
                      <div className="text-muted-foreground">
                        {new Date(it.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    aria-label="Remover"
                    className="absolute top-1 right-1 rounded-md bg-background/90 border p-1 opacity-0 group-hover:opacity-100 transition disabled:opacity-50"
                    disabled={deletingId === it.id}
                    onClick={(e) => { e.stopPropagation(); handleDelete(it.id); }}
                  >
                    {deletingId === it.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
