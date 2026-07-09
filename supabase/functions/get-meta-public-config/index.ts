// get-meta-public-config: retorna IDs públicos do app Meta (app_id e config_id)
// usados pelo botão de Embedded Signup no client. Os secrets (APP_SECRET) NUNCA
// são expostos. Requer auth de admin para evitar expor IDs ao público geral.
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { requireRole } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const pf = handlePreflight(req);
  if (pf) return pf;

  try {
    await requireRole(req, ["admin"]);
  } catch (e) {
    if (e instanceof Response) return e;
    return jsonResponse({ error: "forbidden" }, 403);
  }

  const app_id = Deno.env.get("META_APP_ID") ?? null;
  const config_id = Deno.env.get("META_EMBEDDED_SIGNUP_CONFIG_ID") ?? null;
  if (!app_id || !config_id) {
    return jsonResponse({ error: "Configuração Meta incompleta no servidor." }, 500);
  }
  return jsonResponse({ app_id, config_id, graph_version: "v21.0" });
});
