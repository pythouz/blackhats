/* =========================================================
   Pulse — reactions.js
   الإعجابات والردود (بما فيها الردود المتداخلة)
   ========================================================= */

// ============================
// 13. الإعجابات والردود
// ============================

function getReactionStats(postId) {
    const card = getPostCard(postId);
    if (!card) return null;
    return {
        card,
        likeButton: card.querySelector('.like-button'),
        likeCount: card.querySelector('.like-count'),
        replyCount: card.querySelector('.reply-count')
    };
}

function toggleReplies(postId) {
    const card = getPostCard(postId);
    if (!card) return;
    const container = card.querySelector(`[data-replies="${CSS.escape(postId)}"]`);
    const toggleBtn = card.querySelector('.reply-toggle-button');
    const icon = toggleBtn?.querySelector('.reply-toggle-icon');
    if (!container) return;
    const willShow = container.classList.contains('hidden');
    container.classList.toggle('hidden');
    if (icon) icon.classList.toggle('rotate-180', willShow);
}

function updateLikeUI(postId, liked) {
    const stats = getReactionStats(postId);
    if (!stats) return;
    stats.likeButton.dataset.liked = liked ? 'true' : 'false';
    const icon = stats.likeButton.querySelector('i');
    if (liked) {
        stats.likeButton.classList.add('text-red-500', 'font-bold');
        if (icon) icon.className = 'fas fa-heart text-red-500';
    } else {
        stats.likeButton.classList.remove('text-red-500', 'font-bold');
        if (icon) icon.className = 'far fa-heart';
    }
}

function syncLikeCountUI(postId) {
    const stats = getReactionStats(postId);
    const likers = postLikers.get(postId);
    const postStat = postStats.get(postId);
    if (!likers || !postStat) return;
    postStat.likes = likers.size;
    if (stats?.likeCount) {
        stats.likeCount.dataset.count = String(postStat.likes);
        stats.likeCount.textContent = String(postStat.likes);
    }
}

async function likePost(targetId, targetPubkey) {
    const stats = getReactionStats(targetId);
    if (!stats) { showToast('تعذر العثور على المنشور', 'error'); return; }
    const postStat = postStats.get(targetId);
    if (!postStat) return;
    let likers = postLikers.get(targetId);
    if (!likers) { likers = new Map(); postLikers.set(targetId, likers); }

    if (stats.likeButton.dataset.liked === 'true') {
        if (postStat.myLikeEventId) {
            try {
                const deleteEvent = await signEvent({ kind: 5, created_at: Math.floor(Date.now() / 1000), tags: [['e', postStat.myLikeEventId]], content: '' });
                await pool.publish(RELAYS, deleteEvent);
                likeEventIndex.delete(postStat.myLikeEventId);
                likers.delete(pk);
                postStat.myLikeEventId = null;
                updatePostScore(targetId);
                updateLikeUI(targetId, false);
                syncLikeCountUI(targetId);
                showToast('تم إلغاء الإعجاب', 'info');
            } catch (error) {
                showToast('فشل إلغاء الإعجاب: ' + getErrorMessage(error), 'error');
            }
        }
        return;
    }

    if (likers.has(pk)) { updateLikeUI(targetId, true); syncLikeCountUI(targetId); return; }

    try {
        const likeEvent = await signEvent({ kind: 7, created_at: Math.floor(Date.now() / 1000), tags: [['e', targetId], ['p', targetPubkey]], content: '+' });
        await pool.publish(RELAYS, likeEvent);
        likers.set(pk, likeEvent.id);
        likeEventIndex.set(likeEvent.id, { postId: targetId, pubkey: pk });
        postStat.myLikeEventId = likeEvent.id;
        updatePostScore(targetId);
        updateLikeUI(targetId, true);
        syncLikeCountUI(targetId);
        stats.likeButton.classList.add('scale-110');
        setTimeout(() => stats.likeButton.classList.remove('scale-110'), 180);
        showToast('تم الإعجاب ❤️', 'success');
    } catch (error) {
        showToast('فشل الإعجاب: ' + getErrorMessage(error), 'error');
    }
}

function startReactionSubscription() {
    const postIds = Array.from(renderedPosts.keys());
    if (!postIds.length) return;
    if (reactionsSubscription) try { reactionsSubscription.close(); } catch(e) {}
    try {
        reactionsSubscription = pool.subscribeMany(RELAYS, [{ kinds: [7, 1, 5], '#e': postIds, limit: 500 }], {
            onevent: event => {
                if (!event?.id) return;
                // فلتر الحظر للتفاعلات
                if (bannedPubkeys.has(event.pubkey)) return;
                if (event.kind === 7) handleIncomingLike(event);
                if (event.kind === 1) handleIncomingReply(event);
                if (event.kind === 5) handleDeleteEvent(event);
            },
            oneose: () => console.log('[Reactions] تم التحميل')
        });
    } catch(e) { console.error('[Reactions] خطأ:', e); }
}

