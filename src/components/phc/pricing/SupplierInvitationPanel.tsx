import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/phc/Panel";
import { StatusPill } from "@/components/phc/StatusPill";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { useI18n, localeFor } from "@/lib/i18n";
import {
  cancelInvitation, extendInvitation, listInvitationFiles, listInvitationSubmissions, listVendors,
  OPEN_INVITATION, type InvitationRow, type InvitationStatus,
} from "@/lib/pricing-actions";
import { daysLeft, inviteMessage, portalLink, riyadhToday } from "@/lib/supplier-portal";
import { asError, pick, type Bi } from "@/lib/pricing-text";
import { CopyText } from "@/components/phc/pricing/CopyText";
import { SupplierAccountsPanel } from "@/components/phc/pricing/SupplierAccountsPanel";
import type { PricingRights } from "@/lib/pricing-access";

const TEXT = {
  title: { en: "Request to the supplier", ar: "طلب المورد" },
  supplier: { en: "Supplier", ar: "المورد" },
  sentAt: { en: "Sent", ar: "أُرسل" },
  replyBy: { en: "Reply by", ar: "موعد الرد" },
  opened: { en: "Opened by the supplier", ar: "فتحه المورد" },
  notOpened: { en: "Not opened yet", ar: "لم يُفتح بعد" },
  overdue: { en: "Overdue by", ar: "متأخر" },
  left: { en: "days left", ar: "يوم متبقٍ" },
  days: { en: "days", ar: "يوم" },
  files: { en: "Files sent", ar: "الملفات المرسلة" },
  submissions: { en: "Answers", ar: "الردود" },
  byPortal: { en: "Submitted by the supplier", ar: "أرسله المورد" },
  onBehalf: { en: "Entered on the supplier's behalf", ar: "أُدخل نيابة عن المورد" },
  confirmed: { en: "Confirmed:", ar: "أكّد:" },
  linesWord: { en: "lines", ar: "بنود" },
  message: { en: "Message to send the supplier (your email or WhatsApp)", ar: "الرسالة المرسلة للمورد (بريدك أو واتساب)" },
  extend: { en: "Change the reply-by date", ar: "غيّر موعد الرد" },
  extendTitle: { en: "New reply-by date", ar: "موعد رد جديد" },
  extended: { en: "Reply-by date changed", ar: "تغيّر موعد الرد" },
  cancel: { en: "Cancel this request", ar: "ألغِ هذا الطلب" },
  cancelTitle: { en: "Cancel the request to the supplier", ar: "إلغاء طلب المورد" },
  cancelDesc: { en: "The supplier will no longer see it. The file stays at the supplier: send a new request, or enter the prices on their behalf.", ar: "لن يراه المورد بعد الآن. يبقى الملف عند المورد: أرسل طلباً جديداً أو أدخل الأسعار نيابة عنه." },
  reason: { en: "Reason", ar: "السبب" },
  cancelled: { en: "Request cancelled", ar: "أُلغي الطلب" },
  save: { en: "Save", ar: "احفظ" },
} satisfies Record<string, Bi>;

const STATUS_LABEL: Record<InvitationStatus, Bi> = {
  sent: { en: "Sent", ar: "أُرسل" },
  opened: { en: "Opened", ar: "فُتح" },
  submitted: { en: "Answered", ar: "رُدّ عليه" },
  reopened: { en: "Lines returned", ar: "أُرجعت بنود" },
  cancelled: { en: "Cancelled", ar: "ملغى" },
};
const STATUS_TONE: Record<InvitationStatus, "neutral" | "attention" | "positive" | "muted"> = {
  sent: "neutral",
  opened: "neutral",
  submitted: "positive",
  reopened: "attention",
  cancelled: "muted",
};

