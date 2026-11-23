// Review 81/82 item 15 (Omar, 2026-11-22): the price's whole story instead of
// "last quotation" — Rev 0 the original, then each revision (a quantity change
// or a discount) with what it moved the price by, and the notes. Rows live in
// `quotations` (one per revision, version order); the type is kept in
// extra_data.revision_type. The newest revision is the final price.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Panel } from "@/components/phc/Panel";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { parseMoneyInput, updateOpportunityFigures } from "@/lib/opportunity-collab-actions";
import { formatCurrency, type Lang } from "@/lib/i18n";
import { riyadhDay } from "@/lib/riyadh-day";

type Kind = "original" | "revised" | "discount";
type Row = { id: string; version: number; value: number | null; issued_date: string | null; created_at: string; notes: string | null; status: string; extra_data: { revision_type?: Kind } | null };

const KIND: Record<Kind, { en: string; ar: string }> = {
  original: { en: "Submitted as original", ar: "مقدَّم كأصلي" },
  revised: { en: "Revised (quantity / scope)", ar: "معدَّل (كمية / نطاق)" },
  discount: { en: "Discount", ar: "خصم" },
};

/** Each revision with its change from the one before it. Exported for its test. */
export function withChanges(rows: Pick<Row, "value">[]) {
  return rows.map((r, i) => {
    const prev = i > 0 ? rows[i - 1].value : null;
    const change = prev != null && r.value != null ? r.value - prev : null;
    return { change, pct: change != null && prev ? (change / prev) * 100 : null };
  });
}

export function PricingHistory({ opportunityId, dealCode, currency, canAdd, canSetDealValue, lang, onChanged }: {
  opportunityId: string; dealCode: string | null; currency: string | null; canAdd: boolean; canSetDealValue: boolean;
  lang: Lang; onChanged: () => void;
}) {
  const ar = lang === "ar";
  const qc = useQueryClient();
  const key = ["pricing-history", opportunityId];
  const [adding, setAdding] = useState(false);
  const q = useQuery({
    queryKey: key,
    queryFn: async () => ((await supabase.from("quotations")
      .select("id, version, value, issued_date, created_at, notes, status, extra_data")
      .eq("related_opportunity_id", opportunityId)
      .order("version").order("created_at")).data ?? []) as unknown as Row[],
  });
  const rows = q.data ?? [];
  const changes = withChanges(rows);
  const kindOf = (r: Row, i: number): Kind => r.extra_data?.revision_type ?? (i === 0 ? "original" : "revised");
  const money = (n: number | null) => (n == null ? "—" : formatCurrency(n, lang, currency ?? "SAR"));

  return (
    <Panel
      title={ar ? "سجل التسعير" : "Pricing history"}
      action={canAdd ? (
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus className="me-1 h-3.5 w-3.5" aria-hidden="true" />{ar ? "إضافة مراجعة" : "Add revision"}
        </Button>
      ) : undefined}
    >
      {!rows.length ? (
        <p className="text-sm text-muted-foreground">{ar ? "لا عرض سعر مسجّل بعد. أضف الأصلي كـ Rev 0." : "No quotation recorded yet. Add the original as Rev 0."}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rev</TableHead>
              <TableHead>{ar ? "التاريخ" : "Date"}</TableHead>
              <TableHead>{ar ? "النوع" : "Type"}</TableHead>
              <TableHead className="text-end">{ar ? "القيمة" : "Value"}</TableHead>
              <TableHead className="text-end">{ar ? "التغيّر" : "Change"}</TableHead>
              <TableHead>{ar ? "ملاحظات" : "Notes"}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => {
              const c = changes[i];
              const last = i === rows.length - 1;
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-semibold tabular-nums">
                    Rev {i}{last ? <span className="ms-2 rounded-full bg-primary-soft px-2 py-0.5 text-xs text-primary-on-tint">{ar ? "النهائي" : "Final"}</span> : null}
                  </TableCell>
                  <TableCell className="tabular-nums">{r.issued_date ?? r.created_at.slice(0, 10)}</TableCell>
                  <TableCell>{ar ? KIND[kindOf(r, i)].ar : KIND[kindOf(r, i)].en}</TableCell>
                  <TableCell className="text-end font-semibold tabular-nums">{money(r.value)}</TableCell>
                  <TableCell className={`text-end tabular-nums ${c.change != null && c.change < 0 ? "text-destructive-on-tint" : "text-muted-foreground"}`}>
                    {c.change == null ? "—" : `${c.change > 0 ? "+" : ""}${money(c.change)}${c.pct != null ? ` (${c.pct > 0 ? "+" : ""}${c.pct.toFixed(1)}%)` : ""}`}
                  </TableCell>
                  <TableCell className="max-w-[18rem] whitespace-normal text-sm text-muted-foreground" dir="auto">{r.notes ?? "—"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      <ActionDialog
        open={adding}
        onOpenChange={setAdding}
        title={ar ? `إضافة Rev ${rows.length}` : `Add Rev ${rows.length}`}
        description={canSetDealValue
          ? (ar ? "يصبح هذا السعر قيمة الفرصة الحالية." : "This price becomes the deal's current value.")
          : (ar ? "يُسجَّل في السجل؛ قيمة الفرصة يعدّلها المالية أو مدير التطوير." : "Recorded in the history; the deal's value is set by Finance or the BD manager.")}
        submitLabel={ar ? "حفظ" : "Save"}
        fields={[
          { key: "value", type: "text", label: ar ? "السعر (ر.س، بدون ضريبة)" : "Price (SAR, excl. VAT)", required: true },
          { key: "date", type: "date", label: ar ? "التاريخ" : "Date", required: true, defaultValue: riyadhDay() },
          { key: "kind", type: "select", label: ar ? "النوع" : "Type", required: true, defaultValue: rows.length ? "discount" : "original",
            options: (rows.length ? (["revised", "discount"] as Kind[]) : (["original"] as Kind[])).map((k) => ({ value: k, label: ar ? KIND[k].ar : KIND[k].en })) },
          { key: "notes", type: "textarea", label: ar ? "ملاحظات (سبب التغيير / ملاحظات ختامية)" : "Notes (why it changed / closing notes)" },
        ]}
        onSubmit={async (v) => {
          const value = parseMoneyInput(v.value);
          if (value == null) { toast.error(ar ? "أدخل سعرًا صحيحًا" : "Enter a valid price"); throw new Error("bad value"); }
          const version = (rows.at(-1)?.version ?? 0) + 1;
          const { data: u } = await supabase.auth.getUser();
          const { error } = await supabase.from("quotations").insert({
            quote_number: `${dealCode ?? "Q"}-R${rows.length}`,
            related_opportunity_id: opportunityId,
            owner_id: u.user?.id ?? null,
            created_by: u.user?.id ?? null,
            value,
            currency: currency ?? "SAR",
            version,
            status: rows.length ? "revised" : "submitted",
            issued_date: v.date,
            notes: v.notes?.trim() || null,
            extra_data: { revision_type: v.kind },
          } as never);
          if (error) { toast.error(error.message); throw error; }
          if (canSetDealValue) await updateOpportunityFigures({ opportunityId, quotationValue: value });
          toast.success(ar ? "سُجّلت المراجعة" : "Revision recorded");
          await qc.invalidateQueries({ queryKey: key });
          onChanged();
        }}
      />
    </Panel>
  );
}
