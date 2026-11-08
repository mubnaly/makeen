# Makeen PostgreSQL Real Database Backend (البنية التحتية لقاعدة البيانات)

بنية تحتية متكاملة لربط تطبيق **مَكِين (Makeen)** بقاعدة بيانات **PostgreSQL** حقيقية لتمكين مشاركة الكورسات، المسارات التعليمية، المراجعات، ونظام الدفع بين جميع المستخدمين حول العالم.

---

## 🚀 خيارات استضافة قاعدة بيانات PostgreSQL الموصى بها (مجانية وسريعة):

1. **Supabase (الخيار الأفضل والمجاني 100%)**:
   - توجه إلى [supabase.com](https://supabase.com) وأنشئ مشروعاً مجانياً.
   - انسخ رابط الاتصال `Connection String (URI)`.
   - افتح تبويب **SQL Editor** والصق محتويات ملف `schema.sql` واضغط **Run**.

2. **Neon.tech (PostgreSQL Serverless مجاني)**:
   - توجه إلى [neon.tech](https://neon.tech) وأنشئ قاعدة بيانات بضغطة زر واحدة.
   - انسخ رابط الاتصال المباشر.

3. **قاعدة بيانات محلية على جهازك (Local PostgreSQL)**:
   - قم بتثبيت PostgreSQL على جهازك وأنشئ قاعدة باسم `makeen`.
   - استخدم الرابط: `postgresql://postgres:password@localhost:5432/makeen`.

---

## 🛠️ كيفية تشغيل الخادم (Running the Backend Server):

1. **الدخول لمجلد الخادم وتثبيت الحزم**:
   ```bash
   cd backend
   npm install
   ```

2. **إنشاء ملف الإعدادات `.env`**:
   انسخ ملف `.env.example` إلى `.env`:
   ```bash
   copy .env.example .env
   ```
   وضع رابط قاعدة بياناتك في متغير `DATABASE_URL`.

3. **تشغيل الخادم**:
   ```bash
   npm start
   ```
   سيعمل الخادم على المنفذ `http://localhost:4000`.

4. **فحص الاتصال**:
   افتح المتصفح على: `http://localhost:4000/api/health` للتأكد من اتصال الخادم بقاعدة البيانات بنجاح!
