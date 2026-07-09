// Hotmart API helpers (server-only).
// Auth: OAuth2 client_credentials. Token cached per brand in ellie_hotmart_tokens.

const OAUTH_URL = "https://api-sec-vlc.hotmart.com/security/oauth/token";
const API_BASE = "https://developers.hotmart.com/payments/api/v1";

type TokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
};

async function fetchNewToken(): Promise<{ token: string; expiresAt: Date }> {
  const clientId = process.env.HOTMART_CLIENT_ID;
  const clientSecret = process.env.HOTMART_CLIENT_SECRET;
  const basicEnv = process.env.HOTMART_BASIC_TOKEN;
  if (!clientId || !clientSecret) {
    throw new Error("Hotmart secrets missing (HOTMART_CLIENT_ID/HOTMART_CLIENT_SECRET)");
  }
  // Hotmart "Basic" = base64(client_id:client_secret). We always compute it
  // from the secrets to avoid stale/malformed HOTMART_BASIC_TOKEN values.
  // If the user pasted "Basic xxxx" or the already-encoded string into
  // HOTMART_BASIC_TOKEN, we try it as a fallback.
  const computed = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const fallback = basicEnv
    ? basicEnv.trim().replace(/^Basic\s+/i, "")
    : null;

  const attempts: { label: string; basic: string }[] = [
    { label: "computed", basic: computed },
  ];
  if (fallback && fallback !== computed) {
    attempts.push({ label: "env", basic: fallback });
  }

  const url = `${OAUTH_URL}?grant_type=client_credentials&client_id=${encodeURIComponent(
    clientId,
  )}&client_secret=${encodeURIComponent(clientSecret)}`;

  let lastErr = "";
  for (const a of attempts) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${a.basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
    if (res.ok) {
      const json = (await res.json()) as TokenResponse;
      const expiresAt = new Date(Date.now() + (json.expires_in - 60) * 1000);
      return { token: json.access_token, expiresAt };
    }
    lastErr = `[${a.label}] ${res.status}: ${await res.text()}`;
  }
  throw new Error(
    `Hotmart token failed. Verifique CLIENT_ID e CLIENT_SECRET no painel Hotmart Tools → Credenciais. Detalhes: ${lastErr}`,
  );
}

export async function getAccessToken(brandId: string): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: row } = await supabaseAdmin
    .from("ellie_hotmart_tokens")
    .select("access_token, expires_at")
    .eq("brand_id", brandId)
    .maybeSingle();

  if (row && new Date(row.expires_at).getTime() > Date.now()) {
    return row.access_token;
  }

  const { token, expiresAt } = await fetchNewToken();
  await supabaseAdmin.from("ellie_hotmart_tokens").upsert(
    {
      brand_id: brandId,
      access_token: token,
      expires_at: expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "brand_id" },
  );
  return token;
}

async function hotmartGet<T>(brandId: string, path: string): Promise<T> {
  const token = await getAccessToken(brandId);
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Hotmart ${path} ${res.status}: ${body}`);
  }
  return (await res.json()) as T;
}

type HotmartItem = { product?: { id?: number | string; name?: string } };
type HotmartListResponse = { items?: HotmartItem[] };

export async function fetchSubscriptions(brandId: string, email: string) {
  return hotmartGet<HotmartListResponse>(
    brandId,
    `/subscriptions?subscriber_email=${encodeURIComponent(email)}&status=ACTIVE`,
  );
}

export async function fetchSalesHistory(brandId: string, email: string) {
  return hotmartGet<HotmartListResponse>(
    brandId,
    `/sales/history?buyer_email=${encodeURIComponent(email)}`,
  );
}

export function extractProductIds(resp: HotmartListResponse | undefined): string[] {
  if (!resp?.items) return [];
  return resp.items
    .map((i) => i?.product?.id)
    .filter((v): v is string | number => v !== undefined && v !== null)
    .map((v) => String(v));
}
