import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { QueryFailure } from "@/components/phc/QueryFailure";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listTeamMembers } from "@/lib/opportunity-actions";
import { useI18n, localeFor } from "@/lib/i18n";
import { riyadhDay } from "@/lib/riyadh-day";

const ACTIONS = ["opportunity.fields_changed", "company.fields_changed", "contact.fields_changed"];
// What a reader of "who changed what" cares about; housekeeping columns are left out.
const FIELDS: Record<string, [string, string]> = {
  sales_stage: ["Stage", "المرحلة"], quotation_value: ["Value", "القيمة"], contract_value: ["Contract value", "قيمة العقد"],
  owner_id: ["Owner", "المسؤول"], project_name: ["Project", "المشروع"], next_action: ["Next action", "الإجراء التالي"],
  next_action_due: ["Next action date", "موعد الإجراء"], hold_reason: ["Hold reason", "سبب التعليق"], loss_reason: ["Loss reason", "سبب الخسارة"],
  name: ["Name", "الاسم"], phone: ["Phone", "الهاتف"], email: ["Email", "البريد"], title: ["Title", "المنصب"],
  company_type: ["Type", "النوع"], account_status: ["Status", "الحالة"], account_owner_id: ["Account owner", "مسؤول الحساب"],
  contract_signed_date: ["Contract signed", "توقيع العقد"], contract_received_date: ["Contract / PO received", "استلام العقد / أمر الشراء"],
};

/**
 * Image 15 (Omar's CRM review): who changed what, when, with the old and new
 * value — deals, companies and contacts, one month at a time. Reads the audit
 * log, which RLS opens to sales leadership and admins.
 */
export function AuditLogPanel() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [offset, setOffset] = useState(0);
  const now = riyadhDay();
  const d = new Date(`${now.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + offset);
  const from = d.toISOString().slice(0, 10);
  const end = new Date(d); end.setUTCMonth(end.getUTCMonth() + 1);
  const to = end.toISOString().slice(0, 10);
  const team = useQuery({ queryKey: ["team"], queryFn: listTeamMembers });
  const q = useQuery({
    queryKey: ["audit-log-panel", from],
    queryFn: async () => {
      const { data, error } = await supabase.from("audit_log")
        .select("id, actor_id, actor_type, entity_type, entity_id, before_value, after_value, created_at")
        .in("action", ACTIONS).gte("created_at", `${from}T00:00:00+03:00`).lt("created_at", `${to}T00:00:00+03:00`)
        .order("created_at", { ascending: false }).limit(300);
      if (error) throw error;
      const rows = (data ?? []) as any[];
      const ids = (t: string) => [...new Set(rows.filter((r) => r.entity_type === t).map((r) => r.entity_id))];
      const [opps, comps, conts] = await Promise.all([
        ids("opportunity").length ? supabase.from("opportunities").select("id, project_name, project_code").in("id", ids("opportunity")) : Promise.resolve({ data: [] }),
        ids("company").length ? supabase.from("companies").select("id, name").in("id", ids("company")) : Promise.resolve({ data: [] }),
        ids("contact").length ? supabase.from("contacts").select("id, name").in("id", ids("contact")) : Promise.resolve({ data: [] }),
      ]);
      const label = new Map<string, { name: string; code?: string | null }>();
      for (const o of (opps.data ?? []) as any[]) label.set(o.id, { name: o.project_name, code: o.project_code });
      for (const c of [...((comps.data ?? []) as any[]), ...((conts.data ?? []) as any[])]) label.set(c.id, { name: c.name });
      return { rows, label };
    },
  });
  const person = (id: string | null) => (team.data ?? []).find((m: any) => m.id === id)?.full_name ?? null;
  const show = (k: string, v: unknown) => {
    if (v === null || v === undefined || v === "") return "—";
    if (k.endsWith("owner_id")) return person(String(v)) ?? "—";
    if (k === "sales_stage") return String(v).replace(/_/g, " ");
    const s = typeof v === "number" ? v.toLocaleString(localeFor(lang)) : String(v);
    return s.length > 40 ? `${s.slice(0, 40)}…` : s;
  };
  const monthLabel = new Intl.DateTimeFormat(localeFor(lang), { month: "long", year: "numeric" }).format(d);

  return (
    <section className="rounded-xl border border-border/70 bg-surface/60">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-5 py-4">
        <div>
          <div className="text-base font-semibold text-foreground">{ar ? "سجل التعديلات" : "Audit log"}</div>
          <div className="text-sm text-muted-foreground">{ar ? "التغييرات المهمة على الفرص والعملاء وجهات الاتصال" : "Key changes to opportunities, customers and contacts"}</div>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setOffset((o) => o - 1)} aria-label={ar ? "الشهر السابق" : "Previous month"} className="rounded-md border border-border p-1.5 hover:bg-muted">{ar ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}</button>
          <span className="min-w-32 text-center text-sm font-medium">{monthLabel}</span>
          <button type="button" disabled={offset >= 0} onClick={() => setOffset((o) => Math.min(0, o + 1))} aria-label={ar ? "الشهر التالي" : "Next month"} className="rounded-md border border-border p-1.5 hover:bg-muted disabled:opacity-60">{ar ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button>
        </div>
      </header>
      {q.error ? <QueryFailure retry={() => void q.refetch()} /> : !q.data ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">{ar ? "جارٍ التحميل…" : "Loading…"}</p>
      ) : (
        <div className="max-h-[70vh] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-surface">
              <TableRow>
                <TableHead>{ar ? "الوقت" : "Time"}</TableHead>
                <TableHead>{ar ? "المستخدم" : "User"}</TableHead>
                <TableHead>{ar ? "السجل" : "Record"}</TableHead>
                <TableHead>{ar ? "التغيير" : "Change"}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data.rows.map((r: any) => {
                const keys = Object.keys(r.after_value ?? {}).filter((k) => FIELDS[k]);
                if (keys.length === 0) return null;
                const rec = q.data.label.get(r.entity_id);
                const recName = rec?.name ?? "—";
                return (
                  <TableRow key={r.id} className="align-top">
                    <TableCell className="whitespace-nowrap tabular-nums text-sm">{new Date(r.created_at).toLocaleString(localeFor(lang), { dateStyle: "medium", timeStyle: "short" })}</TableCell>
                    <TableCell className="text-sm">{r.actor_type === "data_sync" ? (ar ? "مزامنة القائمة الرئيسية" : "Master list sync") : person(r.actor_id) ?? (r.actor_type === "system" ? (ar ? "النظام" : "System") : "—")}</TableCell>
                    <TableCell className="text-sm">
                      {r.entity_type === "opportunity" ? <Link to="/opportunities/$id" params={{ id: r.entity_id }} className="font-semibold hover:underline">{rec?.code ?? recName}</Link>
                        : r.entity_type === "company" ? <Link to="/accounts/$id" params={{ id: r.entity_id }} className="font-semibold hover:underline">{recName}</Link>
                        : <span className="font-semibold">{recName}</span>}
                      <span className="block text-muted-foreground">{r.entity_type === "opportunity" ? recName : r.entity_type === "company" ? (ar ? "عميل" : "Customer") : (ar ? "جهة اتصال" : "Contact")}</span>
                    </TableCell>
                    <TableCell className="text-sm">
                      {keys.map((k) => (
                        <div key={k}><span className="font-semibold">{FIELDS[k][ar ? 1 : 0]}:</span> {show(k, r.before_value?.[k])} → {show(k, r.after_value?.[k])}</div>
                      ))}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
