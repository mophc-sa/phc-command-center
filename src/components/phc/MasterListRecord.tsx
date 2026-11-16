import { Panel } from "@/components/phc/Panel";

/**
 * The deal's row in Marie's master quotation list, exactly as the file has it
 * (stored by the data sync in extra_data.master_list). Shown read-only so a
 * reader can check the system against the sheet column by column.
 */
const FIELDS: { key: string; raw?: string; en: string; ar: string; link?: boolean; long?: boolean }[] = [
  { key: "code", en: "Sales code", ar: "كود المبيعات" },
  { key: "email_subject", en: "Email subject", ar: "عنوان البريد" },
  { key: "received", raw: "raw_received", en: "Date received", ar: "تاريخ الاستلام" },
  { key: "route", en: "JIH / Tender", ar: "JIH / مناقصة" },
  { key: "project", en: "Project name", ar: "اسم المشروع" },
  { key: "amount_raw", en: "Amount", ar: "القيمة" },
  { key: "status", en: "Quotation status", ar: "حالة العرض" },
  { key: "submitted", raw: "raw_submitted", en: "Submission date", ar: "تاريخ التقديم" },
  { key: "follow_up", en: "Follow-up", ar: "المتابعة" },
  { key: "client", en: "RFQ received from", ar: "طلب التسعير من" },
  { key: "contact_person", en: "Contact person", ar: "جهة الاتصال" },
  { key: "designation", en: "Designation", ar: "المسمى الوظيفي" },
  { key: "mobile", en: "Mobile", ar: "الجوال" },
  { key: "email", en: "Email", ar: "البريد الإلكتروني" },
  { key: "location", en: "Project location", ar: "موقع المشروع" },
  { key: "last_update", raw: "raw_last_update", en: "Last update", ar: "آخر تحديث" },
  { key: "update_log", en: "Update log", ar: "سجل التحديثات", long: true },
  { key: "date_requested", raw: "raw_date_requested", en: "Date requested", ar: "تاريخ الطلب" },
  { key: "photo_status", en: "Status", ar: "الحالة" },
  { key: "photo_link", en: "Photo (OneDrive link)", ar: "الصور (رابط OneDrive)", link: true },
  { key: "last_update_2", raw: "raw_last_update_2", en: "Last update", ar: "آخر تحديث" },
  { key: "notes", en: "Notes", ar: "ملاحظات", long: true },
];

export function MasterListRecord({ extraData, ar }: { extraData: unknown; ar: boolean }) {
  const ml = (extraData as { master_list?: Record<string, unknown> } | null)?.master_list;
  if (!ml || typeof ml !== "object") return null;
  const val = (f: (typeof FIELDS)[number]) => {
    const v = ml[f.key] ?? (f.raw ? ml[f.raw] : undefined) ?? (f.key === "amount_raw" ? ml.amount : undefined);
    return v == null || String(v).trim() === "" ? null : String(v);
  };
  const synced = (extraData as { master_list_synced_at?: string }).master_list_synced_at;
  return (
    <Panel
      title={ar ? "سجل القائمة الرئيسية للعروض" : "Master quotation list record"}
      subtitle={ar ? "كما ورد في ملف PHC Quotation List" + (synced ? ` · مزامنة ${synced.slice(0, 10)}` : "") : "As in the PHC Quotation List file" + (synced ? ` · synced ${synced.slice(0, 10)}` : "")}
    >
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {FIELDS.map((f) => {
          const v = val(f);
          return (
            <div key={f.key} className={f.long ? "sm:col-span-2" : undefined}>
              <dt className="text-xs text-muted-foreground">{ar ? f.ar : f.en}</dt>
              <dd className="mt-0.5 whitespace-pre-wrap break-words text-sm text-foreground">
                {v == null ? (
                  <span className="text-muted-foreground">—</span>
                ) : f.link && /^https?:\/\//i.test(v) ? (
                  <a className="text-primary underline" href={v} target="_blank" rel="noreferrer noopener">
                    {ar ? "فتح الرابط" : "Open link"}
                  </a>
                ) : (
                  v
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </Panel>
  );
}
