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
        let batchCount = 0;
        postsSubscription = pool.subscribeMany(RELAYS, [{ kinds: [1, 5, 6], limit: INITIAL_FEED_LIMIT, '#t': [APP_TAG] }], {
            onevent: event => {
                if (!event?.id) return;
                batchCount++;
                if (event.kind === 5) { handleDeleteEvent(event); return; }
                const hasTag = event.tags?.some(t => t[0] === 't' && t[1] === APP_TAG);
                if (!hasTag) return;
                if (isHidden(event.pubkey)) return;
                if (isRepostEvent(event)) {
                    if (seenEvents.has(event.id)) return;
                    seenEvents.add(event.id);
                    limitSet(seenEvents, MAX_SEEN_EVENTS);
                    renderRepost(event);
                    scheduleReorderFeed();
                    return;
                }
                if (isReplyEvent(event)) {
                    handleIncomingReply(event);
                    return;
                }
                if (seenEvents.has(event.id) || tombstonedEvents.has(event.id)) return;
                seenEvents.add(event.id);
                limitSet(seenEvents, MAX_SEEN_EVENTS);

                initPostState(event.id, event.created_at);
                updatePostScore(event.id);
                postContentMap.set(event.id, { content: event.content, created_at: event.created_at });
                renderPost(event);
                scheduleReorderFeed();
                scheduleReactionResubscribe();
            },
            oneose: () => {
                console.log('[Feed] تم التحميل الأولي');
                if (loading) loading.classList.add('hidden');
                feedReady = true;
                processAllPendingReplies();
                startReactionSubscription();
                updateLoadMoreButton(batchCount >= INITIAL_FEED_LIMIT);
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
    return pickVisibleMatch(document.querySelectorAll(`.post-card[data-post-id="${CSS.escape(postId)}"]`));
}

// 🛠️ نفس البوست ممكن يكون متعروض في نفس اللحظة في الفيد الرئيسي (مخفي
// بس لسه موجود في الـ DOM) وفي صفحة البروفايل (ظاهر) — الاتنين بنفس
// data-post-id بالظبط. document.querySelector العادي كان بياخد أول
// نسخة يلاقيها بترتيب الـ DOM (غالبًا نسخة الفيد المخفية)، مش النسخة
// اللي المستخدم شايفها فعليًا — وده كان بيسبب حاجات زي "التعليقات مش
// بتظهر في صفحة البروفايل" أو "الحذف مش بيشتغل من البروفايل" لأن
// العملية كانت بتحصل على نسخة مخفية تانية. الدالة دي بتفضّل أي نسخة
// جوه View ظاهر فعليًا حاليًا.
function isInVisibleView(el) {
    const view = el.closest('.view-section');
    return !view || !view.classList.contains('hidden');
}

function pickVisibleMatch(nodeList) {
    for (const el of nodeList) {
        if (isInVisibleView(el)) return el;
    }
    return nodeList[0] || null;
}

// نفس فكرة getPostCard، لحاويات الردود (.replies-container). مينفعش
// نستخدم offsetParent هنا لأن الحاوية دي عندها حالة "مقفولة/مفتوحة"
// محلية خاصة بيها (toggleReplies) منفصلة تمامًا عن كون الـ View بتاعها
// ظاهر ولا لأ.
function getRepliesContainer(postId) {
    return pickVisibleMatch(document.querySelectorAll(`.replies-container[data-replies="${CSS.escape(postId)}"]`));
}

// مشتركة بين الإشعارات ونتائج البحث — يفتح الفيد ويوصل لمكان البوست
// ويوميّه بإطار مؤقت. لو البوست مش محمّل حاليًا (مثلاً قديم ولسه ما
// اتحملش عن طريق "تحميل المزيد") بيوريك تنبيه بدل ما يفشل بصمت.
function scrollToPost(postId) {
    if (typeof switchView === 'function') switchView('timeline');
    setTimeout(() => {
        const card = getPostCard(postId);
        if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            card.classList.add('ring-2', 'ring-accent');
            setTimeout(() => card.classList.remove('ring-2', 'ring-accent'), 2000);
        } else {
            showToast('المنشور مش محمّل في الفيد الحالي', 'info');
        }
    }, 300);
}

function insertPostCard(card) {
    const container = $('feed-container');
    if (!container) return;
    // إعادة النشر بتستخدم data-sort-time (وقت إعادة النشر) بدل وقت
    // المنشور الأصلي المسجّل في postStats، عشان إعادة نشر بوست قديم
    // تظهر قريب من أعلى الفيد وقت حصولها، مش تندفن تحت وقت المنشور
    // الأصلي.
    const readTime = c => c.dataset.sortTime ? parseInt(c.dataset.sortTime, 10) : (postStats.get(c.dataset.postId)?.createdAt || 0);
    const createdAt = readTime(card);
    const cards = container.querySelectorAll('.post-card');
    let inserted = false;
    for (let c of cards) {
        if (createdAt > readTime(c)) {
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
    const contentHtml = renderMediaContent(event.content);

    const div = document.createElement('div');
    div.className = 'post-card bg-white dark:bg-cardDark rounded-3xl p-5 shadow-soft border border-gray-100 dark:border-gray-800 fade-in transition-all duration-200';
    div.dataset.postId = event.id;
    div.dataset.pubkey = event.pubkey;

    div.innerHTML = `
        <div class="flex justify-between items-start mb-4">
            <div class="flex items-center gap-3 min-w-0">
                <div class="avatar-slot flex-shrink-0 cursor-pointer" onclick="openProfilePage('${event.pubkey}')">${avatarHtml(event.pubkey, 'w-11 h-11 text-base')}</div>
                <div class="min-w-0 flex-1">
                    <div class="author-name font-bold text-sm dark:text-white truncate">${escapeHtml(displayName)}</div>
                    <div class="text-xs text-gray-400">${escapeHtml(time)}</div>
                </div>
            </div>
            ${event.pubkey === pk ? `
            <div class="flex gap-1 flex-shrink-0">
                <button onclick="editPost('${event.id}')" class="text-xs text-blue-500 hover:text-blue-700 transition p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-500/10" title="تعديل"><i class="fas fa-edit"></i></button>
                <button onclick="deletePost('${event.id}')" class="text-xs text-red-500 hover:text-red-700 transition p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10" title="حذف"><i class="fas fa-trash"></i></button>
            </div>
            ` : ''}
        </div>
        <div class="post-content text-gray-800 dark:text-gray-200 leading-relaxed mb-4 whitespace-pre-wrap text-sm md:text-base break-words">${contentHtml}</div>
        <div class="post-actions flex items-center gap-4 text-gray-400 text-sm border-t border-gray-100 dark:border-gray-800 pt-3">
            <button class="like-button flex items-center gap-1 hover:text-red-500 transition" onclick="likePost('${event.id}', '${event.pubkey}')" data-liked="false" data-postid="${event.id}">
                <i class="far fa-heart"></i> <span>إعجاب</span> <span class="like-count" data-count="0">0</span>
            </button>
            <button class="reply-button flex items-center gap-1 hover:text-accent transition" onclick="replyToPost('${event.id}', '${event.pubkey}')" title="اكتب تعليقًا">
                <i class="far fa-comment"></i> <span>تعليق</span>
            </button>
            <button class="reply-toggle-button flex items-center gap-1 hover:text-accent hover:underline transition" onclick="toggleReplies('${event.id}')" title="عرض التعليقات">
                <span class="reply-count" data-count="0">0</span> <span>تعليق</span>
                <i class="fas fa-chevron-down text-[10px] reply-toggle-icon transition-transform duration-200"></i>
            </button>
            <button class="repost-button flex items-center gap-1 hover:text-emerald-500 transition" onclick="repostPost('${event.id}', '${event.pubkey}')" title="إعادة نشر">
                <i class="fas fa-retweet"></i>
            </button>
            <button class="bookmark-button flex items-center gap-1 hover:text-accent2 transition" onclick="toggleBookmark('${event.id}')" data-postid="${event.id}" title="حفظ">
                <i class="fas fa-bookmark"></i>
            </button>
            <button class="zap-button flex items-center gap-1 hover:text-amber-500 transition mr-auto" onclick="openZapModal('${event.id}', '${event.pubkey}')" title="زاب">
                <i class="fas fa-bolt"></i> <span class="zap-count"></span>
            </button>
        </div>
        <div class="replies-container hidden mt-3 space-y-2" data-replies="${event.id}"></div>
    `;

    renderedPosts.set(event.id, div);
    // (أداء) وقت التحميل الأولي أو "تحميل المزيد" بيوصلوا عشرات/مئات
    // البوستات دفعة واحدة — مفيش داعي نفتح subscription لايكات منفصل
    // لكل واحد منهم لوحده، لأن fetchPastLikesAndDeletes هتجمّعهم كلهم
    // في طلبات مجمّعة بعد الدفعة. غير كده (بوست جديد حقيقي)، بنجيب
    // لايكاته لوحده زي ما كان الحال.
    if (feedReady && !loadingMore) fetchLikesForNewPost(event.id);
    limitMap(renderedPosts, MAX_RENDERED_POSTS);
    insertPostCard(div);
    fetchProfiles([event.pubkey]);

    addBanButtonToPost(div, event.pubkey);
    processPendingReplies(event.id);
    if (bookmarkedPostIds.has(event.id)) refreshBookmarkButtons();
}

// ============================
// 9ب. إعادة النشر (Repost — NIP-18)
// ============================

function isRepostEvent(event) {
    return event.kind === 6;
}

async function repostPost(postId, postPubkey) {
    if (!pk) { showToast('لا توجد هوية', 'error'); return; }
    if (!checkRateLimit('repostPost', 2000, 15, 5 * 60 * 1000)) return;

    const original = postContentMap.get(postId);
    if (!original) { showToast('تعذر إيجاد محتوى المنشور', 'error'); return; }

    try {
        // NIP-18: نضمّن نسخة من الحدث الأصلي كـ JSON جوه المحتوى، عشان
        // أي حد يستقبل حدث إعادة النشر ده يقدر يعرضه فورًا من غير ما
        // يحتاج يطلب المنشور الأصلي من الشبكة تاني.
        const originalEventJson = JSON.stringify({
            id: postId,
            pubkey: postPubkey,
            content: original.content,
            created_at: original.created_at,
            kind: 1,
            tags: []
        });
        const event = await signEvent({
            kind: 6,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['e', postId], ['p', postPubkey], ['t', APP_TAG]],
            content: originalEventJson
        });
        await publishToRelays(event);
        showToast('تم إعادة النشر 🔁', 'success');
        renderRepost(event);
        scheduleReorderFeed();
    } catch (e) {
        showToast('فشل إعادة النشر: ' + getErrorMessage(e), 'error');
    }
}

function renderRepost(event) {
    const container = $('feed-container');
    if (!container) return;

    let original;
    try {
        original = JSON.parse(event.content);
        if (!original?.id || !original?.pubkey || typeof original.content !== 'string') throw new Error('invalid');
    } catch (e) {
        // المُعيد نشره ما ضمّنش محتوى المنشور الأصلي جوه الحدث (بعض
        // العملاء بتسيب المحتوى فاضي) — مفيش حاجة نعرضها من غيره، فبنتجاهله
        // بدل ما نعمل طلب شبكة إضافي لجلبه لوحده.
        return;
    }
    if (isHidden(original.pubkey) || isHidden(event.pubkey)) return;
    if (renderedPosts.has(original.id)) return; // البوست الأصلي (أو ريبوست ليه) ظاهر أصلاً، منكررهوش
    if (tombstonedEvents.has(original.id)) return;

    const reposterName = getDisplayName(event.pubkey);
    const time = new Date(original.created_at * 1000).toLocaleString('ar-EG', {
        hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short'
    });
    const displayName = getDisplayName(original.pubkey);
    const contentHtml = renderMediaContent(original.content);

    const div = document.createElement('div');
    div.className = 'post-card bg-white dark:bg-cardDark rounded-3xl p-5 shadow-soft border border-gray-100 dark:border-gray-800 fade-in transition-all duration-200';
    div.dataset.postId = original.id;      // التفاعلات (لايك/رد/حذف) بتستهدف البوست الأصلي دايمًا
    div.dataset.pubkey = original.pubkey;
    div.dataset.sortTime = event.created_at; // بترتّب بوقت إعادة النشر، مش وقت المنشور الأصلي

    div.innerHTML = `
        <div class="flex items-center gap-2 text-xs text-gray-400 mb-3 -mt-1">
            <i class="fas fa-retweet text-emerald-500"></i>
            <span class="truncate">أعاد <b class="dark:text-gray-300 cursor-pointer hover:underline" onclick="openProfilePage('${event.pubkey}')">${escapeHtml(reposterName)}</b> النشر</span>
        </div>
        <div class="flex items-center gap-3 mb-3">
            <div class="avatar-slot flex-shrink-0 cursor-pointer" onclick="openProfilePage('${original.pubkey}')">${avatarHtml(original.pubkey, 'w-11 h-11 text-base')}</div>
            <div class="min-w-0 flex-1">
                <div class="author-name font-bold text-sm dark:text-white truncate">${escapeHtml(displayName)}</div>
                <div class="text-xs text-gray-400">${escapeHtml(time)}</div>
            </div>
        </div>
        <div class="post-content text-gray-800 dark:text-gray-200 leading-relaxed mb-4 whitespace-pre-wrap text-sm md:text-base break-words">${contentHtml}</div>
        <div class="post-actions flex items-center gap-4 text-gray-400 text-sm border-t border-gray-100 dark:border-gray-800 pt-3">
            <button class="like-button flex items-center gap-1 hover:text-red-500 transition" onclick="likePost('${original.id}', '${original.pubkey}')" data-liked="false" data-postid="${original.id}">
                <i class="far fa-heart"></i> <span>إعجاب</span> <span class="like-count" data-count="0">0</span>
            </button>
            <button class="reply-button flex items-center gap-1 hover:text-accent transition" onclick="replyToPost('${original.id}', '${original.pubkey}')" title="اكتب تعليقًا">
                <i class="far fa-comment"></i> <span>تعليق</span>
            </button>
            <button class="reply-toggle-button flex items-center gap-1 hover:text-accent hover:underline transition" onclick="toggleReplies('${original.id}')" title="عرض التعليقات">
                <span class="reply-count" data-count="0">0</span> <span>تعليق</span>
                <i class="fas fa-chevron-down text-[10px] reply-toggle-icon transition-transform duration-200"></i>
            </button>
            <button class="bookmark-button flex items-center gap-1 hover:text-accent2 transition" onclick="toggleBookmark('${original.id}')" data-postid="${original.id}" title="حفظ">
                <i class="fas fa-bookmark"></i>
            </button>
            <button class="zap-button flex items-center gap-1 hover:text-amber-500 transition mr-auto" onclick="openZapModal('${original.id}', '${original.pubkey}')" title="زاب">
                <i class="fas fa-bolt"></i> <span class="zap-count"></span>
            </button>
        </div>
        <div class="replies-container hidden mt-3 space-y-2" data-replies="${original.id}"></div>
    `;

    renderedPosts.set(original.id, div);
    if (!postStats.has(original.id)) {
        initPostState(original.id, original.created_at);
        updatePostScore(original.id);
        postContentMap.set(original.id, { content: original.content, created_at: original.created_at });
    }
    if (feedReady && !loadingMore) fetchLikesForNewPost(original.id);
    limitMap(renderedPosts, MAX_RENDERED_POSTS);
    insertPostCard(div);
    fetchProfiles([original.pubkey, event.pubkey]);
    processPendingReplies(original.id);
    if (bookmarkedPostIds.has(original.id)) refreshBookmarkButtons();
}

async function deletePost(postId) {
    if (!pk) { showToast('لا توجد هوية', 'error'); return; }
    if (!confirm('هل أنت متأكد من حذف هذا المنشور؟')) return;
    if (!checkRateLimit('deletePost', 1000, 15, 5 * 60 * 1000)) return;
    try {
        // 🛠️ لازم نحط تاج ['t', APP_TAG] على حدث الحذف نفسه، لأن اشتراك
        // الفيد (startFeed / loadMorePosts) بيطلب kinds:[1,5] مع
        // '#t': [APP_TAG] مع بعض. من غير التاج ده، الـ relay (لو ملتزم
        // بالمعيار زي damus/nos.lol) مش هيوصّل حدث الحذف خالص لأي حد
        // تاني بيتابع الفيد، وبالتالي البوست مش هيختفي من شاشتهم إلا
        // بعد Refresh يدوي.
        const event = await signEvent({ kind: 5, created_at: Math.floor(Date.now() / 1000), tags: [['e', postId], ['t', APP_TAG]], content: '' });
        await publishToRelays(event);
        removePostFromUI(postId);
        showToast('تم حذف المنشور', 'success');
    } catch (error) {
        showToast('فشل الحذف: ' + getErrorMessage(error), 'error');
    }
}

// ملاحظة: handleDeleteEvent اتنقلت وانضمّت في reactions.js (كانت متعرّفة
// هنا كمان بنفس الاسم، وبما إن reactions.js بيتحمّل بعد الملف ده، نسخته
// كانت بتلغي النسخة دي بالكامل بصمت — يعني الكود اللي كان بيشيل البوست من
// الشاشة لما يتحذف كان أصلاً مبيتنفذش خالص. المنطق اتدمج في نسخة واحدة
// جوه reactions.js عشان نتجنب تضارب الأسماء ده تاني.

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
        pastLikesFetchedPostIds.delete(postId);
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
    if (!checkRateLimit('confirmEdit', 3000, 8, 5 * 60 * 1000)) return;

    const mediaUrls = editAttachments.map(a => a.url);
    const newContent = [text, ...mediaUrls].filter(Boolean).join('\n');

    const oldPostId = editingPostId;
    try {
        // نفس ملاحظة deletePost فوق: لازم تاج ['t', APP_TAG] عشان حدث
        // الحذف يوصل فعليًا لباقي المتابعين عبر اشتراك الفيد.
        const deleteEvent = await signEvent({ kind: 5, created_at: Math.floor(Date.now() / 1000), tags: [['e', oldPostId], ['t', APP_TAG]], content: '' });
        await publishToRelays(deleteEvent);

        const newEvent = await signEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [['t', APP_TAG]], content: newContent });
        await publishToRelays(newEvent);

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
    if (!checkRateLimit('publishPost', 3000, 8, 5 * 60 * 1000)) return;

    const mediaUrls = pendingAttachments.map(a => a.url);
    const content = [text, ...mediaUrls].filter(Boolean).join('\n');

    try {
        const event = await signEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [['t', APP_TAG]], content });

        // ✅ لازم نستنى تأكيد النشر الحقيقي من الـ relays الأول (عبر
        // publishToRelays اللي بتستنى فعليًا) قبل ما نعرض الكارت على
        // الشاشة، وإلا لو النشر فشل هيفضل ظاهر عندك بس مش موجود فعليًا
        // على أي relay، ويختفي أول ما تعمل ريفرش.
        await publishToRelays(event);

        if (!seenEvents.has(event.id)) {
            seenEvents.add(event.id);
            initPostState(event.id, event.created_at);
            postContentMap.set(event.id, { content: event.content, created_at: event.created_at });
            updatePostScore(event.id);
            renderPost(event);
            reorderFeed();
            scheduleReactionResubscribe();
        }
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

