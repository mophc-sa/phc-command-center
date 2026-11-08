import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Panel } from "@/components/phc/Panel";
import { StatusPill } from "@/components/phc/StatusPill";
import { useI18n, localeFor, formatNumber } from "@/lib/i18n";
import { formatBytes } from "@/lib/document-actions";
import { draftText } from "@/lib/pricing-input";
import { dbMessage, draftError, pick, type Bi } from "@/lib/pricing-text";
import {
  buildSubmission, daysLeft, LEAD_RULES, PORTAL_CONFIRMATION, PORTAL_STATUS_LABEL, PRICE_RULES, riyadhToday,
  type LineDraft, type PortalFile, type PortalInvitation, type PortalLine, type SubmissionProblem, type TermsDraft,
} from "@/lib/supplier-portal";
import { downloadPortalFile, submitPortalQuote } from "@/lib/supplier-portal-actions";

const TEXT = {
  replyBy: { en: "Reply by", ar: "موعد الرد" },
  daysLeft: { en: "days left", ar: "يوم متبقٍ" },
  late: { en: "Late by", ar: "متأخر" },
  days: { en: "days", ar: "يوم" },
  fromPhc: { en: "From PHC", ar: "من PHC" },
  returned: { en: "Returned for changes", ar: "أُعيد للتعديل" },
  files: { en: "Files", ar: "الملفات" },
  filesHint: { en: "Price only from these files.", ar: "سعّر فقط من هذه الملفات." },
  download: { en: "Download", ar: "تنزيل" },
  lines: { en: "Lines", ar: "البنود" },
  item: { en: "Item", ar: "البند" },
  qty: { en: "Qty", ar: "الكمية" },
  unitPrice: { en: "Unit price (SAR)", ar: "سعر الوحدة (ريال)" },
  withScreen: { en: "With screen (SAR)", ar: "مع الشاشة (ريال)" },
  differs: { en: "Differs from spec", ar: "يختلف عن المواصفة" },
  hasScreen: { en: "Screen", ar: "شاشة" },
  locked: { en: "Submitted", ar: "أُرسل" },
  terms: { en: "Terms", ar: "الشروط" },
  lead: { en: "Lead time (days)", ar: "مدة التوريد (أيام)" },
  payment: { en: "Payment terms", ar: "شروط الدفع" },
  valid: { en: "Offer valid until", ar: "العرض صالح حتى" },
  confirm: { en: "I confirm:", ar: "أؤكد:" },
  submit: { en: "Submit prices", ar: "أرسل الأسعار" },
  submitting: { en: "Submitting…", ar: "جارٍ الإرسال…" },
  submitted: { en: "Your prices were sent to PHC.", ar: "أُرسلت أسعاركم إلى PHC." },
  readOnly: { en: "This request no longer takes prices. You can still read what you sent.", ar: "هذا الطلب لم يعد يقبل أسعاراً. يمكنكم قراءة ما أرسلتم." },
  fix: { en: "Some boxes need fixing before you submit.", ar: "بعض الحقول تحتاج تصحيحاً قبل الإرسال." },
  required: { en: "Required.", ar: "مطلوب." },
  tooLong: { en: "Too long.", ar: "أطول من المسموح." },
  pastDate: { en: "The date has passed.", ar: "التاريخ مضى." },
  noPrice: { en: "Price at least one line.", ar: "سعّر بنداً واحداً على الأقل." },
  mustConfirm: { en: "Tick the confirmation first.", ar: "ضع علامة التأكيد أولاً." },
} satisfies Record<string, Bi>;

const FIELD =
  "w-full min-w-24 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60";

/** The specs a factory prices from, in one line. */
function specs(l: PortalLine): string {
  const size = l.width_mm != null && l.height_mm != null ? `${l.width_mm} × ${l.height_mm} mm` : null;
  return [l.description, l.dimensions, size, l.material, l.mounting, l.illumination, l.finish].filter(Boolean).join(" · ");
}

