// automation-engine: executa fluxos de automação
// Eventos suportados: tag_added | inbound | button_click | tick | manual_trigger | broadcast_send
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient } from "../_shared/supabase.ts";
import { getChannelToken } from "../_shared/vault.ts";
import { sendText, sendTemplate, sendInteractiveButtons, sendMedia, uploadPhoneNumberMedia } from "../_shared/meta.ts";
import { logWhatsAppSend } from "../_shared/wa-log.ts";
import { logNodeMessage } from "../_shared/automation-node-messages.ts";
import {
  SIDE_BRANCH_BLOCKING_TYPES,
  pickRandomizerBranch,
  computeFastPathPlan,
  type FlowNode as SharedFlowNode,
  type FlowEdge as SharedFlowEdge,
  type Graph as SharedGraph,
} from "../_shared/automation-helpers.ts";

/**
 * Resolve o `media_id` (handle da Meta) para o header de mídia de um template,
 * com cache persistente em `wa_send_media_cache`. Sempre que possível, envia
 * o template usando `image.id` em vez de `image.link`, o que elimina o erro
 * [131053] Media upload error (Meta falha em baixar Signed URLs sob alto volume).
 *
 * Retorna `null` em qualquer falha — o caller deve manter o `link` como fallback.
 */
async function resolveTemplateHeaderMediaId(opts: {
  admin: any;
  brandId: string;
  phoneNumberId: string;
  token: string;
  sourceUrl: string;
  filename?: string | null;
  headerType: "IMAGE" | "VIDEO" | "DOCUMENT";
}): Promise<string | null> {
  try {
    const { admin, brandId, phoneNumberId, token, sourceUrl } = opts;
    // Hash simples (djb2) para índice único curto.
    let hash = 5381;
    for (let i = 0; i < sourceUrl.length; i++) hash = ((hash << 5) + hash + sourceUrl.charCodeAt(i)) | 0;
    const sourceHash = `${brandId}:${phoneNumberId}:${(hash >>> 0).toString(16)}`;

    const nowIso = new Date().toISOString();
    const { data: cached } = await admin
      .from("wa_send_media_cache")
      .select("media_id, expires_at")
      .eq("brand_id", brandId)
      .eq("phone_number_id", phoneNumberId)
      .eq("source_hash", sourceHash)
      .gt("expires_at", nowIso)
      .maybeSingle();
    if (cached?.media_id) return cached.media_id as string;

    // Baixa bytes do Storage/URL pública.
    const res = await fetch(sourceUrl);
    if (!res.ok) return null;
    const mime = res.headers.get("content-type")
      ?? (opts.headerType === "IMAGE" ? "image/jpeg"
        : opts.headerType === "VIDEO" ? "video/mp4" : "application/pdf");
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.byteLength) return null;

    const up = await uploadPhoneNumberMedia({
      token, phoneNumberId, bytes, mime,
      filename: opts.filename ?? undefined,
    });
    if (!up.ok || !up.data?.id) return null;

    // Cache por 28 dias (Meta retém ~30d).
    const expiresAt = new Date(Date.now() + 28 * 24 * 60 * 60 * 1000).toISOString();
    await admin.from("wa_send_media_cache").upsert({
      brand_id: brandId,
      phone_number_id: phoneNumberId,
      source_url: sourceUrl,
      source_hash: sourceHash,
      media_id: up.data.id,
      mime_type: mime,
      expires_at: expiresAt,
      updated_at: nowIso,
    }, { onConflict: "brand_id,phone_number_id,source_hash" });

    return up.data.id;
  } catch {
    return null;
  }
}

/**
 * CHAVE + FECHADURA — trava defensiva.
 *
 * Antes de transicionar um run para `waiting_button`, valida que existe linha
 * em `automation_node_messages` com (run_id, node_id) e wa_message_id não nulo.
 * Se a Meta não devolveu wa_message_id no envio (falha silenciosa, throttle,
 * etc.) o run viraria uma "run-fantasma" parada para sempre — porque o clique
 * do botão nunca conseguiria casar via context.id. Nesse caso marcamos
 * `status='failed', last_error='waiting_button_without_lock'` em vez de
 * pausar.
 *
 * Retorna true se a fechadura existe e o caller PODE prosseguir com o update
 * para `waiting_button`. Retorna false se a transição foi abortada (já marcou
 * o run como failed).
 */
async function assertButtonLock(
  admin: any,
  runId: string,
  nodeId: string,
  vars: Record<string, any>,
): Promise<boolean> {
  const { data } = await admin
    .from("automation_node_messages")
    .select("id")
    .eq("run_id", runId)
    .eq("node_id", nodeId)
    .not("wa_message_id", "is", null)
    .limit(1)
    .maybeSingle();
  if (data?.id) return true;

  // Backfill: a mensagem foi enviada (existe wa_message_id em `messages`) mas o
  // lock não ficou registrado por falha silenciosa em logNodeMessage. Reconstrói
  // a fechadura a partir do último outbound de template/interactive desta
  // conversa nos últimos 5 minutos, evitando que a pausa seja abortada.
  const convId = vars?._conversation_id as string | undefined;
  const brandId = vars?._brand_id as string | undefined;
  const automationId = vars?._automation_id as string | undefined;
  if (convId && brandId && automationId) {
    const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: lastMsg } = await admin
      .from("messages")
      .select("id, wa_message_id, channel_id")
      .eq("conversation_id", convId)
      .eq("direction", "outbound")
      .not("wa_message_id", "is", null)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastMsg?.wa_message_id) {
      const now = new Date().toISOString();
      const { error: insErr } = await admin.from("automation_node_messages").insert({
        brand_id: brandId,
        automation_id: automationId,
        run_id: runId,
        node_id: nodeId,
        node_type: "message",
        contact_id: vars?.contact_id ?? null,
        conversation_id: convId,
        channel_id: (lastMsg as any).channel_id ?? vars?._channel_id ?? null,
        wa_message_id: (lastMsg as any).wa_message_id,
        sent_at: now,
        failed_at: null,
      } as any);
      if (!insErr) {
        console.log(`[automation-engine] waiting_button_lock_backfilled: run=${runId} node=${nodeId} wa=${(lastMsg as any).wa_message_id}`);
        return true;
      }
      console.error(`[automation-engine] backfill_failed: run=${runId} node=${nodeId} err=${insErr.message}`);
    }
  }

  console.error(`[automation-engine] waiting_button_without_lock: run=${runId} node=${nodeId} — abortando pausa`);
  await admin.from("automation_scheduled_steps").delete().eq("run_id", runId);
  await admin.from("automation_runs").update({
    status: "failed",
    finished_at: new Date().toISOString(),
    last_error: "waiting_button_without_lock",
    variables: vars,
  }).eq("id", runId);
  return false;
}


/**
 * Cancela runs anteriores do mesmo contato/conversa que estejam pendurados
 * em `waiting_button` ou `waiting`. Rodado imediatamente após criar uma nova
 * run (tag_added, manual_trigger, broadcast_send) para evitar acúmulo de
 * passivo: quando o contato entra em uma nova automação, os fluxos antigos
 * do mesmo workspace/contato são superados.
 *
 * Regras:
 *  - Só cancela do MESMO brand.
 *  - Só cancela do MESMO contact_id (quando informado) OU da MESMA conversation_id.
 *  - Nunca cancela `exceptRunId` (a run recém-criada).
 *  - Marca `last_error='superseded_by_newer_run'` e apaga steps agendados.
 *  - Best-effort: falhas são logadas mas nunca propagadas — não pode quebrar
 *    o disparo da nova automação.
 */
async function supersedeOldRuns(
  admin: any,
  opts: {
    brandId: string;
    contactId?: string | null;
    conversationId?: string | null;
    exceptRunId: string;
  },
): Promise<void> {
  try {
    if (!opts.brandId || !opts.exceptRunId) return;
    if (!opts.contactId && !opts.conversationId) return;

    let query = admin
      .from("automation_runs")
      .select("id")
      .eq("brand_id", opts.brandId)
      .in("status", ["waiting_button", "waiting"])
      .neq("id", opts.exceptRunId);

    const orClauses: string[] = [];
    if (opts.contactId) orClauses.push(`contact_id.eq.${opts.contactId}`);
    if (opts.conversationId) orClauses.push(`conversation_id.eq.${opts.conversationId}`);
    if (orClauses.length === 0) return;
    query = query.or(orClauses.join(","));

    const { data: old } = await query;
    if (!old?.length) return;
    const ids = old.map((r: any) => r.id);

    await admin.from("automation_scheduled_steps").delete().in("run_id", ids);
    await admin.from("automation_runs").update({
      status: "cancelled",
      finished_at: new Date().toISOString(),
      last_error: "superseded_by_newer_run",
    }).in("id", ids);

    console.log(`[automation-engine] superseded_by_newer_run: cancelled ${ids.length} old runs (contact=${opts.contactId ?? "-"} conv=${opts.conversationId ?? "-"} except=${opts.exceptRunId})`);
  } catch (e) {
    console.error("[automation-engine] supersedeOldRuns failed:", (e as Error).message);
  }
}




// ============================================================================
// In-memory cache for broadcast hot path (instance-scoped, TTL 60s).
// Reduces ~6 redundant DB round-trips per contact in sustained bursts:
//  - template lookup by id (invariant per templateId)
//  - eligible channels for a template (invariant per brand:name:lang)
//  - channel WhatsApp token (invariant per channelId)
// Tradeoff: edits to template/channel/token take up to 60s to propagate
// on a warm instance. Acceptable for our usage; not actively invalidated.
// ============================================================================
const CACHE_TTL_MS = 60_000;
type CacheEntry<T> = { value: T; expires: number };
function cacheGet<T>(m: Map<string, CacheEntry<T>>, k: string): T | undefined {
  const e = m.get(k);
  if (e && e.expires > Date.now()) return e.value;
  if (e) m.delete(k);
  return undefined;
}
function cacheSet<T>(m: Map<string, CacheEntry<T>>, k: string, v: T): void {
  m.set(k, { value: v, expires: Date.now() + CACHE_TTL_MS });
}
const _tplCache = new Map<string, CacheEntry<any>>();
const _eligibleCache = new Map<string, CacheEntry<any[]>>();
const _tokenCache = new Map<string, CacheEntry<string>>();
const _automationCache = new Map<string, CacheEntry<any>>();

async function getAutomationCached(
  admin: ReturnType<typeof getAdminClient>,
  automationId: string,
): Promise<any | null> {
  const hit = cacheGet(_automationCache, automationId);
  if (hit !== undefined) return hit;
  const { data } = await admin
    .from("automations")
    .select("id, graph, brand_id, status")
    .eq("id", automationId)
    .maybeSingle();
  if (data) cacheSet(_automationCache, automationId, data);
  return data ?? null;
}

async function getTemplateCached(
  admin: ReturnType<typeof getAdminClient>,
  templateId: string,
): Promise<any | null> {
  const hit = cacheGet(_tplCache, templateId);
  if (hit !== undefined) return hit;
  const { data } = await admin
    .from("whatsapp_templates")
    .select("name, language, components, header_type")
    .eq("id", templateId)
    .maybeSingle();
  if (data) cacheSet(_tplCache, templateId, data);
  return data ?? null;
}

async function getChannelTokenCached(channelId: string): Promise<string> {
  const hit = cacheGet(_tokenCache, channelId);
  if (hit !== undefined) return hit;
  const token = await getChannelToken(channelId);
  cacheSet(_tokenCache, channelId, token);
  return token;
}

// Tipos do grafo vêm do módulo compartilhado (fonte única para motor + fast-path).
type FlowNode = SharedFlowNode;
type FlowEdge = SharedFlowEdge;
type Graph = SharedGraph;

interface Body {
  event: "tag_added" | "inbound" | "button_click" | "tick" | "manual_trigger" | "broadcast_send";
  contact_id?: string;
  conversation_id?: string;
  tag?: string;
  message?: { type: string; content: string | null } | null;
  button?: { payload?: string | null; text?: string | null } | null;
  automation_id?: string;
  variables?: Record<string, any>;
  async?: boolean;
  // broadcast_send-only
  broadcast_id?: string;
  broadcast_target_id?: string;
}

function nextNode(graph: Graph, fromId: string, handle: string | null = null): FlowNode | null {
  const edge = graph.edges.find(
    (e) => e.source === fromId && (handle == null ? !e.sourceHandle || e.sourceHandle === "next" : e.sourceHandle === handle)
  );
  if (!edge) return null;
  return graph.nodes.find((n) => n.id === edge.target) ?? null;
}

function resolvePath(vars: Record<string, any>, path: string): any {
  if (path in vars) return vars[path];
  const parts = path.split(".");
  let cur: any = vars;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function interpolate(tpl: string, vars: Record<string, any>): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => {
    const v = resolvePath(vars, k);
    return v == null ? "" : typeof v === "string" ? v : JSON.stringify(v);
  });
}

// Conta quantos placeholders {{N}} existem no BODY do template Meta.
// Usamos isso para alinhar o array de variáveis ao tamanho real do template,
// evitando #132000 (Number of parameters does not match) quando o nó tem
// itens órfãos de uma versão anterior do template.
function countTemplateBodyParams(components: any[]): number {
  const body = (components ?? []).find(
    (c: any) => (c?.type ?? "").toString().toUpperCase() === "BODY",
  );
  const text = String(body?.text ?? "");
  const matches = text.match(/\{\{\s*(\d+)\s*\}\}/g) ?? [];
  if (!matches.length) return 0;
  const nums = matches.map((m) => Number(m.replace(/\D/g, ""))).filter((n) => Number.isFinite(n) && n > 0);
  return nums.length ? Math.max(...nums) : 0;
}

function clampTemplateVars(vars: string[], count: number): string[] {
  const next = vars.slice(0, count);
  while (next.length < count) next.push("");
  return next;
}

async function runStep(
  admin: ReturnType<typeof getAdminClient>,
  runId: string,
  node: FlowNode,
  payload: any = null,
  error: string | null = null,
) {
  await admin.from("automation_run_steps").insert({
    run_id: runId,
    node_id: node.id,
    node_type: node.type,
    payload,
    error,
  });
}

