import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import megacrmLogo from "@/assets/megacrm-logo.png";

type Lang = "en" | "pt";

type Screenshot = { src: string; caption: string };
type Step = {
  title: string;
  body: string[];
  screenshots?: Screenshot[];
  variableTable?: { headers: [string, string]; rows: [string, string][] };
};

const SECTIONS = [
  { id: "templates", en: "Creating & submitting templates", pt: "Criando e enviando templates" },
  { id: "messages", en: "Sending messages", pt: "Enviando mensagens" },
  { id: "privacy", en: "Privacy & data", pt: "Privacidade e dados" },
] as const;

const TEMPLATE_STEPS_EN: Step[] = [
  {
    title: "Step 1 — Access the Templates Meta section",
    body: [
      "In the left sidebar of the MegaCRM panel, click on Templates Meta under the Workspace Administration section.",
    ],
    screenshots: [{ src: "/docs/01-sidebar-templates-meta.jpg", caption: "Sidebar navigation with Templates Meta highlighted" }],
  },
  {
    title: "Step 2 — Templates Meta list page",
    body: [
      "After clicking “Templates Meta”, you will be taken to the Templates Meta page. It shows all existing templates with the following columns:",
      "• Name — the internal identifier of the template (lowercase, no spaces).\n• Category — the template type (MARKETING, UTILITY, etc.).\n• Language — the language of the template (e.g., pt_BR, en_US).\n• Variables — the number of dynamic variables in the template.\n• Status — current approval status (APPROVED, PENDING, REJECTED).",
      "You can use the search bar and filters to look up templates by name, status, or category. There is also a Sincronizar (Sync) button to manually sync template statuses from Meta.",
    ],
    screenshots: [{ src: "/docs/02-templates-list.jpg", caption: "Templates Meta list page" }],
  },
  {
    title: "Step 3 — Create a new template",
    body: [`Click the “+ Novo template” (New Template) button in the top-right corner.`],
  },
  {
    title: "Step 4 — Fill in the template form",
    body: [
      `A modal window titled “Novo template” will open. Fill in the following fields:`,
      "4.1 Name — a unique template name using only lowercase letters, numbers, and underscores (e.g., order_confirmation_v1). This is used as the template identifier in the Meta API.",
      "4.2 Language (Idioma) — select the language from the dropdown. Options include Português (BR), English (US), and others.",
      "4.3 Category — choose one of: UTILITY (transactional messages such as order updates and account alerts), MARKETING (promotional content, offers, announcements) or AUTHENTICATION (OTP and verification code messages).",
      "4.4 Header (optional) — choose one of three header types: Nenhum (None) — no header; Texto (Text) — a plain text header (supports one variable {{1}}); Mídia (Media) — an image, video, or document attachment. When Media is selected, a media type sub-dropdown appears with options Imagem, Vídeo and Documento, plus a “Selecionar arquivo” upload button.",
      "4.5 Body (Corpo) — the main message content, up to 1,024 characters. To include dynamic variables (values that change per recipient), use the format {{1}}, {{2}}, {{3}}, etc. Variables must be sequential and cannot appear at the very start or end of the message. Use the “Adicionar variável” button to insert them correctly. Example: Hello {{1}}, your order {{2}} has been confirmed! Your estimated delivery date is {{3}}. A live Pré-visualização (Preview) is shown on the right side of the modal, updating in real time as you type.",
      "4.6 Footer (optional) — a short footer text up to 60 characters (e.g., “Reply STOP to unsubscribe”). It appears below the message body.",
      `4.7 Buttons (Botões) — up to 2 buttons. Click “+ Adicionar” to add one. Each button has a Type (Resposta for a Quick Reply button, or Link for a URL button) and a Text (the label displayed on the button).`,
    ],
    screenshots: [
      { src: "/docs/03-new-template-modal.jpg", caption: "“Novo template” modal form" },
      { src: "/docs/04-category-dropdown.jpg", caption: "Category dropdown options" },
      { src: "/docs/05-header-text.jpg", caption: "Header — Texto (Text) option" },
      { src: "/docs/06-header-media.jpg", caption: "Header — Mídia (Media) option" },
      { src: "/docs/07-header-media-type.jpg", caption: "Media type dropdown (Image, Video, Document)" },
      { src: "/docs/08-body-variables.jpg", caption: "Body field with variables and live preview" },
      { src: "/docs/09-buttons-add.jpg", caption: "Button added with type dropdown" },
      { src: "/docs/10-buttons-type.jpg", caption: "Button type options: Resposta and Link" },
    ],
  },
  {
    title: "Step 5 — Provide approval examples for variables",
    body: [
      `When the body contains variables, a new section automatically appears: “Exemplos para aprovação (a Meta exige)” — Examples for approval (required by Meta).`,
      "You must fill in a realistic example value for each variable. These examples are submitted to Meta so their review team can understand the context of the template:",
      "As you fill in the examples, the preview panel updates to show the message exactly as recipients will see it.",
    ],
    variableTable: {
      headers: ["Variable", "Example Value"],
      rows: [["{{1}}", "John"], ["{{2}}", "#12345"], ["{{3}}", "June 1st"]],
    },
    screenshots: [{ src: "/docs/11-variable-examples.jpg", caption: "Variable examples section required by Meta" }],
  },
  {
    title: "Step 6 — Configure variable sources (auto-fill on send)",
    body: [
      `Scroll down to find the “Origem das variáveis (preenchimento automático no envio)” section. This lets you configure where each variable’s value will come from when the template is sent automatically.`,
      "For each variable, click the dropdown and choose the data source: Contato (data from the contact’s profile fields), Hotmart (data pulled from Hotmart integration), ActiveCampaign, Shopify, SendFlow, or Texto fixo (exemplo) — use the example text entered in Step 5 as a fixed/fallback value.",
      "If no data is available from the selected source at send time, the system falls back to the example value.",
    ],
    screenshots: [
      { src: "/docs/12-variable-source.jpg", caption: "Variable source configuration" },
      { src: "/docs/13-variable-source-options.jpg", caption: "Available variable source options" },
    ],
  },
  {
    title: "Step 7 — Submit for Meta approval",
    body: [
      `After filling in all required fields, click the “Enviar para aprovação” (Submit for Approval) button at the bottom right.`,
      "The template is submitted directly to Meta for review. The initial status will be PENDING. Meta typically reviews templates within a few minutes, though it can take longer in some cases.",
    ],
    screenshots: [{ src: "/docs/14-submit-approval.jpg", caption: "“Enviar para aprovação” button" }],
  },
  {
    title: "Step 8 — Monitor template status",
    body: [
      "Return to the Templates Meta list page to monitor the status of your submitted template. The Status column will update to reflect Meta’s decision:",
      "• APPROVED — Template is live and ready to use.\n• PENDING — Template is under review by Meta.\n• REJECTED — Template was not approved (review and resubmit with corrections).",
    ],
    screenshots: [{ src: "/docs/15-approved-status.jpg", caption: "Templates list showing APPROVED status" }],
  },
  {
    title: "Step 9 — Manage existing templates",
    body: [
      "Click the ⋯ (three-dot menu) on any template row to access management options:",
      "• Pré-visualizar (Preview) — opens a WhatsApp-style preview of the template message.\n• Editar (Edit) — modify the template (note: editing an approved template resubmits it for Meta review).\n• Duplicar (Duplicate) — creates a copy of the template.\n• Excluir (Delete) — permanently deletes the template.",
    ],
    screenshots: [
      { src: "/docs/16-context-menu.jpg", caption: "Template context menu options" },
      { src: "/docs/17-template-preview.jpg", caption: "Template preview modal" },
    ],
  },
];

