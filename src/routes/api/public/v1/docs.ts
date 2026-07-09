import { createFileRoute } from "@tanstack/react-router";

const HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MegaCRM — Documentação da API</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    body { margin: 0; background: #fafafa; }
    .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js" crossorigin></script>
  <script>
    window.addEventListener("load", function () {
      window.ui = SwaggerUIBundle({
        url: "/api/public/v1/openapi.json",
        dom_id: "#swagger-ui",
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset.slice(1)],
        layout: "BaseLayout",
        docExpansion: "list",
        persistAuthorization: true,
        tryItOutEnabled: true,
      });
    });
  </script>
</body>
</html>`;

export const Route = createFileRoute("/api/public/v1/docs")({
  server: {
    handlers: {
      GET: async () => new Response(HTML, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" },
      }),
    },
  },
});
