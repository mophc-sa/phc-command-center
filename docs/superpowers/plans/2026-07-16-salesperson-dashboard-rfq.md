# Salesperson Dashboard & RFQ Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance `/my-workspace` with annual-target KPIs, awarded-value tracking, JIH/quotation urgency panels, and add new BAFO/contract_signed stages to the PHC sales workflow + a two-step RFQ quick-create form.

**Architecture:** Additive-only changes — new enum values via migration, front-end dashboard augmented in-place, new RFQ dialog co-located in my-workspace.tsx, action-file constants updated.

**Tech Stack:** React/TanStack Router, Supabase (Postgres enums + RLS), TypeScript, Zod-free (supabase types), TailwindCSS, bun test, tsc.

## Global Constraints

- Branch: `feature/salesperson-dashboard-rfq-workflow`
- Repo root: `D:\1-PROJECTS\PHC\phc-command-center-claude`
- Never modify main or push directly — commit to feature branch only
- All DB changes go in one new migration file: `supabase/migrations/20260716100000_salesperson_dashboard.sql`
- Never break existing enum values — only ADD new values via `ALTER TYPE … ADD VALUE … BEFORE/AFTER`
- TypeScript must compile clean (`cd repo && npx tsc --noEmit` exits 0)
- Build must succeed (`bun run build` exits 0)
- Follow existing patterns in my-workspace.tsx (useQuery, ChartFrame, List, TabItem)
- i18n keys always added to `src/lib/i18n.tsx` in the existing `STRINGS` object
- No new files unless strictly necessary; prefer editing existing files
- Import from `@/lib/workflow-actions` for sales_stage types; from `@/lib/tender-actions` for tender_stage types

---

### Task 1: DB Migration — New Workflow Stages

**Files:**
- Create: `supabase/migrations/20260716100000_salesperson_dashboard.sql`

**Interfaces:**
- Produces: `sales_stage` enum gains `jih_bafo` (between `jih` and `under_negotiation`) and `contract_signed` (between `contract_received` and `won`)
- Produces: `tender_stage` enum gains `tender_bafo` (between `tender_under_process` and `award_negotiation`)
- Produces: `target_period` enum gains `annual` (after `quarterly`)

- [ ] **Step 1: Write migration**

```sql
-- =========================================================
-- PHC Sales OS — Salesperson Dashboard: new workflow stages
-- Adds BAFO stages, contract_signed, and annual target period.
-- Non-destructive: only ADD VALUE to existing enums.
-- =========================================================

-- sales_stage: jih_bafo between jih and under_negotiation
ALTER TYPE public.sales_stage ADD VALUE IF NOT EXISTS 'jih_bafo' AFTER 'jih';
-- sales_stage: contract_signed between contract_received and won
ALTER TYPE public.sales_stage ADD VALUE IF NOT EXISTS 'contract_signed' AFTER 'contract_received';

-- tender_stage: tender_bafo between tender_under_process and award_negotiation
ALTER TYPE public.tender_stage ADD VALUE IF NOT EXISTS 'tender_bafo' AFTER 'tender_under_process';

-- target_period: annual
ALTER TYPE public.target_period ADD VALUE IF NOT EXISTS 'annual' AFTER 'quarterly';
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260716100000_salesperson_dashboard.sql
git commit -m "feat: add jih_bafo, contract_signed, tender_bafo, annual enum values"
```

---

### Task 2: Workflow & Tender Action Updates

**Files:**
- Modify: `src/lib/workflow-actions.ts`
- Modify: `src/lib/tender-actions.ts`
- Modify: `src/lib/i18n.tsx`

**Interfaces:**
- Consumes: new enum values from Task 1 (jih_bafo, contract_signed)
- Produces: `SALES_STAGES` array includes new values; `TRANSITIONS` map updated; `TENDER_STAGES`/`TENDER_TRANSITIONS` updated; i18n keys for all new stages

- [ ] **Step 1: Update SALES_STAGES in workflow-actions.ts**

In `src/lib/workflow-actions.ts`, find:
```typescript
export const SALES_STAGES: SalesStage[] = [
  "rfq_received", "jih", "under_negotiation", "verbally_awarded",
  "contract_received", "won", "lost", "on_hold",
];
```
Replace with:
```typescript
export const SALES_STAGES: SalesStage[] = [
  "rfq_received", "jih", "jih_bafo", "under_negotiation", "verbally_awarded",
  "contract_received", "contract_signed", "won", "lost", "on_hold",
];
```

- [ ] **Step 2: Update TRANSITIONS map in workflow-actions.ts**

