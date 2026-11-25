# عقد الـ API — جسد واحد (v1)

هذا هو الشكل اللي الفرونت اتفق معاه. لما الباك إند الحقيقي يتبنى، يوفر نفس الـ endpoints بنفس الشكل، وتتبدل `VITE_API_BASE_URL` بس.

## القاعدة العامة
- كل الردود: نجاح `{ "success": true, "data": {...} }` أو فشل `{ "success": false, "error": { "code": "...", "message": "..." } }`.
- المصادقة بـ session cookie (`HttpOnly`)، مفيش توكنات في الفرونت.
- التوقيت: Africa/Cairo لأي منطق زمني في الباك إند (الموعد النهائي للمخزن مثلًا).

## Auth
- `POST /auth/register` — `{fullName, email, password}` → ينشئ مستخدم `status:"PENDING"` من غير أدوار، ويرجع جلسة.
- `POST /auth/login` — `{identifier, password}` (إيميل أو اسم مستخدم) → يرجع المستخدم.
- `GET /auth/me` — المستخدم الحالي أو 401.
- `POST /auth/logout`

## المستخدمون والتسجيل (أمين الخدمة فقط)
- `GET /registrations` — الطلبات المعلّقة.
- `POST /registrations/:id/approve` — `{roles: string[], stageId}` → يفعّل الحساب.
- `POST /registrations/:id/reject`
- `PATCH /users/:id/roles` — تعديل أدوار ومرحلة مستخدم نشط (نفس تحقق approve: مشرف/مشرف مساعد واحد لكل مرحلة).
- `GET /users?search=&page=` — أمين الخدمة: الكل. المشرف: مرحلته بس.

## المراحل
- `GET /stages` — لازم تتصدّر بالترتيب الست: kg, primary, prep-boys, prep-girls, sec-boys, sec-girls.

## اللوحة
- `GET /dashboard` — إحصائيات حسب الدور (تتوسع في مرحلة اللوحات).

## قواعد الصلاحية (لازم تتطبق في الباك إند مش بس الفرونت)
راجع قسم "المرحلة الأولى" في هذا المستند وملف server/index.js كمرجع تنفيذي حي لقواعد الفحص (مثال: مشرف واحد ومشرف مساعد واحد لكل مرحلة، السيرفر هو مصدر الحقيقة للمرحلة/الدور مش الفرونت).

## الأقسام القادمة (لسه من غير API — الفرونت هيعرض "قريبًا" لحد ما تتبنى)
members, distribution, attendance (service/mass/meeting), followups, confession, monitoring, warehouse (+deadline), lessons, notifications, reports, audit-logs, settings.
كل قسم هيتوثق هنا أول ما يتبنى في المرحلة الخاصة بيه.
