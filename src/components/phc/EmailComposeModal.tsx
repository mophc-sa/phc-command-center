// "Email via Outlook" — Phase 1 compose modal.
//
// Constraints (Phase 1 brief):
//   - Never sends an email. Never marks anything as "sent".
//   - Never calls a backend send endpoint, SMTP, Microsoft Graph or OAuth.
//   - "Open in Outlook" is a plain `mailto:` handoff — the user reviews and
//     sends from their Outlook / default mail client manually.
//   - If a recipient email is missing, disable "Open in Outlook" but keep
//     "Copy email text" enabled so the user can still use the draft.
//
// Any real send integration must land in Phase 2 with its own review.

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
import { Copy, ExternalLink, Mail } from "lucide-react";
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
          <DialogDescription>{t("email_compose_desc")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          {linked?.label ? (
            <div className="rounded-md border border-border/70 bg-surface/60 px-3 py-2 text-[11px] text-muted-foreground">
              <span className="uppercase tracking-[0.12em]">{t("email_linked_record")}:</span>{" "}
              <span className="text-foreground">{linked.label}</span>
            </div>
          ) : null}

          <div className="grid gap-1.5">
            <Label htmlFor="email-to" className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
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
            {missingHint ? <p className="text-[11px] text-amber-light">{missingHint}</p> : null}
            {invalidHint ? <p className="text-[11px] text-amber-light">{invalidHint}</p> : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="email-cc" className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
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
            <Label htmlFor="email-subject" className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
              {t("email_subject")}
            </Label>
            <Input id="email-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="email-body" className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
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
              <p className="text-[11px] text-amber-light">{t("email_mailto_truncated_hint")}</p>
            ) : null}
          </div>

          <p className="text-[11px] text-muted-foreground">
            {t("email_phase1_disclaimer")}{" "}
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
          <Button onClick={handleOpenInOutlook} disabled={!canOpen}>
            <ExternalLink className="me-1.5 h-3.5 w-3.5" /> {t("email_open_in_outlook")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
