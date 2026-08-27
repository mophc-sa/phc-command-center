// =============================================================================
// My Workspace — "What needs you today" (Phase 4).
//
// One ranked, role-aware list answering the PRD's first question: what do I
// need to do today? It reads the same unified projection the Action Center
// uses (src/lib/action-center.ts), so the two can never disagree about what is
// overdue or blocking — they are the same computation, shown at two depths.
//
// Deliberately NOT a dashboard: no charts, no team totals, capped at a handful
// of rows, and every row deep-links to the record it is about. The analytics
// belong on Command Center and Reports.
// =============================================================================

import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CheckCircle2, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { useI18n } from "@/lib/i18n";
import { StatusPill } from "@/components/phc/StatusPill";
import { canApproveCommercialAction, canReviewIntake } from "@/lib/roles";
import {
  assembleActions,
  todaysWork,
  urgencyOf,
  type ApprovalRowIn,
  type FlagRowIn,
  type FollowUpRowIn,
  type IntakeRowIn,
  type TaskRowIn,
} from "@/lib/action-center";
import { humanize } from "@/lib/utils";

export function TodayPanel({ uid }: { uid: string }) {
  const { t, lang } = useI18n();
  const { roles } = useAuth();
  const today = new Date().toISOString().slice(0, 10);

  const { data: sources } = useQuery({
    queryKey: ["today-panel", uid],
    enabled: !!uid,
    staleTime: 60_000,
    queryFn: async () => {
      const [flags, tasks, followUps, approvals, intake] = await Promise.all([
        supabase
          .from("opportunity_flags")
          .select("*")
          .in("status", ["open", "in_progress", "escalated", "blocked"])
          .order("due_date", { ascending: true })
          .limit(100),
        supabase
          .from("tasks")
          .select("id, title, related_opportunity_id, owner_id, priority, due_date, status, created_at, completed_at")
          .eq("owner_id", uid)
          .neq("status", "done")
          .limit(100),
        supabase
          .from("follow_ups")
          .select("id, opportunity_id, owner_id, due_date, cadence_tier, channel, status, notes, created_at")
          .eq("owner_id", uid)
          .neq("status", "completed")
          .neq("status", "cancelled")
          .limit(100),
        supabase
          .from("approvals")
          .select(
            "id, approval_type, related_opportunity_id, linked_record_type, linked_record_id, requested_by, assigned_approver, status, created_at, decided_at",
          )
          .eq("status", "pending")
          .limit(100),
        supabase
          .from("inbox_items")
          .select(
            "id, project_name, company_name, review_state, assigned_owner_id, created_by, request_type, info_due_date, info_responsible_id, created_at, reviewed_at",
          )
          .in("review_state", ["pending_review", "need_information"])
          .limit(100),
      ]);
      return {
        flags: (flags.data ?? []) as unknown as FlagRowIn[],
        tasks: (tasks.data ?? []) as unknown as TaskRowIn[],
        followUps: (followUps.data ?? []) as unknown as FollowUpRowIn[],
        approvals: (approvals.data ?? []) as unknown as ApprovalRowIn[],
        intake: (intake.data ?? []) as unknown as IntakeRowIn[],
      };
    },
  });

  const items = useMemo(() => {
    const all = assembleActions(
      sources ?? {},
      {
        canReviewIntake: canReviewIntake(roles),
        canDecideApprovals: canApproveCommercialAction(roles),
      },
      today,
    );
    return todaysWork(all, { uid, today });
  }, [sources, roles, uid, today]);

  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-border/70 bg-surface/60">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">{t("ws_today_title")}</h2>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{t("ws_today_desc")}</p>
        </div>
        <Link
          to="/action-center"
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border/70 bg-background/40 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("ws_today_all")}
          <ArrowRight className="h-3 w-3 rtl:rotate-180" />
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
          <CheckCircle2 className="h-8 w-8 text-won/40" strokeWidth={1.5} aria-hidden="true" />
          <p className="text-base font-medium text-foreground">{t("ws_today_empty")}</p>
        </div>
      ) : (
        <ul>
          {items.map((a) => {
            const urgency = urgencyOf(a.dueAt, today);
            const overdue = urgency === "overdue";
            return (
              <li key={a.id} className="border-t border-border/60 first:border-t-0">
                <Link to={a.href as never} className="block px-5 py-3 transition-colors hover:bg-surface-2/40">
                  <div className="flex flex-wrap items-center gap-2">
                    {a.blocking ? (
                      <StatusPill tone="danger">
                        <ShieldAlert className="h-3 w-3" />
                        {lang === "ar" ? "معطِّل" : "Blocking"}
                      </StatusPill>
                    ) : null}
                    {overdue ? (
                      <StatusPill tone="danger">
                        <AlertTriangle className="h-3 w-3" />
                        {t("ac_urgency_overdue")}
                      </StatusPill>
                    ) : urgency === "due_today" ? (
                      <StatusPill tone="attention">{t("ac_urgency_due_today")}</StatusPill>
                    ) : null}
                    <span className="truncate text-base font-medium text-foreground">{a.title}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    {/* Why it is here — the PRD requires every row to justify itself. */}
                    <span>{a.reason ?? humanize(a.type)}</span>
                    {a.dueAt ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className={`num ${overdue ? "text-destructive" : ""}`} data-tabular="true">
                          {t("ac_due")}: {a.dueAt}
                        </span>
                      </>
                    ) : null}
                    <span aria-hidden="true">·</span>
                    <span>
                      {t("label_tier")} {a.priority}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