const TEMPLATE_STEPS_PT: Step[] = [
  {
    title: "Passo 1 — Acesse a seção Templates Meta",
    body: [
      "Na barra lateral esquerda do painel do MegaCRM, clique em Templates Meta, na seção Administração do Workspace.",
    ],
    screenshots: [{ src: "/docs/01-sidebar-templates-meta.jpg", caption: "Navegação da barra lateral com Templates Meta destacado" }],
  },
  {
    title: "Passo 2 — Página de listagem de Templates Meta",
    body: [
      "Após clicar em “Templates Meta”, você é levado à página de Templates Meta. Ela mostra todos os templates existentes com as seguintes colunas:",
      "• Nome — identificador interno do template (minúsculas, sem espaços).\n• Categoria — tipo do template (MARKETING, UTILITY, etc.).\n• Idioma — idioma do template (ex.: pt_BR, en_US).\n• Variáveis — quantidade de variáveis dinâmicas no template.\n• Status — status atual de aprovação (APPROVED, PENDING, REJECTED).",
      "Você pode usar a barra de busca e os filtros para encontrar templates por nome, status ou categoria. Há também um botão Sincronizar para atualizar manualmente os status dos templates a partir da Meta.",
    ],
    screenshots: [{ src: "/docs/02-templates-list.jpg", caption: "Página de listagem de Templates Meta" }],
  },
  {
    title: "Passo 3 — Criar um novo template",
    body: [`Clique no botão “+ Novo template” no canto superior direito.`],
  },
  {
    title: "Passo 4 — Preencha o formulário do template",
    body: [
      `Uma janela modal chamada “Novo template” será aberta. Preencha os seguintes campos:`,
      "4.1 Nome — um nome único usando apenas letras minúsculas, números e underscores (ex.: order_confirmation_v1). Esse é o identificador do template na API da Meta.",
      "4.2 Idioma — selecione o idioma no dropdown. As opções incluem Português (BR), Inglês (US), entre outros.",
      "4.3 Categoria — escolha uma das opções: UTILITY (mensagens transacionais como atualizações de pedido e alertas de conta), MARKETING (conteúdo promocional, ofertas, anúncios) ou AUTHENTICATION (mensagens de OTP e códigos de verificação).",
      "4.4 Header (opcional) — escolha um dos três tipos de cabeçalho: Nenhum — sem cabeçalho; Texto — cabeçalho em texto puro (suporta uma variável {{1}}); Mídia — imagem, vídeo ou documento em anexo. Quando Mídia é selecionado, um sub-dropdown de tipo aparece com Imagem, Vídeo e Documento, além do botão “Selecionar arquivo”.",
      "4.5 Corpo — o conteúdo principal da mensagem, até 1.024 caracteres. Para incluir variáveis dinâmicas (valores que mudam por destinatário), use o formato {{1}}, {{2}}, {{3}}, etc. As variáveis devem ser sequenciais e não podem aparecer no início ou no final absoluto da mensagem. Use o botão “Adicionar variável” para inseri-las corretamente. Exemplo: Olá {{1}}, seu pedido {{2}} foi confirmado! A previsão de entrega é {{3}}. Uma Pré-visualização ao vivo é exibida à direita do modal, atualizando em tempo real conforme você digita.",
      "4.6 Footer (opcional) — um texto curto de rodapé com até 60 caracteres (ex.: “Responda PARAR para sair”). Aparece abaixo do corpo da mensagem.",
      `4.7 Botões — até 2 botões. Clique em “+ Adicionar”. Cada botão tem um Tipo (Resposta para botão de resposta rápida, ou Link para botão de URL) e um Texto (rótulo exibido no botão).`,
    ],
    screenshots: [
      { src: "/docs/03-new-template-modal.jpg", caption: "Modal “Novo template”" },
      { src: "/docs/04-category-dropdown.jpg", caption: "Opções do dropdown de Categoria" },
      { src: "/docs/05-header-text.jpg", caption: "Header — opção Texto" },
      { src: "/docs/06-header-media.jpg", caption: "Header — opção Mídia" },
      { src: "/docs/07-header-media-type.jpg", caption: "Dropdown de tipo de mídia (Imagem, Vídeo, Documento)" },
      { src: "/docs/08-body-variables.jpg", caption: "Campo de corpo com variáveis e pré-visualização ao vivo" },
      { src: "/docs/09-buttons-add.jpg", caption: "Botão adicionado com dropdown de tipo" },
      { src: "/docs/10-buttons-type.jpg", caption: "Opções de tipo de botão: Resposta e Link" },
    ],
  },
  {
    title: "Passo 5 — Forneça exemplos das variáveis para aprovação",
    body: [
      `Quando o corpo contém variáveis, aparece automaticamente a seção “Exemplos para aprovação (a Meta exige)”.`,
      "Você precisa preencher um valor de exemplo realista para cada variável. Esses exemplos são enviados à Meta para que a equipe de revisão entenda o contexto do template:",
      "À medida que você preenche os exemplos, o painel de pré-visualização atualiza para mostrar a mensagem exatamente como os destinatários vão recebê-la.",
    ],
    variableTable: {
      headers: ["Variável", "Valor de Exemplo"],
      rows: [["{{1}}", "João"], ["{{2}}", "#12345"], ["{{3}}", "1º de junho"]],
    },
    screenshots: [{ src: "/docs/11-variable-examples.jpg", caption: "Seção de exemplos de variáveis exigida pela Meta" }],
  },
  {
    title: "Passo 6 — Configure a origem das variáveis (preenchimento automático no envio)",
    body: [
      `Role a página até a seção “Origem das variáveis (preenchimento automático no envio)”. Aqui você define de onde virá o valor de cada variável quando o template for enviado automaticamente.`,
      "Para cada variável, clique no dropdown e escolha a fonte de dados: Contato (dados do perfil do contato), Hotmart, ActiveCampaign, Shopify, SendFlow ou Texto fixo (exemplo) — usa o texto de exemplo do Passo 5 como valor fixo/fallback.",
      "Se não houver dado disponível na fonte selecionada no momento do envio, o sistema cai automaticamente no valor de exemplo.",
    ],
    screenshots: [
      { src: "/docs/12-variable-source.jpg", caption: "Configuração de origem das variáveis" },
      { src: "/docs/13-variable-source-options.jpg", caption: "Opções de origem disponíveis" },
    ],
  },
  {
    title: "Passo 7 — Envie para aprovação da Meta",
    body: [
      `Após preencher todos os campos obrigatórios, clique em “Enviar para aprovação” no canto inferior direito.`,
      "O template é enviado diretamente à Meta para revisão. O status inicial será PENDING. A Meta normalmente revisa em poucos minutos, mas pode demorar mais em alguns casos.",
    ],
    screenshots: [{ src: "/docs/14-submit-approval.jpg", caption: "Botão “Enviar para aprovação”" }],
  },
  {
    title: "Passo 8 — Acompanhe o status do template",
    body: [
      "Volte à listagem de Templates Meta para acompanhar o status do template enviado. A coluna Status reflete a decisão da Meta:",
      "• APPROVED — Template ativo, pronto para uso.\n• PENDING — Em análise pela Meta.\n• REJECTED — Não aprovado (revise e reenvie com correções).",
    ],
    screenshots: [{ src: "/docs/15-approved-status.jpg", caption: "Listagem com status APPROVED" }],
  },
  {
    title: "Passo 9 — Gerencie templates existentes",
    body: [
      "Clique no menu ⋯ (três pontos) em qualquer linha da lista para acessar as opções de gerenciamento:",
      "• Pré-visualizar — abre uma prévia em estilo WhatsApp da mensagem do template.\n• Editar — modifica o template (atenção: editar um template aprovado o reenvia para revisão da Meta).\n• Duplicar — cria uma cópia do template.\n• Excluir — apaga o template permanentemente.",
    ],
    screenshots: [
      { src: "/docs/16-context-menu.jpg", caption: "Menu de contexto do template" },
      { src: "/docs/17-template-preview.jpg", caption: "Modal de pré-visualização do template" },
    ],
  },
];

