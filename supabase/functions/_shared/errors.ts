// Mapeamento de códigos de erro Meta -> mensagem em PT-BR
import { getAdminClient } from "./supabase.ts";

export type Severity = "info" | "warning" | "error" | "critical";

export const META_ERROR_PT: Record<string, string> = {
  // Conexão / autenticação
  "10": "Permissão da aplicação insuficiente.",
  "100": "Parâmetro inválido enviado para a Meta.",
  "190": "Token da Meta inválido ou expirado. Atualize as credenciais da marca.",
  "200": "Permissão insuficiente no token da Meta.",
  "368": "Conta temporariamente bloqueada pela Meta.",
  // Plataforma / disponibilidade
  "131000": "Falha temporária da Meta. Tente novamente em instantes.",
  "131005": "Acesso negado pela Meta.",
  "131008": "Parâmetro obrigatório ausente na mensagem.",
  "131009": "Parâmetro inválido na mensagem.",
  "131016": "Serviço da Meta indisponível temporariamente.",
  // Entrega
  "131021": "Não é permitido enviar mensagem para o próprio número.",
  "131026": "Mensagem não entregue. O número pode não ter WhatsApp ativo, ter bloqueado a marca ou estar temporariamente indisponível.",
  "131031": "Conta do destinatário foi desativada.",
  "131045": "Template foi pausado ou rejeitado pela Meta.",
  "131047": "Janela de 24 horas expirou. Use um template aprovado para continuar a conversa.",
  "131049": "Mensagem de marketing rejeitada por política da Meta.",
  "131051": "Tipo de mensagem não suportado pela Meta.",
  "131052": "Mídia não pôde ser baixada.",
  "131053": "Mídia não pôde ser enviada.",
  "131056": "Limite de mensagens (par-de-negócio) atingido. Tente novamente mais tarde.",
  "131057": "Conta da empresa restrita pela Meta.",
  // Template
  "132000": "Template não encontrado ou não aprovado.",
  "132001": "Template em idioma diferente do esperado.",
  "132005": "Variáveis do template não correspondem ao conteúdo aprovado.",
  "132007": "Formato do template incorreto.",
  "132012": "Parâmetros do template inválidos.",
  "132015": "Template pausado por baixa qualidade.",
  "132016": "Template desativado por violação de política.",
  // Número
  "133010": "Número de telefone não registrado na Meta.",
};

export function translateMetaError(code?: string | number, fallback = "Falha ao se comunicar com a Meta."): string {
  if (code == null) return fallback;
  return META_ERROR_PT[String(code)] ?? fallback;
}

export interface LogErrorInput {
  severity: Severity;
  category: "meta_api" | "webhook" | "auth" | "validation" | "internal" | "media";
  code: string;
  messagePt: string;
  technicalMessage?: string;
  brandId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  userId?: string | null;
  payload?: unknown;
}

export async function logError(input: LogErrorInput) {
  try {
    const admin = getAdminClient();
    await admin.from("error_logs").insert({
      severity: input.severity,
      category: input.category,
      code: input.code,
      message_pt: input.messagePt,
      technical_message: input.technicalMessage ?? null,
      brand_id: input.brandId ?? null,
      conversation_id: input.conversationId ?? null,
      message_id: input.messageId ?? null,
      user_id: input.userId ?? null,
      payload: input.payload ?? null,
    });
  } catch (e) {
    console.error("[logError] failed:", e);
  }
}
