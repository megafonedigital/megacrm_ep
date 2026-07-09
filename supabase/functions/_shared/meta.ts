// Cliente fino para Meta Graph API (WhatsApp Cloud)
const GRAPH = "https://graph.facebook.com/v21.0";

export interface MetaError {
  code?: number | string;
  message?: string;
  error_subcode?: number;
  error_data?: { details?: string };
  fbtrace_id?: string;
}
export interface MetaResponse<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: MetaError;
  raw?: unknown;
}

// ---------------------------------------------------------------------------
// Blocklist guard — bloqueia envios outbound se o contato (telefone ou email)
// estiver em `contact_blocklist` do workspace. Usado por sendText/Template/
// Media/InteractiveButtons via opção `blocklistGuard`. Também exportado.
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
type Admin = any;

export interface BlocklistGuard {
  admin: Admin;
  brandId: string | null | undefined;
  phone?: string | null;
  email?: string | null;
}

function digitsOnly(s?: string | null): string {
  return (s ?? "").replace(/\D+/g, "");
}

// Detects a Meta Business-Scoped User ID (BSUID), e.g. "BR.abc123". Must NEVER
// be normalized like a phone number — opaque identifier scoped to a Portfolio.
export function isBsuid(input?: string | null): boolean {
  if (!input) return false;
  return /^[A-Z]{2}\.[A-Za-z0-9_-]+$/.test(String(input).trim());
}

// Gera variantes E.164 (`+...`) considerando BR com/sem o 9 após o DDD.
// Para BSUIDs (ou qualquer identificador não-numérico), retorna lista vazia —
// blocklist/lookup por telefone não se aplica a esses contatos.
export function phoneE164Variants(input?: string | null): string[] {
  if (!input) return [];
  if (isBsuid(input)) return [];
  const d = digitsOnly(input);
  if (!d) return [];
  const out = new Set<string>();
  out.add("+" + d);
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    const rest = d.slice(4);
    if (rest.length === 9 && rest.startsWith("9")) {
      out.add("+55" + ddd + rest.slice(1));
    } else if (rest.length === 8) {
      out.add("+55" + ddd + "9" + rest);
    }
  }
  return Array.from(out);
}


export async function isContactBlocklisted(g: BlocklistGuard): Promise<boolean> {
  if (!g.brandId) return false;
  const phones = phoneE164Variants(g.phone);
  const email = (g.email ?? "").trim().toLowerCase() || null;
  if (phones.length === 0 && !email) return false;
  if (phones.length) {
    const { data } = await g.admin
      .from("contact_blocklist")
      .select("id")
      .eq("brand_id", g.brandId)
      .eq("kind", "phone")
      .in("value", phones)
      .limit(1);
    if (data && data.length > 0) return true;
  }
  if (email) {
    const { data } = await g.admin
      .from("contact_blocklist")
      .select("id")
      .eq("brand_id", g.brandId)
      .eq("kind", "email")
      .eq("value", email)
      .limit(1);
    if (data && data.length > 0) return true;
  }
  return false;
}

function blocklistedResponse<T>(): MetaResponse<T> {
  return {
    ok: false,
    status: 0,
    error: {
      code: "BLOCKLISTED",
      message: "Contato no blocklist deste workspace; envio bloqueado.",
    },
    raw: null,
  };
}

