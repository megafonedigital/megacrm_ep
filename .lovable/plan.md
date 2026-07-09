# Pastas de Pipelines

Organizar pipelines em pastas dentro de cada workspace, similar ao que já existe para automações (`automation_folders`) e tags (`tag_folders`).

## Banco de dados

Nova tabela `pipeline_folders`:
- `brand_id` (workspace, obrigatório)
- `name`, `color` (opcional), `position` (para ordenar)
- `created_by`
- RLS: mesmos padrões das outras tabelas de pastas (membros do workspace leem; admin/supervisor/dev escrevem)
- GRANTs para `authenticated` e `service_role`

Alteração em `pipelines`:
- Nova coluna `folder_id uuid` referenciando `pipeline_folders(id) ON DELETE SET NULL`
- Índice em `(brand_id, folder_id)`
- Atualizar a função RPC `get_pipelines_with_counts` para retornar `folder_id`

## UI — `/pipelines` (lista)

Layout com sidebar esquerda de pastas + grade de pipelines à direita:

```text
┌─────────────────┬──────────────────────────────────────┐
│ Pastas          │ [busca] [Modelos] [Novo pipeline]    │
│ • Todos         │                                       │
│ • Sem pasta     │ ┌──────┐ ┌──────┐ ┌──────┐           │
│ ─────────────   │ │ card │ │ card │ │ card │           │
│ 📁 Vendas       │ └──────┘ └──────┘ └──────┘           │
│ 📁 Suporte      │                                       │
│ + Nova pasta    │                                       │
└─────────────────┴──────────────────────────────────────┘
```

Comportamento:
- Filtros: "Todos", "Sem pasta", ou uma pasta específica
- Busca continua funcionando dentro do filtro selecionado
- Card do pipeline exibe pequeno badge com o nome da pasta quando em "Todos"
- Menu "…" na pasta: renomear, mudar cor, excluir (excluir só remove a pasta; pipelines caem em "Sem pasta")
- Botão "Nova pasta" abre diálogo simples (nome + cor)
- Arrastar-e-soltar de pipelines entre pastas usando dnd-kit (mesma lib já usada no projeto). Alternativa: menu "Mover para pasta" em cada card — implementarei ambos: DnD + item de menu no card.

## Diálogo de pipeline

`PipelineFormDialog` ganha um campo "Pasta" (select opcional) para escolher/alterar a pasta ao criar/editar.

## Permissões

Só admin/supervisor/dev podem criar, renomear, excluir pastas e mover pipelines entre pastas (mesma regra de `canManage` já usada na tela). Demais usuários apenas visualizam e filtram.

## Escopo por workspace

Tudo é escopado por `activeBrandId`. Cada workspace tem suas próprias pastas — trocando o workspace no topo, a lista de pastas muda junto.

## Arquivos afetados

- Migration: nova tabela `pipeline_folders`, coluna `folder_id` em `pipelines`, atualização do RPC
- `src/routes/pipelines.index.tsx` — sidebar de pastas, filtro, DnD
- `src/components/pipelines/PipelineFormDialog.tsx` — campo pasta
- Novos: `src/components/pipelines/PipelineFolderDialog.tsx` (criar/editar pasta), `src/components/pipelines/PipelineFoldersSidebar.tsx`