function updateLoadMoreButton(hasMore) {
    const container = $('load-more-container');
    if (!container) return;
    // 🛠️ الشرط القديم كان بيوّري الزرار بس لما renderedPosts.size يوصل
    // MAX_RENDERED_POSTS (500) — يعني عمليًا الزرار ما كانش بيظهر إلا
    // بعد ما مئات البوستات الحية تتراكم، وده كان بيمنع الوصول لأي بوستات
    // قديمة تقريبًا في أغلب الجلسات العادية. الصح إننا نوّري الزرار لو
    // آخر دفعة جبناها من الـ relay كانت "كاملة" (وصلت لعدد الـ limit
    // المطلوب) — ده اللي بيدل على احتمال وجود بوستات أقدم لسه.
    if (hasMore) container.classList.remove('hidden');
    else container.classList.add('hidden');
}

async function loadMorePosts() {
    if (loadingMore) return;
    const container = $('load-more-container');
    if (!container) return;
    const spinner = $('loading-more-spinner');
    if (spinner) spinner.classList.remove('hidden');

    loadingMore = true;
    try {
        const cards = document.querySelectorAll('.post-card');
        if (!cards.length) { loadingMore = false; if (spinner) spinner.classList.add('hidden'); return; }
        let oldest = Infinity;
        for (const card of cards) {
            const id = card.dataset.postId;
            const data = postContentMap.get(id);
            if (data?.created_at && data.created_at < oldest) oldest = data.created_at;
        }
        if (oldest === Infinity) { loadingMore = false; if (spinner) spinner.classList.add('hidden'); return; }

        let batchCount = 0;
        const sub = pool.subscribeMany(RELAYS, [{ kinds: [1, 5, 6], '#t': [APP_TAG], until: oldest, limit: 100 }], {
            onevent: event => {
                if (!event?.id) return;
                batchCount++;
                if (event.kind === 5) { handleDeleteEvent(event); return; }
                if (isRepostEvent(event)) {
                    if (seenEvents.has(event.id)) return;
                    seenEvents.add(event.id);
                    renderRepost(event);
                    scheduleReorderFeed();
                    return;
                }
                if (isReplyEvent(event)) {
                    handleIncomingReply(event);
                    return;
                }
                if (isHidden(event.pubkey)) return;
                if (seenEvents.has(event.id) || tombstonedEvents.has(event.id)) return;
                seenEvents.add(event.id);
                initPostState(event.id, event.created_at);
                updatePostScore(event.id);
                postContentMap.set(event.id, { content: event.content, created_at: event.created_at });
                renderPost(event);
                scheduleReorderFeed();
                scheduleReactionResubscribe();
            },
            oneose: () => {
                loadingMore = false;
                if (spinner) spinner.classList.add('hidden');
                updateLoadMoreButton(batchCount >= 100);
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
