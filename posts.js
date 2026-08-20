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
                if (bannedPubkeys.has(event.pubkey)) return;
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
    div.dataset.pubkey = event.pubkey;

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
        <!-- منطقة الأزرار مع إضافة post-actions -->
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
            <!-- سيتم إضافة زر الحظر هنا بواسطة addBanButtonToPost -->
        </div>
        <div class="replies-container hidden mt-3 space-y-2" data-replies="${event.id}"></div>
    `;

    renderedPosts.set(event.id, div);
    limitMap(renderedPosts, MAX_RENDERED_POSTS);
    insertPostCard(div);
    fetchProfiles([event.pubkey]);

    // إضافة زر الحظر داخل post-actions
    addBanButtonToPost(div, event.pubkey);

    processPendingReplies(event.id);
}

// باقي دوال posts.js (حذف، تعديل، نشر، تحميل المزيد) تبقى كما هي دون تغيير
// ... (نفس الكود السابق)
