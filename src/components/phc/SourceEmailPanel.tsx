// src/components/phc/SourceEmailPanel.tsx
// The email a deal came from, when it arrived at info@ (group 3 part B): who,
// when, the text, attachment names, and the thread in Outlook. Later client
// replies appear in the Correspondence panel below it.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Mail } from "lucide-react";
import { Panel } from "@/components/phc/Panel";
import { useI18n, localeFor } from "@/lib/i18n";
import { sourceEmailFor } from "@/lib/info-mail-actions";

export function SourceEmailPanel({ opportunityId }: { opportunityId: string }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ["source-email", opportunityId], queryFn: () => sourceEmailFor(opportunityId), staleTime: 5 * 60_000 });
  const m = q.data;
  if (!m) return null;
  return (
    <Panel title={ar ? "البريد الأصلي" : "Source email"}>
      <div className="space-y-2 text-sm">
        <p className="flex items-center gap-2 font-medium" dir="auto">
          <Mail className="h-4 w-4" aria-hidden="true" />
          {m.subject || (ar ? "(بلا عنوان)" : "(no subject)")}
        </p>
        <p className="text-xs text-muted-foreground">
          {m.from_name || m.from_email} · {new Date(m.received_at).toLocaleString(localeFor(lang), { dateStyle: "medium", timeStyle: "short" })}
        </p>
        {m.attachment_names.length ? (
          <p className="text-xs text-muted-foreground">{(ar ? "المرفقات: " : "Attachments: ") + m.attachment_names.join(", ")}</p>
        ) : null}
        <div className="flex flex-wrap gap-2 text-xs">
          {m.web_link ? (
            <a href={m.web_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1">
              {ar ? "افتح في Outlook" : "Open in Outlook"} <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          ) : null}
          {m.body_text ? (
            <button type="button" onClick={() => setOpen((v) => !v)} className="rounded-md border border-border px-2 py-1" aria-expanded={open}>
              {open ? (ar ? "إخفاء النص" : "Hide text") : (ar ? "عرض النص" : "Show email text")}
            </button>
          ) : null}
        </div>
        {open && m.body_text ? <pre className="whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs" dir="auto">{m.body_text}</pre> : null}
      </div>
    </Panel>
  );
}
