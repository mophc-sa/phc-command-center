import { useI18n } from "@/lib/i18n";
import { draftAgeMinutes } from "@/lib/form-draft";

/** "3 minutes ago" / "2 days ago" -- the age matters more than the timestamp. */
function draftAgeLabel(minutes: number, t: (k: never) => string): string {
  if (minutes < 1) return t("draft_age_now" as never);
  if (minutes < 60) return `${minutes} ${t("draft_age_minutes" as never)}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${t("draft_age_hours" as never)}`;
  return `${Math.floor(hours / 24)} ${t("draft_age_days" as never)}`;
}

/**
 * Never a silent restore. Repopulating a form without saying so is a way to
 * file last week's answers under today's date.
 */
export function DraftRestoredNote({ savedAt, onDiscard }: { savedAt: number; onDiscard: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-amber/40 bg-amber/10 px-3 py-2">
      <span className="text-xs text-foreground">
        {t("draft_restored")}
        {" · "}
        <span className="text-muted-foreground">{draftAgeLabel(draftAgeMinutes(savedAt, Date.now()), t)}</span>
      </span>
      <button
        type="button"
        onClick={onDiscard}
        className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {t("draft_discard")}
      </button>
    </div>
  );
}
