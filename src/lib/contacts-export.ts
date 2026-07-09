import Papa from "papaparse";
import { supabase } from "@/integrations/supabase/client";
import { formatContactPhone } from "@/lib/phone";

export type ExportFilters = {
  brandId: string;
  search?: string;
  tag?: string;
  maxRows?: number;
};

type CustomField = { key: string; label: string };

export async function exportContactsCsv(filters: ExportFilters): Promise<{ rowCount: number; truncated: boolean }> {
  const maxRows = filters.maxRows ?? 10000;
  const pageSize = 1000;

  // Custom field definitions for column headers
  const { data: cf, error: cfErr } = await supabase
    .from("custom_fields")
    .select("key, label, position")
    .eq("brand_id", filters.brandId)
    .order("position");
  if (cfErr) throw cfErr;
  const customFields: CustomField[] = (cf ?? []).map((r: any) => ({ key: r.key, label: r.label }));

  // Fetch contacts in pages
  type ContactRow = {
    id: string;
    name: string | null;
    profile_name: string | null;
    phone: string | null;
    wa_id: string | null;
    metadata: any;
    created_at: string;
  };
  const all: ContactRow[] = [];
  let from = 0;
  let truncated = false;
  while (all.length < maxRows) {
    const to = Math.min(from + pageSize - 1, maxRows - 1);
    let q = supabase
      .from("contacts")
      .select("id, name, profile_name, phone, wa_id, metadata, created_at")
      .eq("brand_id", filters.brandId)
      .order("created_at", { ascending: false })
      .range(from, to);
    const s = filters.search?.trim();
    if (s) q = q.or(`name.ilike.%${s}%,profile_name.ilike.%${s}%,phone.ilike.%${s}%,wa_id.ilike.%${s}%`);
    const t = filters.tag?.trim();
    if (t) q = q.contains("metadata", { tags: [t] });
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as ContactRow[];
    all.push(...rows);
    if (rows.length < to - from + 1) break;
    from = to + 1;
    if (all.length >= maxRows) {
      truncated = true;
      break;
    }
  }

  const headers = [
    "name",
    "profile_name",
    "email",
    "phone",
    "wa_id",
    "tags",
    "created_at",
    ...customFields.map((c) => `custom.${c.key}`),
  ];

  const records = all.map((c) => {
    const meta = c.metadata ?? {};
    const tags = Array.isArray(meta?.tags) ? meta.tags.join(";") : "";
    const base: Record<string, any> = {
      name: c.name ?? "",
      profile_name: c.profile_name ?? "",
      email: meta?.email ?? "",
      phone: formatContactPhone(c.phone, c.wa_id) || "",
      wa_id: c.wa_id ?? "",
      tags,
      created_at: c.created_at,
    };
    for (const cf of customFields) {
      const v = meta?.[cf.key];
      base[`custom.${cf.key}`] = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    }
    return base;
  });

  const csv = Papa.unparse({ fields: headers, data: records }, { quotes: true });
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `contatos-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  return { rowCount: all.length, truncated };
}

export function downloadErrorCsv(errors: Array<{ row: number; reason: string }>) {
  const csv = Papa.unparse({
    fields: ["row", "reason"],
    data: errors.map((e) => ({ row: e.row >= 0 ? e.row + 1 : "", reason: e.reason })),
  });
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `erros-importacao-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
