import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "./cors.ts";

export function getAdminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

export function getUserClient(req: Request): SupabaseClient {
  const authHeader = req.headers.get("Authorization") ?? "";
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );
}

function errorResponse(status: number, error: string, error_pt: string) {
  return new Response(JSON.stringify({ error, error_pt }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export async function requireUser(req: Request) {
  const userClient = getUserClient(req);
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) {
    throw errorResponse(401, "unauthorized", "Sessão expirada. Faça login novamente.");
  }
  return { user: data.user, userClient };
}

export async function requireRole(
  req: Request,
  roles: Array<"admin" | "supervisor" | "agent" | "developer">
) {
  const { user } = await requireUser(req);
  const admin = getAdminClient();
  const { data } = await admin.from("user_roles").select("role").eq("user_id", user.id);
  const userRoles = (data ?? []).map((r) => r.role);
  const ok = userRoles.some((r) => roles.includes(r as never));
  if (!ok) {
    throw errorResponse(403, "forbidden", "Você não tem permissão para esta ação.");
  }
  return { user, roles: userRoles };
}
