/* =========================================================
   Pulse — main.js
   نقطة تشغيل التطبيق (Boot)
   ========================================================= */

// ============================
// تحويل npub إلى hex
// ============================

let ADMIN_PUBKEY_HEX = null;

function convertAdminPubkey() {
    // 1. إذا كان هناك override في config.js، استخدمه
    if (typeof ADMIN_PUBKEY_HEX_OVERRIDE !== 'undefined' && ADMIN_PUBKEY_HEX_OVERRIDE && ADMIN_PUBKEY_HEX_OVERRIDE.length === 64) {
        ADMIN_PUBKEY_HEX = ADMIN_PUBKEY_HEX_OVERRIDE;
        console.log('[Admin] استخدام ADMIN_PUBKEY_HEX_OVERRIDE:', ADMIN_PUBKEY_HEX);
        return;
    }

    // 2. تحويل npub إلى hex
    if (ADMIN_PUBKEY_NPUB && ADMIN_PUBKEY_NPUB.startsWith('npub1')) {
        try {
            // محاولة فك التشفير باستخدام nip19
            const decoded = NostrTools.nip19.decode(ADMIN_PUBKEY_NPUB);
            if (decoded.type === 'npub') {
                // تحويل Uint8Array إلى hex (32 بايت)
                ADMIN_PUBKEY_HEX = Array.from(decoded.data)
                    .map(b => b.toString(16).padStart(2, '0'))
                    .join('');

                // تحقق من الطول
                if (ADMIN_PUBKEY_HEX.length === 64) {
                    console.log('[Admin] تم تحويل npub إلى hex بنجاح:', ADMIN_PUBKEY_HEX);
                    return;
                } else {
                    console.error('[Admin] تحذير: hex الناتج طوله', ADMIN_PUBKEY_HEX.length, 'وليس 64. قد يكون npub غير صحيح.');
                    // لا نعيّن القيمة، سنعرض خطأ لاحقاً
                    ADMIN_PUBKEY_HEX = null;
                }
            }
        } catch (e) {
            console.error('[Admin] فشل تحويل npub باستخدام nip19.decode:', e);
            // محاولة بديلة: استخدام npubDecode إذا كانت موجودة
            if (typeof NostrTools.nip19.npubDecode === 'function') {
                try {
                    const bytes = NostrTools.nip19.npubDecode(ADMIN_PUBKEY_NPUB);
                    ADMIN_PUBKEY_HEX = Array.from(bytes)
                        .map(b => b.toString(16).padStart(2, '0'))
                        .join('');
                    if (ADMIN_PUBKEY_HEX.length === 64) {
                        console.log('[Admin] تم تحويل npub إلى hex باستخدام npubDecode:', ADMIN_PUBKEY_HEX);
                        return;
                    }
                } catch (e2) {
                    console.error('[Admin] فشل npubDecode:', e2);
                }
            }
        }
    }

    // 3. إذا لم ينجح التحويل، نترك ADMIN_PUBKEY_HEX = null
    ADMIN_PUBKEY_HEX = null;
    console.error('[Admin] تعذر تحويل ADMIN_PUBKEY_NPUB إلى hex صحيح. تأكد من أن npub صحيح، أو استخدم ADMIN_PUBKEY_HEX_OVERRIDE في config.js');
}

// ============================
// 20. Boot
// ============================

document.addEventListener('DOMContentLoaded', async () => {
    console.log('[Pulse] بدء التشغيل');

    // تحويل مفتاح المدير أولاً
    convertAdminPubkey();

    // التحقق من صحة ADMIN_PUBKEY_HEX
    if (!ADMIN_PUBKEY_HEX || ADMIN_PUBKEY_HEX.length !== 64) {
        console.error('[Admin] ADMIN_PUBKEY_HEX غير صحيح. تحقق من npub في config.js أو استخدم ADMIN_PUBKEY_HEX_OVERRIDE');
        showToast('⚠️ خطأ في إعدادات المدير: تحقق من npub أو استخدم hex مباشرة', 'error');
        // يمكننا الاستمرار لكن نظام الحظر لن يعمل
    } else {
        console.log('[Admin] تم تعيين ADMIN_PUBKEY_HEX بنجاح');
    }

    // إعداد الثيم
    if (localStorage.getItem('theme') === 'dark' || (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
    }

    await initIdentity();
    await loadBanList();
    subscribeToBanEvents();

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
});

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

async function loadBanList() {
    return new Promise((resolve) => {
        // إذا لم يكن ADMIN_PUBKEY_HEX صحيحاً، لا نحاول التحميل
        if (!ADMIN_PUBKEY_HEX || ADMIN_PUBKEY_HEX.length !== 64) {
            console.warn('[Moderation] ADMIN_PUBKEY_HEX غير صحيح، تخطي تحميل قائمة الحظر');
            resolve();
            return;
        }

        const events = [];
        const sub = pool.subscribeMany(RELAYS, [{ kinds: [BAN_EVENT_KIND], authors: [ADMIN_PUBKEY_HEX] }], {
            onevent: (event) => {
                events.push(event);
            },
            oneose: () => {
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
                console.log('[Moderation] تحميل قائمة الحظر:', bannedPubkeys.size, 'محظور');
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
    if (!ADMIN_PUBKEY_HEX || ADMIN_PUBKEY_HEX.length !== 64) {
        console.warn('[Moderation] ADMIN_PUBKEY_HEX غير صحيح، تخطي الاشتراك في أحداث الحظر');
        return;
    }
    if (banSubscription) {
        try { banSubscription.close(); } catch(e) {}
    }
    banSubscription = pool.subscribeMany(RELAYS, [{ kinds: [BAN_EVENT_KIND], authors: [ADMIN_PUBKEY_HEX] }], {
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

// دوال الحظر
window.toggleBanUser = toggleBanUser;
window.openAdminPanel = openAdminPanel;
window.closeAdminPanel = closeAdminPanel;
window.renderBannedList = renderBannedList;
window.addBanButtonToPost = addBanButtonToPost;
window.processBanEvent = processBanEvent;
window.applyBanFilter = applyBanFilter;

// جعل ADMIN_PUBKEY_HEX متاحاً عالمياً
window.ADMIN_PUBKEY_HEX = ADMIN_PUBKEY_HEX;