Find:
```typescript
const TRANSITIONS: Record<string, SalesStage[]> = {
  rfq_received: ["jih", "lost", "on_hold"],
  jih: ["under_negotiation", "verbally_awarded", "lost", "on_hold"],
  under_negotiation: ["verbally_awarded", "lost", "on_hold"],
  verbally_awarded: ["contract_received", "lost", "on_hold"],
  contract_received: ["won", "on_hold"],
  won: [],
  lost: [],
  on_hold: ["jih", "under_negotiation", "verbally_awarded", "rfq_received"],
};
```
Replace with:
```typescript
const TRANSITIONS: Record<string, SalesStage[]> = {
  rfq_received: ["jih", "lost", "on_hold"],
  jih: ["jih_bafo", "under_negotiation", "verbally_awarded", "lost", "on_hold"],
  jih_bafo: ["under_negotiation", "verbally_awarded", "lost", "on_hold"],
  under_negotiation: ["verbally_awarded", "lost", "on_hold"],
  verbally_awarded: ["contract_received", "lost", "on_hold"],
  contract_received: ["contract_signed", "won", "on_hold"],
  contract_signed: ["won", "on_hold"],
  won: [],
  lost: [],
  on_hold: ["jih", "jih_bafo", "under_negotiation", "verbally_awarded", "rfq_received"],
};
```

- [ ] **Step 3: Update TENDER_STAGES and TENDER_TRANSITIONS in tender-actions.ts**

In `src/lib/tender-actions.ts`, find:
```typescript
export const TENDER_STAGES: TenderStage[] = [
  "tender_identified", "tender_under_process", "award_negotiation",
  "awarded_to_contractor", "converted_to_jih", "tender_lost_or_archived",
];

const TENDER_TRANSITIONS: Record<string, TenderStage[]> = {
  tender_identified: ["tender_under_process", "tender_lost_or_archived"],
  tender_under_process: ["award_negotiation", "awarded_to_contractor", "tender_lost_or_archived"],
  award_negotiation: ["awarded_to_contractor", "tender_lost_or_archived"],
  awarded_to_contractor: ["converted_to_jih", "tender_lost_or_archived"],
  converted_to_jih: [],
  tender_lost_or_archived: [],
};
```
Replace with:
```typescript
export const TENDER_STAGES: TenderStage[] = [
  "tender_identified", "tender_under_process", "tender_bafo", "award_negotiation",
  "awarded_to_contractor", "converted_to_jih", "tender_lost_or_archived",
];

const TENDER_TRANSITIONS: Record<string, TenderStage[]> = {
  tender_identified: ["tender_under_process", "tender_lost_or_archived"],
  tender_under_process: ["tender_bafo", "award_negotiation", "awarded_to_contractor", "tender_lost_or_archived"],
  tender_bafo: ["award_negotiation", "awarded_to_contractor", "tender_lost_or_archived"],
  award_negotiation: ["awarded_to_contractor", "tender_lost_or_archived"],
  awarded_to_contractor: ["converted_to_jih", "tender_lost_or_archived"],
  converted_to_jih: [],
  tender_lost_or_archived: [],
};
```

- [ ] **Step 4: Add i18n keys to src/lib/i18n.tsx**

After the existing tstage_tender_lost_or_archived key, add:
```typescript
  tstage_tender_bafo: { en: "Tender BAFO", ar: "BAFO المناقصة" },
  sstage_jih_bafo: { en: "JIH BAFO", ar: "BAFO الفرصة" },
  sstage_contract_signed: { en: "Contract Signed", ar: "عقد موقّع" },
```

Also add workspace keys after the existing `ws_tenders_active` key:
```typescript
  ws_awarded_value: { en: "Awarded Value", ar: "قيمة الترسيات" },
  ws_achievement_pct: { en: "Achievement", ar: "نسبة الإنجاز" },
  ws_jih_summary: { en: "JIH Pipeline", ar: "فرص قائمة" },
  ws_urgent_quotations: { en: "Urgent Quotations", ar: "عروض أسعار عاجلة" },
  ws_quotation_due: { en: "Submission Due", ar: "موعد تقديم العرض" },
  ws_new_rfq: { en: "New RFQ", ar: "طلب عرض سعر" },
  ws_rfq_step1: { en: "Company & Contact", ar: "الشركة وجهة الاتصال" },
  ws_rfq_step2: { en: "RFQ Details", ar: "تفاصيل الطلب" },
  ws_rfq_company: { en: "Company Name", ar: "اسم الشركة" },
  ws_rfq_contact: { en: "Contact Name", ar: "اسم جهة الاتصال" },
  ws_rfq_contact_phone: { en: "Phone", ar: "الجوال" },
  ws_rfq_project: { en: "Project / Scope", ar: "المشروع / النطاق" },
  ws_rfq_due: { en: "Response Due Date", ar: "الموعد النهائي للرد" },
  ws_rfq_value: { en: "Estimated Value (SAR)", ar: "القيمة التقديرية (ريال)" },
  ws_rfq_created: { en: "RFQ created and follow-up scheduled.", ar: "تم إنشاء طلب العرض وجدولة المتابعة." },
  ws_dedup_found: { en: "Existing contact found — linked.", ar: "تم العثور على جهة الاتصال وربطها." },
```

