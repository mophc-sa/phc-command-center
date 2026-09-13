// "Email via Outlook" — compose modal.
//
// Phase 1 only handed a draft to Outlook with `mailto:`. Phase 2 (2026-09-13)
// adds a Send button that sends from inside the system — but ONLY when the
// backend reports sending is configured. Until then the modal is exactly Phase 1.
//
//   - Send goes through the `send_email` backend action. The browser never holds
//     the provider token and never chooses the sender: the backend sends from the
//     caller's own company address and records the activity as sent.
//   - Only an explicit click sends. There is no automatic, scheduled or bulk path.
//   - "Open in Outlook" stays, as the fallback when sending is not configured and
//     for anyone who prefers to finish the email in Outlook.
//   - If a recipient email is missing, disable both send actions but keep "Copy
//     email text" enabled so the user can still use the draft.

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Copy, ExternalLink, Loader2, Mail, Send } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMailStatus, sendEmail } from "@/lib/mail-actions";
import { useI18n } from "@/lib/i18n";
import {
  buildEmailDraft,
  MAILTO_MAX_LENGTH,
  validateEmailDraft,
  type EmailContext,
  type EmailTemplateKind,
} from "@/lib/email-templates";
import { logOutlookComposeOpened } from "@/lib/outlook-compose";

export type EmailLinkedRecord = {
  type:
    | "company"
    | "contact"
    | "opportunity"
    | "project"
    | "tender"
    | "rfq"
    | "follow_up"
    | "ai_recommendation";
  id: string;
  label?: string | null;
  opportunityId?: string | null;
  companyId?: string | null;
  contactId?: string | null;
  rfqId?: string | null;
  tenderId?: string | null;
};

