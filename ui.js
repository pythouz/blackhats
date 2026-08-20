/* =========================================================
   Pulse — ui.js
   التنقل بين الصفحات، المظهر، ودوال واجهة إضافية
   ========================================================= */

// ============================
// 17. التنقل والمظهر
// ============================

function switchView(viewName) {
    document.querySelectorAll('.view-section').forEach(s => s.classList.add('hidden'));
    const target = $(`view-${viewName}`);
    if (target) target.classList.remove('hidden');
    document.querySelectorAll('.nav-btn').forEach(b => {
        b.classList.remove('text-accent', 'active');
        b.classList.add('text-gray-400');
    });
    const active = $(`nav-${viewName}`);
    if (active) {
        active.classList.add('text-accent', 'active');
        active.classList.remove('text-gray-400');
    }
    localStorage.setItem('pulse_view', viewName);
}

function toggleTheme() {
    document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
}

function toggleSettings() {
    const panel = $('settings-panel');
    if (panel) panel.classList.toggle('hidden');
}

// ============================
// 19. دوال الصور المفقودة
// ============================

function onAvatarSelected(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const error = validateImageFile(file);
    if (error) { showToast(error, 'error'); return; }
    revokePreview(pendingAvatarPreviewUrl);
    pendingAvatarFile = file;
    pendingAvatarPreviewUrl = URL.createObjectURL(file);
    renderProfileImages();
}

function onBannerSelected(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const error = validateImageFile(file);
    if (error) { showToast(error, 'error'); return; }
    revokePreview(pendingBannerPreviewUrl);
    pendingBannerFile = file;
    pendingBannerPreviewUrl = URL.createObjectURL(file);
    renderProfileImages();
}

function removeBanner() {
    revokePreview(pendingBannerPreviewUrl);
    pendingBannerPreviewUrl = null;
    pendingBannerFile = null;
    renderProfileImages();
}

// ============================
// 20. نظام الحظر — واجهة المستخدم (بدون إشعارات)
// ============================

/**
 * تُضاف زر الحظر/إلغاء الحظر إلى منطقة الأزرار (بجانب الإعجاب والتعليق)
 * يتم التحقق من أن المستخدم الحالي هو المدير قبل إضافة الزر.
 */
function addBanButtonToPost(postElement, postPubkey) {
    // التأكد من أن المتغيرات العامة معرفة وأن المستخدم هو المدير
    if (typeof ADMIN_PUBKEY === 'undefined' || !pk) return;
    
    // لا نضيف الزر إذا لم يكن المستخدم الحالي هو المدير أو كان المنشور لنفسه
    if (pk !== ADMIN_PUBKEY || pk === postPubkey) return;

    const actionsContainer = postElement.querySelector('.post-actions');
    if (!actionsContainer) return;

    if (actionsContainer.querySelector('.ban-button')) return;

    const isBanned = bannedPubkeys.has(postPubkey);
    const btn = document.createElement('button');
    btn.className = 'ban-button flex items-center gap-1 hover:text-red-500 dark:hover:text-red-400 transition text-sm';
    btn.innerHTML = `<i class="fas ${isBanned ? 'fa-user-check' : 'fa-user-slash'}"></i>`;
    btn.title = isBanned ? 'إلغاء حظر هذا المستخدم' : 'حظر هذا المستخدم';
    btn.onclick = (e) => {
        e.stopPropagation();
        toggleBanUser(postPubkey);
    };

    actionsContainer.appendChild(btn);
}

/**
 * تبديل حالة الحظر - بدون إشعارات نجاح، فقط أخطاء أساسية
 */
async function toggleBanUser(targetPubkey) {
    if (pk !== ADMIN_PUBKEY) {
        showToast('أنت لست مديراً', 'error');
        return;
    }
    if (!targetPubkey) {
        showToast('خطأ: لا يوجد مفتاح مستهدف', 'error');
        return;
    }
    if (targetPubkey === pk) {
        showToast('لا يمكن حظر نفسك', 'error');
        return;
    }

    const isBanned = bannedPubkeys.has(targetPubkey);
    const action = isBanned ? 'unban' : 'ban';
    const confirmMsg = isBanned
        ? `هل تريد إلغاء حظر المستخدم ${targetPubkey.slice(0,8)}...؟`
        : `هل تريد حظر المستخدم ${targetPubkey.slice(0,8)}...؟`;

    if (!confirm(confirmMsg)) return;

    try {
        const eventTemplate = {
            kind: BAN_EVENT_KIND,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['p', targetPubkey]],
            content: action,
        };
        const signed = await signEvent(eventTemplate);
        await Promise.all(RELAYS.map(url => pool.publish([url], signed)));
        processBanEvent(signed);
        if (typeof reorderFeed === 'function') reorderFeed();
    } catch (e) {
        console.error('[Moderation] فشل نشر حدث الحظر:', e);
        showToast('فشل نشر الحدث: ' + getErrorMessage(e), 'error');
    }
}

// ============================
// لوحة تحكم الأدمن
// ============================

let adminPanelOpen = false;

function openAdminPanel() {
    if (pk !== ADMIN_PUBKEY) {
        showToast('أنت لست مديراً', 'error');
        return;
    }
    let panel = document.getElementById('admin-panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'admin-panel';
        panel.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4';
        panel.innerHTML = `
            <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-lg w-full p-6 max-h-[80vh] overflow-y-auto">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-xl font-bold text-gray-900 dark:text-white">👮 لوحة التحكم - المحظورون</h2>
                    <button onclick="closeAdminPanel()" class="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                        <i class="fas fa-times text-xl"></i>
                    </button>
                </div>
                <div id="banned-list" class="space-y-2"></div>
                <div class="mt-4 text-sm text-gray-500 dark:text-gray-400">
                    عدد المحظورين: <span id="banned-count">0</span>
                </div>
            </div>
        `;
        document.body.appendChild(panel);
        panel.addEventListener('click', (e) => {
            if (e.target === panel) closeAdminPanel();
        });
    }
    renderBannedList();
    panel.classList.remove('hidden');
    adminPanelOpen = true;
}

function closeAdminPanel() {
    const panel = document.getElementById('admin-panel');
    if (panel) panel.classList.add('hidden');
    adminPanelOpen = false;
}

function renderBannedList() {
    const list = document.getElementById('banned-list');
    const countSpan = document.getElementById('banned-count');
    if (!list) return;
    const bannedArray = Array.from(bannedPubkeys);
    countSpan.textContent = bannedArray.length;

    if (bannedArray.length === 0) {
        list.innerHTML = '<p class="text-gray-500 dark:text-gray-400">لا يوجد مستخدمون محظورون</p>';
        return;
    }

    list.innerHTML = bannedArray.map(pubkey => `
        <div class="flex justify-between items-center p-2 bg-gray-100 dark:bg-gray-700 rounded-lg">
            <span class="text-sm font-mono break-all">${pubkey}</span>
            <button onclick="toggleBanUser('${pubkey}')" class="text-red-500 hover:text-red-700 text-sm px-3 py-1 rounded-full bg-red-50 dark:bg-red-900/30">
                <i class="fas fa-user-slash"></i> إلغاء الحظر
            </button>
        </div>
    `).join('');
}
