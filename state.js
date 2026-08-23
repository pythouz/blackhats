/* =========================================================
   Pulse — state.js
   متغيرات الحالة العامة المشتركة بين كل الملفات
   ========================================================= */

// ============================
// 2. الحالة العامة
// ============================

let secretKeyHex = null;
let pk = null;
let npub = null;
let usingNip07 = false;
const storageKey = 'pulse_nsec_hex';

const pool = new NostrTools.SimplePool();

// الحالة الأساسية
const seenEvents = new Set();
const renderedPosts = new Map();      // postId -> HTMLElement
const postScores = new Map();         // postId -> number
const profileCache = new Map();
const postStats = new Map();          // postId -> { likes, replies, createdAt, myLikeEventId }
const postContentMap = new Map();     // postId -> { content, created_at }

// نظام إعجابات حقيقي
const postLikers = new Map();         // postId -> Map(pubkey -> likeEventId)
const likeEventIndex = new Map();     // likeEventId -> { postId, pubkey }
const tombstonedEvents = new Set();   // eventIds اتحذفت

// ردود معلقة (لحل مشكلة الرفرش)
const pendingRepliesMap = new Map();  // rootId -> [event, ...]

// ============================
// نظام الحظر (جديد)
// ============================
const bannedPubkeys = new Set();      // مجموعة المفاتيح العامة المحظورة

// ============================
// نظام التسجيل بموافقة الإدارة (جديد)
// ============================
const approvedPubkeys = new Set();      // المستخدمين الموافق عليهم من المدير
const pendingRegistrations = new Map(); // pubkey -> { email, phone, created_at, eventId } (تُفك تشفيرها للمدير فقط)
let myAccessStatus = 'checking';        // 'checking' | 'not_registered' | 'pending' | 'approved'

// (إضافة) متغيرات بوابة الدخول
let authGateVisible = false;
let authGateMode = 'login'; // 'login' | 'register'

function initPostState(id, createdAt) {
    postStats.set(id, { likes: 0, replies: 0, createdAt, myLikeEventId: null });
    postLikers.set(id, new Map());
}

let postsSubscription = null;
let reactionsSubscription = null;
let reactionResubscribeTimer = null;

function scheduleReactionResubscribe() {
    if (reactionResubscribeTimer) clearTimeout(reactionResubscribeTimer);
    reactionResubscribeTimer = setTimeout(() => {
        reactionResubscribeTimer = null;
        startReactionSubscription();
    }, 700);
}

// الغرف الصوتية
const discoveredRooms = new Map();
let directorySubscription = null;
let directoryCleanupInterval = null;

let localStream = null;
let peer = null;
let currentRoom = null;
let roomSubscription = null;
let myPeerId = null;
let activeCalls = new Map();
let announcedPeers = new Set();
let isMuted = false;
let isJoiningRoom = false;

let bgAudioContext = null;
let silentAudioElement = null;
let wakeLock = null;

// تحميل المزيد
let oldestTimestamp = null;
let loadingMore = false;

// ============================
// نظام المتابعة (Follow) — NIP-02 Contact List (kind:3)
// ============================
let myContactTags = [];         // الـ tags الكاملة لآخر نسخة من قايمة متابعتي (بنحافظ عليها كاملة عشان مانمسحش حد بالغلط لما ننشر تعديل)
let myContactsContent = '';     // محتوى آخر kind:3 بتاعي (بيتحفظ زي ما هو)
const myContacts = new Set();   // pubkeys اللي بتابعهم أنا (مشتقة من myContactTags، للبحث السريع في الواجهة)
let myContactsLoaded = false;   // هل جبنا قايمة متابعتي من الـ relays قبل كده؟
const followCountsCache = new Map(); // pubkey -> { following, followers }
