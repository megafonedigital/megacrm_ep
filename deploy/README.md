# Deploy do MegaCRM — Docker / EasyPanel

Stack completa em um único `docker-compose.yml`: app web, worker dedicado de
broadcasts, cron sidecar e Supabase self-hosted (Postgres, Auth, Realtime,
Storage, Edge Functions, Studio).

```
┌────────────────────────── VPS (GCP) ──────────────────────────┐
│                                                               │
│  web (TanStack/Node) ── worker (broadcasts) ── cron (sidecar) │
│        │                     │                     │          │
│        ▼                     ▼                     ▼          │
│  kong :8000 ──► auth │ rest │ realtime │ storage │ functions  │
│        │                                            │         │
│        └────────────────► db (Postgres 17) ◄────────┘         │
│                                                               │
│  migrate (one-shot: aplica supabase/migrations/*.sql)         │
└───────────────────────────────────────────────────────────────┘
```

## Passo a passo

### 1. Preparar o repositório

```bash
cp deploy/.env.example .env
node deploy/generate-keys.mjs     # gera POSTGRES_PASSWORD, JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY...
```

Edite o `.env` e preencha as URLs públicas:

| Variável | Valor |
|---|---|
| `SITE_URL` | URL pública do app, ex. `https://crm.megafone.digital` |
| `API_EXTERNAL_URL` / `SUPABASE_PUBLIC_URL` | URL pública do Supabase (kong), ex. `https://api.megafone.digital` |

Commite tudo **menos o `.env`** (já está no .gitignore) e suba para o GitHub.

### 2. EasyPanel

1. Crie um projeto → **App from Source** → conecte o repositório GitHub.
2. Tipo: **Docker Compose** (o EasyPanel detecta o `docker-compose.yml` na raiz).
3. Cole o conteúdo do seu `.env` local na seção **Environment** do projeto.
4. Domínios:
   - `crm.seudominio.com` → serviço `web`, porta `3000`
   - `api.seudominio.com` → serviço `kong`, porta `8000`
5. Deploy. O primeiro sobe o Postgres, roda `migrate` (aplica as ~280
   migrations) e então inicia web/worker/cron.

### 3. Primeiro acesso

- **Studio** (admin do banco): `https://api.seudominio.com` → login com
  `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`.
- **Criar o primeiro usuário**: Studio → Authentication → Add user
  (ou o fluxo de cadastro do app em `SITE_URL/cadastro`).
- **Secrets das edge functions**: as functions que falam com a Meta
  (webhook-receiver, send-message...) esperam os mesmos secrets do projeto
  hosted (tokens da Meta etc.). Configure via Studio → SQL ou variáveis extra
  no serviço `functions`, conforme sua configuração de canais na UI.

### 4. Verificar broadcasts

```bash
# logs do worker — deve mostrar os loops ativos
docker compose logs -f worker
# [worker] iniciado — tick=5000ms concurrency=100 batch=300 ...

# health do worker
docker compose exec worker wget -qO- http://127.0.0.1:8080/healthz
```

Crie um broadcast de teste na UI com uma tag pequena. No log do worker você
verá `[tick] enqueued=...` seguido de `[drain] claimed=... dispatched=...`.

## Escalando

| Cenário | Ação |
|---|---|
| Mais throughput de disparo | `WORKER_DRAIN_CONCURRENCY=200`, `WORKER_DRAIN_BATCH_SIZE=500` |
| Muito mais throughput | réplicas do worker: `docker compose up -d --scale worker=3` — seguro, coordenação via Postgres (SKIP LOCKED + token bucket) |
| Mais usuários simultâneos na UI | réplicas do web atrás do proxy do EasyPanel |
| Banco sob pressão | aumentar recursos do serviço `db`; ver `shared_buffers` no postgresql.conf da imagem |

Dimensionamento de referência (VPS GCP):

| Volume | Máquina |
|---|---|
| até 300 msg/min | e2-standard-2 (2 vCPU / 8 GB) |
| até 3.000 msg/min | e2-standard-4 (4 vCPU / 16 GB) |
| 10.000+ msg/min | e2-standard-8 + réplicas do worker |

## Migração dos dados do Supabase hosted

Para trazer os dados do projeto hosted (`mynmvycwhfexwhyzxnzp`):

```bash
# 1. Dump do hosted (só dados; o schema vem das migrations)
pg_dump "postgres://postgres:[SENHA]@db.mynmvycwhfexwhyzxnzp.supabase.co:5432/postgres" \
  --data-only --schema=public --schema=auth --schema=storage > dump.sql

# 2. Restore no self-hosted
docker compose exec -T db psql -U postgres -d postgres < dump.sql
```

Faça isso APÓS o `migrate` ter rodado (schema pronto) e ANTES de apontar o
DNS/webhooks da Meta para o novo ambiente.

## Observações

- **Lovable continua funcionando**: o build Cloudflare padrão não foi
  alterado — o target Node só é ativado com `NITRO_PRESET=node-server`
  (é o que o Dockerfile faz). Você pode seguir editando pelo Lovable e
  fazendo deploy no EasyPanel a partir do mesmo repo.
- **Webhooks da Meta**: aponte para
  `https://api.seudominio.com/functions/v1/webhook-receiver`.
- **MCP local**: o servidor em `mcp/` funciona contra o self-hosted — troque
  `SUPABASE_URL` para `https://api.seudominio.com` e use a nova
  `SERVICE_ROLE_KEY`, e configure `APP_URL=https://crm.seudominio.com`.
- **Backups**: volume `db-data` guarda o Postgres. Configure backup de volume
  no EasyPanel ou `pg_dump` agendado.
