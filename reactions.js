/* =========================================================
   Pulse — reactions.js
   الإعجابات + الردود (مع دعم الإلغاء الفوري عبر kind 7)
   ========================================================= */

// ============================
// 13. نظام الإعجابات (معدل)
// ============================

async function likePost(postId, postPubkey) {
    if (!pk) { showToast('لا توجد هوية', 'error'); return; }
    const stat = postStats.get(postId);
    if (!stat) { showToast('المنشور غير موجود', 'error'); return; }

    const likers = postLikers.get(postId) || new Map();
    const existingLikeId = likers.get(pk);

    try {
        if (existingLikeId) {
            // ✅ إلغاء الإعجاب: نرسل kind 7 مع content = "unlike"
            const unlikeEvent = await signEvent({
                kind: 7,
                created_at: Math.floor(Date.now() / 1000),
                tags: [
                    ['e', postId],
                    ['p', postPubkey],
                    ['l', 'unlike']  // علامة تميز الإلغاء
                ],
                content: 'unlike'  // محتوى مميز للإلغاء
            });
            await pool.publish(RELAYS, unlikeEvent);
            
            // تحديث الحالة محلياً فوراً
            likers.delete(pk);
            likeEventIndex.delete(existingLikeId);
            stat.myLikeEventId = null;
            updatePostScore(postId);
            syncLikeCountUI(postId);
            updateLikeUI(postId, false);
            showToast('تم إلغاء الإعجاب', 'success');
        } else {
            // ✅ إعجاب جديد: نرسل kind 7 مع content = "" (فارغ)
            const likeEvent = await signEvent({
                kind: 7,
                created_at: Math.floor(Date.now() / 1000),
                tags: [
                    ['e', postId],
                    ['p', postPubkey]
                ],
                content: ''  // فارغ للإعجاب
            });
            await pool.publish(RELAYS, likeEvent);
            
            likers.set(pk, likeEvent.id);
            likeEventIndex.set(likeEvent.id, { postId, pubkey: pk });
            stat.myLikeEventId = likeEvent.id;
            updatePostScore(postId);
            syncLikeCountUI(postId);
            updateLikeUI(postId, true);
            showToast('تم الإعجاب ❤️', 'success');
        }
    } catch (error) {
        showToast('فشل: ' + getErrorMessage(error), 'error');
    }
}

function updateLikeUI(postId, liked) {
    const cards = document.querySelectorAll(`.post-card[data-post-id="${CSS.escape(postId)}"]`);
    cards.forEach(card => {
        const btn = card.querySelector('.like-button');
        if (!btn) return;
        const icon = btn.querySelector('i');
        if (liked) {
            btn.dataset.liked = 'true';
            icon.className = 'fas fa-heart text-red-500';
        } else {
            btn.dataset.liked = 'false';
            icon.className = 'far fa-heart';
        }
    });
}

function syncLikeCountUI(postId) {
    const likers = postLikers.get(postId);
    const count = likers ? likers.size : 0;
    const cards = document.querySelectorAll(`.post-card[data-post-id="${CSS.escape(postId)}"]`);
    cards.forEach(card => {
        const countEl = card.querySelector('.like-count');
        if (countEl) {
            countEl.textContent = count;
            countEl.dataset.count = count;
        }
    });
}

// ============================
// 14. اشتراك الإعجابات والردود
// ============================

function startReactionSubscription() {
    if (reactionsSubscription) {
        try { reactionsSubscription.close(); } catch(e) {}
    }

    const postIds = Array.from(postStats.keys());
    if (!postIds.length) {
        setTimeout(startReactionSubscription, 3000);
        return;
    }

    console.log('[Reactions] بدء اشتراك الإعجابات لـ', postIds.length, 'بوست');

    // جلب الإعجابات السابقة
    fetchPastLikes(postIds);

    // اشتراك في kind 7 (إعجابات) فقط مع فلتر #e = postIds
    reactionsSubscription = pool.subscribeMany(RELAYS, [
        { kinds: [7], '#e': postIds },
        { kinds: [1], '#e': postIds }  // للردود
    ], {
        onevent: (event) => {
            if (event.kind === 7) {
                handleLikeEvent(event);
            } else if (event.kind === 1) {
                const isReply = event.tags.some(t => t[0] === 'e');
                if (isReply) {
                    handleIncomingReply(event);
                }
            }
        },
        oneose: () => {
            setTimeout(startReactionSubscription, 15000);
        },
        onclose: () => {
            setTimeout(startReactionSubscription, 5000);
        }
    });
}

// ============================
// 15. جلب الإعجابات السابقة
// ============================

function fetchPastLikes(postIds) {
    if (!postIds.length) return;
    const batchSize = 50;
    for (let i = 0; i < postIds.length; i += batchSize) {
        const batch = postIds.slice(i, i + batchSize);
        const sub = pool.subscribeMany(RELAYS, [
            { kinds: [7], '#e': batch, limit: 500 }
        ], {
            onevent: (event) => {
                handleLikeEvent(event);
            },
            oneose: () => {
                try { sub.close(); } catch(e) {}
            }
        });
        setTimeout(() => { try { sub.close(); } catch(e) {} }, 5000);
    }
}

