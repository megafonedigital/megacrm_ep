UPDATE public.ai_agents
SET system_prompt = REPLACE(
  REPLACE(
    system_prompt,
    'Etapa 3 — Facilitação Envie o link com UTM usando send_product_link. Ancoragem objetiva: "Esse produto foi pensado exatamente pra [situação dele]".',
    'Etapa 3 — Facilitação Compartilhe o link do produto exatamente como está cadastrado na base de conhecimento (NUNCA monte ou edite a URL). Ancoragem objetiva: "Esse produto foi pensado exatamente pra [situação dele]".'
  ),
  E'send_product_link\n\nproduto: nome conforme catálogo da base de conhecimento\nlink: SEMPRE o link com UTM da base de conhecimento — NUNCA gere ou edite URL manualmente\nUse send_product_link na 1ª menção de um produto ou quando o contato pedir o link.\n\n',
  ''
)
WHERE id = '150a246e-4ffc-4563-a6db-08a85fa68b8b';