- [ ] **Step 5: Run tsc to verify no type errors**

```bash
cd "D:\1-PROJECTS\PHC\phc-command-center-claude" && npx tsc --noEmit 2>&1 | head -30
```
Expected: 0 errors (the new enum values won't be in types.ts yet since migration hasn't run on prod; that's fine — they'll be string literals until next type generation)

- [ ] **Step 6: Commit**

```bash
git add src/lib/workflow-actions.ts src/lib/tender-actions.ts src/lib/i18n.tsx
git commit -m "feat: extend sales/tender stages (jih_bafo, contract_signed, tender_bafo) + i18n"
```

---

### Task 3: Dashboard KPI Enhancements

**Files:**
- Modify: `src/routes/_authenticated/my-workspace.tsx`

**Interfaces:**
- Consumes: Task 2's i18n keys (`ws_awarded_value`, `ws_achievement_pct`, `ws_jih_summary`, `ws_urgent_quotations`)
- Produces: workspace page shows annual target KPIs, awarded value, achievement %, JIH summary panel, urgent quotations tab

**Context:** The existing file is 712 lines. Key sections to modify:
1. Add awarded_opps query (won stage, current year, owner = uid)
2. Add quotations query (submitted/follow_up status, valid_until within 7 days, owner)
3. Update KPI row to show awarded_value and achievement_%
4. Add "jih" tab showing jih/jih_bafo opportunities with value totals
5. Add "quotations" tab showing urgent quotations near deadline

- [ ] **Step 1: Add awarded opps + urgent quotations queries**

After the `myTenders` query block (around line 126), add:

```typescript
  const yearStart = `${new Date().getFullYear()}-01-01`;

  const { data: awardedOpps = [] } = useQuery({
    queryKey: ["ws-awarded", uid],
    enabled: !!uid,
    queryFn: async () =>
      (await supabase
        .from("opportunities")
        .select("id, project_name, estimated_value_max, currency, sales_stage, updated_at")
        .eq("owner_id", uid)
        .eq("stage", "won")
        .gte("updated_at", yearStart)
        .order("updated_at", { ascending: false })).data ?? [],
  });

  const { data: urgentQuotations = [] } = useQuery({
    queryKey: ["ws-urgent-quotations", uid],
    enabled: !!uid,
    queryFn: async () => {
      const sevenDaysOut = new Date();
      sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);
      return (await supabase
        .from("quotations")
        .select("id, related_opportunity_id, status, valid_until, total_value, currency")
        .eq("sales_owner_id", uid)
        .in("status", ["approved_for_submission", "submitted", "follow_up"])
        .lte("valid_until", sevenDaysOut.toISOString().slice(0, 10))
        .order("valid_until", { ascending: true })).data ?? [];
    },
  });

  const { data: jihOpps = [] } = useQuery({
    queryKey: ["ws-jih", uid],
    enabled: !!uid,
    queryFn: async () =>
      (await supabase
        .from("opportunities")
        .select("id, project_name, sales_stage, estimated_value_max, currency, win_confidence")
        .eq("owner_id", uid)
        .in("sales_stage", ["jih", "jih_bafo"])
        .order("updated_at", { ascending: false })).data ?? [],
  });
```

- [ ] **Step 2: Derive awarded value and achievement % after queries**

After the `pipelineValue` and `tg` lines (around line 131), add:

```typescript
  const awardedValue = awardedOpps.reduce((s: number, o: any) => s + (o.estimated_value_max ?? 0), 0);
  const achievementPct = tg?.sales_target ? Math.round((awardedValue / tg.sales_target) * 100) : null;
```

- [ ] **Step 3: Replace first KPI row with annual-target-aware KPIs**

