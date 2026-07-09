import type { TagFilterValue } from "@/components/contacts/TagFilterCombobox";
import type { CustomFieldFilterValue } from "@/components/contacts/CustomFieldFilterCombobox";

export type BulkScope =
  | { ids: string[] }
  | { filter: { brandId: string; search: string; tagFilter: TagFilterValue; fieldFilter: CustomFieldFilterValue | null } };

export interface BulkContext {
  brandId: string;
  scope: BulkScope;
  /** N estimated rows for confirmation copy. */
  count: number;
}
