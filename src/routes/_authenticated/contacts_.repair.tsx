// =============================================================================
// Reviewing what the importer did to the contact book, one row at a time.
//
// Every proposal on this screen comes from contact-repair.ts, which reads a
// record and reports only what that record proves. Nothing is written until a
// person ticks a box and presses save.
//
// WHY EMAIL IS TICKED AND THE REST IS NOT
// ---------------------------------------
// The email repairs are verifiable: eleven addresses in the book carry a word
// glued to the front of the local part, or a fragment after the TLD, and every
// one of those addresses BOUNCES today. The rule that fixes them is narrow —
// strip only text that appears elsewhere in the same record and is joined with
// no separator — and it was measured at eleven for eleven.
//
// Names and titles are not in that class. The splitter gets most of them right
// and some of them wrong ("Rahamtallah OmerSenior" keeps a glued word), and a
// title like "Estimation Unit HeadCivil EngineerE:" is readable but ugly. Those
// belong under a human eye and a text cursor, which is why they arrive
// unticked and editable rather than applied in bulk.
//
// The distinction is the point: a repair you can prove is applied by default; a
// repair you can only mostly trust is offered.
// =============================================================================

import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Check, Wrench } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiCard } from "@/components/phc/KpiCard";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { StatusPill } from "@/components/phc/StatusPill";
import { useI18n } from "@/lib/i18n";
import {
  repairContacts,
  repairSummary,
  type ContactRepair,
  type ContactRow,
  type RepairFinding,
} from "../../../supabase/functions/_shared/contact-repair";

export const Route = createFileRoute("/_authenticated/contacts_/repair")({
  component: ContactRepairPage,
});

type FieldKey = "email" | "name" | "title" | "phone";
const FIELDS: FieldKey[] = ["email", "name", "title", "phone"];

/**
 * What arrives ticked.
 *
 * Every email repair, because that rule is provable and eleven addresses
 * bounce without it. Name, title and phone only on rows the parser rated
 * high confidence — those are the ones where the split is backed by a role
 * word and a name-shaped remainder.
 *
 * A low-confidence row still shows its proposal, unticked and editable. The
 * aim is one press for everything defensible, and a human eye only where the
 * evidence genuinely runs out — not a checkbox for all forty-seven fields.
 */
function defaultOn(r: ContactRepair, f: FieldKey): boolean {
  if (r.proposed[f] === undefined) return false;
  if (f === "email") return true;
  return r.confidence === "high";
}

function findingText(f: RepairFinding, lang: "en" | "ar"): string {
  switch (f.kind) {
    case "email_prefix_stripped":
      return lang === "ar"
        ? `أُزيل «${f.removed}» من بداية العنوان — ${f.because}`
        : `removed "${f.removed}" from the front — ${f.because}`;
    case "email_suffix_stripped":
      return lang === "ar"
        ? `أُزيل «${f.removed}» بعد نهاية النطاق`
        : `removed "${f.removed}" trailing the domain`;
    case "email_recovered_from_name":
      return lang === "ar" ? "العنوان استُخرج من داخل الاسم" : "address recovered from inside the name";
    case "phone_recovered_from_name":
      return lang === "ar" ? "الرقم استُخرج من داخل الاسم" : "number recovered from inside the name";
    case "title_recovered_from_name":
      return lang === "ar" ? "المسمّى استُخرج من داخل الاسم" : "title recovered from inside the name";
    case "encoding_damage":
      return lang === "ar"
        ? `${f.count} محرف تلف ترميز في هذا السجل`
        : `${f.count} encoding-damage character(s) in this record`;
    case "name_shortened":
      return lang === "ar"
        ? `الاسم كان ${f.from} حرفًا، صار ${f.to}`
        : `name was ${f.from} characters, now ${f.to}`;
    case "name_not_splittable":
      return lang === "ar" ? `لم يُقترح اسم — ${f.why}` : `no name proposed — ${f.why}`;
    case "email_still_suspect":
      return lang === "ar" ? `العنوان ما زال مشبوهًا — ${f.why}` : `address still suspect — ${f.why}`;
  }
}