Find the first `<section>` with grid of KpiCards (around line 189):
```typescript
      {/* KPI row */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label={t("ws_target_pipeline")} value={formatCurrency(pipelineValue, lang, "SAR")} hint={tg ? `${lang === "ar" ? "من" : "of"} ${formatCurrency(tg.pipeline_target, lang, "SAR")}` : (lang === "ar" ? "بدون هدف محدد" : "No target set")} />
        <KpiCard label={lang === "ar" ? "متأخرات اليوم" : "Overdue today"} value={formatNumber(overdueFU.length + overdueTasks.length, lang)} hint={lang === "ar" ? "متابعات ومهام" : "Follow-ups & tasks"} trend={overdueFU.length + overdueTasks.length > 0 ? "down" : "flat"} />
        <KpiCard label={lang === "ar" ? "بانتظار قرارك" : "Awaiting your decision"} value={formatNumber(myApprovals.length, lang)} hint={t("metric_awaiting_approval")} />
        <KpiCard label={lang === "ar" ? "حسابات نشطة" : "Active accounts"} value={formatNumber(data.accounts.length, lang)} hint={lang === "ar" ? "تحت إدارتك" : "Under your ownership"} />
      </section>
```
Replace with:
```typescript
      {/* KPI row */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label={t("ws_awarded_value")}
          value={formatCurrency(awardedValue, lang, "SAR")}
          hint={tg?.sales_target ? `${lang === "ar" ? "من هدف" : "of target"} ${formatCurrency(tg.sales_target, lang, "SAR")}` : (lang === "ar" ? "لا هدف محدد" : "No target set")}
          trend={achievementPct !== null ? (achievementPct >= 80 ? "up" : achievementPct >= 50 ? "flat" : "down") : undefined}
        />
        <KpiCard
          label={t("ws_achievement_pct")}
          value={achievementPct !== null ? `${achievementPct}%` : "—"}
          hint={lang === "ar" ? "إنجاز المبيعات" : "Sales achievement"}
          trend={achievementPct !== null ? (achievementPct >= 80 ? "up" : achievementPct >= 50 ? "flat" : "down") : undefined}
        />
        <KpiCard label={lang === "ar" ? "متأخرات اليوم" : "Overdue today"} value={formatNumber(overdueFU.length + overdueTasks.length, lang)} hint={lang === "ar" ? "متابعات ومهام" : "Follow-ups & tasks"} trend={overdueFU.length + overdueTasks.length > 0 ? "down" : "flat"} />
        <KpiCard label={lang === "ar" ? "بانتظار قرارك" : "Awaiting your decision"} value={formatNumber(myApprovals.length, lang)} hint={t("metric_awaiting_approval")} />
      </section>
```

- [ ] **Step 4: Add jih + quotations counts to second KPI section**

In the second `<section>` (the 3-column grid with ws_today_followups etc.), after `ws_missing_data` KpiCard, add:
```typescript
        <KpiCard label={t("ws_jih_summary")} value={formatNumber(jihOpps.length, lang)} hint={formatCurrency(jihOpps.reduce((s: number, o: any) => s + (o.estimated_value_max ?? 0), 0), lang, "SAR")} />
        <KpiCard label={t("ws_urgent_quotations")} value={formatNumber(urgentQuotations.length, lang)} hint={lang === "ar" ? "تستحق هذا الأسبوع" : "Due this week"} trend={urgentQuotations.length > 0 ? "down" : "flat"} />
```

- [ ] **Step 5: Add "jih" and "quotations" tabs**

In the `<TabsList>` block, after the tenders TabItem, add:
```tsx
            <TabItem value="jih" icon={<Award className="h-3.5 w-3.5" />} label={t("ws_jih_summary")} count={jihOpps.length} />
            <TabItem value="quotations" icon={<FileText className="h-3.5 w-3.5" />} label={t("ws_urgent_quotations")} count={urgentQuotations.length} />
```

- [ ] **Step 6: Add TabsContent panels for jih and quotations**

After the closing `</TabsContent>` for the tenders tab, add:

```tsx
          <TabsContent value="jih" className="mt-0">
            <ChartFrame title={t("ws_jih_summary")} subtitle={formatCurrency(jihOpps.reduce((s: number, o: any) => s + (o.estimated_value_max ?? 0), 0), lang, "SAR")} padded={false}>
              <List
                empty={t("ws_none")}
                items={jihOpps.map((o: any) => ({
                  key: o.id,
                  primary: o.project_name,
                  secondary: t(`sstage_${o.sales_stage}` as never),
                  tone: o.win_confidence === "sure_win" ? "positive" : o.win_confidence === "strong" ? "attention" : "neutral",
                  label: t(`sstage_${o.sales_stage}` as never),
                  right: formatCurrency(o.estimated_value_max, lang, o.currency),
                  href: { to: "/opportunities/$id" as const, params: { id: o.id } },
                }))}
              />
            </ChartFrame>
          </TabsContent>

          <TabsContent value="quotations" className="mt-0">
            <ChartFrame title={t("ws_urgent_quotations")} subtitle={`${formatNumber(urgentQuotations.length, lang)} ${lang === "ar" ? "عرض" : "quotations"}`} padded={false}>
              <List
                empty={t("ws_none")}
                items={urgentQuotations.map((q: any) => ({
                  key: q.id,
                  primary: q.related_opportunity_id ? oppName(q.related_opportunity_id) : "—",
                  secondary: humanize(q.status),
                  tone: q.valid_until && q.valid_until <= today ? "danger" : "attention",
                  label: t("ws_quotation_due"),
                  right: q.valid_until ?? "—",
                }))}
              />
            </ChartFrame>
          </TabsContent>
```

- [ ] **Step 7: Run tsc**

```bash
cd "D:\1-PROJECTS\PHC\phc-command-center-claude" && npx tsc --noEmit 2>&1 | head -30
```
Expected: 0 errors

- [ ] **Step 8: Commit**

```bash
git add src/routes/_authenticated/my-workspace.tsx
git commit -m "feat: enhance workspace KPIs — awarded value, achievement %, JIH panel, urgent quotations"
```

---

### Task 4: RFQ Quick-Create Dialog

**Files:**
- Modify: `src/routes/_authenticated/my-workspace.tsx`
- Modify: `src/lib/rfq-actions.ts`

**Interfaces:**
- Consumes: Task 2 i18n keys (`ws_new_rfq`, `ws_rfq_step1`, `ws_rfq_step2`, etc.), `createRfq` from rfq-actions, Supabase for contact dedup
- Produces: "New RFQ" button in PageHeader opens a two-step dialog; Step 1 searches contacts by phone/name (dedup); Step 2 sets RFQ details; on submit creates company (if new) + contact (if new) + rfq + opportunity (rfq_received stage) + follow-up (due in 3 days)

**Two-step flow:**
1. Step 1 (Company & Contact): text input for company name + phone → on blur, query `contacts` where phone matches → if found, show "Existing contact: [name] at [company]" with option to use it; if not found, show new fields for contact name
2. Step 2 (RFQ Details): project/scope text, response due date, estimated value, notes
3. Submit: upsert company → upsert contact (or use found) → create opportunity (stage=rfq_received, owner=uid, source_company=company) → create rfq (company_id, contact_id, opp_id, due_date, value) → create follow_up (opportunity_id, due 3 days, channel=call)

- [ ] **Step 1: Add createRfqWithOpportunity helper to rfq-actions.ts**

In `src/lib/rfq-actions.ts`, after the `convertRfqToJih` function, append:

