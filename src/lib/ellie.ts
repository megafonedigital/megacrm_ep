// Helper para isolar features exclusivas do workspace Ellie.
// Todas as novas funcionalidades de IA (funções/tools, voz, botões, threads,
// validação de aluno) ficam visíveis somente quando este helper retorna true.

export const ELLIE_BRAND_ID = "8569eeff-0a3a-42af-91a3-2145dcbccbfe";

export function isEllie(brandId: string | null | undefined): boolean {
  return !!brandId && brandId === ELLIE_BRAND_ID;
}
