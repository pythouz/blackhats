# تقسيم app.js — Pulse

تم تقسيم `app.js` الأصلي (2123 سطر) إلى 12 ملف داخل مجلد `js/`، كل ملف مسؤول عن جزئية واحدة فقط. الكود لم يتغيّر حرفيًا (تم فقط قصّه ولصقه بالترتيب الأصلي)، فمفيش أي منطق اتعدّل.

## هيكل الملفات

| الملف | المسؤولية |
|---|---|
| `config.js` | الثوابت والإعدادات (الـ relays، الحدود القصوى، إلخ) |
| `state.js` | متغيرات الحالة العامة المشتركة (pool، profileCache، postStats...) |
| `utils.js` | دوال مساعدة عامة + نظام الـ Toast |
| `auth.js` | الهوية على Nostr (توليد/استيراد مفتاح، NIP-07) |
| `profile.js` | الملف الشخصي (عرض، تعديل، رفع صورة/بانر) |
| `algorithm.js` | خوارزمية ترتيب المنشورات (scoring) |
| `media.js` | عرض الصور/الفيديو المرفقة بالمنشورات |
| `posts.js` | الفيد + نشر + تعديل + حذف + تحميل المزيد |
| `reactions.js` | الإعجابات والردود (بما فيها الردود المتداخلة) |
| `rooms.js` | الغرف الصوتية WebRTC + اكتشاف الغرف الحية |
| `ui.js` | التنقل بين الصفحات + المظهر (Dark mode) |
| `main.js` | نقطة التشغيل (Boot) — لازم يكون آخر ملف يتحمّل |

## التركيب في الريبو

1. حط مجلد `js/` بكل الملفات دي جنب `index.html` (بدل `app.js` القديم).
2. في `index.html`، غيّر السطر:
```html
<script src="./app.js"></script>
```
لـ:
```html
<script src="./js/config.js"></script>
<script src="./js/state.js"></script>
<script src="./js/utils.js"></script>
<script src="./js/auth.js"></script>
<script src="./js/profile.js"></script>
<script src="./js/algorithm.js"></script>
<script src="./js/media.js"></script>
<script src="./js/posts.js"></script>
<script src="./js/reactions.js"></script>
<script src="./js/rooms.js"></script>
<script src="./js/ui.js"></script>
<script src="./js/main.js"></script>
```

**مهم جدًا:** الترتيب ده لازم يفضل زي ما هو، لأن كل ملف بيعتمد على اللي قبله (مثلاً `posts.js` بيستخدم متغيرات من `state.js` و`config.js`). كل الملفات لسه سكريبتات عادية (مش `type="module"`) عشان الـ `onclick="..."` في الـ HTML يفضل شغال زي ما هو من غير أي تعديل — كل الملفات بتشترك في نفس الـ scope العام تلقائيًا.

باقي الملفات (`index.html` نفسه، `manifest.json`, `sw.js`) متغيرتش، سيبهم زي ما هم.

## إضافة كود جديد مستقبلًا

- منطق يخص المنشورات → `posts.js`
- منطق يخص الغرف الصوتية → `rooms.js`
- إعجاب/رد → `reactions.js`
- ثابت أو إعداد جديد → `config.js`
- متغير حالة مشترك جديد → `state.js`

كده تقدر تفتح الملف اللي يخصك بس وتشتغل عليه من غير ما تدوّر جوه ملف واحد ضخم.
