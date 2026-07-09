# MegaCRM MCP

Servidor MCP (stdio) para gerenciar broadcasts, filas e audiências do MegaCRM
direto do Claude Code.

## Instalação

```bash
cd mcp
npm install
```

## Registro no Claude Code

```bash
claude mcp add megacrm \
  -e SUPABASE_URL=https://mynmvycwhfexwhyzxnzp.supabase.co \
  -e SUPABASE_SERVICE_ROLE_KEY=<service_role_key> \
  -e APP_URL=<url_do_app_deployado> \
  -- node C:/Users/Afonso/Desktop/megacrm1-main/mcp/server.js
```

A `SUPABASE_SERVICE_ROLE_KEY` está em **Supabase Dashboard → Settings → API →
service_role (secret)**. `APP_URL` é opcional — só é usada pelas ferramentas
`run_broadcast_loop` / `run_reconcile`.

## Ferramentas

| Ferramenta | O que faz |
|---|---|
| `list_brands` | Workspaces (para descobrir brandId) |
| `list_automations` | Automações de um workspace |
| `list_tags` | Tags de contato (audiência) |
| `list_broadcasts` | Broadcasts com progresso |
| `get_broadcast` | Detalhes + taxa real + fila de um broadcast |
| `preview_audience` | Quantos contatos uma audiência atinge |
| `create_broadcast` | Cria (e dispara) um broadcast |
| `cancel_broadcast` | Cancela broadcast ativo |
| `update_broadcast_rate` | Ajusta msgs/min em tempo real |
| `queue_health` | Tokens, contagens da fila, itens travados |
| `check_stuck_dispatches` | Diagnóstico de itens presos |
| `list_failed_targets` | Falhas agrupadas por erro |
| `run_broadcast_loop` | Dispara o cron tick+drain manualmente |
| `run_reconcile` | Dispara a reconciliação manualmente |

## Exemplos de uso (falando com o Claude)

- "Lista os broadcasts rodando agora"
- "Qual a saúde da fila de disparo?"
- "Cria um broadcast 'Promo Julho' para a tag VIP a 120 msg/min"
- "Reduz a velocidade do broadcast X para 60/min"
- "Por que o broadcast Y está com falhas?"
