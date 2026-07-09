import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---- Schemas ----
const TagFilterSchema = z.object({
  tagId: z.string().uuid().nullable(),
  noTag: z.boolean(),
});

const FieldFilterSchema = z.object({
  key: z.string(),
  type: z.enum(["text", "number", "date", "boolean", "select"]),
  operator: z.enum([
    "contains", "eq", "starts_with", "neq", "gt", "lt", "between",
    "in", "is_true", "is_false", "before", "after", "empty", "not_empty",
  ]),
  value: z.string().optional(),
  value2: z.string().optional(),
  values: z.array(z.string()).optional(),
}).nullable();

const FilterShape = z.object({
  brandId: z.string().uuid(),
  search: z.string().optional().default(""),
  tagFilter: TagFilterSchema,
  fieldFilter: FieldFilterSchema,
});

const ScopeSchema = z.union([
  z.object({ ids: z.array(z.string().uuid()).min(1).max(5000) }),
  z.object({ filter: FilterShape }),
]);

type Scope = z.infer<typeof ScopeSchema>;
type SupabaseClient = ReturnType<typeof import("@/integrations/supabase/client").supabase.from> extends infer _ ? any : any;

// ---- Helpers ----
const HARD_LIMIT = 5000;

function applyField(query: any, f: z.infer<typeof FieldFilterSchema>) {
  if (!f) return query;
  const col = `metadata->custom->>${f.key}`;
  switch (f.operator) {
    case "contains": return query.ilike(col, `%${f.value ?? ""}%`);
    case "starts_with": return query.ilike(col, `${f.value ?? ""}%`);
    case "eq": return query.eq(col, f.value ?? "");
    case "neq": return query.neq(col, f.value ?? "");
    case "gt": return query.gt(col, f.value ?? "");
    case "lt": return query.lt(col, f.value ?? "");
    case "before": return query.lt(col, f.value ?? "");
    case "after": return query.gt(col, f.value ?? "");
    case "between": return query.gte(col, f.value ?? "").lte(col, f.value2 ?? "");
    case "in": return query.in(col, f.values ?? []);
    case "is_true": return query.eq(col, "true");
    case "is_false": return query.eq(col, "false");
    case "empty": return query.or(`${col}.is.null,${col}.eq.`);
    case "not_empty": return query.not(col, "is", null).neq(col, "");
    default: return query;
  }
}

async function resolveScopeIds(
  supabase: any,
  scope: Scope,
): Promise<{ ids: string[]; truncated: boolean; brandId: string }> {
  if ("ids" in scope) {
    // Re-validate brand membership by fetching brand_ids
    const out: string[] = [];
    const brands = new Set<string>();
    const CHUNK = 500;
    for (let i = 0; i < scope.ids.length; i += CHUNK) {
      const slice = scope.ids.slice(i, i + CHUNK);
      const { data, error } = await supabase
        .from("contacts").select("id, brand_id").in("id", slice);
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as any[]) { out.push(r.id); brands.add(r.brand_id); }
    }
    if (brands.size === 0) throw new Error("Nenhum contato encontrado.");
    if (brands.size > 1) throw new Error("Seleção contém contatos de mais de uma workspace.");
    return { ids: out, truncated: false, brandId: [...brands][0] };
  }

  const { brandId, search, tagFilter, fieldFilter } = scope.filter;

  // Resolve tag ids
  let tagIds: Set<string> | null = null;
  if (tagFilter.tagId) {
    tagIds = new Set();
    const PAGE = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from("contact_tags").select("contact_id").eq("tag_id", tagFilter.tagId)
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];
      for (const r of rows) tagIds.add(r.contact_id);
      if (rows.length < PAGE) break;
      from += PAGE;
    }
    if (tagIds.size === 0) return { ids: [], truncated: false, brandId };
  } else if (tagFilter.noTag) {
    const all = new Set<string>();
    const PAGE = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from("contacts").select("id").eq("brand_id", brandId).range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];
      for (const r of rows) all.add(r.id);
      if (rows.length < PAGE) break;
      from += PAGE;
    }
    const tagged = new Set<string>();
    const allIds = [...all];
    const CHUNK = 100;
    for (let i = 0; i < allIds.length; i += CHUNK) {
      const { data, error } = await supabase
        .from("contact_tags").select("contact_id").in("contact_id", allIds.slice(i, i + CHUNK));
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as any[]) tagged.add(r.contact_id);
    }
    for (const id of tagged) all.delete(id);
    tagIds = all;
  }

  // Build base query with search + field filter
  const ids: string[] = [];
  const runQuery = async (extraIn?: string[]) => {
    let q = supabase.from("contacts").select("id").eq("brand_id", brandId);
    if (search.trim()) {
      const s = search.trim();
      q = q.or(`name.ilike.%${s}%,profile_name.ilike.%${s}%,phone.ilike.%${s}%,wa_id.ilike.%${s}%`);
    }
    q = applyField(q, fieldFilter);
    if (extraIn) q = q.in("id", extraIn);
    q = q.order("created_at", { ascending: false }).limit(HARD_LIMIT + 1);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return ((data ?? []) as any[]).map((r) => r.id);
  };

  if (tagIds) {
    const arr = [...tagIds];
    const CHUNK = 100;
    for (let i = 0; i < arr.length && ids.length <= HARD_LIMIT; i += CHUNK) {
      const got = await runQuery(arr.slice(i, i + CHUNK));
      for (const id of got) { ids.push(id); if (ids.length > HARD_LIMIT) break; }
    }
  } else {
    const got = await runQuery();
    ids.push(...got);
  }

  const truncated = ids.length > HARD_LIMIT;
  return { ids: truncated ? ids.slice(0, HARD_LIMIT) : ids, truncated, brandId };
}