async function call<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  token: string,
  body?: unknown
): Promise<MetaResponse<T>> {
  const res = await fetch(`${GRAPH}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, status: res.status, error: json?.error ?? { message: "Erro Meta" }, raw: json };
  }
  return { ok: true, status: res.status, data: json as T, raw: json };
}

export async function validateToken(token: string, phoneNumberId: string) {
  return call<{ id: string; verified_name?: string; display_phone_number?: string }>(
    "GET",
    `${phoneNumberId}?fields=id,verified_name,display_phone_number`,
    token
  );
}

export async function listSubscribedApps(opts: { token: string; wabaId: string }) {
  return call<{ data: Array<{ whatsapp_business_api_data?: { id?: string; name?: string; link?: string }; override_callback_uri?: string }> }>(
    "GET",
    `${opts.wabaId}/subscribed_apps`,
    opts.token,
  );
}

export async function subscribeWaba(opts: { token: string; wabaId: string }) {
  return call<{ success: boolean }>(
    "POST",
    `${opts.wabaId}/subscribed_apps`,
    opts.token,
  );
}

// Inspeciona um token (descobre a qual App pertence, scopes, validade).
// Requer META_APP_ID + META_APP_SECRET (gera o app access token = "{id}|{secret}").
// Funciona para qualquer token — inclusive tokens de OUTROS apps; nesse caso
// retorna app_id do app dono (assim conseguimos detectar mismatch).
export async function debugToken(opts: { token: string; appId: string; appSecret: string }) {
  const appAccessToken = `${opts.appId}|${opts.appSecret}`;
  const res = await fetch(
    `${GRAPH}/debug_token?input_token=${encodeURIComponent(opts.token)}&access_token=${encodeURIComponent(appAccessToken)}`,
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false as const, status: res.status, error: json?.error ?? { message: "Erro Meta" } };
  }
  const d = json?.data ?? {};
  return {
    ok: true as const,
    status: res.status,
    data: {
      app_id: d.app_id ? String(d.app_id) : null,
      application: d.application ?? null,
      type: d.type ?? null,
      is_valid: !!d.is_valid,
      scopes: Array.isArray(d.scopes) ? (d.scopes as string[]) : [],
      expires_at: typeof d.expires_at === "number" ? d.expires_at : null,
      data_access_expires_at: typeof d.data_access_expires_at === "number" ? d.data_access_expires_at : null,
      user_id: d.user_id ? String(d.user_id) : null,
    },
  };
}

export async function registerPhoneNumber(opts: {
  token: string;
  phoneNumberId: string;
  pin: string;
  dataLocalizationRegion?: string;
}) {
  return call<{ success: boolean }>(
    "POST",
    `${opts.phoneNumberId}/register`,
    opts.token,
    {
      messaging_product: "whatsapp",
      pin: opts.pin,
      ...(opts.dataLocalizationRegion
        ? { data_localization_region: opts.dataLocalizationRegion }
        : {}),
    },
  );
}

// BSUID (Onda 2) — quando o destinatário é um Business-Scoped User ID
// (formato "BR.xxx"), a Meta espera `recipient: { user }` em vez de `to`.
// Auto-detecta pelo formato do valor recebido em `opts.to`, então nenhum
// caller precisa mudar sua interface (basta passar o BSUID em `to`).
export function buildRecipientFields(to: string): Record<string, unknown> {
  if (isBsuid(to)) {
    return { recipient_type: "individual", recipient: { user: to } };
  }
  return { recipient_type: "individual", to };
}

export async function sendText(opts: {
  token: string;
  phoneNumberId: string;
  to: string;
  body: string;
  contextMessageId?: string;
  blocklistGuard?: BlocklistGuard;
}) {
  if (opts.blocklistGuard && (await isContactBlocklisted(opts.blocklistGuard))) {
    return blocklistedResponse<{ messages: { id: string }[] }>();
  }
  return call<{ messages: { id: string }[] }>("POST", `${opts.phoneNumberId}/messages`, opts.token, {
    messaging_product: "whatsapp",
    ...buildRecipientFields(opts.to),
    type: "text",
    text: { body: opts.body, preview_url: true },
    ...(opts.contextMessageId ? { context: { message_id: opts.contextMessageId } } : {}),
  });
}

export async function sendInteractiveButtons(opts: {
  token: string;
  phoneNumberId: string;
  to: string;
  body: string;
  buttons: { id: string; title: string }[]; // máx 3, title máx 20 chars
  footer?: string;
  header?: string;
  blocklistGuard?: BlocklistGuard;
}) {
  if (opts.blocklistGuard && (await isContactBlocklisted(opts.blocklistGuard))) {
    return blocklistedResponse<{ messages: { id: string }[] }>();
  }
  const cleanButtons = opts.buttons
    .filter((b) => b.title && b.title.trim().length > 0)
    .slice(0, 3)
    .map((b) => ({
      type: "reply",
      reply: { id: (b.id || "btn").slice(0, 256), title: b.title.slice(0, 20) },
    }));
  return call<{ messages: { id: string }[] }>("POST", `${opts.phoneNumberId}/messages`, opts.token, {
    messaging_product: "whatsapp",
    ...buildRecipientFields(opts.to),
    type: "interactive",
    interactive: {
      type: "button",
      ...(opts.header ? { header: { type: "text", text: opts.header.slice(0, 60) } } : {}),
      body: { text: opts.body },
      ...(opts.footer ? { footer: { text: opts.footer.slice(0, 60) } } : {}),
      action: { buttons: cleanButtons },
    },
  });
}



export async function sendMedia(opts: {
  token: string;
  phoneNumberId: string;
  to: string;
  type: "image" | "audio" | "video" | "document";
  link: string;
  caption?: string;
  filename?: string;
  blocklistGuard?: BlocklistGuard;
}) {
  if (opts.blocklistGuard && (await isContactBlocklisted(opts.blocklistGuard))) {
    return blocklistedResponse<{ messages: { id: string }[] }>();
  }
  const media: Record<string, unknown> = { link: opts.link };
  if (opts.caption && (opts.type === "image" || opts.type === "video" || opts.type === "document"))
    media.caption = opts.caption;
  if (opts.filename && opts.type === "document") media.filename = opts.filename;
  return call<{ messages: { id: string }[] }>("POST", `${opts.phoneNumberId}/messages`, opts.token, {
    messaging_product: "whatsapp",
    ...buildRecipientFields(opts.to),
    type: opts.type,
    [opts.type]: media,
  });
}

export async function sendTemplate(opts: {
  token: string;
  phoneNumberId: string;
  to: string;
  templateName: string;
  language: string;
  variables?: string[];
  headerType?: "IMAGE" | "VIDEO" | "DOCUMENT" | "TEXT" | null;
  headerMediaLink?: string | null;
  headerMediaHandle?: string | null; // Media ID de PHONE_NUMBER_ID/media (preferido — evita 131053)
  headerMediaFilename?: string | null;
  headerTextVar?: string | null;
  blocklistGuard?: BlocklistGuard;
}) {
  if (opts.blocklistGuard && (await isContactBlocklisted(opts.blocklistGuard))) {
    return blocklistedResponse<{ messages: { id: string }[] }>();
  }
  const components: Array<Record<string, unknown>> = [];
  if (opts.headerType && opts.headerType !== "TEXT" && (opts.headerMediaHandle || opts.headerMediaLink)) {
    const key = opts.headerType.toLowerCase(); // image|video|document
    const media: Record<string, unknown> = opts.headerMediaHandle
      ? { id: opts.headerMediaHandle }
      : { link: opts.headerMediaLink };
    if (key === "document" && opts.headerMediaFilename) media.filename = opts.headerMediaFilename;
    components.push({
      type: "header",
      parameters: [{ type: key, [key]: media }],
    });
  } else if (opts.headerType === "TEXT" && opts.headerTextVar) {
    components.push({
      type: "header",
      parameters: [{ type: "text", text: opts.headerTextVar }],
    });
  }
  if (opts.variables?.length) {
    components.push({
      type: "body",
      parameters: opts.variables.map((v) => ({ type: "text", text: v })),
    });
  }
  return call<{ messages: { id: string }[] }>("POST", `${opts.phoneNumberId}/messages`, opts.token, {
    messaging_product: "whatsapp",
    ...buildRecipientFields(opts.to),
    type: "template",
    template: {
      name: opts.templateName,
      language: { code: opts.language },
      ...(components.length ? { components } : {}),
    },
  });
}

// Upload de mídia via PHONE_NUMBER_ID/media — devolve media_id reutilizável (~30 dias)
// para uso em mensagens (image.id / video.id / document.id). Corrige erro 131053
// que ocorre quando a Meta baixa Signed URLs sob alto volume.
export async function uploadPhoneNumberMedia(opts: {
  token: string;
  phoneNumberId: string;
  bytes: Uint8Array;
  mime: string;
  filename?: string;
}): Promise<MetaResponse<{ id: string }>> {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", opts.mime);
  form.append(
    "file",
    new Blob([opts.bytes], { type: opts.mime }),
    opts.filename ?? "upload",
  );
  const res = await fetch(`${GRAPH}/${opts.phoneNumberId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.token}` },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: (json as { error?: MetaError })?.error ?? { message: "Erro upload media" },
      raw: json,
    };
  }
  return { ok: true, status: res.status, data: json as { id: string }, raw: json };
}

export async function listTemplates(opts: { token: string; wabaId: string }) {
  // Pagina por paging.next até esgotar (com teto de segurança).
  const MAX_PAGES = 25;
  const all: Array<Record<string, unknown>> = [];
  let nextUrl: string | null = `${GRAPH}/${opts.wabaId}/message_templates?limit=200&fields=name,language,category,status,id,components`;
  let lastStatus = 200;
  let lastRaw: unknown = null;
  for (let page = 0; page < MAX_PAGES && nextUrl; page++) {
    const res = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${opts.token}` },
    });
    const json = await res.json().catch(() => ({}));
    lastStatus = res.status;
    lastRaw = json;
    if (!res.ok) {
      return {
        ok: false as const,
        status: res.status,
        error: (json as { error?: MetaError })?.error ?? { message: "Erro Meta" },
        raw: json,
      };
    }
    const items = ((json as { data?: Array<Record<string, unknown>> })?.data) ?? [];
    for (const it of items) all.push(it);
    nextUrl = (json as { paging?: { next?: string } })?.paging?.next ?? null;
  }
  return {
    ok: true as const,
    status: lastStatus,
    data: { data: all },
    raw: lastRaw,
  } as MetaResponse<{ data: Array<Record<string, unknown>> }>;
}