const MESSAGES_STEPS_EN: Step[] = [
  {
    title: "Step 1 — Navigate to the Inbox",
    body: ["In the left sidebar, click on Inbox under the Atendimento (Service) section."],
  },
  {
    title: "Step 2 — Search for the contact",
    body: [
      "In the conversation search bar at the top of the conversation list, type the contact’s name. In this example, we search for “Afonso Damasceno”.",
      "The matching conversation appears in the results list below the search bar, showing the contact name, workspace/channel, phone number, and last message date.",
    ],
    screenshots: [
      { src: "/docs/send-01-inbox.jpg", caption: "Inbox navigation and conversation list" },
      { src: "/docs/send-02-conversation.jpg", caption: "Search results and contact details panel" },
    ],
  },
  {
    title: "Step 3 — Open the conversation",
    body: [
      "Click on the contact’s conversation to open it in the main panel. You will see:",
      `• The conversation history on the center panel.\n• The contact details on the right panel (name, WhatsApp number, email, tags, etc.).\n• A notice at the bottom: “Janela de 24h expirada. Apenas templates aprovados podem ser enviados.” (24h window expired. Only approved templates can be sent.)\n• The message input area is disabled and shows “Janela expirada — use templates”.\n• At the bottom toolbar, the Template button is visible.`,
      "Important: when the 24-hour window is active, you can send free-form messages normally. When it expires, the input is locked and you must use a template to initiate contact.",
    ],
    screenshots: [{ src: "/docs/send-03-template-modal.jpg", caption: "“Enviar template aprovado” modal" }],
  },
  {
    title: "Step 4 — Click the Template button",
    body: [
      `At the bottom of the conversation, click the “Template” button in the message toolbar.`,
      `A modal titled “Enviar template aprovado” will open. It shows only templates that have been approved by Meta for the current Workspace/Channel.`,
    ],
  },
  {
    title: "Step 5 — Select a template",
    body: [
      `Click the “Selecione um template” dropdown. A list of all approved templates for the workspace appears, showing the template name and language code (e.g., pt_BR, en_US).`,
      "Select the desired template by clicking on it. In this example, we select hello_world_v1, which contains 2 variables.",
    ],
    screenshots: [
      { src: "/docs/send-04-template-dropdown.jpg", caption: "Template dropdown with approved options" },
      { src: "/docs/send-05-template-selected.jpg", caption: "Modal with a template selected" },
    ],
  },
  {
    title: "Step 6 — Fill in variables (if applicable)",
    body: [
      `If the selected template contains variables — such as ativacao_01_PTBR — a “Preencha as variáveis” section appears with one field per variable ({{1}}, {{2}}, etc.). Fill in a value for each field. The Pré-visualização section below updates in real time, showing the final message with the variable values highlighted in blue — exactly as the contact will receive it.`,
      "Example: {{1}} = Curso de Panificação; {{2}} = R$ 297,00.",
      "Note: if the selected template has no variables (e.g., hello_world_v1), the variable fields will not appear and only the preview will be shown.",
    ],
    screenshots: [{ src: "/docs/send-06-fill-variables.jpg", caption: "Filling in variables with live preview" }],
  },
  {
    title: "Step 7 — Send the template",
    body: [
      `After reviewing the preview and confirming the variable values are correct, click the “Enviar” (Send) button.`,
    ],
  },
  {
    title: "Step 8 — Confirm delivery in the conversation",
    body: [
      `The modal closes and the sent template message appears in the conversation timeline, clearly labeled with a “TEMPLATE: [template_name]” tag at the top of the bubble, followed by the full message content with the variables already replaced.`,
      "Delivery statuses you may see after sending:",
      "• ✅ Delivered / Read — message was successfully sent and delivered.\n• ❌ Not delivered — Meta rejected the message (e.g., due to marketing policy restrictions, user opt-out, or phone number issues). The error reason is displayed below the message.",
    ],
    screenshots: [{ src: "/docs/send-07-delivered.jpg", caption: "Sent template in the conversation timeline" }],
  },
];

