# Backlog — PHC Command Center

> أفكار/مهام غير مجدولة. **لا يبدأ الـ AI تنفيذ أي بند** إلا بعد نقله إلى `current.md`.

- [ ] حسم مصير ملفات Docker غير المتتبَّعة (`Dockerfile`, `docker-compose.yml`, `.dockerignore`): التزام أم إبقاء محلي؟
- [ ] نشر migration D5 (`20260723120000_extend_delete_allowlist_import_batches.sql`، على main منذ PR #120) عبر بوابة الموافقة إلى الإنتاج.
- [ ] فتح issue لـ bug اختبارات `ai-orchestrator*.contract.test.ts` (7 اختبارات فاشلة بسبب `readdirSync().find()` يختار ملف migration خاطئ عند تعدد التطابقات) — اكتُشف أثناء عمل D1، غير متعلق بنطاقه.
- [ ] تأكيد منتج: هل توسّع مطابقة الأسماء العربية (D1) لتشمل project_name/contractor_name مقصودة أم فقط اسم الشركة؟
- [ ] تأكيد منتج: قيمة `leads.source = "import"` خارج المفردات الموثّقة، وserver-created leads (D2) لا تضع owner_id — هل هذا مقصود؟
- [ ] هل تُحذف ملفات `.handoff/rbac-hardening-sprint8-*` بما أنها باتت قديمة ومُنجزة عبر مسار آخر؟
- [ ] [[أضف أفكارك هنا]]