// ============== Templates CRUD ==============

export async function createTemplate(opts: {
  token: string;
  wabaId: string;
  name: string;
  category: "UTILITY" | "MARKETING" | "AUTHENTICATION";
  language: string;
  components: Array<Record<string, unknown>>;
}) {
  return call<{ id: string; status: string; category: string }>(
    "POST",
    `${opts.wabaId}/message_templates`,
    opts.token,
    {
      name: opts.name,
      category: opts.category,
      language: opts.language,
      components: opts.components,
    },
  );
}

export async function updateTemplate(opts: {
  token: string;
  templateId: string;
  components: Array<Record<string, unknown>>;
}) {
  return call<{ success: boolean }>(
    "POST",
    `${opts.templateId}`,
    opts.token,
    { components: opts.components },
  );
}

export async function deleteTemplateByName(opts: {
  token: string;
  wabaId: string;
  name: string;
  hsmId?: string;
}) {
  const qp = new URLSearchParams({ name: opts.name });
  if (opts.hsmId) qp.set("hsm_id", opts.hsmId);
  return call<{ success: boolean }>(
    "DELETE",
    `${opts.wabaId}/message_templates?${qp.toString()}`,
    opts.token,
  );
}

// Resumable upload (2 passos) para header de mídia em templates
export async function createMediaUploadSession(opts: {
  token: string;
  appId: string;
  fileName: string;
  fileLength: number;
  fileType: string;
}) {
  const qp = new URLSearchParams({
    file_name: opts.fileName,
    file_length: String(opts.fileLength),
    file_type: opts.fileType,
  });
  return call<{ id: string }>(
    "POST",
    `${opts.appId}/uploads?${qp.toString()}`,
    opts.token,
  );
}

