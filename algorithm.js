/* =========================================================
   Pulse — algorithm.js
   خوارزمية ترتيب المنشورات (Edge-like scoring)
   ========================================================= */

// ============================
// 7. خوارزمية التوزين (Edge-like)
// ============================

function calculateScore(postId) {
    const stats = postStats.get(postId);
    if (!stats) return 0;
    const { likes, replies, createdAt } = stats;
    const now = Date.now() / 1000;
    const hours = Math.max(0.01, (now - createdAt) / 3600);
    return (likes * 1.5 + replies * 2.5) / Math.pow(hours + 2, 1.8);
}

function updatePostScore(postId) {
    const score = calculateScore(postId);
    postScores.set(postId, score);
    return score;
}

function reorderFeed() {
    const container = $('feed-container');
    if (!container) return;
    const cards = Array.from(container.querySelectorAll('.post-card'));
    if (cards.length < 2) return;
    cards.sort((a, b) => {
        const scoreA = postScores.get(a.dataset.postId) || 0;
        const scoreB = postScores.get(b.dataset.postId) || 0;
        return scoreB - scoreA;
    });
    const fragment = document.createDocumentFragment();
    cards.forEach(card => fragment.appendChild(card));
    container.appendChild(fragment);
}
