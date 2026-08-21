// ============================
// 14. اشتراك الإعجابات والردود (معدل ليشمل kind 5)
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

    console.log('[Reactions] بدء اشتراك الإعجابات والإلغاءات لـ', postIds.length, 'بوست');

    // جلب الإعجابات والإلغاءات السابقة
    fetchPastLikesAndDeletes(postIds);

    // الاشتراك في الأحداث الجديدة: kind 7 (إعجاب), kind 5 (حذف), kind 1 (ردود)
    reactionsSubscription = pool.subscribeMany(RELAYS, [
        { kinds: [7], '#e': postIds },
        { kinds: [5], '#e': postIds },   // <-- إضافة kind 5
        { kinds: [1], '#e': postIds }
    ], {
        onevent: (event) => {
            if (event.kind === 7) {
                handleLikeEvent(event);
            } else if (event.kind === 5) {
                handleDeleteEvent(event);   // معالجة أحداث الحذف
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
// 15. جلب الإعجابات والإلغاءات السابقة
// ============================

function fetchPastLikesAndDeletes(postIds) {
    if (!postIds.length) return;
    const batchSize = 50;
    for (let i = 0; i < postIds.length; i += batchSize) {
        const batch = postIds.slice(i, i + batchSize);
        // نطلب kind 7 و kind 5
        const sub = pool.subscribeMany(RELAYS, [
            { kinds: [7], '#e': batch, limit: 500 },
            { kinds: [5], '#e': batch, limit: 500 }
        ], {
            onevent: (event) => {
                if (event.kind === 7) {
                    handleLikeEvent(event);
                } else if (event.kind === 5) {
                    handleDeleteEvent(event);
                }
            },
            oneose: () => {
                try { sub.close(); } catch(e) {}
            }
        });
        setTimeout(() => { try { sub.close(); } catch(e) {} }, 5000);
    }
}

// ============================
// 16. معالجة حدث الحذف (kind 5) الخاص بالإعجابات
// ============================

function handleDeleteEvent(event) {
    // حدث الحذف قد يكون لحذف منشور أو حذف إعجاب
    // نتحقق إذا كان يستهدف حدث إعجاب (kind 7)
    const targetId = getTagValue(event.tags, 'e');
    if (!targetId) return;

    // نبحث في likeEventIndex عن هذا الـ targetId (وهو likeEventId)
    const info = likeEventIndex.get(targetId);
    if (!info) {
        // قد يكون حدث حذف لمنشور، نتجاوزه
        console.log('[Reactions] حدث حذف ليس لإعجاب:', targetId);
        return;
    }

    // حذف الإعجاب
    likeEventIndex.delete(targetId);
    const likers = postLikers.get(info.postId);
    if (likers) {
        likers.delete(info.pubkey);
        // تحديث الواجهة للمستخدم الحالي إذا كان هو صاحب الإعجاب المحذوف
        if (info.pubkey === pk) {
            updateLikeUI(info.postId, false);
        }
        syncLikeCountUI(info.postId);
        updatePostScore(info.postId);
    }
    console.log('[Reactions] تم إلغاء إعجاب:', info.postId, 'بواسطة', info.pubkey);
}

// ============================
// 17. معالجة حدث الإعجاب (kind 7) - (بدون تغيير كبير)
// ============================

function handleLikeEvent(event) {
    // نتأكد أنه ليس حدث حذف
    if (event.kind === 5) return;

    const targetId = getTagValue(event.tags, 'e');
    if (!targetId) return;
    const pubkey = event.pubkey;
    const likeEventId = event.id;

    if (!postStats.has(targetId)) {
        initPostState(targetId, event.created_at || Math.floor(Date.now()/1000));
    }

    if (!postLikers.has(targetId)) {
        postLikers.set(targetId, new Map());
    }
    const likers = postLikers.get(targetId);

    // إذا كان هناك إعجاب سابق لنفس المستخدم، نتجاهل (لتجنب التكرار)
    if (likers.has(pubkey)) {
        const oldLikeId = likers.get(pubkey);
        if (oldLikeId !== likeEventId) {
            // نستبدل القديم بالجديد
            likeEventIndex.delete(oldLikeId);
            likers.set(pubkey, likeEventId);
            likeEventIndex.set(likeEventId, { postId: targetId, pubkey });
        }
        if (pubkey === pk) {
            updateLikeUI(targetId, true);
        }
        syncLikeCountUI(targetId);
        updatePostScore(targetId);
        return;
    }

    // إعجاب جديد
    likers.set(pubkey, likeEventId);
    likeEventIndex.set(likeEventId, { postId: targetId, pubkey });

    if (pubkey === pk) {
        updateLikeUI(targetId, true);
    }
    syncLikeCountUI(targetId);
    updatePostScore(targetId);
    console.log('[Reactions] إعجاب جديد:', targetId, 'بواسطة', pubkey);
}

// ============================
// دوال updateLikeUI و syncLikeCountUI (بدون تغيير)
// ============================

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
// دالة مساعدة لجلب الإعجابات لبوست جديد (تُستدعى من renderPost)
// ============================

function fetchLikesForNewPost(postId) {
    if (!postId) return;
    const sub = pool.subscribeMany(RELAYS, [
        { kinds: [7], '#e': [postId], limit: 100 },
        { kinds: [5], '#e': [postId], limit: 100 }
    ], {
        onevent: (event) => {
            if (event.kind === 7) {
                handleLikeEvent(event);
            } else if (event.kind === 5) {
                handleDeleteEvent(event);
            }
        },
        oneose: () => { try { sub.close(); } catch(e) {} }
    });
    setTimeout(() => { try { sub.close(); } catch(e) {} }, 5000);
}
