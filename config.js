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

/*
 * الطريقة المُوصى بها: استخدم المفتاح العام بصيغة hex (64 حرفاً).
 * يمكنك الحصول على hex من npub عبر وحدة التحكم (F12) باستخدام الأمر:
 *   NostrTools.nip19.decode('npub...').data
 * ثم تحويل Uint8Array إلى hex.
 * 
 * بدلاً من ذلك، يمكنك ترك ADMIN_PUBKEY_NPUB وسيحاول التطبيق تحويله تلقائياً.
 * لكن إذا واجهت مشكلة، استخدم ADMIN_PUBKEY_HEX_OVERRIDE.
 */

// المفتاح العام بصيغة npub (للتحويل التلقائي)
const ADMIN_PUBKEY_NPUB = 'npub1275cqncumerdquzy66vns23ryh2a27pz2g4z70pfehg7q52shlvsxf982l';

// 💡 اترك هذا فارغاً للتحويل التلقائي، أو ضع hex مباشرة (64 حرفاً) لتجاوز التحويل.
// مثال: 'eaebb02e7b42c652bf8db5e28fd27acc1412a77705fd6b473db710499ac9e0a9'
const ADMIN_PUBKEY_HEX_OVERRIDE = ''; // ⚠️ ضع hex هنا إذا استمرت مشكلة التحويل

// نوع الحدث المخصص للحظر
const BAN_EVENT_KIND = 20001;
