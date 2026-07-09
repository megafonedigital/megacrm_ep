import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Users, Loader2, Search, Plus, ChevronLeft, ChevronRight, Upload, Download, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { ContactDetailDialog } from "@/components/contacts/ContactDetailDialog";
import { ImportContactsDialog } from "@/components/contacts/ImportContactsDialog";
import { TagFilterCombobox, type TagFilterValue } from "@/components/contacts/TagFilterCombobox";
import { CustomFieldFilterCombobox, type CustomFieldFilterValue } from "@/components/contacts/CustomFieldFilterCombobox";
import { BulkActionsBar } from "@/components/contacts/bulk/BulkActionsBar";
import type { BulkScope } from "@/components/contacts/bulk/types";
import { applyCustomFieldFilter, customFieldFilterKey } from "@/lib/custom-field-filter";
import { exportContactsCsv } from "@/lib/contacts-export";
import { supabase } from "@/integrations/supabase/client";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { formatContactPhone } from "@/lib/phone";
import { deleteContacts } from "@/lib/contacts-admin.functions";
import { getEllieContactStatusBatch } from "@/lib/ellie-contact-status.functions";
import { EllieStatusBadgeStatic } from "@/components/ellie/EllieStatusBadge";
import { isEllie } from "@/lib/ellie";
import { useActiveBrand } from "@/lib/active-brand";
import { useMe } from "@/lib/auth";

export const Route = createFileRoute("/admin/contatos/")({
  component: ContatosPage,
});

function ContatosPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  const { activeBrandId, activeBrand } = useActiveBrand();
  const [tagFilter, setTagFilter] = useState<TagFilterValue>({ tagId: null, noTag: false });
  const tagFilterKey = tagFilter.tagId ? `tag:${tagFilter.tagId}` : tagFilter.noTag ? "noTag" : "";
  const [fieldFilter, setFieldFilter] = useState<CustomFieldFilterValue | null>(null);
  const fieldFilterKey = customFieldFilterKey(fieldFilter);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allFilteredMode, setAllFilteredMode] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogContactId, setDialogContactId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  type SortBy = "name" | "created_at";
  const [sortBy, setSortBy] = useState<SortBy>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const toggleSort = (col: SortBy) => {
    if (sortBy === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir(col === "name" ? "asc" : "desc");
    }
  };
  const qc = useQueryClient();
  const deleteFn = useServerFn(deleteContacts);
  const { me } = useMe();
  const isAdmin = !!me?.isAdmin;

  const handleExport = async () => {
    if (!activeBrandId) return;
    setExporting(true);
    try {
      const res = await exportContactsCsv({ brandId: activeBrandId, search });
      if (res.rowCount === 0) toast.info("Nenhum contato para exportar.");
      else {
        toast.success(`${res.rowCount} contato(s) exportado(s).`);
        if (res.truncated) toast.warning("Limite de 10.000 linhas atingido. Refine os filtros para exportar mais.");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao exportar");
    } finally {
      setExporting(false);
    }
  };

  const openContact = (id: string | null) => { setDialogContactId(id); setDialogOpen(true); };

  const activeImportsQ = useQuery({
    queryKey: ["contact-imports-active", activeBrandId],
    enabled: !!activeBrandId,
    refetchInterval: 10_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("contact_imports")
        .select("id", { count: "exact", head: true })
        .eq("brand_id", activeBrandId!)
        .in("status", ["queued", "running"]);
      if (error) throw error;
      return count ?? 0;
    },
  });
  const activeImports = activeImportsQ.data ?? 0;

  useEffect(() => { setPage(1); }, [debouncedSearch, tagFilterKey, fieldFilterKey, activeBrandId, pageSize, sortBy, sortDir]);

  const contactsQ = useQuery({
    queryKey: [
      "contacts",
      debouncedSearch,
      activeBrandId,
      tagFilterKey,
      fieldFilterKey,
      page,
      pageSize,
      sortBy,
      sortDir,
    ],
    enabled: !!activeBrandId,
    queryFn: async () => {
      const offset = (page - 1) * pageSize;
      const s = debouncedSearch.trim();

      // Tag-filtered paths: use server-side RPCs that match the broadcast
      // logic (filter by tag NAME against contacts.metadata.tags).
      if (tagFilter.tagId) {
        const { data, error } = await supabase.rpc("search_contacts_by_tag", {
          _brand_id: activeBrandId!,
          _tag_id: tagFilter.tagId,
          _search: s || undefined,
          _sort_by: sortBy,
          _sort_dir: sortDir,
          _limit: pageSize,
          _offset: offset,
        });
        if (error) throw error;
        const rowsArr = (data ?? []) as any[];
        const total = rowsArr[0]?.total_count != null ? Number(rowsArr[0].total_count) : null;
        return { rows: rowsArr, count: total };
      }
      if (tagFilter.noTag) {
        const { data, error } = await supabase.rpc("search_contacts_no_tag", {
          _brand_id: activeBrandId!,
          _search: s || undefined,
          _sort_by: sortBy,
          _sort_dir: sortDir,
          _limit: pageSize,
          _offset: offset,
        });
        if (error) throw error;
        const rowsArr = (data ?? []) as any[];
        const total = rowsArr[0]?.total_count != null ? Number(rowsArr[0].total_count) : null;
        return { rows: rowsArr, count: total };
      }


      // Default path: direct select, matching the previous lightweight search
      // behavior. Counts are handled by separate queries so the table itself
      // never waits for expensive total calculations.
      const shouldSearchEmail = /[@.]/.test(s);
      let q = supabase
        .from("contacts")
        .select("id, brand_id, name, profile_name, phone, wa_id, created_at, metadata")
        .eq("brand_id", activeBrandId!);

      if (s) {
        const like = `%${s}%`;
        const searchParts = [`name.ilike.${like}`, `profile_name.ilike.${like}`, `phone.ilike.${like}`, `wa_id.ilike.${like}`];
        if (shouldSearchEmail) searchParts.push(`metadata->>email.ilike.${like}`);
        q = q.or(searchParts.join(","));
      }

      q = applyCustomFieldFilter(q, fieldFilter);

      q = q
        .order(sortBy, { ascending: sortDir === "asc", nullsFirst: false })
        .order("id", { ascending: true })
        .range(offset, offset + pageSize - 1);

      const { data, error, count } = await q;
      if (error) throw error;
      const rows = ((data ?? []) as any[]).map((r) => ({
        ...r,
        email: r.metadata?.email ?? null,
      }));
      return { rows, count: null, exact: false };
    },
  });

  // Exact total contacts in the workspace (no filters). Runs in parallel
  // when there are no narrowing filters so the footer shows the real number
  // instead of Postgres' planned estimate.
  const noFiltersActive = !debouncedSearch.trim() && !tagFilterKey && !fieldFilterKey;
  const totalCountQ = useQuery({
    queryKey: ["contacts-total-exact", activeBrandId],
    enabled: !!activeBrandId && noFiltersActive,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("brand_id", activeBrandId!);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const filteredRows = contactsQ.data?.rows ?? [];
  const offset = (page - 1) * pageSize;
  const exactFromCurrentPage = !noFiltersActive && !tagFilterKey && contactsQ.data
    ? filteredRows.length < pageSize
      ? offset + filteredRows.length
      : null
    : null;

  const filteredCountQ = useQuery({
    queryKey: ["contacts-filtered-total-exact", activeBrandId, debouncedSearch, fieldFilterKey],
    enabled: !!activeBrandId && !tagFilterKey && !noFiltersActive && exactFromCurrentPage === null,
    queryFn: async () => {
      const s = debouncedSearch.trim();
      const shouldSearchEmail = /[@.]/.test(s);
      let q = supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("brand_id", activeBrandId!);
      if (s) {
        const like = `%${s}%`;
        const searchParts = [`name.ilike.${like}`, `profile_name.ilike.${like}`, `phone.ilike.${like}`, `wa_id.ilike.${like}`];
        if (shouldSearchEmail) searchParts.push(`metadata->>email.ilike.${like}`);
        q = q.or(searchParts.join(","));
      }
      q = applyCustomFieldFilter(q, fieldFilter);
      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    },
  });

  const rows = filteredRows;
  // Tag/no-tag RPCs return exact total_count only on page 1 (offset=0); on
  // subsequent pages we reuse the last known total for the same filter/search
  // signature so the footer stays accurate without paying the count cost.
  const tagTotalCacheRef = useRef<Map<string, number>>(new Map());
  const tagTotalSig = `${tagFilterKey}|${debouncedSearch}|${sortBy}|${sortDir}|${activeBrandId ?? ""}`;
  if (tagFilterKey && contactsQ.data?.count != null) {
    tagTotalCacheRef.current.set(tagTotalSig, contactsQ.data.count);
  }
  const exactTotal: number | null =
    tagFilterKey
      ? (contactsQ.data?.count ?? tagTotalCacheRef.current.get(tagTotalSig) ?? null)
      : noFiltersActive
        ? (totalCountQ.data ?? null)
        : (exactFromCurrentPage ?? filteredCountQ.data ?? null);

  const total = exactTotal ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const isTypingSearch = search.trim() !== debouncedSearch.trim();
  const totalIsCalculating =
    isTypingSearch ||
    contactsQ.isLoading ||
    exactTotal === null;




  const visibleIds = useMemo(() => rows.map((r: any) => r.id), [rows]);

  const lastInteractionQ = useQuery({
    queryKey: ["contacts-last-interaction", activeBrandId, visibleIds.join(",")],
    enabled: !!activeBrandId && visibleIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("contact_id, last_message_at")
        .eq("brand_id", activeBrandId!)
        .in("contact_id", visibleIds);
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const r of (data ?? []) as any[]) {
        const cur = map[r.contact_id];
        if (r.last_message_at && (!cur || r.last_message_at > cur)) {
          map[r.contact_id] = r.last_message_at;
        }
      }
      return map;
    },
  });

  const ellieStatusFn = useServerFn(getEllieContactStatusBatch);
  const showEllieColumn = isEllie(activeBrandId);
  const ellieStatusQ = useQuery({
    queryKey: ["contacts-ellie-status", activeBrandId, visibleIds.join(",")],
    enabled: showEllieColumn && visibleIds.length > 0,
    queryFn: () => ellieStatusFn({ data: { contactIds: visibleIds } }),
    staleTime: 60_000,
  });
  const ellieStatusMap = useMemo(() => {
    const m = new Map<string, any>();
    for (const s of (ellieStatusQ.data?.items ?? []) as any[]) m.set(s.contactId, s);
    return m;
  }, [ellieStatusQ.data]);

  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someSelected = visibleIds.some((id) => selected.has(id));

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const delMut = useMutation({
    mutationFn: async (ids: string[]) => deleteFn({ data: { ids } }),
    onSuccess: (res: any) => {
      toast.success(`${res?.deleted ?? 0} contato(s) excluído(s).`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["contacts"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao excluir"),
  });

  const selectedCount = selected.size;
  const hasFilters = !!(search.trim() || tagFilterKey || fieldFilterKey);

  // Reset bulk selection when filters/brand change
  useEffect(() => {
    setSelected(new Set());
    setAllFilteredMode(false);
  }, [debouncedSearch, tagFilterKey, fieldFilterKey, activeBrandId]);

  const bulkScope: BulkScope = allFilteredMode
    ? {
        filter: {
          brandId: activeBrandId ?? "",
          search,
          tagFilter,
          fieldFilter,
        },
      }
    : { ids: Array.from(selected) };
  const bulkCount = allFilteredMode ? total : selectedCount;
  const bulkCtx = { brandId: activeBrandId ?? "", scope: bulkScope, count: bulkCount };

  const handleAfterAction = () => {
    setSelected(new Set());
    setAllFilteredMode(false);
  };

  return (
    <div className="page-container space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Users className="h-6 w-6" /> Contatos
          </h1>
          <p className="text-sm text-muted-foreground">
            Contatos do workspace {activeBrand ? <strong>{activeBrand.name}</strong> : "ativo"}
            {" · "}
            {totalCountQ.isLoading || totalCountQ.data == null ? (
              <span className="opacity-70">carregando base…</span>
            ) : (
              <><strong>{totalCountQ.data.toLocaleString("pt-BR")}</strong> na base</>
            )}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {activeImports > 0 && (
            <Link
              to="/admin/contatos/importacoes"
              className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {activeImports} importação(ões) em andamento
              <span className="opacity-70">· Ver progresso</span>
            </Link>
          )}
          <Button variant="outline" onClick={handleExport} disabled={!activeBrandId || exporting}>
            {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
            Exportar CSV
          </Button>
          <Button variant="outline" onClick={() => setImportOpen(true)} disabled={!activeBrandId}>
            <Upload className="h-4 w-4 mr-2" />Importar CSV
          </Button>
          <Button onClick={() => openContact(null)} disabled={!activeBrandId}>
            <Plus className="h-4 w-4 mr-2" />Novo contato
          </Button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
          <Input className="pl-8 pr-8" placeholder="Buscar nome, e-mail ou telefone" value={search} onChange={(e) => setSearch(e.target.value)} />
          {(search !== debouncedSearch || (!!debouncedSearch && contactsQ.isFetching)) && (
            <Loader2 className="h-4 w-4 absolute right-2 top-2.5 text-muted-foreground animate-spin" />
          )}
        </div>
        <TagFilterCombobox value={tagFilter} onChange={setTagFilter} brandId={activeBrandId} />
        <CustomFieldFilterCombobox value={fieldFilter} onChange={setFieldFilter} brandId={activeBrandId} />
      </div>

      {(selectedCount > 0 || allFilteredMode) && activeBrandId && (
        <BulkActionsBar
          ctx={bulkCtx}
          allFilteredMode={allFilteredMode}
          pageSelectedCount={selectedCount}
          totalFilteredCount={total}
          pageSize={pageSize}
          canSelectAllFiltered={hasFilters || total > pageSize}
          onClear={() => { setSelected(new Set()); setAllFilteredMode(false); }}
          onSelectAllFiltered={() => setAllFilteredMode(true)}
          onAfterAction={handleAfterAction}
          canDelete={isAdmin}
          isDeleting={delMut.isPending}
          onConfirmDelete={() => {
            if (allFilteredMode) {
              toast.error("Exclusão em massa via filtros não é suportada. Selecione contatos manualmente.");
              return;
            }
            delMut.mutate(Array.from(selected));
          }}
        />
      )}

      <Card className={`overflow-hidden transition-opacity ${contactsQ.isFetching && !contactsQ.isLoading ? "opacity-60" : ""}`}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected ? true : someSelected ? "indeterminate" : false}
                  onCheckedChange={toggleAll}
                  aria-label="Selecionar todos"
                />
              </TableHead>
              <TableHead>
                <button
                  type="button"
                  onClick={() => toggleSort("name")}
                  className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                >
                  Nome
                  {sortBy === "name" ? (
                    sortDir === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
                  ) : (
                    <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />
                  )}
                </button>
              </TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead>
                <button
                  type="button"
                  onClick={() => toggleSort("created_at")}
                  className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                >
                  Entrada
                  {sortBy === "created_at" ? (
                    sortDir === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
                  ) : (
                    <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />
                  )}
                </button>
              </TableHead>
              <TableHead>Última interação</TableHead>
              {showEllieColumn && <TableHead>Ellie</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {contactsQ.isLoading && (
              <TableRow><TableCell colSpan={showEllieColumn ? 7 : 6} className="text-center py-6"><Loader2 className="h-4 w-4 animate-spin inline" /></TableCell></TableRow>
            )}
            {!contactsQ.isLoading && rows.length === 0 && (
              <TableRow><TableCell colSpan={showEllieColumn ? 7 : 6} className="text-center py-10 text-sm text-muted-foreground">Nenhum contato.</TableCell></TableRow>
            )}
            {rows.map((c: any) => {
              const email = c.email ?? null;
              const isSel = selected.has(c.id);
              const last = lastInteractionQ.data?.[c.id];
              return (
                <TableRow
                  key={c.id}
                  data-state={isSel ? "selected" : undefined}
                  className="cursor-pointer"
                  onClick={() => openContact(c.id)}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={isSel} onCheckedChange={() => toggleOne(c.id)} aria-label="Selecionar" />
                  </TableCell>
                  <TableCell className="font-medium">{c.name ?? c.profile_name ?? "—"}</TableCell>
                  <TableCell className="text-xs">{email ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="font-mono text-xs">{formatContactPhone(c.phone, c.wa_id)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(c.created_at).toLocaleString("pt-BR")}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {last ? new Date(last).toLocaleString("pt-BR") : "—"}
                  </TableCell>
                  {showEllieColumn && (
                    <TableCell>
                      <EllieStatusBadgeStatic status={ellieStatusMap.get(c.id) ?? null} variant="compact" />
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <div className="flex items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Por página:</span>
          <Select value={String(pageSize)} onValueChange={(v) => setPageSize(parseInt(v, 10))}>
            <SelectTrigger className="w-[90px] h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[25, 50, 100, 200].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
            </SelectContent>
          </Select>
          {totalIsCalculating ? (
            <span className="text-muted-foreground inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Calculando…
            </span>
          ) : (
            <span className="text-muted-foreground">{total.toLocaleString("pt-BR")} contato(s)</span>
          )}

        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Página {page} de {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {activeBrandId && (
        <ContactDetailDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          contactId={dialogContactId}
          brandId={activeBrandId}
        />
      )}

      {activeBrandId && (
        <ImportContactsDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          brandId={activeBrandId}
          onImported={() => qc.invalidateQueries({ queryKey: ["contacts"] })}
        />
      )}
    </div>
  );
}
