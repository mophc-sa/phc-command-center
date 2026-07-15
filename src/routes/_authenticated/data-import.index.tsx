import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Upload, Plus, FileSpreadsheet, Clock, CheckCircle2,
  Loader2, RefreshCcw, Database, ChevronRight,
} from "lucide-react";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiCard } from "@/components/phc/KpiCard";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonCard } from "@/components/phc/Skeleton";
import { StatusPill } from "@/components/phc/StatusPill";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  createBatch, listBatches, uploadImportFile, parseFile, listSourceProfiles,
  UPLOAD_ROLES, TARGET_ENTITIES,
  type ImportBatch, type ImportTargetEntity, type ImportSourceProfile,
} from "@/lib/import-actions";

export const Route = createFileRoute("/_authenticated/data-import/")({
  head: () => ({ meta: [{ title: "Data Import — PHC" }, { name: "robots", content: "noindex" }] }),
  component: DataImportLanding,
});

// ---------- helpers -----------------------------------------------------------

type StatusTone = "positive" | "attention" | "danger" | "muted" | "neutral";

function statusTone(s: string): StatusTone {
  if (s === "committed") return "positive";
  if (s === "approved" || s === "dry_run") return "attention";
  if (s === "failed" || s === "cancelled") return "danger";
  if (s === "pending_approval" || s === "duplicate_review") return "attention";
  return "neutral";
}

function stepLabel(status: string): string {
  const map: Record<string, string> = {
    uploading: "Uploading…", parsing: "Parsing…",
    needs_mapping: "Map Columns", mapping: "Map Columns",
    validating: "Validating", duplicate_review: "Review Duplicates",
    pending_approval: "Needs Approval", approved: "Approved",
    dry_run: "Dry Run", committed: "Committed",
    failed: "Failed", cancelled: "Cancelled",
  };
  return map[status] ?? status;
}

