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
            const generated = NostrTools.generateSecretKey();
            hexSk = Array.from(generated).map(b => b.toString(16).padStart(2, '0')).join('');
            localStorage.setItem(storageKey, hexSk);
            showToast('تم إنشاء هوية جديدة. احفظ مفتاحك!', 'info');
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

async function encryptToAdmin(plaintext) {
    const adminHex = window.ADMIN_PUBKEY_HEX;
    if (!adminHex) throw new Error('مفتاح المدير غير متاح');
    if (usingNip07 && window.nostr?.nip04?.encrypt) {
        return await window.nostr.nip04.encrypt(adminHex, plaintext);
    }
    if (!secretKeyHex) throw new Error('لا يوجد مفتاح للتشفير');
    return await NostrTools.nip04.encrypt(secretKeyHex, adminHex, plaintext);
}

async function decryptFromUser(ciphertext, userPubkey) {
    if (usingNip07 && window.nostr?.nip04?.decrypt) {
        return await window.nostr.nip04.decrypt(userPubkey, ciphertext);
    }
    if (!secretKeyHex) throw new Error('لا يوجد مفتاح لفك التشفير');
    return await NostrTools.nip04.decrypt(secretKeyHex, userPubkey, ciphertext);
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
    } catch (error) {
        showToast('فشل الاستيراد: ' + getErrorMessage(error), 'error');
    }
}

function copyNpub() {
    if (!npub) return;
    navigator.clipboard?.writeText(npub).then(() => showToast('تم نسخ npub', 'success'))
        .catch(() => prompt('انسخ npub:', npub));
}
