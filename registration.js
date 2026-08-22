/* =========================================================
   Pulse — registration.js
   نظام التسجيل بموافقة الإدارة (Approval-based Registration)
   ========================================================= */

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
                <p class="text-sm text-gray-500 dark:text
