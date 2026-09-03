/* =========================================================
   Pulse — bookmarks-mute.js
   المحفوظات وقائمة الكتم الشخصية (NIP-51)
   ========================================================= */

const BOOKMARKS_KIND = 10003;
const MUTE_LIST_KIND = 10000;

function loadBookmarksAndMuteList() {
    if (!pk) return;
    pool.subscribeMany(RELAYS, [
        { kinds: [BOOKMARKS_KIND], authors: [pk], limit: 1 },
        { kinds: [MUTE_LIST_KIND], authors: [pk], limit: 1 }
    ], {
        onevent: (event) => {
            if (event.kind === BOOKMARKS_KIND) {
                bookmarkedPostIds.clear();
                (event.tags || []).filter(t => t[0] === 'e').forEach(t => bookmarkedPostIds.add(t[1]));
                bookmarksLoaded = true;
                refreshBookmarkButtons();
            } else if (event.kind === MUTE_LIST_KIND) {
                mutedPubkeys.clear();
                (event.tags || []).filter(t => t[0] === 'p').forEach(t => mutedPubkeys.add(t[1]));
                muteListLoaded = true;
                applyBanFilter(); // نعيد تطبيق فلتر الإخفاء بعد ما عرفنا مين متكوتم
            }
        },
        oneose: () => { bookmarksLoaded = true; muteListLoaded = true; }
    });
}

function refreshBookmarkButtons() {
    document.querySelectorAll('.bookmark-button').forEach(btn => {
        const postId = btn.dataset.postid;
        btn.classList.toggle('text-accent2', bookmarkedPostIds.has(postId));
    });
}

// ============================
// المحفوظات
// ============================

async function toggleBookmark(postId) {
    if (!pk) { showToast('لا توجد هوية', 'error'); return; }
    const wasBookmarked = bookmarkedPostIds.has(postId);
    if (wasBookmarked) bookmarkedPostIds.delete(postId); else bookmarkedPostIds.add(postId);
    refreshBookmarkButtons();
    showToast(wasBookmarked ? 'اتشال من المحفوظات' : 'اتحفظ ✅', 'success');

    try {
        const tags = Array.from(bookmarkedPostIds).map(id => ['e', id]);
        const event = await signEvent({ kind: BOOKMARKS_KIND, created_at: Math.floor(Date.now() / 1000), tags, content: '' });
        await publishToRelays(event);
    } catch (e) {
        if (wasBookmarked) bookmarkedPostIds.add(postId); else bookmarkedPostIds.delete(postId);
        refreshBookmarkButtons();
        showToast('فشل تحديث المحفوظات: ' + getErrorMessage(e), 'error');
    }
}

function openBookmarksPanel() {
    const list = $('bookmarks-list');
    if (!list) return;
    const ids = Array.from(bookmarkedPostIds).reverse();
    if (!ids.length) {
        list.innerHTML = `<p class="text-center text-gray-400 text-sm py-10">مفيش حاجة محفوظة لسه<br>اضغط أيقونة 🔖 تحت أي منشور عشان تحفظه</p>`;
    } else {
        list.innerHTML = ids.map(id => {
            const content = postContentMap.get(id);
            const card = getPostCard(id);
            const pubkey = card?.dataset.pubkey;
            const name = pubkey ? escapeHtml(getDisplayName(pubkey)) : 'منشور';
            const snippet = content ? escapeHtml(content.content.slice(0, 120)) : 'المنشور مش محمّل حاليًا — جرّب تحمّل المزيد في الفيد الأساسي';
            return `
                <button onclick="closeBookmarksPanel(); scrollToPost('${id}')"
                        class="w-full flex items-start gap-3 p-3 rounded-2xl text-right transition hover:bg-gray-50 dark:hover:bg-gray-800/60">
                    <div class="flex-1 min-w-0 text-sm">
                        <p class="font-bold dark:text-white">${name}</p>
                        <p class="text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed break-words">${snippet}</p>
                    </div>
                    <i class="fas fa-bookmark text-accent2 text-sm flex-shrink-0 mt-1"></i>
                </button>
            `;
        }).join('');
    }
    $('bookmarks-panel')?.classList.remove('hidden');
}

function closeBookmarksPanel() {
    $('bookmarks-panel')?.classList.add('hidden');
}

// ============================
// الكتم الشخصي (خاص بيك بس — مختلف عن حظر الأدمن العام)
// ============================

async function toggleUserMute(pubkey) {
    if (!pk) { showToast('لا توجد هوية', 'error'); return; }
    if (pubkey === pk) { showToast('متقدرش تكتم نفسك 🙂', 'info'); return; }
    const wasMuted = mutedPubkeys.has(pubkey);
    if (wasMuted) mutedPubkeys.delete(pubkey); else mutedPubkeys.add(pubkey);
    applyBanFilter();
    showToast(wasMuted ? 'تم إلغاء الكتم' : 'تم الكتم — منشوراته مش هتظهرلك بس (لسه شايفينه هما)', 'success');
    refreshMuteButtons(pubkey);

    try {
        const tags = Array.from(mutedPubkeys).map(p => ['p', p]);
        const event = await signEvent({ kind: MUTE_LIST_KIND, created_at: Math.floor(Date.now() / 1000), tags, content: '' });
        await publishToRelays(event);
    } catch (e) {
        if (wasMuted) mutedPubkeys.add(pubkey); else mutedPubkeys.delete(pubkey);
        applyBanFilter();
        refreshMuteButtons(pubkey);
        showToast('فشل تحديث الكتم: ' + getErrorMessage(e), 'error');
    }
}

function refreshMuteButtons(pubkey) {
    document.querySelectorAll(`.mute-button[data-pubkey="${CSS.escape(pubkey)}"]`).forEach(btn => {
        const muted = mutedPubkeys.has(pubkey);
        btn.classList.toggle('text-red-500', muted);
        btn.classList.toggle('text-gray-600', !muted);
        btn.classList.toggle('dark:text-gray-300', !muted);
        btn.title = muted ? 'إلغاء الكتم' : 'كتم';
        const icon = btn.querySelector('i');
        if (icon) icon.className = muted ? 'fas fa-volume-mute text-sm' : 'fas fa-volume-xmark text-sm';
    });
}

window.toggleBookmark = toggleBookmark;
window.openBookmarksPanel = openBookmarksPanel;
window.closeBookmarksPanel = closeBookmarksPanel;
window.toggleUserMute = toggleUserMute;
window.loadBookmarksAndMuteList = loadBookmarksAndMuteList;
