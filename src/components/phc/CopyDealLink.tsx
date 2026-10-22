import { useState } from "react";
import { Check, Link2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { dealLink } from "@/lib/short-link";

/**
 * Copies a link to this deal: /p/<code> when it has a code, else the full
 * address. Whoever opens it still needs access -- see short-link.ts.
 */
export function CopyDealLink({ opportunityId, code }: { opportunityId: string; code: string | null | undefined }) {
  const { lang } = useI18n();
  const [copied, setCopied] = useState(false);
  const ar = lang === "ar";
  const label = ar ? "نسخ رابط الصفقة" : "Copy link to this deal";

  const copy = async () => {
    const url = dealLink(window.location.origin, opportunityId, code);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(ar ? "نُسخ الرابط" : "Link copied", { description: url });
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard refused (permissions, insecure context): show the link so it
      // can still be copied by hand.
      toast(ar ? "انسخ الرابط" : "Copy the link", { description: url, duration: 10_000 });
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      aria-label={label}
      title={label}
    >
      {copied ? <Check className="h-3 w-3" /> : <Link2 className="h-3 w-3" />}
      <span>{ar ? "نسخ الرابط" : "Copy link"}</span>
    </button>
  );
}
