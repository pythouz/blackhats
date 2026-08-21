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
 * 🔑 المفتاح العام للمدير (ADMIN_PUBKEY_HEX) يجب أن يكون بصيغة hex (64 حرفاً).
 * 
 * للحصول على hex من npub الخاص بك:
 * 1. افتح الموقع، ثم وحدة تحكم المتصفح (F12).
 * 2. الصق الأمر التالي:
 *    const npub = 'npub1275cqncumerdquzy66vns23ryh2a27pz2g4z70pfehg7q52shlvsxf982l';
 *    const decoded = NostrTools.nip19.decode(npub);
 *    const hex = Array.from(decoded.data).map(b => b.toString(16).padStart(2, '0')).join('');
 *    console.log(hex);
 * 3. انسخ الناتج (64 حرفاً) وضعه في ADMIN_PUBKEY_HEX أدناه.
 * 
 * مثال: eaebb02e7b42c652bf8db5e28fd27acc1412a77705fd6b473db710499ac9e0a9
 */

// ⚠️ IMPORTANT: استبدل القيمة التالية بـ hex الخاص بك
const ADMIN_PUBKEY_HEX = 'eaebb02e7b42c652bf8db5e28fd27acc1412a77705fd6b473db710499ac9e0a9';

// نوع الحدث المخصص للحظر
const BAN_EVENT_KIND = 20001;