// ============================
// 16. معالجة حدث الإعجاب (kind 7) - يدعم الإلغاء
// ============================

function handleLikeEvent(event) {
    const targetId = getTagValue(event.tags, 'e');
    if (!targetId) return;
    const pubkey = event.pubkey;
    const likeEventId = event.id;
    const content = event.content || '';

    // ✅ التحقق من الإلغاء: content === "unlike" أو وجود علامة l = "unlike"
    const isUnlike = content === 'unlike' || event.tags.some(t => t[0] === 'l' && t[1] === 'unlike');

    if (!postStats.has(targetId)) {
        initPostState(targetId, event.created_at || Math.floor(Date.now()/1000));
    }

    if (!postLikers.has(targetId)) {
        postLikers.set(targetId, new Map());
    }
    const likers = postLikers.get(targetId);

    if (isUnlike) {
        // ✅ معالجة إلغاء الإعجاب
        // نبحث عن likeEventId القديم لهذا المستخدم
        let oldLikeId = null;
        for (const [id, info] of likeEventIndex) {
            if (info.postId === targetId && info.pubkey === pubkey) {
                oldLikeId = id;
                break;
            }
        }
        if (oldLikeId) {
            likeEventIndex.delete(oldLikeId);
            likers.delete(pubkey);
            if (pubkey === pk) {
                updateLikeUI(targetId, false);
            }
            syncLikeCountUI(targetId);
            updatePostScore(targetId);
            console.log('[Reactions] ✅ إلغاء إعجاب:', targetId, 'بواسطة', pubkey);
        }
        return;
    }

    // ✅ معالجة إعجاب جديد (content !== "unlike")
    // إذا كان هناك إعجاب سابق لنفس المستخدم، نتجاهل (لمنع التكرار)
    if (likers.has(pubkey)) {
        // قد يكون إعجاب مكرر، نتجاوزه
        return;
    }

    likers.set(pubkey, likeEventId);
    likeEventIndex.set(likeEventId, { postId: targetId, pubkey });

    if (pubkey === pk) {
        updateLikeUI(targetId, true);
    }
    syncLikeCountUI(targetId);
    updatePostScore(targetId);
    console.log('[Reactions] ✅ إعجاب جديد:', targetId, 'بواسطة', pubkey);
}

// ============================
// 17. دالة لجلب إعجابات بوست جديد
// ============================

function fetchLikesForNewPost(postId) {
    if (!postId) return;
    const sub = pool.subscribeMany(RELAYS, [
        { kinds: [7], '#e': [postId], limit: 100 }
    ], {
        onevent: (event) => {
            handleLikeEvent(event);
        },
        oneose: () => { try { sub.close(); } catch(e) {} }
    });
    setTimeout(() => { try { sub.close(); } catch(e) {} }, 5000);
}

// ============================
// 18. نظام الردود (بدون تغيير)
// ============================

let replyTarget = null;

function replyToPost(postId, postPubkey) {
    replyTarget = { postId, postPubkey, parentId: null };
    openReplyModal();
}

function replyToComment(postId, postPubkey, parentId) {
    replyTarget = { postId, postPubkey, parentId };
    openReplyModal();
}

function openReplyModal() {
    const modal = $('reply-modal');
    const input = $('reply-input');
    if (!modal || !input) return;
    input.value = '';
    modal.classList.remove('hidden');
    setTimeout(() => input.focus(), 50);
}

function closeReplyModal() {
    $('reply-modal')?.classList.add('hidden');
    replyTarget = null;
}

async function confirmReply() {
    if (!replyTarget) { showToast('لا يوجد رد مستهدف', 'error'); return; }
    if (!pk) { showToast('لا توجد هوية', 'error'); return; }

    const input = $('reply-input');
    const text = (input?.value || '').trim();
    if (!text) { showToast('اكتب رداً', 'error'); return; }

    const { postId, postPubkey, parentId } = replyTarget;
    const tags = [
        ['e', postId, '', 'root'],
        ['p', postPubkey]
    ];
    if (parentId) {
        tags.push(['e', parentId, '', 'reply']);
    } else {
        tags.push(['e', postId, '', 'reply']);
    }

    try {
        const event = await signEvent({
            kind: 1,
            created_at: Math.floor(Date.now() / 1000),
            tags,
            content: text
        });
        await pool.publish(RELAYS, event);
        closeReplyModal();
        showToast('تم إرسال الرد ✅', 'success');
        handleIncomingReply(event);
    } catch (error) {
        showToast('فشل الرد: ' + getErrorMessage(error), 'error');
    }
}