```typescript
/**
 * Full RFQ quick-create: upserts company + contact (dedup by phone),
 * creates an opportunity at rfq_received stage, creates the RFQ,
 * and schedules a follow-up 3 days out.
 */
export async function createRfqWithOpportunity(input: {
  companyName: string;
  contactName: string;
  contactPhone: string;
  existingContactId?: string | null;
  existingCompanyId?: string | null;
  projectScope: string;
  responseDueDate: string;
  estimatedValue?: number | null;
}) {
  const uid = await currentUserId();

  // 1. Company — find or create
  let companyId = input.existingCompanyId ?? null;
  if (!companyId) {
    const existing = await supabase.from("companies").select("id").ilike("name", input.companyName.trim()).maybeSingle();
    if (existing.data) {
      companyId = existing.data.id;
    } else {
      const { data: newCo, error: coErr } = await supabase
        .from("companies")
        .insert({ name: input.companyName.trim(), company_type: "target_account", account_owner_id: uid })
        .select("id").single();
      if (coErr) throw coErr;
      companyId = newCo.id;
    }
  }

  // 2. Contact — find or create (dedup by phone)
  let contactId = input.existingContactId ?? null;
  if (!contactId && input.contactPhone) {
    const existing = await supabase.from("contacts").select("id").eq("phone", input.contactPhone.trim()).maybeSingle();
    if (existing.data) {
      contactId = existing.data.id;
    }
  }
  if (!contactId) {
    const { data: newContact, error: ctErr } = await supabase
      .from("contacts")
      .insert({ name: input.contactName.trim(), phone: input.contactPhone.trim() || null, company_id: companyId })
      .select("id").single();
    if (ctErr) throw ctErr;
    contactId = newContact.id;
  }

  // 3. Opportunity at rfq_received
  const { data: opp, error: oppErr } = await supabase
    .from("opportunities")
    .insert({
      project_name: input.projectScope.trim(),
      stage: "quotation",
      sales_stage: "rfq_received",
      source_company_id: companyId,
      owner_id: uid,
      flow_type: "direct_rfq",
    })
    .select("id").single();
  if (oppErr) throw oppErr;

  // 4. RFQ
  const rfq = await createRfq({
    projectId: null,
    companyId,
    contactId,
    responseDueDate: input.responseDueDate,
    estimatedValue: input.estimatedValue ?? null,
    claimOwner: true,
  });

  // 5. Follow-up (3 days out)
  const followUpDate = new Date();
  followUpDate.setDate(followUpDate.getDate() + 3);
  await supabase.from("follow_ups").insert({
    opportunity_id: opp.id,
    owner_id: uid,
    due_date: followUpDate.toISOString().slice(0, 10),
    channel: "call",
    status: "pending",
    notes: `RFQ follow-up — due ${input.responseDueDate}`,
  });

  // 6. Activity log
  await supabase.from("activities").insert({
    activity_type: "note",
    related_opportunity_id: opp.id,
    owner_id: uid,
    summary: `RFQ received from ${input.companyName} — ${input.projectScope}`,
    occurred_at: new Date().toISOString(),
  });

  return { opportunityId: opp.id, rfqId: rfq.id, companyId, contactId };
}

/** Dedup check: find a contact by phone number. */
export async function findContactByPhone(phone: string) {
  if (!phone.trim()) return null;
  const { data } = await supabase
    .from("contacts")
    .select("id, name, phone, company_id, companies(name)")
    .eq("phone", phone.trim())
    .maybeSingle();
  return data ?? null;
}
```

- [ ] **Step 2: Add RFQ dialog state + handler to WorkspacePage**

In `my-workspace.tsx`, add these state variables after the existing `draftFuId` state (around line 54):

```typescript
  const [rfqOpen, setRfqOpen] = useState(false);
  const [rfqStep, setRfqStep] = useState<1 | 2>(1);
  const [rfqCreating, setRfqCreating] = useState(false);
  const [rfqPhone, setRfqPhone] = useState("");
  const [rfqFoundContact, setRfqFoundContact] = useState<{ id: string; name: string; companyName: string } | null>(null);
  const [rfqDedupChecked, setRfqDedupChecked] = useState(false);
  const [rfqForm, setRfqForm] = useState({
    companyName: "", contactName: "", contactPhone: "",
    projectScope: "", responseDueDate: "", estimatedValue: "",
  });
```

Add this handler (after `handleDraftFollowUp`):

```typescript
  async function handleRfqPhoneBlur(phone: string) {
    if (!phone.trim()) return;
    const found = await findContactByPhone(phone);
    if (found) {
      const compName = (found as any).companies?.name ?? "";
      setRfqFoundContact({ id: found.id, name: found.name, companyName: compName });
      setRfqForm((f) => ({ ...f, contactName: found.name, companyName: compName }));
    } else {
      setRfqFoundContact(null);
    }
    setRfqDedupChecked(true);
  }

  async function handleRfqSubmit() {
    if (!rfqForm.companyName || !rfqForm.projectScope || !rfqForm.responseDueDate) {
      toast.error(lang === "ar" ? "يرجى تعبئة الحقول المطلوبة" : "Fill required fields");
      return;
    }
    setRfqCreating(true);
    try {
      const result = await createRfqWithOpportunity({
        companyName: rfqForm.companyName,
        contactName: rfqForm.contactName,
        contactPhone: rfqForm.contactPhone,
        existingContactId: rfqFoundContact?.id ?? null,
        projectScope: rfqForm.projectScope,
        responseDueDate: rfqForm.responseDueDate,
        estimatedValue: rfqForm.estimatedValue ? Number(rfqForm.estimatedValue) : null,
      });
      toast.success(`${t("ws_rfq_created")}${rfqFoundContact ? ` ${t("ws_dedup_found")}` : ""}`);
      setRfqOpen(false);
      setRfqStep(1);
      setRfqForm({ companyName: "", contactName: "", contactPhone: "", projectScope: "", responseDueDate: "", estimatedValue: "" });
      setRfqFoundContact(null);
      setRfqDedupChecked(false);
      qc.invalidateQueries({ queryKey: ["workspace", uid] });
      qc.invalidateQueries({ queryKey: ["ws-rfqs", uid] });
      navigate({ to: "/opportunities/$id", params: { id: result.opportunityId } });
    } catch (e) {
      toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
    } finally {
      setRfqCreating(false);
    }
  }
```

