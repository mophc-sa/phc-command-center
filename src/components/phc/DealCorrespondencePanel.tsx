// =============================================================================
// Opportunity page → Correspondence: the deal's email, and an AI summary of it.
//
// The emails come from Outlook capture and sends from the system (activities
// on this deal). The summary is deal_correspondence_summary, run through the
// orchestrator only when someone presses the button; it is advice, changes
// nothing, and every point links to the email it came from. When newer email
// has arrived since it was made, the panel says so and offers a refresh — no
// AI runs in the background.
//
// Who sees what follows the deal: activities by can_read_activity, the summary
// by 20261004100000 (can_read_boq). Running it needs a sales role.
// =============================================================================

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDownLeft, ArrowUpRight, RefreshCw, Sparkles } from "lucide-react";
import { Panel } from "@/components/phc/Panel";
import { StatusPill } from "@/components/phc/StatusPill";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useI18n, localeFor } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { canCreateSalesRecords } from "@/lib/roles";
import { runAiAgent } from "@/lib/ai-orchestrator-actions";
import { getLatestAgentOutput } from "@/lib/ai-review-actions";

type Email = {
  id: string;
  activity_type: string;
  status: string;
  occurred_at: string;
  created_at: string;
  summary: string | null;
  draft_content: string | null;
  email_from: string | null;
  email_to: string | null;
};

type Cited = { text: string; source_ids: string[] };
type Summary = {
  current_status: string;
  client_asked: Cited[];
  we_owe: Cited[];
  next_step: Cited | null;
  missing_information: string[];
  confidence: number;
};

const AGENT = "deal_correspondence_summary" as const;

export function DealCorrespondencePanel({ opportunityId }: { opportunityId: string }) {
  const { t, lang } = useI18n();
  const { roles } = useAuth();
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const outputKey = ["ai-output", "opportunities", opportunityId, AGENT];

  const emailsQ = useQuery({
    queryKey: ["deal-emails", opportunityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activities")
        .select("id, activity_type, status, occurred_at, created_at, summary, draft_content, email_from, email_to")
        .eq("related_opportunity_id", opportunityId)
        .in("activity_type", ["email_received", "email_draft"])
        .order("occurred_at", { ascending: false })
        .limit(40);
      if (error) throw error;
      // Unsent drafts are not correspondence.
      return ((data ?? []) as Email[]).filter((e) => e.activity_type === "email_received" || e.status === "sent");
    },
  });
  const outputQ = useQuery({ queryKey: outputKey, queryFn: () => getLatestAgentOutput("opportunities", opportunityId, AGENT) });

  const emails = useMemo(() => emailsQ.data ?? [], [emailsQ.data]);
  const byId = useMemo(() => new Map(emails.map((e) => [e.id, e])), [emails]);
  const output = outputQ.data;
  const summary = (output?.structured_output ?? null) as Summary | null;
  const newer = output ? emails.filter((e) => Date.parse(e.created_at) > Date.parse(output.created_at)).length : 0;
  const canRun = canCreateSalesRecords(roles) && emails.length > 0;
  const fmt = (iso: string) => new Date(iso).toLocaleDateString(localeFor(lang), { dateStyle: "medium" });

  async function run() {
    setRunning(true);
    try {
      const r = await runAiAgent({ agent: AGENT, entityType: "opportunities", entityId: opportunityId, input: { language: lang } });
      if (!r.ok) throw new Error(r.message);
      await qc.invalidateQueries({ queryKey: outputKey });
    } catch (e) {
      toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
    } finally {
      setRunning(false);
    }
  }

  function showSource(id: string) {
    setOpen(id);
    requestAnimationFrame(() => document.getElementById(`deal-email-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  const sources = (ids: string[]) => (
    <span className="ms-1 inline-flex flex-wrap gap-1 align-middle">
      {ids.filter((id) => byId.has(id)).map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => showSource(id)}
          className="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {fmt(byId.get(id)!.occurred_at)}
        </button>
      ))}
    </span>
  );

  const list = (title: string, items: Cited[]) =>
    items.length ? (
      <div className="space-y-1">
        <div className="text-xs font-semibold text-muted-foreground">{title}</div>
        <ul className="space-y-1.5 ps-4 text-sm text-foreground [list-style:disc]">
          {items.map((c, i) => (
            <li key={i} dir="auto">{c.text}{sources(c.source_ids)}</li>
          ))}
        </ul>
      </div>
    ) : null;

  return (
    <Panel
      title={t("corr_title")}
      subtitle={t("corr_subtitle")}
      action={
        canRun ? (
          <Button size="sm" variant={summary && newer === 0 ? "outline" : "default"} onClick={run} disabled={running}>
            {running ? <RefreshCw className="me-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="me-1.5 h-3.5 w-3.5" />}
            {running ? t("corr_running") : summary ? t("corr_refresh") : t("corr_summarise")}
          </Button>
        ) : null
      }
    >
      {emails.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("corr_empty")}</p>
      ) : (
        <div className="space-y-5">
          {summary ? (
            <section className="space-y-3 rounded-lg border border-border/70 bg-muted/30 p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <StatusPill tone="muted">{t("corr_ai_label")}</StatusPill>
                <span>{t("corr_made")} {fmt(output!.created_at)}</span>
                {newer > 0 ? <StatusPill tone="attention">{newer} {t("corr_newer")}</StatusPill> : null}
              </div>
              <p dir="auto" className="text-sm text-foreground">{summary.current_status}</p>
              {list(t("corr_client_asked"), summary.client_asked)}
              {list(t("corr_we_owe"), summary.we_owe)}
              {summary.next_step ? list(t("corr_next_step"), [summary.next_step]) : null}
              {summary.missing_information.length ? (
                <p dir="auto" className="text-xs text-muted-foreground">
                  {t("corr_unclear")}: {summary.missing_information.join(" · ")}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">{t("corr_disclaimer")}</p>
            </section>
          ) : null}

          <ul className="divide-y divide-border rounded-lg border border-border">
            {emails.map((e) => {
              const inbound = e.activity_type === "email_received";
              const Icon = inbound ? ArrowDownLeft : ArrowUpRight;
              const expanded = open === e.id;
              return (
                <li key={e.id} id={`deal-email-${e.id}`}>
                  <button
                    type="button"
                    onClick={() => setOpen(expanded ? null : e.id)}
                    aria-expanded={expanded}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-start hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label={inbound ? t("corr_from_client") : t("corr_from_phc")} />
                    <span dir="auto" className="min-w-0 flex-1 truncate text-sm text-foreground">{e.summary || "—"}</span>
                    <span dir="ltr" className="hidden max-w-[14rem] truncate text-xs text-muted-foreground sm:inline">
                      {inbound ? e.email_from : e.email_to}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{fmt(e.occurred_at)}</span>
                  </button>
                  {expanded ? (
                    <div dir="auto" className="whitespace-pre-wrap border-t border-border/60 bg-muted/20 px-4 py-3 text-sm text-foreground">
                      {e.draft_content || t("corr_no_text")}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Panel>
  );
}