const MESSAGES_STEPS_PT: Step[] = [
  {
    title: "Passo 1 — Acesse a Inbox",
    body: ["Na barra lateral esquerda, clique em Inbox, na seção Atendimento."],
  },
  {
    title: "Passo 2 — Busque o contato",
    body: [
      "Na barra de busca no topo da lista de conversas, digite o nome do contato. Neste exemplo, buscamos por “Afonso Damasceno”.",
      "A conversa correspondente aparece na lista de resultados, mostrando nome do contato, workspace/canal, número de telefone e data da última mensagem.",
    ],
    screenshots: [
      { src: "/docs/send-01-inbox.jpg", caption: "Navegação da Inbox e lista de conversas" },
      { src: "/docs/send-02-conversation.jpg", caption: "Resultado da busca e painel de detalhes" },
    ],
  },
  {
    title: "Passo 3 — Abra a conversa",
    body: [
      "Clique na conversa do contato para abri-la no painel principal. Você verá:",
      `• O histórico da conversa no painel central.\n• Os detalhes do contato no painel à direita (nome, número de WhatsApp, e-mail, tags, etc.).\n• Um aviso no rodapé: “Janela de 24h expirada. Apenas templates aprovados podem ser enviados.”\n• A área de digitação fica desabilitada e exibe “Janela expirada — use templates”.\n• Na barra inferior, o botão Template fica visível.`,
      "Importante: enquanto a janela de 24h estiver ativa, você pode enviar mensagens livres normalmente. Quando ela expira, o campo de digitação é bloqueado e é necessário usar um template para reabrir o contato.",
    ],
    screenshots: [{ src: "/docs/send-03-template-modal.jpg", caption: "Modal “Enviar template aprovado”" }],
  },
  {
    title: "Passo 4 — Clique no botão Template",
    body: [
      `No rodapé da conversa, clique no botão “Template” na barra de mensagem.`,
      `Um modal chamado “Enviar template aprovado” será aberto. Ele lista apenas os templates aprovados pela Meta para o Workspace/Canal atual.`,
    ],
  },
  {
    title: "Passo 5 — Selecione um template",
    body: [
      `Clique no dropdown “Selecione um template”. Aparece a lista de todos os templates aprovados, mostrando o nome e o código de idioma (ex.: pt_BR, en_US).`,
      "Selecione o template desejado. Neste exemplo, escolhemos hello_world_v1, que contém 2 variáveis.",
    ],
    screenshots: [
      { src: "/docs/send-04-template-dropdown.jpg", caption: "Dropdown com templates aprovados" },
      { src: "/docs/send-05-template-selected.jpg", caption: "Modal com template selecionado" },
    ],
  },
  {
    title: "Passo 6 — Preencha as variáveis (se houver)",
    body: [
      `Se o template selecionado tem variáveis — como ativacao_01_PTBR — aparece a seção “Preencha as variáveis” com um campo por variável ({{1}}, {{2}}, etc.). Preencha um valor para cada campo. A seção Pré-visualização abaixo atualiza em tempo real, destacando os valores em azul — exatamente como o contato vai receber.`,
      "Exemplo: {{1}} = Curso de Panificação; {{2}} = R$ 297,00.",
      "Observação: se o template não tem variáveis (ex.: hello_world_v1), os campos de variáveis não aparecem e apenas a pré-visualização é exibida.",
    ],
    screenshots: [{ src: "/docs/send-06-fill-variables.jpg", caption: "Preenchimento das variáveis com pré-visualização" }],
  },
  {
    title: "Passo 7 — Envie o template",
    body: [
      `Após conferir a pré-visualização e confirmar que os valores estão corretos, clique no botão “Enviar”.`,
    ],
  },
  {
    title: "Passo 8 — Confirme a entrega na conversa",
    body: [
      `O modal fecha e a mensagem do template enviado aparece na timeline da conversa, claramente marcada com a tag “TEMPLATE: [nome_do_template]” no topo do balão, seguida do conteúdo completo da mensagem com as variáveis já substituídas.`,
      "Status de entrega que podem aparecer:",
      "• ✅ Entregue / Lida — mensagem enviada e entregue com sucesso.\n• ❌ Não entregue — a Meta rejeitou a mensagem (ex.: restrições de política de marketing, opt-out do usuário ou problema com o número). O motivo do erro é exibido abaixo da mensagem.",
    ],
    screenshots: [{ src: "/docs/send-07-delivered.jpg", caption: "Template enviado na timeline da conversa" }],
  },
];

