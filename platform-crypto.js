/* =========================================================
   Pulse — platform-crypto.js
   تشفير محتوى المنشورات بمفتاح مشترك للأعضاء المقبولين بس
   ========================================================= */

// بادئة بتحدد إن المحتوى مشفّر بالنظام ده — بتسمحلنا نميّز بين البوستات
// الجديدة (مشفّرة) والقديمة (نص عادي، قبل ما الفيتشر ده يتفعّل) عشان
// القديمة تفضل قابلة للعرض بدل ما تتحول لخرابيش.
const ENC_PREFIX = 'enc1:';

let platformKey = null; // كائن CryptoKey بعد التحميل/التوليد

// ============================
// تخزين المفتاح محليًا
// ============================

function platformKeyStorageKey() {
    return 'pulse_platform_key_' + (pk || 'anon');
}

async function loadPlatformKeyFromStorage() {
    try {
        const raw = localStorage.getItem(platformKeyStorageKey());
        if (!raw) return false;
        platformKey = await importPlatformKey(raw);
        return true;
    } catch (e) {
        console.warn('[Crypto] فشل تحميل مفتاح المنصة:', e);
        return false;
    }
}

function savePlatformKeyRaw(base64Key) {
    try {
        localStorage.setItem(platformKeyStorageKey(), base64Key);
    } catch (e) { /* مساحة ممتلئة — المفتاح هيفضل شغال في الذاكرة للجلسة الحالية بس */ }
}

function hasPlatformKey() {
    return !!platformKey;
}

// ============================
// توليد/استيراد/تصدير المفتاح (AES-GCM 256-bit عبر Web Crypto API
// المدمجة في المتصفح — مش معتمدين على أي مكتبة خارجية هنا، عشان نضمن
// سلوك موثّق ومتسق في كل المتصفحات الحديثة)
// ============================

async function generatePlatformKey() {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const raw = await crypto.subtle.exportKey('raw', key);
    const base64 = arrayBufferToBase64(raw);
    platformKey = key;
    savePlatformKeyRaw(base64);
    return base64;
}

async function importPlatformKey(base64Key) {
    const raw = base64ToArrayBuffer(base64Key);
    return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

async function setPlatformKeyFromBase64(base64Key) {
    platformKey = await importPlatformKey(base64Key);
    savePlatformKeyRaw(base64Key);
}

async function exportPlatformKeyBase64() {
    if (!platformKey) return null;
    const raw = await crypto.subtle.exportKey('raw', platformKey);
    return arrayBufferToBase64(raw);
}

function arrayBufferToBase64(buf) {
    let binary = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

// ============================
// تشفير/فك تشفير المحتوى
// ============================

async function encryptContent(plaintext) {
    if (!platformKey) throw new Error('مفتاح المنصة غير متاح — التشفير مش مفعّل لسه');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, platformKey, encoded);
    // بنركّب IV + النص المشفّر مع بعض (IV مش سرّي، لازم يوصل مع كل رسالة)
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);
    return ENC_PREFIX + arrayBufferToBase64(combined.buffer);
}

// بترجع النص الأصلي لو نجح فك التشفير، أو null لو المحتوى مش مشفّر
// بنظامنا (نص قديم من قبل الفيتشر)، أو تترمي استثناء لو كان مشفّر
// فعلاً بس فشل فك التشفير (يعني مفيش عندنا المفتاح الصح).
async function decryptContent(raw) {
    if (typeof raw !== 'string' || !raw.startsWith(ENC_PREFIX)) return null; // مش مشفّر بنظامنا
    if (!platformKey) throw new Error('لا يوجد مفتاح لفك التشفير');
    const combined = new Uint8Array(base64ToArrayBuffer(raw.slice(ENC_PREFIX.length)));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, platformKey, ciphertext);
    return new TextDecoder().decode(plainBuf);
}

// دالة مساعدة عامة: بتاخد محتوى حدث Nostr وترجع نص جاهز للعرض دايمًا —
// نص عادي لو كان أصلاً مش مشفّر (بوست قديم)، النص الأصلي لو فكّينا
// التشفير بنجاح، أو رسالة placeholder واضحة لو مقدرناش (مفيش مفتاح، أو
// المستخدم مش عضو مقبول لسه).
async function resolveDisplayContent(rawContent) {
    if (typeof rawContent !== 'string' || !rawContent.startsWith(ENC_PREFIX)) {
        return rawContent; // بوست قديم أو مش مشفّر أصلاً
    }
    if (!platformKey) return '🔒 محتوى مشفّر — لازم تكون عضو مقبول عشان تقدر تقراه';
    try {
        return await decryptContent(rawContent);
    } catch (e) {
        return '🔒 تعذّر فك تشفير هذا المحتوى';
    }
}

async function showPlatformKeyBackup() {
    const display = $('platform-key-display');
    const textarea = $('platform-key-text');
    if (!display || !textarea) return;
    if (!hasPlatformKey()) {
        showToast('مفيش مفتاح تشفير متولّد لسه', 'error');
        return;
    }
    const keyBase64 = await exportPlatformKeyBase64();
    textarea.value = keyBase64 || '';
    display.classList.remove('hidden');
}

function copyPlatformKey() {
    const textarea = $('platform-key-text');
    if (!textarea?.value) return;
    navigator.clipboard.writeText(textarea.value);
    showToast('اتنسخ المفتاح — احفظه في مكان آمن (مدير كلمات مرور مثلاً)', 'success');
}

window.showPlatformKeyBackup = showPlatformKeyBackup;
window.copyPlatformKey = copyPlatformKey;
window.generatePlatformKey = generatePlatformKey;
window.exportPlatformKeyBase64 = exportPlatformKeyBase64;
window.setPlatformKeyFromBase64 = setPlatformKeyFromBase64;
window.encryptContent = encryptContent;
window.decryptContent = decryptContent;
window.resolveDisplayContent = resolveDisplayContent;
window.loadPlatformKeyFromStorage = loadPlatformKeyFromStorage;
