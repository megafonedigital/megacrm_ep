import { createFileRoute } from "@tanstack/react-router";

const spec = {
  openapi: "3.1.0",
  info: {
    title: "MegaCRM Public API",
    version: "1.0.0",
    description:
      "API pública do MegaCRM para integração com sistemas externos. Autenticação via API Key por Expert (header `Authorization: Bearer mck_...`). Crie chaves em /admin/api-keys.",
  },
  servers: [{ url: "/", description: "Servidor atual" }],
  security: [{ bearerAuth: [] }],
  tags: [
    { name: "Contatos", description: "Gerenciamento de contatos" },
    { name: "Tags", description: "Tags de contatos (disparam automações por tag)" },
    { name: "Automações", description: "Disparo manual de automações" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "API Key",
        description: "API Key da Expert no formato `mck_...`",
      },
    },
    schemas: {
      Error: {
        type: "object",
        properties: { error: { type: "string" } },
        required: ["error"],
      },
      Contact: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string", nullable: true },
          profile_name: { type: "string", nullable: true },
          phone: { type: "string", nullable: true },
          wa_id: { type: "string" },
          metadata: {
            type: "object",
            additionalProperties: true,
            properties: { tags: { type: "array", items: { type: "string" } } },
          },
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" },
        },
      },
      ContactsList: {
        type: "object",
        properties: {
          data: { type: "array", items: { $ref: "#/components/schemas/Contact" } },
          page: { type: "integer" },
          page_size: { type: "integer" },
          total: { type: "integer" },
        },
      },
      UpsertContactBody: {
        type: "object",
        required: ["phone"],
        properties: {
          phone: { type: "string", description: "Telefone E.164 ou apenas dígitos", example: "5511999998888" },
          name: { type: "string" },
          profile_name: { type: "string" },
          metadata: { type: "object", additionalProperties: true },
          tags: { type: "array", items: { type: "string" }, maxItems: 50 },
        },
      },
      UpsertContactResponse: {
        type: "object",
        properties: {
          contact_id: { type: "string", format: "uuid" },
          created: { type: "boolean" },
        },
      },
      TagsBody: {
        type: "object",
        required: ["tags"],
        properties: { tags: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 50 } },
      },
      TagsResponse: {
        type: "object",
        properties: {
          tags: { type: "array", items: { type: "string" } },
          added: { type: "array", items: { type: "string" } },
        },
      },
      TriggerBody: {
        type: "object",
        properties: {
          contact_id: { type: "string", format: "uuid", description: "ID do contato (alternativa a phone/email)" },
          phone: { type: "string", description: "Telefone do contato — fica disponível como {{contact_phone}}" },
          email: { type: "string", format: "email", description: "E-mail do contato — fica disponível como {{contact_email}}" },
          variables: { type: "object", additionalProperties: true, description: "Variáveis adicionais para a execução" },
        },
        description: "Forneça pelo menos um entre `contact_id`, `phone` ou `email`. Os campos do sistema (phone, email) ficam disponíveis nos nós seguintes como variáveis.",
      },
      TriggerResponse: {
        type: "object",
        properties: { run_id: { type: "string", format: "uuid" }, ok: { type: "boolean" } },
      },
    },
    responses: {
      Unauthorized: {
        description: "API Key inválida ou ausente",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      NotFound: {
        description: "Recurso não encontrado",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      BadRequest: {
        description: "Body ou parâmetros inválidos",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
    },
  },
  paths: {
    "/api/public/v1/contacts": {
      get: {
        tags: ["Contatos"],
        summary: "Listar contatos",
        parameters: [
          { name: "search", in: "query", schema: { type: "string" }, description: "Busca por nome, telefone ou wa_id" },
          { name: "tag", in: "query", schema: { type: "string" }, description: "Filtrar por tag" },
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "page_size", in: "query", schema: { type: "integer", default: 25, maximum: 100 } },
        ],
        responses: {
          "200": {
            description: "Lista paginada",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ContactsList" } } },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
      post: {
        tags: ["Contatos"],
        summary: "Criar ou atualizar contato (upsert por telefone)",
        description:
          "Faz upsert do contato baseado no telefone (campo `wa_id`). Tags adicionadas disparam automações com gatilho `tag_added` correspondentes.",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/UpsertContactBody" } } },
        },
        responses: {
          "200": {
            description: "Contato atualizado",
            content: { "application/json": { schema: { $ref: "#/components/schemas/UpsertContactResponse" } } },
          },
          "201": {
            description: "Contato criado",
            content: { "application/json": { schema: { $ref: "#/components/schemas/UpsertContactResponse" } } },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/api/public/v1/contacts/{id}": {
      get: {
        tags: ["Contatos"],
        summary: "Detalhe de um contato",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": {
            description: "Contato",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Contact" } } },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/api/public/v1/contacts/{id}/tags": {
      post: {
        tags: ["Tags"],
        summary: "Adicionar tags ao contato",
        description: "Tags novas disparam automações com gatilho `tag_added`.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/TagsBody" } } },
        },
        responses: {
          "200": {
            description: "Tags atualizadas",
            content: { "application/json": { schema: { $ref: "#/components/schemas/TagsResponse" } } },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      delete: {
        tags: ["Tags"],
        summary: "Remover tags do contato",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/TagsBody" } } },
        },
        responses: {
          "200": {
            description: "Tags restantes",
            content: {
              "application/json": {
                schema: { type: "object", properties: { tags: { type: "array", items: { type: "string" } } } },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/api/public/v1/automations/{id}/trigger": {
      post: {
        tags: ["Automações"],
        summary: "Disparar automação manualmente",
        description:
          "Inicia uma execução para o contato indicado. Funciona com automações de gatilho `manual` ou `tag` (override). A automação precisa estar com status `active` e o contato precisa ter ao menos uma conversa.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/TriggerBody" } } },
        },
        responses: {
          "200": {
            description: "Execução iniciada",
            content: { "application/json": { schema: { $ref: "#/components/schemas/TriggerResponse" } } },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": {
            description: "Automação não pertence à sua Expert",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": {
            description: "Contato sem conversa existente",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
  },
} as const;

export const Route = createFileRoute("/api/public/v1/openapi.json")({
  server: {
    handlers: {
      GET: async () =>
        new Response(JSON.stringify(spec), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=60",
            "Access-Control-Allow-Origin": "*",
          },
        }),
    },
  },
});
