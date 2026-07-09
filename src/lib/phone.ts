// Phone normalization helper.
// Always store phone numbers in E.164 format (e.g. "+5511999999999").
// Use formatPhoneDisplay() only for UI rendering.
import { parsePhoneNumberFromString, AsYouType, type CountryCode } from "libphonenumber-js";

const DEFAULT_COUNTRY: CountryCode = "BR";

/**
 * Normalize a raw phone string to E.164 (with leading "+").
 * Returns null when input is empty or unparseable in any reasonable way.
 *
 * Rules:
 * - If input has "+" → parse as international.
 * - If input has 11–15 digits and starts with a plausible country code → parse as international.
 * - Otherwise → assume defaultCountry (BR) and let libphonenumber handle the 9th digit / DDD.
 * - Fallback: if still invalid but we have ≥8 digits, return "+<digits>" so we don't lose data.
 */
export function toE164(input: string | null | undefined, defaultCountry: CountryCode = DEFAULT_COUNTRY): string | null {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  const digitsOnly = raw.replace(/\D/g, "");
  if (!digitsOnly) return null;

  // 1. With "+" → international (explicit user intent)
  if (raw.startsWith("+")) {
    const parsed = parsePhoneNumberFromString(raw);
    if (parsed?.isValid()) return parsed.number;
  }

  // 2. Try as default-country number FIRST (without "+", we assume local).
  //    This avoids false positives like "41992703176" being parsed as
  //    Switzerland (+41) when it's actually BR DDD 41 + mobile 99270-3176.
  const parsedLocal = parsePhoneNumberFromString(digitsOnly, defaultCountry);
  if (parsedLocal?.isValid()) return parsedLocal.number;

  // 3. Fall back to international parsing when local parse fails
  //    (e.g. "5511999998888" — 13 digits, valid only as international).
  if (digitsOnly.length >= 11) {
    const parsed = parsePhoneNumberFromString("+" + digitsOnly);
    if (parsed?.isValid()) return parsed.number;
  }




  // 4. Fallback: at least keep digits with "+" if length is plausible
  if (digitsOnly.length >= 8) {
    // If it already looks like it starts with a country code (BR=55, US=1, PT=351...),
    // keep as-is; otherwise prefix default country.
    if (digitsOnly.length >= 11) return "+" + digitsOnly;
    // Local-looking → prefix BR (55)
    if (defaultCountry === "BR") return "+55" + digitsOnly;
    return "+" + digitsOnly;
  }

  return null;
}

/**
 * Strip the leading "+" — useful when storing as wa_id (WhatsApp) which uses
 * digits only. Returns digits-only string or null.
 */
export function toE164Digits(input: string | null | undefined, defaultCountry: CountryCode = DEFAULT_COUNTRY): string | null {
  const e164 = toE164(input, defaultCountry);
  if (!e164) return null;
  return e164.replace(/\D/g, "");
}

/**
 * Detects a Meta Business-Scoped User ID (BSUID). Format observed in Meta's
 * docs: `{CC}.{alphanumeric}`, e.g. `BR.abc123`. Anything matching this
 * pattern must NEVER be normalized as a phone number — it is an opaque
 * identifier scoped to a Business Portfolio.
 */
export function isBsuid(input: string | null | undefined): boolean {
  if (!input) return false;
  return /^[A-Z]{2}\.[A-Za-z0-9_-]+$/.test(String(input).trim());
}

/**
 * Returns lookup variants for a wa_id (digits-only) to handle the Brazilian
 * mobile "9th digit" ambiguity: Meta's Cloud API sometimes delivers the `from`
 * without the extra 9, which would otherwise create a duplicate contact.
 *
 * - For BR mobile numbers (DDI 55, 12 or 13 digits), returns both forms.
 * - For anything else, returns just the normalized digits (or empty array).
 * - For BSUIDs (or any non-phone identifier), returns the value as-is — never
 *   tries to mutate it like a phone number.
 */
export function waIdLookupVariants(input: string | null | undefined): string[] {
  if (!input) return [];
  const raw = String(input).trim();
  if (!raw) return [];
  // Opaque identifiers (BSUID etc) — return as-is, never normalize.
  if (isBsuid(raw)) return [raw];
  const normalized = toE164Digits(raw);
  if (!normalized) return [];
  const variants = new Set<string>([normalized]);
  // BR mobile: 55 + 2-digit DDD + 8 or 9 subscriber digits.
  if (normalized.startsWith("55")) {
    const rest = normalized.slice(2);
    if (rest.length === 11 && rest[2] === "9") {
      // 13-digit form (with the 9) → also try 12-digit form (without)
      variants.add("55" + rest.slice(0, 2) + rest.slice(3));
    } else if (rest.length === 10) {
      // 12-digit form (without the 9) → also try 13-digit form (with)
      variants.add("55" + rest.slice(0, 2) + "9" + rest.slice(2));
    }
  }
  return Array.from(variants);
}


/**
 * Format an E.164 (or any phone) for display.
 * Falls back to the input when not parseable.
 */
/**
 * Returns true when the value is empty or a fallback pseudo-id stored in
 * `wa_id` when the contact only has an email (prefix `email:`).
 */
export function isPseudoPhone(input: string | null | undefined): boolean {
  if (!input) return true;
  const raw = String(input).trim();
  if (!raw) return true;
  return raw.toLowerCase().startsWith("email:");
}

export function formatPhoneDisplay(input: string | null | undefined): string {
  if (isPseudoPhone(input)) return "";
  const raw = String(input).trim();
  const candidate = raw.startsWith("+") ? raw : "+" + raw.replace(/\D/g, "");
  const parsed = parsePhoneNumberFromString(candidate);
  if (parsed?.isValid()) return parsed.formatInternational();
  return raw;
}

/**
 * Format a phone string while the user is typing.
 * - If input starts with "+", treat as international (country inferred from prefix).
 * - Otherwise format using defaultCountry (BR) — e.g. "(11) 99999-8888".
 * Returns the original input when nothing meaningful can be formatted yet,
 * so backspace and partial entry keep working naturally.
 */
export function formatPhoneAsYouType(
  input: string | null | undefined,
  defaultCountry: CountryCode = DEFAULT_COUNTRY,
): string {
  if (!input) return "";
  const raw = String(input);
  if (!raw) return "";
  // E.164 max is 15 digits worldwide. Truncate to enforce that limit.
  const MAX_DIGITS = 15;
  const hasPlus = raw.trim().startsWith("+");
  const digits = raw.replace(/\D/g, "").slice(0, MAX_DIGITS);
  if (!digits) return hasPlus ? "+" : "";
  const normalized = hasPlus ? "+" + digits : digits;
  try {
    if (hasPlus) return new AsYouType().input(normalized);
    return new AsYouType(defaultCountry).input(normalized);
  } catch {
    return normalized;
  }
}

/**
 * Pick the best phone-ish value to display for a contact, ignoring the
 * `email:` pseudo-id stored in `wa_id` when no real phone exists.
 */
export function formatContactPhone(
  phone: string | null | undefined,
  waId?: string | null | undefined,
): string {
  return formatPhoneDisplay(phone) || formatPhoneDisplay(waId);
}
