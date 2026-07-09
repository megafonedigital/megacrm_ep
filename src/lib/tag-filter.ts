import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TagFilterValue } from "@/components/contacts/TagFilterCombobox";

/**
 * Tag filtering source of truth
 * ------------------------------------------------------------------
 * In this project, `contacts.metadata.tags` (array of tag names) is the
 * canonical source — the same field the broadcast audience uses. The legacy
 * `contact_tags` join table is incomplete for contacts that were edited or
 * imported through the metadata path, so any tag-based filter MUST go through
 * `metadata->tags` by NAME, not by `tag_id` against the join table.
 */

/**
 * Resolve the tag NAME for the selected tagId.
 * Lightweight hook used by views that can apply the metadata filter directly
 * server-side (e.g. the Contatos page).
 */
export function useTagFilterTagName(brandId: string | null | undefined, filter: TagFilterValue) {
  const active = !!brandId && (filter.noTag || !!filter.tagId);

  const q = useQuery({
    queryKey: ["tag-filter-tag-name", brandId, filter.tagId],
    enabled: !!brandId && !!filter.tagId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tags")
        .select("name")
        .eq("id", filter.tagId!)
        .maybeSingle();
      if (error) throw error;
      return (data?.name ?? null) as string | null;
    },
  });

  return {
    active,
    tagName: filter.tagId ? q.data ?? null : null,
    isLoading: !!filter.tagId && q.isLoading,
  };
}

/**
 * Resolve the set of contact ids matching the tag filter.
 * Used by views that already operate over a local set of contacts (e.g. the
 * pipeline board) and need to intersect with the tag filter client-side.
 *
 * Source: `contacts.metadata.tags` (by name). Falls back to no restriction
 * while the tag name resolves, and to an empty set if the name cannot be
 * resolved.
 */
export function useTagFilterContactIds(brandId: string | null | undefined, filter: TagFilterValue) {
  const active = !!brandId && (filter.noTag || !!filter.tagId);

  const q = useQuery({
    queryKey: ["tag-filter-contact-ids-by-name", brandId, filter.tagId, filter.noTag],
    enabled: active,
    queryFn: async () => {
      // Resolve tag name (only when filtering by a specific tag).
      let tagName: string | null = null;
      if (filter.tagId) {
        const { data, error } = await supabase
          .from("tags")
          .select("name")
          .eq("id", filter.tagId)
          .maybeSingle();
        if (error) throw error;
        tagName = (data?.name ?? null) as string | null;
        if (!tagName) return new Set<string>();
      }

      const PAGE = 1000;
      const matched = new Set<string>();
      let from = 0;
      while (true) {
        let req = supabase
          .from("contacts")
          .select("id, metadata")
          .eq("brand_id", brandId!);
        if (tagName) {
          req = req.filter("metadata->tags", "cs", JSON.stringify([tagName]));
        }
        const { data, error } = await req.range(from, from + PAGE - 1);
        if (error) throw error;
        const rows = (data ?? []) as Array<{ id: string; metadata: any }>;
        for (const r of rows) {
          if (filter.noTag) {
            const tags = Array.isArray(r.metadata?.tags) ? r.metadata.tags : [];
            if (tags.length === 0) matched.add(r.id);
          } else {
            matched.add(r.id);
          }
        }
        if (rows.length < PAGE) break;
        from += PAGE;
      }
      return matched;
    },
  });

  return {
    active,
    contactIds: active ? q.data : undefined,
    isLoading: active && q.isLoading,
  };
}
