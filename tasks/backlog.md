# Backlog — PHC Command Center

> أفكار/مهام غير مجدولة. **لا يبدأ الـ AI تنفيذ أي بند** إلا بعد نقله إلى `current.md`.

- [ ] حسم مصير ملفات Docker غير المتتبَّعة (`Dockerfile`, `docker-compose.yml`, `.dockerignore`): التزام أم إبقاء محلي؟
- [ ] (غير عاجل — مؤجَّل بقرار 2026-07-23) تنفيذ الفحوصات الوظيفية + UAT على الإنتاج لـ D1/D2/D5 (بعد نشر migration D5 وEdge Functions المتأثرة — القسمان 3 و6 من قائمة التحقق المحفوظة في Obsidian `1. PROJECTS/PHC/PHC Command Center — Post-Deploy Checklist (Jul 23 2026).md`، تحتاج موافقة صريحة لكتابة بيانات اختبار في CRM حي).
- [ ] فتح issue لـ bug اختبارات `ai-orchestrator*.contract.test.ts` (7 اختبارات فاشلة بسبب `readdirSync().find()` يختار ملف migration خاطئ عند تعدد التطابقات) — اكتُشف أثناء عمل D1، غير متعلق بنطاقه.
- [ ] تأكيد منتج: هل توسّع مطابقة الأسماء العربية (D1) لتشمل project_name/contractor_name مقصودة أم فقط اسم الشركة؟
- [ ] تأكيد منتج: قيمة `leads.source = "import"` خارج المفردات الموثّقة، وserver-created leads (D2) لا تضع owner_id — هل هذا مقصود؟
- [ ] هل تُحذف ملفات `.handoff/rbac-hardening-sprint8-*` بما أنها باتت قديمة ومُنجزة عبر مسار آخر؟
- [ ] [[أضف أفكارك هنا]]
