import { useState, useMemo, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { ScrapeLeadsDialog } from "@/components/modules/ScrapeLeadsDialog";
import { PipelineStats, PipelineStatsSkeleton } from "@/components/modules/crm/PipelineStats";
import { LeadsPageSkeleton } from "@/components/modules/crm/LeadsPageSkeleton";
import { CreateLeadDialog } from "@/components/modules/crm/CreateLeadDialog";
import { LeadViewTabs, type LeadView } from "@/components/modules/crm/LeadViewTabs";
import { LeadFilterBar } from "@/components/modules/crm/LeadFilterBar";
import { LeadKanban } from "@/components/modules/crm/LeadKanban";
import { LeadTable } from "@/components/modules/crm/LeadTable";
import { LeadDetailSheet } from "@/components/modules/crm/LeadDetailSheet";
import { BulkActionBar } from "@/components/modules/crm/BulkActionBar";
import { BulkDeleteDialog } from "@/components/modules/crm/BulkDeleteDialog";
import { BulkEditDialog } from "@/components/modules/crm/BulkEditDialog";
import { BulkCommentDialog } from "@/components/modules/crm/BulkCommentDialog";
import { useCurrentUser } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  useLeads, useCreateLead, useUpdateLead, useLeadCategories,
  usePipelineSummary, useBulkDeleteLeads, useBulkUpdateLeads, useBulkCommentLeads,
  leadsTruncated, LEAD_FETCH_CEILING,
  type BulkLeadPatch,
} from "@/hooks/useCRM";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useUsers } from "@/hooks/useTasks";
import { useSequences, useBulkEnroll } from "@/hooks/useOutreach";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { exportCsv, type CsvColumn } from "@/lib/csv";
import type { ApiLead } from "@/lib/types";
import { QueryError } from "@/components/QueryError";

// Spreadsheet columns for the leads export. Deal value stays numeric so it can
// be summed; complaint tags collapse into one semicolon-joined cell.
const LEAD_CSV_COLUMNS: CsvColumn<ApiLead>[] = [
  { header: "Name",        value: (l) => l.name },
  { header: "Company",     value: (l) => l.company },
  { header: "Email",       value: (l) => l.email },
  { header: "Phone",       value: (l) => l.phone },
  { header: "Stage",       value: (l) => l.stage },
  { header: "Category",    value: (l) => l.category },
  { header: "Source",      value: (l) => l.source },
  { header: "Deal value",  value: (l) => Number(l.dealValue ?? 0) },
  { header: "Assignee",    value: (l) => l.assignee_name },
  { header: "ICP score",   value: (l) => l.icpScore },
  { header: "Complaints",  value: (l) => (l.complaintTags?.length ? l.complaintTags.join("; ") : "") },
  { header: "Last activity", value: (l) => l.lastActivity },
  { header: "Notes",       value: (l) => l.notes },
];

