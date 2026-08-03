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
import { useCurrentUser } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  useLeads, useCreateLead, useUpdateLead, useLeadCategories,
  usePipelineSummary, useBulkDeleteLeads,
} from "@/hooks/useCRM";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useUsers } from "@/hooks/useTasks";
import { useSequences, useBulkEnroll } from "@/hooks/useOutreach";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { exportCsv, type CsvColumn } from "@/lib/csv";
import type { ApiLead } from "@/lib/types";

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

  const { data: rawLeads = [], isLoading } = useLeads({
    search:       debouncedSearch || undefined,
    category:     catFilter || undefined,
    stage:        stageFilter || undefined,
    reachability: (reachability as "unreachable" | "reachable" | "") || undefined,
    limit:        200,
  });

  // Pipeline-summary: accurate totals across ALL leads regardless of current filter
  const { data: pipeline = [], isLoading: pipelineLoading } = usePipelineSummary();
  const { data: users    = [] } = useUsers();
  const { data: categories = [] } = useLeadCategories();
  const createLead = useCreateLead();
  const updateLead = useUpdateLead();

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
    createLead.mutate(
      {
        name:        fd.get("name") as string,
        company:     fd.get("company") as string,
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

  const activeFilterCount = (catFilter ? 1 : 0) + (stageFilter ? 1 : 0) + (reachability ? 1 : 0);

  if (isLoading) {
    return <LeadsPageSkeleton view={view} />;
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
        categories={categories}
        onReset={() => { setSearch(""); setCatFilter(""); setStageFilter(""); setReachability(""); }}
        resultCount={leads.length}
      />

      {/* ── Content ──────────────────────────────────────── */}
      {view === "kanban" ? (
        <LeadKanban leads={leads} onSelect={setSelectedId} onMove={handleMove} />
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
          canDelete={currentUser?.role === "admin"}
          isDeleting={bulkDelete.isPending}
          onDelete={openBulkDelete}
          onClear={clearSelection}
        />
      )}

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