function ContactRepairPage() {
  const { lang } = useI18n();
  const qc = useQueryClient();
  const ar = lang === "ar";

  const { data, isLoading } = useQuery({
    queryKey: ["contacts-repair"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contacts")
        .select("id, name, title, email, phone, companies(name)")
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as unknown as Array<{
        id: string; name: string | null; title: string | null;
        email: string | null; phone: string | null; companies: { name: string } | null;
      }>;
    },
  });

  const repairs = useMemo<ContactRepair[]>(() => {
    const rows: ContactRow[] = (data ?? []).map((c) => ({
      id: c.id, name: c.name, title: c.title, email: c.email, phone: c.phone,
      companyName: c.companies?.name ?? null,
    }));
    return repairContacts(rows).filter((r) => Object.keys(r.proposed).length > 0);
  }, [data]);

  const summary = useMemo(() => {
    const rows: ContactRow[] = (data ?? []).map((c) => ({
      id: c.id, name: c.name, title: c.title, email: c.email, phone: c.phone,
      companyName: c.companies?.name ?? null,
    }));
    return repairSummary(repairContacts(rows));
  }, [data]);

  /** Per row, per field: is it ticked, and what text would be written. */
  const [picked, setPicked] = useState<Record<string, Partial<Record<FieldKey, boolean>>>>({});
  const [edited, setEdited] = useState<Record<string, Partial<Record<FieldKey, string>>>>({});
  const [saving, setSaving] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  const isOn = (r: ContactRepair, f: FieldKey) => picked[r.id]?.[f] ?? defaultOn(r, f);
  const valueOf = (r: ContactRepair, f: FieldKey) => edited[r.id]?.[f] ?? r.proposed[f] ?? "";

  const toggle = (id: string, f: FieldKey, on: boolean) =>
    setPicked((p) => ({ ...p, [id]: { ...p[id], [f]: on } }));

  const selectedCount = repairs.reduce(
    (n, r) => n + FIELDS.filter((f) => r.proposed[f] !== undefined && isOn(r, f)).length, 0);

  async function applySelected() {
    setSaving(true);
    let ok = 0;
    let failed = 0;
    const done = new Set(savedIds);
    for (const r of repairs) {
      // Typed against the generated row so a stray key cannot reach the table.
      const patch: { name?: string; title?: string; email?: string; phone?: string } = {};
      for (const f of FIELDS) {
        if (r.proposed[f] === undefined || !isOn(r, f)) continue;
        const v = valueOf(r, f).trim();
        if (v !== "") patch[f] = v;

      }
      if (Object.keys(patch).length === 0) continue;
      const { error } = await supabase.from("contacts").update(patch).eq("id", r.id);
      if (error) { failed += 1; continue; }
      ok += 1;
      done.add(r.id);
    }
    setSavedIds(done);
    setSaving(false);
    await qc.invalidateQueries({ queryKey: ["contacts-repair"] });
    await qc.invalidateQueries({ queryKey: ["contacts"] });
    if (failed > 0) {
      toast.error(ar ? `حُفظ ${ok}، وتعذّر ${failed}` : `${ok} saved, ${failed} failed`);
    } else {
      toast.success(ar ? `حُفظ ${ok} سجلًا` : `${ok} record(s) saved`);
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <PageHeader
        eyebrow={ar ? "جهات الاتصال" : "Contacts"}
        title={ar ? "إصلاح بيانات الاستيراد" : "Repair imported data"}
        description={
          ar
            ? "كل اقتراح مبنيّ على ما يثبته السجل نفسه. لا شيء يُحفظ قبل أن تختاره."
            : "Every proposal is drawn from what the record itself proves. Nothing is saved until you choose it."
        }
      />

      <div className="mb-4">
        <Link to="/contacts" search={{ q: "" } as never} className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
          {ar ? "رجوع إلى جهات الاتصال" : "Back to contacts"}
        </Link>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label={ar ? "سجلات فيها اقتراح" : "Rows with a proposal"} value={summary.total - summary.none} />
        <KpiCard label={ar ? "سليمة — لا تُمَس" : "Clean — left alone"} value={summary.none} />
        <KpiCard label={ar ? "عناوين بريد تُصلَح" : "Email addresses repaired"} value={summary.emails} />
        <KpiCard label={ar ? "تحتاج عينًا بشرية" : "Needs a human eye"} value={summary.low} />
      </div>

      {/* The one thing a reader should understand before ticking anything. */}
      <div className="mb-5 rounded-lg border border-amber/40 bg-amber/10 px-4 py-3 text-[12px] text-foreground">
        {ar
          ? "كل ما يمكن إثباته مُحدَّد مسبقًا: إصلاحات البريد كلها، والأسماء والمسمّيات في الصفوف عالية الثقة. اضغط «احفظ المحدَّد» مرة واحدة. الصفوف المعلَّمة «راجعه» تُعرض بلا تحديد لأن الدليل فيها ينقطع — حرّرها إن شئت أو اتركها."
          : "Everything provable arrives ticked: all the email repairs, and names and titles on high-confidence rows. One press of Save applies them. Rows marked \"review this\" arrive unticked because the evidence runs out there — edit them or leave them."}
      </div>

      {isLoading ? (
        <SkeletonTable />
      ) : repairs.length === 0 ? (
        <EmptyState message={ar ? "لا يوجد ما يُصلَح" : "Nothing to repair"} />
      ) : (
        <>
          <div className="space-y-3">
            {repairs.map((r) => {
              const saved = savedIds.has(r.id);
              return (
                <div
                  key={r.id}
                  className={`rounded-xl border px-4 py-3 ${
                    saved ? "border-positive/40 bg-positive/5" : "border-border/70 bg-surface/60"
                  }`}
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <StatusPill tone={r.confidence === "high" ? "positive" : "attention"}>
                      {r.confidence === "high"
                        ? ar ? "ثقة عالية" : "high confidence"
                        : ar ? "راجعه" : "review this"}
                    </StatusPill>
                    {saved ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-positive">
                        <Check className="h-3 w-3" aria-hidden="true" />
                        {ar ? "حُفظ" : "saved"}
                      </span>
                    ) : null}
                    <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                      {r.current.name}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {FIELDS.filter((f) => r.proposed[f] !== undefined).map((f) => (
                      <div key={f} className="grid gap-2 sm:grid-cols-[auto_1fr_1fr] sm:items-center">
                        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={isOn(r, f)}
                            disabled={saved}
                            onChange={(e) => toggle(r.id, f, e.target.checked)}
                            className="h-3.5 w-3.5 accent-amber"
                          />
                          <span className="w-16 shrink-0">
                            {f === "email" ? (ar ? "البريد" : "Email")
                              : f === "name" ? (ar ? "الاسم" : "Name")
                              : f === "title" ? (ar ? "المسمّى" : "Title")
                              : (ar ? "الجوال" : "Phone")}
                          </span>
                        </label>

                        {/* Current, shown in full — the reader is judging a change. */}
                        <div className="min-w-0 break-words text-[11px] text-muted-foreground line-through decoration-muted-foreground/40">
                          {r.current[f] ?? (ar ? "(فارغ)" : "(empty)")}
                        </div>

                        <input
                          type="text"
                          value={valueOf(r, f)}
                          disabled={saved}
                          onChange={(e) =>
                            setEdited((p) => ({ ...p, [r.id]: { ...p[r.id], [f]: e.target.value } }))
                          }
                          className="w-full rounded-md border border-border bg-surface px-2 py-1 text-[12px] text-foreground focus:border-border-strong focus:outline-none"
                        />
                      </div>
                    ))}
                  </div>

                  {r.findings.length > 0 ? (
                    <ul className="mt-2 space-y-0.5 border-t border-border/40 pt-2">
                      {r.findings.map((f, i) => (
                        <li key={i} className="text-[10px] text-muted-foreground">
                          {findingText(f, lang)}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="sticky bottom-4 mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-strong bg-surface px-4 py-3 shadow-lg">
            <div className="flex items-center gap-3">
              <span className="text-[12px] text-muted-foreground">
                {ar ? `${selectedCount} حقلًا محدَّدًا للحفظ` : `${selectedCount} field(s) selected`}
              </span>
              <button
                type="button"
                onClick={() =>
                  setPicked(Object.fromEntries(
                    repairs.map((r) => [r.id, Object.fromEntries(FIELDS.map((f) => [f, false]))]),
                  ))
                }
                className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
              >
                {ar ? "ألغِ التحديد كله" : "clear all"}
              </button>
            </div>
            <button
              type="button"
              onClick={applySelected}
              disabled={saving || selectedCount === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber px-4 py-2 text-[12px] font-medium text-amber-foreground disabled:opacity-40"
            >
              <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
              {saving ? (ar ? "جارٍ الحفظ…" : "Saving…") : (ar ? "احفظ المحدَّد" : "Save selected")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