export function SupplierInvitationPanel({
  invitation, rights, onChanged,
}: { invitation: InvitationRow; rights: PricingRights; onChanged: () => void }) {
  const { lang } = useI18n();
  const vendors = useQuery({ queryKey: ["pricing-vendors"], queryFn: listVendors });
  const files = useQuery({ queryKey: ["pricing-invitation-files", invitation.id], queryFn: () => listInvitationFiles(invitation.id) });
  const answers = useQuery({ queryKey: ["pricing-invitation-submissions", invitation.id], queryFn: () => listInvitationSubmissions(invitation.id) });
  const [dialog, setDialog] = useState<"extend" | "cancel" | null>(null);
  const isOpen = OPEN_INVITATION.includes(invitation.status);
  const today = riyadhToday();
  const left = daysLeft(invitation.reply_by, today);
  const when = (iso: string) => new Date(iso).toLocaleString(localeFor(lang));
  const vendorName = vendors.data?.find((v) => v.id === invitation.vendor_id)?.name ?? "—";
  const link = portalLink(window.location.origin, invitation.id);

  return (
    <Panel title={pick(TEXT.title, lang)}>
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={STATUS_TONE[invitation.status]}>{pick(STATUS_LABEL[invitation.status], lang)}</StatusPill>
          <span>{pick(TEXT.supplier, lang)}: {vendorName}</span>
          <span className="text-muted-foreground">{pick(TEXT.sentAt, lang)} {when(invitation.sent_at)}</span>
        </div>
        {isOpen ? (
          <p>
            {pick(TEXT.replyBy, lang)} {new Date(`${invitation.reply_by}T00:00:00`).toLocaleDateString(localeFor(lang))} ·{" "}
            {left < 0 ? (
              <StatusPill tone="danger">{pick(TEXT.overdue, lang)} {-left} {pick(TEXT.days, lang)}</StatusPill>
            ) : (
              <span>{left} {pick(TEXT.left, lang)}</span>
            )}{" "}
            · {invitation.opened_at ? `${pick(TEXT.opened, lang)} ${when(invitation.opened_at)}` : pick(TEXT.notOpened, lang)}
          </p>
        ) : null}

        {(files.data ?? []).length > 0 ? (
          <div>
            <p className="text-muted-foreground">{pick(TEXT.files, lang)}</p>
            <ul className="list-disc ps-5">{(files.data ?? []).map((f) => <li key={f.id} dir="ltr" className="text-start">{f.display_name}</li>)}</ul>
          </div>
        ) : null}

        {(answers.data ?? []).length > 0 ? (
          <div className="space-y-1">
            <p className="text-muted-foreground">{pick(TEXT.submissions, lang)}</p>
            {(answers.data ?? []).map((s) => (
              <div key={s.id} className="rounded-md border border-border p-2">
                <p>
                  {pick(s.source === "portal" ? TEXT.byPortal : TEXT.onBehalf, lang)} · {when(s.submitted_at)} · {s.lines} {pick(TEXT.linesWord, lang)}
                </p>
                {s.confirmation_text ? <p className="text-xs text-muted-foreground">{pick(TEXT.confirmed, lang)} {s.confirmation_text}</p> : null}
              </div>
            ))}
          </div>
        ) : null}

        {isOpen ? <CopyText label={pick(TEXT.message, lang)} text={inviteMessage(link, lang)} /> : null}

        {isOpen && rights.is_pricer ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setDialog("extend")}>{pick(TEXT.extend, lang)}</Button>
            <Button variant="outline" onClick={() => setDialog("cancel")}>{pick(TEXT.cancel, lang)}</Button>
          </div>
        ) : null}
        {isOpen && rights.is_pricer ? <SupplierAccountsPanel vendorId={invitation.vendor_id} /> : null}
      </div>

      <ActionDialog
        open={dialog === "extend"}
        onOpenChange={(v) => setDialog(v ? "extend" : null)}
        title={pick(TEXT.extendTitle, lang)}
        fields={[{ key: "reply_by", type: "date", label: pick(TEXT.replyBy, lang), required: true, defaultValue: invitation.reply_by }]}
        submitLabel={pick(TEXT.save, lang)}
        recordId={invitation.id}
        onSubmit={async (v) => {
          try {
            await extendInvitation(invitation.id, v.reply_by);
            toast.success(pick(TEXT.extended, lang));
            onChanged();
          } catch (e) {
            throw asError(e, lang);
          }
        }}
      />
      <ActionDialog
        open={dialog === "cancel"}
        onOpenChange={(v) => setDialog(v ? "cancel" : null)}
        title={pick(TEXT.cancelTitle, lang)}
        description={pick(TEXT.cancelDesc, lang)}
        fields={[{ key: "reason", type: "textarea", label: pick(TEXT.reason, lang), required: true }]}
        submitLabel={pick(TEXT.cancel, lang)}
        destructive
        recordId={invitation.id}
        onSubmit={async (v) => {
          try {
            await cancelInvitation(invitation.id, v.reason);
            toast.success(pick(TEXT.cancelled, lang));
            onChanged();
          } catch (e) {
            throw asError(e, lang);
          }
        }}
      />
    </Panel>
  );
}
