// WhatsApp click-to-chat — Phase 1 compose modal.
//
// Constraints (Phase 1 brief, mirrors EmailComposeModal):
//   - Never sends a message. Never marks anything as "sent" automatically.
//   - Never calls the WhatsApp Business API or any send endpoint.
//   - "Open WhatsApp" is a plain wa.me handoff — the user reviews and sends
//     from their own WhatsApp app/Web manually.
//   - If a recipient phone is missing, disable "Open WhatsApp" but keep
//     "Copy message" enabled so the user can still use the draft.

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Copy, ExternalLink, MessageCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import {
  buildWaMeUrl,
  normalizePhone,
  renderTemplate,
  type TemplateVars,
} from "@/lib/whatsapp-templates";
import { logWhatsAppOpened } from "@/lib/whatsapp-compose";

export type WhatsAppLinkedRecord = {
  type: "company" | "contact" | "opportunity" | "tender" | "rfq" | "quotation";
  id: string;
  label?: string | null;
  opportunityId?: string | null;
  companyId?: string | null;
  contactId?: string | null;
  rfqId?: string | null;
  tenderId?: string | null;
};

export function WhatsAppComposeModal({
  open,
  onOpenChange,
  recipientPhone,
  vars,
  linked,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  recipientPhone?: string | null;
  vars: TemplateVars;
  linked?: WhatsAppLinkedRecord | null;
}) {
  const { t, dir } = useI18n();
  const { data: templates = [] } = useQuery({
    queryKey: ["whatsapp-templates"],
    enabled: open,
    queryFn: async () => {
      const { data } = await supabase
        .from("communication_templates")
        .select("id, name, body")
        .eq("channel", "whatsapp_draft")
        .eq("is_active", true)
        .order("name");
      return data ?? [];
    },
  });

  const [phone, setPhone] = useState(recipientPhone ?? "");
  const [templateId, setTemplateId] = useState<string>("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    setPhone(recipientPhone ?? "");
    setTemplateId("");
    setMessage("");
  }, [open, recipientPhone]);

  const selectedTemplate = useMemo(
    () => templates.find((tpl) => tpl.id === templateId),
    [templates, templateId],
  );

  function applyTemplate(id: string) {
    setTemplateId(id);
    const tpl = templates.find((x) => x.id === id);
    if (tpl) setMessage(renderTemplate(tpl.body, vars));
  }

  const phoneNorm = useMemo(() => normalizePhone(phone), [phone]);
  const canOpen = phoneNorm.valid && message.trim().length > 0;
  const waUrl = canOpen ? buildWaMeUrl(phone, message) : "";

  async function handleOpenWhatsApp() {
    if (!canOpen) return;
    try {
      if (linked) {
        await logWhatsAppOpened({
          linked_record_type: linked.type,
          linked_record_id: linked.id,
          recipient_phone: phone,
          message,
          opportunityId: linked.opportunityId ?? null,
          companyId: linked.companyId ?? null,
          contactId: linked.contactId ?? null,
          rfqId: linked.rfqId ?? null,
          tenderId: linked.tenderId ?? null,
          templateId: selectedTemplate?.id ?? null,
        });
      }
    } catch {
      // Never block the compose action on a logging failure.
    }
    window.open(waUrl, "_blank", "noopener,noreferrer");
    onOpenChange(false);
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(message);
      toast.success(t("wa_copied"));
    } catch {
      toast.error(t("toast_error"));
    }
  }

  const missingHint = !phone && (t("wa_no_recipient") as string);
  const invalidHint = phone && !phoneNorm.valid ? (t("wa_invalid_recipient") as string) : null;
  const normalizedHint = phoneNorm.valid && phoneNorm.wasLocalSaudiFormat ? (t("wa_normalized_saudi") as string) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={dir} className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4" /> {t("wa_compose_title")}
          </DialogTitle>
          <DialogDescription>{t("wa_compose_desc")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          {linked?.label ? (
            <div className="rounded-md border border-border/70 bg-surface/60 px-3 py-2 text-[11px] text-muted-foreground">
              <span className="uppercase tracking-[0.12em]">{t("email_linked_record")}:</span>{" "}
              <span className="text-foreground">{linked.label}</span>
            </div>
          ) : null}

          <div className="grid gap-1.5">
            <Label htmlFor="wa-phone" className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
              {t("wa_phone")}
            </Label>
            <Input
              id="wa-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+9665XXXXXXXX"
              autoComplete="off"
            />
            {missingHint ? <p className="text-[11px] text-amber-light">{missingHint}</p> : null}
            {invalidHint ? <p className="text-[11px] text-amber-light">{invalidHint}</p> : null}
            {normalizedHint ? <p className="text-[11px] text-muted-foreground">{normalizedHint}</p> : null}
          </div>

          {templates.length > 0 ? (
            <div className="grid gap-1.5">
              <Label className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{t("wa_template")}</Label>
              <Select value={templateId || "__none__"} onValueChange={(v) => applyTemplate(v === "__none__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">—</SelectItem>
                  {templates.map((tpl) => (
                    <SelectItem key={tpl.id} value={tpl.id}>{tpl.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="grid gap-1.5">
            <Label htmlFor="wa-message" className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
              {t("wa_message")}
            </Label>
            <Textarea
              id="wa-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={8}
              className="font-[inherit]"
            />
          </div>

          <p className="text-[11px] text-muted-foreground">{t("wa_phase1_disclaimer")}</p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button variant="outline" onClick={handleCopy} disabled={!message.trim()}>
            <Copy className="me-1.5 h-3.5 w-3.5" /> {t("wa_copy_text")}
          </Button>
          <Button onClick={handleOpenWhatsApp} disabled={!canOpen}>
            <ExternalLink className="me-1.5 h-3.5 w-3.5" /> {t("wa_open")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
