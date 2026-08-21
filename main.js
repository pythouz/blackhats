/* =========================================================
   Pulse — main.js
   نقطة تشغيل التطبيق (Boot)
   ========================================================= */

// ============================
// التحقق من ADMIN_PUBKEY_HEX
// ============================

function validateAdminPubkey() {
    if (typeof ADMIN_NPUB === 'undefined' || !ADMIN_NPUB || !ADMIN_NPUB.startsWith('npub1')) {
        console.error('[Admin] ❌ ADMIN_NPUB غير موجود أو غير صحيح في config.js.');
        window.ADMIN_PUBKEY_HEX = null;
        return false;
    }

    try {
        const decoded = NostrTools.nip19.decode(ADMIN_NPUB);
        if (decoded.type !== 'npub') throw new Error('ليس npub');
        const hex = decoded.data; // nostr-tools 2.x يرجّع hex string جاهز مباشرة
        if (typeof hex !== 'string' || hex.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(hex)) {
            throw new Error('نتيجة فك التشفير غير صالحة');
        }
        window.ADMIN_PUBKEY_HEX = hex.toLowerCase();
        console.log('[Admin] ✅ تم تحويل ADMIN_NPUB وتحميله:', hex);
        return true;
    } catch (e) {
        console.error('[Admin] ❌ فشل فك تشفير ADMIN_NPUB:', e);
        window.ADMIN_PUBKEY_HEX = null;
        return false;
    }
}

// ============================
// التحقق مما إذا كان المستخدم الحالي هو المدير
// ============================

function isCurrentUserAdmin() {
    return pk && window.ADMIN_PUBKEY_HEX && pk === window.ADMIN_PUBKEY_HEX;
}

// ============================
// 20. Boot
// ============================

document.addEventListener('DOMContentLoaded', async () => {
    console.log('[Pulse] بدء التشغيل');

    const isValid = validateAdminPubkey();

    if (!isValid) {
        showToast('⚠️ خطأ في إعدادات المدير: تأكد من ADMIN_PUBKEY_HEX في config.js', 'error');
    }

    // إعداد الثيم
    if (localStorage.getItem('theme') === 'dark' || (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
    }

    await initIdentity();

    // تحميل الكاش المحلي فوراً قبل أي شيء، عشان المحظورين ميظهروش حتى لثانية واحدة
    loadBannedCache();
    applyBanFilter();

    // التحقق من هوية المدير بعد تحميل الهوية
    if (isValid) {
        if (isCurrentUserAdmin()) {
            console.log('[Admin] ✅ المستخدم الحالي هو المدير');
        } else {
            console.log('[Admin] ⚠️ المستخدم الحالي ليس المدير.');
        }
    }

    // بوابة الدخول: يقف هنا لو المستخدم لسه مش موافَق عليه من الإدارة
    // (لو إعدادات المدير غلط، منسيبش الموقع مقفول على الكل، نسمح بالدخول عادي)
    const accessGranted = isValid ? await initAccessControl() : true;

    await loadBanList();
    subscribeToBanEvents();

    if (isValid) {
        loadApprovalList().then(() => {
            if (!accessGranted && myAccessStatus !== 'approved' && approvedPubkeys.has(pk)) {
                myAccessStatus = 'approved';
                unlockApp();
            }
        });
        subscribeToApprovalEvents();

        if (isCurrentUserAdmin()) {
            loadPendingRegistrationsForAdmin();
            subscribeToRegistrationEvents();
        }
    }

    if (accessGranted) {
        unlockApp();
    }
});

function unlockApp() {
    if (window.appUnlocked) return; // منع التشغيل مرتين
    window.appUnlocked = true;
    hideAccessGate();

    loadMyProfile();
    startFeed();
    startRoomDirectory();

    const savedView = localStorage.getItem('pulse_view') || 'timeline';
    switchView(savedView);
    const savedRoom = localStorage.getItem('active_room');
    if (savedRoom) {
        switchView('rooms');
        setTimeout(restoreRoomAfterRefresh, 1200);
    }
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(() => console.log('[SW] Registered'))
            .catch(e => console.warn('[SW] Failed:', e));
    });
}

// ============================
// دوال الحظر (إدارة القائمة والاشتراك)
// ============================

let banSubscription = null;
const BAN_CACHE_KEY = 'pulse_banned_cache';

function loadBannedCache() {
    try {
        const raw = localStorage.getItem(BAN_CACHE_KEY);
        if (!raw) return;
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
            arr.forEach(pubkey => bannedPubkeys.add(pubkey));
            console.log('[Moderation] تم تحميل قائمة الحظر من الذاكرة المحلية:', bannedPubkeys.size);
        }
    } catch (e) {
        console.warn('[Moderation] فشل تحميل كاش الحظر:', e);
    }
}

function saveBannedCache() {
    try {
        localStorage.setItem(BAN_CACHE_KEY, JSON.stringify(Array.from(bannedPubkeys)));
    } catch (e) {
        console.warn('[Moderation] فشل حفظ كاش الحظر:', e);
    }
}

