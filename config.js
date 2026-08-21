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

// 🔑 المفتاح العام للمدير بصيغة hex (64 حرفاً) - تم تحويله من npub الخاص بك
const ADMIN_PUBKEY_HEX = 'eaebb02e7b42c652bf8db5e28fd27acc1412a77705fd6b473db710499ac9e0a9';

// نوع الحدث المخصص للحظر
const BAN_EVENT_KIND = 20001;
