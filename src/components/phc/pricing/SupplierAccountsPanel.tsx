import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/phc/StatusPill";
import { QueryFailure } from "@/components/phc/QueryFailure";
import { useI18n } from "@/lib/i18n";
import { createSupplierAccount, listSupplierAccounts, newSupplierPasswordLink } from "@/lib/pricing-actions";
import { accountMessage } from "@/lib/supplier-portal";
import { dbMessage, pick, type Bi } from "@/lib/pricing-text";
import { CopyText } from "@/components/phc/pricing/CopyText";

const TEXT = {
  title: { en: "Portal accounts for this supplier", ar: "حسابات البوابة لهذا المورد" },
  none: { en: "No portal account yet. Create one, or enter the supplier's prices on their behalf when they answer.", ar: "لا حساب بوابة بعد. أنشئ حساباً، أو أدخل أسعار المورد نيابة عنه حين يرد." },
  name: { en: "Contact name", ar: "اسم جهة الاتصال" },
  email: { en: "Contact email", ar: "بريد جهة الاتصال" },
  create: { en: "Create portal account", ar: "أنشئ حساب بوابة" },
  creating: { en: "Creating…", ar: "جارٍ الإنشاء…" },
  created: { en: "Account created. Send the message below to the supplier.", ar: "أُنشئ الحساب. أرسل الرسالة أدناه للمورد." },
  newLink: { en: "New set-password link", ar: "رابط جديد لكلمة المرور" },
  message: { en: "Message to send (your email or WhatsApp)", ar: "الرسالة المرسلة (بريدك أو واتساب)" },
  noLink: { en: "The account exists but no link was made; use New set-password link.", ar: "الحساب موجود لكن لم يُنشأ رابط؛ استخدم «رابط جديد لكلمة المرور»." },
  noLinkAgain: { en: "The link could not be generated, try again.", ar: "تعذر إنشاء الرابط، حاول مرة أخرى." },
  linkNote: { en: "Send this only to the supplier yourself: whoever opens the link can set the password for this account. Do not forward it or post it anywhere.", ar: "أرسله للمورد بنفسك فقط: من يفتح الرابط يستطيع تعيين كلمة مرور هذا الحساب. لا تعيد توجيهه ولا تنشره." },
  retire: { en: "To stop a supplier's access, suspend the account in Admin settings. The supplier role stays on the account.", ar: "لإيقاف وصول مورد، أوقف حسابه من إعدادات الإدارة. يبقى دور المورد على الحساب." },
  active: { en: "Active", ar: "نشط" },
  inactive: { en: "Not active", ar: "غير نشط" },
} satisfies Record<string, Bi>;

const FIELD =
  "w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60";

export function SupplierAccountsPanel({ vendorId }: { vendorId: string }) {
  const { lang } = useI18n();
  const qc = useQueryClient();
  const accounts = useQuery({ queryKey: ["pricing-supplier-accounts", vendorId], queryFn: () => listSupplierAccounts(vendorId) });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The one-time link belongs to the vendor it was made for: never carry it to another.
  useEffect(() => { setMessage(null); }, [vendorId]);
  const signIn = `${window.location.origin}/auth`;

  function showLink(url: string | null, again = false) {
    if (!url) {
      toast.error(pick(again ? TEXT.noLinkAgain : TEXT.noLink, lang));
      return;
    }
    setMessage(accountMessage(url, signIn, lang));
  }

  async function create() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await createSupplierAccount(vendorId, email.trim(), name.trim());
      await qc.invalidateQueries({ queryKey: ["pricing-supplier-accounts", vendorId] });
      setName("");
      setEmail("");
      toast.success(pick(TEXT.created, lang));
      showLink(r.set_password_url);
    } catch (e) {
      toast.error(dbMessage(e, lang));
    } finally {
      setBusy(false);
    }
  }

  async function reissue(userId: string) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      showLink((await newSupplierPasswordLink(userId)).set_password_url, true);
    } catch (e) {
      toast.error(dbMessage(e, lang));
    } finally {
      setBusy(false);
    }
  }

  if (accounts.isError) return <QueryFailure retry={() => void accounts.refetch()} />;
  const rows = accounts.data ?? [];
  return (
    <div className="space-y-3 rounded-md border border-border p-3 text-sm">
      <p className="font-medium">{pick(TEXT.title, lang)}</p>
      {rows.length === 0 && !accounts.isLoading ? <p className="text-muted-foreground">{pick(TEXT.none, lang)}</p> : null}
      <ul className="space-y-2">
        {rows.map((a) => (
          <li key={a.user_id} className="flex flex-wrap items-center gap-2">
            <span>{a.full_name ?? a.email}</span>
            <span className="text-muted-foreground" dir="ltr">{a.email}</span>
            <StatusPill tone={a.status === "active" ? "positive" : "muted"}>{pick(a.status === "active" ? TEXT.active : TEXT.inactive, lang)}</StatusPill>
            {a.status === "active" ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void reissue(a.user_id)}>{pick(TEXT.newLink, lang)}</Button>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="space-y-1">
          <span>{pick(TEXT.name, lang)}</span>
          <input type="text" maxLength={200} className={FIELD} disabled={busy} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="space-y-1">
          <span>{pick(TEXT.email, lang)}</span>
          <input type="email" dir="ltr" maxLength={254} className={FIELD} disabled={busy} value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <Button disabled={busy || !name.trim() || !email.trim()} onClick={() => void create()}>
          {pick(busy ? TEXT.creating : TEXT.create, lang)}
        </Button>
      </div>
      {message ? (
        <div className="space-y-1">
          <p role="note" className="rounded-md border border-amber/40 bg-amber/10 p-2 text-amber-light">{pick(TEXT.linkNote, lang)}</p>
          <CopyText label={pick(TEXT.message, lang)} text={message} />
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">{pick(TEXT.retire, lang)}</p>
    </div>
  );
}
