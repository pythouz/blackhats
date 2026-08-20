/* =========================================================
   Pulse — posts.js
   نظام المنشورات: الفيد، النشر، التعديل، الحذف، تحميل المزيد
   ========================================================= */

// ============================
// 9. المنشورات (Feed)
// ============================

function startFeed() {
    console.log('[Feed] بدء الاشتراك');
    const loading = $('loading-feed');
    if (loading) loading.classList.remove('hidden');

    try {
        postsSubscription = pool.subscribeMany(RELAYS, [{ kinds: [1, 5], limit: INITIAL_FEED_LIMIT, '#t': [APP_TAG] }], {
            onevent: event => {
                if (!event?.id) return;
                if (event.kind === 5) { handleDeleteEvent(event); return; }
                const hasTag = event.tags?.some(t => t[0] === 't' && t[1] === APP_TAG);
                if (!hasTag) return;
                // ===== فلتر الحظر =====
                if (bannedPubkeys.has(event.pubkey)) return; // تجاهل منشورات المحظورين
                // معالجة الردود عبر handleIncomingReply بدلاً من عرضها كمنشورات
                if (isReplyEvent(event)) {
                    handleIncomingReply(event);
                    return;
                }
                if (seenEvents.has(event.id)) return;
                seenEvents.add(event.id);
                limitSet(seenEvents, MAX_SEEN_EVENTS);

                initPostState(event.id, event.created_at);
                updatePostScore(event.id);
                postContentMap.set(event.id, { content: event.content, created_at: event.created_at });
                renderPost(event);
                reorderFeed();
                scheduleReactionResubscribe();
            },
            oneose: () => {
                console.log('[Feed] تم التحميل الأولي');
                if (loading) loading.classList.add('hidden');
                // معالجة أي ردود معلقة بعد تحميل كل شيء
                processAllPendingReplies();
                startReactionSubscription();
                updateLoadMoreButton();
            },
            onclose: () => console.log('[Feed] اشتراك أغلق')
        });
    } catch (error) {
        console.error('[Feed] خطأ:', error);
        if (loading) loading.classList.add('hidden');
        showToast('تعذر الاتصال بشبكة المنشورات: ' + getErrorMessage(error), 'error');
    }
}

function isReplyEvent(event) {
    return event.tags?.some(tag => tag[0] === 'e' && tag[1]);
}

function getPostCard(postId) {
    return document.querySelector(`.post-card[data-post-id="${CSS.escape(postId)}"]`);
}

// إدراج بطاقة في المكان الصحيح حسب الوقت (الأحدث أولاً)
function insertPostCard(card) {
    const container = $('feed-container');
    if (!container) return;
    const postId = card.dataset.postId;
    const createdAt = postStats.get(postId)?.createdAt || 0;
    const cards = container.querySelectorAll('.post-card');
    let inserted = false;
    for (let c of cards) {
        const otherId = c.dataset.postId;
        const otherTime = postStats.get(otherId)?.createdAt || 0;
        if (createdAt > otherTime) {
            container.insertBefore(card, c);
            inserted = true;
            break;
        }
    }
    if (!inserted) container.appendChild(card);
}

