import { useMemo, useRef, useState } from "react";
import { Braces } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useActiveBrand } from "@/lib/active-brand";
import { cn } from "@/lib/utils";

export interface VarItem {
  key: string;
  label: string;
  example?: string;
}
export interface VarGroup {
  label: string;
  items: VarItem[];
}

const COMMON: VarGroup[] = [
  {
    label: "Contato",
    items: [
      { key: "contact_name", label: "Nome do contato" },
      { key: "contact_phone", label: "Telefone do contato" },
      { key: "contact_email", label: "E-mail do contato" },
      { key: "contact_id", label: "ID interno do contato" },
    ],
  },
  {
    label: "Conversa",
    items: [
      { key: "conversation_id", label: "ID da conversa" },
    ],
  },
];

const PER_TRIGGER: Record<string, VarGroup[]> = {
  tag: [
    {
      label: "Gatilho — Tag",
      items: [{ key: "trigger_tag", label: "Tag que disparou a automação" }],
    },
  ],
  inbound: [
    {
      label: "Gatilho — Mensagem recebida",
      items: [
        { key: "inbound_text", label: "Texto da mensagem recebida" },
        { key: "last_message", label: "Última mensagem (alias)" },
      ],
    },
  ],
  manual: [],
  hotmart: [
    {
      label: "Hotmart — Compra",
      items: [
        { key: "data.purchase.transaction", label: "ID da transação" },
        { key: "data.purchase.status", label: "Status da compra" },
        { key: "data.purchase.order_date", label: "Data do pedido" },
        { key: "data.purchase.price.value", label: "Valor da compra" },
        { key: "data.purchase.price.currency_value", label: "Moeda" },
        { key: "data.purchase.payment.type", label: "Forma de pagamento" },
        { key: "data.product.name", label: "Nome do produto" },
        { key: "data.product.id", label: "ID do produto" },
        { key: "data.buyer.name", label: "Nome do comprador" },
        { key: "data.buyer.email", label: "E-mail do comprador" },
        { key: "data.buyer.checkout_phone", label: "Telefone do comprador" },
        { key: "event", label: "Tipo do evento Hotmart" },
      ],
    },
  ],
  shopify: [
    {
      label: "Shopify — Pedido",
      items: [
        { key: "id", label: "ID do pedido" },
        { key: "order_number", label: "Número do pedido" },
        { key: "name", label: "Identificador do pedido (ex: #1001)" },
        { key: "total_price", label: "Valor total" },
        { key: "currency", label: "Moeda" },
        { key: "financial_status", label: "Status financeiro" },
        { key: "fulfillment_status", label: "Status de entrega" },
        { key: "customer.first_name", label: "Primeiro nome do cliente" },
        { key: "customer.last_name", label: "Sobrenome do cliente" },
        { key: "customer.email", label: "E-mail do cliente" },
        { key: "customer.phone", label: "Telefone do cliente" },
        { key: "line_items.0.title", label: "Nome do 1º produto" },
        { key: "line_items.0.quantity", label: "Quantidade do 1º produto" },
      ],
    },
  ],
  sendflow: [
    {
      label: "SendFlow — Grupo",
      items: [
        { key: "event", label: "Tipo do evento" },
        { key: "id", label: "ID do evento" },
        { key: "data.campaignId", label: "ID da campanha" },
        { key: "data.campaignName", label: "Nome da campanha" },
        { key: "data.groupId", label: "ID do grupo" },
        { key: "data.groupJid", label: "JID do grupo (WhatsApp)" },
        { key: "data.groupName", label: "Nome do grupo" },
        { key: "data.number", label: "Telefone do membro" },
        { key: "data.createdAt", label: "Data do evento (texto BR)" },
        { key: "data.createdAt_with_timezone_br", label: "Data do evento (ISO -03:00)" },
      ],
    },
  ],
  activecampaign: [
    {
      label: "ActiveCampaign",
      items: [
        { key: "contact.email", label: "E-mail do contato" },
        { key: "contact.first_name", label: "Primeiro nome" },
        { key: "contact.last_name", label: "Sobrenome" },
        { key: "contact.phone", label: "Telefone" },
        { key: "tag", label: "Nome da tag (quando aplicável)" },
        { key: "list", label: "ID da lista (quando aplicável)" },
      ],
    },
  ],
};

