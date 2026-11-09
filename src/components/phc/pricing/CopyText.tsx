import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { pick, type Bi } from "@/lib/pricing-text";

const TEXT = {
  copy: { en: "Copy", ar: "نسخ" },
  copied: { en: "Copied", ar: "نُسخ" },
  failed: { en: "Could not copy; select the text and copy it.", ar: "تعذر النسخ؛ حدّد النص وانسخه." },
} satisfies Record<string, Bi>;

/** A message the pricer sends from their own email or WhatsApp (no automated email in PR 3). */
export function CopyText({ label, text }: { label: string; text: string }) {
  const { lang } = useI18n();
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(pick(TEXT.copied, lang));
    } catch {
      toast.error(pick(TEXT.failed, lang));
    }
  }
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Button size="sm" variant="outline" onClick={() => void copy()}>{pick(TEXT.copy, lang)}</Button>
      </div>
      <textarea
        readOnly
        dir="auto"
        aria-label={label}
        className="w-full rounded-md border border-border bg-surface-2/40 p-2 text-xs text-foreground"
        rows={3}
        value={text}
        onFocus={(e) => e.currentTarget.select()}
      />
    </div>
  );
}
