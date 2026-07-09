// Mapeia eventos vindos das integrações para um rótulo amigável em PT-BR.
import type { IntegrationPlatform } from "./integrations-platforms";
import { PLATFORMS } from "./integrations-platforms";

export interface FormattedActivity {
  title: string;
  detail?: string;
  platformLabel: string;
}

function pickProductName(payload: any): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  return (
    payload.product_name ||
    payload.product?.name ||
    payload.data?.product?.name ||
    payload.data?.purchase?.product?.name ||
    payload.line_items?.[0]?.title ||
    payload.title ||
    payload.name ||
    undefined
  );
}

function pickTagName(payload: any): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  return (
    payload.tag_name ||
    payload.tag ||
    payload.contact?.tag ||
    payload["tag[tag]"] ||
    undefined
  );
}

function pickListName(payload: any): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  return (
    payload.list_name ||
    payload.group_name ||
    payload.list?.name ||
    payload["list[name]"] ||
    undefined
  );
}

function pickAmount(payload: any): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const amount =
    payload.amount ||
    payload.total ||
    payload.data?.purchase?.price?.value ||
    payload.data?.product?.price?.value;
  const currency =
    payload.currency ||
    payload.data?.purchase?.price?.currency_value ||
    "BRL";
  if (!amount) return undefined;
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: String(currency).toUpperCase(),
    }).format(Number(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}

const VERBS: Record<string, string> = {
  // Hotmart
  purchase_approved: "Compra aprovada",
  purchase_complete: "Compra concluída",
  purchase_canceled: "Compra cancelada",
  purchase_refunded: "Compra reembolsada",
  purchase_chargeback: "Chargeback registrado",
  purchase_billet_printed: "Aguardando pagamento",
  purchase_protest: "Reembolso solicitado",
  purchase_expired: "Compra expirada",
  purchase_delayed: "Compra atrasada",
  subscription_cancellation: "Assinatura cancelada",
  switch_plan: "Trocou de plano",
  update_subscription_charge_date: "Data de cobrança alterada",
  club_first_access: "Primeiro acesso ao Club",
  club_module_completed: "Concluiu módulo do Club",
  cart_abandoned: "Abandonou o carrinho",
  // Shopify
  order_paid: "Compra aprovada",
  order_refunded: "Compra reembolsada",
  checkout_abandoned: "Abandonou o checkout",
  chargeback_created: "Chargeback aberto",
  // Sendflow
  group_joined: "Entrou no grupo",
  group_left: "Saiu do grupo",
  // ActiveCampaign
  tag_added: "Recebeu tag",
  tag_removed: "Tag removida",
  list_subscribed: "Inscrito em lista",
};

export function formatActivity(input: {
  platform: IntegrationPlatform | string | null | undefined;
  event_type: string;
  payload: any;
}): FormattedActivity {
  const platformDef = input.platform
    ? PLATFORMS[input.platform as IntegrationPlatform]
    : undefined;
  const platformLabel = platformDef?.label ?? (input.platform ? String(input.platform) : "Integração");
  const verb = VERBS[input.event_type] ?? input.event_type;

  const product = pickProductName(input.payload);
  const tag = pickTagName(input.payload);
  const list = pickListName(input.payload);
  const amount = pickAmount(input.payload);

  let title = verb;
  let detail: string | undefined;

  if (tag && (input.event_type === "tag_added" || input.event_type === "tag_removed")) {
    detail = `“${tag}”`;
  } else if (list && input.event_type === "list_subscribed") {
    detail = `“${list}”`;
  } else if (product) {
    detail = `“${product}”${amount ? ` — ${amount}` : ""}`;
  } else if (amount) {
    detail = amount;
  }

  return { title, detail, platformLabel };
}