function renderPost(event) {
    const container = $('feed-container');
    if (!container) return;
    if (renderedPosts.has(event.id)) return;

    const time = new Date(event.created_at * 1000).toLocaleString('ar-EG', {
        hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short'
    });
    const displayName = getDisplayName(event.pubkey);
    const isOwner = (event.pubkey === pk);
    const contentHtml = renderMediaContent(event.content);

    const div = document.createElement('div');
    div.className = 'post-card bg-white dark:bg-cardDark rounded-3xl p-5 shadow-soft border border-gray-100 dark:border-gray-800 fade-in transition-all duration-200';
    div.dataset.postId = event.id;
    div.dataset.pubkey = event.pubkey; // إضافة pubkey لتسهيل الفلتر

    div.innerHTML = `
        <div class="flex justify-between items-start mb-4">
            <div class="flex items-center gap-3 min-w-0">
                <div class="avatar-slot flex-shrink-0">${avatarHtml(event.pubkey, 'w-11 h-11 text-base')}</div>
                <div class="min-w-0 flex-1">
                    <div class="author-name font-bold text-sm dark:text-white truncate">${escapeHtml(displayName)}</div>
                    <div class="text-xs text-gray-400">${escapeHtml(time)}</div>
                </div>
            </div>
            ${isOwner ? `
            <div class="flex gap-1 flex-shrink-0">
                <button onclick="editPost('${event.id}')" class="text-xs text-blue-500 hover:text-blue-700 transition p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-500/10" title="تعديل"><i class="fas fa-edit"></i></button>
                <button onclick="deletePost('${event.id}')" class="text-xs text-red-500 hover:text-red-700 transition p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10" title="حذف"><i class="fas fa-trash"></i></button>
            </div>
            ` : ''}
        </div>
        <div class="post-content text-gray-800 dark:text-gray-200 leading-relaxed mb-4 whitespace-pre-wrap text-sm md:text-base break-words">${contentHtml}</div>
        <div class="flex items-center gap-5 text-gray-400 text-sm border-t border-gray-100 dark:border-gray-800 pt-3">
            <button class="like-button flex items-center gap-2 hover:text-red-500 transition" onclick="likePost('${event.id}', '${event.pubkey}')" data-liked="false" data-postid="${event.id}">
                <i class="far fa-heart"></i> <span>إعجاب</span> <span class="like-count" data-count="0">0</span>
            </button>
            <button class="reply-button flex items-center gap-2 hover:text-accent transition" onclick="replyToPost('${event.id}', '${event.pubkey}')" title="اكتب تعليقًا">
                <i class="far fa-comment"></i> <span>تعليق</span>
            </button>
            <button class="reply-toggle-button flex items-center gap-1.5 hover:text-accent hover:underline transition" onclick="toggleReplies('${event.id}')" title="عرض التعليقات">
                <span class="reply-count" data-count="0">0</span> <span>تعليق</span>
                <i class="fas fa-chevron-down text-[10px] reply-toggle-icon transition-transform duration-200"></i>
            </button>
        </div>
        <div class="replies-container hidden mt-3 space-y-2" data-replies="${event.id}"></div>
    `;

    renderedPosts.set(event.id, div);
    limitMap(renderedPosts, MAX_RENDERED_POSTS);
    insertPostCard(div);
    fetchProfiles([event.pubkey]);

    // إضافة زر الحظر
    addBanButtonToPost(div, event.pubkey);

    // بعد عرض المنشور، حاول معالجة أي ردود معلقة له
    processPendingReplies(event.id);
}

// ============================
// 10. حذف المنشور
// ============================

async function deletePost(postId) {
    if (!pk) { showToast('لا توجد هوية', 'error'); return; }
    if (!confirm('هل أنت متأكد من حذف هذا المنشور؟')) return;
    try {
        const event = await signEvent({ kind: 5, created_at: Math.floor(Date.now() / 1000), tags: [['e', postId]], content: '' });
        await pool.publish(RELAYS, event);
        removePostFromUI(postId);
        showToast('تم حذف المنشور', 'success');
    } catch (error) {
        showToast('فشل الحذف: ' + getErrorMessage(error), 'error');
    }
}

function handleDeleteEvent(event) {
    const targetId = getTagValue(event.tags, 'e');
    if (!targetId) return;
    if (renderedPosts.has(targetId)) {
        const card = getPostCard(targetId);
        if (card && card.dataset.author === event.pubkey) removePostFromUI(targetId);
        return;
    }

    tombstonedEvents.add(targetId);
    limitSet(tombstonedEvents, MAX_SEEN_EVENTS);
    const info = likeEventIndex.get(targetId);
    if (!info) return;
    likeEventIndex.delete(targetId);

    const likers = postLikers.get(info.postId);
    if (!likers || likers.get(info.pubkey) !== targetId) return;
    likers.delete(info.pubkey);

    const postStat = postStats.get(info.postId);
    if (!postStat) return;
    if (info.pubkey === pk) postStat.myLikeEventId = null;
    updatePostScore(info.postId);
    syncLikeCountUI(info.postId);
    if (info.pubkey === pk) updateLikeUI(info.postId, false);
}