async function finalizeRun(
  admin: ReturnType<typeof getAdminClient>,
  runId: string,
  extra: Record<string, any> = {},
) {
  const { data: errSteps } = await admin
    .from("automation_run_steps")
    .select("error, executed_at")
    .eq("run_id", runId)
    .not("error", "is", null)
    .order("executed_at", { ascending: false })
    .limit(1);
  const failed = (errSteps ?? []).length > 0;
  await admin.from("automation_runs").update({
    status: failed ? "failed" : "completed",
    finished_at: new Date().toISOString(),
    last_error: failed ? (errSteps?.[0]?.error ?? null) : null,
    ...extra,
  }).eq("id", runId);
}

async function loadConvContext(admin: ReturnType<typeof getAdminClient>, conversationId: string) {
  const { data: conv } = await admin
    .from("conversations")
    .select("id, brand_id, channel_id, contact_id, window_expires_at, channel:channel_id(phone_number_id), contacts:contact_id(wa_id, bsuid, profile_name, name, phone, metadata)")
    .eq("id", conversationId)
    .maybeSingle();
  if (conv) {
    (conv as any)._bsuid_mode = await getBsuidMode(admin, (conv as any).brand_id);
  }
  return conv;
}

async function loadContactContext(admin: ReturnType<typeof getAdminClient>, contactId: string) {
  const { data: contact } = await admin
    .from("contacts")
    .select("id, brand_id, wa_id, bsuid, profile_name, name, phone, metadata")
    .eq("id", contactId)
    .maybeSingle();
  if (contact) {
    (contact as any)._bsuid_mode = await getBsuidMode(admin, (contact as any).brand_id);
  }
  return contact;
}

// BSUID (Onda 2): cache curto de `brands.bsuid_mode` por brand_id para evitar
// query extra em cada disparo. TTL curto porque a flag muda por dashboard.
const _bsuidModeCache = new Map<string, { value: "off" | "shadow" | "on"; expiresAt: number }>();
async function getBsuidMode(admin: ReturnType<typeof getAdminClient>, brandId: string): Promise<"off" | "shadow" | "on"> {
  const hit = _bsuidModeCache.get(brandId);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  let value: "off" | "shadow" | "on" = "off";
  try {
    const { data } = await admin.from("brands").select("bsuid_mode").eq("id", brandId).maybeSingle();
    const m = (data as any)?.bsuid_mode;
    if (m === "shadow" || m === "on") value = m;
  } catch (_e) { /* default off */ }
  _bsuidModeCache.set(brandId, { value, expiresAt: Date.now() + 60_000 });
  return value;
}

function resolveOutboundTo(contactRow: any, mode: "off" | "shadow" | "on"): string | null {
  const bsuid = contactRow?.bsuid ?? null;
  if (mode === "on" && bsuid) return bsuid;
  return contactRow?.wa_id ?? null;
}

function buildBaseVars(conv: any, extras: Record<string, any> = {}): Record<string, any> {
  // BSUID Onda 2: se o workspace está em `on` e o contato tem BSUID, usa BSUID como _to.
  const mode = (conv as any)._bsuid_mode ?? "off";
  return {
    _conversation_id: conv.id,
    _brand_id: conv.brand_id,
    _channel_id: conv.channel_id,
    _phone_number_id: conv.channel?.phone_number_id,
    _to: resolveOutboundTo(conv.contacts, mode),
    _window_expires_at: conv.window_expires_at,
    _contact_tags: Array.isArray(conv.contacts?.metadata?.tags) ? conv.contacts.metadata.tags : [],
    conversation_id: conv.id,
    contact_id: conv.contact_id,
    contact_phone: conv.contacts?.phone,
    contact_email: conv.contacts?.metadata?.email ?? null,
    contact_name: conv.contacts?.profile_name || conv.contacts?.name || null,
    custom: (conv.contacts?.metadata?.custom && typeof conv.contacts.metadata.custom === "object")
      ? conv.contacts.metadata.custom
      : {},
    ...extras,
  };
}

function buildBaseVarsFromContact(contact: any, extras: Record<string, any> = {}): Record<string, any> {
  const modeC = (contact as any)._bsuid_mode ?? "off";
  return {
    _conversation_id: null,
    _brand_id: contact.brand_id,
    _channel_id: null,
    _phone_number_id: null,
    _to: resolveOutboundTo(contact, modeC),
    _window_expires_at: null,
    _contact_tags: Array.isArray(contact.metadata?.tags) ? contact.metadata.tags : [],
    conversation_id: null,
    contact_id: contact.id,
    contact_phone: contact.phone ?? null,
    contact_email: contact.metadata?.email ?? null,
    contact_name: contact.profile_name || contact.name || null,
    custom: (contact.metadata?.custom && typeof contact.metadata.custom === "object")
      ? contact.metadata.custom
      : {},
    ...extras,
  };
}

async function isBlocklisted(
  admin: ReturnType<typeof getAdminClient>,
  brandId: string | null | undefined,
  phone: string | null | undefined,
  email: string | null | undefined,
): Promise<boolean> {
  if (!brandId) return false;
  if (!phone && !email) return false;
  const { data } = await admin.rpc("is_blocked", {
    _brand: brandId,
    _phone: phone ?? null,
    _email: email ?? null,
  });
  return data === true;
}

/**
 * Resolve qual canal usar para enviar um template HSM.
 *
 * Templates são recursos do WABA, então um template aprovado numa WABA é enviável
 * a partir de qualquer brand_channel (telefone) que compartilhe o mesmo waba_id.
 *
 * Regras:
 * 1) followContactChannel + conversa atual num canal elegível marcado → usa esse canal.
 * 2) modo "random" → escolhe aleatoriamente entre os canais marcados.
 * 3) modo "fixed" → usa fallback explícito (se elegível).
 *
 * Retorna o channel a ser usado e a conversa correspondente (criando uma se
 * o canal escolhido for diferente da conversa atual do contato).
 */
async function resolveTemplateChannel(
  admin: ReturnType<typeof getAdminClient>,
  opts: {
    brandId: string;
    contactId: string;
    templateName: string;
    templateLanguage: string;
    nodeData: any;
    currentConv?: { id: string; channel_id: string | null; window_expires_at: string | null } | null;
  },
): Promise<
  | { ok: true; channelId: string; phoneNumberId: string; conversationId: string; windowExpiresAt: string | null }
  | { ok: false; reason: string }
> {
  const { brandId, contactId, templateName, templateLanguage, nodeData, currentConv } = opts;
  if (!brandId || !contactId || !templateName || !templateLanguage) {
    return { ok: false, reason: "Dados de envio ausentes" };
  }

  // 1) WABAs que têm este template aprovado no workspace
  //    Cacheado por (brand, name, language) — passos 1-3 são invariantes
  //    por workspace/template; passos 4-6 dependem do contato e ficam fora.
  const eligKey = `${brandId}:${templateName}:${templateLanguage}`;
  let eligible = cacheGet(_eligibleCache, eligKey);
  if (eligible === undefined) {
    const { data: tplRows } = await admin
      .from("whatsapp_templates")
      .select("channel_id, status")
      .eq("brand_id", brandId)
      .eq("name", templateName)
      .eq("language", templateLanguage);

    const tplChannelIds = Array.from(new Set(((tplRows ?? []) as any[]).map((r) => r.channel_id).filter(Boolean)));
    if (tplChannelIds.length === 0) {
      return { ok: false, reason: "Template não encontrado para este workspace" };
    }

    // 2) WABA_IDs desses canais
    const { data: tplChannels } = await admin
      .from("brand_channels")
      .select("id, waba_id")
      .in("id", tplChannelIds);
    const wabaIds = Array.from(new Set(((tplChannels ?? []) as any[]).map((r) => r.waba_id).filter(Boolean)));
    if (wabaIds.length === 0) {
      return { ok: false, reason: "Template sem WABA associada" };
    }

    // 3) Todos os canais ativos do workspace na mesma(s) WABA(s) = elegíveis
    const { data: eligibleRows } = await admin
      .from("brand_channels")
      .select("id, phone_number_id, waba_id, active")
      .eq("brand_id", brandId)
      .eq("active", true)
      .in("waba_id", wabaIds);
    eligible = ((eligibleRows ?? []) as any[]).filter((c) => !!c.phone_number_id);
    if (eligible.length === 0) {
      return { ok: false, reason: "Nenhum canal ativo para este template" };
    }
    cacheSet(_eligibleCache, eligKey, eligible);
  }

  // 4) Filtra pelos canais marcados pelo operador (se houver). Vazio = todos elegíveis.
  const allowedIds: string[] = Array.isArray(nodeData?.templateChannelIds) && nodeData.templateChannelIds.length > 0
    ? nodeData.templateChannelIds.filter((x: unknown) => typeof x === "string")
    : eligible.map((c) => c.id as string);
  const selected = eligible.filter((c) => allowedIds.includes(c.id));
  if (selected.length === 0) {
    return { ok: false, reason: "Nenhum canal elegível para este template" };
  }

  // 5) Resolve canal de envio
  const followContact = nodeData?.followContactChannel !== false; // default true
  let chosen = null as null | typeof selected[number];

  if (followContact && currentConv?.channel_id) {
    chosen = selected.find((c) => c.id === currentConv.channel_id) ?? null;
  }

  if (!chosen) {
    const mode = nodeData?.templateChannelMode === "fixed" ? "fixed" : "random";
    if (mode === "fixed") {
      const fb = nodeData?.templateChannelFallbackId;
      chosen = selected.find((c) => c.id === fb) ?? null;
      // Se canal fixo não está elegível, fallback para random nos selecionados.
      if (!chosen) chosen = selected[Math.floor(Math.random() * selected.length)];
    } else {
      chosen = selected[Math.floor(Math.random() * selected.length)];
    }
  }

  if (!chosen) return { ok: false, reason: "Não foi possível escolher canal" };

  // 6) Conversa correspondente ao canal escolhido
  let convId: string | null = null;
  let windowExp: string | null = null;
  if (currentConv?.channel_id === chosen.id) {
    convId = currentConv.id;
    windowExp = currentConv.window_expires_at ?? null;
  } else {
    const { data: existing } = await admin
      .from("conversations")
      .select("id, window_expires_at")
      .eq("contact_id", contactId)
      .eq("brand_id", brandId)
      .eq("channel_id", chosen.id)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (existing) {
      convId = (existing as any).id;
      windowExp = (existing as any).window_expires_at ?? null;
    } else {
      const { data: created, error: convErr } = await admin
        .from("conversations")
        .insert({
          brand_id: brandId,
          channel_id: chosen.id,
          contact_id: contactId,
          status: "aberto",
        })
        .select("id, window_expires_at")
        .single();
      if (convErr || !created) {
        return { ok: false, reason: `Falha ao criar conversa: ${convErr?.message ?? "desconhecido"}` };
      }
      convId = (created as any).id;
      windowExp = (created as any).window_expires_at ?? null;
    }
  }

  return {
    ok: true,
    channelId: chosen.id,
    phoneNumberId: chosen.phone_number_id,
    conversationId: convId!,
    windowExpiresAt: windowExp,
  };
}