function handleIncomingLike(event) {
    if (seenEvents.has(event.id)) return;
    seenEvents.add(event.id);
    limitSet(seenEvents, MAX_SEEN_EVENTS);
    if (tombstonedEvents.has(event.id)) return;

    const targetId = getTagValue(event.tags, 'e');
    if (!targetId) return;
    const postStat = postStats.get(targetId);
    if (!postStat) return;

    let likers = postLikers.get(targetId);
    if (!likers) { likers = new Map(); postLikers.set(targetId, likers); }
    if (likers.has(event.pubkey)) return;

    likers.set(event.pubkey, event.id);
    likeEventIndex.set(event.id, { postId: targetId, pubkey: event.pubkey });
    if (event.pubkey === pk) postStat.myLikeEventId = event.id;

    updatePostScore(targetId);
    syncLikeCountUI(targetId);
    if (event.pubkey === pk) updateLikeUI(targetId, true);
}

function getTagValue(tags, name) {
    if (!Array.isArray(tags)) return null;
    const tag = tags.find(t => t[0] === name);
    return tag ? tag[1] : null;
}

function getReplyTargets(tags) {
    if (!Array.isArray(tags)) return { rootId: null, parentId: null };
    const eTags = tags.filter(t => t[0] === 'e' && t[1]);
    if (!eTags.length) return { rootId: null, parentId: null };
    const rootTag = eTags.find(t => t[3] === 'root');
    const replyTag = eTags.find(t => t[3] === 'reply');
    if (rootTag) {
        return { rootId: rootTag[1], parentId: replyTag ? replyTag[1] : rootTag[1] };
    }
    return { rootId: eTags[0][1], parentId: eTags[0][1] };
}

// ===== معالجة الردود المعلقة =====

function processAllPendingReplies() {
    const keys = Array.from(pendingRepliesMap.keys());
    for (const rootId of keys) {
        processPendingReplies(rootId);
    }
}

function processPendingReplies(postId) {
    if (!pendingRepliesMap.has(postId)) return;
    // بنعمل تمرير متكرر (fixed-point loop) لحد ما تفضل مفيش أي تقدّم.
    // ده مهم لأن ترتيب وصول الأحداث بعد الريفرش مش مضمون يبقى ترتيب زمني
    // (الردود الأحدث ممكن توصل قبل الرد الأب بتاعها)، فالتمرير الواحد
    // القديم كان بيسيب ردود متداخلة عالقة، وبالتالي بتقع على الروت (attemptRenderReply
    // كانت بتعمل fallback غلط). دلوقتي بنكرر لحد ما كل حاجة ممكنة تتحل.
    let progress = true;
    while (progress) {
        progress = false;
        const replies = pendingRepliesMap.get(postId);
        if (!replies || !replies.length) break;
        for (let i = replies.length - 1; i >= 0; i--) {
            const event = replies[i];
            const { rootId, parentId } = getReplyTargets(event.tags);
            if (attemptRenderReply(event, rootId, parentId)) {
                replies.splice(i, 1);
                progress = true;
            }
        }
    }
    if (pendingRepliesMap.get(postId)?.length === 0) pendingRepliesMap.delete(postId);
}

function attemptRenderReply(event, rootId, parentId) {
    const rootCard = getPostCard(rootId);
    if (!rootCard) return false;

    let container = null;
    if (parentId && parentId !== rootId) {
        // ده رد على تعليق (نستد) — لازم نلاقي التعليق الأب في الـ DOM فعلاً.
        // قبل كده لو الأب لسه معملوش render (شائع بعد الريفرش لأن الردود
        // الأحدث بتوصل الأول)، كان الكود بيعمل fallback ويحط الرد كتعليق
        // منفصل تحت البوست مباشرة — وده سبب المشكلة اللي بتحصل بعد الريفرش.
        // دلوقتي: لو الأب مش موجود لسه، منرجعش container فاضي، نستنى ونحاول
        // تاني (الرد بيفضل pending لحد ما الأب يتعمله render).
        const parentElement = document.querySelector(`[data-reply-id="${CSS.escape(parentId)}"]`);
        if (!parentElement) return false;
        container = parentElement.querySelector('.nested-replies');
        if (!container) {
            container = document.createElement('div');
            container.className = 'nested-replies mt-2 space-y-2 mr-4 border-r-2 border-accent/20 pr-3';
            parentElement.appendChild(container);
        }
    } else {
        container = rootCard.querySelector(`[data-replies="${CSS.escape(rootId)}"]`);
    }
    if (!container) return false;

    if (document.querySelector(`[data-reply-id="${CSS.escape(event.id)}"]`)) return true;

    const reply = document.createElement('div');
    reply.dataset.replyId = event.id;
    reply.className = 'bg-gray-50 dark:bg-gray-800/50 rounded-xl p-3 text-sm border-r-2 border-accent/30 mr-2';
    reply.innerHTML = `
        <div class="flex items-center gap-2 mb-1">
            <div class="avatar-slot">${avatarHtml(event.pubkey, 'w-6 h-6 text-xs')}</div>
            <span class="text-xs font-bold text-gray-700 dark:text-gray-300">${escapeHtml(getDisplayName(event.pubkey))}</span>
        </div>
        <div class="text-gray-700 dark:text-gray-200 mr-2">${escapeHtml(event.content)}</div>
        <button onclick="replyToComment('${event.id}', '${rootId}', '${event.pubkey}')" class="text-xs text-accent hover:underline mt-1 mr-2"><i class="fas fa-reply"></i> رد</button>
    `;
    container.appendChild(reply);
    fetchProfiles([event.pubkey]);

    const stats = getReactionStats(rootId);
    if (stats) {
        const current = Number(stats.replyCount.dataset.count || 0);
        stats.replyCount.dataset.count = String(current + 1);
        stats.replyCount.textContent = String(current + 1);
        const postStat = postStats.get(rootId);
        if (postStat) postStat.replies += 1;
        updatePostScore(rootId);
    }

    if (event.pubkey === pk) {
        const topContainer = rootCard.querySelector(`[data-replies="${CSS.escape(rootId)}"]`);
        const toggleIcon = rootCard.querySelector('.reply-toggle-button .reply-toggle-icon');
        if (topContainer?.classList.contains('hidden')) {
            topContainer.classList.remove('hidden');
            toggleIcon?.classList.add('rotate-180');
        }
    }

    reorderFeed();
    return true;
}

