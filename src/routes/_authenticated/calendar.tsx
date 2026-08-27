// =============================================================================
// What this month owes you.
//
// The dates were never missing, only scattered: a follow-up's due date on the
// follow-up, an RFQ's deadline on the RFQ, a next action on the opportunity.
// Answering "what does Thursday look like?" meant opening three pages.
//
// Everything shown is read from those three tables and arranged by
// src/lib/calendar.ts, which computes no new fact. The one write on this
// screen goes through scheduleFollowUp — the same function the rest of the
// app uses — so a follow-up created here is indistinguishable from one
// created anywhere else, and there is no second task system to reconcile.
// =============================================================================

import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiCard } from "@/components/phc/KpiCard";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { StatusPill } from "@/components/phc/StatusPill";
import { Callout } from "@/components/phc/Callout";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { useI18n, localeFor } from "@/lib/i18n";
import { formatMessage } from "@/lib/messages";
import { scheduleFollowUp } from "@/lib/opportunity-actions";
import {
  buildCalendar,
  byDay,
  calendarSummary,
  monthGrid,
  monthOf,
  ymd,
  type CalendarEvent,
} from "@/lib/calendar";

export const Route = createFileRoute("/_authenticated/calendar")({
  component: CalendarPage,
});

const WEEKDAYS = {
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  ar: ["إثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت", "أحد"],
};

/** One tone per state, from the app's semantic vocabulary. */
const STATE_TONE: Record<CalendarEvent["state"], "danger" | "attention" | "neutral" | "muted"> = {
  overdue: "danger",
  due: "attention",
  upcoming: "neutral",
  done: "muted",
};

