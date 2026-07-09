// Shared (client + server) helpers for splitting AI replies into multiple
// "human-like" WhatsApp messages and computing delays between them.

export type SplitMode = "paragraph" | "sentence" | "limit" | "paragraph_then_limit";
export type DelayMode = "fixed" | "proportional" | "random";

export type HumanizeConfig = {
  enabled: boolean;
  split_mode: SplitMode;
  max_chars: number;
  max_parts: number;
  delay_mode: DelayMode;
  delay_fixed_ms: number;
  delay_chars_per_sec: number;
  delay_min_ms: number;
  delay_max_ms: number;
};

export const DEFAULT_HUMANIZE: HumanizeConfig = {
  enabled: false,
  split_mode: "paragraph_then_limit",
  max_chars: 240,
  max_parts: 4,
  delay_mode: "proportional",
  delay_fixed_ms: 1500,
  delay_chars_per_sec: 60,
  delay_min_ms: 800,
  delay_max_ms: 5000,
};

const HARD_LIMITS = {
  max_chars: { min: 40, max: 1000 },
  max_parts: { min: 1, max: 12 },
  delay_fixed_ms: { min: 0, max: 15000 },
  delay_chars_per_sec: { min: 5, max: 500 },
  delay_min_ms: { min: 0, max: 15000 },
  delay_max_ms: { min: 0, max: 20000 },
};

function clamp(n: unknown, def: number, lo: number, hi: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : def;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

export function normalizeHumanizeConfig(raw: unknown): HumanizeConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const splitModes: SplitMode[] = ["paragraph", "sentence", "limit", "paragraph_then_limit"];
  const delayModes: DelayMode[] = ["fixed", "proportional", "random"];
  const split_mode = splitModes.includes(r.split_mode as SplitMode)
    ? (r.split_mode as SplitMode)
    : DEFAULT_HUMANIZE.split_mode;
  const delay_mode = delayModes.includes(r.delay_mode as DelayMode)
    ? (r.delay_mode as DelayMode)
    : DEFAULT_HUMANIZE.delay_mode;
  return {
    enabled: Boolean(r.enabled),
    split_mode,
    max_chars: clamp(r.max_chars, DEFAULT_HUMANIZE.max_chars, HARD_LIMITS.max_chars.min, HARD_LIMITS.max_chars.max),
    max_parts: clamp(r.max_parts, DEFAULT_HUMANIZE.max_parts, HARD_LIMITS.max_parts.min, HARD_LIMITS.max_parts.max),
    delay_mode,
    delay_fixed_ms: clamp(r.delay_fixed_ms, DEFAULT_HUMANIZE.delay_fixed_ms, HARD_LIMITS.delay_fixed_ms.min, HARD_LIMITS.delay_fixed_ms.max),
    delay_chars_per_sec: clamp(r.delay_chars_per_sec, DEFAULT_HUMANIZE.delay_chars_per_sec, HARD_LIMITS.delay_chars_per_sec.min, HARD_LIMITS.delay_chars_per_sec.max),
    delay_min_ms: clamp(r.delay_min_ms, DEFAULT_HUMANIZE.delay_min_ms, HARD_LIMITS.delay_min_ms.min, HARD_LIMITS.delay_min_ms.max),
    delay_max_ms: clamp(r.delay_max_ms, DEFAULT_HUMANIZE.delay_max_ms, HARD_LIMITS.delay_max_ms.min, HARD_LIMITS.delay_max_ms.max),
  };
}

const URL_RE = /\bhttps?:\/\/\S+/gi;

// Mascara URLs com tokens p/ não serem quebradas no meio.
function maskUrls(text: string): { masked: string; urls: string[] } {
  const urls: string[] = [];
  const masked = text.replace(URL_RE, (m) => {
    const i = urls.length;
    urls.push(m);
    return `\u0001URL${i}\u0001`;
  });
  return { masked, urls };
}

function unmaskUrls(text: string, urls: string[]): string {
  return text.replace(/\u0001URL(\d+)\u0001/g, (_, i) => urls[Number(i)] ?? "");
}

function splitByParagraph(text: string): string[] {
  return text
    .split(/\n\s*\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitBySentence(text: string): string[] {
  // Mantém pontuação final. Considera ".", "!", "?", e variantes com quebras.
  const parts: string[] = [];
  const re = /[^.!?\n]+[.!?]+[\)"'\u201d]?|\S[^.!?\n]*$/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const s = m[0].trim();
    if (s) parts.push(s);
  }
  return parts.length ? parts : [text.trim()].filter(Boolean);
}

function splitByLimit(text: string, maxChars: number): string[] {
  const out: string[] = [];
  let remaining = text.trim();
  while (remaining.length > maxChars) {
    // Procura último espaço dentro do limite, preferindo fim de frase.
    const slice = remaining.slice(0, maxChars + 1);
    let cut = -1;
    const sentenceCut = Math.max(
      slice.lastIndexOf(". "),
      slice.lastIndexOf("! "),
      slice.lastIndexOf("? "),
      slice.lastIndexOf("\n"),
    );
    if (sentenceCut >= Math.floor(maxChars * 0.5)) cut = sentenceCut + 1;
    else {
      const spaceCut = slice.lastIndexOf(" ");
      cut = spaceCut > 0 ? spaceCut : maxChars;
    }
    out.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) out.push(remaining);
  return out;
}

// Agrupa frases (tokenizadas via splitBySentence) em buckets <= maxChars,
// SEM cortar no meio de uma frase. Se uma frase sozinha exceder maxChars,
// ela vai inteira em uma parte própria (melhor mensagem maior que quebra ruim).
function splitBySentenceSafe(text: string, maxChars: number): string[] {
  const sentences = splitBySentence(text);
  const out: string[] = [];
  let bucket = "";
  for (const s of sentences) {
    if (!bucket) {
      bucket = s;
      continue;
    }
    if (bucket.length + 1 + s.length <= maxChars) {
      bucket = `${bucket} ${s}`;
    } else {
      out.push(bucket);
      bucket = s;
    }
  }
  if (bucket) out.push(bucket);
  return out;
}

// Linha que inicia item de lista (numerada "1." / "1)" ou marcada "-", "*", "•").
const LIST_ITEM_RE = /^\s*(?:\d+[.)]|[-*•])\s+\S/;
// Parte terminando só com marcador de lista órfão ("3.", "-", etc.)
const ORPHAN_MARKER_RE = /(?:^|\n)\s*(?:\d+[.)]|[-*•])\s*$/;