const COPY = {
  en: {
    nav: { docs: "Documentation" },
    title: "MegaCRM — Documentation",
    subtitle: "How to create and submit WhatsApp message templates and send messages on MegaCRM.",
    intro:
      "MegaCRM is a multi-workspace CRM for WhatsApp Business that helps companies manage customer conversations, message templates and sales automations. This page documents how admins create and submit templates for Meta approval, and how agents send approved templates from the Inbox once the 24-hour conversation window has expired.",
    templates: {
      heading: "Creating & submitting templates",
      overview:
        "Message Templates are pre-approved message formats required for sending proactive WhatsApp messages outside the 24-hour customer-initiated window. All templates must be reviewed and approved by Meta before use. The initial status after submission is generally PENDING, and approval typically takes a few minutes.",
      steps: TEMPLATE_STEPS_EN,
    },
    messages: {
      heading: "Sending messages",
      overview:
        "When a contact’s 24-hour conversation window has expired, it is no longer possible to send free-form messages. In this case, only approved Meta templates can be used to re-engage the contact. The process is done directly from the Inbox conversation.",
      steps: MESSAGES_STEPS_EN,
    },
    privacy: {
      heading: "Privacy & data",
      body: [
        "Customer data is scoped per workspace and protected by row-level security. Tokens are stored server-side and never exposed to the browser.",
        "Read the full policy:",
      ],
      privacyLink: "Privacy Policy",
    },
    footer: "MegaCRM • Built on Meta’s WhatsApp Business Platform",
  },
  pt: {
    nav: { docs: "Documentação" },
    title: "MegaCRM — Documentação",
    subtitle:
      "Como criar e enviar templates de mensagem do WhatsApp e enviar mensagens no MegaCRM.",
    intro:
      "O MegaCRM é um CRM multi-workspace para WhatsApp Business que ajuda empresas a gerenciar conversas com clientes, templates de mensagem e automações de vendas. Esta página mostra como administradores criam e enviam templates para aprovação da Meta, e como agentes enviam templates aprovados pela Inbox após a janela de 24 horas expirar.",
    templates: {
      heading: "Criando e enviando templates",
      overview:
        "Templates de mensagem são formatos pré-aprovados necessários para envio proativo de mensagens fora da janela de 24 horas iniciada pelo cliente. Todos os templates precisam ser revisados e aprovados pela Meta antes do uso. O status inicial após o envio normalmente é PENDING e a aprovação costuma sair em poucos minutos.",
      steps: TEMPLATE_STEPS_PT,
    },
    messages: {
      heading: "Enviando mensagens",
      overview:
        "Quando a janela de 24 horas da conversa expira, não é mais possível enviar mensagens livres. Nesse caso, apenas templates aprovados pela Meta podem ser usados para reengajar o contato. O processo é feito diretamente na conversa da Inbox.",
      steps: MESSAGES_STEPS_PT,
    },
    privacy: {
      heading: "Privacidade e dados",
      body: [
        "Os dados dos clientes são isolados por workspace e protegidos por row-level security. Tokens ficam armazenados no servidor e nunca são expostos ao navegador.",
        "Leia a política completa:",
      ],
      privacyLink: "Política de Privacidade",
    },
    footer: "MegaCRM • Construído sobre o WhatsApp Business Platform da Meta",
  },
} as const;

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: "MegaCRM — Documentation: Templates & Messaging" },
      {
        name: "description",
        content:
          "Step-by-step guides to create and submit WhatsApp message templates for Meta approval and send approved templates from the MegaCRM Inbox.",
      },
      { property: "og:title", content: "MegaCRM — Documentation: Templates & Messaging" },
      {
        property: "og:description",
        content:
          "Step-by-step guides to create and submit WhatsApp message templates for Meta approval and send approved templates from the MegaCRM Inbox.",
      },
      { property: "og:type", content: "article" },
      { property: "og:url", content: "https://megacrm.megafone.digital/docs" },
    ],
    links: [{ rel: "canonical", href: "https://megacrm.megafone.digital/docs" }],
  }),
  component: DocsPage,
});

