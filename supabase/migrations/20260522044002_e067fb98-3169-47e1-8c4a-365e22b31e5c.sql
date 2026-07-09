alter table public.ai_knowledge_products
  drop column if exists sku,
  add column if not exists summary text not null default '',
  add column if not exists description text not null default '';