/* =========================================================
   Pulse — registration.js
   نظام التسجيل بموافقة الإدارة (Approval-based registration)
   كل البيانات متخزنة على Nostr relays فقط — مفيش سيرفر خارجي
   ========================================================= */

// ============================
// كاش محلي لقائمة الأعضاء الموافق عليهم
// ============================

const APPROVED_CACHE_KEY = 'pulse_approved_cache';

function loadApprovedCache() {
    try {
        const raw = localStorage.getItem(APPROVED_CACHE_KEY);
        if (!raw) return;
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
            arr.forEach(pubkey => approvedPubkeys.add(pubkey));
            console.log('[Registration] تم تحميل قائمة الأعضاء من الذاكرة المحلية:', approvedPubkeys.size);
        }
    } catch (e) {
        console.warn('[Registration] فشل تحميل كاش الموافقات:', e);
    }
}

function saveApprovedCache() {
    try {
        localStorage.setItem(APPROVED_CACHE_KEY, JSON.stringify(Array.from(approvedPubkeys)));
    } catch (e) {
        console.warn('[Registration] فشل حفظ كاش الموافقات:', e);
    }
}

// ============================
// تحميل قائمة الموافقات من الريلايز
// ============================

let approvalSubscription = null;

async function loadApprovalList() {
    return new Promise((resolve) => {
        const adminHex = window.ADMIN_PUBKEY_HEX;
        if (!adminHex) { resolve(); return; }

        const events = [];
        const sub = pool.subscribeMany(RELAYS, [{ kinds: [APPROVE_EVENT_KIND], authors: [adminHex] }], {
            onevent: (event) => events.push(event),
            oneose: () => {
                applyApprovalEvents(events);
                resolve();
            },
            onclose: () => {
                if (events.length > 0) applyApprovalEvents(events);
                resolve();
            }
        });
        setTimeout(() => {
            try { sub.close(); } catch (e) {}
            resolve();
        }, 10000);
    });
}

function applyApprovalEvents(events) {
    if (events.length === 0) {
        console.log('[Registration] لا يوجد رد من السيرفرات، الإبقاء على القائمة المحلية:', approvedPubkeys.size);
        return;
    }
    events.sort((a, b) => a.created_at - b.created_at);
    for (const ev of events) {
        const target = ev.tags.find(t => t[0] === 'p')?.[1];
        if (!target) continue;
        if (ev.content === 'approve') {
            approvedPubkeys.add(target);
        } else if (ev.content === 'revoke') {
            approvedPubkeys.delete(target);
        }
    }
    console.log('[Registration] تحميل قائمة الأعضاء من السيرفرات:', approvedPubkeys.size, 'عضو موافق عليه');
    saveApprovedCache();
}

function subscribeToApprovalEvents() {
    const adminHex = window.ADMIN_PUBKEY_HEX;
    if (!adminHex) return;
    if (approvalSubscription) { try { approvalSubscription.close(); } catch (e) {} }
    approvalSubscription = pool.subscribeMany(RELAYS, [{ kinds: [APPROVE_EVENT_KIND], authors: [adminHex] }], {
        onevent: (event) => processApprovalEvent(event),
        oneose: () => {
            setTimeout(subscribeToApprovalEvents, 5000);
        }
    });
}

function processApprovalEvent(event) {
    const target = event.tags.find(t => t[0] === 'p')?.[1];
    if (!target) return;
    if (event.content === 'approve') {
        approvedPubkeys.add(target);
    } else if (event.content === 'revoke') {
        approvedPubkeys.delete(target);
    } else {
        return;
    }
    saveApprovedCache();

    // لو أنا اللي اتوافق عليّ دلوقتي وأنا مستني، افتحلي المنصة فوراً من غير ما أعمل رفرش
    if (target === pk) {
        if (event.content === 'approve' && myAccessStatus !== 'approved') {
            myAccessStatus = 'approved';
            showToast('✅ تم قبول طلبك! أهلاً بيك في المنصة', 'success');
            if (typeof unlockApp === 'function') unlockApp();
        } else if (event.content === 'revoke' && myAccessStatus === 'approved') {
            myAccessStatus = 'pending';
            window.appUnlocked = false;
            showToast('تم إلغاء عضويتك من قبل الإدارة', 'error');
            renderAccessGate('pending');
        }
    }

    if (adminPanelOpen) renderPendingRegistrationsPanel();
}

// ============================
// طلبات التسجيل (يقدر يفك تشفيرها المدير بس)
// ============================

let registrationSubscription = null;

function loadPendingRegistrationsForAdmin() {
    const adminHex = window.ADMIN_PUBKEY_HEX;
    if (!adminHex) return;
    pool.subscribeMany(RELAYS, [{ kinds: [REGISTER_EVENT_KIND], '#p': [adminHex] }], {
        onevent: (event) => {
            processRegistrationEvent(event).then(() => {
                if (adminPanelOpen) renderPendingRegistrationsPanel();
            });
        },
        oneose: () => {
            if (adminPanelOpen) renderPendingRegistrationsPanel();
        }
    });
}

