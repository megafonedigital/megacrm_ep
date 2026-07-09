// upsert-template: cria ou edita um template HSM na Meta e persiste no banco
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient, requireRole } from "../_shared/supabase.ts";
import { getChannelToken } from "../_shared/vault.ts";
import { createTemplate, updateTemplate } from "../_shared/meta.ts";
import { logError, translateMetaError } from "../_shared/errors.ts";

interface Body {
  channel_id: string;
  template_id?: string; // se enviado: edição (PATCH em meta_template_id)
  name: string;
  category: "UTILITY" | "MARKETING" | "AUTHENTICATION";
  language: string;
  components: Array<Record<string, unknown>>;
  header_type?: string | null;
  header_handle?: string | null;
  header_media_url?: string | null;
  header_media_mime?: string | null;
  header_media_filename?: string | null;
  variable_bindings?: Array<Record<string, unknown>> | null;
}

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

  const body = (await req.json().catch(() => ({}))) as Body;
  if (!body.channel_id || !body.name || !body.category || !body.language || !Array.isArray(body.components)) {
    return jsonResponse({ error: "Parâmetros obrigatórios ausentes." }, 400);
  }

  // Validação de variáveis no BODY/HEADER (defesa em profundidade)
  const extractNums = (t: string) => {
    const m = (t.match(/\{\{\s*(\d+)\s*\}\}/g) ?? []).map((x) => parseInt(x.replace(/[^\d]/g, ""), 10));
    return Array.from(new Set(m)).sort((a, b) => a - b);
  };
  const bodyComp = body.components.find((c) => (c as { type?: string }).type === "BODY") as
    | { text?: string; example?: { body_text?: string[][] } }
    | undefined;
  const headerComp = body.components.find((c) => (c as { type?: string }).type === "HEADER") as
    | { format?: string; text?: string; example?: { header_text?: string[] } }
    | undefined;

  if (bodyComp?.text) {
    const nums = extractNums(bodyComp.text);
    for (let i = 0; i < nums.length; i++) {
      if (nums[i] !== i + 1) {
        return jsonResponse({ error: "Variáveis do corpo devem ser sequenciais começando em {{1}}." }, 400);
      }
    }
    if (/\}\}\s*\{\{/.test(bodyComp.text)) {
      return jsonResponse({ error: "Não é permitido colocar duas variáveis coladas no corpo." }, 400);
    }
    if (nums.length > 0) {
      const ex = bodyComp.example?.body_text?.[0];
      if (!Array.isArray(ex) || ex.length !== nums.length || ex.some((v) => !v || !String(v).trim())) {
        return jsonResponse({ error: "Preencha um exemplo para cada variável do corpo." }, 400);
      }
      for (const v of ex) {
        const s = String(v);
        if (/\{\{|\}\}/.test(s)) {
          return jsonResponse({ error: "Os exemplos não podem conter {{ ou }}." }, 400);
        }
        if (/[\n\r\t]/.test(s)) {
          return jsonResponse({ error: "Os exemplos não podem ter quebras de linha." }, 400);
        }
      }
    }
  }

  if (headerComp?.format === "TEXT" && headerComp.text) {
    const nums = extractNums(headerComp.text);
    if (nums.length > 1 || (nums.length === 1 && nums[0] !== 1)) {
      return jsonResponse({ error: "O header de texto só aceita uma variável e ela precisa ser {{1}}." }, 400);
    }
    if (nums.length === 1) {
      const ex = headerComp.example?.header_text?.[0];
      if (!ex || !String(ex).trim()) {
        return jsonResponse({ error: "Preencha o exemplo da variável do header." }, 400);
      }
      if (/\{\{|\}\}/.test(ex) || /[\n\r\t]/.test(ex)) {
        return jsonResponse({ error: "O exemplo do header não pode conter {{, }} ou quebras de linha." }, 400);
      }
    }
  }

  const admin = getAdminClient();
  const { data: ch } = await admin
    .from("brand_channels")
    .select("id, brand_id, waba_id")
    .eq("id", body.channel_id)
    .single();
  if (!ch?.waba_id) return jsonResponse({ error: "Canal sem WABA ID." }, 400);

  let token: string;
  try {
    token = await getChannelToken(body.channel_id);
  } catch {
    return jsonResponse({ error: "Token do canal não cadastrado." }, 400);
  }

  // Buscar template existente, se houver
  let existing: { id: string; meta_template_id: string | null } | null = null;
  if (body.template_id) {
    const { data } = await admin
      .from("whatsapp_templates")
      .select("id, meta_template_id")
      .eq("id", body.template_id)
      .single();
    existing = data ?? null;
  }

  const isEdit = !!existing?.meta_template_id;

  console.log("[upsert-template] sending to Meta:", JSON.stringify({
    isEdit,
    wabaId: ch.waba_id,
    name: body.name,
    category: body.category,
    language: body.language,
    components: body.components,
  }));

  const res = isEdit
    ? await updateTemplate({
        token,
        templateId: existing!.meta_template_id!,
        components: body.components,
      })
    : await createTemplate({
        token,
        wabaId: ch.waba_id,
        name: body.name.trim().toLowerCase(),
        category: body.category,
        language: body.language,
        components: body.components,
      });

  if (!res.ok) {
    const errAny = (res.error ?? {}) as Record<string, unknown> & {
      code?: string | number;
      error_subcode?: number;
      message?: string;
      error_data?: { details?: string };
      error_user_title?: string;
      error_user_msg?: string;
    };
    console.log("[upsert-template] Meta error raw:", JSON.stringify(res.raw));
    const code = String(errAny.code ?? "META_ERR");
    const subcode = errAny.error_subcode;
    const userMsg = errAny.error_user_msg;
    const userTitle = errAny.error_user_title;
    const apiDetails = errAny.error_data?.details;
    const apiMsg = errAny.message;
    let msg = translateMetaError(code, apiMsg);
    if (subcode === 2388024) {
      msg = "Já existe um template com esse conteúdo no idioma escolhido.";
    }
    // Concatena tudo o que a Meta retornou para o usuário enxergar o motivo real
    const detailParts = [userTitle, userMsg, apiDetails, apiMsg].filter(
      (v, i, arr) => v && arr.indexOf(v) === i,
    );
    const details = detailParts.join(" — ");
    await logError({
      severity: "error", category: "meta_api", code: String(subcode ?? code),
      messagePt: msg, brandId: ch.brand_id,
      technicalMessage: details || apiMsg, payload: res.raw,
    });
    return jsonResponse({ error: msg, error_pt: msg, code, subcode, details }, 400);
  }

  // Persistir
  const variablesCount = (() => {
    const bodyComp = body.components.find((c) => (c as { type?: string }).type === "BODY");
    const text = String((bodyComp as { text?: string } | undefined)?.text ?? "");
    return text.match(/\{\{\d+\}\}/g)?.length ?? 0;
  })();

  if (isEdit) {
    await admin.from("whatsapp_templates").update({
      components: body.components,
      variables_count: variablesCount,
      header_type: body.header_type ?? null,
      header_handle: body.header_handle ?? null,
      header_media_url: body.header_media_url ?? null,
      header_media_mime: body.header_media_mime ?? null,
      header_media_filename: body.header_media_filename ?? null,
      variable_bindings: body.variable_bindings ?? [],
    }).eq("id", existing!.id);
    return jsonResponse({ ok: true, template_id: existing!.id, status: "updated" });
  }

  const created = res.data as { id?: string; status?: string; category?: string };
  const { data: row, error } = await admin.from("whatsapp_templates").upsert(
    {
      brand_id: ch.brand_id,
      channel_id: ch.id,
      meta_template_id: created.id ? String(created.id) : null,
      name: body.name.trim().toLowerCase(),
      language: body.language,
      category: created.category ?? body.category,
      status: created.status ?? "PENDING",
      components: body.components,
      variables_count: variablesCount,
      header_type: body.header_type ?? null,
      header_handle: body.header_handle ?? null,
      header_media_url: body.header_media_url ?? null,
      header_media_mime: body.header_media_mime ?? null,
      header_media_filename: body.header_media_filename ?? null,
      variable_bindings: body.variable_bindings ?? [],
      synced_at: new Date().toISOString(),
    },
    { onConflict: "channel_id,name,language" },
  ).select("id, status").single();

  if (error) return jsonResponse({ error: error.message }, 500);
  return jsonResponse({ ok: true, template_id: row.id, status: row.status });
});
