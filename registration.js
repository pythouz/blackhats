/* =========================================================
   Pulse — registration.js
   نظام التسجيل بموافقة الإدارة (Approval-based Registration)
   ========================================================= */

// ============================
// دوال التشفير للمدير (موجودة في auth.js)
// ============================

// ============================
// نظام البوابة (Access Gate) — تم تحديثه ليعمل مع auth.js
// ============================

async function initAccessControl() {
    if (!pk) return true;
    const adminHex = window.ADMIN_PUBKEY_HEX;
    if (pk === adminHex) {
        myAccessStatus = 'approved';
        return true;
    }

    loadApprovedCache();
    if (approvedPubkeys.has(pk)) {
        myAccessStatus = 'approved';
        return true;
    }

    await loadApprovalList();
    if (approvedPubkeys.has(pk)) {
        myAccessStatus = 'approved';
        return true;
    }

    // لم يتم الموافقة بعد → نعرض حالة "قيد المراجعة" أو "غير مسجل"
    if (myAccessStatus === 'not_registered') {
        // إذا لم يرسل الطلب بعد، نفتح بوابة التسجيل مجدداً
        showAuthGate();
        return false;
    }

    // إذا أرسل الطلب سابقاً وننتظر الموافقة
    showPendingApproval();
    return false;
}

function showPendingApproval() {
    let gate = document.getElementById('pending-approval');
    if (!gate) {
        gate = document.createElement('div');
        gate.id = 'pending-approval';
        gate.className = 'fixed inset-0 z-[150] bg-black/50 flex items-center justify-center p-4';
        document.body.appendChild(gate);
    }
    gate.innerHTML = `
        <div class="bg-white dark:bg-surface rounded-3xl shadow-2xl max-w-md w-full p-6 text-center">
            <i class="fas fa-clock text-5xl text-yellow-500 mb-4"></i>
            <h3 class="text-xl font-bold dark:text-white mb-2">طلبك قيد المراجعة</h3>
            <p class="text-sm text-gray-500 dark:text-gray-400 mb-6">تم استلام طلب التسجيل الخاص بك. سيتم إعلامك عند الموافقة.</p>
            <button onclick="resubmitRegistration()" class="text-accent hover:underline text-sm">إعادة إرسال الطلب</button>
        </div>
    `;
}

function hidePendingApproval() {
    document.getElementById('pending-approval')?.remove();
}

function resubmitRegistration() {
    myAccessStatus = 'not_registered';
    hidePendingApproval();
    showAuthGate();
    // نحول لتبويب التسجيل
    switchAuthTab('register');
}

// ============================
// تحميل قائمة الموافقات (للمستخدم العادي)
// ============================

const APPROVED_CACHE_KEY = 'pulse_approved_cache';

function loadApprovedCache() {
    try {
        const raw = localStorage.getItem(APPROVED_CACHE_KEY);
        if (!raw) return;
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
            arr.forEach(pubkey => approvedPubkeys.add(pubkey));
            console.log('[Registration] تحميل قائمة الموافقات من الكاش:', approvedPubkeys.size);
        }
    } catch(e) { console.warn('[Registration] فشل تحميل كاش الموافقات:', e); }
}

function saveApprovedCache() {
    try {
        localStorage.setItem(APPROVED_CACHE_KEY, JSON.stringify(Array.from(approvedPubkeys)));
    } catch(e) { console.warn('[Registration] فشل حفظ كاش الموافقات:', e); }
}

function loadApprovalList() {
    return new Promise((resolve) => {
        const adminHex = window.ADMIN_PUBKEY_HEX;
        if (!adminHex) { resolve(); return; }
        const events = [];
        const sub = pool.subscribeMany(RELAYS, [{ kinds: [APPROVE_EVENT_KIND], authors: [adminHex] }], {
            onevent: (ev) => { events.push(ev); },
            oneose: () => {
                if (events.length) {
                    events.sort((a, b) => a.created_at - b.created_at);
                    for (const ev of events) {
                        const target = ev.tags.find(t => t[0] === 'p')?.[1];
                        if (!target) continue;
                        if (ev.content === 'approve') approvedPubkeys.add(target);
                        else if (ev.content === 'revoke') approvedPubkeys.delete(target);
                    }
                    saveApprovedCache();
                }
                resolve();
            },
            onclose: () => { resolve(); }
        });
        setTimeout(() => { try { sub.close(); } catch(e) {} resolve(); }, 8000);
    });
}

function subscribeToApprovalEvents() {
    const adminHex = window.ADMIN_PUBKEY_HEX;
    if (!adminHex) return;
    pool.subscribeMany(RELAYS, [{ kinds: [APPROVE_EVENT_KIND], authors: [adminHex] }], {
        onevent: (ev) => {
            const target = ev.tags.find(t => t[0] === 'p')?.[1];
            if (!target) return;
            if (ev.content === 'approve') {
                approvedPubkeys.add(target);
                if (target === pk && myAccessStatus !== 'approved') {
                    myAccessStatus = 'approved';
                    saveApprovedCache();
                    hidePendingApproval();
                    hideAuthGate();
                    unlockApp();
                }
            } else if (ev.content === 'revoke') {
                approvedPubkeys.delete(target);
                if (target === pk) {
                    myAccessStatus = 'not_registered';
                    saveApprovedCache();
                    showAuthGate();
                }
            }
            saveApprovedCache();
        },
        oneose: () => { setTimeout(subscribeToApprovalEvents, 5000); }
    });
}

