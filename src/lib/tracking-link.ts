// Pure helper used both by the agent engine (server) and by UI previews.
// No imports of server-only code.

export type UtmParams = {
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  content?: string | null;
  term?: string | null;
  site?: string | null;
};

export type LinkPlatform = "shopify" | "hotmart" | "generic";

export function detectPlatform(rawLink: string): LinkPlatform {
  try {
    const u = new URL(rawLink);
    const host = u.hostname.toLowerCase();
    if (host.endsWith(".hotmart.com") || host === "hotmart.com") return "hotmart";
    return "generic";
  } catch {
    return "generic";
  }
}

function joinNonEmpty(values: Array<string | null | undefined>, sep = "-"): string {
  return values.map((v) => (v ?? "").trim()).filter((v) => v.length > 0).join(sep);
}

export function buildTrackedLink(input: {
  rawLink: string;
  utmParams?: UtmParams | null;
  agentTrackingTag?: string | null;
  platform?: LinkPlatform;
}): string {
  const { rawLink } = input;
  const utm = input.utmParams ?? {};
  const tag = (input.agentTrackingTag ?? "").trim() || null;
  let url: URL;
  try {
    url = new URL(rawLink);
  } catch {
    return rawLink;
  }

  const platform = input.platform ?? detectPlatform(rawLink);

  if (platform === "hotmart") {
    // Hotmart só usa o campo `sck` (custom checkout key).
    const sck = joinNonEmpty([utm.campaign, tag]);
    if (sck) url.searchParams.set("sck", sck);
    return url.toString();
  }

  // Shopify / generic: sobrescreve UTMs configuradas; concatena tag em utm_content.
  const setOrDelete = (key: string, value: string | null | undefined) => {
    const v = (value ?? "").trim();
    if (v.length > 0) url.searchParams.set(key, v);
  };

  setOrDelete("utm_source", utm.source);
  setOrDelete("utm_medium", utm.medium);
  setOrDelete("utm_campaign", utm.campaign);
  setOrDelete("utm_term", utm.term);
  // utm_site é menos padrão, mas suportado por algumas plataformas.
  setOrDelete("utm_site", utm.site);

  const content = joinNonEmpty([utm.content, tag]);
  if (content) url.searchParams.set("utm_content", content);

  return url.toString();
}

// Extrai todas as URLs http(s) de um texto, preservando ordem e índices.
const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/g;

export function rewriteLinksInText(input: {
  text: string;
  matchProduct: (rawLink: string) => UtmParams | null;
  agentTrackingTag?: string | null;
}): string {
  if (!input.text) return input.text;
  return input.text.replace(URL_REGEX, (raw) => {
    // Remove pontuação trailing comum (parênteses, vírgulas, ponto final).
    const trailingMatch = raw.match(/[.,;:!?)\]]+$/);
    const trailing = trailingMatch ? trailingMatch[0] : "";
    const clean = trailing ? raw.slice(0, -trailing.length) : raw;
    const utm = input.matchProduct(clean);
    const rewritten = buildTrackedLink({
      rawLink: clean,
      utmParams: utm,
      agentTrackingTag: input.agentTrackingTag ?? null,
    });
    return rewritten + trailing;
  });
}