async function executeFlow(
  admin: ReturnType<typeof getAdminClient>,
  runId: string,
  graph: Graph,
  startNode: FlowNode,
  vars: Record<string, any>,
  opts?: {
    // Usado pelo fast-path de broadcast: o motor entra direto no ramo `next`
    // do nó de mensagem (já enviado fora do executeFlow) e, ao terminar o
    // walk inline ou encontrar um nó bloqueante, pausa de volta neste id
    // como `waiting_button` — paridade total com o caminho normal.
    pauseAtMessageId?: string;
  },
) {
  let current: FlowNode | null = startNode;
  let safety = 0;

  // Estado para finalize em 1 round-trip (sem SELECT) e fallback de exceções.
  // Mantemos os inserts de run_steps imediatos (não bufferizados) — só o
  // último erro fica em memória pra alimentar o UPDATE final.
  let runFailed = false;
  let runLastError: string | null = null;
  // Marcado antes de cada `return` de pausa (wait/question/waiting_button)
  // pra o finally não interpretar a saída como exceção e marcar como failed.
  let pausedThisInvocation = false;
  let finalized = false;
  // Quando um nó de mensagem com botões TAMBÉM possui edge `next` conectada,
  // executamos o ramo `next` inline (efeitos colaterais: tag, status, etc.)
  // antes de pausar para o clique do botão. Esta variável guarda o id desse
  // nó de mensagem para pausarmos de volta nele quando o ramo `next` terminar
  // ou encontrar um nó bloqueante (message/question/wait).
  // Pode ser pré-semeada pelo fast-path de broadcast via opts.pauseAtMessageId.
  let pendingPauseAtMessageId: string | null = opts?.pauseAtMessageId ?? null;
  // SIDE_BRANCH_BLOCKING_TYPES vem do _shared/automation-helpers.ts —
  // fonte única para motor + fast-path. NÃO recriar local.

  const pauseAtMessageForButtons = async (messageNodeId: string, reason: string) => {
    if (!(await assertButtonLock(admin, runId, messageNodeId, vars))) {
      pausedThisInvocation = true;
      return;
    }
    await admin.from("automation_runs")
      .update({ current_node_id: messageNodeId, status: "waiting_button", variables: vars })
      .eq("id", runId);
    await runStep(
      admin,
      runId,
      { id: messageNodeId, type: "message", data: {} } as FlowNode,
      { side_branch: "paused_for_buttons", reason },
      null,
    );
    pausedThisInvocation = true;
  };


  const recordStep = async (node: FlowNode, payload: any = null, error: string | null = null) => {
    if (error) { runFailed = true; runLastError = error; }
    await runStep(admin, runId, node, payload, error);
  };

  try {
  // Garante que `_automation_id` e `_brand_id` estão em vars. Esses campos
  // são lidos por `logNodeMessage` (que ignora silenciosamente sem
  // automationId) e pelo backfill em `assertButtonLock`. Triggers normais
  // (manual, tag_added, inbound) não populavam `_automation_id`, fazendo
  // com que o lock nunca fosse gravado e o run fosse abortado com
  // `waiting_button_without_lock` mesmo após enviar o template.
  if (!vars._automation_id || !vars._brand_id) {
    const { data: runRow } = await admin
      .from("automation_runs")
      .select("automation_id, brand_id")
      .eq("id", runId)
      .maybeSingle();
    if (runRow) {
      if (!vars._automation_id) vars._automation_id = (runRow as any).automation_id ?? null;
      if (!vars._brand_id) vars._brand_id = (runRow as any).brand_id ?? null;
    }
  }
  while (current && safety < 100) {
    safety++;
    const node: FlowNode = current;

    // Se estamos percorrendo o ramo `next` de um nó de mensagem com botões,
    // e o próximo nó é bloqueante (outra mensagem/question/wait), interrompe
    // o walk inline e pausa de volta no nó de mensagem para aguardar o clique.
    if (pendingPauseAtMessageId && SIDE_BRANCH_BLOCKING_TYPES.has(node.type)) {
      await pauseAtMessageForButtons(pendingPauseAtMessageId, `blocking_node:${node.type}`);
      pendingPauseAtMessageId = null;
      return;
    }


    // CONDITION
    if (node.type === "condition") {
      const kind = node.data?.kind ?? "has_tag";
      let ok = false;
      if (kind === "has_tag") {
        const t = String(node.data?.tag ?? "").trim();
        ok = !!t && (vars._contact_tags as string[]).includes(t);
      } else if (kind === "in_window") {
        // null (nunca interagiu) ou data passada → ok=false → ramo "Não"
        ok = !!vars._window_expires_at && new Date(vars._window_expires_at) > new Date();
      } else if (kind === "in_pipeline") {
        const pipelineId = String(node.data?.pipelineId ?? "");
        const stageId = String(node.data?.stageId ?? "");
        if (pipelineId && vars.contact_id) {
          const { data: row } = await admin
            .from("pipeline_contacts")
            .select("stage_id")
            .eq("pipeline_id", pipelineId)
            .eq("contact_id", vars.contact_id)
            .maybeSingle();
          ok = !!row && (!stageId || row.stage_id === stageId);
        }
      } else if (kind === "is_blocklisted") {
        // Em runs de broadcast, o drain (broadcasts-engine) já filtrou
        // blocklist antes de enfileirar. Pular RPC redundante.
        ok = vars.broadcast_id
          ? false
          : await isBlocklisted(admin, vars._brand_id, vars.contact_phone, vars.contact_email);
      } else if (kind === "field") {
        const field = node.data?.field ?? {};
        const source = String(field.source ?? "contact");
        const key = String(field.key ?? "");
        const ftype = String(field.type ?? "text");
        const operator = String(node.data?.operator ?? "is");
        const caseSensitive = !!node.data?.caseSensitive;
        const rawValue = interpolate(String(node.data?.value ?? ""), vars);

        // Resolve actual field value from vars/contact
        let actual: any = null;
        if (source === "custom") {
          actual = (vars.custom && typeof vars.custom === "object") ? vars.custom[key] : null;
        } else {
          // standard contact fields
          if (key === "name") actual = vars.contact_name ?? null;
          else if (key === "phone" || key === "wa_id") actual = vars.contact_phone ?? null;
          else if (key === "email") actual = vars.contact_email ?? null;
          else if (key === "id") actual = vars.contact_id ?? null;
          else actual = null;
        }

        const hasValue = actual !== null && actual !== undefined && String(actual) !== "";
        const aStr = hasValue ? String(actual) : "";
        const bStr = rawValue ?? "";
        const aCmp = caseSensitive ? aStr : aStr.toLowerCase();
        const bCmp = caseSensitive ? bStr : bStr.toLowerCase();

        try {
          switch (operator) {
            case "has_value": ok = hasValue; break;
            case "no_value": ok = !hasValue; break;
            case "is_true": ok = actual === true || aStr === "true" || aStr === "1"; break;
            case "is_false": ok = actual === false || aStr === "false" || aStr === "0"; break;
            case "is": case "eq": ok = aCmp === bCmp; break;
            case "is_not": case "neq": ok = aCmp !== bCmp; break;
            case "contains": ok = hasValue && aCmp.includes(bCmp); break;
            case "not_contains": ok = !aCmp.includes(bCmp); break;
            case "starts_with": ok = hasValue && aCmp.startsWith(bCmp); break;
            case "ends_with": ok = hasValue && aCmp.endsWith(bCmp); break;
            case "regex": {
              if (!bStr) { ok = false; break; }
              const re = new RegExp(bStr, caseSensitive ? "" : "i");
              ok = hasValue && re.test(aStr);
              break;
            }
            case "gt": ok = hasValue && Number(actual) > Number(rawValue); break;
            case "gte": ok = hasValue && Number(actual) >= Number(rawValue); break;
            case "lt": ok = hasValue && Number(actual) < Number(rawValue); break;
            case "lte": ok = hasValue && Number(actual) <= Number(rawValue); break;
            case "before": ok = hasValue && new Date(aStr).getTime() < new Date(bStr).getTime(); break;
            case "after": ok = hasValue && new Date(aStr).getTime() > new Date(bStr).getTime(); break;
            default: ok = false;
          }
        } catch (_e) {
          ok = false;
        }
      }
      await recordStep(node, { kind, result: ok });
      current = nextNode(graph, node.id, ok ? "true" : "false");
      continue;
    }

    // WAIT
    if (node.type === "wait") {
      const mode = node.data?.mode ?? "duration";
      if (mode === "inbound") {
        if (!vars._conversation_id) {
          await recordStep(node, { mode, skipped: "no_conversation" });
          pausedThisInvocation = true;
          return;
        }
        await admin.from("automation_runs")
          .update({ current_node_id: node.id, status: "waiting", variables: vars })
          .eq("id", runId);
        await recordStep(node, { mode });
        pausedThisInvocation = true;
        return;
      }
      let resumeAt: Date;
      if (mode === "until_date") {
        resumeAt = new Date(node.data?.date);
        if (isNaN(resumeAt.getTime())) resumeAt = new Date(Date.now() + 60_000);
      } else {
        const amount = Number(node.data?.amount ?? 1);
        const unitMs = node.data?.unit === "hours" ? 3600_000
          : node.data?.unit === "days" ? 86_400_000
          : 60_000;
        resumeAt = new Date(Date.now() + amount * unitMs);
      }
      await admin.from("automation_scheduled_steps").insert({
        run_id: runId, resume_at: resumeAt.toISOString(),
      });
      await admin.from("automation_runs")
        .update({ current_node_id: node.id, status: "sleeping", variables: vars })
        .eq("id", runId);
      await recordStep(node, { mode, resume_at: resumeAt.toISOString() });
      pausedThisInvocation = true;
      return;
    }

    // MESSAGE
    if (node.type === "message") {
      // Helper: pick best error branch with fallback to "next"
      const pickMessageBranch = (errorKind: "meta" | "internal" | null) => {
        if (errorKind === "meta") {
          const metaBranch = nextNode(graph, node.id, "error_meta");
          if (metaBranch) return metaBranch;
          const errBranch = nextNode(graph, node.id, "error");
          if (errBranch) return errBranch;
        } else if (errorKind === "internal") {
          const errBranch = nextNode(graph, node.id, "error");
          if (errBranch) return errBranch;
        }
        return nextNode(graph, node.id);
      };

      const modeForCheck = node.data?.mode ?? "text";
      // Para envio de template (HSM) podemos prosseguir mesmo sem conversa atual:
      // resolveTemplateChannel cria a conversa no canal escolhido.
      if (!vars._conversation_id && !(modeForCheck === "template" && node.data?.templateId)) {
        await recordStep(node, { skipped: "no_conversation" });
        current = pickMessageBranch("internal");
        continue;
      }
      let errorKind: "meta" | "internal" | null = null;
      let pausedForButtons = false;
      try {
        const mode = node.data?.mode ?? "text";
        if (mode === "template" && node.data?.templateId) {
          // Fetch template details (cached por templateId)
          const tpl = await getTemplateCached(admin, node.data.templateId);
          if (!tpl || !vars._brand_id || !vars.contact_id || !vars._to) {
            errorKind = "internal";
            await recordStep(node, { mode, skipped: !tpl ? "template_not_found" : "missing_data" }, !tpl ? "Template não encontrado" : "Dados de envio ausentes");
          } else {
            // Resolve canal de envio: prioriza canal da conversa atual (se elegível e switch ligado),
            // senão sorteia/usa fixo conforme configuração do nó.
            const currentConv = vars._conversation_id
              ? { id: vars._conversation_id as string, channel_id: vars._channel_id ?? null, window_expires_at: vars._window_expires_at ?? null }
              : null;
            const resolved = await resolveTemplateChannel(admin, {
              brandId: vars._brand_id,
              contactId: vars.contact_id,
              templateName: tpl.name,
              templateLanguage: tpl.language,
              nodeData: node.data,
              currentConv,
            });
            if (!resolved.ok) {
              errorKind = "internal";
              await recordStep(node, { mode, skipped: "no_eligible_channel" }, resolved.reason);
            } else {
              // Propaga conv/canal escolhidos para os próximos nós deste run.
              vars._conversation_id = resolved.conversationId;
              vars._channel_id = resolved.channelId;
              vars._phone_number_id = resolved.phoneNumberId;
              vars._window_expires_at = resolved.windowExpiresAt;
              vars.conversation_id = resolved.conversationId;

              const token = await getChannelTokenCached(resolved.channelId);
              const overrideUrl = node.data?.templateHeaderMediaUrl ?? null;
              const overrideFilename = node.data?.templateHeaderMediaFilename ?? null;
              // header_type pode estar vazio no banco — derivar de components também
              const explicitHt = (tpl.header_type ?? "").toString().toUpperCase();
              const compsArr: any[] = Array.isArray((tpl as any).components) ? (tpl as any).components : [];
              const headerComp = compsArr.find((c: any) => c?.type === "HEADER");
              const fmtHt = (headerComp?.format ?? "").toString().toUpperCase();
              const resolvedHt = (explicitHt === "IMAGE" || explicitHt === "VIDEO" || explicitHt === "DOCUMENT" || explicitHt === "TEXT")
                ? explicitHt
                : (fmtHt === "IMAGE" || fmtHt === "VIDEO" || fmtHt === "DOCUMENT" || fmtHt === "TEXT") ? fmtHt : "";
              const headerType = (resolvedHt === "IMAGE" || resolvedHt === "VIDEO" || resolvedHt === "DOCUMENT")
                ? resolvedHt as "IMAGE" | "VIDEO" | "DOCUMENT"
                : null;
              // Mídia é sempre por automação — não reaproveita a do template.
              const headerMediaLink = headerType ? overrideUrl : null;
              const headerMediaFilename = headerType === "DOCUMENT" ? overrideFilename : null;
              const rawVars: unknown[] = Array.isArray(node.data?.templateVariables) ? node.data.templateVariables : [];
              const interpolatedVars = clampTemplateVars(
                rawVars.map((v) => interpolate(String(v ?? ""), vars)),
                countTemplateBodyParams(compsArr),
              );
              const sendStartedAt = Date.now();
              const headerMediaHandle = headerType && headerMediaLink
                ? await resolveTemplateHeaderMediaId({
                    admin, brandId: vars._brand_id, phoneNumberId: resolved.phoneNumberId,
                    token, sourceUrl: headerMediaLink, filename: headerMediaFilename,
                    headerType,
                  })
                : null;
              const r = await sendTemplate({
                token,
                phoneNumberId: resolved.phoneNumberId,
                to: vars._to,
                templateName: tpl.name,
                language: tpl.language,
                variables: interpolatedVars,
                headerType,
                headerMediaLink,
                headerMediaHandle,
                headerMediaFilename,
                blocklistGuard: { admin, brandId: vars._brand_id, phone: vars.contact_phone, email: vars.contact_email },
              });
              let insertedMessageId: string | null = null;
              if (r.ok) {
                const { data: ins } = await admin.from("messages").insert({
                  conversation_id: resolved.conversationId,
                  brand_id: vars._brand_id,
                  channel_id: resolved.channelId,
                  direction: "outbound",
                  type: "template",
                  content: tpl.name,
                  template_name: tpl.name,
                  template_language: tpl.language,
                  template_variables: interpolatedVars,
                  media_url: headerMediaLink ?? null,
                  media_filename: headerMediaFilename ?? null,
                  wa_message_id: r.data?.messages?.[0]?.id ?? null,
                  status: "sent",
                }).select("id").maybeSingle();
                insertedMessageId = (ins as any)?.id ?? null;
              } else {
                errorKind = "meta";
              }
              await logWhatsAppSend({
                brandId: vars._brand_id, source: "automation", type: "template",
                to: vars._to, templateName: tpl.name, templateLanguage: tpl.language,
                variables: interpolatedVars, mediaUrl: headerMediaLink ?? null,
                status: r.ok ? "sent" : "failed",
                waMessageId: r.data?.messages?.[0]?.id ?? null,
                errorCode: r.ok ? null : String(r.error?.code ?? "META_ERR"),
                errorMessage: r.ok ? null : (r.error?.message ?? null),
                messageId: insertedMessageId,
                durationMs: Date.now() - sendStartedAt,
                statusCode: r.ok ? 200 : 400,
              });
              await logNodeMessage({
                brandId: vars._brand_id, automationId: vars._automation_id, runId,
                nodeId: node.id, nodeType: node.type,
                contactId: vars.contact_id, conversationId: resolved.conversationId,
                channelId: resolved.channelId,
                waMessageId: r.data?.messages?.[0]?.id ?? null,
                templateName: tpl.name, ok: r.ok,
                errorCode: r.ok ? null : String(r.error?.code ?? "META_ERR"),
                errorMessage: r.ok ? null : (r.error?.message ?? null),
              });
              await recordStep(node, { mode, template: tpl.name, channel_id: resolved.channelId, sent: r.ok, error: r.error, errorCode: r.ok ? null : (r.error?.code ?? null) }, r.ok ? null : (r.error?.message ?? "Falha no envio do template"));
            }
          }
          // hasButtonEdges check moved below — also valid for text mode w/ interactive buttons
        } else {
          // text mode — only if window is open
          const inWindow = vars._window_expires_at && new Date(vars._window_expires_at) > new Date();
          const text = interpolate(String(node.data?.text ?? ""), vars);
          const rawBtns: any[] = Array.isArray(node.data?.buttons) ? node.data.buttons : [];
          const validBtns = rawBtns
            .filter((b) => b && (b.type ?? "QUICK_REPLY") === "QUICK_REPLY" && String(b.text ?? "").trim().length > 0)
            .slice(0, 3);
          const mediaUrl: string | null = node.data?.mediaUrl ?? null;
          const mediaMime: string | null = node.data?.mediaMime ?? null;
          const mediaFilename: string | null = node.data?.mediaFilename ?? null;
          const mediaKind: "image" | "video" | "audio" | "document" | null = mediaUrl
            ? ((node.data?.mediaKind as any) || (
                mediaMime?.startsWith("image/") ? "image"
                : mediaMime?.startsWith("video/") ? "video"
                : mediaMime?.startsWith("audio/") ? "audio"
                : "document"))
            : null;
          const hasContent = !!mediaUrl || !!text;
          if (inWindow && hasContent && vars._channel_id && vars._phone_number_id && vars._to) {
            const token = await getChannelTokenCached(vars._channel_id);
            const sendStartedAt = Date.now();
            const r = mediaUrl && mediaKind
              ? await sendMedia({
                  token, phoneNumberId: vars._phone_number_id, to: vars._to,
                  type: mediaKind, link: mediaUrl,
                  caption: mediaKind !== "audio" && text ? text : undefined,
                  filename: mediaKind === "document" ? (mediaFilename ?? undefined) : undefined,
                  blocklistGuard: { admin, brandId: vars._brand_id, phone: vars.contact_phone, email: vars.contact_email },
                })
              : validBtns.length > 0
                ? await sendInteractiveButtons({
                    token, phoneNumberId: vars._phone_number_id, to: vars._to, body: text,
                    buttons: validBtns.map((b) => ({ id: `btn:${b.index}`, title: String(b.text) })),
                    blocklistGuard: { admin, brandId: vars._brand_id, phone: vars.contact_phone, email: vars.contact_email },
                  })
                : await sendText({
                    token, phoneNumberId: vars._phone_number_id, to: vars._to, body: text,
                    blocklistGuard: { admin, brandId: vars._brand_id, phone: vars.contact_phone, email: vars.contact_email },
                  });
            let insertedMessageId: string | null = null;
            if (r.ok) {
              const messageType = mediaKind ?? "text";
              const { data: ins } = await admin.from("messages").insert({
                conversation_id: vars._conversation_id,
                brand_id: vars._brand_id,
                channel_id: vars._channel_id,
                direction: "outbound",
                type: messageType,
                content: mediaKind === "audio" ? null : text,
                media_url: mediaUrl,
                media_mime: mediaMime,
                media_filename: mediaFilename,
                wa_message_id: r.data?.messages?.[0]?.id ?? null,
                status: "sent",
              }).select("id").maybeSingle();
              insertedMessageId = (ins as any)?.id ?? null;
            } else {
              errorKind = "meta";
            }
            await logWhatsAppSend({
              brandId: vars._brand_id, source: "automation",
              type: mediaKind ?? (validBtns.length > 0 ? "text" : "text"),
              to: vars._to, content: mediaKind === "audio" ? null : text,
              mediaUrl: mediaUrl,
              status: r.ok ? "sent" : "failed",
              waMessageId: r.data?.messages?.[0]?.id ?? null,
              errorCode: r.ok ? null : String(r.error?.code ?? "META_ERR"),
              errorMessage: r.ok ? null : (r.error?.message ?? null),
              messageId: insertedMessageId,
              durationMs: Date.now() - sendStartedAt,
              statusCode: r.ok ? 200 : 400,
            });
            await logNodeMessage({
              brandId: vars._brand_id, automationId: vars._automation_id, runId,
              nodeId: node.id, nodeType: node.type,
              contactId: vars.contact_id, conversationId: vars._conversation_id,
              channelId: vars._channel_id,
              waMessageId: r.data?.messages?.[0]?.id ?? null,
              ok: r.ok,
              errorCode: r.ok ? null : String(r.error?.code ?? "META_ERR"),
              errorMessage: r.ok ? null : (r.error?.message ?? null),
            });
            await recordStep(node, { mode, text, media: mediaKind, buttons: validBtns.length, sent: r.ok, errorCode: r.ok ? null : (r.error?.code ?? null) }, r.ok ? null : (r.error?.message ?? "Falha no envio"));
          } else {
            errorKind = "internal";
            await recordStep(node, { mode, skipped: !inWindow ? "window_closed" : "missing_data" }, !inWindow ? "Janela 24h fechada" : "Dados de envio ausentes");
          }
        }
        // If node has quick-reply button edges connected and no error, pause until button_click.
        // Exceção: se também existe edge `next` conectada, percorremos o ramo `next`
        // inline primeiro (tag, set_status, etc.) e só então pausamos no nó de mensagem.
        if (!errorKind) {
          const hasButtonEdges = graph.edges.some((e) => e.source === node.id && e.sourceHandle?.startsWith("btn:"));
          // `next` cobre tanto sourceHandle === "next" quanto a aresta default
          // (sourceHandle vazio/null), que é como o editor visual normalmente
          // grava a saída padrão dos nós de mensagem.
          const hasNextEdge = !!nextNode(graph, node.id);
          if (hasButtonEdges && !hasNextEdge) {
            if (!(await assertButtonLock(admin, runId, node.id, vars))) {
              pausedForButtons = true;
            } else {
              await admin.from("automation_runs")
                .update({ current_node_id: node.id, status: "waiting_button", variables: vars })
                .eq("id", runId);
              pausedForButtons = true;
            }
          } else if (hasButtonEdges && hasNextEdge) {

            // Marca para pausar ao final do walk; o loop principal segue por `next`.
            pendingPauseAtMessageId = node.id;
          }
        }

      } catch (e) {
        errorKind = "internal";
        await recordStep(node, null, String((e as Error).message));
      }
      if (pausedForButtons) { pausedThisInvocation = true; return; }
      current = pickMessageBranch(errorKind);
      continue;
    }


    // QUESTION — send a message, then pause until inbound reply or timeout
    if (node.type === "question") {
      const qMode = node.data?.mode ?? "text";
      if (!vars._conversation_id && !(qMode === "template" && node.data?.templateId)) {
        await recordStep(node, { skipped: "no_conversation" });
        const errBranch = nextNode(graph, node.id, "error");
        current = errBranch ?? nextNode(graph, node.id);
        continue;
      }
      let sendErr: string | null = null;
      try {
        const mode = node.data?.mode ?? "text";
        if (mode === "template" && node.data?.templateId) {
          const tpl = await getTemplateCached(admin, node.data.templateId);
          if (!tpl || !vars._brand_id || !vars.contact_id || !vars._to) {
            sendErr = !tpl ? "Template não encontrado" : "Dados de envio ausentes";
          } else {
            const currentConv = vars._conversation_id
              ? { id: vars._conversation_id as string, channel_id: vars._channel_id ?? null, window_expires_at: vars._window_expires_at ?? null }
              : null;
            const resolved = await resolveTemplateChannel(admin, {
              brandId: vars._brand_id,
              contactId: vars.contact_id,
              templateName: tpl.name,
              templateLanguage: tpl.language,
              nodeData: node.data,
              currentConv,
            });
            if (!resolved.ok) {
              sendErr = resolved.reason;
            } else {
              vars._conversation_id = resolved.conversationId;
              vars._channel_id = resolved.channelId;
              vars._phone_number_id = resolved.phoneNumberId;
              vars._window_expires_at = resolved.windowExpiresAt;
              vars.conversation_id = resolved.conversationId;

              const token = await getChannelTokenCached(resolved.channelId);
              const explicitHt = (tpl.header_type ?? "").toString().toUpperCase();
              const compsArr: any[] = Array.isArray((tpl as any).components) ? (tpl as any).components : [];
              const headerComp = compsArr.find((c: any) => c?.type === "HEADER");
              const fmtHt = (headerComp?.format ?? "").toString().toUpperCase();
              const resolvedHt = (explicitHt === "IMAGE" || explicitHt === "VIDEO" || explicitHt === "DOCUMENT" || explicitHt === "TEXT")
                ? explicitHt : (fmtHt === "IMAGE" || fmtHt === "VIDEO" || fmtHt === "DOCUMENT" || fmtHt === "TEXT") ? fmtHt : "";
              const headerType = (resolvedHt === "IMAGE" || resolvedHt === "VIDEO" || resolvedHt === "DOCUMENT")
                ? resolvedHt as "IMAGE" | "VIDEO" | "DOCUMENT" : null;
              const headerMediaLink = headerType ? (node.data?.templateHeaderMediaUrl ?? null) : null;
              const headerMediaFilename = headerType === "DOCUMENT" ? (node.data?.templateHeaderMediaFilename ?? null) : null;
              const rawVars: unknown[] = Array.isArray(node.data?.templateVariables) ? node.data.templateVariables : [];
              const interpolatedVars = clampTemplateVars(
                rawVars.map((v) => interpolate(String(v ?? ""), vars)),
                countTemplateBodyParams(compsArr),
              );
              const headerMediaHandle = headerType && headerMediaLink
                ? await resolveTemplateHeaderMediaId({
                    admin, brandId: vars._brand_id, phoneNumberId: resolved.phoneNumberId,
                    token, sourceUrl: headerMediaLink, filename: headerMediaFilename,
                    headerType,
                  })
                : null;
              const r = await sendTemplate({
                token, phoneNumberId: resolved.phoneNumberId, to: vars._to,
                templateName: tpl.name, language: tpl.language, variables: interpolatedVars,
                headerType, headerMediaLink, headerMediaHandle, headerMediaFilename,
                blocklistGuard: { admin, brandId: vars._brand_id, phone: vars.contact_phone, email: vars.contact_email },
              });
              if (r.ok) {
                await admin.from("messages").insert({
                  conversation_id: resolved.conversationId, brand_id: vars._brand_id, channel_id: resolved.channelId,
                  direction: "outbound", type: "template", content: tpl.name,
                  template_name: tpl.name, template_language: tpl.language, template_variables: interpolatedVars,
                  media_url: headerMediaLink ?? null, media_filename: headerMediaFilename ?? null,
                  wa_message_id: r.data?.messages?.[0]?.id ?? null, status: "sent",
                });
              } else {
                sendErr = r.error?.message ?? "Falha no envio do template";
              }
              await logWhatsAppSend({
                brandId: vars._brand_id, source: "automation", type: "template", to: vars._to,
                templateName: tpl.name, templateLanguage: tpl.language, variables: interpolatedVars,
                status: r.ok ? "sent" : "failed",
                waMessageId: r.data?.messages?.[0]?.id ?? null,
                errorCode: r.ok ? null : String(r.error?.code ?? "META_ERR"),
                errorMessage: r.ok ? null : (r.error?.message ?? null),
              });
              await logNodeMessage({
                brandId: vars._brand_id, automationId: vars._automation_id, runId,
                nodeId: node.id, nodeType: node.type,
                contactId: vars.contact_id, conversationId: resolved.conversationId,
                channelId: resolved.channelId,
                waMessageId: r.data?.messages?.[0]?.id ?? null,
                templateName: tpl.name, ok: r.ok,
                errorCode: r.ok ? null : String(r.error?.code ?? "META_ERR"),
                errorMessage: r.ok ? null : (r.error?.message ?? null),
              });
            }
          }
        } else {
          const inWindow = vars._window_expires_at && new Date(vars._window_expires_at) > new Date();
          const text = interpolate(String(node.data?.text ?? ""), vars);
          const rawBtns: any[] = Array.isArray(node.data?.buttons) ? node.data.buttons : [];
          const validBtns = rawBtns
            .filter((b) => b && (b.type ?? "QUICK_REPLY") === "QUICK_REPLY" && String(b.text ?? "").trim().length > 0)
            .slice(0, 3);
          const mediaUrl: string | null = node.data?.mediaUrl ?? null;
          const mediaMime: string | null = node.data?.mediaMime ?? null;
          const mediaFilename: string | null = node.data?.mediaFilename ?? null;
          const mediaKind: "image" | "video" | "audio" | "document" | null = mediaUrl
            ? ((node.data?.mediaKind as any) || (
                mediaMime?.startsWith("image/") ? "image"
                : mediaMime?.startsWith("video/") ? "video"
                : mediaMime?.startsWith("audio/") ? "audio"
                : "document"))
            : null;
          const hasContent = !!mediaUrl || !!text;
          if (inWindow && hasContent && vars._channel_id && vars._phone_number_id && vars._to) {
            const token = await getChannelTokenCached(vars._channel_id);
            const r = mediaUrl && mediaKind
              ? await sendMedia({
                  token, phoneNumberId: vars._phone_number_id, to: vars._to,
                  type: mediaKind, link: mediaUrl,
                  caption: mediaKind !== "audio" && text ? text : undefined,
                  filename: mediaKind === "document" ? (mediaFilename ?? undefined) : undefined,
                  blocklistGuard: { admin, brandId: vars._brand_id, phone: vars.contact_phone, email: vars.contact_email },
                })
              : validBtns.length > 0
                ? await sendInteractiveButtons({
                    token, phoneNumberId: vars._phone_number_id, to: vars._to, body: text,
                    buttons: validBtns.map((b) => ({ id: `btn:${b.index}`, title: String(b.text) })),
                    blocklistGuard: { admin, brandId: vars._brand_id, phone: vars.contact_phone, email: vars.contact_email },
                  })
                : await sendText({ token, phoneNumberId: vars._phone_number_id, to: vars._to, body: text, blocklistGuard: { admin, brandId: vars._brand_id, phone: vars.contact_phone, email: vars.contact_email } });
            if (r.ok) {
              const messageType = mediaKind ?? "text";
              await admin.from("messages").insert({
                conversation_id: vars._conversation_id, brand_id: vars._brand_id, channel_id: vars._channel_id,
                direction: "outbound", type: messageType,
                content: mediaKind === "audio" ? null : text,
                media_url: mediaUrl, media_mime: mediaMime, media_filename: mediaFilename,
                wa_message_id: r.data?.messages?.[0]?.id ?? null, status: "sent",
              });
            } else {
              sendErr = r.error?.message ?? "Falha no envio";
            }
            await logWhatsAppSend({
              brandId: vars._brand_id, source: "automation",
              type: mediaKind ?? "text",
              to: vars._to, content: mediaKind === "audio" ? null : text,
              mediaUrl: mediaUrl,
              status: r.ok ? "sent" : "failed",
              waMessageId: r.data?.messages?.[0]?.id ?? null,
              errorCode: r.ok ? null : String(r.error?.code ?? "META_ERR"),
              errorMessage: r.ok ? null : (r.error?.message ?? null),
            });
            await logNodeMessage({
              brandId: vars._brand_id, automationId: vars._automation_id, runId,
              nodeId: node.id, nodeType: node.type,
              contactId: vars.contact_id, conversationId: vars._conversation_id,
              channelId: vars._channel_id,
              waMessageId: r.data?.messages?.[0]?.id ?? null,
              ok: r.ok,
              errorCode: r.ok ? null : String(r.error?.code ?? "META_ERR"),
              errorMessage: r.ok ? null : (r.error?.message ?? null),
            });
          } else {
            sendErr = !inWindow ? "Janela 24h fechada" : "Dados de envio ausentes";
          }
        }
      } catch (e) {
        sendErr = String((e as Error).message);
      }
      if (sendErr) {
        await recordStep(node, { skipped: "send_failed" }, sendErr);
        const errBranch = nextNode(graph, node.id, "error");
        current = errBranch ?? nextNode(graph, node.id);
        continue;
      }
      // Pause until inbound, button click, or timeout
      const timeoutMin = Math.max(1, Number(node.data?.timeoutMinutes ?? 1440));
      const resumeAt = new Date(Date.now() + timeoutMin * 60_000);
      await admin.from("automation_scheduled_steps").insert({
        run_id: runId, resume_at: resumeAt.toISOString(),
      });
      // If question has button edges, use waiting_button so button_click event resumes via btn:* handle.
      const hasButtonEdges = graph.edges.some((e) => e.source === node.id && e.sourceHandle?.startsWith("btn:"));
      if (hasButtonEdges && !(await assertButtonLock(admin, runId, node.id, vars))) {
        pausedThisInvocation = true;
        return;
      }
      await admin.from("automation_runs")
        .update({ current_node_id: node.id, status: hasButtonEdges ? "waiting_button" : "waiting", variables: vars })
        .eq("id", runId);
      await recordStep(node, { paused: true, timeout_min: timeoutMin, has_buttons: hasButtonEdges });
      pausedThisInvocation = true;
      return;

    }



    // WEBHOOK
    if (node.type === "webhook") {
      try {
        const url = interpolate(String(node.data?.url ?? ""), vars);
        const method = String(node.data?.method ?? "POST");
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (node.data?.headers) {
          try {
            const h = JSON.parse(interpolate(String(node.data.headers), vars));
            Object.assign(headers, h);
          } catch {}
        }
        let body: string | undefined;
        if (method !== "GET" && node.data?.payload) body = interpolate(String(node.data.payload), vars);
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 10000);
        const res = await fetch(url, { method, headers, body, signal: ctrl.signal });
        clearTimeout(t);
        const respText = await res.text().catch(() => "");
        await recordStep(node, { url, status: res.status, response: respText.slice(0, 500) });
      } catch (e) {
        await recordStep(node, null, String((e as Error).message));
      }
      current = nextNode(graph, node.id);
      continue;
    }

    // SET_STATUS
    if (node.type === "set_status") {
      if (!vars._conversation_id) {
        await recordStep(node, { skipped: "no_conversation" });
        current = nextNode(graph, node.id);
        continue;
      }
      const rawStatus = String(node.data?.status ?? "resolvido").toLowerCase().trim();
      const STATUS_ALIAS: Record<string, string> = {
        done: "resolvido", resolved: "resolvido", closed: "resolvido", solved: "resolvido", complete: "resolvido", completed: "resolvido", finalizado: "resolvido", finalizada: "resolvido", concluido: "resolvido", concluído: "resolvido",
        open: "aberto", opened: "aberto", reopened: "aberto", reopen: "aberto", abrir: "aberto",
        pending: "pendente", waiting: "pendente", pendente: "pendente", aguardando: "pendente",
        aberto: "aberto", resolvido: "resolvido",
      };
      const validEnum = ["aberto", "pendente", "resolvido"];
      const status = STATUS_ALIAS[rawStatus] ?? (validEnum.includes(rawStatus) ? rawStatus : "resolvido");
      const normalizedFrom = status !== rawStatus ? rawStatus : null;
      try {
        const { error } = await admin
          .from("conversations")
          .update({ status: status as any })
          .eq("id", vars._conversation_id);

        // Sincroniza cartões de pipeline abertos do contato SOMENTE se o nó estiver
        // explicitamente configurado para propagar a resolução aos cards (opt-in).
        let resolvedCards = 0;
        const resolvePipelineCards = node.data?.resolve_pipeline_cards === true;
        if (!error && status === "resolvido" && resolvePipelineCards && vars.contact_id && vars._brand_id) {
          const { data: openCards } = await admin
            .from("pipeline_contacts")
            .select("id")
            .eq("contact_id", vars.contact_id)
            .eq("brand_id", vars._brand_id)
            .eq("status", "aberto");
          const ids = (openCards ?? []).map((r: any) => r.id as string);
          if (ids.length > 0) {
            await admin.from("pipeline_contacts").update({ status: "resolvido" }).in("id", ids);
            resolvedCards = ids.length;
          }
        }
        await recordStep(node, { status, ok: !error, resolved_cards: resolvedCards, resolve_pipeline_cards: resolvePipelineCards, ...(normalizedFrom ? { normalized_from: normalizedFrom } : {}) }, error?.message ?? null);


      } catch (e) {
        await recordStep(node, { status, ...(normalizedFrom ? { normalized_from: normalizedFrom } : {}) }, String((e as Error).message));
      }
      current = nextNode(graph, node.id);
      continue;
    }

    // MOVE_TO_PIPELINE
    if (node.type === "move_to_pipeline") {
      const pipelineId = String(node.data?.pipelineId ?? "");
      const stageId = String(node.data?.stageId ?? "");
      const action = node.data?.action === "remove" ? "remove" : "move";
      const resolveCard = node.data?.resolveCard === true;
      const cardStatus = resolveCard ? "resolvido" : "aberto";
      try {
        if (!pipelineId || !vars.contact_id || (action === "move" && !stageId)) {
          await recordStep(node, { skipped: "missing_data", action });
        } else if (action === "remove") {
          const { error } = await admin
            .from("pipeline_contacts")
            .delete()
            .eq("pipeline_id", pipelineId)
            .eq("contact_id", vars.contact_id);
          await recordStep(node, { pipelineId, action: "removed" }, error?.message ?? null);
        } else {
          const { data: existing } = await admin
            .from("pipeline_contacts")
            .select("id")
            .eq("pipeline_id", pipelineId)
            .eq("contact_id", vars.contact_id)
            .maybeSingle();
          if (existing) {
            const { error } = await admin
              .from("pipeline_contacts")
              .update({ stage_id: stageId, moved_at: new Date().toISOString(), status: cardStatus })
              .eq("id", existing.id);
            await recordStep(node, { pipelineId, stageId, action: "moved", status: cardStatus }, error?.message ?? null);
          } else {
            const { error } = await admin
              .from("pipeline_contacts")
              .insert({
                pipeline_id: pipelineId,
                stage_id: stageId,
                contact_id: vars.contact_id,
                brand_id: vars._brand_id,
                status: cardStatus,
              });
            if (!error) {
              try {
                await admin.rpc("assign_pipeline_owner", {
                  p_pipeline_id: pipelineId,
                  p_contact_id: vars.contact_id,
                  p_brand_id: vars._brand_id,
                });
              } catch (e) {
                console.error("[assign_pipeline_owner]", (e as Error).message);
              }
            }
            await recordStep(node, { pipelineId, stageId, action: "inserted", status: cardStatus }, error?.message ?? null);
          }
        }
      } catch (e) {
        await recordStep(node, { pipelineId, stageId, action }, String((e as Error).message));
      }
      current = nextNode(graph, node.id);
      continue;
    }

    // ADD_TAG (internal MegaCRM tags — does not trigger other automations)
    // Supports op: "add" (default) | "remove"
    if (node.type === "add_tag") {
      const op: "add" | "remove" = node.data?.op === "remove" ? "remove" : "add";
      const rawTags: unknown[] = Array.isArray(node.data?.tags)
        ? node.data.tags
        : (node.data?.tag ? [node.data.tag] : []);
      const tags = rawTags
        .map((t) => interpolate(String(t ?? ""), vars).trim())
        .filter(Boolean);
      try {
        if (tags.length === 0 || !vars.contact_id) {
          await recordStep(node, { skipped: "missing_data", op });
        } else {
          const { data: c, error: getErr } = await admin
            .from("contacts")
            .select("metadata")
            .eq("id", vars.contact_id)
            .maybeSingle();
          if (getErr) throw getErr;
          const meta = (c?.metadata as any) ?? {};
          const currentTags: string[] = Array.isArray(meta.tags) ? meta.tags : [];
          if (op === "remove") {
            const removed = tags.filter((t) => currentTags.includes(t));
            const skipped = tags.filter((t) => !currentTags.includes(t));
            if (removed.length === 0) {
              await recordStep(node, { tags, action: "none_present", skipped, op });
            } else {
              const next = currentTags.filter((t) => !removed.includes(t));
              const { error: updErr } = await admin
                .from("contacts")
                .update({ metadata: { ...meta, tags: next } })
                .eq("id", vars.contact_id);
              await recordStep(node, { removed, skipped, action: "removed", op }, updErr?.message ?? null);
            }
          } else {
            const added: string[] = [];
            const skipped: string[] = [];
            for (const t of tags) {
              if (currentTags.includes(t) || added.includes(t)) skipped.push(t);
              else added.push(t);
            }
            if (added.length === 0) {
              await recordStep(node, { tags, action: "all_already_present", skipped, op });
            } else {
              const next = [...currentTags, ...added];
              const { error: updErr } = await admin
                .from("contacts")
                .update({ metadata: { ...meta, tags: next } })
                .eq("id", vars.contact_id);
              await recordStep(node, { added, skipped, action: "added", op }, updErr?.message ?? null);
            }
          }
        }
      } catch (e) {
        await recordStep(node, { tags, op }, String((e as Error).message));
      }
      current = nextNode(graph, node.id);
      continue;
    }

    // SET_VARIABLE — define/atualiza variável do run; se name começar com "custom.",
    // também persiste em contacts.metadata.custom.<key>.
    if (node.type === "set_variable") {
      const rawName = String(node.data?.name ?? "").trim();
      const rawValue = node.data?.value;
      const renderedValue = typeof rawValue === "string" ? interpolate(rawValue, vars) : rawValue ?? "";
      try {
        if (!rawName) {
          await recordStep(node, { skipped: "missing_name" });
        } else {
          // 1) Sempre atualiza vars do run (persistido no finalize)
          if (rawName.startsWith("custom.")) {
            const key = rawName.slice("custom.".length);
            const curCustom = (vars.custom && typeof vars.custom === "object") ? vars.custom : {};
            vars.custom = { ...curCustom, [key]: renderedValue };
          } else {
            vars[rawName] = renderedValue;
          }

          // 2) Se for custom.*, persiste no contato
          let persistedToContact = false;
          let persistError: string | null = null;
          if (rawName.startsWith("custom.") && vars.contact_id) {
            const key = rawName.slice("custom.".length);
            if (key) {
              const { data: c, error: getErr } = await admin
                .from("contacts")
                .select("metadata")
                .eq("id", vars.contact_id)
                .maybeSingle();
              if (getErr) {
                persistError = getErr.message;
              } else {
                const meta = (c?.metadata as any) ?? {};
                const cur = (meta.custom && typeof meta.custom === "object") ? meta.custom : {};
                const newMeta = { ...meta, custom: { ...cur, [key]: renderedValue } };
                const { error: updErr } = await admin
                  .from("contacts")
                  .update({ metadata: newMeta, updated_at: new Date().toISOString() })
                  .eq("id", vars.contact_id);
                if (updErr) persistError = updErr.message;
                else persistedToContact = true;
              }
            }
          }

          await recordStep(
            node,
            { name: rawName, value: renderedValue, persisted_to_contact: persistedToContact },
            persistError,
          );
        }
      } catch (e) {
        await recordStep(node, { name: rawName, value: renderedValue }, String((e as Error).message));
      }
      current = nextNode(graph, node.id);
      continue;
    }



    // ASSIGN_AI_AGENT — atribui agente de IA à conversa atual e enfileira execução
    if (node.type === "assign_ai_agent") {
      const agentId = String(node.data?.agentId ?? "");
      try {
        if (!agentId || !vars._conversation_id) {
          await recordStep(node, { skipped: "missing_data", agentId });
        } else {
          const { data: agent } = await admin
            .from("ai_agents")
            .select("id, status, response_delay_ms")
            .eq("id", agentId)
            .maybeSingle();
          if (!agent) {
            await recordStep(node, { skipped: "agent_not_found", agentId });
          } else {
            const { error: updErr } = await admin
              .from("conversations")
              .update({ ai_agent_id: agentId, assigned_to: null })
              .eq("id", vars._conversation_id);
            if (updErr) throw updErr;
            // Enfileira execução com debounce do agente (pulado se off)
            if ((agent as any).status !== "off") {
              const delayMs = (agent as any).response_delay_ms ?? 8000;
              const runAfter = new Date(Date.now() + delayMs).toISOString();
              await admin.from("ai_agent_pending_runs").upsert(
                { conversation_id: vars._conversation_id, agent_id: agentId, run_after: runAfter },
                { onConflict: "conversation_id" },
              );
            }
            await recordStep(node, { agentId, status: (agent as any).status, queued: (agent as any).status !== "off" });
          }
        }
      } catch (e) {
        await recordStep(node, { agentId }, String((e as Error).message));
      }
      current = nextNode(graph, node.id);
      continue;
    }

    // ASSIGN_USER — define o atendente humano responsável pela conversa atual (ou remove)
    if (node.type === "assign_user") {
      const userId = String(node.data?.userId ?? "").trim();
      try {
        if (!vars._conversation_id) {
          await recordStep(node, { skipped: "no_conversation", userId: userId || null });
        } else {
          // Se foi escolhido um usuário, valida acesso ao workspace
          if (userId) {
            const { data: hasAccess, error: accessErr } = await admin.rpc("has_brand_access", {
              _user_id: userId,
              _brand_id: vars._brand_id,
            });
            if (accessErr) throw accessErr;
            if (!hasAccess) {
              await recordStep(node, { skipped: "user_no_access", userId });
              current = nextNode(graph, node.id);
              continue;
            }
          }
          const target = userId || null;
          const { error: updErr } = await admin
            .from("conversations")
            .update({ assigned_to: target })
            .eq("id", vars._conversation_id);
          if (updErr) throw updErr;
          await admin.from("conversation_events").insert({
            conversation_id: vars._conversation_id,
            event_type: target ? "assigned" : "unassigned",
            actor_id: null,
            payload: {
              assigned_to: target,
              by: "automation",
              automation_id: vars._automation_id ?? null,
              run_id: runId,
            },
          });
          await recordStep(node, { userId: target, ok: true });
        }
      } catch (e) {
        await recordStep(node, { userId: userId || null }, String((e as Error).message));
      }
      current = nextNode(graph, node.id);
      continue;
    }





    if (node.type === "activecampaign") {
      const accountId = String(node.data?.accountId ?? "");
      const action = String(node.data?.action ?? "");
      const itemId = String(node.data?.itemId ?? "");
      try {
        // Resolve email
        const { data: contact } = await admin
          .from("contacts")
          .select("metadata, profile_name")
          .eq("id", vars.contact_id)
          .maybeSingle();
        const email = contact?.metadata?.email ?? null;
        if (!email) {
          await recordStep(node, { skipped: "no_email", action });
        } else if (!accountId || !action || !itemId) {
          await recordStep(node, { skipped: "missing_data", action });
        } else {
          const { data: account } = await admin
            .from("integration_accounts")
            .select("credentials")
            .eq("id", accountId)
            .eq("platform", "activecampaign")
            .maybeSingle();
          const creds = account?.credentials as any;
          const base = String(creds?.api_url ?? "").replace(/\/+$/, "");
          const apiKey = creds?.api_key;
          if (!base || !apiKey) {
            await recordStep(node, null, "Credenciais ActiveCampaign ausentes");
          } else {
            const acReq = async (method: string, path: string, body?: any) => {
              const r = await fetch(`${base}${path}`, {
                method,
                headers: { "Api-Token": apiKey, "Content-Type": "application/json", Accept: "application/json" },
                body: body ? JSON.stringify(body) : undefined,
              });
              const text = await r.text();
              let json: any = null;
              try { json = text ? JSON.parse(text) : null; } catch { /* noop */ }
              if (!r.ok) throw new Error(`AC ${method} ${path} HTTP ${r.status}: ${text.slice(0, 200)}`);
              return json;
            };

            // Sync contact (creates/updates and returns ID)
            const syncResp = await acReq("POST", "/api/3/contact/sync", {
              contact: { email, firstName: contact?.profile_name ?? undefined },
            });
            const acContactId = syncResp?.contact?.id;
            if (!acContactId) {
              await recordStep(node, null, "AC sync: contact.id ausente");
            } else if (action === "add_tag") {
              const r = await acReq("POST", "/api/3/contactTags", {
                contactTag: { contact: acContactId, tag: itemId },
              });
              await recordStep(node, { action, tag: itemId, ok: true, ac_contact_id: acContactId, resp: r });
            } else if (action === "add_to_list") {
              const r = await acReq("POST", "/api/3/contactLists", {
                contactList: { contact: acContactId, list: itemId, status: 1 },
              });
              await recordStep(node, { action, list: itemId, ok: true, ac_contact_id: acContactId, resp: r });
            } else if (action === "update_field") {
              const value = interpolate(String(node.data?.value ?? ""), vars);
              const r = await acReq("POST", "/api/3/fieldValues", {
                fieldValue: { contact: acContactId, field: itemId, value },
              });
              await recordStep(node, { action, field: itemId, value, ok: true, ac_contact_id: acContactId, resp: r });
            } else {
              await recordStep(node, { skipped: "unknown_action", action });
            }
          }
        }
      } catch (e) {
        await recordStep(node, { action }, String((e as Error).message));
      }
      current = nextNode(graph, node.id);
      continue;
    }

    if (node.type === "randomizer") {
      const paths = (Array.isArray((node as any).data?.paths) ? (node as any).data.paths : []) as { label?: string; weight?: number }[];
      const safe = paths.length >= 2 ? paths : [{ label: "A", weight: 1 }, { label: "B", weight: 1 }];
      const total = safe.reduce((s, p) => s + Math.max(0, Number(p.weight) || 0), 0);
      let idx = 0;
      if (total > 0) {
        let r = Math.random() * total;
        for (let i = 0; i < safe.length; i++) {
          r -= Math.max(0, Number(safe[i].weight) || 0);
          if (r <= 0) { idx = i; break; }
        }
      } else {
        idx = Math.floor(Math.random() * safe.length);
      }
      await recordStep(node, { chosen_index: idx, chosen_label: safe[idx]?.label ?? null });
      current = nextNode(graph, node.id, `out:${idx}`);
      continue;
    }

    // SEND_TO_BLOCKLIST
    if (node.type === "send_to_blocklist") {
      const channels: string[] = Array.isArray(node.data?.channels) ? node.data.channels : ["phone", "email"];
      const reason = node.data?.reason ? String(node.data.reason).trim() : null;
      try {
        const rows: any[] = [];
        if (channels.includes("phone") && vars.contact_phone) {
          rows.push({ brand_id: vars._brand_id, kind: "phone", value: String(vars.contact_phone), reason });
        }
        if (channels.includes("email") && vars.contact_email) {
          rows.push({ brand_id: vars._brand_id, kind: "email", value: String(vars.contact_email).toLowerCase(), reason });
        }
        if (rows.length === 0) {
          await recordStep(node, { skipped: "no_values" });
        } else {
          let added = 0;
          for (const r of rows) {
            const { error } = await admin.from("contact_blocklist").insert(r);
            if (!error) added++;
            else if ((error as any).code !== "23505") throw error;
          }
          await recordStep(node, { added, attempted: rows.length, channels });
        }
      } catch (e) {
        await recordStep(node, { channels }, String((e as Error).message));
      }
      current = nextNode(graph, node.id);
      continue;
    }

    // Trigger or unknown -> just advance
    current = nextNode(graph, node.id);
  }

  // Se o walk inline do ramo `next` terminou naturalmente (sem encontrar
  // nó bloqueante), pausa no nó de mensagem para aguardar o clique do botão
  // em vez de finalizar o run.
  if (pendingPauseAtMessageId) {
    await pauseAtMessageForButtons(pendingPauseAtMessageId, "side_branch_completed");
    pendingPauseAtMessageId = null;
    return;
  }

  // Finalize em 1 round-trip (sem SELECT) — usa estado em memória.
  await admin.from("automation_runs").update({
    status: runFailed ? "failed" : "completed",
    finished_at: new Date().toISOString(),
    last_error: runFailed ? runLastError : null,
    variables: vars,
  }).eq("id", runId);
  finalized = true;

  } catch (e) {
    runFailed = true;
    runLastError = String((e as Error).message);
    console.error("[executeFlow] uncaught", runId, runLastError);
    throw e;
  } finally {
    // Se nenhum return de pausa rolou e o finalize natural não chegou
    // (ex.: exceção escapou), marca o run como failed pra não ficar órfão.
    if (!finalized && !pausedThisInvocation) {
      try {
        await admin.from("automation_runs").update({
          status: "failed",
          finished_at: new Date().toISOString(),
          last_error: runLastError ?? "executeFlow aborted",
          variables: vars,
        }).eq("id", runId);
      } catch (e2) {
        console.error("[executeFlow] failed to mark run as failed", runId, (e2 as Error).message);
      }
    }
  }
}

