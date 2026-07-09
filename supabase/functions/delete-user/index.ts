// delete-user: admin remove um usuário (auth + dependências)
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient, requireRole, requireUser } from "../_shared/supabase.ts";

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

  const { user } = await requireUser(req);
  const { user_id } = await req.json().catch(() => ({}));
  if (!user_id || typeof user_id !== "string") {
    return jsonResponse({ error: "user_id é obrigatório." }, 400);
  }
  if (user_id === user.id) {
    return jsonResponse({ error: "Você não pode excluir a si mesmo." }, 400);
  }

  const admin = getAdminClient();

  // checa se o usuário possui mensagens enviadas (preservar histórico)
  const { count } = await admin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("sent_by", user_id);

  // limpa dependências (FKs com cascade já removeriam, mas garantimos)
  await admin.from("user_roles").delete().eq("user_id", user_id);
  await admin.from("channel_agents").delete().eq("user_id", user_id);
  await admin.from("agent_presence").delete().eq("user_id", user_id);

  // remove do auth (cascateia profiles via trigger? — não há, então deletamos profile só se não houver msgs)
  const { error: authErr } = await admin.auth.admin.deleteUser(user_id);
  if (authErr) return jsonResponse({ error: authErr.message }, 400);

  if ((count ?? 0) === 0) {
    await admin.from("profiles").delete().eq("id", user_id);
  } else {
    // mantém o profile mas marca inativo para preservar referência em messages.sent_by
    await admin.from("profiles").update({ active: false, email: null }).eq("id", user_id);
  }

  return jsonResponse({ ok: true, preserved_profile: (count ?? 0) > 0 });
});