function subscribeToRegistrationEvents() {
    const adminHex = window.ADMIN_PUBKEY_HEX;
    if (!adminHex) return;
    if (registrationSubscription) { try { registrationSubscription.close(); } catch (e) {} }
    registrationSubscription = pool.subscribeMany(RELAYS, [{ kinds: [REGISTER_EVENT_KIND], '#p': [adminHex] }], {
        onevent: (event) => {
            processRegistrationEvent(event).then(() => {
                if (adminPanelOpen) renderPendingRegistrationsPanel();
                else showToast('📥 وصل طلب تسجيل جديد', 'info');
            });
        },
        oneose: () => {
            setTimeout(subscribeToRegistrationEvents, 5000);
        }
    });
}

async function processRegistrationEvent(event) {
    if (approvedPubkeys.has(event.pubkey)) return; // موافق عليه بالفعل، مفيش داعي نعرضه تاني
    const existing = pendingRegistrations.get(event.pubkey);
    if (existing && existing.created_at >= event.created_at) return; // نسخة أقدم من طلب موجود

    try {
        const decrypted = await decryptFromUser(event.content, event.pubkey);
        const data = JSON.parse(decrypted);
        pendingRegistrations.set(event.pubkey, {
            email: data.email || '',
            phone: data.phone || '',
            created_at: event.created_at,
            eventId: event.id
        });
    } catch (e) {
        console.warn('[Registration] فشل فك تشفير طلب من', event.pubkey.slice(0, 8), e);
        pendingRegistrations.set(event.pubkey, {
            email: '(تعذّر فك التشفير)',
            phone: '',
            created_at: event.created_at,
            eventId: event.id
        });
    }
}

async function approveUser(targetPubkey) {
    if (!isCurrentUserAdmin()) { showToast('أنت لست مديراً', 'error'); return; }
    try {
        const eventTemplate = {
            kind: APPROVE_EVENT_KIND,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['p', targetPubkey]],
            content: 'approve',
        };
        const signed = await signEvent(eventTemplate);
        await Promise.all(RELAYS.map(url => pool.publish([url], signed)));
        approvedPubkeys.add(targetPubkey);
        saveApprovedCache();
        pendingRegistrations.delete(targetPubkey);
        showToast('تمت الموافقة على العضو ✅', 'success');
        renderPendingRegistrationsPanel();
    } catch (e) {
        showToast('فشلت الموافقة: ' + getErrorMessage(e), 'error');
    }
}

async function revokeUser(targetPubkey) {
    if (!isCurrentUserAdmin()) { showToast('أنت لست مديراً', 'error'); return; }
    if (!confirm('هل تريد إلغاء عضوية هذا المستخدم؟ لن يقدر يشوف المنصة تاني.')) return;
    try {
        const eventTemplate = {
            kind: APPROVE_EVENT_KIND,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['p', targetPubkey]],
            content: 'revoke',
        };
        const signed = await signEvent(eventTemplate);
        await Promise.all(RELAYS.map(url => pool.publish([url], signed)));
        approvedPubkeys.delete(targetPubkey);
        saveApprovedCache();
        showToast('تم إلغاء عضوية المستخدم', 'success');
        renderPendingRegistrationsPanel();
    } catch (e) {
        showToast('فشل الإلغاء: ' + getErrorMessage(e), 'error');
    }
}

function dismissRegistration(pubkey) {
    pendingRegistrations.delete(pubkey);
    renderPendingRegistrationsPanel();
}

function renderPendingRegistrationsPanel() {
    const list = document.getElementById('registrations-list');
    const countBadge = document.getElementById('registrations-count-badge');
    if (!list) return;

    const entries = Array.from(pendingRegistrations.entries())
        .filter(([pubkey]) => !approvedPubkeys.has(pubkey))
        .sort((a, b) => b[1].created_at - a[1].created_at);

    if (countBadge) countBadge.textContent = entries.length;

    if (entries.length === 0) {
        list.innerHTML = '<p class="text-gray-500 dark:text-gray-400">لا يوجد طلبات تسجيل قيد المراجعة</p>';
        return;
    }

    list.innerHTML = entries.map(([pubkey, data]) => `
        <div class="p-3 bg-gray-100 dark:bg-gray-700 rounded-lg space-y-1">
            <p class="text-sm"><span class="font-bold">📧 الإيميل:</span> ${escapeHtml(data.email)}</p>
            <p class="text-sm"><span class="font-bold">📱 الرقم:</span> ${escapeHtml(data.phone)}</p>
            <p class="text-xs text-gray-500 font-mono break-all">${pubkey}</p>
            <div class="flex gap-2 pt-1">
                <button onclick="approveUser('${pubkey}')" class="flex-1 bg-green-500 text-white py-1.5 rounded-lg text-sm hover:opacity-90 transition">
                    <i class="fas fa-check"></i> موافقة
                </button>
                <button onclick="dismissRegistration('${pubkey}')" class="flex-1 bg-gray-300 dark:bg-gray-600 py-1.5 rounded-lg text-sm hover:opacity-90 transition">
                    <i class="fas fa-times"></i> تجاهل
                </button>
            </div>
        </div>
    `).join('');
}