Also add `findContactByPhone` and `createRfqWithOpportunity` to the import from `@/lib/rfq-actions`:
```typescript
import { createRfq, convertRfqToJih, createRfqWithOpportunity, findContactByPhone } from "@/lib/rfq-actions";
```

- [ ] **Step 3: Add New RFQ button to PageHeader actions**

Find the existing `<button onClick={() => setLogOpen(true)} ...>` in the PageHeader `actions` prop.
Wrap with a flex container and add the RFQ button:

```tsx
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setRfqOpen(true); setRfqStep(1); }}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3.5 text-[12px] font-medium text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" /> {t("ws_new_rfq")}
            </button>
            <button
              onClick={() => setLogOpen(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-amber/40 bg-amber/10 px-3.5 text-[12px] font-medium text-amber-light transition-colors hover:bg-amber/20"
            >
              <Sparkles className="h-3.5 w-3.5" /> {t("ws_log_activity")}
            </button>
          </div>
        }
```

Add `Plus` to the lucide-react import.

- [ ] **Step 4: Add RFQ dialog JSX before the closing `</div>` of the return**

Add after the reschedule ActionDialog:

```tsx
      {/* RFQ Quick-Create Dialog */}
      <Dialog open={rfqOpen} onOpenChange={(v) => { if (!rfqCreating) { setRfqOpen(v); if (!v) { setRfqStep(1); setRfqFoundContact(null); setRfqDedupChecked(false); } } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("ws_new_rfq")} — {rfqStep === 1 ? t("ws_rfq_step1") : t("ws_rfq_step2")}</DialogTitle>
          </DialogHeader>

          {rfqStep === 1 && (
            <div className="space-y-3 py-2">
              <div className="space-y-1">
                <Label className="text-xs">{t("ws_rfq_contact_phone")}</Label>
                <input
                  type="tel"
                  value={rfqForm.contactPhone}
                  onChange={(e) => { setRfqForm((f) => ({ ...f, contactPhone: e.target.value })); setRfqDedupChecked(false); setRfqFoundContact(null); }}
                  onBlur={(e) => handleRfqPhoneBlur(e.target.value)}
                  placeholder="+966..."
                  className="w-full rounded-md border border-border bg-surface/60 px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-border-strong focus:outline-none"
                />
                {rfqDedupChecked && rfqFoundContact && (
                  <p className="text-[11px] text-emerald-400">✓ {t("ws_dedup_found")} {rfqFoundContact.name} ({rfqFoundContact.companyName})</p>
                )}
                {rfqDedupChecked && !rfqFoundContact && (
                  <p className="text-[11px] text-muted-foreground">{lang === "ar" ? "جهة اتصال جديدة" : "New contact"}</p>
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("ws_rfq_contact")} *</Label>
                <input
                  type="text"
                  value={rfqForm.contactName}
                  onChange={(e) => setRfqForm((f) => ({ ...f, contactName: e.target.value }))}
                  className="w-full rounded-md border border-border bg-surface/60 px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-border-strong focus:outline-none"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("ws_rfq_company")} *</Label>
                <input
                  type="text"
                  value={rfqForm.companyName}
                  onChange={(e) => setRfqForm((f) => ({ ...f, companyName: e.target.value }))}
                  className="w-full rounded-md border border-border bg-surface/60 px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-border-strong focus:outline-none"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setRfqOpen(false)}>
                  {lang === "ar" ? "إلغاء" : "Cancel"}
                </Button>
                <Button size="sm" onClick={() => setRfqStep(2)} disabled={!rfqForm.companyName}>
                  {lang === "ar" ? "التالي" : "Next"} →
                </Button>
              </div>
            </div>
          )}

          {rfqStep === 2 && (
            <div className="space-y-3 py-2">
              <div className="space-y-1">
                <Label className="text-xs">{t("ws_rfq_project")} *</Label>
                <textarea
                  value={rfqForm.projectScope}
                  onChange={(e) => setRfqForm((f) => ({ ...f, projectScope: e.target.value }))}
                  rows={2}
                  className="w-full rounded-md border border-border bg-surface/60 px-3 py-2 text-xs text-foreground focus:border-border-strong focus:outline-none"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("ws_rfq_due")} *</Label>
                <input
                  type="date"
                  value={rfqForm.responseDueDate}
                  onChange={(e) => setRfqForm((f) => ({ ...f, responseDueDate: e.target.value }))}
                  className="w-full rounded-md border border-border bg-surface/60 px-3 py-2 text-xs text-foreground focus:border-border-strong focus:outline-none"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("ws_rfq_value")}</Label>
                <input
                  type="number"
                  value={rfqForm.estimatedValue}
                  onChange={(e) => setRfqForm((f) => ({ ...f, estimatedValue: e.target.value }))}
                  className="w-full rounded-md border border-border bg-surface/60 px-3 py-2 text-xs text-foreground focus:border-border-strong focus:outline-none"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setRfqStep(1)}>
                  ← {lang === "ar" ? "السابق" : "Back"}
                </Button>
                <Button size="sm" onClick={handleRfqSubmit} disabled={rfqCreating || !rfqForm.projectScope || !rfqForm.responseDueDate}>
                  {rfqCreating ? (lang === "ar" ? "جارٍ الإنشاء…" : "Creating…") : (lang === "ar" ? "إنشاء الطلب" : "Create RFQ")}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
```