function handleIncomingReply(event) {
    const rootTag = event.tags.find(t => t[0] === 'e' && t[3] === 'root');
    const rootId = rootTag ? rootTag[1] : null;
    if (!rootId) {
        const firstE = event.tags.find(t => t[0] === 'e');
        if (firstE) {
            pendingRepliesMap.set(firstE[1], (pendingRepliesMap.get(firstE[1]) || []).concat(event));
            setTimeout(() => processPendingReplies(firstE[1]), 500);
        }
        return;
    }

    if (!pendingRepliesMap.has(rootId)) {
        pendingRepliesMap.set(rootId, []);
    }
    pendingRepliesMap.get(rootId).push(event);
    processPendingReplies(rootId);
}

function processPendingReplies(rootId) {
    const replies = pendingRepliesMap.get(rootId) || [];
    if (!replies.length) return;

    const container = document.querySelector(`.replies-container[data-replies="${CSS.escape(rootId)}"]`);
    if (!container) {
        setTimeout(() => processPendingReplies(rootId), 1000);
        return;
    }

    const rootPost = document.querySelector(`.post-card[data-post-id="${CSS.escape(rootId)}"]`);
    if (rootPost) {
        const countEl = rootPost.querySelector('.reply-count');
        if (countEl) {
            const current = parseInt(countEl.dataset.count) || 0;
            countEl.textContent = current + replies.length;
            countEl.dataset.count = current + replies.length;
        }
    }

    replies.sort((a, b) => a.created_at - b.created_at);
    for (const reply of replies) {
        renderReply(reply, container);
    }
    pendingRepliesMap.delete(rootId);

    container.querySelectorAll('.replies-container').forEach(subContainer => {
        const subRoot = subContainer.dataset.replies;
        if (subRoot && pendingRepliesMap.has(subRoot)) {
            processPendingReplies(subRoot);
        }
    });
}

function processAllPendingReplies() {
    for (const [rootId] of pendingRepliesMap) {
        processPendingReplies(rootId);
    }
}

function renderReply(event, container) {
    const time = new Date(event.created_at * 1000).toLocaleString('ar-EG', {
        hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short'
    });
    const displayName = getDisplayName(event.pubkey);
    const contentHtml = renderMediaContent(event.content);

    const div = document.createElement('div');
    div.className = 'reply-item bg-gray-50 dark:bg-gray-800/50 rounded-2xl p-4 border border-gray-100 dark:border-gray-700 fade-in';
    div.dataset.postId = event.id;
    div.dataset.pubkey = event.pubkey;

    div.innerHTML = `
        <div class="flex items-start gap-3">
            <div class="avatar-slot flex-shrink-0 cursor-pointer" onclick="openProfilePage('${event.pubkey}')">${avatarHtml(event.pubkey, 'w-9 h-9 text-sm')}</div>
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-bold text-sm dark:text-white truncate">${escapeHtml(displayName)}</span>
                    <span class="text-xs text-gray-400">${escapeHtml(time)}</span>
                </div>
                <div class="text-gray-700 dark:text-gray-300 text-sm leading-relaxed whitespace-pre-wrap break-words mt-1">${contentHtml}</div>
                <div class="flex items-center gap-3 mt-2 text-xs">
                    <button class="like-button flex items-center gap-1 hover:text-red-500 transition" onclick="likePost('${event.id}', '${event.pubkey}')" data-liked="false" data-postid="${event.id}">
                        <i class="far fa-heart"></i> <span>إعجاب</span> <span class="like-count" data-count="0">0</span>
                    </button>
                    <button class="text-gray-400 hover:text-accent transition" onclick="replyToComment('${event.id}', '${event.pubkey}', '${event.id}')">
                        <i class="far fa-comment"></i> رد
                    </button>
                </div>
                <div class="replies-container hidden mt-3 space-y-2" data-replies="${event.id}"></div>
            </div>
        </div>
    `;

    container.appendChild(div);
    fetchProfiles([event.pubkey]);
    addBanButtonToPost(div, event.pubkey);

    const nested = pendingRepliesMap.get(event.id);
    if (nested) {
        processPendingReplies(event.id);
    }
}

function toggleReplies(postId) {
    const container = document.querySelector(`.replies-container[data-replies="${CSS.escape(postId)}"]`);
    if (!container) return;
    const isHidden = container.classList.contains('hidden');
    container.classList.toggle('hidden');
    const icon = document.querySelector(`.post-card[data-post-id="${CSS.escape(postId)}"] .reply-toggle-icon`);
    if (icon) {
        icon.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
    }
}

// ============================
// ربط الدوال عالمياً
// ============================

window.likePost = likePost;
window.updateLikeUI = updateLikeUI;
window.syncLikeCountUI = syncLikeCountUI;
window.startReactionSubscription = startReactionSubscription;
window.fetchPastLikes = fetchPastLikes;
window.fetchLikesForNewPost = fetchLikesForNewPost;
window.handleLikeEvent = handleLikeEvent;
window.processPendingReplies = processPendingReplies;
window.processAllPendingReplies = processAllPendingReplies;
window.replyToPost = replyToPost;
window.replyToComment = replyToComment;
window.confirmReply = confirmReply;
window.closeReplyModal = closeReplyModal;
window.toggleReplies = toggleReplies;