export async function uploadMediaBytes(opts: {
  token: string;
  uploadId: string; // ex: "upload:abc123" — passamos sem prefixo se já tiver
  bytes: Uint8Array;
}): Promise<MetaResponse<{ h: string }>> {
  const id = opts.uploadId.startsWith("upload:") ? opts.uploadId : `upload:${opts.uploadId}`;
  const res = await fetch(`${GRAPH}/${id}`, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${opts.token}`,
      file_offset: "0",
    },
    body: opts.bytes,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, status: res.status, error: json?.error ?? { message: "Erro upload" }, raw: json };
  return { ok: true, status: res.status, data: json as { h: string }, raw: json };
}

export async function downloadMedia(opts: { token: string; mediaId: string }) {
  // 1) get URL
  const meta = await call<{ url: string; mime_type: string }>("GET", opts.mediaId, opts.token);
  if (!meta.ok || !meta.data) return { ok: false as const, error: meta.error };
  // 2) download bytes (auth required)
  const res = await fetch(meta.data.url, { headers: { Authorization: `Bearer ${opts.token}` } });
  if (!res.ok) return { ok: false as const, error: { message: `Download falhou: ${res.status}` } };
  const buf = new Uint8Array(await res.arrayBuffer());
  return { ok: true as const, mime: meta.data.mime_type, bytes: buf };
}
