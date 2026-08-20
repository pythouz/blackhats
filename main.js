/* =========================================================
   Pulse — main.js
   نقطة تشغيل التطبيق (Boot): تُستدعى بعد تحميل كل الملفات فوق
   ========================================================= */

// ============================
// 20. Boot
// ============================

document.addEventListener('DOMContentLoaded', async () => {
    console.log('[Pulse] بدء التشغيل');
    if (localStorage.getItem('theme') === 'dark' || (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
    }

    await initIdentity();

    // ---- تحميل قائمة الحظر قبل أي شيء آخر ----
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

/**
 * تحميل قائمة الحظر من الـ relays
 */
async function loadBanList() {
    try {
        const filters = { kinds: [BAN_EVENT_KIND], authors: [ADMIN_PUBKEY] };
        const events = await pool.list(RELAYS, [filters]);
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
    } catch (e) {
        console.error('[Moderation] فشل تحميل قائمة الحظر:', e);
    }
}

/**
 * الاشتراك في أحداث الحظر الجديدة (تحديث فوري)
 */
function subscribeToBanEvents() {
    if (banSubscription) {
        try { banSubscription.close(); } catch(e) {}
    }
    const filters = { kinds: [BAN_EVENT_KIND], authors: [ADMIN_PUBKEY] };
    banSubscription = pool.subscribe(RELAYS, [filters], {
        onevent: (event) => {
            processBanEvent(event);
        },
        oneose: () => {
            // قد ينتهي الاشتراك، نعيد فتحه بعد فترة
            setTimeout(subscribeToBanEvents, 5000);
        }
    });
}

/**
 * معالجة حدث حظر وارد (تحديث bannedPubkeys والواجهة)
 */
function processBanEvent(event) {
    const target = event.tags.find(t => t[0] === 'p')?.[1];
    if (!target) return;
    if (event.content === 'ban') {
        bannedPubkeys.add(target);
        showToast(`تم حظر المستخدم ${target.slice(0,8)}...`, 'warning');
    } else if (event.content === 'unban') {
        bannedPubkeys.delete(target);
        showToast(`تم إلغاء حظر المستخدم ${target.slice(0,8)}...`, 'info');
    } else {
        return;
    }
    // تحديث الفلتر على الفيد الحالي
    applyBanFilter();
    // تحديث لوحة التحكم إذا كانت مفتوحة
    if (adminPanelOpen) renderBannedList();
}

/**
 * تطبيق فلتر الحظر على المنشورات المعروضة حالياً
 */
function applyBanFilter() {
    for (const [postId, element] of renderedPosts) {
        const pubkey = element.dataset?.pubkey;
        if (!pubkey) continue;
        const isBanned = bannedPubkeys.has(pubkey);
        element.style.display = isBanned ? 'none' : '';
    }
    // يمكن أيضاً إخفاء الردود إذا أردت، لكننا نكتفي بالمنشورات الرئيسية حالياً
}

// ============================
// ربط الدوال للنطاق العام (بما فيها دوال الحظر)
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
window.toggleSettings = toggleSettings;
window.exportKey = exportKey;
window.importKey = importKey;
window.copyNpub = copyNpub;
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

// ربط دوال الحظر
window.toggleBanUser = toggleBanUser;
window.openAdminPanel = openAdminPanel;
window.closeAdminPanel = closeAdminPanel;
window.renderBannedList = renderBannedList;
window.addBanButtonToPost = addBanButtonToPost;
