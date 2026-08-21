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
            // إلغاء الإعجاب: نرسل حدث حذف (kind 5)
            const deleteEvent = await signEvent({
                kind: 5,
                created_at: Math.floor(Date.now() / 1000),
                tags: [['e', existingLikeId]],
                content: ''
            });
            await pool.publish(RELAYS, deleteEvent);
            likers.delete(pk);
            likeEventIndex.delete(existingLikeId);
            stat.myLikeEventId = null;
            updatePostScore(postId);
            syncLikeCountUI(postId);
            updateLikeUI(postId, false);  // تحديث فوري للإلغاء
            showToast('تم إلغاء الإعجاب', 'success');
        } else {
            // إعجاب جديد
            const likeEvent = await signEvent({
                kind: 7,
                created_at: Math.floor(Date.now() / 1000),
                tags: [['e', postId], ['p', postPubkey]],
                content: ''
            });
            await pool.publish(RELAYS, likeEvent);
            likers.set(pk, likeEvent.id);
            likeEventIndex.set(likeEvent.id, { postId, pubkey: pk });
            stat.myLikeEventId = likeEvent.id;
            updatePostScore(postId);
            syncLikeCountUI(postId);
            updateLikeUI(postId, true);  // تحديث فوري للإعجاب
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
        // لا نغير النص، نغير فقط الأيقونة واللون
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
