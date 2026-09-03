/* =========================================================
   Pulse — auth.js
   الهوية على Nostr: توليد/استيراد المفتاح، NIP-07
   ========================================================= */

// ============================
// 5. الهوية Nostr
// ============================

async function initIdentity() {
    try {
        if (window.nostr?.getPublicKey) {
            try {
                pk = await window.nostr.getPublicKey();
                npub = NostrTools.nip19.npubEncode(pk);
                usingNip07 = true;
                secretKeyHex = null;
                updateIdentityUI();
                console.log('[Nostr] NIP-07');
                showToast('تم الاتصال بامتداد Nostr (NIP-07)', 'success');
                return;
            } catch (e) { console.warn('[Nostr] NIP-07 فشل:', e); }
        }

        let hexSk = localStorage.getItem(storageKey);
        const isValid = typeof hexSk === 'string' && hexSk.length === 64 && /^[0-9a-fA-F]{64}$/.test(hexSk);

        if (!isValid) {
            // لا يوجد مفتاح → نعرض بوابة الدخول/التسجيل
            showAuthGate();
            return;
        }

        secretKeyHex = hexSk;
        pk = NostrTools.getPublicKey(secretKeyHex);
        npub = NostrTools.nip19.npubEncode(pk);
        usingNip07 = false;
        updateIdentityUI();
        console.log('[Nostr] هوية محلية');
    } catch (error) {
        console.error('[Nostr] فشل:', error);
        localStorage.removeItem(storageKey);
        showToast('خطأ في الهوية، سيتم إنشاء جديدة', 'error');
        setTimeout(initIdentity, 800);
    }
}

function updateIdentityUI() {
    const display = $('npub-display');
    if (display) {
        display.textContent = npub ? npub.slice(0, 10) + '...' + npub.slice(-6) : 'جاري...';
        display.title = npub || '';
    }
    const badge = $('nip07-badge');
    if (badge) {
        badge.classList.toggle('hidden', !usingNip07);
        badge.textContent = 'NIP-07';
    }
}

async function signEvent(eventTemplate) {
    if (usingNip07 && window.nostr?.signEvent) {
        return await window.nostr.signEvent(eventTemplate);
    }
    if (!secretKeyHex) throw new Error('لا يوجد مفتاح توقيع');
    return NostrTools.finalizeEvent(eventTemplate, secretKeyHex);
}

// ============================
// تشفير/فك تشفير بيانات التسجيل (عشان الإيميل والرقم يفضلوا سريين)
// ============================

