import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { useI18n } from "@/lib/i18n";
import { canManageSalesPipeline } from "@/lib/roles";
import { Panel } from "./Panel";
import { GroundedAiAnswer } from "./GroundedAiAnswer";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  getAiOperationsStatus,
  askCompanyKnowledge,
  getKnowledgeSource,
  prepareKnowledge,
  reviewKnowledge,
  publishKnowledge,
  reindexReferences,
  runAiEvaluation,
  reviewAiEvaluation,
  type GroundedResult,
  type KnowledgeSource,
  type QualityRun,
} from "@/lib/ai-operations-actions";
const button = "rounded border px-3 py-1.5 text-sm disabled:opacity-50";
export function AiOperationsPanel() {
  const { lang } = useI18n(),
    { user, roles } = useAuth(),
    qc = useQueryClient();
  const ar = lang === "ar",
    canManage = canManageSalesPipeline(roles);
  const [busy, setBusy] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [answer, setAnswer] = useState<GroundedResult | null>(null);
  const [source, setSource] = useState<KnowledgeSource | null>(null),
    [reviewRun, setReviewRun] = useState<QualityRun | null>(null),
    [score, setScore] = useState("3"),
    [note, setNote] = useState("");
  const [caseKey, setCaseKey] = useState("pipeline_numbers"),
    [progress, setProgress] = useState("");
  const state = useQuery({
    queryKey: ["ai-operations-status", user?.id],
    queryFn: getAiOperationsStatus,
    enabled: !!user,
    refetchInterval: 60000,
  });
  async function act(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ["ai-operations-status"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }
  const openSource = (id: string) =>
    act(id, async () => setSource((await getKnowledgeSource(id)).source));
  return (
    <div className="space-y-6">
      {state.error && (
        <p role="alert" className="text-destructive">
          {state.error.message}
          <button className="ms-2 underline" onClick={() => state.refetch()}>
            {ar ? "إعادة المحاولة" : "Retry"}
          </button>
        </p>
      )}
      <Panel title={ar ? "معرفة الشركة بمراجعها" : "Company knowledge with sources"}>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {ar
              ? "الإجابات تستند إلى المصادر المفهرسة والمعتمدة التي تسمح بها صلاحياتك. افتح مرجع كل إجابة للتحقق منها."
              : "Answers use indexed, approved sources permitted by your access. Open each citation to verify its evidence."}
          </p>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setAnswer(null);
              act("ask", async () => setAnswer(await askCompanyKnowledge(query, lang)));
            }}
          >
            <label className="sr-only" htmlFor="company-ai-query">
              {ar ? "سؤال عن معرفة الشركة" : "Company knowledge question"}
            </label>
            <input
              id="company-ai-query"
              className="min-w-0 flex-1 rounded border bg-background p-2"
              placeholder={
                ar
                  ? "ما المشاريع المشابهة التي نفذتها PHC؟"
                  : "Which similar projects has PHC delivered?"
              }
              value={query}
              maxLength={2000}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button className={button} disabled={!!busy || !query.trim()}>
              {busy === "ask"
                ? ar
                  ? "جارٍ البحث…"
                  : "Searching…"
                : ar
                  ? "اسأل المعرفة"
                  : "Ask knowledge"}
            </button>
          </form>
          {answer && <GroundedAiAnswer answer={answer} />}
          {canManage && (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  className={button}
                  disabled={!!busy}
                  onClick={() =>
                    act("index", async () => {
                      const r = await reindexReferences();
                      if (r.failed.length)
                        toast.error(
                          `${r.indexed}/${r.total}: ${ar ? "بعض المصادر تحتاج إعادة محاولة" : "Some sources need a retry"}`,
                        );
                      else
                        toast.success(
                          `${r.indexed} ${ar ? "مشروعًا مفهرسًا" : "projects indexed"}`,
                        );
                    })
                  }
                >
                  {busy === "index"
                    ? ar
                      ? "جارٍ تحديث الفهرس…"
                      : "Updating index…"
                    : ar
                      ? "تحديث فهرس مكتبة المشاريع"
                      : "Update reference-project index"}
                </button>
                <span className="text-xs text-muted-foreground">
                  {state.data?.sources.filter((s) => s.status === "indexed" && s.is_current)
                    .length ?? 0}{" "}
                  {ar ? "مصدرًا معتمدًا وحديثًا" : "approved current sources"}
                </span>
              </div>
              <details>
                <summary className="cursor-pointer font-medium">
                  {ar
                    ? "الوثائق المتاحة لاستخراج النص ومراجعته"
                    : "Documents available for extraction and review"}
                </summary>
                <p className="my-2 text-xs text-muted-foreground">
                  {ar
                    ? "اعتماد المعرفة يخص النص المستخرج فقط. ملفات PDF المصورة تحتاج نسخة قابلة للبحث. لا يُعد اعتمادًا تجاريًا للوثيقة."
                    : "Knowledge approval applies to extracted text only. Scanned PDFs require a searchable copy. This is not a commercial document approval."}
                </p>
                <ul className="space-y-2">
                  {state.data?.documents.map((d) => (
                    <li
                      key={d.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded border p-2"
                    >
                      <span>{d.title || d.original_filename}</span>
                      <button
                        className={button}
                        disabled={!!busy}
                        onClick={() =>
                          act(d.id, async () => setSource((await prepareKnowledge(d.id)).source))
                        }
                      >
                        {ar ? "استخراج ومراجعة" : "Extract and review"}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
              <details>
                <summary className="cursor-pointer font-medium">
                  {ar ? "حالة المصادر وإدارة الاعتماد" : "Source status and approval management"}
                </summary>
                <ul className="mt-2 max-h-80 space-y-2 overflow-auto">
                  {state.data?.sources.map((s) => (
                    <li
                      key={s.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded border p-2"
                    >
                      <div>
                        <span>{s.title}</span>
                        <p className="text-xs text-muted-foreground">
                          {s.is_current
                            ? s.status
                            : ar
                              ? "المصدر تغيّر؛ يلزم تحديثه"
                              : "Source changed; refresh required"}{" "}
                          · {s.chunk_count} {ar ? "مقاطع" : "chunks"}
                          {s.approved_at
                            ? ` · ${new Date(s.approved_at).toLocaleDateString(lang)}`
                            : ""}
                        </p>
                      </div>
                      <button disabled={!!busy} className={button} onClick={() => openSource(s.id)}>
                        {ar ? "عرض ومراجعة" : "View and review"}
                      </button>
                      {!s.is_current && (
                        <button
                          className={button}
                          disabled={!!busy}
                          onClick={() =>
                            act(s.id, async () =>
                              setSource(
                                (await prepareKnowledge(s.source_id, s.source_type)).source,
                              ),
                            )
                          }
                        >
                          {ar ? "تحديث النص" : "Refresh text"}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            </>
          )}
        </div>
      </Panel>
      {canManage && (
        <Panel title={ar ? "جودة النماذج وتكلفة الاستخدام" : "Model quality and usage cost"}>
          <div className="space-y-4">
            <p className="text-sm">
              {ar ? "النموذج التشغيلي الحالي" : "Current production model"}:{" "}
              {state.data?.provider.configured
                ? state.data.provider.model
                : ar
                  ? "غير متاح"
                  : "Unavailable"}
            </p>
            {state.data?.provider.knowledge_model && <p className="text-xs text-muted-foreground">
              {ar ? "نموذج إجابات معرفة الشركة" : "Company knowledge model"}: {state.data.provider.knowledge_model}
            </p>}
            <p className="text-sm text-muted-foreground">
              {ar
                ? "قارن حالات PHC نفسها بالعربية والإنجليزية. تُقاس صحة الحقائق والمراجع آليًا؛ قيّم الفائدة من 1 إلى 5 بعد قراءة النتيجة. المقارنة لا تغيّر نموذج الإنتاج."
                : "Compare identical PHC cases in Arabic and English. Facts and citations are checked automatically; rate usefulness from 1 to 5 after reading the output. Evaluation does not change the production model."}
            </p>
            <div className="flex flex-wrap gap-2">
              <label className="sr-only" htmlFor="ai-eval-case">
                {ar ? "حالة الاختبار" : "Evaluation case"}
              </label>
              <select
                id="ai-eval-case"
                className="rounded border bg-background p-2"
                value={caseKey}
                onChange={(e) => setCaseKey(e.target.value)}
              >
                <option value="pipeline_numbers">
                  {ar ? "دقة أرقام المبيعات" : "Sales numerical accuracy"}
                </option>
                <option value="rfq_completeness">
                  {ar ? "اكتشاف نواقص RFQ" : "RFQ completeness"}
                </option>
                <option value="knowledge_abstention">
                  {ar ? "الامتناع عند غياب الدليل" : "Abstention without evidence"}
                </option>
                <option value="knowledge_citation">
                  {ar ? "توثيق معرفة المشاريع" : "Project knowledge citations"}
                </option>
              </select>
              <button
                className={button}
                disabled={!!busy}
                onClick={() =>
                  act("evaluate", async () => {
                    const request = crypto.randomUUID();
                    for (const language of ["ar", "en"] as const) {
                      setProgress(language === "ar" ? "Arabic…" : "English…");
                      await runAiEvaluation(caseKey, language, request);
                    }
                    setProgress("");
                    toast.success(
                      ar
                        ? "سُجلت نتائج المقارنة؛ راجع النتائج والفائدة"
                        : "Comparison recorded; review results and usefulness",
                    );
                  })
                }
              >
                {busy === "evaluate"
                  ? progress
                  : ar
                    ? "تشغيل المقارنة باللغتين"
                    : "Compare in both languages"}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {ar
                ? "حدود يومية لعدد الطلبات؛ التكلفة الظاهرة تقدير من التوكنات المسجلة وليست فاتورة. القيمة غير المتاحة لا تعني صفرًا."
                : "Daily request limits apply. Displayed cost estimates use recorded tokens and are not invoices. Unavailable cost does not mean zero."}
            </p>
            <div className="flex flex-wrap gap-3 text-xs">
              {state.data?.limits.map((l) => (
                <span key={l.kind}>
                  {l.kind}: {state.data?.usage.find((u) => u.kind === l.kind)?.calls ?? 0}/
                  {l.daily_per_user}
                </span>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-start text-sm">
                <thead>
                  <tr>
                    {(ar
                      ? [
                          "النموذج والحالة",
                          "اللغة",
                          "اجتياز الاختبار",
                          "دقة الأرقام",
                          "المراجع",
                          "المدة",
                          "التكلفة USD",
                          "الفائدة",
                        ]
                      : [
                          "Model / case",
                          "Language",
                          "Overall check",
                          "Numbers",
                          "Citations",
                          "Duration",
                          "Cost USD",
                          "Usefulness",
                        ]
                    ).map((h) => (
                      <th key={h} className="p-2 text-start">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {state.data?.runs.map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="p-2">
                        <button
                          className="text-start underline"
                          onClick={() => {
                            setReviewRun(r);
                            setScore(String(r.usefulness ?? 3));
                            setNote(r.review_note ?? "");
                          }}
                        >
                          {r.model}
                          <span className="block text-xs">
                            {r.case_key} · {r.status}
                            {r.error_code ? ` · ${r.error_code}` : ""}
                          </span>
                        </button>
                      </td>
                      <td className="p-2">{r.language}</td>
                      <td className="p-2">
                        {r.checks?.passed === true ? (ar ? "اجتاز" : "Passed") : r.checks?.passed === false || r.status === "failed" ? (ar ? "لم يجتز" : "Failed") : "—"}
                      </td>
                      <td className="p-2">
                        {typeof r.checks?.numerical_accuracy === "number" ? `${Math.round(r.checks.numerical_accuracy * 100)}%` : "—"}
                      </td>
                      <td className="p-2">
                        {typeof r.checks?.citations_valid === "boolean" ? (r.checks.citations_valid ? "✓" : "✕") : "—"}
                      </td>
                      <td className="p-2">
                        {r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)}s` : "—"}
                      </td>
                      <td className="p-2">
                        {r.estimated_cost_usd != null
                          ? Number(r.estimated_cost_usd).toFixed(6)
                          : "—"}
                      </td>
                      <td className="p-2">
                        {r.usefulness != null
                          ? `${r.usefulness}/5`
                          : ar
                            ? "بانتظار التقييم"
                            : "Unrated"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Panel>
      )}
      <Dialog
        open={!!source}
        onOpenChange={(open) => {
          if (!open) setSource(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{source?.title}</DialogTitle>
            <DialogDescription>
              {ar
                ? "راجع النص المستخرج قبل السماح باستخدامه في إجابات الشركة."
                : "Review the extracted text before permitting it in company answers."}
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded border p-3 text-sm">
            {source?.content}
          </pre>
          <p className="text-xs text-muted-foreground">{source?.status}</p>
          <div className="flex gap-2">
            <button
              className={button}
              disabled={!!busy || !source}
              onClick={() =>
                source &&
                act("approve", async () => {
                  await reviewKnowledge(source, "approve");
                  setSource(null);
                  toast.success(ar ? "اعتُمد المصدر وفُهرس" : "Source approved and indexed");
                })
              }
            >
              {ar ? "اعتماد النص وفهرسته" : "Approve text and index"}
            </button>
            {source?.status === "approved" && (
              <button
                className={button}
                disabled={!!busy}
                onClick={() =>
                  act("publish", async () => {
                    await publishKnowledge(source);
                    setSource(null);
                  })
                }
              >
                {ar ? "إعادة محاولة الفهرسة" : "Retry indexing"}
              </button>
            )}
            <button
              className={button}
              disabled={!!busy || !source}
              onClick={() =>
                source &&
                act("revoke", async () => {
                  await reviewKnowledge(source, "revoke");
                  setSource(null);
                })
              }
            >
              {ar ? "سحب الاعتماد" : "Revoke approval"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!reviewRun}
        onOpenChange={(open) => {
          if (!open) setReviewRun(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {reviewRun?.model} · {reviewRun?.case_key}
            </DialogTitle>
            <DialogDescription>
              {ar
                ? "قيّم وضوح الإجابة وفائدتها وسلامة اقتراحاتها؛ النجاح العددي وحده لا يكفي."
                : "Rate clarity, usefulness and soundness of suggestions; numerical correctness alone is insufficient."}
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded border p-3 text-sm">
            {JSON.stringify({ result: reviewRun?.output ?? { error: reviewRun?.error_code }, checks: reviewRun?.checks }, null, 2)}
          </pre>
          <p className="text-xs">{reviewRun?.cost_basis}</p>
          <label>
            {ar ? "الفائدة 1–5" : "Usefulness 1–5"}
            <select
              className="ms-3 rounded border bg-background p-2"
              value={score}
              onChange={(e) => setScore(e.target.value)}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <label>
            {ar ? "سبب التقييم" : "Review explanation"}
            <textarea
              className="mt-1 w-full rounded border bg-background p-2"
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button
            className={button}
            disabled={!!busy || !note.trim() || reviewRun?.status !== "succeeded"}
            onClick={() =>
              reviewRun &&
              act("review", async () => {
                await reviewAiEvaluation(reviewRun.id, Number(score), note);
                setReviewRun(null);
              })
            }
          >
            {ar ? "حفظ التقييم" : "Save review"}
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
