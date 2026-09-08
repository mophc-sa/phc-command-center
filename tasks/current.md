# Current Task — PHC Command Center

## 2026-09-08 — Board label-fit follow-up

PR 291 is deployed at d885f47 (Worker 127a5c12-b5ed-4907-ad91-f275afe61c9f, 100%).
Implementation/testing/deployment moved to completed.md. Post-production
readiness is recorded in run 34194781057. The renewed user session verified the totals and two automatic refresh cycles. Correct
clipped pipeline footnote and Unassigned label, then finish release/visual check. Ship the small frontend-only label correction through the usual gates.


## بند متبقٍ — استكمال بيانات تحتاج قرارًا تجاريًا

إصلاحات PR 287–289 منشورة ومتحقق منها. معالجة 125 فرصة وأرشفة126 نسخة متطابقة مكتملة؛ نُقلت نتيجتها إلى completed.md. جميع679 سجلات الأرشيف فُحصت:634 لها رابطCRM وحيد،43 تحتاج استكمالًا أو مراجعة تطابق، وسجلان ضمن مجموعة التكرار26d86997-a66b-4fff-b8da-51a923d069d7. المتبقي يحتاج بيانات العميل/المالك/القيمة/الهوية من العمل الفعلي؛ لا تعيين افتراضي ولا تغيير لحالات الفوز والخسارة. الحالات التاريخية أدناه محفوظة كسياق سابق، ولا تعني أن النشر ما زال معلقًا.


## 2026-09-07 — Legacy reconciliation (implementation; production pending)

PR 288 is deployed at 04e706c; production readiness 34126413617 passed.
Cross-checking all 679 archive rows found 125 promoted opportunities overlapping
126 legacy import copies (including 80 newly promoted records). Do not describe
554 unpromoted rows as absent from CRM: most already exist. Branch
`fix/historical-legacy-reconciliation` adds exact identity checks, caller/MFA-gated
reconciliation, preserved before-images/legacy notes, archived-copy links and atomic
future promotion protection. No correction of production duplicates has run yet.
Finish tests, merge and guarded deployment, then execute the pinned 126-copy scope
with the user's real session and verify unchanged archive/owners/amounts.


> بند واحد فعّال. عند اكتماله انقله إلى `completed.md` واسحب التالي من `backlog.md`.

## سياق مكتمل — اكتمال عرض الفرص المفعّلة (2026-09-07)

الفرع: `fix/activated-opportunity-display`، الأساس: `ba3dd43`.
بعد نشر PR 287 وتفعيل 80 فرصة بحساب المستخدم، أظهر اختبار الإنتاج أن نوع JIH/Tender المحفوظ في الأرشيف لا يظهر في تفاصيل الفرصة، وأن قوائم الإسناد تضم حسابات موقوفة. الإصلاح يعرض المصدر التاريخي عند غياب تصنيف RFQ، ويقصر خيارات الإسناد الجديدة على الحسابات النشطة غير المخصصة للعرض، مع الاحتفاظ بالدليل الكامل لعرض أسماء أصحاب السجلات السابقة. لا تغيير لحسابات المستخدمين أو لحالات الفرص.

## سياق مكتمل محفوظ — إصلاح نتائج الفحص الشامل (2026-09-07)

الفرع: `fix/system-audit-hardening`، الأساس: `ec89d123`.
النطاق: F01–F16 (الصلاحيات وMFA، سلامة الموافقات، الاستيراد الذري، اكتمال المؤشرات، فحص الخدمات، وبوابات النشر).
الكود والتحقق المحلي مكتملان: 2656 Bun + 948 SQL + 13 Deno. المتبقي: CI/مراجعة طلب الدمج ثم بوابة النشر.
النشر البعيد للترحيلات والخدمات مرحلة مستقلة وفق `docs/deployment-governance.md`.

## سياق سابق محفوظ — دمج #283

### ١ · ما ينتظرك أنت

**١أ · ادمج [#282](https://github.com/mophc-sa/phc-command-center/pull/282)** — كود المبيعات · توكيل اليتامى · الاسم بجوار الرقم.

**١ب · ✅ تمّ** — `20260927100000` مدفوعة ومقيسة: 17/17 كودًا، صفر مكرّر، صفر مخالف، والأربعة القائمة بلا تغيير.

**١ج · اقفل جهاز العرض** — kiosk في Chrome أو Guided Access. اللوحة صفحة بلا تنقّل، **لا حاجزٌ أمني**.

**١د · أجِب الثلاثة الباقية** في `docs/AI_HANDOFF.md` — كلٌّ منها يوقف بندًا.

### ٢ · تحذيران تشغيليّان
- أوقف خادم المعاينة قبل أي سكربت يعيد كتابة `board.tsx` — **مولّد المسارات يستبدل ملفًّا مشوّهًا بهيكل من تسعة أسطر**.
- `supabase db push` يمرّ عبر حارس المستخدم في `~/.supabase-guard.zsh`؛ حمّله ولا تلتفّ عليه.

### ٣ · قائمة 2 سبتمبر اكتملت
**المجموعتان الأخيرتان (ج · ز) أُنجزتا** في #281 و#282. لا بند متبقٍّ منها.

### ٤ · المهمّة الهندسية التالية — **صُحّحت**

**ما كان مكتوبًا هنا خطأ:** `setHumanWinProbability` **موصولة** —
`opportunities.$id.tsx:1050`، وحقل تاريخ الإغلاق في النافذة نفسها `:1023`.

**والقياس يقول أين الخلل:** ستّة أعمدة فارغة تمامًا عبر 741 فرصة، **ولكلٍّ منها كاتبٌ يعمل**.
فالمسألة **استعمال لا برمجة**، ولا يُصلَح كودٌ يعمل. و#283 يبني الطريق من الجملة إلى العمل.

**والمرشَّح التالي، بلا قياسٍ لسببه بعد:**
`score` مملوء في **1 من 741** — محرّك التسجيل لا يعمل.
`last_activity_at` في **46 من 741** — كشف الركود أعمى في 94% من الكتاب.

### ٥ · عطلٌ في البيانات ينتظر قرارك
```
RFQ-2026-0001   received 2026-07-29   due 275760-07-29   status open
```
سنةٌ مطبوعةٌ خطأً ولا شيء رفضها. **لم أخمّن الصحيح ولم أمحُه.** قيدُ `CHECK` يمنع التكرار.


## فصل الاختبارات عن الإنتاج

أضيف Isolated Readiness: قاعدة Supabase مؤقتة داخل GitHub Actions، 13 حسابًا و5 عوامل MFA. لا أسرار إنتاج أو مشروع مدفوع. التحقق السحابي ونقل بوابات النشر ما زالا مطلوبين قبل تعطيل حسابات الإنتاج. راجع docs/isolated-readiness.md.

نقل فحوص الأدوار وMFA إلى قاعدة مؤقتة داخل GitHub Actions؛ Production Readiness يعتمد نجاحها ثم يفحص الدخول العام وحماية الصفحات على الموقع المنشور دون TEST_* secrets. لا تغيير لبوابة هوية canary أو الموافقة على النشر. تعطيل حسابات الإنتاج ينتظر نجاح المسار البديل على main.
