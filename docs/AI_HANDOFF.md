# AI Handoff ⭐ — PHC Command Center

> **أهم ملف بعد CLAUDE.md.** يُحدَّث في نهاية كل جلسة. اقرأه أولًا عند بداية أي جلسة/حساب جديد.

## Date
2026-07-23  *(محدَّثة — D1 حتى D6 نُفِّذت، رُوجعت مرتين، دُمجت كل الـ 6 PRs (#116-#121)، ثم **نُشرت migration D5 وEdge Functions المتأثرة فعليًا إلى الإنتاج**)*

## Current Branch
`main` — **كل الـ 6 PRs دُمجت، والنشر إلى الإنتاج مكتمل** (كود + قاعدة بيانات). الـ worktrees الستة لا تزال موجودة محليًا لكن فروعها البعيدة دُمجت بالفعل (لم تُحذف من remote، حسب عرف المستودع).

## Last Commit
`471f488` — fix(dashboard): unify KPI computation across dashboards (Pathfinder D6) (#121) · مدمج على main
(ترتيب الدمج الفعلي: #116→#117→#118→#119→#120→#121، كل واحد بعد `update-branch` ضد main المحدَّث وتحقّق CI أخضر قبل الدمج؛ لا تعارضات ولو أن #119 وَ#120 يعدّلان نفس الملف import-pipeline/index.ts. ثم PR #122 لتحديث هذا الملف نفسه.)

## Current Goal
**لا يوجد — دورة Pathfinder D1-D6 مكتملة بالكامل: منفَّذة، مراجَعة، مدموجة، ومنشورة على الإنتاج.** المتبقي فقط: فحوصات دخانية وظيفية (smoke tests) على بيانات حقيقية + UAT مُتحكَّم به (انظر "تقرير النشر" أدناه) — هذه تحتاج مستخدمين حقيقيين ولم تُنفَّذ من قِبل الـ AI عمدًا (تفادي كتابة بيانات اختبار في CRM حي بلا موافقة صريحة إضافية).

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
- ~~RBAC Hardening (Sprint 8) patch~~ — تحقّقنا: قديم ولا ينطبق، مُنجز أصلًا عبر مسار آخر. يمكن حذف `.handoff/rbac-hardening-sprint8-*` بأمان.
- ~~PR #116-#121 بانتظار دمج~~ — **دُمجت جميعها** (2026-07-23، الساعة ~12:49–13:05 UTC) بالترتيب المطلوب: #116→#117→#118→#119→#120→#121.
- ~~D5 migration لم تُنشر بعد~~ — **نُشرت** (2026-07-23 ~13:35 UTC). التفاصيل الكاملة في "تقرير النشر" أعلاه.
- ⚠️ **متبقٍ: فحوصات وظيفية + UAT على الإنتاج** (قسمان 3 و6 من قائمة التحقق) — لم تُنفَّذ عمدًا لأنها تكتب بيانات إلى CRM حي. القائمة في Obsidian: `1. PROJECTS/PHC/PHC Command Center — Post-Deploy Checklist (Jul 23 2026).md`.
- الـ worktrees الستة المحلية (`d1`-`d6`) — 5 منها (`d2`-`d6`) أُزيلت بالفعل بعد تأكيد المستخدم؛ `d1` باقٍ فقط لأنه المجلد الذي تعمل فيه هذه الجلسة نفسها (يحتاج إزالة يدوية بعد انتهاء الجلسة).
- ⚠️ push إلى GitHub يحتاج حساب `gh` النشط = `mophc-sa` (وليس `moalagab`) — تم التبديل عبر `gh auth switch --user mophc-sa`، يبقى نشطًا ما لم يُبدَّل.
- ✅ (مُصلَح) Chrome browser extension كان يبدو غير متصل داخل جلسات background job — التشخيص الأول كان خاطئًا (اعتُقد أنه قيد جسر لا يمكن تجاوزه). الإصلاح الفعلي: نداء `list_connected_browsers` ثم `select_browser(deviceId)` صراحةً قبل أي استخدام آخر — يعمل فورًا بعده. استُخدم بنجاح في فحوصات D3 وD6 اليدوية.

## Next Task
- **دورة Pathfinder (D1-D6) مكتملة بالكامل: منفَّذة، مراجَعة، مدموجة، ومنشورة.** لا عمل هندسي متبقٍ من نطاقها.
- العنصر الوحيد المفتوح: تنفيذ الفحوصات الوظيفية + UAT على الإنتاج (يدويًا، بموافقة صريحة إضافية لكتابة بيانات اختبار في CRM حي) — راجع قسمَي 3 و6 في قائمة التحقق المحفوظة بـ Obsidian.
- 🩹 bug غير متعلق (اكتُشف أثناء D1): `src/lib/ai-orchestrator*.contract.test.ts` يفشل (7 اختبارات) بسبب `readdirSync().find()` يختار ملف migration خاطئ عند تعدد التطابقات. يستحق issue/فرع منفصل — لم يُلمَس ضمن نطاق Pathfinder.
- طبيعي: اختر بند جديد من `tasks/backlog.md` وانقله إلى `tasks/current.md` عند بدء الجلسة القادمة.

## Files Modified (شجرة العمل الآن — غير متتبَّعة)
- `.claude/` (untracked)
- `PATHFINDER-2026-07-22/` (untracked — نتائج المسح المعماري)
- `docs/superpowers/plans/2026-07-22-company-name-normalization-unification.md`، `2026-07-22-scan-pipeline-relocation.md`، `2026-07-23-remove-team-page.md`، `2026-07-23-shared-lead-insert-helper.md`، `2026-07-23-import-batch-delete-unification.md`، `2026-07-23-dashboard-kpi-consistency.md` (untracked)

## Pending Decisions
- هل تُحذف ملفات `.handoff/rbac-hardening-sprint8-*` بما أنها باتت قديمة؟
- هل يُفتح issue منفصل لـ bug اختبارات ai-orchestrator (مذكور أعلاه)؟
- D1: هل توسّع مطابقة الأسماء العربية لتشمل project_name/contractor_name مقصودة أم فقط اسم الشركة؟ (ملاحظة من مراجعة PR #116)
- D2: قيمة `source: "import"` خارج المفردات الموثّقة لعمود leads.source، وserver-created leads لا تضع owner_id — كلاهما يحتاج تأكيد منتج (ملاحظات من مراجعة PR #119، لم تُغيَّر بدون تأكيد)

## Risks
- بيانات CRM حية: أي التزام/نشر يمرّ ببوابة موافقة (انظر deployment-governance.md).
- المشروع مربوط بـ Lovable — لا تُعِد كتابة تاريخ Git المدفوع (force-push/rebase/amend).

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
