// Convenience wrapper: renders a compact "Email via Outlook" button that
// opens the compose modal with a pre-filled template + context. Also exposes
// a small dropdown so callers can pick a template inline when useful.

import { useState } from "react";
import { Mail } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { EmailComposeModal, type EmailLinkedRecord } from "./EmailComposeModal";
import type { EmailContext, EmailTemplateKind } from "@/lib/email-templates";

export function EmailComposeButton({
  template,
  context,
  linked,
  size = "sm",
  variant = "default",
  label,
  className,
}: {
  template: EmailTemplateKind;
  context: EmailContext;
  linked?: EmailLinkedRecord | null;
  size?: "xs" | "sm";
  variant?: "default" | "ghost";
  label?: string;
  className?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [currentTpl, setCurrentTpl] = useState<EmailTemplateKind>(template);
  const sizing = size === "xs" ? "px-2 py-1 text-[10px]" : "px-3 py-1.5 text-xs";
  const styles =
    variant === "ghost"
      ? "border-border text-muted-foreground hover:text-foreground"
      : "border-amber/40 bg-amber/10 text-amber-light hover:bg-amber/20";
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setCurrentTpl(template);
          setOpen(true);
        }}
        className={`inline-flex items-center gap-1.5 rounded-md border font-medium ${sizing} ${styles} ${className ?? ""}`}
      >
        <Mail className="h-3.5 w-3.5" />
        {label ?? t("email_via_outlook")}
      </button>
      <EmailComposeModal
        open={open}
        onOpenChange={setOpen}
        template={currentTpl}
        context={context}
        linked={linked ?? null}
      />
    </>
  );
}
