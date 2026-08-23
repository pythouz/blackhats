/* =========================================================
   Pulse — utils.js
   دوال مساعدة عامة
   ========================================================= */

// ============================
// 3. دوال مساعدة
// ============================

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

// ============================
// نشر حدث على الـ relays مع تأكيد فعلي
// ============================
// ⚠️ مهم جدًا: pool.publish(RELAYS, event) بيرجّع Array من الـ Promises
// (وعد واحد لكل relay)، مش Promise واحد. لو تعمل `await pool.publish(...)`
// مباشرة، الـ await بيتحقق فورًا على الـ Array نفسه (مش على محتواه)
// من غير ما يستنى أي رد فعلي من أي relay — يعني الكود بيكمل وكأن النشر
// نجح حتى لو كل الـ relays رفضوا الحدث فعليًا، وده كان بيسبب اختفاء
// المنشورات بعد الريفرش لإنها ما كانتش اتخزنت على أي relay من الأساس.
//
// ⚡ (تحسين الأداء) قبل كده كنا بنستخدم Promise.allSettled وده بيستنى
// الـ 4 relays الأربعة كلهم يردوا (سواء نجحوا أو فشلوا) قبل ما يسيب
// الكود يكمل. النتيجة إن أي حركة في التطبيق (نشر/لايك/رد/متابعة/حذف...)
// كانت بتاخد وقت أطول relay أبطأهم — وده كان السبب الرئيسي في إحساس
// إن المنصة كلها بطيئة. دلوقتي الدالة بترجع فور ما أول relay يقبل
// الحدث (زي أغلب تطبيقات Nostr)، والباقي بيكمل نشره في الخلفية.
// وبرضو فيه timeout أمان (10 ثواني) عشان لو relay اتعلق من غير ما
// يرد أو يفشل، التطبيق ميفضلش واقف له للأبد.
async function publishToRelays(event) {
    const pubs = pool.publish(RELAYS, event);
    if (!pubs || pubs.length === 0) throw new Error('لا يوجد relays متاحة');

    return new Promise((resolve, reject) => {
        let settledCount = 0;
        let done = false;
        const reasons = [];
        const total = pubs.length;

        const safetyTimer = setTimeout(() => {
            if (done) return;
            done = true;
            reject(new Error('لم يستجب أي relay في الوقت المناسب، حاول تاني'));
        }, 10000);

        pubs.forEach(p => {
            Promise.resolve(p).then(() => {
                settledCount++;
                if (done) return;
                done = true;
                clearTimeout(safetyTimer);
                resolve(settledCount);
            }).catch(err => {
                reasons.push((err?.message || err || '').toString());
                settledCount++;
                if (done) return;
                if (settledCount === total) {
                    done = true;
                    clearTimeout(safetyTimer);
                    reject(new Error(reasons.filter(Boolean).join(' | ') || 'لم يقبل أي relay هذا الحدث'));
                }
            });
        });
    });

}

// ============================
// 4. نظام التنبيهات (Toast)
// ============================

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
