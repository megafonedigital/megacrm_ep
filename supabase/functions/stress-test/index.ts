// stress-test: gera carga inbound (webhooks fake) ou outbound (envios reais)
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient, requireRole } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const pf = handlePreflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    await requireRole(req, ["admin"]);
  } catch (e) {
    if (e instanceof Response) return e;
    return jsonResponse({ error: "forbidden" }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const mode = body.mode as "inbound" | "outbound";
  const count = Math.min(Math.max(Number(body.count ?? 10), 1), 1000);
  const brandId = body.brand_id as string;
  if (!mode || !brandId) return jsonResponse({ error: "mode e brand_id obrigatórios" }, 400);

  const admin = getAdminClient();
  const { data: brand } = await admin
    .from("brands")
    .select("id, phone_number_id")
    .eq("id", brandId)
    .single();
  if (!brand) return jsonResponse({ error: "Marca não encontrada" }, 404);

  if (mode === "inbound") {
    const phone = body.from_phone ?? "5511900000000";
    const inserts = Array.from({ length: count }).map((_, i) => ({
      brand_id: brandId,
      payload: {
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: brand.phone_number_id },
                  contacts: [{ profile: { name: `Teste ${i + 1}` }, wa_id: phone }],
                  messages: [
                    {
                      from: phone,
                      id: `wamid.test.${crypto.randomUUID()}`,
                      type: "text",
                      text: { body: `Mensagem de teste ${i + 1} (${new Date().toISOString()})` },
                      timestamp: String(Math.floor(Date.now() / 1000)),
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    }));
    const { error } = await admin.from("webhook_events_raw").insert(inserts);
    if (error) return jsonResponse({ error: error.message }, 500);

    // dispara processamento
    fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/process-webhook-event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({}),
    }).catch(() => {});
    return jsonResponse({ injected: count });
  }

  // outbound
  const conversationId = body.conversation_id as string;
  if (!conversationId) return jsonResponse({ error: "conversation_id obrigatório (outbound)" }, 400);
  const text = (body.text as string) ?? "Mensagem de stress-test";
  const auth = req.headers.get("Authorization") ?? "";

  const results: Array<{ ok: boolean; status: number }> = [];
  for (let i = 0; i < count; i++) {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-message`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify({
        conversation_id: conversationId,
        type: "text",
        text: `${text} #${i + 1}`,
      }),
    });
    results.push({ ok: r.ok, status: r.status });
  }
  return jsonResponse({
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
  });
});
