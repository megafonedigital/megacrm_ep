/**
 * Erros conhecidos da Meta WhatsApp Cloud API — mesma classificação do
 * broadcasts-engine.server.ts do app.
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/
 *
 * - 130429/429: rate limit (MPS) — retry rápido.
 * - 80007: tier diário atingido — fail-all do broadcast.
 * - 131048: qualidade do número baixa — fail-all, precisa atenção manual.
 * - 131049/131026/131050/130472/131053: permanentes por contato — fail direto.
 */
export function classifyMetaError(errText) {
  if (/\b130429\b/.test(errText) || /\b429\b/.test(errText) || /rate limit/i.test(errText)) {
    return "rate_limit";
  }
  if (/\b80007\b/.test(errText)) return "daily_tier";
  if (/\b131048\b/.test(errText)) return "quality";
  if (
    /\b131049\b/.test(errText) ||
    /\b131026\b/.test(errText) ||
    /\b131050\b/.test(errText) ||
    /\b130472\b/.test(errText) ||
    /\b131053\b/.test(errText)
  ) {
    return "permanent_contact";
  }
  return null;
}