function Screenshot({ src, caption }: Screenshot) {
  return (
    <figure className="my-6 overflow-hidden rounded-lg border border-border bg-muted">
      <img src={src} alt={caption} loading="lazy" className="block w-full" />
      <figcaption className="border-t border-border bg-background/60 px-3 py-2 text-xs text-muted-foreground">
        {caption}
      </figcaption>
    </figure>
  );
}

function StepBlock({ step }: { step: Step }) {
  return (
    <div className="mt-8">
      <h3 className="text-lg font-semibold tracking-tight">{step.title}</h3>
      {step.body.map((p, i) => (
        <p key={i} className="mt-3 whitespace-pre-line leading-relaxed">
          {p}
        </p>
      ))}
      {step.variableTable && (
        <div className="mt-4 overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60">
              <tr>
                <th className="px-4 py-2 text-left font-medium">{step.variableTable.headers[0]}</th>
                <th className="px-4 py-2 text-left font-medium">{step.variableTable.headers[1]}</th>
              </tr>
            </thead>
            <tbody>
              {step.variableTable.rows.map((r, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-4 py-2 font-mono text-xs">{r[0]}</td>
                  <td className="px-4 py-2">{r[1]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {step.screenshots?.map((s, i) => (
        <Screenshot key={i} src={s.src} caption={s.caption} />
      ))}
    </div>
  );
}

function DocsPage() {
  const initialLang: Lang = useMemo(() => {
    if (typeof window === "undefined") return "en";
    const sp = new URLSearchParams(window.location.search);
    const v = sp.get("lang");
    return v === "pt" ? "pt" : "en";
  }, []);
  const [lang, setLang] = useState<Lang>(initialLang);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (lang === "en") url.searchParams.delete("lang");
    else url.searchParams.set("lang", lang);
    window.history.replaceState({}, "", url.toString());
  }, [lang]);

  const t = COPY[lang];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/" className="flex items-center gap-2">
            <img src={megacrmLogo} alt="MegaCRM" className="h-8 w-auto" />
            <span className="text-sm font-medium text-muted-foreground">{t.nav.docs}</span>
          </Link>
          <div className="flex items-center gap-1 rounded-md border border-border bg-card p-0.5">
            <Button size="sm" variant={lang === "en" ? "default" : "ghost"} className="h-7 px-3 text-xs" onClick={() => setLang("en")}>
              EN
            </Button>
            <Button size="sm" variant={lang === "pt" ? "default" : "ghost"} className="h-7 px-3 text-xs" onClick={() => setLang("pt")}>
              PT
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-4 py-10 lg:grid-cols-[220px_1fr]">
        <aside className="hidden lg:block">
          <nav className="sticky top-20 flex flex-col gap-1 text-sm">
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                {s[lang]}
              </a>
            ))}
          </nav>
        </aside>

        <main className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">{t.title}</h1>
          <p className="mt-3 text-base text-muted-foreground md:text-lg">{t.subtitle}</p>
          <p className="mt-6 leading-relaxed">{t.intro}</p>

          <section id="templates" className="mt-12 scroll-mt-20">
            <h2 className="text-2xl font-semibold tracking-tight">{t.templates.heading}</h2>
            <p className="mt-4 leading-relaxed">{t.templates.overview}</p>
            {t.templates.steps.map((step, i) => (
              <StepBlock key={i} step={step} />
            ))}
          </section>

          <section id="messages" className="mt-16 scroll-mt-20">
            <h2 className="text-2xl font-semibold tracking-tight">{t.messages.heading}</h2>
            <p className="mt-4 leading-relaxed">{t.messages.overview}</p>
            {t.messages.steps.map((step, i) => (
              <StepBlock key={i} step={step} />
            ))}
          </section>

          <section id="privacy" className="mt-16 scroll-mt-20">
            <h2 className="text-2xl font-semibold tracking-tight">{t.privacy.heading}</h2>
            {t.privacy.body.map((p, i) => (
              <p key={i} className="mt-4 leading-relaxed">{p}</p>
            ))}
            <p className="mt-2">
              <Link to="/privacidade" className="text-primary underline-offset-4 hover:underline">
                {t.privacy.privacyLink} →
              </Link>
            </p>
          </section>

          <footer className="mt-16 border-t border-border pt-6 text-sm text-muted-foreground">{t.footer}</footer>
        </main>
      </div>
    </div>
  );
}
