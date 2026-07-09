export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>MegaCRM — Erro inesperado</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, "Helvetica Neue", Arial, sans-serif;
    background: #0b0b0d;
    color: #f4f4f5;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .card {
    max-width: 460px;
    width: 100%;
    text-align: center;
  }
  h1 {
    font-size: 22px;
    font-weight: 600;
    margin: 0 0 8px;
  }
  p {
    color: #a1a1aa;
    font-size: 14px;
    line-height: 1.5;
    margin: 0 0 24px;
  }
  .actions {
    display: flex;
    gap: 8px;
    justify-content: center;
    flex-wrap: wrap;
  }
  button, a.btn {
    appearance: none;
    border: 1px solid #27272a;
    background: #18181b;
    color: #f4f4f5;
    padding: 10px 18px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  button.primary {
    background: #2563eb;
    border-color: #2563eb;
  }
  button:hover, a.btn:hover { opacity: 0.9; }
</style>
</head>
<body>
  <div class="card">
    <h1>Algo deu errado</h1>
    <p>Não foi possível carregar esta página agora. Tente novamente em instantes.</p>
    <div class="actions">
      <button class="primary" onclick="location.reload()">Tentar novamente</button>
      <a class="btn" href="/">Ir para o início</a>
    </div>
  </div>
</body>
</html>`;
}
