/* =========================================================
   Pulse — utils.js
   دوال مساعدة عامة + نظام الـ Toast للإشعارات
   ========================================================= */

// ============================
// 3. أدوات مساعدة
// ============================

const $ = id => document.getElementById(id);

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text ?? '';
    return div.innerHTML;
}

function safeRoomName(name) {
    return String(name || '').trim().toLowerCase().replace(/\s+/g, '-').slice(0, 80);
}

function getErrorMessage(error) {
    if (!error) return 'خطأ غير معروف';
    if (typeof error === 'string') return error;
    return error.message || error.type || 'خطأ غير معروف';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function limitSet(set, max) {
    if (set.size <= max) return;
    const arr = Array.from(set);
    for (let i = 0; i < set.size - max; i++) set.delete(arr[i]);
}

function limitMap(map, max) {
    if (map.size <= max) return;
    const keys = Array.from(map.keys());
    for (let i = 0; i < map.size - max; i++) {
        const el = map.get(keys[i]);
        if (el?.remove) el.remove();
        map.delete(keys[i]);
    }
}

function getDisplayName(pubkey) {
    const cached = profileCache.get(pubkey);
    if (cached?.name) return cached.name.slice(0, 24);
    return pubkey.slice(0, 8) + '...';
}

// ============================
// 4. Toast
// ============================

function showToast(message, type = 'success') {
    const toast = $('toast');
    const icon = $('toast-icon');
    const msg = $('toast-msg');
    if (!toast || !icon || !msg) { console.log('[Toast]', message); return; }

    msg.textContent = message;
    icon.className = type === 'error' ? 'fas fa-exclamation-circle text-red-400' :
                     type === 'info'  ? 'fas fa-info-circle text-blue-400' :
                                        'fas fa-check-circle text-green-400';

    toast.classList.remove('hidden');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.add('hidden'), 3500);
}
