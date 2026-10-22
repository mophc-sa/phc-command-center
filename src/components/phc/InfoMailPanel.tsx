// src/components/phc/InfoMailPanel.tsx
// =============================================================================
// info@ mail that is not a request (group 3 part B): labelled by the triage
// agent, listed for a router — sales manager, BD or sales ops — who forwards
// each to a colleague, turns it into a request, or dismisses it. Nothing is
// forwarded on its own.
// =============================================================================
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, Mail } from "lucide-react";
import { useI18n, formatNumber, localeFor } from "@/lib/i18n";
import {
  countOpenInfoSpam, dismissInfoMail, dismissOpenInfoSpam, forwardInfoMail, listColleagues, listOpenInfoMail, listOpenInfoSpam, markInfoMailRfq,
  type InfoMailRow,
} from "@/lib/info-mail-actions";

const LABEL: Record<string, { en: string; ar: string }> = {
  unclassified: { en: "Being sorted", ar: "قيد الفرز" },
  rfq: { en: "Possible RFQ", ar: "طلب تسعير محتمل" },
  quotation_request: { en: "Possible price request", ar: "طلب سعر محتمل" },
  supplier: { en: "Supplier", ar: "مورّد" },
  finance: { en: "Finance", ar: "مالية" },
  hr: { en: "HR", ar: "موارد بشرية" },
  general: { en: "General", ar: "عام" },
  // unclassified after three failed attempts, or mail from before go-live
  unsorted: { en: "Not sorted — route by hand", ar: "لم يُفرز — وجّهه يدويًا" },
};
const ORDER = ["rfq", "quotation_request", "general", "supplier", "finance", "hr", "unclassified", "unsorted"];
const groupOf = (r: InfoMailRow) => (r.category === "unclassified" && r.triage_attempts >= 3 ? "unsorted" : r.category);

