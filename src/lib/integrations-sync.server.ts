// Sincronização de produtos/tags das plataformas externas.
// Server-only: usa o admin client e chama APIs HTTP de terceiros.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface SyncResult {
  added: number;
  updated: number;
  removed: number;
  total: number;
}

interface AccountRow {
  id: string;
  platform: string;
  credentials: Record<string, any>;
}

async function upsertAndDiff(
  accountId: string,
  type: string,
  items: Array<{ external_id: string; name: string; metadata?: Record<string, any> }>
): Promise<SyncResult> {
  const now = new Date().toISOString();

  // Snapshot atual
  const { data: existing } = await supabaseAdmin
    .from("integration_products")
    .select("id, external_id")
    .eq("account_id", accountId)
    .eq("type", type);
  const existingIds = new Set((existing ?? []).map((r: any) => r.external_id));

  // Upsert
  if (items.length) {
    const rows = items.map((it) => ({
      account_id: accountId,
      type,
      external_id: it.external_id,
      name: it.name,
      metadata: it.metadata ?? {},
      last_synced_at: now,
    }));
    const { error } = await supabaseAdmin
      .from("integration_products")
      .upsert(rows, { onConflict: "account_id,type,external_id" });
    if (error) throw new Error(`Upsert ${type}: ${error.message}`);
  }

  // Diff: deleta quem não veio
  const incoming = new Set(items.map((i) => i.external_id));
  const toRemove = [...existingIds].filter((id) => !incoming.has(id));
  if (toRemove.length) {
    console.warn(`[integrations-sync] removendo ${toRemove.length} ${type}(s) ausentes na origem`, toRemove);
    await supabaseAdmin
      .from("integration_products")
      .delete()
      .eq("account_id", accountId)
      .eq("type", type)
      .in("external_id", toRemove);
  }

  const added = items.filter((i) => !existingIds.has(i.external_id)).length;
  return {
    added,
    updated: items.length - added,
    removed: toRemove.length,
    total: items.length,
  };
}

// =================== HOTMART ===================

async function hotmartToken(creds: Record<string, any>): Promise<string> {
  const id = creds.client_id;
  const secret = creds.client_secret;
  if (!id || !secret) throw new Error("Credenciais Hotmart incompletas (client_id/client_secret).");
  const basic = btoa(`${id}:${secret}`);
  const r = await fetch(
    "https://api-sec-vlc.hotmart.com/security/oauth/token?grant_type=client_credentials",
    { method: "POST", headers: { Authorization: `Basic ${basic}` } }
  );
  if (!r.ok) throw new Error(`Hotmart auth ${r.status}: ${await r.text()}`);
  const j: any = await r.json();
  if (!j.access_token) throw new Error("Hotmart: access_token ausente");
  return j.access_token;
}

export async function syncHotmart(account: AccountRow): Promise<SyncResult> {
  console.log(`[sync hotmart] start account=${account.id}`);
  const token = await hotmartToken(account.credentials);
  const items: Array<{ external_id: string; name: string; metadata?: any }> = [];
  let pageToken: string | undefined;
  for (let i = 0; i < 20; i++) {
    const url = new URL("https://developers.hotmart.com/products/api/v1/products");
    url.searchParams.set("max_results", "50");
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    const text = await r.text();
    const ct = r.headers.get("content-type") ?? "";
    const loc = r.headers.get("location");
    if (!r.ok) throw new Error(`Hotmart GET /products HTTP ${r.status}: ${text.slice(0, 300) || "(vazio)"}`);

    if ((!text || text.trim().length === 0) && (loc?.includes("/docs") || !ct.includes("json"))) {
      console.warn(`[sync hotmart] empty body. status=${r.status} ct="${ct}" loc=${loc}`);
      throw new Error(
        "A Hotmart não retornou produtos (HTTP 200 com corpo vazio). Verifique se a credencial em Ferramentas → Credenciais Developers está ativa e pertence a uma conta de produtor com produtos cadastrados."
      );
    }
    if (!ct.includes("json")) {
      console.warn(`[sync hotmart] non-JSON ct="${ct}" body=${text.slice(0, 200)}`);
      throw new Error(`Hotmart /products devolveu content-type "${ct}" em vez de JSON. Body: ${text.slice(0, 200) || "(vazio)"}.`);
    }
    let j: any;
    try { j = JSON.parse(text); } catch { throw new Error(`Hotmart resposta não-JSON: ${text.slice(0, 200) || "(vazio)"}`); }
    for (const p of j.items ?? []) {
      items.push({
        external_id: String(p.id),
        name: p.name ?? `Produto ${p.id}`,
        metadata: { ucode: p.ucode, status: p.status, format: p.format },
      });
    }
    pageToken = j.page_info?.next_page_token;
    if (!pageToken) break;
  }
  console.log(`[sync hotmart] account=${account.id} fetched=${items.length}`);
  return upsertAndDiff(account.id, "product", items);
}