async function runWithConcurrency<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

// ============================================================
// resolveContactIds — used by UI to preview "N contatos afetados"
// ============================================================
export const resolveContactIds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ filter: FilterShape }).parse(data))
  .handler(async ({ data, context }) => {
    const { ids, truncated } = await resolveScopeIds(context.supabase, { filter: data.filter });
    return { count: ids.length, truncated };
  });

// ============================================================
// bulkApplyTag
// ============================================================
export const bulkApplyTag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({
      scope: ScopeSchema,
      tagId: z.string().uuid(),
      dispatchAutomation: z.boolean().default(false),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { ids, brandId } = await resolveScopeIds(supabase, data.scope);
    if (ids.length === 0) return { updated: 0, automationDispatched: 0, automationFailed: 0 };

    const { data: tagRow, error: tagErr } = await supabase
      .from("tags").select("id, name, brand_id").eq("id", data.tagId).maybeSingle();
    if (tagErr) throw new Error(tagErr.message);
    if (!tagRow || (tagRow as any).brand_id !== brandId) throw new Error("Tag inválida para esta workspace.");
    const tagName = (tagRow as any).name as string;

    // 1) contact_tags upsert (ignoreDuplicates)
    const CHUNK = 200;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const rows = ids.slice(i, i + CHUNK).map((cid) => ({ contact_id: cid, tag_id: data.tagId }));
      const { error } = await supabase
        .from("contact_tags").upsert(rows, { onConflict: "contact_id,tag_id", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    }

    // 2) metadata.tags merge
    let updated = 0;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const { data: rows, error } = await supabase
        .from("contacts").select("id, metadata").in("id", slice);
      if (error) throw new Error(error.message);
      for (const r of (rows ?? []) as any[]) {
        const meta = (r.metadata ?? {}) as Record<string, any>;
        const tags: string[] = Array.isArray(meta.tags) ? meta.tags : [];
        if (tags.includes(tagName)) continue;
        const newMeta = { ...meta, tags: [...tags, tagName] };
        const { error: upErr } = await supabase
          .from("contacts").update({ metadata: newMeta }).eq("id", r.id);
        if (upErr) throw new Error(upErr.message);
        updated++;
      }
    }

    // 3) automation dispatch (best effort)
    let automationDispatched = 0;
    let automationFailed = 0;
    if (data.dispatchAutomation) {
      await runWithConcurrency(ids, 8, async (cid) => {
        try {
          const { error } = await supabase.functions.invoke("automation-engine", {
            body: { event: "tag_added", contact_id: cid, tag: tagName },
          });
          if (error) automationFailed++; else automationDispatched++;
        } catch {
          automationFailed++;
        }
      });
    }

    return { updated, automationDispatched, automationFailed, total: ids.length };
  });

// ============================================================
// bulkSetCustomField
// ============================================================
export const bulkSetCustomField = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({
      scope: ScopeSchema,
      fieldKey: z.string().min(1),
      value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
      mode: z.enum(["overwrite", "fill_empty"]).default("overwrite"),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { ids, brandId } = await resolveScopeIds(supabase, data.scope);
    if (ids.length === 0) return { updated: 0, skipped: 0 };

    // Validate field exists for brand
    const { data: field, error: fErr } = await supabase
      .from("custom_fields").select("id, key, type").eq("brand_id", brandId).eq("key", data.fieldKey).maybeSingle();
    if (fErr) throw new Error(fErr.message);
    if (!field) throw new Error("Campo personalizado não encontrado nesta workspace.");

    let updated = 0;
    let skipped = 0;
    const CHUNK = 200;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const { data: rows, error } = await supabase
        .from("contacts").select("id, metadata").in("id", slice);
      if (error) throw new Error(error.message);
      for (const r of (rows ?? []) as any[]) {
        const meta = (r.metadata ?? {}) as Record<string, any>;
        const custom = (meta.custom ?? {}) as Record<string, any>;
        const cur = custom[data.fieldKey];
        if (data.mode === "fill_empty" && cur !== undefined && cur !== null && cur !== "") {
          skipped++;
          continue;
        }
        const newMeta = { ...meta, custom: { ...custom, [data.fieldKey]: data.value } };
        const { error: upErr } = await supabase
          .from("contacts").update({ metadata: newMeta }).eq("id", r.id);
        if (upErr) throw new Error(upErr.message);
        updated++;
      }
    }

    return { updated, skipped, total: ids.length };
  });