Deno.serve(async (req) => {
  const pf = handlePreflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  let body: Body;
  try { body = await req.json(); } catch { return jsonResponse({ error: "JSON inválido" }, 400); }

  const admin = getAdminClient();

  // ===== TICK: resume sleeping runs whose timer elapsed =====
  if (body.event === "tick") {
    const { data: due } = await admin
      .from("automation_scheduled_steps")
      .select("id, run_id")
      .lte("resume_at", new Date().toISOString())
      .limit(50);
    let resumed = 0;
    for (const s of due ?? []) {
      const { data: run } = await admin
        .from("automation_runs")
        .select("id, current_node_id, conversation_id, variables, automation:automation_id(graph)")
        .eq("id", s.run_id)
        .maybeSingle();
      await admin.from("automation_scheduled_steps").delete().eq("id", s.id);
      if (!run || run.status === "completed" as any) continue;
      const graph = (run as any).automation?.graph as Graph;
      if (!graph) continue;
      const waitNode = graph.nodes.find((n) => n.id === run.current_node_id);
      if (!waitNode) continue;
      const next = waitNode.type === "question"
        ? nextNode(graph, waitNode.id, "timeout") ?? nextNode(graph, waitNode.id)
        : nextNode(graph, waitNode.id);
      let baseVarsForResume: Record<string, any>;
      if (run.conversation_id) {
        const conv = await loadConvContext(admin, run.conversation_id);
        if (!conv) continue;
        baseVarsForResume = buildBaseVars(conv);
      } else {
        baseVarsForResume = {};
      }
      const vars = { ...(run.variables as any), ...baseVarsForResume };
      await admin.from("automation_runs").update({ status: "running" }).eq("id", run.id);
      if (next) await executeFlow(admin, run.id, graph, next, vars);
      else await finalizeRun(admin, run.id);
      resumed++;
    }
    return jsonResponse({ ok: true, resumed });
  }

  // ===== TAG_ADDED: start matching automations =====
  if (body.event === "tag_added") {
    if (!body.contact_id || !body.tag) return jsonResponse({ error: "contact_id e tag obrigatórios" }, 400);

    // Find conversation for this contact (most recent). If none, fall back
    // to contact-only context so automations that don't need a channel
    // (move_to_pipeline, add_tag, webhook, ...) can still run.
    const { data: conv } = await admin
      .from("conversations")
      .select("id, brand_id, channel_id, contact_id, window_expires_at, channel:channel_id(phone_number_id), contacts:contact_id(wa_id, profile_name, name, phone, metadata)")
      .eq("contact_id", body.contact_id)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    let brandId: string;
    let baseVars: Record<string, any>;
    let runConversationId: string | null;
    let runContactId: string;

    if (conv) {
      brandId = conv.brand_id;
      baseVars = buildBaseVars(conv, { trigger_tag: body.tag });
      runConversationId = conv.id;
      runContactId = conv.contact_id;
    } else {
      const contact = await loadContactContext(admin, body.contact_id);
      if (!contact) return jsonResponse({ ok: true, started: 0, reason: "no_contact" });
      brandId = contact.brand_id;
      baseVars = buildBaseVarsFromContact(contact, { trigger_tag: body.tag });
      runConversationId = null;
      runContactId = contact.id;
    }

    const { data: autos } = await admin
      .from("automations")
      .select("id, graph, brand_id, trigger_type")
      .eq("trigger_tag", body.tag)
      .eq("brand_id", brandId)
      .eq("status", "active")
      .or("trigger_type.eq.tag,trigger_type.is.null");
    if (!autos?.length) return jsonResponse({ ok: true, started: 0 });

    let started = 0;
    for (const a of autos) {
      const graph = a.graph as Graph;
      const trigger = graph.nodes.find((n) => n.type === "trigger");
      if (!trigger) continue;
      const next = nextNode(graph, trigger.id);
      const { data: run } = await admin
        .from("automation_runs")
        .insert({
          automation_id: a.id, conversation_id: runConversationId, contact_id: runContactId,
          brand_id: brandId, current_node_id: trigger.id, status: "running", variables: baseVars,
        })
        .select("id").single();
      if (!run) continue;
      await supersedeOldRuns(admin, { brandId, contactId: runContactId, conversationId: runConversationId, exceptRunId: run.id });
      await runStep(admin, run.id, trigger, { tag: body.tag });

      if (next) await executeFlow(admin, run.id, graph, next, baseVars);
      started++;
    }
    return jsonResponse({ ok: true, started });
  }

  // ===== INBOUND: resume waiting (inbound) runs =====
  if (body.event === "inbound") {
    if (!body.conversation_id) return jsonResponse({ error: "conversation_id obrigatório" }, 400);
    const conv = await loadConvContext(admin, body.conversation_id);
    if (!conv) return jsonResponse({ ok: true, resumed: 0 });
    const baseVars = buildBaseVars(conv, { last_message: body.message?.content ?? "" });

    const { data: runs } = await admin
      .from("automation_runs")
      .select("id, current_node_id, variables, status, automation:automation_id(graph)")
      .eq("conversation_id", conv.id)
      .eq("status", "waiting");
    // Defesa em profundidade: `waiting_button` é EXCLUSIVO do handler `button_click`.
    // Inbound jamais retoma um run pausado em botão, independente do tipo de nó.
    if (!runs?.length) return jsonResponse({ ok: true, resumed: 0 });
    let resumed = 0;
    for (const r of runs) {
      const graph = (r as any).automation?.graph as Graph;
      if (!graph) continue;
      const waitNode = graph.nodes.find((n) => n.id === r.current_node_id);
      if (!waitNode) continue;
      // (removido) guarda waiting_button — agora a query já filtra status=waiting.
      let next: FlowNode | null;
      if (waitNode.type === "question") {
        // Cancel pending timeout
        await admin.from("automation_scheduled_steps").delete().eq("run_id", r.id);
        next = nextNode(graph, waitNode.id, "answered") ?? nextNode(graph, waitNode.id);
      } else {
        next = nextNode(graph, waitNode.id);
      }
      const extras: Record<string, any> = {};
      const saveAs = (waitNode.data as any)?.saveAs;
      if (waitNode.type === "question" && typeof saveAs === "string" && saveAs.trim()) {
        extras[saveAs.trim()] = body.message?.content ?? "";
      }
      const saveToField = (waitNode.data as any)?.saveToField;
      if (waitNode.type === "question" && typeof saveToField === "string" && saveToField.trim() && conv.contact_id) {
        const answer = body.message?.content ?? "";
        const { data: cur } = await admin.from("contacts").select("metadata").eq("id", conv.contact_id).maybeSingle();
        const meta = (cur?.metadata as Record<string, any>) ?? {};
        await admin.from("contacts").update({ metadata: { ...meta, [saveToField.trim()]: answer } }).eq("id", conv.contact_id);
      }

      const vars = { ...(r.variables as any), ...baseVars, ...extras };
      await admin.from("automation_runs").update({ status: "running" }).eq("id", r.id);
      if (next) await executeFlow(admin, r.id, graph, next, vars);
      else await finalizeRun(admin, r.id);
      resumed++;
    }
    return jsonResponse({ ok: true, resumed });
  }

  // ===== BUTTON_CLICK: resume waiting_button runs by chosen button =====
  if (body.event === "button_click") {
    if (!body.conversation_id) return jsonResponse({ error: "conversation_id obrigatório" }, 400);
    const conv = await loadConvContext(admin, body.conversation_id);
    if (!conv) return jsonResponse({ ok: true, resumed: 0 });
    const baseVars = buildBaseVars(conv, {
      button_payload: body.button?.payload ?? "",
      button_text: body.button?.text ?? "",
      last_message: body.button?.text ?? "",
    });

    // Opção A: se o webhook trouxe context.id (wa_message_id da mensagem original),
    // identificamos EXATAMENTE qual run enviou aquela mensagem e retomamos apenas ele.
    // Isso evita que runs antigos de outras automações na mesma conversa sejam reativados
    // quando o contato clica em um botão de uma campanha nova.
    const contextId: string | null = (body.button as any)?.context_id ?? null;
    let targetRunId: string | null = null;
    if (contextId) {
      const { data: nodeMsg } = await admin
        .from("automation_node_messages")
        .select("run_id")
        .eq("wa_message_id", contextId)
        .maybeSingle();
      if (nodeMsg?.run_id) targetRunId = nodeMsg.run_id as string;
    }

    // Quando temos targetRunId (resolvido via wa_message_id em automation_node_messages),
    // a correspondência é exata e dispensa o filtro por conversation_id — runs criados
    // pelo broadcast podem ter a coluna conversation_id nula (o id real fica em
    // variables._conversation_id).
    //
    // IMPORTANTE: Se o webhook trouxe contextId mas NÃO conseguimos resolver via
    // automation_node_messages, o clique pertence a uma mensagem que NÃO foi enviada
    // por nenhum run nosso (ex.: template HSM disparado por outra automação que não
    // registra em automation_node_messages, ou template manual). Nesse caso NÃO
    // devemos cair no fallback de "qualquer waiting_button da conversa" porque isso
    // causa colisão entre fluxos diferentes que reusam o mesmo label de botão.
    // O fallback amplo só é seguro quando NÃO temos contextId (payloads antigos).
    // CAMADA 1 — regra absoluta: se o clique tem contextId mas não achamos
    // lock em automation_node_messages, IGNORAMOS o clique para o motor de
    // automação. Removido o fallback por template (encontrar "1 candidato
    // waiting_button na conversa") que causava o caso Lindalva: clique num
    // template enviado fora do motor (pipeline/inbox/atividade) destravava
    // uma run antiga órfã de outra automação na mesma conversa.
    //
    // Comportamento correto agora:
    //  - Lock encontrado → retoma exatamente aquela run (mesmo se antiga).
    //  - Lock não encontrado → context_not_owned. Sem resposta é melhor
    //    que resposta errada. A mensagem original continua no inbox.
    if (contextId && !targetRunId) {
      console.log(`[automation-engine] button_click_ignored: context_not_owned contextId=${contextId} conv=${conv.id}`);
      return jsonResponse({ ok: true, resumed: 0, reason: "context_not_owned" });
    }


    // CHAVE + FECHADURA OBRIGATÓRIA: sem contextId resolvido para um run específico,
    // NÃO retomamos nada. O fallback antigo (qualquer waiting_button da conversa,
    // casado por label do botão) foi removido — era exatamente o que permitia que
    // um clique no botão "NÃO VOU APROVEITAR AGORA" do template do boleto retomasse
    // um run da Festa Junina parado na conversa. Labels iguais entre fluxos
    // diferentes são legítimos; o que desambigua é o wa_message_id da mensagem
    // original (context.id da Meta) → automation_node_messages.run_id.
    if (!targetRunId) {
      console.log(`[automation-engine] button_click ignorado: sem contextId no payload (Meta não enviou context). Sem chave, não abre fechadura.`);
      return jsonResponse({ ok: true, resumed: 0, reason: "no_context" });
    }
    const runsQuery = admin
      .from("automation_runs")
      .select("id, automation_id, started_at, current_node_id, variables, conversation_id, automation:automation_id(graph)")
      .eq("status", "waiting_button")
      .eq("id", targetRunId)
      .order("started_at", { ascending: false });
    const { data: allRuns } = await runsQuery;
    if (!allRuns?.length) return jsonResponse({ ok: true, resumed: 0, reason: "run_not_waiting" });


    // Backfill conversation_id em runs que vieram do fallback path do broadcast.
    for (const r of allRuns) {
      if (!(r as any).conversation_id) {
        await admin.from("automation_runs").update({ conversation_id: conv.id }).eq("id", (r as any).id);
        (r as any).conversation_id = conv.id;
      }
    }

    // Deduplicate: if multiple runs of the same automation are waiting on a button
    // (e.g. broadcast disparado mais de uma vez), keep only the most recent one and
    // cancel the older duplicates so the contact doesn't receive duplicate follow-ups.
    const seen = new Set<string>();
    const runs: typeof allRuns = [];
    const superseded: typeof allRuns = [];
    for (const r of allRuns) {
      const key = String((r as any).automation_id ?? "");
      if (seen.has(key)) superseded.push(r);
      else { seen.add(key); runs.push(r); }
    }
    for (const r of superseded) {
      await admin.from("automation_scheduled_steps").delete().eq("run_id", r.id);
      await admin.from("automation_runs").update({
        status: "cancelled",
        finished_at: new Date().toISOString(),
        last_error: "superseded_by_newer_run",
      }).eq("id", r.id);
    }

    let resumed = 0;
    const isTextQuote = (body.button as any)?.source === "text_quote";
    for (const r of runs) {
      const graph = (r as any).automation?.graph as Graph;
      if (!graph) continue;
      const msgNode = graph.nodes.find((n) => n.id === r.current_node_id);
      if (!msgNode) continue;
      const buttons: any[] = (msgNode.data?.buttons as any[]) ?? [];
      // Prefer match by payload id (btn:<index>), then by visible title
      const payloadIdx = (() => {
        const p = body.button?.payload ?? "";
        const m = /^btn:(\d+)$/.exec(p);
        if (!m) return -1;
        const targetIndex = Number(m[1]);
        return buttons.findIndex((b) => Number(b.index) === targetIndex);
      })();
      let idx = payloadIdx;
      if (idx < 0) {
        const txt = (body.button?.text ?? "").trim();
        const pay = (body.button?.payload ?? "").trim();
        idx = buttons.findIndex((b) => {
          const bt = String(b.text ?? "").trim();
          return (txt && bt === txt) || (pay && bt === pay);
        });
      }
      // Fallback para idx=0 só quando a origem é um clique de botão real
      // (button/interactive). Em text_quote (fallback de texto citando o template),
      // se não bateu com nenhum botão, NÃO retomamos — texto livre não deve
      // ser interpretado como "Confirmar" automaticamente.
      if (idx < 0 && buttons.length && !isTextQuote) idx = 0;
      if (idx < 0) continue;
      const handle = `btn:${buttons[idx].index}`;
      const next = nextNode(graph, msgNode.id, handle);
      // For question nodes, cancel pending timeout step
      if (msgNode.type === "question") {
        await admin.from("automation_scheduled_steps").delete().eq("run_id", r.id);
      }
      // Apply saveAs / saveToField for question nodes (treat button title as the answer)
      const extras: Record<string, any> = {};
      const answer = body.button?.text ?? "";
      const saveAs = (msgNode.data as any)?.saveAs;
      if (msgNode.type === "question" && typeof saveAs === "string" && saveAs.trim()) {
        extras[saveAs.trim()] = answer;
      }
      const saveToField = (msgNode.data as any)?.saveToField;
      if (msgNode.type === "question" && typeof saveToField === "string" && saveToField.trim() && conv.contact_id) {
        const { data: cur } = await admin.from("contacts").select("metadata").eq("id", conv.contact_id).maybeSingle();
        const meta = (cur?.metadata as Record<string, any>) ?? {};
        await admin.from("contacts").update({ metadata: { ...meta, [saveToField.trim()]: answer } }).eq("id", conv.contact_id);
      }
      const vars = { ...(r.variables as any), ...baseVars, ...extras };
      await admin.from("automation_runs").update({ status: "running" }).eq("id", r.id);
      if (next) await executeFlow(admin, r.id, graph, next, vars);
      else await finalizeRun(admin, r.id);
      resumed++;
    }
    return jsonResponse({ ok: true, resumed });
  }

  // ===== MANUAL_TRIGGER: start a specific automation by id =====
  if (body.event === "manual_trigger") {
    if (!body.automation_id || !body.contact_id || !body.conversation_id) {
      return jsonResponse({ error: "automation_id, contact_id e conversation_id obrigatórios" }, 400);
    }
    const { data: automation } = await admin
      .from("automations")
      .select("id, graph, brand_id, status")
      .eq("id", body.automation_id)
      .maybeSingle();
    if (!automation) return jsonResponse({ error: "automation not found" }, 404);
    if (automation.status !== "active") return jsonResponse({ error: "automation not active" }, 400);

    const conv = await loadConvContext(admin, body.conversation_id);
    if (!conv || conv.brand_id !== automation.brand_id) return jsonResponse({ error: "invalid conversation" }, 400);

    const graph = automation.graph as Graph;
    const trigger = graph.nodes.find((n) => n.type === "trigger");
    if (!trigger) return jsonResponse({ error: "no trigger node" }, 400);

    const baseVars = buildBaseVars(conv, { ...(body.variables ?? {}), trigger_source: "manual" });
    const next = nextNode(graph, trigger.id);
    const { data: run } = await admin
      .from("automation_runs")
      .insert({
        automation_id: automation.id,
        conversation_id: conv.id,
        contact_id: conv.contact_id,
        brand_id: conv.brand_id,
        current_node_id: trigger.id,
        status: "running",
        variables: baseVars,
      })
      .select("id").single();
    if (!run) return jsonResponse({ error: "could not create run" }, 500);
    await supersedeOldRuns(admin, { brandId: conv.brand_id, contactId: conv.contact_id, conversationId: conv.id, exceptRunId: run.id });



    // Modo assíncrono: responde imediatamente e executa o fluxo em background.
    // Usado por broadcasts para que cada tick não fique preso esperando o envio inteiro.
    if (body.async) {
      const runId = run.id;
      const work = (async () => {
        try {
          await runStep(admin, runId, trigger, { manual: true });
          if (next) await executeFlow(admin, runId, graph, next, baseVars);
        } catch (e) {
          try {
            await admin.from("automation_runs")
              .update({ status: "failed", last_error: String((e as any)?.message ?? e).slice(0, 500), finished_at: new Date().toISOString() })
              .eq("id", runId);
          } catch {}
        }
      })();
      // @ts-ignore EdgeRuntime exists no runtime de Edge Functions do Supabase
      if (typeof EdgeRuntime !== "undefined" && (EdgeRuntime as any).waitUntil) {
        // @ts-ignore
        (EdgeRuntime as any).waitUntil(work);
      }
      return jsonResponse({ ok: true, run_id: runId, async: true });
    }

    await runStep(admin, run.id, trigger, { manual: true });
    if (next) await executeFlow(admin, run.id, graph, next, baseVars);
    return jsonResponse({ ok: true, run_id: run.id });
  }

  // ===== BROADCAST_SEND: fast-path enxuto de disparo de broadcast ============
  // Em vez de percorrer o motor completo (executeFlow do trigger), enviamos o
  // template HSM direto, criamos o run já em waiting_button no nó da variante
  // sorteada (ou no nó único) e rodamos só a "cauda barata" (add_tag,
  // set_status, etc.) reusando executeFlow com opts.pauseAtMessageId.
  //
  // Quando o grafo não casa o formato (computeFastPathPlan == null), caímos
  // INTERNAMENTE (chamada de função, sem fetch novo) para o caminho normal.
  if (body.event === "broadcast_send") {
    if (!body.automation_id || !body.contact_id) {
      return jsonResponse({ error: "automation_id e contact_id obrigatórios" }, 400);
    }
    const automation = await getAutomationCached(admin, body.automation_id);
    if (!automation) return jsonResponse({ error: "automation not found" }, 404);
    if (automation.status !== "active") return jsonResponse({ error: "automation not active" }, 400);

    const graph = automation.graph as Graph;
    const trigger = graph.nodes.find((n) => n.type === "trigger");
    if (!trigger) return jsonResponse({ error: "no trigger node" }, 400);

    const plan = computeFastPathPlan(graph);

    // Carrega contexto do contato (sempre necessário — para envio e variáveis).
    const contact = await loadContactContext(admin, body.contact_id);
    if (!contact) return jsonResponse({ error: "contact not found" }, 404);
    if (contact.brand_id !== automation.brand_id) {
      return jsonResponse({ error: "contact/automation brand mismatch" }, 400);
    }

    // Variáveis-base: prioriza conversa atual se já vier no payload, senão
    // monta a partir do contato (tal qual tag_added quando não há conv).
    let baseVars: Record<string, any>;
    let runConversationId: string | null = null;
    if (body.conversation_id) {
      const conv = await loadConvContext(admin, body.conversation_id);
      if (!conv) return jsonResponse({ error: "conversation not found" }, 404);
      if (conv.brand_id !== automation.brand_id) return jsonResponse({ error: "invalid conversation" }, 400);
      baseVars = buildBaseVars(conv, { ...(body.variables ?? {}), trigger_source: "broadcast" });
      runConversationId = conv.id;
    } else {
      baseVars = buildBaseVarsFromContact(contact, { ...(body.variables ?? {}), trigger_source: "broadcast" });
    }
    baseVars._automation_id = automation.id;

    // Fallback INTERNO (sem fetch novo) quando o grafo não é fast-path-able.
    const runManualPath = async (): Promise<Response> => {
      const next = nextNode(graph, trigger.id);
      const { data: run } = await admin
        .from("automation_runs")
        .insert({
          automation_id: automation.id,
          conversation_id: runConversationId,
          contact_id: contact.id,
          brand_id: automation.brand_id,
          current_node_id: trigger.id,
          status: "running",
          variables: baseVars,
        })
        .select("id").single();
      if (!run) return jsonResponse({ error: "could not create run" }, 500);
      await supersedeOldRuns(admin, { brandId: automation.brand_id, contactId: contact.id, conversationId: runConversationId, exceptRunId: run.id });



      if (body.async) {
        const runId = run.id;
        const work = (async () => {
          try {
            await runStep(admin, runId, trigger, { broadcast: true, fast_path: "fallback" });
            if (next) await executeFlow(admin, runId, graph, next, baseVars);
            // Sincroniza conversation_id se o caminho percorrido o resolveu.
            try {
              const { data: cur } = await admin
                .from("automation_runs")
                .select("conversation_id, variables")
                .eq("id", runId)
                .maybeSingle();
              const resolvedConvId = (cur?.variables as any)?._conversation_id ?? null;
              if (cur && !cur.conversation_id && typeof resolvedConvId === "string" && resolvedConvId) {
                await admin.from("automation_runs").update({ conversation_id: resolvedConvId }).eq("id", runId);
              }
            } catch {}
          } catch (e) {
            try {
              await admin.from("automation_runs")
                .update({ status: "failed", last_error: String((e as any)?.message ?? e).slice(0, 500), finished_at: new Date().toISOString() })
                .eq("id", runId);
            } catch {}
          }
        })();
        // @ts-ignore EdgeRuntime existe no Supabase Edge Functions
        if (typeof EdgeRuntime !== "undefined" && (EdgeRuntime as any).waitUntil) {
          // @ts-ignore
          (EdgeRuntime as any).waitUntil(work);
        }
        return jsonResponse({ ok: true, run_id: runId, async: true, fast_path: false });
      }

      await runStep(admin, run.id, trigger, { broadcast: true, fast_path: "fallback" });
      if (next) await executeFlow(admin, run.id, graph, next, baseVars);
      // Após executeFlow, sincroniza a coluna conversation_id se o caminho percorrido
      // resolveu uma conversa (e gravou em variables._conversation_id). Sem isso, o
      // handler de button_click não consegue localizar a run pelo conversation_id.
      try {
        const { data: cur } = await admin
          .from("automation_runs")
          .select("conversation_id, variables")
          .eq("id", run.id)
          .maybeSingle();
        const resolvedConvId = (cur?.variables as any)?._conversation_id ?? null;
        if (cur && !cur.conversation_id && typeof resolvedConvId === "string" && resolvedConvId) {
          await admin.from("automation_runs").update({ conversation_id: resolvedConvId }).eq("id", run.id);
        }
      } catch {}
      return jsonResponse({ ok: true, run_id: run.id, fast_path: false });
    };

    if (!plan) return await runManualPath();

    // ----- Plano elegível: roda o fast-path real -----
    // 1) Sorteia variante (SEM query — fica no caminho síncrono).
    let variantNode: FlowNode;
    let randomizerChoice: { index: number; label: string | null } | null = null;
    if (plan.kind === "single") {
      variantNode = plan.messageNode;
    } else {
      randomizerChoice = pickRandomizerBranch(plan.randomizerNode);
      const variant = plan.variants.find((v) => v.index === randomizerChoice!.index)
        ?? plan.variants[0];
      variantNode = variant.messageNode;
    }

    // 2) Cria o run JÁ (conversa pode estar null; bg preenche depois de resolver).
    //    current_node_id = nó da variante; status running até o bg pausar em waiting_button.
    const { data: run } = await admin
      .from("automation_runs")
      .insert({
        automation_id: automation.id,
        conversation_id: runConversationId,
        contact_id: contact.id,
        brand_id: automation.brand_id,
        current_node_id: variantNode.id,
        status: "running",
        variables: baseVars,
      })
      .select("id").single();
    if (!run) return jsonResponse({ error: "could not create run" }, 500);
    const runId = run.id;
    await supersedeOldRuns(admin, { brandId: automation.brand_id, contactId: contact.id, conversationId: runConversationId, exceptRunId: runId });


    // Helper local: marca run como failed quando algo cair no background.
    const failRun = async (rid: string, vars: any, msg: string) => {
      try {
        await admin.from("automation_runs").update({
          status: "failed",
          finished_at: new Date().toISOString(),
          last_error: String(msg).slice(0, 500),
          variables: vars,
        }).eq("id", rid);
      } catch {}
    };

    // 3) TODO o resto vai pro background — incluindo resolveTemplateChannel (SELECT+INSERT).
    const doFastPath = async () => {
      try {
        // Resolve template+canal+conv AQUI (saiu do caminho síncrono).
        const tpl = await getTemplateCached(admin, variantNode.data.templateId);
        if (!tpl) { await failRun(runId, baseVars, "Template não encontrado"); return; }
        const currentConv = runConversationId
          ? { id: runConversationId, channel_id: baseVars._channel_id ?? null, window_expires_at: baseVars._window_expires_at ?? null }
          : null;
        const resolved = await resolveTemplateChannel(admin, {
          brandId: automation.brand_id,
          contactId: contact.id,
          templateName: tpl.name,
          templateLanguage: tpl.language,
          nodeData: variantNode.data,
          currentConv,
        });
        if (!resolved.ok) { await failRun(runId, baseVars, resolved.reason ?? "Falha ao resolver canal"); return; }

        // Propaga conv/canal escolhidos para vars (igual ao motor).
        baseVars._conversation_id = resolved.conversationId;
        baseVars._channel_id = resolved.channelId;
        baseVars._phone_number_id = resolved.phoneNumberId;
        baseVars._window_expires_at = resolved.windowExpiresAt;
        baseVars.conversation_id = resolved.conversationId;
        if (!baseVars._to) baseVars._to = resolveOutboundTo(contact, (contact as any)._bsuid_mode ?? "off");
        if (!baseVars._to) { await failRun(runId, baseVars, "Contato sem wa_id"); return; }

        // Atualiza a conversa do run (foi criado com runConversationId que pode ser null).
        await admin.from("automation_runs")
          .update({ conversation_id: resolved.conversationId, variables: baseVars })
          .eq("id", runId);

        // run_steps: trigger + (randomizer) — obrigatórios para reconciliação/RunFlowViewerDialog.
        await runStep(admin, runId, trigger, { broadcast: true, fast_path: plan.kind });
        if (plan.kind === "randomizer" && randomizerChoice) {
          await runStep(admin, runId, plan.randomizerNode, {
            chosen_index: randomizerChoice.index,
            chosen_label: randomizerChoice.label,
            fast_path: true,
          });
        }

        // Deriva header/mídia/variáveis do template (mesma lógica do motor).
        const overrideUrl = variantNode.data?.templateHeaderMediaUrl ?? null;
        const overrideFilename = variantNode.data?.templateHeaderMediaFilename ?? null;
        const explicitHt = (tpl.header_type ?? "").toString().toUpperCase();
        const compsArr: any[] = Array.isArray((tpl as any).components) ? (tpl as any).components : [];
        const headerComp = compsArr.find((c: any) => c?.type === "HEADER");
        const fmtHt = (headerComp?.format ?? "").toString().toUpperCase();
        const resolvedHt = (explicitHt === "IMAGE" || explicitHt === "VIDEO" || explicitHt === "DOCUMENT" || explicitHt === "TEXT")
          ? explicitHt
          : (fmtHt === "IMAGE" || fmtHt === "VIDEO" || fmtHt === "DOCUMENT" || fmtHt === "TEXT") ? fmtHt : "";
        const headerType = (resolvedHt === "IMAGE" || resolvedHt === "VIDEO" || resolvedHt === "DOCUMENT")
          ? resolvedHt as "IMAGE" | "VIDEO" | "DOCUMENT"
          : null;
        const headerMediaLink = headerType ? overrideUrl : null;
        const headerMediaFilename = headerType === "DOCUMENT" ? overrideFilename : null;
        const rawVars: unknown[] = Array.isArray(variantNode.data?.templateVariables) ? variantNode.data.templateVariables : [];
        const interpolatedVars = clampTemplateVars(
          rawVars.map((v) => interpolate(String(v ?? ""), baseVars)),
          countTemplateBodyParams(compsArr),
        );

        const token = await getChannelTokenCached(resolved.channelId);
        const sendStartedAt = Date.now();
        const headerMediaHandle = headerType && headerMediaLink
          ? await resolveTemplateHeaderMediaId({
              admin, brandId: automation.brand_id, phoneNumberId: resolved.phoneNumberId,
              token, sourceUrl: headerMediaLink, filename: headerMediaFilename,
              headerType,
            })
          : null;
        const r = await sendTemplate({
          token,
          phoneNumberId: resolved.phoneNumberId,
          to: baseVars._to,
          templateName: tpl.name,
          language: tpl.language,
          variables: interpolatedVars,
          headerType,
          headerMediaLink,
          headerMediaHandle,
          headerMediaFilename,
          blocklistGuard: { admin, brandId: automation.brand_id, phone: baseVars.contact_phone, email: baseVars.contact_email },
        });
        let insertedMessageId: string | null = null;
        if (r.ok) {
          const { data: ins } = await admin.from("messages").insert({
            conversation_id: resolved.conversationId,
            brand_id: automation.brand_id,
            channel_id: resolved.channelId,
            direction: "outbound",
            type: "template",
            content: tpl.name,
            template_name: tpl.name,
            template_language: tpl.language,
            template_variables: interpolatedVars,
            media_url: headerMediaLink ?? null,
            media_filename: headerMediaFilename ?? null,
            wa_message_id: r.data?.messages?.[0]?.id ?? null,
            status: "sent",
          }).select("id").maybeSingle();
          insertedMessageId = (ins as any)?.id ?? null;
        }
        await logWhatsAppSend({
          brandId: automation.brand_id, source: "automation", type: "template",
          to: baseVars._to, templateName: tpl.name, templateLanguage: tpl.language,
          variables: interpolatedVars, mediaUrl: headerMediaLink ?? null,
          status: r.ok ? "sent" : "failed",
          waMessageId: r.data?.messages?.[0]?.id ?? null,
          errorCode: r.ok ? null : String(r.error?.code ?? "META_ERR"),
          errorMessage: r.ok ? null : (r.error?.message ?? null),
          messageId: insertedMessageId,
          durationMs: Date.now() - sendStartedAt,
          statusCode: r.ok ? 200 : 400,
        });
        await logNodeMessage({
          brandId: automation.brand_id, automationId: automation.id, runId,
          nodeId: variantNode.id, nodeType: variantNode.type,
          contactId: baseVars.contact_id, conversationId: resolved.conversationId,
          channelId: resolved.channelId,
          waMessageId: r.data?.messages?.[0]?.id ?? null,
          templateName: tpl.name, ok: r.ok,
          errorCode: r.ok ? null : String(r.error?.code ?? "META_ERR"),
          errorMessage: r.ok ? null : (r.error?.message ?? null),
        });
        await runStep(
          admin,
          runId,
          variantNode,
          { mode: "template", template: tpl.name, channel_id: resolved.channelId, sent: r.ok, error: r.error, errorCode: r.ok ? null : (r.error?.code ?? null), fast_path: true },
          r.ok ? null : (r.error?.message ?? "Falha no envio do template"),
        );

        if (!r.ok) {
          // Sem envio = sem clique futuro. Finaliza o run como failed.
          await admin.from("automation_runs").update({
            status: "failed",
            finished_at: new Date().toISOString(),
            last_error: (r.error?.message ?? "Falha no envio do template").slice(0, 500),
            variables: baseVars,
          }).eq("id", runId);
          return;
        }

        // Cauda barata: executeFlow a partir da aresta default da variante,
        // com pauseAtMessageId pré-semeado. Reusa 100% dos handlers de
        // side-effect (add_tag, set_status, ...) do motor, incluindo a
        // parada em SIDE_BRANCH_BLOCKING_TYPES — fonte única.
        const tailStart = nextNode(graph, variantNode.id);
        if (tailStart) {
          await executeFlow(admin, runId, graph, tailStart, baseVars, {
            pauseAtMessageId: variantNode.id,
          });
        } else {
          // Sem aresta `next`: variante só tem botões. Pausa direto.
          if (await assertButtonLock(admin, runId, variantNode.id, baseVars)) {
            await admin.from("automation_runs")
              .update({ current_node_id: variantNode.id, status: "waiting_button", variables: baseVars })
              .eq("id", runId);
          }
        }

      } catch (e) {
        await failRun(runId, baseVars, String((e as any)?.message ?? e));
      }
    };

    if (body.async) {
      // @ts-ignore EdgeRuntime existe no Supabase Edge Functions
      if (typeof EdgeRuntime !== "undefined" && (EdgeRuntime as any).waitUntil) {
        // @ts-ignore
        (EdgeRuntime as any).waitUntil(doFastPath());
      } else {
        // Sem EdgeRuntime (dev local): roda inline mesmo em async.
        await doFastPath();
      }
      return jsonResponse({ ok: true, run_id: runId, async: true, fast_path: true, plan_kind: plan.kind });
    }
    await doFastPath();
    return jsonResponse({ ok: true, run_id: runId, fast_path: true, plan_kind: plan.kind });
  }

  return jsonResponse({ ok: true });
});
