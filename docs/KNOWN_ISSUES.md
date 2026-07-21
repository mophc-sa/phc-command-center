# KNOWN ISSUES — PHC Command Center

> مشاكل معروفة لم تُحَل نهائيًا. تمنع إعادة اكتشافها من الصفر.

---

### Lovable MCP routes على Windows
- **Symptom:** مسارات MCP قد تحتاج إعادة توليد بعد التغيير.
- **Workaround:** أعِد توليدها في Lovable، أو اضبط `ENABLE_LOVABLE_MCP=true` في بيئة لا ينطبق عليها مشكلة مسار Windows.
- **Status:** mitigated
- المرجع: قسم Troubleshooting في `README.md`.

---

### اختبارات DB تتطلب Docker
- **Symptom:** `bun run test:db` يفشل إن لم يكن Docker/Supabase محليًا شغّالًا.
- **Workaround:** شغّل Docker Desktop وتأكد `supabase status` ينجح قبل الاختبار.
- **Status:** by-design

---

<!-- انسخ كتلة مشكلة جديدة أعلى هذا السطر -->
