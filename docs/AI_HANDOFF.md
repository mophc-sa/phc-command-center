# AI Handoff ⭐ — PHC Command Center

> **أهم ملف بعد CLAUDE.md.** يُحدَّث في نهاية كل جلسة. اقرأه أولًا عند بداية أي جلسة/حساب جديد.

## Date
2026-07-26  *(محدَّثة — فحص شامل للنظام + معالجة كل الفجوات المفتوحة القابلة للتنفيذ الفوري)*

## Current Branch
`main` — التزامات مباشرة (لا PR بعد، انظر "Files Modified" أدناه لما هو غير مُدفوع). worktree `d1-normalize-company-name` أُزيل نهائيًا (كان مدموجًا بالكامل، بلا عمل فريد).

## Last Commit
`471f488` — fix(dashboard): unify KPI computation across dashboards (Pathfinder D6) (#121) · مدمج على main
(ترتيب الدمج الفعلي: #116→#117→#118→#119→#120→#121، كل واحد بعد `update-branch` ضد main المحدَّث وتحقّق CI أخضر قبل الدمج؛ لا تعارضات ولو أن #119 وَ#120 يعدّلان نفس الملف import-pipeline/index.ts. ثم PR #122 لتحديث هذا الملف نفسه.)

## Current Goal
**لا يوجد هدف Sprint محدَّد بعد** — ابدأ الجلسة القادمة بتحديد هدف واحد في `tasks/current.md`. المتبقي من دورة Pathfinder: فحوصات دخانية وظيفية (smoke tests) + UAT (انظر "تقرير النشر" أدناه) — **قرار 2026-07-23 (`docs/DECISIONS.md`): غير عاجلة، مؤجَّلة عمدًا لوقت لاحق مناسب**، وليست حاجزًا أمام أي عمل آخر. لا تُعامَل كبند حرج معلّق في الجلسات القادمة.

## Completed (2026-07-26) — فحص شامل للنظام + معالجة الفجوات المفتوحة
طُلب فحص شامل ("ما ينقص النظام؟")، ثم معالجة كل ما ظهر بالترتيب حسب الأهمية. القرارات الحقيقية (D1/D2 أدناه، ملفات Docker، دمج dependabot) طُلبت من المستخدم صراحة عبر أسئلة موجَّهة قبل التنفيذ — لم تُفترَض.
- **بق مُصلَح:** 4 ملفات contract test فاشلة (`ai-orchestrator.contract.test.ts`, `ai-orchestrator-hardening.contract.test.ts`, وملفان آخران متأثران بنفس الجذر) — السبب: `readdirSync(migrationsDir).find(f => f.includes("ai_orchestrator"))` يطابق 3 ملفات migration مختلفة، وترتيب `readdirSync` غير مضمون فيختار الملف الخطأ. أُصلح باستبدال المسار الصريح الكامل (نفس نمط `ai-orchestrator-idempotency-fingerprint.contract.test.ts` الصحيح أصلًا). `bun test src`: 438/438 ناجحة. `bun run verify`: نظيف بالكامل.
- **D1 (قرار مستخدم):** توسيع مطابقة التكرار العربية في `import-dedup.ts::compareSignals()` لتقارن `main_contractor` أيضًا (كانت معرَّفة في `DedupSignals` وممرَّرة من `import-pipeline/index.ts` لكن غير مقارَنة أبدًا — فجوة صامتة). اختبار جديد مضاف. التفاصيل والسبب في `docs/DECISIONS.md` (2026-07-26).
- **D2 (قرار مستخدم):** `leads.source = 'import'` قيمة رسمية الآن، وترك `owner_id` فارغًا عند إنشاء leads من الخادم مقصود — موثَّق في تعليقات `_shared/leads.ts` وmigration جديدة توثيقية بحتة (`20260726100000_document_leads_source_owner_id.sql`، `COMMENT ON COLUMN` فقط) **لم تُنشَر بعد** (بانتظار بوابة الموافقة المعتادة — لا تنشرها بدون موافقة صريحة منفصلة).
- **تنظيف:** حُذفت `.handoff/rbac-hardening-sprint8-*` (قديمة، مؤكَّدة غير منطبقة سابقًا). أُزيل worktree `d1-normalize-company-name` المحلي بعد تأكيد أنه مدموج بالكامل وملفاته غير المتتبَّعة مطابقة حرفيًا لنسخة main. صُحِّحت ملاحظة قديمة خاطئة في `docs/ROADMAP.md` (ملفات Docker كانت مُلتزَمة بالفعل منذ PR #113، وليست فجوة).
- **Dependabot:** دُمجت 3 PRs آمنة (#72 upload-artifact، #73 gitleaks-action، #74 checkout) بعد `gh pr update-branch` + CI أخضر بالكامل. PR #75/#76 (dependency bumps) **لم تُدمَجا** — `bun install --frozen-lockfile` يفشل عليهما (lockfile الذي أنشأه dependabot لا يطابق ما يحسبه bun)، ولا تُصلحان الاكتشاف التالي أصلًا.
- **⚠️ اكتشاف جديد أثناء الفحص (غير مُصلَح — أولوية عالية):** `bun audit` يطبع gzip خامًا غير مقروء بدل تقرير (bug في bun 1.3.14 نفسه، محليًا وفي CI)، مما أخفى ثغرتين **high** حقيقيتين موجودتين على main حاليًا: `brace-expansion` (عبر eslint) وpostcss (عبر vite) — كلاهما devDependency انتقالية لا تُشحَن للإنتاج، لكن فحص "Dependency audit" في CI أحمر على main نفسه بسببهما الآن. تفاصيل كاملة + خطة إصلاح مقترحة في `docs/KNOWN_ISSUES.md`.

## 🚀 تقرير النشر إلى الإنتاج — 2026-07-23 ~13:35 UTC
نُفِّذ بعد موافقة صريحة من المستخدم وتحقّق نظيف من الـ migration preflight (GitHub Actions run [30011068082](https://github.com/mophc-sa/phc-command-center/actions/runs/30011068082) — ناجح، migration واحدة معلّقة فقط، لا أخطاء schema).

**Migration:**
- `20260723120000_extend_delete_allowlist_import_batches.sql` — مُطبَّقة على `lrfdtoexyeghrzynapyn` عبر `supabase db push --linked`.
- تحقّق ما بعد التطبيق: `supabase migration list --linked` يُظهر تطابق Local/Remote الكامل، و`supabase db lint --linked` نظيف.

**Edge Functions (فقط اللتان تغيّرتا — لم يُنشر غيرهما):**
| Function | نسخة قبل | نسخة بعد | فحص صحة |
|---|---|---|---|
| `import-pipeline` | 31 | **32** | `curl` غير مصادَق → 401 (صحي) |
| `sales-os-api` | 38 | **39** | `curl` غير مصادَق → 401 (صحي) |
| `ai-orchestrator` | 26 | 26 (بلا تغيير، مؤكَّد) | — |
| `error-ingest` | 10 | 10 (بلا تغيير، مؤكَّد) | — |

**مسار التراجع (Rollback):** إن لزم التراجع عن الدوال، أعد نشر الإصدار السابق عبر Supabase Dashboard (Functions → Deployments → السحب لنسخة 31/38) أو `git checkout` للـ commit السابق ثم `supabase functions deploy`. للـ migration: لا يوجد down-migration جاهزة — التراجع اليدوي هو `CREATE OR REPLACE FUNCTION execute_approved_record_delete` بإعادة النسخة السابقة من commit `9a79e6c^` (قبل D5)، لا `db reset`/`migration repair` مطلقًا حسب سياسة الأمان.

**غير المُنفَّذ عمدًا (يحتاج تنفيذ يدوي):** الفحوصات الوظيفية (قسم 3 في قائمة التحقق) وUAT (قسم 6) — كلاهما يستلزم كتابة بيانات اختبار حقيقية إلى CRM الحي، وهذا يحتاج موافقة صريحة منفصلة حسب "Safety Rules" في deployment-governance.md ("import/commit CRM data without approval"). قائمة التحقق الكاملة محفوظة في Obsidian: `1. PROJECTS/PHC/PHC Command Center — Post-Deploy Checklist (Jul 23 2026).md`.

## Completed (أحدث دفعة) — إغلاق الفجوات المتبقية من مراجعات fresh-eyes
- **D4 (PR #118)**: أُضيف اختبار انحدار (`security-baseline.contract.test.ts`، commit `71dde38`) يقفل حذف `/team.tsx` وحماية `admin-settings.tsx` — تحقّق عبر negative control (إعادة إنشاء team.tsx مؤقتًا، تأكيد فشل الاختبار، ثم إزالته وتأكيد نجاحه).
- **D2 (PR #119)**: تشغيل فعلي (live smoke test) لكلا مساري `insertLeadServerSide` على Supabase محلي حقيقي (وليس source-contract فقط):
  - `run_protenders_ingest`: تأكيد أن try/catch (من إصلاح المراجعة السابقة) يعزل الصفوف الفاشلة صحيحًا، leads_created/leads_failed دقيقة، lead_stage='detected'، source='protenders'، audit_log مسجَّل.
  - `commit_candidates` (مسار leads): تأكيد أن الحقل الكامل (بما فيه research_notes، إصلاح المراجعة السابقة) يُمرَّر كاملًا، وaudit_log مسجَّل.
  - نُشرت كتعليق متابعة على PR #119.
- **D5 (PR #120)**: تشغيل فعلي كامل لتدفق الحذف المحكوم (request_delete→decide_approval→execute_delete) لسيناريوهين:
  - المسار السعيد: cascade ذري كامل (batch/files/rows→0)، فصل الأدوار الثلاثي مؤكَّد (sales_manager مرفوض من التنفيذ)، audit_log صحيح.
  - المسار المحروس: دفعة بها import_record_links ملتزمة → execute_delete يرفض بالضبط برسالة الخطأ المتوقعة من إصلاح المراجعة، والبيانات تبقى سليمة، execution_status='skipped'.
  - نُشرت كتعليق متابعة على PR #120.
- ملاحظة بنية تحتية مكتشفة: edge runtime المحلي (`supabase_edge_runtime_lrfdtoexyeghrzynapyn`) مربوط bind-mount بمجلد `supabase/functions` الخاص بـ worktree D1 فقط (أول واحد شُغِّل فيه `supabase start`) — لاختبار كود Edge Function من فرع آخر، يلزم نسخ الملفات مؤقتًا إلى D1 ثم `docker restart` (الـ runtime يخزّن الكود المُصرَّف ولا يعيد التحميل تلقائيًا). أُعيد D1 لحالته النظيفة بعد الاختبار.

## Completed (أحدث دفعة) — جولة مراجعة PR مستقلة (fresh-eyes review)
بعد فتح كل الـ 6 PRs، طلب المستخدم مراجعة مستقلة (subagent بلا أي سياق سابق عن كيفية بناء كل PR) لكل واحد، ونُشرت كتعليقات مراجعة فعلية على GitHub (`gh pr review --comment`). النتائج:
- **PR #116 (D1)**: ✅ Approve. لا ملاحظات Critical/Important. ملاحظتان Minor (توسّع مطابقة الأسماء العربية ليشمل project_name/contractor_name أيضًا — يستحق تأكيد منتج؛ فرق سطر واحد في عدّ الأسطر بوصف الـ PR).
- **PR #117 (D3)**: ✅ Approve with comments. لا ملاحظات Critical/Important. الفحص اليدوي عبر المتصفح لا يزال غير منجز (Chrome extension).
- **PR #118 (D4)**: ⚠️ Approve with comments. لا ملاحظات Critical/Important. يُنصَح بإضافة اختبار انحدار للحماية الأمنية (غير موجود حاليًا).
- **PR #119 (D2)**: ⚠️ Approve with comments. **وجدت Important حقيقي**: حلقة إدراج leads في run_protenders_ingest لم يكن لها try/catch — فشل صف واحد وسط 5 كان سيُسقط سجل التدقيق الكامل للدفعة ويُرجع 500 دون تسجيل ما نجح. **أُصلح فورًا** (commit `247feb1`): كل إدراج الآن محاط بـ try/catch، والاستجابة تُبلغ leads_created/leads_failed الفعليين بدل افتراض نجاح الكل. تحقّق typecheck/deno check/الاختبار القائم بعد الإصلاح.
- **PR #120 (D5)**: ⚠️ Approve with comments. **وجدت Important حقيقي**: تعليق الـ migration يدّعي "كل جدول يشير لـ import_batches لديه ON DELETE CASCADE" — خطأ؛ 4 أعمدة (على جداول CRM حية: import_source_profiles، account_interactions، quotation_updates، sales_actuals_monthly) هي ON DELETE SET NULL. تحقّقتُ بنفسي: **لا يوجد أي كود تطبيق يكتب على هذه الأعمدة الأربعة حاليًا** (grep شامل نظيف) — أثر أمني حالي = صفر، مجرد schema غير مُفعَّل لميزة لم تُبنَ بعد. **أُصلح** (commit `9a79e6c`): تصحيح التعليق فقط + ملاحظة لمراجعة الحارس (guard) إذا بدأت ميزة مستقبلية بملء هذه الأعمدة خارج مسار import_record_links.
- **PR #121 (D6)**: ✅ Approve with comments. لا ملاحظات Critical/Important — تحقّق المراجع المستقل من كل قيمة KPI سطرًا بسطر (بما فيها إعادة التحقق من إصلاح عمود stage الحرج) وأكّد صحتها. **وجدت Minor**: computeQuotationWinRatePct بلا اختبار وحدة مباشر لمعامل emptyValue (السلوك الوحيد الجديد في الدالة). **أُصلح** (commit `877db1a`): 3 حالات اختبار جديدة (61/61 ناجحة). الفحص اليدوي عبر المتصفح لا يزال غير منجز — **مُوصى به بقوة نظرًا لتأثير الـ PR على أرقام حقيقية**، وليس مجرد شكلية.

## Completed (الدفعة السابقة — بناء الـ 6 PRs)
- **PR #121**: توحيد KPI (Pathfinder D6) — لم يكن finding مؤكدًا، اكتُشف عبر `/investigate` هذه الجلسة: my-workspace.tsx يعرض رقمًا مختلفًا لنفس بطاقة KPI حسب دور المستخدم. اكتُشف bug إضافي أثناء التنفيذ (عمود stage مفقود من الاستعلام).
- **PR #120**: توحيد حذف import batches (Pathfinder D5) — الأعمق بحثًا. يتضمّن migration جديدة (لم تُنشر بعد — النشر منفصل وبوابة موافقة).
- **PR #119**: helper مشترك لإنشاء leads من الخادم (Pathfinder D2).
- **PR #118**: حذف صفحة `/team` غير المحمية (Pathfinder D4، أولوية أمنية).
- **PR #117**: نقل زر Scan Pipeline (Pathfinder D3).
- **PR #116**: توحيد company-name normalization (Pathfinder D1).
- PR #115/#114/#112/#113: migration preflight، AI Agent Outputs Review UI، RBAC + Docker محلي.
- **Pathfinder** (مسح معماري كامل، 2026-07-22): كل البنود الستة (D1–D6) الآن مُنفَّذة عبر PRs مفتوحة، ومراجَعة مستقلة مرتين. التفاصيل الأصلية في `PATHFINDER-2026-07-22/`.

## In Progress
- ⚠️ التزامات اليوم (2026-07-26) لا تزال محلية على `main` — لم تُدفَع بعد. راجع "Files Modified" أدناه، ثم افتح PR (لا تدفع مباشرة لـ main) قبل أي شيء آخر.
- متبقٍ (غير عاجل — قرار 2026-07-23): فحوصات وظيفية + UAT على الإنتاج (قسمان 3 و6 من قائمة التحقق) — لم تُنفَّذ عمدًا لأنها تكتب بيانات إلى CRM حي، والمستخدم قرّر تأجيلها لوقت مناسب لاحقًا (انظر `docs/DECISIONS.md`). القائمة في Obsidian: `1. PROJECTS/PHC/PHC Command Center — Post-Deploy Checklist (Jul 23 2026).md`.
- ⚠️ push إلى GitHub يحتاج حساب `gh` النشط = `mophc-sa` (وليس `moalagab`) — تم التبديل عبر `gh auth switch --user mophc-sa`، يبقى نشطًا ما لم يُبدَّل.
- ✅ (مُصلَح) Chrome browser extension كان يبدو غير متصل داخل جلسات background job — التشخيص الأول كان خاطئًا (اعتُقد أنه قيد جسر لا يمكن تجاوزه). الإصلاح الفعلي: نداء `list_connected_browsers` ثم `select_browser(deviceId)` صراحةً قبل أي استخدام آخر — يعمل فورًا بعده. استُخدم بنجاح في فحوصات D3 وD6 اليدوية.

## Next Task
- افتح PR لالتزامات 2026-07-26 (D1 dedup fix، D2 migration، ai-orchestrator test fix، تنظيف)، ثم راجعه وادمجه.
- **(أولوية عالية)** إصلاح ثغرتي `brace-expansion`/`postcss` الحقيقيتين المخفيتين وراء bug `bun audit` — انظر `docs/KNOWN_ISSUES.md` و`tasks/backlog.md`.
- نشر migration `20260726100000_document_leads_source_owner_id.sql` بعد موافقة (توثيقية بحتة، بلا مخاطرة سكيما).
- بند غير عاجل في الخلفية: الفحوصات الوظيفية + UAT على الإنتاج (يدويًا، بموافقة صريحة إضافية لكتابة بيانات اختبار في CRM حي) — راجع قسمَي 3 و6 في قائمة التحقق المحفوظة بـ Obsidian، متى ما ناسب الوقت.
- طبيعي: اختر بند جديد من `tasks/backlog.md` وانقله إلى `tasks/current.md` عند بدء الجلسة القادمة.

## Files Modified (شجرة العمل الآن)
- ملتزَمة على main محليًا (2026-07-26، غير مدفوعة بعد): D1 dedup fix (`import-dedup.ts`+test)، D2 migration + `leads.ts` comments، إصلاح 4 ملفات ai-orchestrator contract test، حذف `.handoff/rbac-hardening-sprint8-*`، تصحيح `docs/ROADMAP.md`، تحديثات `docs/DECISIONS.md`/`docs/KNOWN_ISSUES.md`/`tasks/backlog.md`/هذا الملف.
- `.claude/` (untracked)
- `PATHFINDER-2026-07-22/` (untracked — نتائج المسح المعماري)
- `docs/superpowers/plans/2026-07-22-company-name-normalization-unification.md`، `2026-07-22-scan-pipeline-relocation.md`، `2026-07-23-remove-team-page.md`، `2026-07-23-shared-lead-insert-helper.md`، `2026-07-23-import-batch-delete-unification.md`، `2026-07-23-dashboard-kpi-consistency.md` (untracked)

## Pending Decisions
- لا يوجد حاليًا — D1/D2/Docker/rbac-hardening كلها قُرِّرت ونُفِّذت 2026-07-26 (انظر `docs/DECISIONS.md`).

## Risks
- بيانات CRM حية: أي التزام/نشر يمرّ ببوابة موافقة (انظر deployment-governance.md).
- المشروع مربوط بـ Lovable — لا تُعِد كتابة تاريخ Git المدفوع (force-push/rebase/amend).
- فحص "Dependency audit" في CI أحمر على main حاليًا (انظر `docs/KNOWN_ISSUES.md`) — لا تفترض أنه أخضر عند فتح PR جديد.

## Commands
```bash
bun run dev            # تشغيل محلي
bun run verify         # typecheck + lint + test + build (البوابة قبل PR)
bun run test:e2e       # Playwright
supabase start && bun run test:db && supabase stop --no-backup   # اختبارات DB
```

## Notes
- Production Supabase: `lrfdtoexyeghrzynapyn` · Legacy (لا تلمسه): `xpoduufwoklvsbuhywsv`.
- Production Worker: `mophc-sa-phc-command-center` على `agent.phc-sa.com`.
