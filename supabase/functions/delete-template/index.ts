// delete-template: remove um template HSM da Meta e do banco
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient, requireRole } from "../_shared/supabase.ts";
import { getChannelToken } from "../_shared/vault.ts";
import { deleteTemplateByName } from "../_shared/meta.ts";
import { logError, translateMetaError } from "../_shared/errors.ts";

Deno.serve(async (req) => {
  const pf = handlePreflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    await requireRole(req, ["admin", "supervisor", "developer"]);
  } catch (e) {
    if (e instanceof Response) return e;
    return jsonResponse({ error: "forbidden" }, 403);
  }

  const { template_id } = await req.json().catch(() => ({}));
  if (!template_id) return jsonResponse({ error: "template_id obrigatório" }, 400);

  const admin = getAdminClient();
  const { data: tpl } = await admin
    .from("whatsapp_templates")
    .select("id, brand_id, channel_id, name, meta_template_id")
    .eq("id", template_id)
    .single();
  if (!tpl) return jsonResponse({ error: "Template não encontrado." }, 404);

  const { data: ch } = await admin
    .from("brand_channels")
    .select("waba_id")
    .eq("id", tpl.channel_id ?? "")
    .single();

  if (ch?.waba_id) {
    let token: string | null = null;
    try {
      token = await getChannelToken(tpl.channel_id!);
    } catch (_e) {
      return jsonResponse({ error: "Token do canal não configurado.", error_pt: "Token do canal não configurado." }, 400);
    }
    const res = await deleteTemplateByName({
      token,
      wabaId: ch.waba_id,
      name: tpl.name,
      hsmId: tpl.meta_template_id ?? undefined,
    });
    if (!res.ok) {
      const code = String(res.error?.code ?? "META_ERR");
      const techMsg = res.error?.message ?? "Erro Meta";
      const msg = translateMetaError(code, techMsg);
      await logError({
        severity: "warning", category: "meta_api", code,
        messagePt: msg, brandId: tpl.brand_id,
        technicalMessage: techMsg, payload: res.raw,
      });
      // Se a Meta diz "não existe / já foi removido", seguimos para apagar localmente.
      const notFound = code === "100" && /does not exist|nonexisting|no template/i.test(techMsg);
      if (!notFound) {
        return jsonResponse({
          error: `Meta recusou a exclusão: ${techMsg}. O token deste canal precisa ter permissão whatsapp_business_management e ser dono da WABA.`,
          error_pt: `Meta recusou a exclusão (#${code}): ${techMsg}`,
        }, 400);
      }
    }
  }

  const { error } = await admin.from("whatsapp_templates").delete().eq("id", template_id);
  if (error) return jsonResponse({ error: error.message }, 500);
  return jsonResponse({ ok: true });
});
