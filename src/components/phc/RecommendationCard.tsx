import { useI18n } from "@/lib/i18n";
import { StatusPill } from "./StatusPill";
import { humanize } from "@/lib/utils";

export type RecommendationRow = {
  id: string;
  agent_module: string;
  recommendation: string;
  reason: string | null;
  evidence: string | null;
  data_sources: string | null;
  confidence_score: number | null;
  risk_notes: string | null;
  required_approval_type: string | null;
  status: string;
};

// Renders the fixed 8-field recommendation shape (section 9). Optional actions
// let the suggested owner or a manager accept (opens an approval) or dismiss it.
export function RecommendationCard({
  rec,
  onAccept,
  onDismiss,
  ownerName,
}: {
  rec: RecommendationRow;
  onAccept?: () => void;
  onDismiss?: () => void;
  ownerName?: string;
}) {
  const { t } = useI18n();
  const conf = rec.confidence_score;
  const confTone = conf == null ? "muted" : conf >= 75 ? "positive" : conf >= 50 ? "neutral" : "attention";

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusPill tone="muted">{humanize(rec.agent_module)}</StatusPill>
        <div className="flex items-center gap-2">
          {conf != null ? <StatusPill tone={confTone as never}>{t("rec_confidence")}: {conf}%</StatusPill> : null}
          {rec.required_approval_type ? (
            <StatusPill tone="attention">{t(`approval_type_${rec.required_approval_type}` as never)}</StatusPill>
          ) : null}
        </div>
      </div>

      <div className="mt-3 text-sm font-medium text-foreground">{rec.recommendation}</div>

      <dl className="mt-3 grid gap-2 text-xs">
        {rec.reason ? <Field label={t("rec_reason")} value={rec.reason} /> : null}
        {rec.evidence ? <Field label={t("rec_evidence")} value={rec.evidence} /> : null}
        {rec.data_sources ? <Field label={t("rec_data_sources")} value={rec.data_sources} /> : null}
        {rec.risk_notes ? <Field label={t("rec_risk_notes")} value={rec.risk_notes} /> : null}
        {ownerName ? <Field label={t("rec_suggested_owner")} value={ownerName} /> : null}
      </dl>

      {(onAccept || onDismiss) && rec.status === "pending" ? (
        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">{t("rec_disclaimer")}</span>
          <div className="flex gap-2">
            {onDismiss ? (
              <button onClick={onDismiss} className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground">
                {t("rec_dismiss")}
              </button>
            ) : null}
            {onAccept ? (
              <button onClick={onAccept} className="rounded-md border border-won/30 bg-won/10 px-2.5 py-1 text-xs text-won hover:bg-won/[0.15]">
                {t("rec_accept")}
              </button>
            ) : null}
          </div>
        </div>
      ) : rec.status !== "pending" ? (
        <div className="mt-3">
          <StatusPill tone={rec.status === "dismissed" ? "muted" : "positive"}>{humanize(rec.status)}</StatusPill>
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-foreground">{value}</dd>
    </div>
  );
}
