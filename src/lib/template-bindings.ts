// Mapeamento de variáveis de templates para fontes de dados
// (Contato, Hotmart, ActiveCampaign, Shopify, SendFlow, texto fixo)

export type BindingSource =
  | "static"
  | "contact"
  | "hotmart"
  | "activecampaign"
  | "shopify"
  | "sendflow";

export interface VariableBinding {
  index: number; // 1-based ({{1}}, {{2}}...)
  source: BindingSource;
  path: string; // ex.: "data.buyer.name", "name", "phone", "metadata.email"
  fallback?: string;
}

export interface SourceField {
  key: string;
  label: string;
}

export const BINDING_SOURCE_LABELS: Record<BindingSource, string> = {
  static: "Texto fixo (exemplo)",
  contact: "Contato",
  hotmart: "Hotmart",
  activecampaign: "ActiveCampaign",
  shopify: "Shopify",
  sendflow: "SendFlow",
};

const CONTACT_FIELDS: SourceField[] = [
  { key: "name", label: "Nome do contato" },
  { key: "profile_name", label: "Nome do perfil (WhatsApp)" },
  { key: "phone", label: "Telefone" },
  { key: "wa_id", label: "WhatsApp ID" },
  { key: "metadata.email", label: "E-mail (metadata)" },
];

const HOTMART_FIELDS: SourceField[] = [
  { key: "data.buyer.name", label: "Nome do comprador" },
  { key: "data.buyer.email", label: "E-mail do comprador" },
  { key: "data.buyer.checkout_phone", label: "Telefone do comprador" },
  { key: "data.purchase.transaction", label: "ID da transação" },
  { key: "data.purchase.status", label: "Status da compra" },
  { key: "data.purchase.order_date", label: "Data do pedido" },
  { key: "data.purchase.price.value", label: "Valor da compra" },
  { key: "data.purchase.price.currency_value", label: "Moeda" },
  { key: "data.purchase.payment.type", label: "Forma de pagamento" },
  { key: "data.purchase.payment.pix_code", label: "Pix — código copia-e-cola" },
  { key: "data.purchase.payment.pix_qrcode", label: "Pix — URL do QR Code" },
  { key: "data.purchase.payment.pix_expiration_date", label: "Pix — expiração" },
  { key: "data.purchase.payment.billet_barcode", label: "Boleto — linha digitável" },
  { key: "data.purchase.payment.billet_url", label: "Boleto — link do PDF" },
  { key: "data.product.name", label: "Nome do produto" },
  { key: "data.product.id", label: "ID do produto" },
  { key: "event", label: "Tipo do evento" },
];

const ACTIVECAMPAIGN_FIELDS: SourceField[] = [
  { key: "contact.email", label: "E-mail do contato" },
  { key: "contact.first_name", label: "Primeiro nome" },
  { key: "contact.last_name", label: "Sobrenome" },
  { key: "contact.phone", label: "Telefone" },
  { key: "tag", label: "Nome da tag" },
  { key: "list", label: "ID da lista" },
];

const SHOPIFY_FIELDS: SourceField[] = [
  { key: "order_number", label: "Número do pedido" },
  { key: "name", label: "Identificador do pedido" },
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
];

const SENDFLOW_FIELDS: SourceField[] = [
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
];

export function getFieldsForSource(source: BindingSource): SourceField[] {
  switch (source) {
    case "contact": return CONTACT_FIELDS;
    case "hotmart": return HOTMART_FIELDS;
    case "activecampaign": return ACTIVECAMPAIGN_FIELDS;
    case "shopify": return SHOPIFY_FIELDS;
    case "sendflow": return SENDFLOW_FIELDS;
    default: return [];
  }
}

export const PLATFORM_SOURCES: BindingSource[] = [
  "contact", "hotmart", "activecampaign", "shopify", "sendflow", "static",
];

function getByPath(obj: unknown, path: string): unknown {
  if (!obj || !path) return undefined;
  const parts = path.split(".");
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    const idx = /^\d+$/.test(p) ? Number(p) : p;
    cur = cur[idx as keyof typeof cur];
  }
  return cur;
}

export interface ResolveContext {
  contact?: Record<string, unknown> | null;
  // payload do último evento por plataforma
  eventsByPlatform?: Partial<Record<BindingSource, unknown>>;
}

export function resolveBinding(
  binding: VariableBinding,
  ctx: ResolveContext,
  metaExample?: string,
): string {
  if (binding.source === "static") {
    return binding.fallback ?? metaExample ?? "";
  }
  const root =
    binding.source === "contact"
      ? ctx.contact ?? null
      : ctx.eventsByPlatform?.[binding.source] ?? null;
  const value = getByPath(root, binding.path);
  if (value == null || value === "") return binding.fallback ?? metaExample ?? "";
  if (typeof value === "object") {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}