export function EmailComposeModal({
  open,
  onOpenChange,
  template,
  context,
  linked,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  template: EmailTemplateKind;
  context: EmailContext;
  linked?: EmailLinkedRecord | null;
}) {
  const { t, lang, dir } = useI18n();
  const draft = useMemo(() => buildEmailDraft(template, { ...context, lang }), [template, context, lang]);

  const [to, setTo] = useState(context.recipientEmail ?? "");
  const [cc, setCc] = useState((context.ccEmails ?? []).join(", "));
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);

  useEffect(() => {
    if (!open) return;
    setTo(context.recipientEmail ?? "");
    setCc((context.ccEmails ?? []).join(", "));
    setSubject(draft.subject);
    setBody(draft.body);
    // reset when template / context changes while opening
  }, [open, draft.subject, draft.body, context.recipientEmail, context.ccEmails]);

  const validation = validateEmailDraft({
    to,
    cc: cc.split(",").map((s) => s.trim()).filter(Boolean),
    subject,
    body,
  });
  const canOpen = validation.ok;
  const oversize = validation.ok && validation.truncated;

  // Sending is offered only when the backend says the provider is configured.
  // A failed or pending status check falls back to Phase 1 behaviour rather than
  // showing a button that would refuse.
  const qc = useQueryClient();
  const mailStatus = useQuery({ queryKey: ["mail-status"], queryFn: getMailStatus, staleTime: 5 * 60_000, enabled: open });
  const canSendHere = mailStatus.data?.sending === true;
  const [sending, setSending] = useState(false);

  async function handleSend() {
    if (!validation.ok || sending) return;
    setSending(true);
    try {
      const r = await sendEmail({
        to,
        cc,
        subject,
        body,
        opportunityId: linked?.opportunityId ?? null,
        companyId: linked?.companyId ?? null,
        contactId: linked?.contactId ?? null,
        rfqId: linked?.rfqId ?? null,
        tenderId: linked?.tenderId ?? null,
      });
      if (r.logged) toast.success(t("email_sent_ok"));
      else toast.warning(t("email_sent_unlogged"));
      void qc.invalidateQueries();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("toast_error"));
    } finally {
      setSending(false);
    }
  }

  async function handleOpenInOutlook() {
    if (!validation.ok) return;
    // Log first (best-effort), then hand off to the OS mail client.
    try {
      if (linked) {
        await logOutlookComposeOpened({
          linked_record_type: linked.type,
          linked_record_id: linked.id,
          recipient_email: to,
          subject,
          opportunityId: linked.opportunityId ?? null,
          companyId: linked.companyId ?? null,
          contactId: linked.contactId ?? null,
          rfqId: linked.rfqId ?? null,
          tenderId: linked.tenderId ?? null,
          body,
        });
      }
    } catch {
      // Never block the compose action on a logging failure.
    }
    // window.location assignment triggers the OS mail handler.
    window.location.href = validation.url;
    if (oversize) {
      toast.message(t("email_mailto_truncated_hint"));
    }
    onOpenChange(false);
  }

  async function handleCopy() {
    const full = subject ? `${subject}\n\n${body}` : body;
    try {
      await navigator.clipboard.writeText(full);
      toast.success(t("email_copied"));
    } catch {
      toast.error(t("toast_error"));
    }
  }

  const missingHint =
    !to && (t("email_no_recipient") as string);
  const invalidHint =
    to && !canOpen && validation.ok === false && validation.reason === "invalid_recipient"
      ? (t("email_invalid_recipient") as string)
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={dir} className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" /> {t("email_via_outlook")}
          </DialogTitle>
          <DialogDescription>{canSendHere ? t("email_send_desc") : t("email_compose_desc")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          {linked?.label ? (
            <div className="rounded-md border border-border/70 bg-surface/60 px-3 py-2 text-xs text-muted-foreground">
              <span className="tracking-[0.02em]">{t("email_linked_record")}:</span>{" "}
              <span className="text-foreground">{linked.label}</span>
            </div>
          ) : null}

          <div className="grid gap-1.5">
            <Label htmlFor="email-to" className="text-xs tracking-[0.02em] text-muted-foreground">
              {t("email_to")}
            </Label>
            <Input
              id="email-to"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="name@example.com"
              type="email"
              autoComplete="off"
            />
            {missingHint ? <p className="text-xs text-amber-light">{missingHint}</p> : null}
            {invalidHint ? <p className="text-xs text-amber-light">{invalidHint}</p> : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="email-cc" className="text-xs tracking-[0.02em] text-muted-foreground">
              {t("email_cc")}
            </Label>
            <Input
              id="email-cc"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder="cc1@example.com, cc2@example.com"
              autoComplete="off"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="email-subject" className="text-xs tracking-[0.02em] text-muted-foreground">
              {t("email_subject")}
            </Label>
            <Input id="email-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="email-body" className="text-xs tracking-[0.02em] text-muted-foreground">
              {t("email_body")}
            </Label>
            <Textarea
              id="email-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              className="font-[inherit]"
            />
            {oversize ? (
              <p className="text-xs text-amber-light">{t("email_mailto_truncated_hint")}</p>
            ) : null}
          </div>

          <p className="text-xs text-muted-foreground">
            {canSendHere ? null : <>{t("email_phase1_disclaimer")}{" "}</>}
            <span className="opacity-60">({body.length}/{MAILTO_MAX_LENGTH})</span>
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button variant="outline" onClick={handleCopy}>
            <Copy className="me-1.5 h-3.5 w-3.5" /> {t("email_copy_text")}
          </Button>
          <Button variant={canSendHere ? "outline" : "default"} onClick={handleOpenInOutlook} disabled={!canOpen || sending}>
            <ExternalLink className="me-1.5 h-3.5 w-3.5" /> {t("email_open_in_outlook")}
          </Button>
          {canSendHere ? (
            <Button onClick={handleSend} disabled={!canOpen || sending}>
              {sending ? (
                <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="me-1.5 h-3.5 w-3.5" />
              )}
              {sending ? t("email_sending") : t("email_send")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