function removePostFromUI(postId) {
    const card = getPostCard(postId);
    if (card) {
        card.remove();
        renderedPosts.delete(postId);
        postStats.delete(postId);
        postScores.delete(postId);
        postContentMap.delete(postId);
        seenEvents.delete(postId);
        postLikers.delete(postId);
        pendingRepliesMap.delete(postId);
    }
}

// ============================
// 11. تعديل المنشور
// ============================

let editingPostId = null;
let editAttachments = [];

function isVideoUrl(url) {
    return /\.(mp4|webm|mov|avi|mkv|ogg)(\?.*)?$/i.test(url || '');
}

function renderEditAttachmentPreviews() {
    const wrap = $('edit-attachment-preview');
    if (!wrap) return;
    if (!editAttachments.length) {
        wrap.innerHTML = '';
        wrap.classList.add('hidden');
        return;
    }
    wrap.classList.remove('hidden');
    wrap.innerHTML = editAttachments.map((att, i) => {
        const video = isVideoUrl(att.url);
        const media = video
            ? `<video src="${att.url}" class="w-full h-full object-cover pointer-events-none" muted></video>`
            : `<img src="${att.url}" class="w-full h-full object-cover pointer-events-none" alt="معاينة مرفق" />`;
        return `
            <div class="relative w-20 h-20 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 flex-shrink-0 bg-gray-100 dark:bg-gray-800">
                ${media}
                <button type="button" onclick="removeEditAttachment(${i})"
                        class="absolute top-1 left-1 w-5 h-5 bg-black/60 text-white rounded-full flex items-center justify-center text-[10px] hover:bg-black/80 transition"
                        title="إزالة المرفق">
                    <i class="fas fa-times"></i>
                </button>
                ${video ? '<div class="absolute bottom-1 right-1 text-white text-[10px] bg-black/60 rounded px-1"><i class="fas fa-video"></i></div>' : ''}
            </div>
        `;
    }).join('');
}

function removeEditAttachment(index) {
    editAttachments.splice(index, 1);
    renderEditAttachmentPreviews();
}

function triggerEditFileUpload() {
    document.getElementById('edit-file-input')?.click();
}

async function handleEditFileSelect(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    showToast('جاري رفع الملفات...', 'info');
    const uploaded = await uploadFiles(Array.from(files));
    event.target.value = '';
    if (uploaded.length === 0) { showToast('فشل رفع الملفات', 'error'); return; }
    editAttachments.push(...uploaded);
    renderEditAttachmentPreviews();
    showToast(`تم رفع ${uploaded.length} ملف(ات)`, 'success');
}

function editPost(postId) {
    const data = postContentMap.get(postId);
    if (!data) { showToast('تعذر العثور على المحتوى', 'error'); return; }
    const modal = $('edit-modal');
    const textarea = $('edit-input');
    if (!modal || !textarea) { showToast('مودال التعديل غير جاهز', 'error'); return; }
    editingPostId = postId;

    const { text, mediaUrls } = extractMediaFromContent(data.content);
    textarea.value = text;
    editAttachments = mediaUrls.map(url => ({ url, type: isVideoUrl(url) ? 'video/*' : 'image/*' }));
    renderEditAttachmentPreviews();

    modal.classList.remove('hidden');
    setTimeout(() => textarea.focus(), 50);
}

function closeEditModal() {
    $('edit-modal')?.classList.add('hidden');
    editingPostId = null;
    editAttachments = [];
    renderEditAttachmentPreviews();
}