// Agrupa linhas em itens de lista. Cada item = linha marcador + linhas
// de continuação (linhas seguintes sem marcador próprio).
function splitByListItems(text: string): string[] {
  const lines = text.split("\n");
  const items: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length) {
      const s = current.join("\n").trim();
      if (s) items.push(s);
      current = [];
    }
  };
  for (const line of lines) {
    if (LIST_ITEM_RE.test(line)) {
      flush();
      current.push(line);
    } else {
      current.push(line);
    }
  }
  flush();
  return items;
}

function hasListLines(text: string): boolean {
  const lines = text.split("\n");
  let count = 0;
  for (const l of lines) if (LIST_ITEM_RE.test(l)) count++;
  return count >= 2;
}

// Junta itens curtos consecutivos enquanto caberem em maxChars, mantendo cada
// item de lista intacto (nunca corta no meio de um item).
function packListItems(items: string[], maxChars: number): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (item.length > maxChars) {
      out.push(...splitByLimit(item, maxChars));
      continue;
    }
    if (out.length === 0) {
      out.push(item);
      continue;
    }
    const last = out[out.length - 1];
    if (LIST_ITEM_RE.test(last) && last.length + 1 + item.length <= maxChars) {
      out[out.length - 1] = `${last}\n${item}`;
    } else {
      out.push(item);
    }
  }
  return out;
}

// Se uma parte terminar apenas com marcador de lista, mescla com a próxima.
function healOrphanMarkers(parts: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (ORPHAN_MARKER_RE.test(p) && i + 1 < parts.length) {
      parts[i + 1] = `${p}\n${parts[i + 1]}`.trim();
      continue;
    }
    out.push(p);
  }
  return out;
}

// Reduz parts.length até maxParts mesclando pares adjacentes menores,
// mantendo tamanhos equilibrados (em vez de jogar tudo na última parte).
function reduceToMaxParts(parts: string[], maxParts: number): string[] {
  const arr = [...parts];
  while (arr.length > maxParts) {
    let bestIdx = 0;
    let bestSum = Infinity;
    for (let i = 0; i < arr.length - 1; i++) {
      const sum = arr[i].length + arr[i + 1].length;
      if (sum < bestSum) {
        bestSum = sum;
        bestIdx = i;
      }
    }
    arr.splice(bestIdx, 2, `${arr[bestIdx]}\n\n${arr[bestIdx + 1]}`);
  }
  return arr;
}

export function splitReply(text: string, cfg: HumanizeConfig): string[] {
  if (!cfg.enabled) return [text];
  const clean = (text ?? "").replace(/\r\n/g, "\n").trim();
  if (!clean) return [];

  const { masked, urls } = maskUrls(clean);

  const SAFETY_CAP_MULT = 3; // só quebra lista se exceder este múltiplo de max_chars
  const keepListWhole = (p: string): string[] => {
    if (p.length <= cfg.max_chars * SAFETY_CAP_MULT) return [p];
    // Lista gigante: quebra por itens sem partir item ao meio.
    return packListItems(splitByListItems(p), cfg.max_chars);
  };

  let parts: string[] = [];
  if (cfg.split_mode === "paragraph") {
    const paragraphs = splitByParagraph(masked);
    for (const p of paragraphs) {
      if (hasListLines(p)) parts.push(...keepListWhole(p));
      else parts.push(p);
    }
  } else if (cfg.split_mode === "sentence") {
    parts = splitBySentence(masked);
  } else if (cfg.split_mode === "limit") {
    parts = splitBySentenceSafe(masked, cfg.max_chars);
  } else {
    // paragraph_then_limit
    const paragraphs = splitByParagraph(masked);
    for (const p of paragraphs) {
      if (hasListLines(p)) {
        parts.push(...keepListWhole(p));
      } else if (p.length <= cfg.max_chars) {
        parts.push(p);
      } else {
        parts.push(...splitBySentenceSafe(p, cfg.max_chars));
      }
    }
  }


  parts = parts.map((p) => unmaskUrls(p, urls).trim()).filter(Boolean);
  if (parts.length === 0) return [clean];

  parts = healOrphanMarkers(parts);

  if (parts.length > cfg.max_parts) {
    parts = reduceToMaxParts(parts, cfg.max_parts);
  }
  return parts;
}


export function computeDelay(part: string, index: number, cfg: HumanizeConfig): number {
  if (index === 0) return 0;
  const len = part.length;
  if (cfg.delay_mode === "fixed") return cfg.delay_fixed_ms;
  if (cfg.delay_mode === "random") {
    const lo = Math.min(cfg.delay_min_ms, cfg.delay_max_ms);
    const hi = Math.max(cfg.delay_min_ms, cfg.delay_max_ms);
    return Math.round(lo + Math.random() * (hi - lo));
  }
  // proportional
  const cps = Math.max(1, cfg.delay_chars_per_sec);
  const ms = Math.round((len / cps) * 1000);
  return Math.min(cfg.delay_max_ms, Math.max(cfg.delay_min_ms, ms));
}
