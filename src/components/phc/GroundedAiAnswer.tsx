import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import type { GroundedResult } from "@/lib/ai-operations-actions";
export function GroundedAiAnswer({
  answer,
  onTaskDraft,
}: {
  answer: GroundedResult;
  onTaskDraft?: (title: string) => void;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const references = (ids: string[]) =>
    ids.map((id) => {
      const source = answer.sources.find((s) => s.id === id);
      return source ? (
        <details key={id} className="mt-1 text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            {source.title} · {ar ? "المصدر" : "Source"}
          </summary>
          <pre className="max-h-52 overflow-auto whitespace-pre-wrap rounded border p-2">
            {source.content}
          </pre>
        </details>
      ) : null;
    });
  return (
    <div className="space-y-4 rounded-lg border p-4" aria-live="polite">
      <p className="text-xs text-muted-foreground">
        {ar ? "مقترح للمراجعة البشرية" : "For human review"} ·{" "}
        {new Date(answer.as_of).toLocaleString(lang)}
        {answer.model ? ` · ${answer.model}` : ""}
      </p>
      {answer.result.insufficient_evidence && (
        <p role="status">
          {ar
            ? "الأدلة المتاحة لا تكفي للإجابة الكاملة. لا يمكن تأكيد معلومات غير موثقة."
            : "Available evidence is insufficient for a complete answer. Undocumented facts cannot be confirmed."}
        </p>
      )}
      {answer.result.claims.map((claim, i) => (
        <div key={i}>
          <p>{claim.text}</p>
          {references(claim.citations)}
        </div>
      ))}
      {answer.result.questions.length > 0 && (
        <div>
          <h4 className="font-medium">{ar ? "أسئلة للاستكمال" : "Questions to resolve"}</h4>
          <ul className="list-inside list-disc">
            {answer.result.questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      )}
      {answer.result.suggested_tasks.map((task, i) => (
        <div key={i} className="rounded border p-3">
          <p className="font-medium">{task.title}</p>
          <p className="text-sm text-muted-foreground">{task.rationale}</p>
          {references(task.citations)}
          {onTaskDraft && (
            <button
              type="button"
              className="mt-2 rounded border px-3 py-1 text-sm"
              onClick={() => onTaskDraft(task.title)}
            >
              {ar ? "مراجعة إنشاء المهمة" : "Review task creation"}
            </button>
          )}
        </div>
      ))}
      {answer.result.draft && (
        <div>
          <h4 className="font-medium">
            {ar ? "مسودة متابعة — لم تُرسل" : "Follow-up draft — not sent"}
          </h4>
          <p>{answer.result.draft.subject}</p>
          <pre className="whitespace-pre-wrap rounded bg-muted p-3 font-sans">
            {answer.result.draft.body}
          </pre>
          {references(answer.result.draft.citations)}
          <button
            type="button"
            className="mt-2 rounded border px-3 py-1 text-sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  `${answer.result.draft!.subject}\n\n${answer.result.draft!.body}`,
                );
                toast.success(ar ? "نُسخت المسودة" : "Draft copied");
              } catch {
                toast.error(ar ? "تعذر النسخ" : "Copy failed");
              }
            }}
          >
            {ar ? "نسخ للمراجعة" : "Copy for review"}
          </button>
        </div>
      )}
    </div>
  );
}