async function confirmEdit() {
    if (!editingPostId) return;
    const textarea = $('edit-input');
    const text = (textarea?.value || '').trim();
    if (!text && editAttachments.length === 0) { showToast('المحتوى لا يمكن أن يكون فارغاً', 'error'); return; }

    const mediaUrls = editAttachments.map(a => a.url);
    const newContent = [text, ...mediaUrls].filter(Boolean).join('\n');

    const oldPostId = editingPostId;
    try {
        const deleteEvent = await signEvent({ kind: 5, created_at: Math.floor(Date.now() / 1000), tags: [['e', oldPostId]], content: '' });
        await pool.publish(RELAYS, deleteEvent);

        const newEvent = await signEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [['t', APP_TAG]], content: newContent });
        await pool.publish(RELAYS, newEvent);

        const oldCard = getPostCard(oldPostId);
        if (oldCard) {
            oldCard.remove();
            renderedPosts.delete(oldPostId);
            postStats.delete(oldPostId);
            postLikers.delete(oldPostId);
            postScores.delete(oldPostId);
            postContentMap.delete(oldPostId);
            seenEvents.delete(oldPostId);
            pendingRepliesMap.delete(oldPostId);

            initPostState(newEvent.id, newEvent.created_at);
            updatePostScore(newEvent.id);
            postContentMap.set(newEvent.id, { content: newEvent.content, created_at: newEvent.created_at });
            renderPost(newEvent);
            reorderFeed();
            showToast('تم تعديل المنشور ✅', 'success');
        } else {
            seenEvents.add(newEvent.id);
            initPostState(newEvent.id, newEvent.created_at);
            updatePostScore(newEvent.id);
            postContentMap.set(newEvent.id, { content: newEvent.content, created_at: newEvent.created_at });
            renderPost(newEvent);
            reorderFeed();
            showToast('تم التعديل ونشر نسخة جديدة', 'success');
        }
        closeEditModal();
    } catch (error) {
        showToast('فشل التعديل: ' + getErrorMessage(error), 'error');
    }
}

// ============================
// 12. نشر منشور مع رفع الملفات
// ============================

let pendingAttachments = [];

function triggerFileUpload() {
    document.getElementById('file-input')?.click();
}

function isVideoAttachment(att) {
    if (att.type?.startsWith('video/')) return true;
    return /\.(mp4|webm|mov|avi|mkv|ogg)(\?.*)?$/i.test(att.url || '');
}

function renderAttachmentPreviews() {
    const wrap = $('attachment-preview');
    if (!wrap) return;
    if (!pendingAttachments.length) {
        wrap.innerHTML = '';
        wrap.classList.add('hidden');
        return;
    }
    wrap.classList.remove('hidden');
    wrap.innerHTML = pendingAttachments.map((att, i) => {
        const video = isVideoAttachment(att);
        const media = video
            ? `<video src="${att.url}" class="w-full h-full object-cover pointer-events-none" muted></video>`
            : `<img src="${att.url}" class="w-full h-full object-cover pointer-events-none" alt="معاينة مرفق" />`;
        return `
            <div class="relative w-20 h-20 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 flex-shrink-0 bg-gray-100 dark:bg-gray-800">
                ${media}
                <button type="button" onclick="removeAttachment(${i})"
                        class="absolute top-1 left-1 w-5 h-5 bg-black/60 text-white rounded-full flex items-center justify-center text-[10px] hover:bg-black/80 transition"
                        title="إزالة المرفق">
                    <i class="fas fa-times"></i>
                </button>
                ${video ? '<div class="absolute bottom-1 right-1 text-white text-[10px] bg-black/60 rounded px-1"><i class="fas fa-video"></i></div>' : ''}
            </div>
        `;
    }).join('');
}

function removeAttachment(index) {
    pendingAttachments.splice(index, 1);
    renderAttachmentPreviews();
}

