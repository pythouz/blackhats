/* =========================================================
   Pulse — utils.js
   دوال مساعدة عامة
   ========================================================= */

function $(id) {
    return document.getElementById(id);
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function safeRoomName(name) {
    if (!name) return 'غرفة';
    return name.replace(/[^a-zA-Z0-9\u0600-\u06FF\-_ ]/g, '').trim().slice(0, 30) || 'غرفة';
}

function getErrorMessage(error) {
    if (typeof error === 'string') return error;
    if (error?.message) return error.message;
    return 'حدث خطأ غير معروف';
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function limitSet(set, max) {
    if (set.size > max) {
        const iter = set.values();
        while (set.size > max) {
            iter.next();
            set.delete(iter.next().value);
        }
    }
}

function limitMap(map, max) {
    if (map.size > max) {
        const iter = map.keys();
        while (map.size > max) {
            const key = iter.next().value;
            if (key !== undefined) map.delete(key);
        }
    }
}

function getDisplayName(pubkey) {
    const profile = profileCache.get(pubkey);
    if (profile?.name) return profile.name;
    if (pubkey) return pubkey.slice(0, 8) + '...';
    return 'مجهول';
}

function getTagValue(tags, key) {
    if (!tags) return null;
    for (const tag of tags) {
        if (tag[0] === key) return tag[1];
    }
    return null;
}

let toastTimeout = null;

function showToast(message, type = 'info') {
    const toast = $('toast');
    const msgEl = $('toast-msg');
    const iconEl = $('toast-icon');
    if (!toast || !msgEl || !iconEl) return;

    if (toastTimeout) {
        clearTimeout(toastTimeout);
        toastTimeout = null;
    }

    msgEl.textContent = message;

    const icons = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        info: 'fa-info-circle',
        warning: 'fa-exclamation-triangle'
    };
    const colors = {
        success: 'text-green-400 dark:text-green-600',
        error: 'text-red-400 dark:text-red-600',
        info: 'text-blue-400 dark:text-blue-600',
        warning: 'text-yellow-400 dark:text-yellow-600'
    };
    iconEl.className = `fas ${icons[type] || icons.info} ${colors[type] || colors.info}`;

    toast.classList.remove('hidden');
    toast.classList.add('flex');

    toastTimeout = setTimeout(() => {
        toast.classList.add('hidden');
        toast.classList.remove('flex');
        toastTimeout = null;
    }, 3000);
}