function CalendarPage() {
  const { t, lang } = useI18n();
  const ar = lang === "ar";
  const qc = useQueryClient();

  // Read once, here, rather than inside the engine — the engine stays pure and
  // testable against any date.
  const today = new Date().toISOString().slice(0, 10);
  const [cursor, setCursor] = useState(() => ({
    y: Number(today.slice(0, 4)),
    m: Number(today.slice(5, 7)),
  }));
  const [selected, setSelected] = useState<string>(today);
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["calendar-sources"],
    staleTime: 60_000,
    queryFn: async () => {
      const [followUps, rfqs, opps] = await Promise.all([
        supabase.from("follow_ups").select("id, opportunity_id, due_date, status, channel"),
        supabase.from("rfqs").select("id, rfq_number, response_due_date, status, opportunity_id"),
        supabase
          .from("opportunities")
          .select("id, project_name, client, next_action, next_action_due, sales_stage"),
      ]);
      return {
        followUps: followUps.data ?? [],
        rfqs: rfqs.data ?? [],
        opportunities: opps.data ?? [],
      };
    },
  });

  const events = useMemo(
    () =>
      buildCalendar({
        today,
        followUps: (data?.followUps ?? []) as never,
        rfqs: (data?.rfqs ?? []) as never,
        opportunities: (data?.opportunities ?? []) as never,
      }),
    [data, today],
  );

  const days = useMemo(() => byDay(events), [events]);
  const summary = useMemo(() => calendarSummary(events), [events]);
  const grid = useMemo(() => monthGrid(cursor.y, cursor.m), [cursor]);
  const selectedEvents = days.get(selected) ?? [];

  const monthLabel = new Date(Date.UTC(cursor.y, cursor.m - 1, 1)).toLocaleDateString(localeFor((ar ? "ar" : "en"), "en"),
    { month: "long", year: "numeric", timeZone: "UTC" },
  );

  const step = (by: number) =>
    setCursor((c) => {
      const m = c.m + by;
      if (m < 1) return { y: c.y - 1, m: 12 };
      if (m > 12) return { y: c.y + 1, m: 1 };
      return { y: c.y, m };
    });

  const openOpportunities = useMemo(
    () =>
      (data?.opportunities ?? [])
        .filter((o: { sales_stage?: string | null }) =>
          !["won", "lost", "archived"].includes((o.sales_stage ?? "").toLowerCase()))
        .map((o: { id: string; project_name?: string | null }) => ({
          value: o.id,
          label: o.project_name ?? o.id.slice(0, 8),
        })),
    [data],
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <PageHeader
        eyebrow={ar ? "التخطيط" : "Planning"}
        title={ar ? "التقويم" : "Calendar"}
        description={
          ar
            ? "المتابعات ومواعيد عروض الأسعار والإجراءات التالية — كل ما له تاريخ، في شبكة واحدة."
            : "Follow-ups, RFQ deadlines and next actions — everything with a date, on one grid."
        }
        actions={
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-xs font-medium text-amber-light hover:bg-amber/20"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {t("cal_new_followup" as never)}
          </button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <KpiCard label={t("cal_overdue" as never)} value={summary.overdue} />
        <KpiCard label={t("cal_today" as never)} value={summary.today} />
        <KpiCard label={t("cal_upcoming" as never)} value={summary.upcoming} />
      </div>

      {summary.overdue > 0 ? (
        <Callout tone="critical" className="mb-5" compact>
          {ar
            ? `${summary.overdue} بندًا فات موعده. المتأخر لا يختفي بمرور الوقت — يزداد فقط.`
            : `${summary.overdue} items are past their date. Late work does not age out; it only accumulates.`}
        </Callout>
      ) : null}

      {isLoading ? (
        <SkeletonTable />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          {/* ---- the month ---- */}
          <div className="rounded-xl border border-border/70 bg-surface/60 p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label={ar ? "الشهر السابق" : "Previous month"}
                className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
              </button>
              <span className="text-base font-medium text-foreground">{monthLabel}</span>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label={ar ? "الشهر التالي" : "Next month"}
                className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground"
              >
                <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1">
              {WEEKDAYS[ar ? "ar" : "en"].map((d) => (
                <div key={d} className="pb-1 text-center text-2xs uppercase tracking-wide text-muted-foreground">
                  {d}
                </div>
              ))}
              {grid.flat().map((day) => {
                const list = days.get(day) ?? [];
                const outside = monthOf(day) !== cursor.m;
                const isToday = day === today;
                const isSelected = day === selected;
                const late = list.some((e) => e.state === "overdue");
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => setSelected(day)}
                    aria-label={day}
                    aria-current={isToday ? "date" : undefined}
                    className={[
                      "min-h-[3.25rem] rounded-md border p-1 text-start transition-colors",
                      outside ? "opacity-40" : "",
                      isSelected ? "border-amber/60 bg-amber/[0.08]" : "border-border/50 hover:bg-surface-2/50",
                      isToday && !isSelected ? "border-border-strong" : "",
                    ].join(" ")}
                  >
                    <span className={`num text-2xs ${isToday ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                      {Number(day.slice(8, 10))}
                    </span>
                    {list.length > 0 ? (
                      <span className="mt-0.5 flex flex-wrap gap-0.5">
                        {/* A dot per item, up to four, then a count. Reading
                            three words in a 50px cell is not reading. */}
                        {list.slice(0, 4).map((e) => (
                          <span
                            key={e.id}
                            className={`h-1.5 w-1.5 rounded-full ${
                              e.state === "overdue" ? "bg-destructive" : e.state === "due" ? "bg-amber" : "bg-info"
                            }`}
                          />
                        ))}
                        {list.length > 4 ? (
                          <span className="num text-2xs text-muted-foreground">+{list.length - 4}</span>
                        ) : null}
                      </span>
                    ) : null}
                    {late && !outside ? <span className="sr-only">{t("cal_overdue" as never)}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ---- the selected day ---- */}
          <div className="rounded-xl border border-border/70 bg-surface/60 p-4">
            <div className="mb-3 flex items-center gap-2">
              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              <span className="num text-base font-medium text-foreground">{selected}</span>
              {selected === today ? <StatusPill tone="attention">{t("cal_today" as never)}</StatusPill> : null}
            </div>

            {selectedEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("cal_nothing" as never)}</p>
            ) : (
              <ul className="space-y-2">
                {selectedEvents.map((e) => (
                  <li key={e.id} className="rounded-lg border border-border/50 px-3 py-2">
                    <div className="mb-1 flex flex-wrap items-center gap-1.5">
                      <StatusPill tone={STATE_TONE[e.state]}>
                        {formatMessage(e.label, (k) => t(k as never), String)}
                      </StatusPill>
                      {e.state === "overdue" ? (
                        <span className="text-2xs text-destructive">{t("cal_overdue" as never)}</span>
                      ) : null}
                    </div>
                    <Link
                      to="/opportunities/$id"
                      params={{ id: e.entityId }}
                      className="block text-sm text-foreground hover:underline"
                    >
                      {e.title || e.context || e.entityId.slice(0, 8)}
                    </Link>
                    {e.context && e.title ? (
                      <span className="text-2xs text-muted-foreground">{e.context}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* The only write on this screen, and it goes through the app's existing
          follow-up creator rather than a second one. */}
      <ActionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t("cal_new_followup" as never)}
        submitLabel={t("crm_add")}
        fields={[
          {
            key: "opportunityId",
            type: "select",
            label: ar ? "الفرصة" : "Opportunity",
            required: true,
            options: openOpportunities,
          },
          { key: "dueDate", type: "date", label: ar ? "التاريخ" : "Date", required: true, defaultValue: selected },
          { key: "notes", type: "textarea", label: ar ? "ملاحظات" : "Notes" },
        ]}
        onSubmit={async (v: Record<string, string>) => {
          await scheduleFollowUp({
            opportunityId: v.opportunityId,
            dueDate: v.dueDate,
            notes: v.notes || undefined,
          });
          toast.success(ar ? "أُضيفت المتابعة" : "Follow-up scheduled");
          await qc.invalidateQueries({ queryKey: ["calendar-sources"] });
          setCreateOpen(false);
        }}
      />
    </div>
  );
}
