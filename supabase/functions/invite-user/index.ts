// invite-user: admin convida um novo usuário por email
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

  const { email, full_name, roles, channel_ids } = await req.json().catch(() => ({}));
  if (!email || typeof email !== "string") {
    return jsonResponse({ error: "Email é obrigatório." }, 400);
  }
  const validRoles = ["admin", "supervisor", "agent"];
  const roleList: string[] = Array.isArray(roles) ? roles.filter((r) => validRoles.includes(r)) : [];

  const admin = getAdminClient();

  // 1) convite por email (cria usuário se não existir)
  const origin = req.headers.get("origin") ?? undefined;
  const { data: invited, error: invErr } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: full_name ?? null, must_set_password: true },
    redirectTo: origin ? `${origin}/definir-senha` : undefined,
  });

  let userId: string | null = invited?.user?.id ?? null;

  if (invErr) {
    // possivelmente já existe — tentar localizar
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const existing = list?.users?.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
    if (!existing) {
      return jsonResponse({ error: invErr.message ?? "Falha ao convidar usuário." }, 400);
    }
    userId = existing.id;
  }

  if (!userId) return jsonResponse({ error: "Não foi possível obter o id do usuário." }, 500);

  // garante profile
  await admin
    .from("profiles")
    .upsert({ id: userId, email, full_name: full_name ?? null }, { onConflict: "id" });

  // papéis
  if (roleList.length) {
    const rows = roleList.map((role) => ({ user_id: userId, role }));
    await admin.from("user_roles").upsert(rows, { onConflict: "user_id,role" });
  }

  // canais
  if (Array.isArray(channel_ids) && channel_ids.length) {
    const rows = channel_ids.map((channel_id: string) => ({ user_id: userId, channel_id }));
    await admin.from("channel_agents").upsert(rows, { onConflict: "user_id,channel_id" });
  }

  return jsonResponse({ ok: true, user_id: userId, invited: !invErr });
});
