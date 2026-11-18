import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/components/phc/Panel";
import { KpiCard } from "@/components/phc/KpiCard";
import { KpiRow } from "@/components/phc/KpiRow";
import { StatusPill } from "@/components/phc/StatusPill";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchAllRows } from "@/lib/fetch-all";
import { useI18n, formatNumber } from "@/lib/i18n";
import { riyadhDay } from "@/lib/riyadh-day";
import {
  parseContact, parseMasterList, planImport,
  type ExistingDeal, type PlanItem, type PlanKind,
} from "@/lib/master-list-import";

/**
 * Upload the master quotation list, see what it would change, decide, import
 * (Omar's CRM review, point 16). Nothing is written until "Import approved
 * rows"; conflicts are off until a person turns them on; a deal edited in the
 * system after the file is skipped by the server, never overwritten.
 */
export function MasterListImport() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const qc = useQueryClient();
  const [fileName, setFileName] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  async function onFile(file: File) {
    setBusy(true); setResult(null); setPlan(null);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      // Only a sheet with the master-list header is read; credential and bank sheets never are.
      const sheet = wb.SheetNames.filter((n) => !/vendor|company info/i.test(n))
        .map((n) => XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, blankrows: false, defval: null, raw: true }))
        .find((aoa) => aoa.some((r) => (r ?? []).some((c) => /project\s*code/i.test(String(c ?? "")))));
      if (!sheet) throw new Error(ar ? "لم أجد ورقة فيها عمود «Project Code»." : "No sheet with a “Project Code” column was found.");
      const rows = parseMasterList(sheet);
      const { rows: opps } = await fetchAllRows(() =>
        supabase.from("opportunities").select("id, stage, sales_stage, quotation_value, contract_value, project_name, created_at, owner_id, last_activity_at, extra_data").order("id"),
      );
      const deals: ExistingDeal[] = (opps as any[]).map((o) => {
        const x = (o.extra_data ?? {}) as Record<string, any>;
        return {
          id: o.id, stage: o.stage, sales_stage: o.sales_stage,
          quotation_value: o.quotation_value == null ? null : Number(o.quotation_value),
          contract_value: o.contract_value == null ? null : Number(o.contract_value),
          project_name: o.project_name, created_at: o.created_at, owner_id: o.owner_id, last_activity_at: o.last_activity_at,
          code: x.master_list_2026_11?.code ?? x.sales_code ?? x.source_sales_code ?? null,
          has_master_list: !!(x.master_list || x.master_list_2026_11),
          duplicate_of: x.duplicate_of ?? null, value_counted_on: x.value_counted_on ?? null,
        };
      });
      const owners = await (supabase as any).from("historical_sales_owner_map").select("prefix, user_id");
      const ownerByPrefix = Object.fromEntries(((owners.data ?? []) as { prefix: string; user_id: string | null }[]).map((m) => [m.prefix, m.user_id]));
      setPlan(planImport(rows, deals, ownerByPrefix));
      setFileName(file.name);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const counts = useMemo(() => {
    const c = { create: 0, changed: 0, unchanged: 0, conflict: 0, unknown: 0, restore: 0 };
    for (const p of plan ?? []) {
      if (p.kind === "create") c.create++;
      else if (p.kind === "conflict") c.conflict++;
      else if (p.kind === "unknown_status") c.unknown++;
      else if (p.kind === "restore") c.restore++;
      else if (changed(p)) c.changed++;
      else c.unchanged++;
    }
    return c;
  }, [plan]);

  async function onImport() {
    if (!plan) return;
    const items = plan.filter((p) => p.apply && p.kind !== "unknown_status");
    // Primaries before second contractors, so a new primary exists when its secondary points at it.
    items.sort((a, b) => Number(!!a.countedOn) - Number(!!b.countedOn));
    setBusy(true);
    try {
      const { data, error } = await (supabase as any).rpc("master_list_import", {
        _file_name: fileName, _as_of: riyadhDay(),
        _items: items.map((p) => ({
          key: p.key, kind: p.kind, deal_id: p.dealId, counted_on: p.countedOn, row: p.row, row_nos: p.rowNos, codes: p.codes,
          changes: p.changes, contact: parseContact(p.row.rfq_contact),
          next_action: /Next:\s*([\s\S]+)$/.exec(p.row.remarks ?? "")?.[1]?.trim().slice(0, 500) ?? null,
        })),
      });
      if (error) throw error;
      setResult(data);
      setPlan(null);
      toast.success(ar ? "تم الاستيراد" : "Imported");
      qc.invalidateQueries({ queryKey: ["data-sync-runs"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (key: string) => setPlan((p) => (p ?? []).map((x) => (x.key === key ? { ...x, apply: !x.apply } : x)));
  const KIND: Record<PlanKind, { en: string; ar: string; tone: "positive" | "attention" | "danger" | "muted" | "neutral" }> = {
    create: { en: "New", ar: "جديد", tone: "positive" },
    update: { en: "Update", ar: "تحديث", tone: "neutral" },
    restore: { en: "Restore", ar: "استعادة", tone: "attention" },
    conflict: { en: "Conflict", ar: "تعارض", tone: "danger" },
    unknown_status: { en: "Unknown status", ar: "حالة غير معروفة", tone: "muted" },
  };
  const visible = (plan ?? []).filter((p) => showUnchanged || p.kind !== "update" || changed(p));
  const approved = (plan ?? []).filter((p) => p.apply && p.kind !== "unknown_status").length;

  return (
    <Panel
      title={ar ? "استيراد القائمة الرئيسية" : "Import the master list"}
      subtitle={ar
        ? "ارفع ملف Excel؛ تُعرض التغييرات قبل الحفظ. العطاء = الرقم في الكود + القيمة؛ لكل مقاول سجل والقيمة تُحسب مرة واحدة."
        : "Upload the Excel file; changes are shown before anything is saved. A tender = the number in the code + the value; one record per contractor, value counted once."}
      action={
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
          <Upload className="h-4 w-4" />
          {busy ? (ar ? "جارٍ القراءة…" : "Reading…") : (ar ? "اختر ملفًا" : "Choose file")}
          <input type="file" accept=".xlsx,.xls" className="sr-only" disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }} />
        </label>
      }
    >
      {result ? (
        <p className="text-sm">
          {ar ? "النتيجة" : "Result"}: {ar ? "حُدّث" : "updated"} {String(result.updated)} · {ar ? "أُنشئ" : "created"} {String(result.created)} · {ar ? "استُعيد" : "restored"} {String(result.restored)} · {ar ? "تُرك لأنه عُدّل في النظام بعد الملف" : "skipped (edited in the system after the file)"} {String(result.skipped)}
        </p>
      ) : null}
      {!plan ? (
        !result ? <p className="text-sm text-muted-foreground">{ar ? "لم يُرفع ملف بعد." : "No file uploaded yet."}</p> : null
      ) : (
        <div className="grid gap-4">
          <p className="text-sm text-muted-foreground">{fileName}</p>
          <KpiRow className="mb-0">
            <KpiCard label={ar ? "جديد" : "New"} value={formatNumber(counts.create, lang)} />
            <KpiCard label={ar ? "تحديثات" : "Updates"} value={formatNumber(counts.changed + counts.restore, lang)} hint={ar ? `منها ${counts.restore} استعادة` : `${counts.restore} restored`} />
            <KpiCard label={ar ? "بلا تغيير" : "Unchanged"} value={formatNumber(counts.unchanged, lang)} hint={ar ? "تُحدَّث بيانات الملف فقط" : "File details refreshed only"} />
            <KpiCard label={ar ? "تعارضات" : "Conflicts"} value={formatNumber(counts.conflict, lang)} hint={ar ? "تحتاج قرارك" : "Need your decision"} />
            <KpiCard label={ar ? "حالة غير معروفة" : "Unknown status"} value={formatNumber(counts.unknown, lang)} hint={ar ? "لا تُستورد" : "Not imported"} />
          </KpiRow>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showUnchanged} onChange={(e) => setShowUnchanged(e.target.checked)} />
            {ar ? "اعرض الصفوف التي لا تغيير فيها" : "Show rows with no change"}
          </label>
          <div className="max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{ar ? "تطبيق" : "Apply"}</TableHead>
                  <TableHead>{ar ? "النوع" : "Kind"}</TableHead>
                  <TableHead>{ar ? "الكود" : "Code"}</TableHead>
                  <TableHead>{ar ? "المشروع" : "Project"}</TableHead>
                  <TableHead>{ar ? "الحالة في الملف" : "File status"}</TableHead>
                  <TableHead>{ar ? "ما سيتغير" : "What changes"}</TableHead>
                  <TableHead>{ar ? "السبب" : "Why"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((p) => (
                  <TableRow key={p.key} className={p.kind === "conflict" ? "bg-destructive/5" : undefined}>
                    <TableCell>
                      <input type="checkbox" aria-label={ar ? "تطبيق" : "Apply"} checked={p.apply} disabled={p.kind === "unknown_status"} onChange={() => toggle(p.key)} />
                    </TableCell>
                    <TableCell><StatusPill tone={KIND[p.kind].tone}>{ar ? KIND[p.kind].ar : KIND[p.kind].en}</StatusPill></TableCell>
                    <TableCell className="tabular-nums">{p.codes.join(", ")}</TableCell>
                    <TableCell>
                      {p.dealId ? <Link to="/opportunities/$id" params={{ id: p.dealId }} className="hover:underline">{p.row.project ?? "—"}</Link> : p.row.project ?? "—"}
                      {p.countedOn ? <span className="block text-xs text-muted-foreground">{ar ? "مقاول آخر — القيمة تُحسب مرة واحدة" : "Another contractor — value counted once"}</span> : null}
                    </TableCell>
                    <TableCell>{p.row.status ?? "—"}{p.row.priority ? <span className="block text-xs text-muted-foreground">{p.row.priority}</span> : null}</TableCell>
                    <TableCell className="text-sm">{describe(p, lang)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.reason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/40 p-3 text-sm">
            <span>{ar ? "لا كتابة فوق تعديل أحدث في النظام: الصف يُترك ويُذكر." : "No silent overwrite: a deal edited in the system after the file is left as it is and reported."}</span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setPlan(null)} disabled={busy}>{ar ? "إلغاء" : "Cancel"}</Button>
              <Button onClick={() => void onImport()} disabled={busy || approved === 0}>
                {ar ? `استيراد الصفوف المعتمدة (${approved})` : `Import approved rows (${approved})`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}

function changed(p: PlanItem) {
  return Object.keys(p.changes).some((k) => k !== "last_activity_at");
}

function describe(p: PlanItem, lang: "ar" | "en"): string {
  const ar = lang === "ar";
  const parts: string[] = [];
  if (p.changes.sales_stage) parts.push(`${ar ? "المرحلة" : "Stage"} → ${String(p.changes.sales_stage).replace(/_/g, " ")}`);
  if ("quotation_value" in p.changes && p.changes.quotation_value != null) parts.push(`${ar ? "القيمة" : "Value"} → ${formatNumber(Number(p.changes.quotation_value), lang)}`);
  if (p.kind === "create") parts.unshift(ar ? "صفقة جديدة" : "New deal");
  if (p.kind === "restore") parts.unshift(ar ? "إعادة من الأرشيف" : "Back from the archive");
  return parts.length ? parts.join(" · ") : ar ? "تحديث بيانات الملف فقط" : "File details only";
}
