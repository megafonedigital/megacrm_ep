// delete-brand: admin remove uma marca (com checagem de conversas)
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient, requireRole } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const pf = handlePreflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return jsonResponse({ error: "Método não permitido" }, 405);

  try {
    await requireRole(req, ["admin"]);
  } catch (e) {
    if (e instanceof Response) return e;
    return jsonResponse({ error: "Acesso negado." }, 403);
  }

  const { brand_id } = await req.json().catch(() => ({}));
  if (!brand_id || typeof brand_id !== "string") {
    return jsonResponse({ error: "brand_id é obrigatório." }, 400);
  }

  const admin = getAdminClient();

  const { count: convCount } = await admin
    .from("conversations")
    .select("id", { count: "exact", head: true })
    .eq("brand_id", brand_id);

  if ((convCount ?? 0) > 0) {
    return jsonResponse({
      error: `Esta marca tem ${convCount} conversa(s). Desative em vez de excluir para preservar o histórico.`,
      conversations: convCount,
    }, 409);
  }

  // FKs em cascade removem teams, brand_secrets, whatsapp_templates, agent_brands, round_robin_state
  const { error } = await admin.from("brands").delete().eq("id", brand_id);
  if (error) return jsonResponse({ error: error.message }, 400);

  return jsonResponse({ ok: true });
});
