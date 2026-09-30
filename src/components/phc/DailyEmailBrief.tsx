// =============================================================================
// My Workspace → Today's email: up to 10 of the person's client emails, most
// important first, each in two lines, linked to its deal.
//
// Made by the daily_email_brief agent the first time the person opens the page
// on a given day (with their own session — no background AI), then kept: every
// later visit that day shows the saved brief at no cost. When there is no new
// client email the agent stops before any AI call. The brief is private to its
// owner (ai_agent_outputs is readable by its requester).
// =============================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Mail, RefreshCw } from "lucide-react";
import { Panel } from "@/components/phc/Panel";
import { StatusPill } from "@/components/phc/StatusPill";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useI18n, localeFor, type StringKey } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { canCreateSalesRecords } from "@/lib/roles";
import { runAiAgent } from "@/lib/ai-orchestrator-actions";
import { getLatestAgentOutput } from "@/lib/ai-review-actions";

const AGENT = "daily_email_brief" as const;
type Item = { activity_id: string; priority: "action" | "important" | "info"; line1: string; line2: string };
type Brief = { items: Item[]; missing_information: string[] };

const TONE = { action: "danger", important: "attention", info: "muted" } as const;
const LABEL: Record<Item["priority"], StringKey> = {
  action: "brief_priority_action",
  important: "brief_priority_important",
  info: "brief_priority_info",
};

/** The brief was made on the viewer's current calendar day. */
export function isFromToday(iso: string | null | undefined, now = new Date()): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export function DailyEmailBrief() {
  const { t, lang } = useI18n();
  const { user, roles } = useAuth();
  const qc = useQueryClient();
  const uid = user?.id ?? "";
  const allowed = Boolean(uid) && canCreateSalesRecords(roles);
  const key = ["ai-output", "my_email", uid, AGENT];
  const [running, setRunning] = useState(false);
  const [empty, setEmpty] = useState(false);
  const tried = useRef(false);

  const outputQ = useQuery({ queryKey: key, queryFn: () => getLatestAgentOutput("my_email", uid, AGENT), enabled: allowed });
  const brief = (outputQ.data?.structured_output ?? null) as Brief | null;
  const today = isFromToday(outputQ.data?.created_at);

  const ids = useMemo(() => (brief?.items ?? []).map((i) => i.activity_id), [brief]);
  const linksQ = useQuery({
    queryKey: ["brief-links", ids],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("activities")
        .select("id, related_opportunity_id, occurred_at, opportunities(project_name)").in("id", ids);
      return new Map((data ?? []).map((a) => [a.id, a]));
    },
  });

  // New client email since the brief, in the person's own mailbox.
  const newerQ = useQuery({
    queryKey: ["brief-newer", uid, outputQ.data?.created_at],
    enabled: allowed && Boolean(outputQ.data?.created_at),
    queryFn: async () => {
      const { count } = await supabase.from("activities").select("id", { count: "exact", head: true })
        .eq("owner_id", uid).in("activity_type", ["email_received"]).gt("created_at", outputQ.data!.created_at);
      return count ?? 0;
    },
  });

  async function make() {
    setRunning(true);
    try {
      const r = await runAiAgent({ agent: AGENT, entityType: "my_email", entityId: uid, input: { language: lang } });
      if (!r.ok) {
        if (r.code === "AI_INPUT_INVALID") setEmpty(true);
        else throw new Error(r.message);
      } else {
        setEmpty(false);
        await qc.invalidateQueries({ queryKey: key });
      }
    } catch (e) {
      toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
    } finally {
      setRunning(false);
    }
  }

  // First visit of the day: make today's brief once, with the person's session.
  useEffect(() => {
    if (!allowed || outputQ.isLoading || outputQ.isError || today || tried.current) return;
    tried.current = true;
    void make();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per mount when no brief exists today
  }, [allowed, outputQ.isLoading, outputQ.isError, today]);

  if (!allowed) return null;

  const newer = newerQ.data ?? 0;
  const items = today && brief ? brief.items : [];

  return (
    <Panel
      title={t("brief_title")}
      subtitle={today && outputQ.data ? `${t("brief_made")} ${new Date(outputQ.data.created_at).toLocaleTimeString(localeFor(lang), { timeStyle: "short" })}` : t("brief_subtitle")}
      action={
        today && newer > 0 ? (
          <Button size="sm" variant="outline" onClick={make} disabled={running}>
            <RefreshCw className={`me-1.5 h-3.5 w-3.5 ${running ? "animate-spin" : ""}`} />
            {newer} {t("brief_newer")}
          </Button>
        ) : null
      }
    >
      {running && !today ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" /> {t("brief_preparing")}
        </p>
      ) : items.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Mail className="h-3.5 w-3.5" /> {empty || today ? t("brief_empty") : t("brief_preparing")}
        </p>
      ) : (
        <ol className="divide-y divide-border">
          {items.map((it) => {
            const a = linksQ.data?.get(it.activity_id) as
              | { related_opportunity_id: string | null; opportunities: { project_name: string | null } | null }
              | undefined;
            const oppId = a?.related_opportunity_id ?? null;
            const name = a?.opportunities?.project_name ?? null;
            return (
              <li key={it.activity_id} className="flex gap-3 py-2.5">
                <StatusPill tone={TONE[it.priority]} className="h-fit shrink-0">{t(LABEL[it.priority])}</StatusPill>
                <div className="min-w-0 flex-1 space-y-0.5">
                  {oppId ? (
                    <Link to="/opportunities/$id" params={{ id: oppId }} className="text-xs font-semibold text-foreground hover:underline" dir="auto">
                      {name ?? t("brief_deal")}
                    </Link>
                  ) : (
                    <span className="text-xs font-semibold text-muted-foreground">{t("brief_no_deal")}</span>
                  )}
                  <p dir="auto" className="text-sm text-foreground">{it.line1}</p>
                  <p dir="auto" className="text-sm text-muted-foreground">{it.line2}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
