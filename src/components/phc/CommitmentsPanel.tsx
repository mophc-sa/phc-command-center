// =============================================================================
// Commitments, inside the deal they belong to (Phase 9).
//
// Not a standalone page, for the same reason DocumentsPanel is not: a promise
// only means anything next to the deal it was made on. The cross-deal view a
// person does need — "what have I promised that is now late" — lives in My
// Workspace, where the day starts.
//
// DIRECTION IS THE WHOLE POINT
// ----------------------------
// The two lists are kept visually apart because they are different problems. A
// promise we broke is ours to fix today; a client who has gone quiet is a
// chase. Merging them into one "overdue" count is exactly how neither gets
// done, so this panel never shows a combined total.
//
// WHAT IS DELIBERATELY ABSENT
// ---------------------------
// There is no edit control. A commitment's terms are immutable in the database
// once made — rewriting the promise after the fact is how a missed commitment
// becomes a met one — so offering an edit button would only produce an error.
// Closing is the only state change, and it is one-way.
// =============================================================================

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Handshake, ArrowUpRight, ArrowDownLeft, Plus, Check } from "lucide-react";
import { Panel } from "@/components/phc/Panel";
import { EmptyState } from "@/components/phc/EmptyState";
import { StatusPill } from "@/components/phc/StatusPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import {
  closeCommitment, commitmentUrgency, createCommitment, listCommitments,
  sortCommitments, summariseCommitments,
  type Commitment, type CommitmentDirection, type CommitmentStatus, type CommitmentUrgency,
} from "@/lib/commitment-actions";

const URGENCY_TONE: Record<CommitmentUrgency, "danger" | "attention" | "neutral" | "muted"> = {
  overdue: "danger",
  today: "attention",
  soon: "attention",
  later: "neutral",
  closed: "muted",
};

