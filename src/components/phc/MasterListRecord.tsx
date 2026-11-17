import { Panel } from "@/components/phc/Panel";

/**
 * The deal's row in Marie's master quotation list, exactly as the file has it
 * (stored by the data sync in extra_data.master_list). Shown read-only so a
 * reader can check the system against the sheet column by column.
 */
const FIELDS: {
  key: string;
  raw?: string;
  en: string;
  ar: string;
  link?: boolean;
  long?: boolean;
}[] = [
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

/** The November 2026 master list (PHC_Quotation_Masterlist_Updated November 2026.xlsx), stored in extra_data.master_list_2026_11. */
const NOV_FIELDS: typeof FIELDS = [
  { key: "code", en: "Project code", ar: "كود المشروع" },
  { key: "codes", en: "Codes in the file (one tender)", ar: "الأكواد في الملف (مناقصة واحدة)" },
  { key: "priority", en: "Priority", ar: "الأولوية" },
  { key: "project", en: "Project name", ar: "اسم المشروع" },
  { key: "amount", en: "Updated amount", ar: "القيمة المحدثة" },
  { key: "status", en: "Status", ar: "الحالة" },
  { key: "next_action_date", en: "Next action date", ar: "تاريخ الإجراء التالي" },
  { key: "route", en: "JIH / Tender", ar: "JIH / مناقصة" },
  { key: "client", en: "Main client", ar: "العميل الرئيسي" },
  { key: "location", en: "Location", ar: "الموقع" },
  { key: "last_update", en: "Last update", ar: "آخر تحديث" },
  { key: "po_status", en: "PO / SCA", ar: "أمر الشراء / العقد" },
  { key: "agreement_status", en: "Agreement", ar: "الاتفاق" },
  { key: "rfq_contact", en: "RFQ contact", ar: "جهة طلب التسعير", long: true },
  { key: "remarks", en: "Remarks", ar: "الملاحظات", long: true },
];

const SECTIONS = [
  {
    key: "master_list_2026_11",
    synced: "master_list_2026_11_synced_at",
    fields: NOV_FIELDS,
    en: "Master list · November 2026",
    ar: "القائمة الرئيسية · نوفمبر 2026",
  },
  {
    key: "master_list",
    synced: "master_list_synced_at",
    fields: FIELDS,
    en: "PHC Quotation List (September 2026)",
    ar: "PHC Quotation List (سبتمبر 2026)",
  },
] as const;

export function MasterListRecord({ extraData, ar }: { extraData: unknown; ar: boolean }) {
  const extra = (extraData ?? {}) as Record<string, unknown>;
  const present = SECTIONS.filter((s) => extra[s.key] && typeof extra[s.key] === "object");
  if (present.length === 0) return null;
  return (
    <Panel
      title={ar ? "سجل القائمة الرئيسية للعروض" : "Master quotation list record"}
      subtitle={
        ar
          ? "كما ورد في ملف القائمة الرئيسية، عمودًا بعمود"
          : "As in the master list file, column by column"
      }
    >
      <div className="space-y-6">
        {present.map((s) => (
          <MasterListSection
            key={s.key}
            ar={ar}
            fields={s.fields}
            row={extra[s.key] as Record<string, unknown>}
            title={
              (ar ? s.ar : s.en) +
              (typeof extra[s.synced] === "string"
                ? ar
                  ? ` · مزامنة ${(extra[s.synced] as string).slice(0, 10)}`
                  : ` · synced ${(extra[s.synced] as string).slice(0, 10)}`
                : "")
            }
          />
        ))}
      </div>
    </Panel>
  );
}

function MasterListSection({
  row: ml,
  fields,
  title,
  ar,
}: {
  row: Record<string, unknown>;
  fields: typeof FIELDS;
  title: string;
  ar: boolean;
}) {
  const val = (f: (typeof FIELDS)[number]) => {
    const v =
      ml[f.key] ??
      (f.raw ? ml[f.raw] : undefined) ??
      (f.key === "amount_raw" ? ml.amount : undefined);
    const t = Array.isArray(v) ? v.join(" · ") : v;
    return t == null || String(t).trim() === "" ? null : String(t);
  };
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-foreground">{title}</h3>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {fields.map((f) => {
          const v = val(f);
          return (
            <div key={f.key} className={f.long ? "sm:col-span-2" : undefined}>
              <dt className="text-xs text-muted-foreground">{ar ? f.ar : f.en}</dt>
              <dd className="mt-0.5 whitespace-pre-wrap break-words text-sm text-foreground">
                {v == null ? (
                  <span className="text-muted-foreground">—</span>
                ) : f.link && /^https?:\/\//i.test(v) ? (
                  <a
                    className="text-primary underline"
                    href={v}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
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
    </section>
  );
}