async function encryptToPubkey(plaintext, recipientHex) {
    if (!recipientHex) throw new Error('لا يوجد مستلم للتشفير');

    // 🔒 نفضّل NIP-44 (تشفير أحدث وأقوى من NIP-04 القديم): NIP-04 معروف
    // بعيوب تشفيرية — مفيش تحقق من سلامة الرسالة (integrity)، وطريقة
    // الـ padding بتاعته بتسرّب معلومات عن طول النص الأصلي. لو NIP-44 مش
    // متاح (امتداد NIP-07 قديم أو نسخة مكتبة قديمة)، بنرجع تلقائيًا لـ
    // NIP-04 عشان العملية تفضل شغالة في كل الأحوال بدل ما تفشل تمامًا.
    try {
        if (usingNip07 && window.nostr?.nip44?.encrypt) {
            return 'nip44:' + await window.nostr.nip44.encrypt(recipientHex, plaintext);
        }
        if (!usingNip07 && secretKeyHex && NostrTools?.nip44?.encrypt && NostrTools?.nip44?.getConversationKey) {
            const skBytes = Uint8Array.from(secretKeyHex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
            const convKey = NostrTools.nip44.getConversationKey(skBytes, recipientHex);
            return 'nip44:' + await NostrTools.nip44.encrypt(plaintext, convKey);
        }
    } catch (e) {
        console.warn('[Auth] NIP-44 غير متاح، بنرجع لـ NIP-04:', e);
    }

    // احتياطي: NIP-04
    if (usingNip07 && window.nostr?.nip04?.encrypt) {
        return await window.nostr.nip04.encrypt(recipientHex, plaintext);
    }
    if (!secretKeyHex) throw new Error('لا يوجد مفتاح للتشفير');
    return await NostrTools.nip04.encrypt(secretKeyHex, recipientHex, plaintext);
}

async function decryptFromPubkey(ciphertext, senderHex) {
    // بادئة 'nip44:' بتحدد إن الرسالة اتشفرت بـ NIP-44 (شوف encryptToPubkey
    // فوق). محتاجينها لأن الأكواد دي مخصصة للتطبيق مش أنواع أحداث Nostr
    // قياسية بتدل بذاتها على نوع التشفير المستخدم.
    if (typeof ciphertext === 'string' && ciphertext.startsWith('nip44:')) {
        const payload = ciphertext.slice(6);
        if (usingNip07 && window.nostr?.nip44?.decrypt) {
            return await window.nostr.nip44.decrypt(senderHex, payload);
        }
        if (secretKeyHex && NostrTools?.nip44?.decrypt && NostrTools?.nip44?.getConversationKey) {
            const skBytes = Uint8Array.from(secretKeyHex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
            const convKey = NostrTools.nip44.getConversationKey(skBytes, senderHex);
            return await NostrTools.nip44.decrypt(payload, convKey);
        }
        throw new Error('NIP-44 غير متاح لفك التشفير (حدّث الامتداد أو المتصفح)');
    }
    // نسخة أقدم (NIP-04) — للتوافق مع أي رسائل اتبعتت قبل هذا التحديث
    if (usingNip07 && window.nostr?.nip04?.decrypt) {
        return await window.nostr.nip04.decrypt(senderHex, ciphertext);
    }
    if (!secretKeyHex) throw new Error('لا يوجد مفتاح لفك التشفير');
    return await NostrTools.nip04.decrypt(secretKeyHex, senderHex, ciphertext);
}

// أغلفة رفيعة للتوافق مع registration.js اللي بينادي على الاسمين
// القديمين دول تحديدًا — بدل ما نلمس الكود بتاعها.
async function encryptToAdmin(plaintext) {
    const adminHex = window.ADMIN_PUBKEY_HEX;
    if (!adminHex) throw new Error('مفتاح المدير غير متاح');
    return encryptToPubkey(plaintext, adminHex);
}

async function decryptFromUser(ciphertext, userPubkey) {
    return decryptFromPubkey(ciphertext, userPubkey);
}

function exportKey() {
    if (usingNip07) { showToast('صدّر المفتاح من الامتداد نفسه', 'info'); return; }
    if (!secretKeyHex) { showToast('لا يوجد مفتاح للتصدير', 'error'); return; }
    try {
        const bytes = Uint8Array.from(secretKeyHex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
        const nsec = NostrTools.nip19.nsecEncode(bytes);
        navigator.clipboard?.writeText(nsec).then(() => showToast('تم نسخ nsec', 'success'))
            .catch(() => prompt('انسخ nsec:', nsec));
    } catch (e) {
        prompt('انسخ المفتاح (hex):', secretKeyHex);
    }
}

function importKey() {
    if (usingNip07) { showToast('عطّل الامتداد أولاً', 'info'); return; }
    const input = prompt('الصق nsec أو المفتاح السري (64 حرف hex):');
    if (!input?.trim()) return;
    try {
        let hex = input.trim();
        if (hex.startsWith('nsec1')) {
            const decoded = NostrTools.nip19.decode(hex);
            if (decoded.type !== 'nsec') throw new Error('نوع غير صحيح');
            hex = Array.from(decoded.data).map(b => b.toString(16).padStart(2, '0')).join('');
        }
        if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('صيغة غير صحيحة');
        localStorage.setItem(storageKey, hex);
        secretKeyHex = hex;
        pk = NostrTools.getPublicKey(secretKeyHex);
        npub = NostrTools.nip19.npubEncode(pk);
        usingNip07 = false;
        updateIdentityUI();
        showToast('تم استيراد المفتاح', 'success');
        if (postsSubscription) { try { postsSubscription.close(); } catch(e) {} }
        seenEvents.clear();
        renderedPosts.clear();
        postScores.clear();
        postStats.clear();
        postContentMap.clear();
        pendingRepliesMap.clear();
        const container = $('feed-container');
        if (container) container.innerHTML = '';
        startFeed();
        // إخفاء بوابة الدخول إن ظهرت
        hideAuthGate();
        initAccessControl(); // إعادة فحص الصلاحيات
        unlockApp(); // فتح التطبيق
    } catch (error) {
        showToast('فشل الاستيراد: ' + getErrorMessage(error), 'error');
    }
}

function copyNpub() {
    if (!npub) return;
    navigator.clipboard?.writeText(npub).then(() => showToast('تم نسخ npub', 'success'))
        .catch(() => prompt('انسخ npub:', npub));
}

// ============================
// (إضافة) نظام بوابة الدخول/التسجيل
// ============================

function showAuthGate() {
    authGateVisible = true;
    renderAuthGate();
    // إخفاء أي محتوى آخر
    document.querySelectorAll('.view-section').forEach(s => s.classList.add('hidden'));
    document.getElementById('auth-gate')?.classList.remove('hidden');
}

function hideAuthGate() {
    authGateVisible = false;
    document.getElementById('auth-gate')?.classList.add('hidden');
}

function renderAuthGate() {
    let gate = document.getElementById('auth-gate');
    if (!gate) {
        gate = document.createElement('div');
        gate.id = 'auth-gate';
        gate.className = 'fixed inset-0 z-[150] bg-white dark:bg-dark flex items-center justify-center p-4';
        gate.style.background = 'rgba(0,0,0,0.85)';
        gate.style.backdropFilter = 'blur(10px)';
        document.body.appendChild(gate);
    }

    let innerHTML = `
        <div class="bg-white dark:bg-surface rounded-3xl shadow-2xl max-w-md w-full p-6 border border-gray-200 dark:border-gray-700 text-center">
            <h2 class="text-3xl font-black gradient-text mb-2">Pulse</h2>
            <p class="text-gray-500 dark:text-gray-400 text-sm mb-6">منصة المجتمع الحي اللامركزية</p>
            <div id="auth-tabs" class="flex justify-center gap-4 mb-6">
                <button id="tab-login" onclick="switchAuthTab('login')" class="px-4 py-2 rounded-full text-sm font-bold ${authGateMode==='login' ? 'bg-accent text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}">تسجيل الدخول</button>
                <button id="tab-register" onclick="switchAuthTab('register')" class="px-4 py-2 rounded-full text-sm font-bold ${authGateMode==='register' ? 'bg-accent text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}">حساب جديد</button>
            </div>
            <div id="auth-content">
                <!-- سيتم ملؤها حسب الوضع -->
            </div>
        </div>
    `;
    gate.innerHTML = innerHTML;
    switchAuthTab(authGateMode);
}

function switchAuthTab(mode) {
    authGateMode = mode;
    // تحديث ألوان الأزرار
    const tabLogin = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');
    if (tabLogin && tabRegister) {
        tabLogin.className = `px-4 py-2 rounded-full text-sm font-bold ${mode==='login' ? 'bg-accent text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`;
        tabRegister.className = `px-4 py-2 rounded-full text-sm font-bold ${mode==='register' ? 'bg-accent text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`;
    }
    const content = document.getElementById('auth-content');
    if (!content) return;

    if (mode === 'login') {
        content.innerHTML = `
            <div class="text-right">
                <h3 class="text-lg font-bold dark:text-white mb-4">تسجيل الدخول</h3>
                <button onclick="importKey()" class="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 rounded-2xl transition mb-3">
                    <i class="fas fa-key mr-2"></i> استيراد المفتاح الخاص (nsec)
                </button>
                <button onclick="loginWithNip07()" class="w-full bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-white font-bold py-3 rounded-2xl transition">
                    <i class="fas fa-wallet mr-2"></i> تسجيل الدخول عبر NIP-07
                </button>
                <p class="text-xs text-gray-400 mt-4">ليس لديك حساب؟ <button onclick="switchAuthTab('register')" class="text-accent underline">أنشئ حساباً جديداً</button></p>
            </div>
        `;
    } else {
        content.innerHTML = `
            <div class="text-right">
                <h3 class="text-lg font-bold dark:text-white mb-4">إنشاء حساب جديد</h3>
                <p class="text-xs text-gray-400 mb-4">سيتم توليد مفتاح خاص لك في متصفحك. احفظه فوراً ولا تشاركه مع أحد.</p>
                <div class="space-y-3">
                    <input id="reg-name" type="text" placeholder="الاسم الكامل" class="w-full px-4 py-3 rounded-2xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 outline-none focus:border-accent dark:text-white text-sm">
                    <input id="reg-email" type="email" placeholder="البريد الإلكتروني" class="w-full px-4 py-3 rounded-2xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 outline-none focus:border-accent dark:text-white text-sm">
                    <input id="reg-phone" type="tel" placeholder="رقم الهاتف" class="w-full px-4 py-3 rounded-2xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 outline-none focus:border-accent dark:text-white text-sm">
                    <button onclick="registerUser()" class="w-full bg-gradient-to-r from-accent to-accent2 text-white font-bold py-3 rounded-2xl hover:opacity-90 transition">
                        <i class="fas fa-user-plus mr-2"></i> إرسال الطلب
                    </button>
                </div>
                <p class="text-xs text-gray-400 mt-4">لديك حساب بالفعل؟ <button onclick="switchAuthTab('login')" class="text-accent underline">تسجيل الدخول</button></p>
            </div>
        `;
    }
}

async function loginWithNip07() {
    if (!window.nostr?.getPublicKey) {
        showToast('امتداد NIP-07 غير متوفر', 'error');
        return;
    }
    try {
        pk = await window.nostr.getPublicKey();
        npub = NostrTools.nip19.npubEncode(pk);
        usingNip07 = true;
        secretKeyHex = null;
        updateIdentityUI();
        hideAuthGate();
        // فحص الصلاحيات ثم فتح. لو الوصول مرفوض، initAccessControl() نفسها
        // بتعرض الشاشة الصح (بوابة التسجيل أو "قيد المراجعة")، فمفيش داعي
        // لدالة تانية هنا (كانت showAccessDenied() اللي أصلاً مش متعرّفة
        // في أي مكان في الكود، وكانت بتسبب خطأ في الـ console كل مرة
        // مستخدم NIP-07 يتم رفضه).
        initAccessControl().then(access => {
            if (access) unlockApp();
        });
    } catch (e) {
        showToast('فشل تسجيل الدخول عبر NIP-07: ' + getErrorMessage(e), 'error');
    }
}

async function registerUser() {
    const name = document.getElementById('reg-name')?.value.trim();
    const email = document.getElementById('reg-email')?.value.trim();
    const phone = document.getElementById('reg-phone')?.value.trim();
    if (!name || !email || !phone) {
        showToast('يرجى ملء جميع الحقول', 'error');
        return;
    }
    if (!email.includes('@')) {
        showToast('بريد إلكتروني غير صحيح', 'error');
        return;
    }
    if (phone.length < 8) {
        showToast('رقم الهاتف قصير جداً', 'error');
        return;
    }
    if (!checkRateLimit('registerUser', 5000, 3, 10 * 60 * 1000)) return;

    // توليد مفتاح خاص جديد
    const generated = NostrTools.generateSecretKey();
    const hexSk = Array.from(generated).map(b => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(storageKey, hexSk);
    secretKeyHex = hexSk;
    pk = NostrTools.getPublicKey(secretKeyHex);
    npub = NostrTools.nip19.npubEncode(pk);
    usingNip07 = false;

    // تشفير البيانات وإرسالها للأدمن
    const plaintext = JSON.stringify({ name, email, phone, created_at: Math.floor(Date.now() / 1000) });
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
    await publishToRelays(event);

    // حفظ علامة إرسال الطلب
    localStorage.setItem('pulse_registration_sent', pk);

    // عرض المفتاح الخاص للمستخدم (مرة واحدة)
    const nsec = NostrTools.nip19.nsecEncode(generated);
    alert(`تم إنشاء حسابك بنجاح!\n\nهذا هو مفتاحك الخاص (nsec):\n${nsec}\n\nاحفظه في مكان آمن. لن يظهر مرة أخرى.\n\nسيتم إعلامك عند موافقة الإدارة.`);

    // إخفاء البوابة وإظهار شاشة انتظار الموافقة
    hideAuthGate();
    myAccessStatus = 'pending';
    showPendingApproval();
}
