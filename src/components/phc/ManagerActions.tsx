// src/components/phc/ManagerActions.tsx
// =============================================================================
// The manager's five actions, at the top of /command-center (2026-10-19):
// call, meetings, email, follow up with the team, approve. Each card shows
// its count and its top three items; the rules are in src/lib/manager-actions.ts.
// Call reuses the page's own attention list; the other four fetch their own
// small read so a failure in one never takes the page down.
// =============================================================================

import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, CalendarDays, CheckSquare, ExternalLink, Mail, Phone, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { useI18n, formatNumber } from "@/lib/i18n";
import { ActionDialog, type DialogField } from "@/components/phc/ActionDialog";
import { isFromToday } from "@/components/phc/DailyEmailBrief";
import type { AttentionItem } from "@/lib/attention";
import { logActivity } from "@/lib/activity-actions";
import { createTask, riyadhDay, teamDay } from "@/lib/daily-tasks";
import { ageDays, fromBafo, fromRecordApproval, type BafoRowIn, type RecordApprovalRowIn } from "@/lib/approvals-center";
import { approvalTypeLabel } from "@/lib/approval-labels";
import { getLatestAgentOutput } from "@/lib/ai-review-actions";
import { upcomingMeetings } from "@/lib/mail-actions";
import {
  ACTIVITY_WINDOW_DAYS,
  approveItems,
  callItems,
  meetingDay,
  teamItems,
  type CallItem,
  type ContactRow,
} from "@/lib/manager-actions";

const SHOWN = 3;
const OUTLOOK_CALENDAR = "https://outlook.office.com/calendar/";

type BriefItem = { activity_id: string; priority: "action" | "important" | "info"; line1: string; line2: string };

function ActionCard({
  icon,
  title,
  count,
  state,
  onRetry,
  empty,
  footer,
  children,
}: {
  icon: ReactNode;
  title: string;
  count: number | null;
  state: "loading" | "error" | "ready";
  onRetry?: () => void;
  empty: string;
  footer: ReactNode;
  children: ReactNode;
}) {
  const { lang } = useI18n();
  return (
    <section aria-label={title} className="flex min-w-0 flex-col rounded-xl border border-border bg-surface p-4">
      <header className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          {icon}
          {title}
        </h3>
        <span className="num text-lg font-semibold leading-none" data-tabular="true">
          {state === "ready" && count !== null ? formatNumber(count, lang) : "—"}
        </span>
      </header>
      <div className="mt-3 flex-1 space-y-2 text-sm">
        {state === "loading" ? (
          <p className="text-muted-foreground">{lang === "ar" ? "جارٍ التحميل…" : "Loading…"}</p>
        ) : state === "error" ? (
          <button type="button" onClick={onRetry} className="text-destructive underline underline-offset-2">
            {lang === "ar" ? "تعذّر التحميل — أعد المحاولة" : "Could not load — try again"}
          </button>
        ) : count === 0 ? (
          <p className="text-muted-foreground">{empty}</p>
        ) : (
          children
        )}
      </div>
      <footer className="mt-3 border-t border-border/70 pt-2 text-xs text-muted-foreground">{footer}</footer>
    </section>
  );
}

// Typed routes: a plain `string` is rejected by TanStack Router's Link.
function ViewAll({ to, label }: { to: "/action-center" | "/my-workspace" | "/approvals"; label: string }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 hover:text-foreground">
      {label} <ArrowRight className="h-3 w-3 rtl:rotate-180" aria-hidden="true" />
    </Link>
  );
}

