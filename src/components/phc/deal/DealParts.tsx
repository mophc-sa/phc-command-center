// The deal page as Omar's images 21–28 draw it (Mo, 2026-11-18): chevron
// sales path, hold / closed / signed banners, the three summary cards and the
// details block, the contractor package, and handover readiness. PHC theme.
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle, ClipboardCheck, Clock, Layers, MinusCircle, PauseCircle, Target, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, type Lang } from "@/lib/i18n";
import { opportunityValue } from "@/lib/opportunity-value";

export const PATH: { keys: string[]; en: string; ar: string }[] = [
  { keys: ["qualified"], en: "Qualified", ar: "مؤهلة" },
  { keys: ["rfq_received"], en: "RFQ", ar: "طلب التسعير" },
  { keys: ["pricing"], en: "Pricing", ar: "تسعير" },
  { keys: ["jih"], en: "Submitted", ar: "مقدَّم" },
  { keys: ["jih_bafo", "under_negotiation"], en: "Negotiation", ar: "تفاوض" },
  { keys: ["verbally_awarded"], en: "Verbal award", ar: "ترسية شفهية" },
  { keys: ["contract_received", "contract_signed", "won"], en: "Signed", ar: "موقّع" },
];

/** Image 21: seven chevrons; done steps tinted, the current one solid. */
export function StageChevrons({ stage, lang }: { stage: string | null | undefined; lang: Lang }) {
  const at = PATH.findIndex((p) => p.keys.includes(stage ?? ""));
  const rtl = lang === "ar";
  const shape = rtl
    ? "polygon(100% 0, 14px 0, 0 50%, 14px 100%, 100% 100%, calc(100% - 14px) 50%)"
    : "polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%, 14px 50%)";
  return (
    <ol className="flex overflow-x-auto rounded-lg border border-border bg-muted/50 p-1" aria-label={rtl ? "مسار البيع" : "Sales path"}>
      {PATH.map((p, i) => (
        <li
          key={p.en}
          aria-current={i === at ? "step" : undefined}
          style={{ clipPath: shape }}
          className={
            "-ms-2 flex min-h-11 min-w-28 flex-1 items-center justify-center px-6 text-center text-sm font-semibold first:ms-0 " +
            (i === at ? "bg-primary text-primary-foreground" : i < at ? "bg-primary/15 text-foreground" : "bg-muted text-muted-foreground")
          }
        >
          {rtl ? p.ar : p.en}
        </li>
      ))}
    </ol>
  );
}

export function Banner({ tone, icon, title, children, action }: {
  tone: "hold" | "lost" | "signed"; icon: "hold" | "lost" | "signed"; title: string; children: React.ReactNode; action?: React.ReactNode;
}) {
  const cls = tone === "lost" ? "border-destructive/40 bg-destructive/5" : "border-primary/40 bg-primary/10";
  const Icon = icon === "hold" ? PauseCircle : icon === "lost" ? MinusCircle : CheckCircle2;
  return (
    <div className={`flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border px-4 py-3 ${cls}`}>
      <span className="flex items-center gap-2 text-lg font-bold text-foreground">
        <Icon className={`h-7 w-7 ${tone === "lost" ? "text-destructive" : "text-primary"}`} aria-hidden="true" />
        {title}
      </span>
      <span className="hidden h-8 w-px bg-border sm:block" aria-hidden="true" />
      <div className="flex flex-1 flex-wrap gap-x-6 gap-y-1 text-sm">{children}</div>
      {action}
    </div>
  );
}

/** Image 21, Summary: scope, next action and the latest activity, side by side. */
export function SummaryCards({ scope, nextAction, nextDue, recent, lang }: {
  scope: string | null; nextAction: string | null; nextDue: string | null; recent: { text: string; at: string } | null; lang: Lang;
}) {
  const ar = lang === "ar";
  const card = (Icon: typeof Target, title: string, body: React.ReactNode) => (
    <div className="flex gap-3 rounded-lg border border-border p-4">
      <Icon className="mt-0.5 h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0">
        <div className="text-base font-semibold text-foreground">{title}</div>
        <div className="mt-1 line-clamp-3 text-sm text-muted-foreground">{body}</div>
      </div>
    </div>
  );
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {card(Target, ar ? "النطاق" : "Scope", scope ?? (ar ? "لم يُسجّل النطاق" : "No scope recorded"))}
      {card(ClipboardCheck, ar ? "الإجراء التالي" : "Next action", nextAction ? `${nextAction}${nextDue ? ` — ${nextDue}` : ""}` : (ar ? "لا خطوة تالية مسجلة" : "No next step recorded"))}
      {card(Clock, ar ? "آخر نشاط" : "Recent activity", recent ? `${recent.at}: ${recent.text}` : (ar ? "لا نشاط مسجل" : "No activity recorded"))}
    </div>
  );
}