async function loadBanList() {
    return new Promise((resolve) => {
        const adminHex = window.ADMIN_PUBKEY_HEX;
        if (!adminHex || adminHex.length !== 64) {
            console.warn('[Moderation] ADMIN_PUBKEY_HEX غير صحيح، تخطي تحميل قائمة الحظر');
            resolve();
            return;
        }

        const events = [];
        const sub = pool.subscribeMany(RELAYS, [{ kinds: [BAN_EVENT_KIND], authors: [adminHex] }], {
            onevent: (event) => {
                events.push(event);
            },
            oneose: () => {
                if (events.length > 0) {
                    events.sort((a, b) => a.created_at - b.created_at);
                    bannedPubkeys.clear();
                    for (const ev of events) {
                        const target = ev.tags.find(t => t[0] === 'p')?.[1];
                        if (!target) continue;
                        if (ev.content === 'ban') {
                            bannedPubkeys.add(target);
                        } else if (ev.content === 'unban') {
                            bannedPubkeys.delete(target);
                        }
                    }
                    console.log('[Moderation] تحميل قائمة الحظر من السيرفرات:', bannedPubkeys.size, 'محظور');
                    saveBannedCache();
                } else {
                    console.log('[Moderation] لا يوجد رد من السيرفرات، الإبقاء على القائمة المحلية:', bannedPubkeys.size, 'محظور');
                }
                applyBanFilter();
                resolve();
            },
            onclose: () => {
                if (events.length > 0) {
                    events.sort((a, b) => a.created_at - b.created_at);
                    bannedPubkeys.clear();
                    for (const ev of events) {
                        const target = ev.tags.find(t => t[0] === 'p')?.[1];
                        if (!target) continue;
                        if (ev.content === 'ban') {
                            bannedPubkeys.add(target);
                        } else if (ev.content === 'unban') {
                            bannedPubkeys.delete(target);
                        }
                    }
                    console.log('[Moderation] تحميل قائمة الحظر (onclose):', bannedPubkeys.size, 'محظور');
                    saveBannedCache();
                    applyBanFilter();
                }
                resolve();
            }
        });
        setTimeout(() => {
            try { sub.close(); } catch(e) {}
            resolve();
        }, 10000);
    });
}

function subscribeToBanEvents() {
    const adminHex = window.ADMIN_PUBKEY_HEX;
    if (!adminHex || adminHex.length !== 64) {
        console.warn('[Moderation] ADMIN_PUBKEY_HEX غير صحيح، تخطي الاشتراك في أحداث الحظر');
        return;
    }
    if (banSubscription) {
        try { banSubscription.close(); } catch(e) {}
    }
    banSubscription = pool.subscribeMany(RELAYS, [{ kinds: [BAN_EVENT_KIND], authors: [adminHex] }], {
        onevent: (event) => {
            processBanEvent(event);
        },
        oneose: () => {
            setTimeout(subscribeToBanEvents, 5000);
        }
    });
}

function processBanEvent(event) {
    const target = event.tags.find(t => t[0] === 'p')?.[1];
    if (!target) return;
    if (event.content === 'ban') {
        bannedPubkeys.add(target);
    } else if (event.content === 'unban') {
        bannedPubkeys.delete(target);
    } else {
        return;
    }
    saveBannedCache();
    applyBanFilter();
    if (adminPanelOpen) renderBannedList();
}

function applyBanFilter() {
    for (const [postId, element] of renderedPosts) {
        const pubkey = element.dataset?.pubkey;
        if (!pubkey) continue;
        const isBanned = bannedPubkeys.has(pubkey);
        element.style.display = isBanned ? 'none' : '';
    }
}

// ============================
// ربط الدوال للنطاق العام
// ============================

window.publishPost = publishPost;
window.likePost = likePost;
window.replyToPost = replyToPost;
window.replyToComment = replyToComment;
window.confirmReply = confirmReply;
window.closeReplyModal = closeReplyModal;
window.toggleRoom = toggleRoom;
window.toggleMute = toggleMute;
window.joinDiscoveredRoom = joinDiscoveredRoom;
window.switchView = switchView;
window.toggleTheme = toggleTheme;
window.exportKey = exportKey;
window.importKey = importKey;
window.importKeyFromHeader = importKeyFromHeader;
window.copyNpub = copyNpub;
window.searchUser = searchUser;
window.openProfileModal = openProfileModal;
window.closeProfileModal = closeProfileModal;
window.saveProfile = saveProfile;
window.onAvatarSelected = onAvatarSelected;
window.onBannerSelected = onBannerSelected;
window.removeBanner = removeBanner;
window.onProfileNameInput = onProfileNameInput;
window.onProfileAboutInput = onProfileAboutInput;
window.showToast = showToast;
window.deletePost = deletePost;
window.editPost = editPost;
window.closeEditModal = closeEditModal;
window.confirmEdit = confirmEdit;
window.triggerFileUpload = triggerFileUpload;
window.handleFileSelect = handleFileSelect;
window.removeAttachment = removeAttachment;
window.toggleReplies = toggleReplies;
window.triggerEditFileUpload = triggerEditFileUpload;
window.handleEditFileSelect = handleEditFileSelect;
window.removeEditAttachment = removeEditAttachment;
window.loadMorePosts = loadMorePosts;
window.logout = logout;

// دوال الحظر
window.toggleBanUser = toggleBanUser;
window.openAdminPanel = openAdminPanel;
window.closeAdminPanel = closeAdminPanel;
window.renderBannedList = renderBannedList;
window.addBanButtonToPost = addBanButtonToPost;
window.processBanEvent = processBanEvent;
window.applyBanFilter = applyBanFilter;
window.isCurrentUserAdmin = isCurrentUserAdmin;

// دوال نظام التسجيل بموافقة الإدارة
window.switchAdminTab = switchAdminTab;
window.submitRegistration = submitRegistration;
window.approveUser = approveUser;
window.revokeUser = revokeUser;
window.dismissRegistration = dismissRegistration;

// دوال صفحة الملف الشخصي (جديد)
window.openProfilePage = openProfilePage;
window.closeProfilePage = closeProfilePage;
window.loadMoreProfilePosts = loadMoreProfilePosts;