Also add missing imports to the top of my-workspace.tsx:
- `Plus` from lucide-react (already available via destructuring — just add to the list)
- `Label` from `@/components/ui/label`
- `Button` from `@/components/ui/button`
- `Dialog, DialogContent, DialogHeader, DialogTitle` from `@/components/ui/dialog`
- `createRfqWithOpportunity, findContactByPhone` from `@/lib/rfq-actions`

- [ ] **Step 5: Run tsc**

```bash
cd "D:\1-PROJECTS\PHC\phc-command-center-claude" && npx tsc --noEmit 2>&1 | head -40
```
Expected: 0 errors

- [ ] **Step 6: Run build**

```bash
cd "D:\1-PROJECTS\PHC\phc-command-center-claude" && bun run build 2>&1 | tail -20
```
Expected: exit 0

- [ ] **Step 7: Commit**

```bash
git add src/routes/_authenticated/my-workspace.tsx src/lib/rfq-actions.ts
git commit -m "feat: two-step RFQ quick-create form with contact dedup in workspace"
```

---

### Task 5: Final Validation & PR

**Files:**
- No new files — validation + PR creation only

**Interfaces:**
- Consumes: all tasks 1-4 committed to branch `feature/salesperson-dashboard-rfq-workflow`

- [ ] **Step 1: TypeScript clean check**

```bash
cd "D:\1-PROJECTS\PHC\phc-command-center-claude" && npx tsc --noEmit 2>&1
```
Expected: 0 errors

- [ ] **Step 2: Bun test**

```bash
cd "D:\1-PROJECTS\PHC\phc-command-center-claude" && bun test 2>&1 | tail -20
```
Expected: all pass (or same failures as before this branch)

- [ ] **Step 3: Production build**

```bash
cd "D:\1-PROJECTS\PHC\phc-command-center-claude" && bun run build 2>&1 | tail -10
```
Expected: exit 0

- [ ] **Step 4: Push branch**

```bash
cd "D:\1-PROJECTS\PHC\phc-command-center-claude" && git push -u origin feature/salesperson-dashboard-rfq-workflow
```

- [ ] **Step 5: Create PR**

```bash
cd "D:\1-PROJECTS\PHC\phc-command-center-claude" && gh pr create \
  --title "feat: salesperson dashboard KPIs + BAFO stages + RFQ quick-create" \
  --body "$(cat <<'EOF'
## Summary

- New workflow stages: `jih_bafo`, `contract_signed` (sales), `tender_bafo` (tenders), `annual` (targets)
- Dashboard KPIs: awarded value, achievement %, JIH pipeline panel, urgent quotations tab
- Two-step RFQ quick-create form with phone-based contact dedup, auto-creates opportunity + follow-up

## DB changes

One non-destructive migration: `20260716100000_salesperson_dashboard.sql` — adds enum values only, no table changes.

## Test plan

- [ ] Run migration on Supabase dashboard (project: lrfdtoexyeghrzynapyn)
- [ ] Open `/my-workspace` — verify awarded value + achievement % KPIs appear
- [ ] Click "New RFQ" — step 1 asks for phone → enter existing → confirms dedup
- [ ] Complete step 2 → creates opportunity + redirects to detail page
- [ ] On `/rfq-jih` board, advance a JIH opp to "JIH BAFO" stage — confirm new stage appears
- [ ] On `/tenders`, advance a tender to "Tender BAFO" — confirm new stage appears

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Record PR number in ledger**