function isActive(b: ImportBatch) {
  return !["committed", "failed", "cancelled", "archived", "deleted"].includes(b.status);
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// ---------- main component ----------------------------------------------------

function DataImportLanding() {
  const navigate = useNavigate();
  const { hasAnyRole } = useAuth();
  const qc = useQueryClient();
  const canAccess = hasAnyRole([...UPLOAD_ROLES] as any[]);

  const [newOpen, setNewOpen] = useState(false);
  const [newEntity, setNewEntity] = useState<ImportTargetEntity>("companies");
  const [newFile, setNewFile] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: batches = [], isLoading } = useQuery<ImportBatch[]>({
    queryKey: ["import-batches", { includeArchived: false, includeDeleted: false }],
    staleTime: 15_000,
    queryFn: () => listBatches({ includeArchived: false, includeDeleted: false }),
    enabled: canAccess,
    refetchInterval: 30_000,
  });

  const { data: profiles = [] } = useQuery<ImportSourceProfile[]>({
    queryKey: ["import-source-profiles"],
    staleTime: 30_000,
    queryFn: listSourceProfiles,
    enabled: canAccess,
  });

  const active = batches.filter(isActive);
  const processed = batches.filter((b) => !isActive(b));
  const now = new Date();
  const thisMonth = processed.filter((b) => {
    const d = new Date(b.created_at);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const totalRows = batches.reduce((s, b) => s + (b.valid_rows ?? 0), 0);

  async function handleCreate() {
    if (!newFile) { toast.error("Choose a file first"); return; }
    setCreating(true);
    try {
      const batch = await createBatch({ target_entity: newEntity });
      const { fileId } = await uploadImportFile(batch.id, newFile);
      await parseFile(batch.id, fileId);
      setNewOpen(false);
      setNewFile(null);
      qc.invalidateQueries({ queryKey: ["import-batches"] });
      toast.success("File parsed — configure mapping next");
      navigate({ to: "/data-import/$batchId", params: { batchId: batch.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create batch");
    } finally {
      setCreating(false);
    }
  }

  if (!canAccess) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader eyebrow="Data" title="Import Center" description="Upload and map structured data files into PHC." />
        <EmptyState message="You do not have permission to access the import centre." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        eyebrow="Data"
        title="Import Center"
        description="Upload structured files and route them into the PHC data model — companies, contacts, leads, opportunities, and more."
        actions={
          <Button size="sm" onClick={() => setNewOpen(true)} className="flex items-center gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            New Import
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Total Batches" value={batches.length} icon={<Database className="h-4 w-4" />} />
        <KpiCard label="Active" value={active.length} icon={<Clock className="h-4 w-4" />} />
        <KpiCard label="Processed This Month" value={thisMonth.length} icon={<CheckCircle2 className="h-4 w-4" />} />
        <KpiCard label="Total Valid Rows" value={totalRows.toLocaleString()} icon={<FileSpreadsheet className="h-4 w-4" />} />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="active">
        <TabsList className="mb-4">
          <TabsTrigger value="active">
            Active <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[10px]">{active.length}</span>
          </TabsTrigger>
          <TabsTrigger value="recurring">
            Recurring <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[10px]">{profiles.length}</span>
          </TabsTrigger>
          <TabsTrigger value="processed">
            Processed <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[10px]">{processed.length}</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          {isLoading ? (
            <SkeletonCard count={3} />
          ) : active.length === 0 ? (
            <EmptyState
              message="No active imports."
              hint="Start one with New Import above."
              primaryAction={{ label: "New Import", onClick: () => setNewOpen(true) }}
            />
          ) : (
            <div className="space-y-2">
              {active.map((b) => <BatchCard key={b.id} batch={b} />)}
            </div>
          )}
        </TabsContent>

        <TabsContent value="recurring">
          {profiles.length === 0 ? (
            <EmptyState message="No recurring source profiles yet." hint="Source profiles are created automatically when the AI classifies a recurring upload pattern." />
          ) : (
            <div className="space-y-2">
              {profiles.map((p) => <ProfileCard key={p.id} profile={p} />)}
            </div>
          )}
        </TabsContent>

        <TabsContent value="processed">
          {isLoading ? (
            <SkeletonCard count={3} />
          ) : processed.length === 0 ? (
            <EmptyState message="No processed batches yet." />
          ) : (
            <div className="space-y-2">
              {processed.map((b) => <BatchCard key={b.id} batch={b} />)}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* New Import dialog */}
      <Dialog open={newOpen} onOpenChange={(o) => { if (!creating) setNewOpen(o); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Import</DialogTitle>
            <DialogDescription>Upload a .csv or .xlsx file and map it into the PHC data model.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Target entity</Label>
              <Select value={newEntity} onValueChange={(v) => setNewEntity(v as ImportTargetEntity)} disabled={creating}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TARGET_ENTITIES.map((e) => (
                    <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>File</Label>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx"
                className="hidden"
                onChange={(e) => setNewFile(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                disabled={creating}
                onClick={() => fileRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border px-4 py-6 text-xs text-muted-foreground hover:border-emerald-500/40 hover:text-emerald-300 transition-colors"
              >
                {newFile ? (
                  <>
                    <FileSpreadsheet className="h-4 w-4 text-emerald-400" />
                    {newFile.name} ({(newFile.size / 1024).toFixed(0)} KB)
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Click to choose .csv or .xlsx
                  </>
                )}
              </button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setNewOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreate} disabled={creating || !newFile}>
              {creating ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Uploading…</> : "Upload & Continue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- Batch card --------------------------------------------------------

function BatchCard({ batch }: { batch: ImportBatch }) {
  const tone = statusTone(batch.status);
  const label = stepLabel(batch.status);

  return (
    <Link
      to="/data-import/$batchId"
      params={{ batchId: batch.id }}
      className="flex items-center gap-4 rounded-lg border border-border bg-surface px-4 py-3 hover:border-emerald-500/30 transition-colors group"
    >
      <FileSpreadsheet className="h-5 w-5 shrink-0 text-muted-foreground group-hover:text-emerald-400 transition-colors" />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{batch.file_name ?? "Unnamed batch"}</p>
        <p className="text-xs text-muted-foreground">
          {batch.target_entity} · {fmtDate(batch.created_at)}
          {batch.total_rows != null && ` · ${batch.total_rows.toLocaleString()} rows`}
        </p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <StatusPill tone={tone}>{label}</StatusPill>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
      </div>
    </Link>
  );
}

// ---------- Source profile card -----------------------------------------------

function ProfileCard({ profile }: { profile: ImportSourceProfile }) {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-border bg-surface px-4 py-3">
      <RefreshCcw className="h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{profile.name}</p>
        <p className="text-xs text-muted-foreground">
          {profile.source_kind}
          {profile.last_imported_at ? ` · last imported ${fmtDate(profile.last_imported_at)}` : ""}
        </p>
      </div>
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${profile.is_recurring ? "bg-emerald-500/15 text-emerald-400" : "bg-muted text-muted-foreground"}`}>
        {profile.is_recurring ? "recurring" : "one-time"}
      </span>
    </div>
  );
}
