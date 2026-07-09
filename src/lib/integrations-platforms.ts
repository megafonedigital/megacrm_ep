// Catálogo de plataformas, eventos e campos. Compartilhado entre cliente e servidor.

export type IntegrationPlatform = "shopify" | "hotmart" | "sendflow" | "activecampaign";

export interface PlatformEvent {
  value: string;
  label: string;
}

export interface PlatformCredentialField {
  key: string;
  label: string;
  type: "text" | "password" | "url";
  placeholder?: string;
  hint?: string;
  required?: boolean;
  /**
   * "api" → credencial emitida pela plataforma; usada pelo MegaCRM para chamar a API deles (sync de produtos/tags).
   * "webhook" → token usado para validar eventos enviados pela plataforma para o MegaCRM.
   */
  group: "api" | "webhook";
}

export interface PlatformDef {
  id: IntegrationPlatform;
  label: string;
  productLabel: string;
  productType: "product" | "list" | "group" | "tag";
  events: PlatformEvent[];
  credentialFields: PlatformCredentialField[];
  webhookHint: string;
  /** Texto curto explicando para que servem as credenciais de API. */
  apiCredentialsHelp?: string;
  /** Link para a página onde encontrar as credenciais de API dentro da plataforma. */
  apiCredentialsDocUrl?: string;
  /** Se a plataforma suporta receber eventos via webhook. Quando false, exibimos só o painel de API. */
  webhookSupported?: boolean;
}

export const PLATFORMS: Record<IntegrationPlatform, PlatformDef> = {
  shopify: {
    id: "shopify",
    label: "Shopify",
    productLabel: "Produto",
    productType: "product",
    events: [
      { value: "product_created", label: "Produto criado (auto-cadastra aqui)" },
      { value: "order_paid", label: "Compra aprovada" },
      { value: "order_refunded", label: "Compra reembolsada" },
      { value: "checkout_abandoned", label: "Checkout abandonado" },
      { value: "chargeback_created", label: "Chargeback aberto" },
    ],
    credentialFields: [
      {
        group: "webhook",
        key: "webhook_signing_secret",
        label: "Webhook signing secret (Shopify)",
        type: "password",
        required: true,
        hint: "Shopify Admin → Settings → Notifications → Webhooks → role a página até o fim e copie o valor 'Webhook signing secret'. É esse segredo que a Shopify usa para assinar cada webhook.",
      },
    ],
    webhookHint: "1) No Shopify Admin → Settings → Notifications → Webhooks, copie o 'Webhook signing secret' e cole no campo acima (Editar credenciais). 2) Cadastre dois webhooks usando a URL abaixo, formato JSON: 'Product creation' (auto-cadastra produtos aqui) e 'Order payment' (dispara as automações de compra aprovada).",
    webhookSupported: true,
  },
  hotmart: {
    id: "hotmart",
    label: "Hotmart",
    productLabel: "Produto",
    productType: "product",
    events: [
      // Compras
      { value: "purchase_approved", label: "Compra aprovada" },
      { value: "purchase_complete", label: "Compra concluída" },
      { value: "purchase_canceled", label: "Compra cancelada" },
      { value: "purchase_refunded", label: "Compra reembolsada" },
      { value: "purchase_chargeback", label: "Chargeback" },
      { value: "purchase_billet_printed", label: "Aguardando pagamento" },
      { value: "purchase_protest", label: "Reembolso solicitado" },
      { value: "purchase_expired", label: "Compra expirada" },
      { value: "purchase_delayed", label: "Compra atrasada" },
      // Assinaturas
      { value: "subscription_cancellation", label: "Cancelamento de assinatura" },
      { value: "switch_plan", label: "Troca de plano" },
      { value: "update_subscription_charge_date", label: "Atualização de data de cobrança" },
      // Club
      { value: "club_first_access", label: "Primeiro acesso (Club)" },
      { value: "club_module_completed", label: "Módulo concluído (Club)" },
      // Outros
      { value: "cart_abandoned", label: "Abandono de carrinho" },
    ],
    credentialFields: [
      { group: "api", key: "client_id", label: "Client ID", type: "text", required: true, hint: "Hotmart → Ferramentas → Credenciais Hotmart API → copie o Client ID." },
      { group: "api", key: "client_secret", label: "Client Secret", type: "password", required: true, hint: "Mesma tela do Client ID. Necessário para sincronizar a lista de produtos." },
      { group: "webhook", key: "hottok", label: "Hottok", type: "password", required: true, hint: "Hotmart → Ferramentas → Webhook (POSTBACK 2.0). Token enviado no header 'X-Hotmart-Hottok' a cada evento." },
    ],
    apiCredentialsHelp: "Necessárias para o MegaCRM puxar a lista de produtos da Hotmart automaticamente a cada hora.",
    apiCredentialsDocUrl: "https://developers.hotmart.com/docs/pt-BR/start/app-auth/",
    webhookHint: "Cadastre esta URL em Ferramentas > Webhook (POSTBACK 2.0) na Hotmart e marque os eventos desejados.",
    webhookSupported: true,
  },
  sendflow: {
    id: "sendflow",
    label: "Sendflow",
    productLabel: "Grupo",
    productType: "group",
    events: [
      { value: "group_joined", label: "Entrou no grupo" },
      { value: "group_left", label: "Saiu do grupo" },
    ],
    credentialFields: [
      { group: "api", key: "api_key", label: "API Key", type: "password", required: true, hint: "Painel da Sendflow → API." },
    ],
    apiCredentialsHelp: "Usada para autenticar chamadas à API da Sendflow.",
    webhookHint: "Configure esta URL como webhook no painel da Sendflow para o(s) grupo(s) desejado(s).",
    webhookSupported: true,
  },
  activecampaign: {
    id: "activecampaign",
    label: "ActiveCampaign",
    productLabel: "Tag/Lista",
    productType: "tag",
    events: [
      { value: "tag_added", label: "Tag adicionada" },
      { value: "tag_removed", label: "Tag removida" },
      { value: "list_subscribed", label: "Inscrito em lista" },
    ],
    credentialFields: [
      { group: "api", key: "api_url", label: "API URL", type: "url", placeholder: "https://suaconta.api-us1.com", required: true, hint: "ActiveCampaign → Settings → Developer → URL (sem barra no final)." },
      { group: "api", key: "api_key", label: "API Key", type: "password", required: true, hint: "ActiveCampaign → Settings → Developer → Key." },
    ],
    apiCredentialsHelp: "Necessárias para o MegaCRM puxar tags e listas do ActiveCampaign automaticamente a cada hora.",
    apiCredentialsDocUrl: "https://developers.activecampaign.com/reference/authentication",
    webhookHint: "ActiveCampaign → Settings → Developer → Manage Webhooks → Add. Cole esta URL, marque os eventos 'subscribe', 'contact_tag_added' e 'contact_tag_removed' e em 'Run webhooks for' selecione Public, Admin, API e System.",
    webhookSupported: true,
  },
};

export const PLATFORM_LIST: PlatformDef[] = Object.values(PLATFORMS);
