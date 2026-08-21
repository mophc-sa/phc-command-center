import { useState } from "react";
import { toast } from "sonner";
import { resolveAttachmentUrl } from "@/lib/storage-actions";
import { useI18n } from "@/lib/i18n";

/**
 * A link to a stored attachment, resolved at the moment it is clicked.
 *
 * WHY IT RESOLVES ON CLICK RATHER THAN ON RENDER
 * ----------------------------------------------
 * Read links are now short-lived signatures minted on demand. Minting one per
 * row at render time would mean a storage round-trip for every attachment on
 * the page — most of which nobody opens — and the signature would already be
 * ageing by the time anyone clicked it. So the anchor carries no href until it
 * is used.
 *
 * WHY IT EXISTS AT ALL
 * --------------------
 * Before this hotfix, these columns held a seven-day signed URL and the UI
 * rendered it directly into `href`. That worked for a week and then quietly
 * stopped. Now the columns hold a path, which is not a URL and cannot go in an
 * `href` — so every read site needs this one indirection. `resolveAttachmentUrl`
 * is what knows the difference between a path, one of our own expired URLs, an
 * external link, and a value that was never a file at all.
 *
 * A value that resolves to nothing renders as disabled text rather than a dead
 * anchor. One production row holds an email address in `evidence_url`; showing
 * it as a broken link would be worse than showing it as unavailable.
 */
export function AttachmentLink({
  storagePath,
  legacyUrl,
  children,
  className,
}: {
  storagePath?: string | null;
  legacyUrl?: string | null;
  children: React.ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  if (!storagePath && !legacyUrl) return null;

  return (
    <a
      href="#"
      className={className}
      aria-busy={busy || undefined}
      onClick={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        try {
          const url = await resolveAttachmentUrl(storagePath, legacyUrl);
          if (!url) {
            toast.error(t("attachment_unavailable"));
            return;
          }
          window.open(url, "_blank", "noopener,noreferrer");
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
    </a>
  );
}
