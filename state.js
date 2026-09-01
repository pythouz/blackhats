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

// (أداء) reorderFeed() بتعمل querySelectorAll + sort + إعادة ترتيب DOM
// لكل بوستات الفيد مرة واحدة — شغل مقبول لما تتنادى مرة واحدة، لكن لو
// اتنادت لكل بوست لوحده أثناء دفعة كبيرة (تحميل أولي/تحميل المزيد) بقى
// عندنا عمليًا إعادة ترتيب كاملة للـ DOM بعدد البوستات، بينما إحنا محتاجين
// نعملها مرة واحدة بس بعد ما الدفعة كلها توصل. نفس فكرة الـ debounce
// المستخدمة فوق لإعادة اشتراك التفاعلات.
let reorderFeedTimer = null;

function scheduleReorderFeed() {
    if (reorderFeedTimer) clearTimeout(reorderFeedTimer);
    reorderFeedTimer = setTimeout(() => {
        reorderFeedTimer = null;
        if (typeof reorderFeed === 'function') reorderFeed();
    }, 150);
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
let roomHeartbeatInterval = null;   // إعادة إعلان الحضور دوريًا طول ما إحنا في الغرفة
let roomListenTimer = null;          // مؤقت إعادة اشتراك listenForPeers — لازم نلغيه لما نخرج
let vadAudioContext = null;          // AudioContext بتاع كاشف الكلام — لازم يتقفل لما نخرج

let bgAudioContext = null;
let silentAudioElement = null;
let wakeLock = null;

// تحميل المزيد
let oldestTimestamp = null;
let loadingMore = false;

// ============================
// (أداء) تتبّع حالة تحميل الفيد — عشان نقلل طلبات الـ relays
// ============================
// أثناء التحميل الأولي (أو "تحميل المزيد")، بتوصل عشرات/مئات البوستات
// دفعة واحدة. مفيش داعي إننا نفتح subscription منفصل لجلب لايكات كل
// بوست لوحده وقت الدفعة دي (fetchLikesForNewPost) لأن fetchPastLikesAndDeletes
// هتجيب نفس البيانات دي مجمّعة وبكفاءة أعلى فور ما الدفعة تخلص (EOSE).
// feedReady بتبقى true بعد أول تحميل كامل للفيد، فبعدها أي بوست جديد
// حقيقي (نشر جديد، أو وصل لايف) بياخد fetchLikesForNewPost بتاعه لوحده
// زي ما هو متوقع.
let feedReady = false;

// أسماء البوستات اللي جبنالها "لايكات سابقة" قبل كده، عشان دورة إعادة
// الاشتراك الدورية (كل 30 ثانية) في startReactionSubscription ما تعيدش
// جلب نفس البيانات القديمة تاني لكل البوستات من الصفر — بس تجيب اللي
// جديد فعلاً.
const pastLikesFetchedPostIds = new Set();

// ============================
// نظام المتابعة (Follow) — NIP-02 Contact List (kind:3)
// ============================
let myContactTags = [];         // الـ tags الكاملة لآخر نسخة من قايمة متابعتي (بنحافظ عليها كاملة عشان مانمسحش حد بالغلط لما ننشر تعديل)
let myContactsContent = '';     // محتوى آخر kind:3 بتاعي (بيتحفظ زي ما هو)
const myContacts = new Set();   // pubkeys اللي بتابعهم أنا (مشتقة من myContactTags، للبحث السريع في الواجهة)
let myContactsLoaded = false;   // هل جبنا قايمة متابعتي من الـ relays قبل كده؟
const followCountsCache = new Map(); // pubkey -> { following, followers }

// ============================
// حماية من تكرار الردود/التعليقات
// ============================
// لما نبعت رد بنعرضه فورًا محليًا (handleIncomingReply)، وبعدين نفس
// الرد بيرجعلنا تاني من الـ relay عن طريق اشتراك الردود (reactions.js)
// — من غير حماية، ده كان بيعرض نفس الرد مرتين. seenReplies بتضمن إن
// كل event.id يتعالج مرة واحدة بس.
const seenReplies = new Set();

// ============================
// (فيتشر جديد) الإشعارات — لايكات وردود على منشوراتك
// ============================
// كل عنصر: { id, type: 'like'|'reply', postId, fromPubkey, createdAt, read }
// الأحدث أول العنصر (unshift عند الإضافة).
let notifications = [];
let unreadNotifCount = 0;
const seenNotifIds = new Set();
let notificationsSubscription = null;

// ============================
// (فيتشر جديد) الرسائل الخاصة (DM) والمكالمات الفردية
// ============================
// كل محادثة متخزنة بمفتاح = pubkey الطرف التاني.
// conversations: pubkey -> { messages: [{id, from, text, createdAt, pending?}], unread: number }
const conversations = new Map();
let dmSubscription = null;
const seenDmIds = new Set();
let activeChatPubkey = null;   // المحادثة المفتوحة حاليًا (لو فيه)
let totalUnreadDms = 0;

// مكالمات فردية خارج الغرف — منفصلة تمامًا عن نظام peer بتاع الغرف
// الجماعية (rooms.js) عشان محدش يتعارض مع التاني.
let dmPeer = null;
let dmLocalStream = null;
let dmActiveCall = null;       // كائن MediaConnection بتاع PeerJS
let dmCallState = 'idle';      // idle | calling | ringing | in-call
let dmCallPeerPubkey = null;
let dmCallPeerId = null;
let dmCallSubscription = null;
let dmCallStartTime = null;
let dmCallTimerInterval = null;
let dmCallTimeoutId = null;
let dmIsMuted = false;
