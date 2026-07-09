// Testes de conexão por plataforma. Sempre retorna { ok, status, message, sample }.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface TestResult {
  ok: boolean;
  status?: number;
  message: string;
  sample?: any;
}

async function getAccount(accountId: string) {
  const { data, error } = await supabaseAdmin
    .from("integration_accounts")
    .select("id, platform, credentials")
    .eq("id", accountId)
    .single();
  if (error || !data) throw new Error("Conta não encontrada");
  return data as { id: string; platform: string; credentials: Record<string, any> };
}

async function testHotmart(creds: Record<string, any>): Promise<TestResult> {
  const id = creds.client_id;
  const secret = creds.client_secret;
  if (!id || !secret) return { ok: false, message: "Faltam Client ID/Secret. Obtenha em Hotmart → Ferramentas → Credenciais Hotmart API e cole no formulário desta conta." };

  // 1. OAuth
  const basic = btoa(`${id}:${secret}`);
  const tokRes = await fetch(
    "https://api-sec-vlc.hotmart.com/security/oauth/token?grant_type=client_credentials",
    { method: "POST", headers: { Authorization: `Basic ${basic}` } }
  );
  const tokText = await tokRes.text();
  if (!tokRes.ok) {
    return { ok: false, status: tokRes.status, message: `OAuth Hotmart falhou: ${tokText.slice(0, 200)}` };
  }
  let token: string;
  try {
    token = JSON.parse(tokText).access_token;
  } catch {
    return { ok: false, status: tokRes.status, message: `OAuth Hotmart sem JSON válido: ${tokText.slice(0, 200)}` };
  }
  if (!token) return { ok: false, message: "OAuth Hotmart sem access_token" };

  // 2. Lista produtos
  const productsUrl = "https://developers.hotmart.com/products/api/v1/products?max_results=5";
  const r = await fetch(productsUrl, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  const text = await r.text();
  const ct = r.headers.get("content-type") ?? "";
  const cl = r.headers.get("content-length");
  const loc = r.headers.get("location");
  console.warn(`[hotmart test] GET /products status=${r.status} ct="${ct}" cl=${cl} loc=${loc} bodyLen=${text.length} bodySnip=${text.slice(0, 200)}`);

  if (!r.ok) {
    return { ok: false, status: r.status, message: `GET /products falhou: ${text.slice(0, 300)}` };
  }

  const looksLikeDocsRedirect = (!text || text.trim().length === 0) && (loc?.includes("/docs") || !ct.includes("json"));
  if (looksLikeDocsRedirect) {
    return {
      ok: false,
      status: r.status,
      message:
        "OAuth funcionou (token recebido), mas a Hotmart respondeu /products com corpo vazio. Verifique se a credencial em Ferramentas → Credenciais Developers está ativa e pertence a uma conta de produtor com produtos cadastrados.",
    };
  }

  if (!ct.includes("json")) {
    return {
      ok: false,
      status: r.status,
      message: `GET /products devolveu content-type "${ct || "(vazio)"}" em vez de JSON. Body: ${text.slice(0, 200) || "(vazio)"}.`,
    };
  }

  let json: any;
  try { json = JSON.parse(text); } catch {
    return { ok: false, status: r.status, message: `Resposta não-JSON: ${text.slice(0, 200) || "(corpo vazio)"}` };
  }
  const items = json.items ?? [];
  return {
    ok: true,
    status: r.status,
    message: `OAuth ok e /products acessível. ${items.length} produto(s) na primeira página.`,
    sample: items.slice(0, 3).map((p: any) => ({ id: p.id, name: p.name })),
  };
}

async function testActiveCampaign(creds: Record<string, any>): Promise<TestResult> {
  const base = String(creds.api_url ?? "").replace(/\/+$/, "");
  if (!base || !creds.api_key) return { ok: false, message: "Faltam API URL/API Key. Obtenha em ActiveCampaign → Settings → Developer e cole no formulário desta conta." };

  const r = await fetch(`${base}/api/3/tags?limit=1`, {
    headers: { "Api-Token": creds.api_key, Accept: "application/json" },
  });
  const text = await r.text();
  if (!r.ok) {
    return { ok: false, status: r.status, message: `GET /tags falhou: ${text.slice(0, 300)}` };
  }
  let json: any;
  try { json = JSON.parse(text); } catch { return { ok: false, status: r.status, message: `Resposta não-JSON: ${text.slice(0, 200)}` }; }
  const total = json?.meta?.total ?? (json.tags?.length ?? 0);
  const sampleTag = json.tags?.[0];

  // Lists
  const r2 = await fetch(`${base}/api/3/lists?limit=1`, {
    headers: { "Api-Token": creds.api_key, Accept: "application/json" },
  });
  let listsTotal = 0;
  let sampleList: any;
  if (r2.ok) {
    const j2: any = await r2.json().catch(() => ({}));
    listsTotal = j2?.meta?.total ?? (j2.lists?.length ?? 0);
    sampleList = j2.lists?.[0];
  }

  return {
    ok: true,
    status: r.status,
    message: `Conexão ok. ${total} tag(s) e ${listsTotal} lista(s) na conta.`,
    sample: { tag: sampleTag && { id: sampleTag.id, name: sampleTag.tag }, list: sampleList && { id: sampleList.id, name: sampleList.name } },
  };
}

async function testSendflow(creds: Record<string, any>): Promise<TestResult> {
  const key = creds.api_key;
  if (!key) return { ok: false, message: "Falta a API Key. Obtenha no painel da Sendflow e cole no formulário desta conta." };
  const r = await fetch("https://sendflow.pro/sendapi/releases", {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  const text = await r.text();
  if (!r.ok) {
    return { ok: false, status: r.status, message: `GET /sendapi/releases falhou: ${text.slice(0, 300)}` };
  }
  let json: any;
  try { json = JSON.parse(text); } catch { return { ok: false, status: r.status, message: `Resposta não-JSON: ${text.slice(0, 200)}` }; }
  const items = Array.isArray(json) ? json : (json.items ?? json.releases ?? json.data ?? []);
  const count = Array.isArray(items) ? items.length : 0;
  return {
    ok: true,
    status: r.status,
    message: `Conexão ok. ${count} release(s)/grupo(s) retornado(s).`,
    sample: Array.isArray(items) ? items.slice(0, 3).map((p: any) => ({ id: p.id ?? p.release_id ?? p.group_id, name: p.name ?? p.title })) : undefined,
  };
}

// Shopify: integração 100% via webhook. Não há teste de API.

export async function testConnection(accountId: string): Promise<TestResult> {
  const acc = await getAccount(accountId);
  try {
    if (acc.platform === "hotmart") return await testHotmart(acc.credentials);
    if (acc.platform === "activecampaign") return await testActiveCampaign(acc.credentials);
    if (acc.platform === "sendflow") return await testSendflow(acc.credentials);
    if (acc.platform === "shopify") return { ok: false, message: "Shopify usa apenas webhook + cadastro manual. Não há teste de API." };
    return { ok: false, message: `Teste ainda não implementado para ${acc.platform}` };
  } catch (e: any) {
    return { ok: false, message: e?.message ?? String(e) };
  }
}