export function ManagerActions({
  attention,
  stakeholdersByOpp,
  loading,
}: {
  attention: AttentionItem[];
  stakeholdersByOpp: Map<string, ContactRow[]>;
  loading: boolean;
}) {
  const { lang } = useI18n();
  const { user } = useAuth();
  const qc = useQueryClient();
  const uid = user?.id ?? "";
  const today = riyadhDay();
  const ar = lang === "ar";
  const viewAll = ar ? "عرض الكل" : "View all";

  const [callFor, setCallFor] = useState<CallItem | null>(null);
  const [taskFor, setTaskFor] = useState<{ id: string; name: string } | null>(null);

  // ── Call: from the page's own attention list ─────────────────────────────
  const calls = callItems(attention, stakeholdersByOpp, today);

  // ── Meetings: the manager's Outlook calendar ─────────────────────────────
  const meetingsQ = useQuery({ queryKey: ["manager-meetings", uid], enabled: !!uid, staleTime: 5 * 60_000, queryFn: upcomingMeetings });
  const connected = meetingsQ.data?.connected ?? true;

  // ── Email: today's stored brief; never runs the AI from here ─────────────
  const briefQ = useQuery({
    queryKey: ["ai-output", "my_email", uid, "daily_email_brief"],
    enabled: !!uid,
    queryFn: () => getLatestAgentOutput("my_email", uid, "daily_email_brief"),
  });
  const briefToday = isFromToday(briefQ.data?.created_at);
  const briefItems = briefToday
    ? (((briefQ.data?.structured_output ?? null) as { items?: BriefItem[] } | null)?.items ?? [])
    : [];

  // ── Team: counts only, as the team panel shows them ──────────────────────
  const teamQ = useQuery({ queryKey: ["manager-team", today], staleTime: 60_000, queryFn: () => teamDay(today) });
  const team = teamItems(teamQ.data ?? []);

  // ── Approve: pending manager decisions ───────────────────────────────────
  const approveQ = useQuery({
    queryKey: ["manager-decisions-pending"],
    staleTime: 60_000,
    queryFn: async () => {
      const [recs, bafos] = await Promise.all([
        supabase
          .from("approvals")
          .select("*, opportunities(id, project_name, client)")
          .eq("status", "pending")
          .order("created_at", { ascending: true })
          .limit(200),
        supabase.from("bafo_requests").select("*").order("created_at", { ascending: false }).limit(200),
      ]);
      if (recs.error) throw recs.error;
      if (bafos.error) throw bafos.error;
      const bafoRows = (bafos.data ?? []) as unknown as BafoRowIn[];
      const oppIds = [...new Set(bafoRows.map((b) => b.opportunity_id).filter(Boolean) as string[])];
      const names = new Map<string, string | null>();
      if (oppIds.length) {
        const { data: opps } = await supabase.from("opportunities").select("id, project_name").in("id", oppIds);
        for (const o of opps ?? []) names.set(o.id, o.project_name);
      }
      return approveItems([
        ...((recs.data ?? []) as unknown as RecordApprovalRowIn[]).map(fromRecordApproval),
        ...bafoRows.map((b) => fromBafo(b, b.opportunity_id ? names.get(b.opportunity_id) : null)),
      ]);
    },
  });
  const decisions = approveQ.data ?? [];

  const stateOf = (q: { isLoading: boolean; isError: boolean }) =>
    q.isLoading ? "loading" : q.isError ? "error" : "ready";
  const connectOutlook = (
    <Link to="/settings" className="font-medium text-foreground underline underline-offset-2">
      {ar ? "اربط Outlook" : "Connect Outlook"}
    </Link>
  );

  return (
    <section aria-labelledby="manager-actions-title" className="space-y-3">
      <h2 id="manager-actions-title" className="text-xl font-semibold">
        {ar ? "إجراءات اليوم" : "Today's actions"}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {/* Call */}
        <ActionCard
          icon={<Phone className="h-4 w-4" aria-hidden="true" />}
          title={ar ? "اتصال" : "Call"}
          count={calls.length}
          state={loading ? "loading" : "ready"}
          empty={ar ? "لا مشاريع مهمة بلا تواصل" : "No quiet priority deals"}
          footer={<ViewAll to="/action-center" label={viewAll} />}
        >
          {calls.slice(0, SHOWN).map((c) => (
            <div key={c.opportunityId} className="space-y-1">
              <Link to="/opportunities/$id" params={{ id: c.opportunityId }} className="block truncate font-medium hover:underline">
                {c.projectName}
              </Link>
              <p className="truncate text-xs text-muted-foreground">
                {c.contactName ?? (ar ? "لا جهة اتصال مسجلة" : "No contact recorded")} ·{" "}
                {c.quietDays === null
                  ? ar
                    ? `بلا تواصل منذ ${formatNumber(ACTIVITY_WINDOW_DAYS, lang)}+ يومًا`
                    : `quiet ${formatNumber(ACTIVITY_WINDOW_DAYS, lang)}+ days`
                  : ar
                    ? `بلا تواصل منذ ${formatNumber(c.quietDays, lang)} يومًا`
                    : `quiet ${formatNumber(c.quietDays, lang)} days`}
              </p>
              <div className="flex items-center gap-2 text-xs">
                {c.phone ? (
                  <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="num underline underline-offset-2" dir="ltr">
                    {c.phone}
                  </a>
                ) : null}
                <button type="button" onClick={() => setCallFor(c)} className="rounded-md border border-border px-2 py-0.5 hover:text-foreground">
                  {ar ? "سجّل المكالمة" : "Log call"}
                </button>
              </div>
            </div>
          ))}
        </ActionCard>

        {/* Meetings */}
        <ActionCard
          icon={<CalendarDays className="h-4 w-4" aria-hidden="true" />}
          title={ar ? "اجتماعات" : "Meetings"}
          count={connected ? (meetingsQ.data?.events.length ?? 0) : null}
          state={stateOf(meetingsQ)}
          onRetry={() => void meetingsQ.refetch()}
          empty={ar ? "لا اجتماعات اليوم أو غدًا" : "No meetings today or tomorrow"}
          footer={
            connected ? (
              <a href={OUTLOOK_CALENDAR} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
                {ar ? "تقويم Outlook" : "Outlook calendar"} <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            ) : (
              connectOutlook
            )
          }
        >
          {connected ? (
            (meetingsQ.data?.events ?? []).slice(0, SHOWN).map((e) => {
              const day = meetingDay(e.start, today);
              const when = `${day === "today" ? (ar ? "اليوم" : "Today") : ar ? "غدًا" : "Tomorrow"} ${e.start.slice(11, 16)}`;
              const subject = e.subject || (ar ? "(بلا عنوان)" : "(no subject)");
              return (
                <div key={e.id} className="min-w-0">
                  <p className="num text-xs text-muted-foreground" data-tabular="true">{when}</p>
                  {e.webLink ? (
                    <a href={e.webLink} target="_blank" rel="noreferrer" className="block truncate font-medium hover:underline">{subject}</a>
                  ) : (
                    <p className="truncate font-medium">{subject}</p>
                  )}
                  {e.location ? <p className="truncate text-xs text-muted-foreground">{e.location}</p> : null}
                </div>
              );
            })
          ) : (
            <p className="text-muted-foreground">
              {meetingsQ.data?.reconnect
                ? ar ? "انتهى ربط Outlook — أعد الربط من الإعدادات." : "Your Outlook sign-in expired — reconnect in Settings."
                : ar ? "اربط Outlook لترى اجتماعاتك هنا." : "Connect Outlook to see your meetings here."}
            </p>
          )}
        </ActionCard>

        {/* Email */}
        <ActionCard
          icon={<Mail className="h-4 w-4" aria-hidden="true" />}
          title={ar ? "البريد" : "Email"}
          count={briefToday ? briefItems.length : null}
          state={stateOf(briefQ)}
          onRetry={() => void briefQ.refetch()}
          empty={ar ? "لا بريد عملاء يحتاجك اليوم" : "No client email needs you today"}
          footer={connected ? <ViewAll to="/my-workspace" label={viewAll} /> : connectOutlook}
        >
          {briefToday ? (
            briefItems.slice(0, SHOWN).map((i) => (
              <Link key={i.activity_id} to="/my-workspace" className="block min-w-0 hover:underline">
                <p className="truncate font-medium">{i.line1}</p>
                <p className="truncate text-xs text-muted-foreground">{i.line2}</p>
              </Link>
            ))
          ) : (
            <p className="text-muted-foreground">
              {ar ? "افتح مساحتي لتجهيز بريد اليوم." : "Open My Workspace to prepare today's email."}
            </p>
          )}
        </ActionCard>

        {/* Follow up with the team */}
        <ActionCard
          icon={<Users className="h-4 w-4" aria-hidden="true" />}
          title={ar ? "متابعة الفريق" : "Follow up with the team"}
          count={team.length}
          state={stateOf(teamQ)}
          onRetry={() => void teamQ.refetch()}
          empty={ar ? "الفريق على المسار اليوم" : "The team is on track today"}
          footer={<ViewAll to="/my-workspace" label={viewAll} />}
        >
          {team.slice(0, SHOWN).map((r) => (
            <div key={r.user_id} className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{r.full_name ?? "—"}</p>
                <p className="text-xs text-muted-foreground">
                  {r.overdue > 0
                    ? ar ? `${formatNumber(r.overdue, lang)} متأخرة` : `${formatNumber(r.overdue, lang)} overdue`
                    : ar ? `${formatNumber(r.open_due, lang)} مستحقة · لم يُنجز شيء` : `${formatNumber(r.open_due, lang)} due · none done`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTaskFor({ id: r.user_id, name: r.full_name ?? "" })}
                className="shrink-0 rounded-md border border-border px-2 py-0.5 text-xs hover:text-foreground"
              >
                {ar ? "أعطه مهمة" : "Give a task"}
              </button>
            </div>
          ))}
        </ActionCard>

        {/* Approve */}
        <ActionCard
          icon={<CheckSquare className="h-4 w-4" aria-hidden="true" />}
          title={ar ? "اعتماد" : "Approve"}
          count={decisions.length}
          state={stateOf(approveQ)}
          onRetry={() => void approveQ.refetch()}
          empty={ar ? "لا قرارات بانتظارك" : "No decisions waiting for you"}
          footer={<ViewAll to="/approvals" label={ar ? "قرارات المدير" : "Manager decisions"} />}
        >
          {decisions.slice(0, SHOWN).map((a) => {
            const days = ageDays(a.submittedAt);
            return (
              <Link key={`${a.kind}-${a.id}`} to="/approvals" className="block min-w-0 hover:underline">
                <p className="truncate font-medium">{approvalTypeLabel(a.approvalType, lang)}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {a.entityLabel ?? "—"}
                  {days !== null ? ` · ${ar ? `منذ ${formatNumber(days, lang)} يوم` : `${formatNumber(days, lang)}d waiting`}` : ""}
                </p>
              </Link>
            );
          })}
        </ActionCard>
      </div>

      <ActionDialog
        open={callFor !== null}
        onOpenChange={(o) => !o && setCallFor(null)}
        title={ar ? `تسجيل مكالمة — ${callFor?.projectName ?? ""}` : `Log call — ${callFor?.projectName ?? ""}`}
        submitLabel={ar ? "حفظ" : "Save"}
        fields={[{ key: "summary", type: "text", label: ar ? "ما الذي اتُّفق عليه؟" : "What was agreed?" }] satisfies DialogField[]}
        onSubmit={async (v) => {
          if (!callFor) return;
          try {
            await logActivity({ type: "call", summary: v.summary || undefined, opportunityId: callFor.opportunityId });
            toast.success(ar ? "سُجّلت المكالمة" : "Call logged");
            await qc.invalidateQueries({ queryKey: ["cc-core"] });
          } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e));
            throw e;
          }
        }}
      />

      <ActionDialog
        open={taskFor !== null}
        onOpenChange={(o) => !o && setTaskFor(null)}
        title={ar ? `مهمة لـ ${taskFor?.name ?? ""}` : `Task for ${taskFor?.name ?? ""}`}
        submitLabel={ar ? "إسناد" : "Assign"}
        fields={
          [
            { key: "title", type: "text", label: ar ? "المهمة" : "Task", required: true },
            { key: "dueDate", type: "date", label: ar ? "تاريخ الاستحقاق" : "Due date" },
          ] satisfies DialogField[]
        }
        onSubmit={async (v) => {
          if (!taskFor) return;
          try {
            await createTask({ title: v.title, dueDate: v.dueDate || null, ownerId: taskFor.id });
            toast.success(ar ? "أُسندت المهمة" : "Task assigned");
            await qc.invalidateQueries({ queryKey: ["manager-team", today] });
          } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e));
            throw e;
          }
        }}
      />
    </section>
  );
}