// ============================
// التحقق من حالة الوصول عند فتح التطبيق
// ============================

async function initAccessControl() {
    loadApprovedCache();

    if (isCurrentUserAdmin()) {
        myAccessStatus = 'approved';
        return true;
    }

    if (approvedPubkeys.has(pk)) {
        myAccessStatus = 'approved';
        return true;
    }

    const submitted = localStorage.getItem('pulse_reg_submitted_' + pk);
    myAccessStatus = submitted ? 'pending' : 'not_registered';
    renderAccessGate(myAccessStatus);
    return false;
}

// ============================
// واجهة بوابة الدخول (نموذج التسجيل / انتظار الموافقة)
// ============================

function renderAccessGate(mode) {
    let gate = document.getElementById('access-gate');
    if (!gate) {
        gate = document.createElement('div');
        gate.id = 'access-gate';
        gate.className = 'fixed inset-0 bg-white dark:bg-gray-900 flex items-center justify-center z-[100] p-4';
        document.body.appendChild(gate);
    }
    gate.classList.remove('hidden');

    if (mode === 'not_registered') {
        gate.innerHTML = `
            <div class="max-w-sm w-full bg-white dark:bg-surface rounded-3xl shadow-2xl p-6 border border-gray-200 dark:border-gray-700">
                <h2 class="text-xl font-bold mb-2 dark:text-white text-center">🔒 التسجيل في المنصة</h2>
                <p class="text-sm text-gray-500 dark:text-gray-400 mb-5 text-center">
                    ادخل بياناتك، وهيتم مراجعة طلبك من الإدارة قبل ما تقدر تدخل المنصة
                </p>
                <div class="space-y-3">
                    <input id="reg-email-input" type="email" placeholder="البريد الإلكتروني"
                           class="w-full p-3 rounded-xl border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white text-sm" />
                    <input id="reg-phone-input" type="tel" placeholder="رقم الهاتف"
                           class="w-full p-3 rounded-xl border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white text-sm" />
                    <button onclick="submitRegistration()"
                            class="w-full bg-accent text-white py-3 rounded-xl font-bold hover:opacity-90 transition">
                        إرسال طلب التسجيل
                    </button>
                </div>
                <p class="text-xs text-gray-400 mt-4 text-center">
                    بياناتك بتتشفّر ومحدش يقدر يشوفها غير الإدارة
                </p>
            </div>
        `;
    } else if (mode === 'pending') {
        gate.innerHTML = `
            <div class="max-w-sm w-full bg-white dark:bg-surface rounded-3xl shadow-2xl p-6 border border-gray-200 dark:border-gray-700 text-center">
                <div class="text-5xl mb-3">⏳</div>
                <h2 class="text-xl font-bold mb-2 dark:text-white">طلبك قيد المراجعة</h2>
                <p class="text-sm text-gray-500 dark:text-gray-400">
                    هيتم فتح المنصة تلقائياً هنا لما توافق الإدارة على طلبك. تقدر تسيب الصفحة مفتوحة أو ترجع تاني بعدين.
                </p>
            </div>
        `;
    } else {
        gate.innerHTML = `
            <div class="text-center">
                <div class="text-4xl mb-3 animate-pulse">⏳</div>
                <p class="text-gray-500 dark:text-gray-400">جاري التحقق...</p>
            </div>
        `;
    }
}

function hideAccessGate() {
    const gate = document.getElementById('access-gate');
    if (gate) gate.remove();
}

async function submitRegistration() {
    const emailInput = document.getElementById('reg-email-input');
    const phoneInput = document.getElementById('reg-phone-input');
    const email = emailInput?.value.trim();
    const phone = phoneInput?.value.trim();

    if (!email || !phone) {
        showToast('من فضلك اكتب الإيميل ورقم الهاتف', 'error');
        return;
    }

    try {
        const payload = JSON.stringify({ email, phone, npub, ts: Date.now() });
        const encrypted = await encryptToAdmin(payload);
        const eventTemplate = {
            kind: REGISTER_EVENT_KIND,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['p', window.ADMIN_PUBKEY_HEX]],
            content: encrypted,
        };
        const signed = await signEvent(eventTemplate);
        await Promise.all(RELAYS.map(url => pool.publish([url], signed)));

        localStorage.setItem('pulse_reg_submitted_' + pk, String(Math.floor(Date.now() / 1000)));
        myAccessStatus = 'pending';
        renderAccessGate('pending');
        showToast('تم إرسال طلبك بنجاح ✅', 'success');
    } catch (e) {
        console.error('[Registration] فشل إرسال الطلب:', e);
        showToast('فشل إرسال الطلب: ' + getErrorMessage(e), 'error');
    }
}