const STATUS_TONE: Record<CommitmentStatus, "positive" | "danger" | "muted" | "neutral"> = {
  open: "neutral",
  met: "positive",
  missed: "danger",
  waived: "muted",
  cancelled: "muted",
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function CommitmentsPanel({
  opportunityId,
  companyId,
}: {
  opportunityId: string;
  companyId?: string | null;
}) {
  const { lang } = useI18n();
  const qc = useQueryClient();
  const ar = lang === "ar";

  const [adding, setAdding] = useState(false);
  const [direction, setDirection] = useState<CommitmentDirection>("we_owe_client");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState(todayIso());
  const [closing, setClosing] = useState<string | null>(null);
  const [closeNote, setCloseNote] = useState("");

  const key = ["commitments", opportunityId];
  const { data: rows = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: () => listCommitments(opportunityId),
  });

  const sorted = useMemo(() => sortCommitments(rows), [rows]);
  const summary = useMemo(() => summariseCommitments(rows), [rows]);

  const create = useMutation({
    mutationFn: () =>
      createCommitment({ opportunityId, direction, description, dueDate, companyId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      setAdding(false);
      setDescription("");
      setDueDate(todayIso());
      toast.success(ar ? "تم تسجيل الالتزام" : "Commitment recorded");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const close = useMutation({
    mutationFn: (input: { id: string; status: Exclude<CommitmentStatus, "open"> }) =>
      closeCommitment({ id: input.id, opportunityId, status: input.status, note: closeNote }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      setClosing(null);
      setCloseNote("");
      toast.success(ar ? "تم إغلاق الالتزام" : "Commitment closed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const weOwe = sorted.filter((c) => c.direction === "we_owe_client");
  const theyOwe = sorted.filter((c) => c.direction === "client_owes_us");

  return (
    <Panel
      title={ar ? "الالتزامات" : "Commitments"}
      subtitle={
        summary.open === 0
          ? undefined
          : ar
            ? `${summary.weOwe} علينا · ${summary.theyOwe} عليهم${summary.overdue ? ` · ${summary.overdue} متأخر` : ""}`
            : `${summary.weOwe} ours · ${summary.theyOwe} theirs${summary.overdue ? ` · ${summary.overdue} overdue` : ""}`
      }
      tone={summary.overdue > 0 ? "attention" : "default"}
      action={
        <Button size="sm" variant="outline" onClick={() => setAdding((v) => !v)}>
          <Plus className="size-4" />
          {ar ? "التزام" : "Commitment"}
        </Button>
      }
    >
      {adding ? (
        <div className="mb-4 space-y-3 rounded-lg border bg-surface-2/40 p-3">
          <div className="flex flex-wrap gap-2">
            {(["we_owe_client", "client_owes_us"] as const).map((d) => (
              <Button
                key={d}
                size="sm"
                variant={direction === d ? "default" : "outline"}
                onClick={() => setDirection(d)}
              >
                {d === "we_owe_client"
                  ? ar ? "نحن نلتزم" : "We owe the client"
                  : ar ? "العميل يلتزم" : "Client owes us"}
              </Button>
            ))}
          </div>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={ar ? "ما الذي وُعد به؟" : "What was promised?"}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-44"
            />
            <Button
              size="sm"
              disabled={!description.trim() || create.isPending}
              onClick={() => create.mutate()}
            >
              {ar ? "تسجيل" : "Record"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              {ar ? "إلغاء" : "Cancel"}
            </Button>
          </div>
          {/* Said once, here, rather than discovered as an error later. */}
          <p className="text-xs text-muted-foreground">
            {ar
              ? "لا يمكن تعديل نص الالتزام أو تاريخه بعد التسجيل."
              : "What was promised and when cannot be edited afterwards."}
          </p>
        </div>
      ) : null}

      {isLoading ? null : rows.length === 0 ? (
        <EmptyState
          icon={Handshake}
          title={ar ? "لا توجد التزامات" : "No commitments yet"}
          description={
            ar
              ? "سجّل ما وُعد به العميل وما وعد به — بتاريخ."
              : "Record what was promised to the client, and what they promised back — with a date."
          }
        />
      ) : (
        <div className="space-y-5">
          <CommitmentGroup
            heading={ar ? "علينا" : "We owe the client"}
            icon={<ArrowUpRight className="size-4" />}
            rows={weOwe}
            ar={ar}
            closing={closing}
            closeNote={closeNote}
            onStartClose={(id) => { setClosing(id); setCloseNote(""); }}
            onCancelClose={() => setClosing(null)}
            onNote={setCloseNote}
            onClose={(id, status) => close.mutate({ id, status })}
            busy={close.isPending}
          />
          <CommitmentGroup
            heading={ar ? "على العميل" : "Client owes us"}
            icon={<ArrowDownLeft className="size-4" />}
            rows={theyOwe}
            ar={ar}
            closing={closing}
            closeNote={closeNote}
            onStartClose={(id) => { setClosing(id); setCloseNote(""); }}
            onCancelClose={() => setClosing(null)}
            onNote={setCloseNote}
            onClose={(id, status) => close.mutate({ id, status })}
            busy={close.isPending}
          />
        </div>
      )}
    </Panel>
  );
}

function CommitmentGroup({
  heading, icon, rows, ar, closing, closeNote, onStartClose, onCancelClose, onNote, onClose, busy,
}: {
  heading: string;
  icon: React.ReactNode;
  rows: Commitment[];
  ar: boolean;
  closing: string | null;
  closeNote: string;
  onStartClose: (id: string) => void;
  onCancelClose: () => void;
  onNote: (v: string) => void;
  onClose: (id: string, status: Exclude<CommitmentStatus, "open">) => void;
  busy: boolean;
}) {
  if (rows.length === 0) return null;

  return (
    <div>
      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {heading}
      </h4>
      <ul className="space-y-2">
        {rows.map((c) => {
          const urgency = commitmentUrgency(c);
          return (
            <li key={c.id} className="rounded-lg border bg-surface-2/30 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{c.description}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <StatusPill tone={URGENCY_TONE[urgency]}>
                      {c.due_date}
                      {urgency === "overdue" ? (ar ? " · متأخر" : " · overdue") : ""}
                      {urgency === "today" ? (ar ? " · اليوم" : " · today") : ""}
                    </StatusPill>
                    {c.status !== "open" ? (
                      <StatusPill tone={STATUS_TONE[c.status]}>{c.status}</StatusPill>
                    ) : null}
                  </div>
                  {c.outcome_note ? (
                    <p className="mt-1.5 text-xs text-muted-foreground">{c.outcome_note}</p>
                  ) : null}
                </div>

                {c.status === "open" && closing !== c.id ? (
                  <Button size="sm" variant="outline" onClick={() => onStartClose(c.id)}>
                    <Check className="size-4" />
                    {ar ? "إغلاق" : "Close"}
                  </Button>
                ) : null}
              </div>

              {closing === c.id ? (
                <div className="mt-3 space-y-2 border-t pt-3">
                  <Input
                    value={closeNote}
                    onChange={(e) => onNote(e.target.value)}
                    placeholder={ar ? "ماذا حدث؟" : "What happened?"}
                  />
                  <div className="flex flex-wrap gap-2">
                    {(["met", "missed", "waived", "cancelled"] as const).map((s) => (
                      <Button
                        key={s}
                        size="sm"
                        variant={s === "met" ? "default" : "outline"}
                        disabled={busy || (s === "waived" && !closeNote.trim())}
                        onClick={() => onClose(c.id, s)}
                      >
                        {s}
                      </Button>
                    ))}
                    <Button size="sm" variant="ghost" onClick={onCancelClose}>
                      {ar ? "إلغاء" : "Cancel"}
                    </Button>
                  </div>
                  {/* The database refuses a waiver with no reason; saying so
                      here turns a rejected write into a disabled button. */}
                  <p className="text-xs text-muted-foreground">
                    {ar
                      ? "الإعفاء يتطلب سببًا. الإغلاق نهائي."
                      : "Waiving requires a reason. Closing is final."}
                  </p>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
