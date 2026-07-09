import type { CustomFieldFilterValue } from "@/components/contacts/CustomFieldFilterCombobox";

/**
 * Apply a custom-field filter to a Supabase query on `contacts`.
 * Values are stored at contacts.metadata->'custom'->>key.
 */
export function applyCustomFieldFilter<T extends any>(query: T, filter: CustomFieldFilterValue | null): T {
  if (!filter) return query;
  const k = filter.key;
  // PostgREST jsonb text-extract path
  const col = `metadata->custom->>${k}`;
  const q = query as any;

  switch (filter.operator) {
    case "contains":
      return q.ilike(col, `%${filter.value ?? ""}%`);
    case "starts_with":
      return q.ilike(col, `${filter.value ?? ""}%`);
    case "eq":
      return q.eq(col, filter.value ?? "");
    case "neq":
      return q.neq(col, filter.value ?? "");
    case "gt":
      return q.gt(col, filter.value ?? "");
    case "lt":
      return q.lt(col, filter.value ?? "");
    case "before":
      return q.lt(col, filter.value ?? "");
    case "after":
      return q.gt(col, filter.value ?? "");
    case "between":
      return q.gte(col, filter.value ?? "").lte(col, filter.value2 ?? "");
    case "in":
      return q.in(col, filter.values ?? []);
    case "is_true":
      return q.eq(col, "true");
    case "is_false":
      return q.eq(col, "false");
    case "empty":
      return q.or(`${col}.is.null,${col}.eq.`);
    case "not_empty":
      return q.not(col, "is", null).neq(col, "");
    default:
      return query;
  }
}

export function customFieldFilterKey(f: CustomFieldFilterValue | null): string {
  if (!f) return "";
  return `${f.fieldId}|${f.operator}|${f.value ?? ""}|${f.value2 ?? ""}|${(f.values ?? []).join(",")}`;
}
