import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/phc/EmptyState";
import { PageHeader } from "@/components/phc/PageHeader";
import { QueryFailure } from "@/components/phc/QueryFailure";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { pick, type Bi } from "@/lib/pricing-text";

// Data sync from the master quotation list (2026-11-12): the runs and what a run
// could not decide. Readable by commercial managers (RLS); the sync itself runs
// on the server.
export const Route = createFileRoute("/_authenticated/data-sync")({
  head: () => ({ meta: [{ title: "Data sync — PHC" }, { name: "robots", content: "noindex" }] }),
  component: DataSyncPage,
});

const TEXT = {
  eyebrow: { en: "Data", ar: "البيانات" },
  title: { en: "Master list sync", ar: "مزامنة القائمة الرئيسية" },
  desc: { en: "Each sync from the master quotation list: what it updated, created and merged, and what needs a person. Open a deal to complete it.", ar: "كل مزامنة من قائمة العروض الرئيسية: ما حُدّث وأُنشئ ودُمج، وما يحتاج قراراً. افتح الصفقة لإكمالها." },
  noAccess: { en: "For sales leadership.", ar: "لقيادة المبيعات." },
  runs: { en: "Runs", ar: "عمليات المزامنة" },
  review: { en: "Needs a person", ar: "يحتاج قراراً" },
  none: { en: "Nothing waiting.", ar: "لا شيء بانتظار القرار." },
  code: { en: "Sales code", ar: "الكود" },
  project: { en: "Project", ar: "المشروع" },
  status: { en: "File status", ar: "الحالة في الملف" },
  reason: { en: "Why", ar: "السبب" },
  asOf: { en: "As of", ar: "حتى تاريخ" },
  state: { en: "State", ar: "الحالة" },
  result: { en: "Result", ar: "النتيجة" },
} satisfies Record<string, Bi>;

type Run = { id: string; file_name: string | null; as_of: string; status: string; summary: Record<string, unknown>; applied_at: string | null };
type ReviewRow = { row_id: number; run_id: string; sales_code: string | null; project: string | null; file_status: string | null; reason: string | null; opportunity_id: string | null };

const REASON_AR: Record<string, string> = {
  "No sales code": "لا يوجد كود مبيعات",
  "Won in the system, open in the file": "فائزة في النظام ومفتوحة في الملف",
  "The system moved the stage after the file's last update": "النظام غيّر المرحلة بعد آخر تحديث في الملف",
  "No owner: the code prefix has no account": "بلا مالك: بادئة الكود ليس لها حساب",
  "No numeric amount in the file": "لا يوجد مبلغ رقمي في الملف",
  "Weekly note for a code with no deal": "ملاحظة أسبوعية لكود بلا صفقة",
};

function DataSyncPage() {
  const { lang } = useI18n();
  const db = supabase as unknown as { from: (t: string) => any };
  const runs = useQuery({
    queryKey: ["data-sync-runs"],
    queryFn: async () => {
      const { data, error } = await db.from("data_sync_runs").select("id, file_name, as_of, status, summary, applied_at").order("created_at", { ascending: false }).limit(20);
      if (error) throw error;
      return (data ?? []) as Run[];
    },
  });
  const latest = runs.data?.find((r) => r.status === "applied") ?? runs.data?.[0];
  const review = useQuery({
    queryKey: ["data-sync-review", latest?.id],
    enabled: !!latest,
    queryFn: async () => {
      const { data, error } = await db.from("data_sync_review").select("row_id, run_id, sales_code, project, file_status, reason, opportunity_id").eq("run_id", latest!.id).limit(1000);
      if (error) throw error;
      return (data ?? []) as ReviewRow[];
    },
  });

  if (runs.isLoading) return <SkeletonTable />;
  if (runs.error) return <QueryFailure retry={() => void runs.refetch()} />;
  if ((runs.data ?? []).length === 0) return <EmptyState title={pick(TEXT.noAccess, lang)} />;
  const reason = (r: string | null) => (r == null ? "—" : lang === "ar" ? (REASON_AR[r] ?? r) : r);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader eyebrow={pick(TEXT.eyebrow, lang)} title={pick(TEXT.title, lang)} description={pick(TEXT.desc, lang)} />
      <section className="space-y-2">
        <h2 className="text-base font-semibold">{pick(TEXT.runs, lang)}</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{pick(TEXT.asOf, lang)}</TableHead>
              <TableHead>{pick(TEXT.state, lang)}</TableHead>
              <TableHead>{pick(TEXT.result, lang)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(runs.data ?? []).map((r) => (
              <TableRow key={r.id}>
                <TableCell className="tabular-nums">{r.as_of}<div className="text-xs text-muted-foreground">{r.file_name}</div></TableCell>
                <TableCell>{r.status}</TableCell>
                <TableCell className="text-xs tabular-nums">{JSON.stringify(r.summary?.applied ?? r.summary)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
      <section className="space-y-2">
        <h2 className="text-base font-semibold">{pick(TEXT.review, lang)} ({review.data?.length ?? 0})</h2>
        {(review.data ?? []).length === 0 ? (
          <EmptyState title={pick(TEXT.none, lang)} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{pick(TEXT.code, lang)}</TableHead>
                <TableHead>{pick(TEXT.project, lang)}</TableHead>
                <TableHead>{pick(TEXT.status, lang)}</TableHead>
                <TableHead>{pick(TEXT.reason, lang)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(review.data ?? []).map((r) => (
                <TableRow key={r.row_id}>
                  <TableCell className="font-medium tabular-nums">{r.sales_code ?? "—"}</TableCell>
                  <TableCell>
                    {r.opportunity_id ? (
                      <Link to="/opportunities/$id" params={{ id: r.opportunity_id }} className="hover:underline">{r.project ?? "—"}</Link>
                    ) : (r.project ?? "—")}
                  </TableCell>
                  <TableCell>{r.file_status ?? "—"}</TableCell>
                  <TableCell>{reason(r.reason)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