// =================== ACTIVECAMPAIGN ===================

async function acFetch(creds: Record<string, any>, path: string): Promise<any> {
  const base = String(creds.api_url ?? "").replace(/\/+$/, "");
  if (!base || !creds.api_key) throw new Error("Credenciais ActiveCampaign incompletas (api_url/api_key).");
  const r = await fetch(`${base}${path}`, {
    headers: { "Api-Token": creds.api_key, Accept: "application/json" },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`ActiveCampaign GET ${path} HTTP ${r.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { throw new Error(`AC resposta não-JSON em ${path}: ${text.slice(0, 200)}`); }
}

export async function syncActiveCampaign(account: AccountRow): Promise<{ tags: SyncResult; lists: SyncResult; fields: SyncResult }> {
  // Tags
  const tags: Array<{ external_id: string; name: string; metadata?: any }> = [];
  for (let offset = 0; offset < 5000; offset += 100) {
    const j = await acFetch(account.credentials, `/api/3/tags?limit=100&offset=${offset}`);
    const arr = j.tags ?? [];
    for (const t of arr) tags.push({ external_id: String(t.id), name: t.tag, metadata: { description: t.description } });
    if (arr.length < 100) break;
  }
  const tagsResult = await upsertAndDiff(account.id, "tag", tags);

  // Espelha as tags do AC em public.tags para aparecerem no TagPicker das automações.
  // Nunca deleta — se o AC remover uma tag, mantemos a local (pode estar em uso).
  try {
    const { data: brandLinks } = await supabaseAdmin
      .from("integration_account_brands")
      .select("brand_id")
      .eq("account_id", account.id);
    const brandIds = (brandLinks ?? []).map((r: any) => r.brand_id).filter(Boolean);
    if (brandIds.length && tags.length) {
      const rows: Array<{ brand_id: string; name: string; color: string }> = [];
      for (const bId of brandIds) {
        for (const t of tags) {
          if (!t.name) continue;
          rows.push({ brand_id: bId, name: t.name, color: "#64748b" });
        }
      }
      // upsert em lotes para evitar payload grande
      const chunkSize = 500;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const { error: tagUpsertErr } = await supabaseAdmin
          .from("tags")
          .upsert(chunk, { onConflict: "brand_id,name", ignoreDuplicates: true });
        if (tagUpsertErr) {
          console.warn(`[sync AC] espelhar tags em public.tags falhou: ${tagUpsertErr.message}`);
          break;
        }
      }
    }
  } catch (e: any) {
    console.warn(`[sync AC] espelhamento de tags falhou (não crítico): ${e?.message ?? e}`);
  }

  // Lists
  const lists: Array<{ external_id: string; name: string; metadata?: any }> = [];
  for (let offset = 0; offset < 5000; offset += 100) {
    const j = await acFetch(account.credentials, `/api/3/lists?limit=100&offset=${offset}`);
    const arr = j.lists ?? [];
    for (const l of arr) lists.push({ external_id: String(l.id), name: l.name, metadata: { stringid: l.stringid } });
    if (arr.length < 100) break;
  }
  const listsResult = await upsertAndDiff(account.id, "list", lists);

  // Custom fields
  const fields: Array<{ external_id: string; name: string; metadata?: any }> = [];
  for (let offset = 0; offset < 5000; offset += 100) {
    const j = await acFetch(account.credentials, `/api/3/fields?limit=100&offset=${offset}`);
    const arr = j.fields ?? [];
    for (const f of arr) fields.push({
      external_id: String(f.id),
      name: f.title ?? f.perstag ?? `Field ${f.id}`,
      metadata: { perstag: f.perstag, type: f.type },
    });
    if (arr.length < 100) break;
  }
  const fieldsResult = await upsertAndDiff(account.id, "field", fields);

  return { tags: tagsResult, lists: listsResult, fields: fieldsResult };
}

// =================== SENDFLOW ===================

export async function syncSendflow(account: AccountRow): Promise<SyncResult> {
  const apiKey = account.credentials?.api_key;
  if (!apiKey) throw new Error("Credenciais Sendflow incompletas (api_key).");
  console.log(`[sync sendflow] start account=${account.id}`);
  const r = await fetch("https://sendflow.pro/sendapi/releases", {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Sendflow GET /releases HTTP ${r.status}: ${text.slice(0, 300)}`);
  let arr: any;
  try { arr = JSON.parse(text); } catch { throw new Error(`Sendflow resposta não-JSON: ${text.slice(0, 200)}`); }
  if (!Array.isArray(arr)) arr = arr?.releases ?? arr?.data ?? [];

  const items: Array<{ external_id: string; name: string; metadata?: any }> = [];
  for (const it of arr) {
    if (it?.archived === true) continue;
    const id = it?.id ?? it?._id;
    if (!id) continue;
    const name = it?.name ?? it?.group?.name ?? `Campanha ${id}`;
    items.push({
      external_id: String(id),
      name: String(name),
      metadata: {
        group_name: it?.group?.name ?? null,
        image: it?.group?.image ?? null,
        type: it?.type ?? null,
        archived: !!it?.archived,
        accountIds: it?.accountIds ?? null,
      },
    });
  }
  console.log(`[sync sendflow] account=${account.id} fetched=${items.length}`);
  return upsertAndDiff(account.id, "group", items);
}

// Shopify: integração 100% via webhook + cadastro manual de produtos. Sem sync de API.

// =================== DISPATCHER ===================

export async function syncAccount(accountId: string): Promise<{
  platform: string;
  results: Record<string, SyncResult>;
}> {
  const { data: account, error } = await supabaseAdmin
    .from("integration_accounts")
    .select("id, platform, credentials")
    .eq("id", accountId)
    .single();
  if (error || !account) throw new Error("Conta não encontrada");

  const acc = account as unknown as AccountRow;
  let results: Record<string, SyncResult> = {};

  try {
    if (acc.platform === "hotmart") {
      results.product = await syncHotmart(acc);
    } else if (acc.platform === "activecampaign") {
      const r = await syncActiveCampaign(acc);
      results.tag = r.tags;
      results.list = r.lists;
      results.field = r.fields;
    } else if (acc.platform === "sendflow") {
      results.group = await syncSendflow(acc);
    } else {
      throw new Error(`Sincronização ainda não suportada para ${acc.platform}`);
    }

    await supabaseAdmin
      .from("integration_accounts")
      .update({ last_polled_at: new Date().toISOString(), last_error: null })
      .eq("id", acc.id);
  } catch (e: any) {
    await supabaseAdmin
      .from("integration_accounts")
      .update({ last_error: e?.message ?? String(e) })
      .eq("id", acc.id);
    throw e;
  }

  return { platform: acc.platform, results };
}