async function handleFileSelect(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    showToast('جاري رفع الملفات...', 'info');
    const uploaded = await uploadFiles(Array.from(files));
    event.target.value = '';
    if (uploaded.length === 0) { showToast('فشل رفع الملفات', 'error'); return; }
    pendingAttachments.push(...uploaded);
    renderAttachmentPreviews();
    showToast(`تم رفع ${uploaded.length} ملف(ات)`, 'success');
}

async function publishPost() {
    const input = $('post-input');
    if (!input) { showToast('حقل الكتابة غير موجود', 'error'); return; }
    const text = (input.value || '').trim();
    if (!text && pendingAttachments.length === 0) { showToast('اكتب شيئًا أو أرفق صورة/فيديو قبل النشر', 'error'); return; }
    if (text.length > 4000) { showToast('النص طويل جدًا', 'error'); return; }

    const mediaUrls = pendingAttachments.map(a => a.url);
    const content = [text, ...mediaUrls].filter(Boolean).join('\n');

    try {
        const event = await signEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [['t', APP_TAG]], content });
        if (!seenEvents.has(event.id)) {
            seenEvents.add(event.id);
            initPostState(event.id, event.created_at);
            postContentMap.set(event.id, { content: event.content, created_at: event.created_at });
            updatePostScore(event.id);
            renderPost(event);
            reorderFeed();
            scheduleReactionResubscribe();
        }
        await pool.publish(RELAYS, event);
        input.value = '';
        pendingAttachments = [];
        renderAttachmentPreviews();
        showToast('تم النشر بنجاح', 'success');
    } catch (error) {
        showToast('فشل النشر: ' + getErrorMessage(error), 'error');
    }
}

// ============================
// 18. تحميل المزيد
// ============================

function updateLoadMoreButton() {
    const container = $('load-more-container');
    if (!container) return;
    if (renderedPosts.size >= MAX_RENDERED_POSTS) {
        container.classList.remove('hidden');
    } else {
        container.classList.add('hidden');
    }
}

async function loadMorePosts() {
    if (loadingMore) return;
    const container = $('load-more-container');
    if (!container) return;
    const spinner = $('loading-more-spinner');
    if (spinner) spinner.classList.remove('hidden');

    loadingMore = true;
    try {
        // تحديد أقدم منشور معروض
        const cards = document.querySelectorAll('.post-card');
        if (!cards.length) { loadingMore = false; if (spinner) spinner.classList.add('hidden'); return; }
        let oldest = Infinity;
        for (const card of cards) {
            const id = card.dataset.postId;
            const data = postContentMap.get(id);
            if (data?.created_at && data.created_at < oldest) oldest = data.created_at;
        }
        if (oldest === Infinity) { loadingMore = false; if (spinner) spinner.classList.add('hidden'); return; }

        // جلب منشورات أقدم
        const sub = pool.subscribeMany(RELAYS, [{ kinds: [1], '#t': [APP_TAG], until: oldest, limit: 100 }], {
            onevent: event => {
                if (!event?.id) return;
                if (event.kind === 5) { handleDeleteEvent(event); return; }
                if (isReplyEvent(event)) {
                    handleIncomingReply(event);
                    return;
                }
                // فلتر الحظر
                if (bannedPubkeys.has(event.pubkey)) return;
                if (seenEvents.has(event.id)) return;
                seenEvents.add(event.id);
                initPostState(event.id, event.created_at);
                updatePostScore(event.id);
                postContentMap.set(event.id, { content: event.content, created_at: event.created_at });
                renderPost(event);
                reorderFeed();
                scheduleReactionResubscribe();
            },
            oneose: () => {
                loadingMore = false;
                if (spinner) spinner.classList.add('hidden');
                updateLoadMoreButton();
                // معالجة الردود المعلقة
                processAllPendingReplies();
            },
            onclose: () => { loadingMore = false; if (spinner) spinner.classList.add('hidden'); }
        });
    } catch (e) {
        loadingMore = false;
        if (spinner) spinner.classList.add('hidden');
        showToast('فشل تحميل المزيد: ' + getErrorMessage(e), 'error');
    }
}
