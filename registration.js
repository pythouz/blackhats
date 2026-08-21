/* =========================================================
   Pulse — registration.js
   نظام التسجيل بموافقة الإدارة (Approval-based Registration)
   ========================================================= */

// ============================
// دوال التشفير للمدير
// ============================

async function encryptToAdmin(plaintext) {
    const adminHex = window.ADMIN_PUBKEY_HEX;
    if (!adminHex) throw new Error('المفتاح العام للمدير غير موجود');
    if (usingNip07 && window.nostr?.nip04?.encrypt) {
        return await window.nostr.nip04.encrypt(adminHex, plaintext);
    }
    if (!secretKeyHex) throw new Error('لا يوجد مفتاح خاص للتشفير');
    return await NostrTools.nip04.encrypt(secretKeyHex, adminHex, plaintext);
}

async function decryptFromUser(ciphertext, userPubkey) {
    if (usingNip07 && window.nostr?.nip04?.decrypt) {
        return await window.nostr.nip04.decrypt(userPubkey, ciphertext);
    }
    if (!secretKeyHex) throw new Error('لا يوجد مفتاح خاص لفك التشفير');
    return await NostrTools.nip04.decrypt(secretKeyHex, userPubkey, ciphertext);
}

// ============================
// نظام البوابة (Access Gate)
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

    renderAccessGate();
    return false;
}

function renderAccessGate() {
    let gate = document.getElementById('access-gate');
    if (!gate) {
        gate = document.createElement('div');
        gate.id = 'access-gate';
        gate.className = 'fixed inset-0 z-[200] bg-white dark:bg-dark flex items-center justify-center p-4';
        gate.style.background = 'rgba(0,0,0,0.85)';
        gate.style.backdropFilter = 'blur(10px)';
        document.body.appendChild(gate);
    }
    gate.innerHTML = `
        <div class="bg-white dark:bg-surface rounded-3xl shadow-2xl max-w-md w-full p-6 border border-gray-200 dark:border-gray-700 text-center">
            <h2 class="text-3xl font-black gradient-text mb-2">Pulse</h2>
            <p class="text-gray-500 dark:text-gray-400 text-sm mb-6">منصة المجتمع الحي اللامركزية</p>
            <div id="gate-content">
                <!-- سيتم ملؤه حسب الحالة -->
            </div>
        </div>
    `;
    updateGateContent();
}

function updateGateContent() {
    const content = document.getElementById('gate-content');
    if (!content) return;

    if (myAccessStatus === 'pending') {
        content.innerHTML = `
            <div class="py-6">
                <i class="fas fa-clock text-4xl text-yellow-500 mb-4"></i>
                <h3 class="text-xl font-bold dark:text-white">طلبك قيد المراجعة</h3>
                <p class="text-sm text-gray-500 dark:text-gray-400 mt-2">تم استلام طلب التسجيل الخاص بك. سيتم إعلامك عند الموافقة.</p>
                <button onclick="resubmitRegistration()" class="mt-4 text-accent hover:underline text-sm">إعادة إرسال الطلب</button>
            </div>
        `;
        return;
    }

    if (myAccessStatus === 'not_registered' || myAccessStatus === 'checking') {
        content.innerHTML = `
            <div class="text-right">
                <h3 class="text-lg font-bold dark:text-white mb-4">تسجيل عضوية جديدة</h3>
                <p class="text-xs text-gray-400 mb-4">أدخل بياناتك لطلب الانضمام إلى المنصة. سيتم مراجعة طلبك من قبل الإدارة.</p>
                <div class="space-y-3">
                    <input id="reg-email" type="email" placeholder="البريد الإلكتروني" 
                           class="w-full px-4 py-3 rounded-2xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 outline-none focus:border-accent dark:text-white text-sm">
                    <input id="reg-phone" type="tel" placeholder="رقم الهاتف" 
                           class="w-full px-4 py-3 rounded-2xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 outline-none focus:border-accent dark:text-white text-sm">
                    <button onclick="submitRegistration()" 
                            class="w-full bg-gradient-to-r from-accent to-accent2 text-white font-bold py-3 rounded-2xl hover:opacity-90 transition">
                        <i class="fas fa-paper-plane ml-2"></i> إرسال الطلب
                    </button>
                </div>
            </div>
        `;
    }
}

function hideAccessGate() {
    const gate = document.getElementById('access-gate');
    if (gate) gate.remove();
}

async function submitRegistration() {
    const email = document.getElementById('reg-email')?.value.trim();
    const phone = document.getElementById('reg-phone')?.value.trim();
    if (!email || !phone) { showToast('يرجى ملء جميع الحقول', 'error'); return; }
    if (!email.includes('@')) { showToast('بريد إلكتروني غير صحيح', 'error'); return; }
    if (phone.length < 8) { showToast('رقم الهاتف قصير جداً', 'error'); return; }

    const plaintext = JSON.stringify({ email, phone, created_at: Math.floor(Date.now() / 1000) });
    let ciphertext;
    try {
        ciphertext = await encryptToAdmin(plaintext);
    } catch(e) {
        showToast('فشل التشفير: ' + e.message, 'error');
        return;
    }

    const adminHex = window.ADMIN_PUBKEY_HEX;
    const event = await signEvent({
        kind: REGISTER_EVENT_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', adminHex]],
        content: ciphertext
    });
    await pool.publish(RELAYS, event);
    myAccessStatus = 'pending';
    updateGateContent();
    showToast('تم إرسال طلب التسجيل ✅', 'success');
}

function resubmitRegistration() {
    myAccessStatus = 'not_registered';
    updateGateContent();
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
                    hideAccessGate();
                    unlockApp();
                }
            } else if (ev.content === 'revoke') {
                approvedPubkeys.delete(target);
                if (target === pk) {
                    myAccessStatus = 'not_registered';
                    saveApprovedCache();
                    renderAccessGate();
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
    if (!data.email || !data.phone) return;
    pendingRegistrations.set(event.pubkey, {
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
                    <p class="font-medium dark:text-white">${escapeHtml(data.email)}</p>
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
        await pool.publish(RELAYS, ev);
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
        await pool.publish(RELAYS, ev);
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