export function getVariablesForTrigger(triggerType?: string | null): VarGroup[] {
  const extras = (triggerType && PER_TRIGGER[triggerType]) || [];
  return [...COMMON, ...extras];
}

export function getAllVariableGroups(): VarGroup[] {
  const seen = new Set<string>();
  const all: VarGroup[] = [...COMMON];
  for (const groups of Object.values(PER_TRIGGER)) {
    for (const g of groups) {
      if (seen.has(g.label)) continue;
      seen.add(g.label);
      all.push(g);
    }
  }
  return all;
}

interface PickerProps {
  triggerType?: string | null;
  onPick: (token: string) => void;
}

export function VariablePicker({ triggerType, onPick }: PickerProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const baseGroups = useMemo(() => getAllVariableGroups(), []);
  const { activeBrandId } = useActiveBrand();

  const customQ = useQuery({
    queryKey: ["custom-fields-picker", activeBrandId],
    enabled: !!activeBrandId && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("custom_fields")
        .select("key, label")
        .eq("brand_id", activeBrandId!)
        .order("label");
      if (error) throw error;
      return data ?? [];
    },
  });

  const groups: VarGroup[] = useMemo(() => {
    const customGroup: VarGroup | null = (customQ.data && customQ.data.length > 0)
      ? { label: "Campos personalizados", items: customQ.data.map((f: any) => ({ key: `custom.${f.key}`, label: f.label })) }
      : null;
    return customGroup ? [...baseGroups, customGroup] : baseGroups;
  }, [baseGroups, customQ.data]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return groups;
    return groups
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (it) => it.key.toLowerCase().includes(needle) || it.label.toLowerCase().includes(needle),
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [groups, q]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-9 w-9 shrink-0"
          title="Inserir variável"
        >
          <Braces className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="border-b p-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar variável..."
            className="h-8"
            autoFocus
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground">
              Nenhuma variável encontrada.
            </div>
          ) : (
            filtered.map((g) => (
              <div key={g.label} className="mb-2">
                <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {g.label}
                </div>
                {g.items.map((it) => (
                  <button
                    key={it.key}
                    type="button"
                    onClick={() => {
                      onPick(`{{${it.key}}}`);
                      setOpen(false);
                      setQ("");
                    }}
                    className="flex w-full flex-col items-start rounded px-2 py-1.5 text-left hover:bg-accent"
                  >
                    <code className="text-[11px] text-primary">{`{{${it.key}}}`}</code>
                    <span className="text-[11px] text-muted-foreground">{it.label}</span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function insertAtCaret(
  el: HTMLInputElement | HTMLTextAreaElement | null,
  current: string,
  token: string,
): { next: string; caret: number } {
  if (!el) {
    const next = current + token;
    return { next, caret: next.length };
  }
  const start = el.selectionStart ?? current.length;
  const end = el.selectionEnd ?? current.length;
  const next = current.slice(0, start) + token + current.slice(end);
  return { next, caret: start + token.length };
}

interface VarInputProps extends Omit<React.ComponentProps<typeof Input>, "onChange"> {
  value: string;
  onChange: (value: string) => void;
  triggerType?: string | null;
}

export function VarInput({ value, onChange, triggerType, className, ...rest }: VarInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-2">
      <Input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn("flex-1", className)}
        {...rest}
      />
      <VariablePicker
        triggerType={triggerType}
        onPick={(token) => {
          const { next, caret } = insertAtCaret(ref.current, value, token);
          onChange(next);
          requestAnimationFrame(() => {
            ref.current?.focus();
            ref.current?.setSelectionRange(caret, caret);
          });
        }}
      />
    </div>
  );
}

interface VarTextareaProps extends Omit<React.ComponentProps<typeof Textarea>, "onChange"> {
  value: string;
  onChange: (value: string) => void;
  triggerType?: string | null;
}

export function VarTextarea({ value, onChange, triggerType, className, ...rest }: VarTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="flex items-start gap-2">
      <Textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn("flex-1", className)}
        {...rest}
      />
      <VariablePicker
        triggerType={triggerType}
        onPick={(token) => {
          const { next, caret } = insertAtCaret(ref.current, value, token);
          onChange(next);
          requestAnimationFrame(() => {
            ref.current?.focus();
            ref.current?.setSelectionRange(caret, caret);
          });
        }}
      />
    </div>
  );
}