// ============================
// دوال المدير: طلبات التسجيل
// ============================

function loadPendingRegistrationsForAdmin() {
    const adminHex = window.ADMIN_PUBKEY_HEX;
    if (!adminHex || pk !== adminHex) return;
    pool.subscribeMany(RELAYS, [{ kinds: [REGISTER_EVENT_KIND], '#p': [adminHex] }], {
        onevent: async (ev) => {
            await processRegistrationEvent(ev);
        }
    });
}

function subscribeToRegistrationEvents() {
    const adminHex = window.ADMIN_PUBKEY_HEX;
    if (!adminHex || pk !== adminHex) return;
    pool.subscribeMany(RELAYS, [{ kinds: [REGISTER_EVENT_KIND], '#p': [adminHex] }], {
        onevent: async (ev) => {
            await processRegistrationEvent(ev);
        },
        oneose: () => { setTimeout(subscribeToRegistrationEvents, 5000); }
    });
}

async function processRegistrationEvent(event) {
    if (pendingRegistrations.has(event.pubkey)) return;
    let plaintext;
    try {
        plaintext = await decryptFromUser(event.content, event.pubkey);
    } catch(e) {
        console.warn('[Registration] فشل فك تشفير طلب:', e);
        return;
    }
    let data;
    try { data = JSON.parse(plaintext); } catch(e) { return; }
    if (!data.email || !data.phone || !data.name) return;
    pendingRegistrations.set(event.pubkey, {
        name: data.name,
        email: data.email,
        phone: data.phone,
        created_at: data.created_at || event.created_at,
        eventId: event.id
    });
    // 🔇 إزالة الإشعار المزعج
    // showToast('📥 وصل طلب تسجيل جديد', 'info');
    if (adminPanelOpen) renderPendingRegistrationsPanel();
}

function renderPendingRegistrationsPanel() {
    const list = document.getElementById('registrations-list');
    const badge = document.getElementById('registrations-count-badge');
    if (!list) return;

    const entries = Array.from(pendingRegistrations.entries());
    badge.textContent = entries.length;

    if (entries.length === 0) {
        list.innerHTML = '<p class="text-gray-500 dark:text-gray-400">لا توجد طلبات تسجيل معلقة</p>';
        return;
    }

    list.innerHTML = entries.map(([pubkey, data]) => `
        <div class="flex flex-col gap-1 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl border border-gray-200 dark:border-gray-600">
            <div class="flex justify-between items-start">
                <div class="text-right">
                    <p class="font-medium dark:text-white">${escapeHtml(data.name)}</p>
                    <p class="text-sm text-gray-600 dark:text-gray-300">${escapeHtml(data.email)}</p>
                    <p class="text-xs text-gray-500 dark:text-gray-400">📱 ${escapeHtml(data.phone)}</p>
                    <p class="text-[10px] text-gray-400 font-mono break-all">${pubkey.slice(0,12)}...</p>
                    <p class="text-[10px] text-gray-400">🕒 ${new Date(data.created_at*1000).toLocaleString('ar-EG')}</p>
                </div>
                <div class="flex gap-2">
                    <button onclick="approveUser('${pubkey}')" class="bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded-full text-xs font-bold transition">
                        موافقة
                    </button>
                    <button onclick="dismissRegistration('${pubkey}')" class="bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500 text-gray-800 dark:text-white px-3 py-1 rounded-full text-xs transition">
                        تجاهل
                    </button>
                </div>
            </div>
        </div>
    `).join('');
}

async function approveUser(pubkey) {
    const adminHex = window.ADMIN_PUBKEY_HEX;
    if (pk !== adminHex) return;
    if (!pubkey) return;
    try {
        const ev = await signEvent({
            kind: APPROVE_EVENT_KIND,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['p', pubkey]],
            content: 'approve'
        });
        await publishToRelays(ev);
        approvedPubkeys.add(pubkey);
        saveApprovedCache();
        pendingRegistrations.delete(pubkey);
        renderPendingRegistrationsPanel();
        showToast('✅ تمت الموافقة على العضو', 'success');
    } catch(e) {
        showToast('فشل: ' + e.message, 'error');
    }
}

async function revokeUser(pubkey) {
    const adminHex = window.ADMIN_PUBKEY_HEX;
    if (pk !== adminHex) return;
    if (!pubkey) return;
    if (!confirm(`هل تريد سحب عضوية المستخدم ${pubkey.slice(0,8)}...؟`)) return;
    try {
        const ev = await signEvent({
            kind: APPROVE_EVENT_KIND,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['p', pubkey]],
            content: 'revoke'
        });
        await publishToRelays(ev);
        approvedPubkeys.delete(pubkey);
        saveApprovedCache();
        showToast('تم سحب العضوية', 'success');
    } catch(e) {
        showToast('فشل: ' + e.message, 'error');
    }
}

function dismissRegistration(pubkey) {
    if (!confirm('تجاهل هذا الطلب؟ لن يتم حذفه من السيرفر، فقط من قائمتك المحلية.')) return;
    pendingRegistrations.delete(pubkey);
    renderPendingRegistrationsPanel();
}