export default function CRM() {
  const currentUser = useCurrentUser();
  const [isOpen,      setIsOpen]      = useState(false);
  const [selectedId,  setSelectedId]  = useState<string | null>(null);
  const [view,        setView]        = useState<LeadView>("kanban");
  const [search,       setSearch]       = useState("");
  const [catFilter,    setCatFilter]    = useState("");
  const [stageFilter,  setStageFilter]  = useState("");
  const [reachability, setReachability] = useState("");
  // "" = live leads only (archived hidden, which is the server default),
  // "only" = the archive. Archiving is what the strike limit can do to a lead,
  // and without a way to list them an archived lead would be unreachable.
  const [archivedFilter, setArchivedFilter] = useState("");
  // "" = All Leads, "unassigned" = no assignee, otherwise a profile id.
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const debouncedSearch = useDebouncedValue(search.trim(), 350);

  // Deep link from the Today queue: /crm?lead=<id> must open THAT lead, not
  // just land on the page. The backend has been emitting these links all along
  // but nothing here read the param, so every item from Today meant hunting
  // for the record by hand.
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkedLeadId = searchParams.get("lead");

  useEffect(() => {
    if (deepLinkedLeadId) setSelectedId(deepLinkedLeadId);
  }, [deepLinkedLeadId]);

  // Closing the sheet clears the param, so a refresh or a back-navigation
  // doesn't silently reopen the lead the user just dismissed.
  const closeDetail = () => {
    setSelectedId(null);
    if (deepLinkedLeadId) {
      searchParams.delete("lead");
      setSearchParams(searchParams, { replace: true });
    }
  };

  const bulkEnroll = useBulkEnroll();
  const { data: sequencesList = [], isLoading: sequencesLoading } = useSequences();
  const enrollableSequences = sequencesList.filter((s) => s.isActive && s.step_count > 0);

  const {
    data: rawLeads = [], isLoading, isError, error, refetch, isRefetching,
  } = useLeads({
    search:       debouncedSearch || undefined,
    category:     catFilter || undefined,
    stage:        stageFilter || undefined,
    reachability: (reachability as "unreachable" | "reachable" | "") || undefined,
    archived:     (archivedFilter as "only" | "") || undefined,
    assignee_id:  assigneeFilter || undefined,
    // No `limit`. useLeads pages through the whole filtered set; passing one
    // here is what capped the board at 200 cards while 619 leads existed.
  });

  // Pipeline-summary: accurate totals across ALL leads regardless of current filter
  const { data: pipeline = [], isLoading: pipelineLoading } = usePipelineSummary();

  /**
   * True per-stage counts for the Kanban headers — but ONLY when nothing is
   * filtered.
   *
   * The board's cards come from useLeads() above, which now pages through the
   * whole filtered set — but the two numbers still cannot be the same query.
   *
   * /crm/pipeline-summary counts in SQL over the whole table, and it applies
   * ONLY role scoping, not this page's search/stage/category/reachability/
   * archived/assignee filters. Handing those totals to a filtered board would
   * be wrong in the obvious way: search "clinic" and every header would still
   * read the unfiltered pipeline.
   *
   * So: undefined whenever any filter is active, which makes LeadKanban fall
   * back to counting the rows it was given — the correct basis for a filtered
   * view, since the API applied the same filters when selecting them.
   */
  const anyFilterActive = Boolean(
    debouncedSearch || catFilter || stageFilter || reachability || archivedFilter || assigneeFilter,
  );
  const unfilteredStageTotals = useMemo(() => {
    if (anyFilterActive) return undefined;
    return Object.fromEntries(pipeline.map((r) => [r.stage, r.count]));
  }, [anyFilterActive, pipeline]);
  const { data: users    = [] } = useUsers();
  const { data: categories = [] } = useLeadCategories();
  const createLead = useCreateLead();
  const updateLead = useUpdateLead();

  // The assignee filter's options. Derived from the real team rather than a
  // hardcoded pair of names, so it stays correct as people join or leave.
  const assignees = useMemo(
    () => users.map((u) => ({ id: u.id, name: u.name })),
    [users],
  );

  // Deduplicate by id to prevent any double-render glitches
  const leads = useMemo(
    () => rawLeads.filter((l, i, arr) => arr.findIndex((x) => x.id === l.id) === i),
    [rawLeads],
  );

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setSelectedIds((prev) => {
      const allVisibleSelected = leads.length > 0 && leads.every((l) => prev.has(l.id));
      return allVisibleSelected ? new Set() : new Set(leads.map((l) => l.id));
    });
  };
  const clearSelection = () => setSelectedIds(new Set());

  // ── Bulk delete ──
  // Irreversible and cascades to activities/enrolments/sends, so the flow is
  // always: dry-run for an exact count → explicit confirm → delete.
  const bulkDelete = useBulkDeleteLeads();
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [deleteCount,    setDeleteCount]    = useState<number | null>(null);

  const openBulkDelete = () => {
    setDeleteCount(null);
    setBulkDeleteOpen(true);
    bulkDelete.mutate(
      { ids: Array.from(selectedIds), dryRun: true },
      {
        onSuccess: (res) => setDeleteCount(res.would_delete ?? 0),
        onError:   (err) => { toast.error(err.message); setBulkDeleteOpen(false); },
      },
    );
  };

  const confirmBulkDelete = () => {
    const count = selectedIds.size;
    bulkDelete.mutate(
      { ids: Array.from(selectedIds) },
      {
        onSuccess: (res) => {
          toast.success(`Deleted ${res.deleted} lead${res.deleted === 1 ? "" : "s"}`);
          setBulkDeleteOpen(false);
          clearSelection();
          if (selectedId && !leads.some((l) => l.id === selectedId)) setSelectedId(null);
        },
        onError: (err) => toast.error(err.message),
      },
    );
    return count;
  };

  // ── Bulk edit ──
  // Not admin-only: the server scopes it to the caller's own leads, which is
  // exactly the set a member can already PATCH one at a time. `canReassign`
  // hides the assignee field for members rather than letting them submit a
  // change the server will 403.
  const bulkUpdate = useBulkUpdateLeads();
  const [bulkEditOpen, setBulkEditOpen] = useState(false);

  const applyBulkEdit = (patch: BulkLeadPatch) => {
    bulkUpdate.mutate(
      { ids: Array.from(selectedIds), patch },
      {
        onSuccess: (res) => {
          setBulkEditOpen(false);
          clearSelection();
          toast.success(
            `Updated ${res.updated} lead${res.updated === 1 ? "" : "s"}` +
            // A member can tick a lead they do not own only via a stale list, but
            // reporting the gap beats silently updating fewer rows than asked.
            (res.skipped > 0 ? ` · ${res.skipped} skipped (not yours, or already gone)` : ""),
          );
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  // ── Bulk comment ──
  const bulkComment = useBulkCommentLeads();
  const [bulkCommentOpen, setBulkCommentOpen] = useState(false);

  const applyBulkComment = (body: {
    description: string; type: string; date: string; strike: boolean;
  }) => {
    bulkComment.mutate(
      { ids: Array.from(selectedIds), ...body },
      {
        onSuccess: (res) => {
          setBulkCommentOpen(false);
          clearSelection();
          toast.success(
            `Comment added to ${res.commented} lead${res.commented === 1 ? "" : "s"}` +
            (res.skipped > 0 ? ` · ${res.skipped} skipped` : "") +
            (res.strikes > 0 ? ` · ${res.strikes} strike${res.strikes === 1 ? "" : "s"}` : ""),
          );
          // Reported separately and not as a success detail: the third strike
          // CLOSES a lead, and a bulk action that quietly closed some of what
          // it touched would be indistinguishable from a bug.
          if (res.limit_reached > 0) {
            toast.warning(
              `${res.limit_reached} lead${res.limit_reached === 1 ? "" : "s"} reached the strike ` +
              `limit and ${res.limit_applied === "archive" ? "were archived" : "were closed lost"}`,
            );
          }
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  const handleBulkEnroll = (sequenceId: string) => {
    if (selectedIds.size === 0) return;
    bulkEnroll.mutate(
      { lead_ids: Array.from(selectedIds), sequence_id: sequenceId },
      {
        onSuccess: (res) => {
          toast.success(
            `Enrolled ${res.enrolled} new` +
            (res.already_enrolled > 0 ? ` · ${res.already_enrolled} already in sequence` : "") +
            (res.errors > 0 ? ` · ${res.errors} failed` : ""),
          );
          clearSelection();
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  // useCallback so LeadKanban's memo() actually holds. A new function identity
  // on every render would make the memo compare unequal and re-render all the
  // cards anyway — which is what made typing in the search box cost ~2s.
  const handleMove = useCallback((itemId: string, _from: string, to: string) => {
    updateLead.mutate(
      { id: itemId, stage: to },
      { onError: () => toast.error("Failed to move lead") },
    );
  }, [updateLead]);

  const handleAdd = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    // Company is optional in the form (mirrors QuickAdd) — default it to the
    // name here so the two "Add Lead" surfaces behave identically instead of
    // one silently requiring a field the other doesn't.
    const name = (fd.get("name") as string).trim();
    createLead.mutate(
      {
        name,
        company:     (fd.get("company") as string).trim() || name,
        email:       (fd.get("email") as string)       || undefined,
        phone:       (fd.get("phone") as string)       || undefined,
        source:      (fd.get("source") as string)      || undefined,
        category:    (fd.get("category") as string)    || undefined,
        deal_value:  Number(fd.get("deal_value"))      || 0,
        assignee_id: (fd.get("assignee_id") as string) || undefined,
        notes:       (fd.get("notes") as string)       || undefined,
      },
      {
        onSuccess: () => { setIsOpen(false); toast.success("Lead added"); },
        onError:   (err) => toast.error(err.message),
      },
    );
  };

  const activeFilterCount =
    (catFilter ? 1 : 0) + (stageFilter ? 1 : 0) + (reachability ? 1 : 0)
    + (assigneeFilter ? 1 : 0) + (archivedFilter ? 1 : 0);

  if (isLoading) {
    return <LeadsPageSkeleton view={view} />;
  }

  // "No leads match these filters" is a very believable lie when the request
  // 500s — the user has filters applied and will assume they are the reason.
  if (isError) {
    return <QueryError variant="page" what="your leads" error={error} onRetry={refetch} isRetrying={isRefetching} />;
  }

  return (
    <div className="space-y-4 w-full overflow-hidden -mt-2">
      {/* ── Notion-style header ──────────────────────────────── */}
      <div className="flex items-end justify-between flex-wrap gap-3 pb-1">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-lg">📋</span>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Leads</h1>
          </div>
          {pipelineLoading ? <PipelineStatsSkeleton /> : <PipelineStats pipeline={pipeline} />}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={leads.length === 0}
            // Exports the filtered set shown on screen, matching the filter bar.
            onClick={() => exportCsv("leads", leads, LEAD_CSV_COLUMNS)}
            title={leads.length ? `Export ${leads.length} leads to CSV` : "Nothing to export"}
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Export</span>
          </Button>
          {currentUser?.role === "admin" && <ScrapeLeadsDialog />}
          <CreateLeadDialog
            open={isOpen}
            onOpenChange={setIsOpen}
            users={users}
            onSubmit={handleAdd}
            isPending={createLead.isPending}
          />
        </div>
      </div>

      {/* ── View tabs (Notion-style underline indicator) ────── */}
      <LeadViewTabs view={view} onViewChange={setView} />

      {/* ── Filter bar — Notion-style: search + filter pills + sort ── */}
      <LeadFilterBar
        search={search}
        onSearchChange={setSearch}
        stageFilter={stageFilter}
        onStageFilterChange={setStageFilter}
        catFilter={catFilter}
        onCatFilterChange={setCatFilter}
        reachability={reachability}
        onReachabilityChange={setReachability}
        archivedFilter={archivedFilter}
        onArchivedFilterChange={setArchivedFilter}
        assigneeFilter={assigneeFilter}
        onAssigneeFilterChange={setAssigneeFilter}
        assignees={assignees}
        categories={categories}
        onReset={() => {
          setSearch(""); setCatFilter(""); setStageFilter("");
          setReachability(""); setAssigneeFilter(""); setArchivedFilter("");
        }}
        resultCount={leads.length}
      />

      {/* ── Truncation notice ─────────────────────────────────
          Only ever shown at the safety ceiling. The point is that a list which
          is not the whole list must SAY so — silently showing a subset is the
          bug this page had for months, when 619 leads rendered as 200 cards
          with nothing on screen to suggest anything was missing. */}
      {leadsTruncated(leads) && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Showing the first {LEAD_FETCH_CEILING.toLocaleString()} leads. Narrow the
          filters or search to see the rest.
        </div>
      )}

      {/* ── Content ──────────────────────────────────────── */}
      {view === "kanban" ? (
        <LeadKanban
          leads={leads}
          onSelect={setSelectedId}
          onMove={handleMove}
          stageTotals={unfilteredStageTotals}
        />
      ) : leads.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 bg-muted/10 p-12 text-center">
          <p className="text-sm font-medium text-foreground">No leads match these filters</p>
          <p className="text-xs text-muted-foreground mt-1">
            {search || activeFilterCount > 0
              ? "Try clearing filters or "
              : "Get started by "}
            <button onClick={() => setIsOpen(true)} className="text-primary hover:underline">
              add a new lead
            </button>.
          </p>
        </div>
      ) : (
        <LeadTable
          leads={leads}
          onSelect={setSelectedId}
          selectedIds={selectedIds}
          toggleOne={toggleOne}
          toggleAll={toggleAll}
        />
      )}

      <LeadDetailSheet leadId={selectedId} onClose={closeDetail} />

      {/* Bulk-action floating bar */}
      {selectedIds.size > 0 && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          sequences={enrollableSequences}
          isLoadingSequences={sequencesLoading}
          onEnroll={handleBulkEnroll}
          isEnrolling={bulkEnroll.isPending}
          onEdit={() => setBulkEditOpen(true)}
          isEditing={bulkUpdate.isPending}
          onComment={() => setBulkCommentOpen(true)}
          isCommenting={bulkComment.isPending}
          canDelete={currentUser?.role === "admin"}
          isDeleting={bulkDelete.isPending}
          onDelete={openBulkDelete}
          onClear={clearSelection}
        />
      )}

      <BulkEditDialog
        open={bulkEditOpen}
        onOpenChange={setBulkEditOpen}
        selectedCount={selectedIds.size}
        users={users}
        categories={categories}
        canReassign={currentUser?.role === "admin"}
        isPending={bulkUpdate.isPending}
        onApply={applyBulkEdit}
      />

      <BulkCommentDialog
        open={bulkCommentOpen}
        onOpenChange={setBulkCommentOpen}
        selectedCount={selectedIds.size}
        isPending={bulkComment.isPending}
        onSubmit={applyBulkComment}
      />

      <BulkDeleteDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        deleteCount={deleteCount}
        selectedCount={selectedIds.size}
        isPending={bulkDelete.isPending}
        onConfirm={confirmBulkDelete}
      />
    </div>
  );
}
