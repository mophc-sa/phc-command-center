import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  checkReconciliationManifest,
  previewHistoricalReconciliation,
  reconcileHistoricalRows,
  type LegacyPreview,
} from "@/lib/historical-reconciliation";

export function HistoricalReconciliationPanel({ ar }: { ar: boolean }) {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<LegacyPreview | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function check() {
    setBusy(true);
    setPreview(null);
    setErrors([]);
    setMessage("");
    try {
      const result = await previewHistoricalReconciliation();
      const differences = checkReconciliationManifest(result);
      setErrors(differences);
      if (!differences.length) setPreview(result);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)]);
    } finally {
      setBusy(false);
    }
  }
  async function run() {
    if (!preview || checkReconciliationManifest(preview).length) return;
    setBusy(true);
    setErrors([]);
    try {
      const result = await reconcileHistoricalRows(preview.records, (done, total) =>
        setMessage(ar ? `معالجة ${done} من ${total}` : `Reconciling ${done} of ${total}`),
      );
      setMessage(
        ar
          ? `اكتملت المعالجة: ${result.records} سجل · ${result.archived} نسخة قديمة مؤرشفة`
          : `Reconciliation complete: ${result.records} records · ${result.archived} legacy copies archived`,
      );
      setPreview(null);
      await queryClient.invalidateQueries();
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)]);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="rounded-lg border border-border bg-surface-1 p-3 space-y-2"
      aria-label={ar ? "مطابقة الاستيراد القديم" : "Legacy import reconciliation"}
    >
      <p className="text-sm font-medium">
        {ar ? "مطابقة الفرص مع الاستيراد القديم" : "Reconcile opportunities with the legacy import"}
      </p>
      <p className="text-xs text-muted-foreground">
        {ar
          ? "تُحفظ النسخ القديمة وملاحظاتها، وتُؤرشف النسخ المتطابقة التي لا تحتوي على عمل مستقل لمنع احتساب الفرصة مرتين. لا حذف نهائي ولا تغيير لحالات الفوز والخسارة."
          : "Preserve legacy records and notes, and archive exact duplicate copies with no independent work so each opportunity is counted once. No permanent deletion or changes to won/lost outcomes."}
      </p>
      <button
        type="button"
        onClick={check}
        disabled={busy}
        className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
      >
        {ar ? "فحص المطابقة" : "Check reconciliation"}
      </button>
      {preview && preview.records.length > 0 ? (
        <div className="text-xs space-y-2">
          <p>
            {ar
              ? `${new Set(preview.records.map((r) => r.row_id)).size} فرصة · ${preview.records.length} نسخة قديمة متطابقة · ${preview.completed.length} نسخة عولجت سابقًا`
              : `${new Set(preview.records.map((r) => r.row_id)).size} opportunities · ${preview.records.length} exact legacy copies · ${preview.completed.length} copies already reconciled`}
          </p>
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="rounded bg-primary px-2 py-1 text-primary-foreground disabled:opacity-50"
          >
            {ar ? "تأكيد معالجة التكرار" : "Confirm reconciliation"}
          </button>
        </div>
      ) : preview ? (
        <p className="text-xs">
          {ar
            ? "عولجت جميع النسخ في الدفعة المعتمدة."
            : "All copies in the reviewed batch have been reconciled."}
        </p>
      ) : null}
      {message ? (
        <p className="text-xs" role="status">
          {message}
        </p>
      ) : null}
      {errors.map((error, i) => (
        <p key={i} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ))}
    </section>
  );
}
