-- Backfill messages.error_message and error_logs.message_pt with PT translations
-- for Meta error codes we just added to META_ERROR_PT.

WITH translations(code, message_pt) AS (
  VALUES
    ('131026', 'Mensagem não entregue. O número pode não ter WhatsApp ativo, ter bloqueado a marca ou estar temporariamente indisponível.'),
    ('131021', 'Não é permitido enviar mensagem para o próprio número.'),
    ('131031', 'Conta do destinatário foi desativada.'),
    ('131045', 'Template foi pausado ou rejeitado pela Meta.'),
    ('131049', 'Mensagem de marketing rejeitada por política da Meta.'),
    ('131057', 'Conta da empresa restrita pela Meta.'),
    ('131000', 'Falha temporária da Meta. Tente novamente em instantes.'),
    ('131005', 'Acesso negado pela Meta.'),
    ('131008', 'Parâmetro obrigatório ausente na mensagem.'),
    ('131009', 'Parâmetro inválido na mensagem.'),
    ('131016', 'Serviço da Meta indisponível temporariamente.'),
    ('132005', 'Variáveis do template não correspondem ao conteúdo aprovado.'),
    ('132007', 'Formato do template incorreto.'),
    ('132012', 'Parâmetros do template inválidos.'),
    ('132015', 'Template pausado por baixa qualidade.'),
    ('132016', 'Template desativado por violação de política.')
)
UPDATE public.messages m
SET error_message = t.message_pt
FROM translations t
WHERE m.error_code = t.code
  AND (m.error_message IS NULL OR m.error_message = '' OR m.error_message = 'Message undeliverable' OR m.error_message ~ '^[A-Z][a-z]+ [a-z]+' );

WITH translations(code, message_pt) AS (
  VALUES
    ('131026', 'Mensagem não entregue. O número pode não ter WhatsApp ativo, ter bloqueado a marca ou estar temporariamente indisponível.'),
    ('131021', 'Não é permitido enviar mensagem para o próprio número.'),
    ('131031', 'Conta do destinatário foi desativada.'),
    ('131045', 'Template foi pausado ou rejeitado pela Meta.'),
    ('131049', 'Mensagem de marketing rejeitada por política da Meta.'),
    ('131057', 'Conta da empresa restrita pela Meta.'),
    ('131000', 'Falha temporária da Meta. Tente novamente em instantes.'),
    ('131005', 'Acesso negado pela Meta.'),
    ('131008', 'Parâmetro obrigatório ausente na mensagem.'),
    ('131009', 'Parâmetro inválido na mensagem.'),
    ('131016', 'Serviço da Meta indisponível temporariamente.'),
    ('132005', 'Variáveis do template não correspondem ao conteúdo aprovado.'),
    ('132007', 'Formato do template incorreto.'),
    ('132012', 'Parâmetros do template inválidos.'),
    ('132015', 'Template pausado por baixa qualidade.'),
    ('132016', 'Template desativado por violação de política.')
)
UPDATE public.error_logs el
SET message_pt = t.message_pt
FROM translations t
WHERE el.code = t.code
  AND (el.message_pt = el.code OR el.message_pt = 'Message undeliverable');