export function DetailsBlock({ left, right, lang }: { left: [string, string | null][]; right: [string, string | null][]; lang: Lang }) {
  const col = (rows: [string, string | null][]) => (
    <dl className="grid gap-2">
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[10rem_1fr] gap-3 text-sm">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-medium text-foreground">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
  return (
    <section className="rounded-lg border border-border p-4">
      <h3 className="mb-3 text-base font-semibold text-foreground">{lang === "ar" ? "تفاصيل الفرصة" : "Opportunity details"}</h3>
      <div className="grid gap-4 md:grid-cols-2 md:[&>*:last-child]:border-s md:[&>*:last-child]:border-border md:[&>*:last-child]:ps-6">
        {col(left)}
        {col(right)}
      </div>
    </section>
  );
}

/**
 * Image 25: one project package quoted to several contractors. The pipeline
 * counts the package once (on the primary deal); the quotations total shows what
 * was quoted across contractors. Rows are the contractor deals.
 */
export function PackagePanel({ dealId, countedOn, lang }: { dealId: string; countedOn: string | null; lang: Lang }) {
  const ar = lang === "ar";
  const primary = countedOn ?? dealId;
  const q = useQuery({
    queryKey: ["deal-package", primary],
    queryFn: async () => {
      const [p, s] = await Promise.all([
        supabase.from("opportunities").select("id, project_name, client, sales_stage, quotation_value, contract_value, extra_data").eq("id", primary).maybeSingle(),
        supabase.from("opportunities").select("id, project_name, client, sales_stage, quotation_value, contract_value, extra_data").eq("extra_data->>value_counted_on", primary).neq("stage", "archived"),
      ]);
      return [p.data, ...(s.data ?? [])].filter(Boolean) as any[];
    },
  });
  const rows = q.data ?? [];
  if (rows.length < 2) return null;
  const unique = opportunityValue(rows[0]) ?? 0;
  const quoted = (r: any) => opportunityValue(r) ?? Number(r.extra_data?.contractor_quote_value ?? 0);
  const total = rows.reduce((a, r) => a + quoted(r), 0);
  const code = (r: any) => r.extra_data?.master_list_2026_11?.code ?? r.extra_data?.sales_code ?? "—";
  return (
    <section className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex items-center gap-4 rounded-lg border border-primary/40 bg-primary/5 p-4">
          <span className="grid h-12 w-12 place-items-center rounded-lg bg-primary/15 text-primary"><Layers className="h-6 w-6" aria-hidden="true" /></span>
          <div className="flex-1">
            <div className="text-base font-semibold">{ar ? "قيمة الفرصة دون تكرار" : "Unique pipeline value"}</div>
            <div className="text-sm text-muted-foreground">{ar ? "تُحسب مرة واحدة لهذه الحزمة" : "Counted once for this project package"}</div>
          </div>
          <div className="text-2xl font-bold tabular-nums">{formatCurrency(unique, lang, "SAR")}</div>
        </div>
        <div className="flex items-center gap-4 rounded-lg border border-border p-4">
          <span className="grid h-12 w-12 place-items-center rounded-lg bg-muted text-primary"><FileText className="h-6 w-6" aria-hidden="true" /></span>
          <div className="flex-1">
            <div className="text-base font-semibold">{ar ? "إجمالي العروض الحالية" : "Total current quotations"}</div>
            <div className="text-sm text-muted-foreground">{rows.length} {ar ? "مقاولين" : "contractors"}</div>
          </div>
          <div className="text-2xl font-bold tabular-nums">{formatCurrency(total, lang, "SAR")}</div>
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader className="bg-primary/10">
            <TableRow>{[ar ? "المقاول" : "Contractor", ar ? "رقم العرض" : "Quotation No.", ar ? "القيمة" : "Value", ar ? "المرحلة" : "Stage"].map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} className={r.id === dealId ? "bg-muted/40" : undefined}>
                <TableCell className="font-semibold"><Link to="/opportunities/$id" params={{ id: r.id }} className="hover:underline">{r.client ?? "—"}</Link></TableCell>
                <TableCell className="tabular-nums">{code(r)}</TableCell>
                <TableCell className="tabular-nums">{formatCurrency(quoted(r), lang, "SAR")}</TableCell>
                <TableCell>{String(r.sales_stage ?? "").replace(/_/g, " ")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-sm text-muted-foreground">{ar ? "متابعات كل مقاول تبقى منفصلة." : "Contractor-specific follow-ups remain separate."}</p>
    </section>
  );
}

/** Image 28: what is ready for the project team, and what is missing. */
export function HandoverReadiness({ items, lang }: { items: { label: string; done: boolean; hint?: string }[]; lang: Lang }) {
  const done = items.filter((i) => i.done).length;
  return (
    <section className="rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-semibold text-foreground">{lang === "ar" ? "جاهزية التسليم" : "Handover readiness"}</h3>
        <span className="rounded-full bg-primary/15 px-3 py-1 text-sm font-semibold">{done} {lang === "ar" ? "من" : "of"} {items.length}</span>
      </div>
      <ul className="grid gap-2">
        {items.map((i) => (
          <li key={i.label} className="flex items-start gap-2 text-sm">
            {i.done ? <CheckCircle2 className="h-5 w-5 shrink-0 text-won" aria-hidden="true" /> : <Circle className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />}
            <span>
              <span className="font-medium">{i.label}</span>
              {i.hint ? <span className="block text-muted-foreground">{i.hint}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