// ============================================================
// bulkAddToPipeline
// ============================================================
export const bulkAddToPipeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({
      scope: ScopeSchema,
      pipelineId: z.string().uuid(),
      stageId: z.string().uuid(),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { ids, brandId } = await resolveScopeIds(supabase, data.scope);
    if (ids.length === 0) return { added: 0, alreadyInPipeline: 0 };

    // Validate pipeline + stage in brand
    const { data: pipeline, error: pErr } = await supabase
      .from("pipelines").select("id, brand_id").eq("id", data.pipelineId).maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!pipeline || (pipeline as any).brand_id !== brandId)
      throw new Error("Pipeline inválido para esta workspace.");
    const { data: stage, error: sErr } = await supabase
      .from("pipeline_stages").select("id, pipeline_id").eq("id", data.stageId).maybeSingle();
    if (sErr) throw new Error(sErr.message);
    if (!stage || (stage as any).pipeline_id !== data.pipelineId)
      throw new Error("Etapa não pertence ao pipeline selecionado.");

    // Discover which contacts are already in the pipeline
    const existing = new Set<string>();
    const CHUNK = 200;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data: rows, error } = await supabase
        .from("pipeline_contacts").select("contact_id")
        .eq("pipeline_id", data.pipelineId).in("contact_id", ids.slice(i, i + CHUNK));
      if (error) throw new Error(error.message);
      for (const r of (rows ?? []) as any[]) existing.add(r.contact_id);
    }
    const toInsert = ids.filter((id) => !existing.has(id));

    // Position: max+1 (incremented per row)
    const { data: maxRow } = await supabase
      .from("pipeline_contacts").select("position")
      .eq("pipeline_id", data.pipelineId).eq("stage_id", data.stageId)
      .order("position", { ascending: false }).limit(1).maybeSingle();
    let pos = ((maxRow as any)?.position ?? 0) + 1;

    for (let i = 0; i < toInsert.length; i += CHUNK) {
      const rows = toInsert.slice(i, i + CHUNK).map((cid) => ({
        pipeline_id: data.pipelineId,
        stage_id: data.stageId,
        contact_id: cid,
        brand_id: brandId,
        moved_by: userId,
        position: pos++,
      }));
      const { error } = await supabase.from("pipeline_contacts").insert(rows);
      if (error) throw new Error(error.message);
    }

    // Auto-atribuição: roda a regra de distribuição do pipeline para cada
    // contato recém-inserido. Paraleliza em pequenos lotes; erros individuais
    // são logados e não derrubam o batch.
    const ASSIGN_CHUNK = 20;
    for (let i = 0; i < toInsert.length; i += ASSIGN_CHUNK) {
      const slice = toInsert.slice(i, i + ASSIGN_CHUNK);
      await Promise.all(
        slice.map(async (cid) => {
          const { error } = await supabase.rpc("assign_pipeline_owner", {
            p_pipeline_id: data.pipelineId,
            p_contact_id: cid,
            p_brand_id: brandId,
          });
          if (error) {
            console.error("[bulkAddToPipeline assign_pipeline_owner]", cid, error.message);
          }
        }),
      );
    }

    return { added: toInsert.length, alreadyInPipeline: existing.size, total: ids.length };
  });

// ============================================================
// bulkTriggerAutomation
// ============================================================
export const bulkTriggerAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({
      scope: ScopeSchema,
      automationId: z.string().uuid(),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { ids, brandId } = await resolveScopeIds(supabase, data.scope);
    if (ids.length === 0) return { dispatched: 0, skippedNoConversation: 0, failed: 0 };

    const { data: automation, error: aErr } = await supabase
      .from("automations").select("id, status, brand_id").eq("id", data.automationId).maybeSingle();
    if (aErr) throw new Error(aErr.message);
    if (!automation || (automation as any).brand_id !== brandId)
      throw new Error("Automação inválida para esta workspace.");
    if ((automation as any).status !== "active")
      throw new Error("Automação não está ativa.");

    // Resolve latest conversation per contact
    const convByContact = new Map<string, string>();
    const CHUNK = 200;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data: rows, error } = await supabase
        .from("conversations").select("id, contact_id, last_message_at")
        .eq("brand_id", brandId).in("contact_id", ids.slice(i, i + CHUNK))
        .order("last_message_at", { ascending: false, nullsFirst: false });
      if (error) throw new Error(error.message);
      for (const r of (rows ?? []) as any[]) {
        if (!convByContact.has(r.contact_id)) convByContact.set(r.contact_id, r.id);
      }
    }

    let dispatched = 0;
    let failed = 0;
    let skippedNoConversation = 0;

    await runWithConcurrency(ids, 8, async (cid) => {
      const convId = convByContact.get(cid);
      if (!convId) { skippedNoConversation++; return; }
      try {
        const { error } = await supabase.functions.invoke("automation-engine", {
          body: {
            event: "manual_trigger",
            automation_id: data.automationId,
            contact_id: cid,
            conversation_id: convId,
            variables: { trigger_source: "bulk_contacts" },
          },
        });
        if (error) failed++; else dispatched++;
      } catch {
        failed++;
      }
    });

    return { dispatched, skippedNoConversation, failed, total: ids.length };
  });
