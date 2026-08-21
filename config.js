/* =========================================================
   Pulse — config.js
   الثوابت والإعدادات العامة للتطبيق
   ========================================================= */

// ============================
// 1. الثوابت والإعدادات
// ============================

const RELAYS = [
    'wss://relay.damus.io',
    'wss://relay.primal.net',
    'wss://nos.lol',
    'wss://relay.nostr.band'
];

const APP_TAG = 'pulse-platform';
const ROOM_EVENT_KIND = 20000;
const MAX_SEEN_EVENTS = 10000;
const MAX_RENDERED_POSTS = 500;
const MAX_DISCOVERED_ROOMS = 50;
const DISCOVERY_TAG = APP_TAG + ':room-directory';
const ROOM_PRESENCE_TTL_MS = 90 * 1000;
const INITIAL_FEED_LIMIT = 300;

// ============================
// 2. نظام الحظر — إعدادات المدير
// ============================

// 🔑 المفتاح العام للمدير - الصق الـ npub بتاعك زي ما هو، مفيش داعي تحوله يدوياً
const ADMIN_NPUB = 'npub1275cqncumerdquzy66vns23ryh2a27pz2g4z70pfehg7q52shlvsxf982l';

// نوع الحدث المخصص للحظر
// ⚠️ ملحوظة مهمة: الأرقام من 20000 لـ 29999 محجوزة في بروتوكول Nostr كـ"أحداث مؤقتة" (ephemeral)
// والسيرفرات مش لازم تخزنها خالص. عشان كده لازم نستخدم رقم برّه المنطقة دي عشان الحظر يفضل محفوظ دايماً.
const BAN_EVENT_KIND = 8001;

// ============================
// 3. نظام التسجيل بموافقة الإدارة (جديد)
// ============================

const REGISTER_EVENT_KIND = 8002; // طلب تسجيل عضوية جديد (مشفّر، يقدر يقرأه المدير بس)
const APPROVE_EVENT_KIND = 8003;  // موافقة/إلغاء موافقة المدير على عضو