function handleIncomingReply(event) {
    const { rootId, parentId } = getReplyTargets(event.tags);
    if (!rootId) return;

    if (!pendingRepliesMap.has(rootId)) pendingRepliesMap.set(rootId, []);
    const existing = pendingRepliesMap.get(rootId).some(e => e.id === event.id);
    if (!existing) {
        pendingRepliesMap.get(rootId).push(event);
    }

    // نجرب نعالج كل الـ queue بتاع نفس الروت (مش بس الحدث ده لوحده) —
    // كده لو الرد ده كان هو الحلقة الناقصة (parent) لردود تانية كانت
    // عالقة قبل كده، هيتحلوا كلهم في نفس اللحظة بدل ما يفضلوا معلقين
    // لحد أول عملية refresh/processAllPendingReplies تانية.
    processPendingReplies(rootId);
}

// ============================
// 14. الردود المتداخلة (Reply to Comment)
// ============================

let pendingReply = null;

async function replyToComment(replyToId, rootPostId, targetPubkey) {
    const modal = $('reply-modal');
    const textarea = $('reply-input');
    if (modal && textarea) {
        pendingReply = { targetId: replyToId, rootId: rootPostId, targetPubkey, isCommentReply: true };
        textarea.value = '';
        modal.classList.remove('hidden');
        setTimeout(() => textarea.focus(), 50);
        return;
    }
    const content = prompt('اكتب ردك على هذا التعليق:');
    if (!content?.trim()) return;
    await sendReplyWithRoot(replyToId, targetPubkey, content.trim(), rootPostId);
}

async function confirmReply() {
    if (!pendingReply) return;
    const textarea = $('reply-input');
    const content = (textarea?.value || '').trim();
    if (!content) { showToast('اكتب ردًا', 'error'); return; }
    const { targetId, targetPubkey, rootId, isCommentReply } = pendingReply;
    closeReplyModal();
    if (isCommentReply) {
        await sendReplyWithRoot(targetId, targetPubkey, content, rootId);
    } else {
        await sendReply(targetId, targetPubkey, content);
    }
}

async function sendReplyWithRoot(replyToId, targetPubkey, content, rootId) {
    try {
        const event = await signEvent({
            kind: 1,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
                ['e', replyToId, '', 'reply'],
                ['e', rootId, '', 'root'],
                ['p', targetPubkey],
                ['t', APP_TAG]
            ],
            content
        });
        handleIncomingReply(event);
        await pool.publish(RELAYS, event);
        showToast('تم إرسال الرد', 'success');
    } catch (error) {
        showToast('فشل إرسال الرد: ' + getErrorMessage(error), 'error');
    }
}

async function sendReply(targetId, targetPubkey, content) {
    try {
        const event = await signEvent({
            kind: 1,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['e', targetId, '', 'reply'], ['p', targetPubkey], ['t', APP_TAG]],
            content
        });
        handleIncomingReply(event);
        await pool.publish(RELAYS, event);
        showToast('تم إرسال الرد', 'success');
    } catch (error) {
        showToast('فشل إرسال الرد: ' + getErrorMessage(error), 'error');
    }
}

async function replyToPost(targetId, targetPubkey) {
    const modal = $('reply-modal');
    const textarea = $('reply-input');
    if (modal && textarea) {
        pendingReply = { targetId, targetPubkey, rootId: targetId, isCommentReply: false };
        textarea.value = '';
        modal.classList.remove('hidden');
        setTimeout(() => textarea.focus(), 50);
        return;
    }
    const content = prompt('اكتب ردك:');
    if (!content?.trim()) return;
    await sendReply(targetId, targetPubkey, content.trim());
}

function closeReplyModal() {
    $('reply-modal')?.classList.add('hidden');
    pendingReply = null;
}