export function InvitationForm({ invitation }: { invitation: PortalInvitation }) {
  const { lang } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const today = riyadhToday();
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({});
  const [terms, setTerms] = useState<TermsDraft>({
    lead: draftText(invitation.terms.lead_time_days),
    payment: invitation.terms.payment_terms ?? "",
    valid: invitation.terms.valid_until ?? "",
  });
  const [errors, setErrors] = useState<Record<string, SubmissionProblem>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const left = daysLeft(invitation.reply_by, today);

  const problemText = (p: SubmissionProblem, rules = PRICE_RULES): string =>
    p === "required" ? pick(TEXT.required, lang)
      : p === "too_long" ? pick(TEXT.tooLong, lang)
        : p === "past_date" ? pick(TEXT.pastDate, lang)
          : p === "no_price" ? pick(TEXT.noPrice, lang)
            : draftError(p, lang, rules);
  const err = (key: string, rules = PRICE_RULES) =>
    errors[key] ? <span className="block text-xs text-destructive">{problemText(errors[key], rules)}</span> : null;
  const value = (l: PortalLine, k: keyof LineDraft): string => {
    const typed = drafts[l.line_id]?.[k];
    if (typed !== undefined) return typed;
    return k === "spec_difference" ? (l.spec_difference ?? "") : draftText(l[k]);
  };
  const setCell = (lineId: string, k: keyof LineDraft, v: string) => {
    setDrafts((d) => ({ ...d, [lineId]: { ...d[lineId], [k]: v } }));
    setErrors((e) => { const { [`${lineId}:${k}`]: _gone, ...rest } = e; return rest; });
  };

  // The bytes come back from sales-os-api; save them under the neutral name.
  async function download(f: PortalFile) {
    try {
      const blob = await downloadPortalFile(invitation.invitation_id, f.file_id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = f.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      toast.error(dbMessage(e, lang));
    }
  }

  async function submit() {
    if (busy) return;
    if (!confirmed) { toast.error(pick(TEXT.mustConfirm, lang)); return; }
    const built = buildSubmission(invitation.lines, drafts, terms, today);
    if (!built.ok) {
      setErrors(Object.fromEntries(built.errors.map((e) => [e.key, e.problem])));
      toast.error(pick(built.errors.some((e) => e.key === "lines") ? TEXT.noPrice : TEXT.fix, lang));
      return;
    }
    setBusy(true);
    try {
      await submitPortalQuote(invitation.invitation_id, built.lines, built.terms, lang);
      toast.success(pick(TEXT.submitted, lang));
      await qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("supplier-portal") });
      void navigate({ to: "/supplier" });
    } catch (e) {
      toast.error(dbMessage(e, lang));
    } finally {
      setBusy(false);
    }
  }

  const priceBox = (l: PortalLine, k: "unit_cost" | "unit_cost_with_screen", label: Bi) =>
    l.editable ? (
      <>
        <input type="text" inputMode="decimal" dir="ltr" className={FIELD} disabled={busy} aria-label={`${pick(label, lang)}: ${l.sign_type ?? ""}`}
          aria-invalid={errors[`${l.line_id}:${k}`] ? true : undefined}
          value={value(l, k)} onChange={(e) => setCell(l.line_id, k, e.target.value)} />
        {err(`${l.line_id}:${k}`)}
      </>
    ) : (
      <span className="tabular-nums">{l[k] == null ? "—" : formatNumber(l[k], lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <StatusPill tone={invitation.editable ? "attention" : "muted"}>{pick(PORTAL_STATUS_LABEL[invitation.status], lang)}</StatusPill>
        <span>{pick(TEXT.replyBy, lang)} {new Date(`${invitation.reply_by}T00:00:00`).toLocaleDateString(localeFor(lang))}</span>
        {invitation.editable ? (
          left < 0 ? <StatusPill tone="danger">{pick(TEXT.late, lang)} {-left} {pick(TEXT.days, lang)}</StatusPill>
            : <span className="text-muted-foreground">{left} {pick(TEXT.daysLeft, lang)}</span>
        ) : null}
      </div>
      {!invitation.editable ? <p className="text-sm text-muted-foreground">{pick(TEXT.readOnly, lang)}</p> : null}
      {invitation.editable && invitation.return_message ? (
        <Panel title={pick(TEXT.returned, lang)} tone="attention"><p className="whitespace-pre-line text-sm" dir="auto">{invitation.return_message}</p></Panel>
      ) : null}
      {invitation.instructions ? (
        <Panel title={pick(TEXT.fromPhc, lang)}><p className="whitespace-pre-line text-sm" dir="auto">{invitation.instructions}</p></Panel>
      ) : null}

      {invitation.editable ? (
      <Panel title={pick(TEXT.files, lang)} subtitle={pick(TEXT.filesHint, lang)}>
        <ul className="space-y-2 text-sm">
          {invitation.files.map((f) => (
            <li key={f.file_id} className="flex flex-wrap items-center gap-2">
              <span dir="ltr">{f.name}</span>
              <span className="text-xs text-muted-foreground">{formatBytes(f.size_bytes)}</span>
              <Button size="sm" variant="outline" onClick={() => void download(f)}>
                <Download className="me-1 h-3.5 w-3.5" aria-hidden="true" />{pick(TEXT.download, lang)}
              </Button>
            </li>
          ))}
        </ul>
      </Panel>
      ) : null}

      <Panel title={pick(TEXT.lines, lang)}>
        {err("lines")}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{pick(TEXT.item, lang)}</TableHead>
                <TableHead className="text-end">{pick(TEXT.qty, lang)}</TableHead>
                <TableHead>{pick(TEXT.unitPrice, lang)}</TableHead>
                <TableHead>{pick(TEXT.withScreen, lang)}</TableHead>
                <TableHead>{pick(TEXT.differs, lang)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitation.lines.map((l) => (
                <TableRow key={l.line_id}>
                  <TableCell className="min-w-48 align-top">
                    <div className="font-medium">{l.line_number != null ? `${l.line_number}. ` : ""}{l.sign_type}</div>
                    <div className="text-xs text-muted-foreground" dir="auto">{specs(l)}</div>
                    {l.has_screen ? <StatusPill tone="neutral" className="mt-1">{pick(TEXT.hasScreen, lang)}</StatusPill> : null}
                    {!l.editable && invitation.editable ? <StatusPill tone="muted" className="ms-1 mt-1">{pick(TEXT.locked, lang)}</StatusPill> : null}
                  </TableCell>
                  <TableCell className="text-end align-top tabular-nums">{formatNumber(l.quantity, lang)} {l.unit ?? ""}</TableCell>
                  <TableCell className="align-top">{priceBox(l, "unit_cost", TEXT.unitPrice)}</TableCell>
                  <TableCell className="align-top">{priceBox(l, "unit_cost_with_screen", TEXT.withScreen)}</TableCell>
                  <TableCell className="min-w-48 align-top">
                    {l.editable ? (
                      <>
                        <input type="text" maxLength={500} dir="auto" className={FIELD} disabled={busy} aria-label={`${pick(TEXT.differs, lang)}: ${l.sign_type ?? ""}`}
                          value={value(l, "spec_difference")} onChange={(e) => setCell(l.line_id, "spec_difference", e.target.value)} />
                        {err(`${l.line_id}:spec_difference`)}
                      </>
                    ) : (
                      <span dir="auto">{l.spec_difference ?? "—"}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Panel>

      <Panel title={pick(TEXT.terms, lang)}>
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <label className="space-y-1">
            <span>{pick(TEXT.lead, lang)}</span>
            <input type="text" inputMode="numeric" dir="ltr" className={FIELD} disabled={busy || !invitation.editable}
              value={terms.lead} onChange={(e) => { setTerms((t) => ({ ...t, lead: e.target.value })); setErrors((x) => { const { lead: _gone, ...rest } = x; return rest; }); }} />
            {err("lead", LEAD_RULES)}
          </label>
          <label className="space-y-1">
            <span>{pick(TEXT.payment, lang)}</span>
            <input type="text" maxLength={500} dir="auto" className={FIELD} disabled={busy || !invitation.editable}
              value={terms.payment} onChange={(e) => { setTerms((t) => ({ ...t, payment: e.target.value })); setErrors((x) => { const { payment: _gone, ...rest } = x; return rest; }); }} />
            {err("payment")}
          </label>
          <label className="space-y-1">
            <span>{pick(TEXT.valid, lang)}</span>
            <input type="date" min={today} className={FIELD} disabled={busy || !invitation.editable}
              value={terms.valid} onChange={(e) => { setTerms((t) => ({ ...t, valid: e.target.value })); setErrors((x) => { const { valid: _gone, ...rest } = x; return rest; }); }} />
            {err("valid")}
          </label>
        </div>
      </Panel>

      {invitation.editable ? (
        <div className="space-y-3 rounded-md border border-border p-4 text-sm">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" disabled={busy} checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span><strong>{pick(TEXT.confirm, lang)}</strong> {pick(PORTAL_CONFIRMATION, lang)}</span>
          </label>
          <Button disabled={busy || !confirmed} onClick={() => void submit()}>{pick(busy ? TEXT.submitting : TEXT.submit, lang)}</Button>
        </div>
      ) : null}
    </div>
  );
}