export function InfoMailPanel() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["info-mail-open"], queryFn: listOpenInfoMail, staleTime: 60_000 });
  const people = useQuery({
    queryKey: ["info-mail-colleagues"],
    staleTime: 10 * 60_000,
    queryFn: listColleagues,
  });
  const spam = useQuery({ queryKey: ["info-mail-spam"], queryFn: countOpenInfoSpam, staleTime: 60_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [spamOpen, setSpamOpen] = useState(false);
  const spamRows = useQuery({ queryKey: ["info-mail-spam-rows"], queryFn: listOpenInfoSpam, staleTime: 60_000, enabled: spamOpen });
  const rows = q.data ?? [];
  const spamCount = spam.data ?? 0;
  if (!q.isLoading && !q.isError && rows.length === 0 && spamCount === 0) return null;

  async function act(id: string, run: () => Promise<unknown>, done: string | ((result: unknown) => string)) {
    setBusy(id);
    try {
      const result = await run();
      toast.success(typeof done === "function" ? done(result) : done);
      await qc.invalidateQueries({ queryKey: ["info-mail-open"] });
      await qc.invalidateQueries({ queryKey: ["info-mail-spam"] });
      await qc.invalidateQueries({ queryKey: ["info-mail-spam-rows"] });
      await qc.invalidateQueries({ queryKey: ["inbox-items"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const groups = ORDER.map((c) => [c, rows.filter((r) => groupOf(r) === c)] as const).filter(([, list]) => list.length);
  const summaryLine = (r: InfoMailRow) => {
    const [en, arLine] = (r.summary ?? "").split("\n");
    return (ar ? arLine || en : en) || r.subject || "";
  };

  // `routing` rows are the open list (forward + summary); spam rows get the
  // sender, subject, time, Outlook link, "This is an RFQ" and Dismiss only.
  const renderRow = (r: InfoMailRow, routing: boolean) => (
    <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium" dir="auto">{r.subject || (ar ? "(بلا عنوان)" : "(no subject)")}</p>
        <p className="truncate text-xs text-muted-foreground">
          {r.from_name || r.from_email} · {new Date(r.received_at).toLocaleString(localeFor(lang), { dateStyle: "medium", timeStyle: "short" })}
        </p>
        {routing ? <p className="truncate text-xs text-muted-foreground" dir="auto">{summaryLine(r)}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {r.web_link ? (
          <a href={r.web_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1">
            Outlook <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        ) : null}
        {routing ? (
          <select
            aria-label={ar ? "حوّل إلى" : "Forward to"}
            disabled={busy === r.id || !people.data}
            defaultValue=""
            onChange={(e) => {
              const to = e.target.value;
              const name = (people.data ?? []).find((p) => p.id === to);
              e.target.value = "";
              const ask = ar ? `تحويل هذا البريد إلى ${name?.full_name || name?.email}؟` : `Forward this email to ${name?.full_name || name?.email}?`;
              if (to && window.confirm(ask)) void act(r.id, () => forwardInfoMail(r.id, to), ar ? "حُوِّل البريد" : "Forwarded");
            }}
            className="rounded-md border border-border bg-background px-2 py-1"
          >
            <option value="">{ar ? "حوّل إلى…" : "Forward to…"}</option>
            {(people.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
            ))}
          </select>
        ) : null}
        <button type="button" disabled={busy === r.id}
          onClick={() => void act(r.id, () => markInfoMailRfq(r.id), ar ? "أُنشئ طلب في الوارد" : "Request created in the inbox")}
          className="rounded-md border border-border px-2 py-1">
          {ar ? "هذا طلب تسعير" : "This is an RFQ"}
        </button>
        <button type="button" disabled={busy === r.id}
          onClick={() => {
            const ask = ar ? "تجاهل هذا البريد؟ لن يظهر هنا مرة أخرى." : "Dismiss this email? It will not be listed again.";
            if (window.confirm(ask)) void act(r.id, () => dismissInfoMail(r.id), ar ? "أُغلق" : "Dismissed");
          }}
          className="rounded-md border border-border px-2 py-1 text-muted-foreground">
          {ar ? "تجاهل" : "Dismiss"}
        </button>
      </div>
    </li>
  );

  return (
    <section aria-labelledby="info-mail-title" className="rounded-xl border border-border bg-surface p-4">
      <h2 id="info-mail-title" className="flex items-center gap-2 font-semibold">
        <Mail className="h-4 w-4" aria-hidden="true" />
        {ar ? "بريد info@ — للتوجيه" : "info@ mail — to route"}
        <span className="num text-sm text-muted-foreground" data-tabular="true">({formatNumber(rows.length, lang)})</span>
      </h2>
      {q.isError ? (
        <button type="button" onClick={() => void q.refetch()} className="mt-2 text-sm text-destructive underline">
          {ar ? "تعذّر التحميل — أعد المحاولة" : "Could not load — try again"}
        </button>
      ) : null}
      {spamCount > 0 ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 px-3 py-2 text-sm">
          <span>
            {ar ? "نشرات ورسائل مزعجة" : "Newsletters & spam"}{" "}
            <span className="num text-muted-foreground" data-tabular="true">({formatNumber(spamCount, lang)})</span>
          </span>
          <button type="button" disabled={busy === "spam"}
            onClick={() => {
              const ask = ar
                ? `تجاهل ${formatNumber(spamCount, lang)} رسالة من النشرات والرسائل المزعجة؟`
                : `Dismiss ${formatNumber(spamCount, lang)} newsletter and spam messages?`;
              if (window.confirm(ask)) void act("spam", dismissOpenInfoSpam, (n) => {
                const count = formatNumber(Number(n) || 0, lang);
                return ar ? `أُغلق ${count}` : `${count} dismissed`;
              });
            }}
            className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">
            {ar ? "تجاهل الكل" : "Dismiss all"}
          </button>
          <button type="button" aria-expanded={spamOpen} aria-controls="info-mail-spam-list"
            onClick={() => setSpamOpen((v) => !v)}
            className="w-full text-start text-xs text-muted-foreground underline">
            {spamOpen ? (ar ? "إخفاء الرسائل" : "Hide messages") : (ar ? "عرض الرسائل" : "Show messages")}
          </button>
          {spamOpen ? (
            <div id="info-mail-spam-list" className="w-full">
              {spamRows.isLoading ? (
                <p className="text-xs text-muted-foreground">{ar ? "جارٍ التحميل…" : "Loading…"}</p>
              ) : spamRows.isError ? (
                <button type="button" onClick={() => void spamRows.refetch()} className="text-xs text-destructive underline">
                  {ar ? "تعذّر التحميل — أعد المحاولة" : "Could not load — try again"}
                </button>
              ) : (
                <ul className="divide-y divide-border/70">
                  {(spamRows.data ?? []).map((r) => renderRow(r, false))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
      {groups.map(([cat, list]) => (
        <div key={cat} className="mt-3">
          <h3 className="text-xs font-medium text-muted-foreground">{LABEL[cat]?.[ar ? "ar" : "en"] ?? cat}</h3>
          <ul className="mt-1 divide-y divide-border/70">
            {list.map((r) => renderRow(r, true))}
          </ul>
        </div>
      ))}
    </section>
  );
}
