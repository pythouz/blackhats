/* =========================================================
   Pulse — zaps.js
   دعم الزابس (Lightning tips) عبر NIP-57
   ========================================================= */

// ============================
// استقبال إيصالات الزاب وعرض المجموع على البوستات
// ============================

function startZapsSubscription() {
    const postIds = Array.from(postStats.keys());
    if (!postIds.length) return;
    if (zapsSubscription) { try { zapsSubscription.close(); } catch (e) {} }

    zapsSubscription = pool.subscribeMany(RELAYS, [
        { kinds: [9735], '#e': postIds.slice(0, 400) }
    ], {
        onevent: (event) => handleZapReceipt(event),
        oneose: () => {}
    });
}

function handleZapReceipt(event) {
    if (seenZapIds.has(event.id)) return;
    seenZapIds.add(event.id);
    limitSet(seenZapIds, MAX_SEEN_EVENTS);

    const postId = getTagValue(event.tags, 'e');
    if (!postId) return;

    const bolt11 = getTagValue(event.tags, 'bolt11');
    const sats = decodeBolt11Amount(bolt11);
    if (!sats) return;

    const entry = postZaps.get(postId) || { total: 0, count: 0 };
    entry.total += sats;
    entry.count += 1;
    postZaps.set(postId, entry);
    updateZapUI(postId);
}

// استخراج مبسّط للمبلغ من نص فاتورة BOLT11، بمعرفة الصيغة القياسية:
// ln(bc|tb)<رقم><مضاعِف اختياري: m|u|n|p>1... — ده نفس الأسلوب اللي
// عملاء Nostr التانية بتستخدمه لعرض قيمة الزاب من غير مكتبة bolt11 كاملة.
function decodeBolt11Amount(bolt11) {
    if (!bolt11) return 0;
    const match = bolt11.match(/^ln(?:bc|tb)(\d+)([munp]?)1/i);
    if (!match) return 0;
    const amount = parseInt(match[1], 10);
    let btc;
    switch (match[2]) {
        case 'm': btc = amount / 1e3; break;
        case 'u': btc = amount / 1e6; break;
        case 'n': btc = amount / 1e9; break;
        case 'p': btc = amount / 1e12; break;
        default: btc = amount; break;
    }
    return Math.round(btc * 1e8);
}

function formatSats(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace('.0', '') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1).replace('.0', '') + 'K';
    return String(n);
}

function updateZapUI(postId) {
    const entry = postZaps.get(postId);
    document.querySelectorAll(`.post-card[data-post-id="${CSS.escape(postId)}"] .zap-count`).forEach(el => {
        el.textContent = entry?.total ? formatSats(entry.total) : '';
    });
    document.querySelectorAll(`.post-card[data-post-id="${CSS.escape(postId)}"] .zap-button`).forEach(btn => {
        if (entry?.total) btn.classList.add('text-amber-500');
    });
}

// ============================
// إرسال زاب
// ============================

function openZapModal(postId, recipientPubkey) {
    if (recipientPubkey === pk) { showToast('متقدرش تعمل زاب لنفسك 🙂', 'info'); return; }
    zapTargetPostId = postId;
    zapTargetPubkey = recipientPubkey;
    $('zap-invoice-box')?.classList.add('hidden');
    const input = $('zap-amount-input');
    if (input) input.value = '21';
    $('zap-modal')?.classList.remove('hidden');
}

function closeZapModal() {
    $('zap-modal')?.classList.add('hidden');
    zapTargetPostId = null;
    zapTargetPubkey = null;
}

function selectZapAmount(sats) {
    const input = $('zap-amount-input');
    if (input) input.value = sats;
}

async function fetchLud16(pubkey) {
    // الكاش العام (profileCache) بيخزن الاسم/الصورة/النبذة بس، مش
    // الـ lightning address — لازم نجيب البروفايل الكامل هنا تحديدًا.
    return new Promise((resolve) => {
        let resolved = false;
        let sub;
        const finish = (val) => {
            if (resolved) return;
            resolved = true;
            try { sub?.close(); } catch (e) {}
            resolve(val);
        };
        sub = pool.subscribeMany(RELAYS, [{ kinds: [0], authors: [pubkey], limit: 1 }], {
            onevent: (event) => {
                try {
                    const meta = JSON.parse(event.content || '{}');
                    if (meta.lud16) finish(meta.lud16);
                } catch (e) {}
            },
            oneose: () => finish(null)
        });
        setTimeout(() => finish(null), 6000);
    });
}

async function sendZap() {
    const postId = zapTargetPostId;
    const recipientPubkey = zapTargetPubkey;
    if (!recipientPubkey) return;
    const sats = parseInt($('zap-amount-input')?.value, 10);
    if (!sats || sats <= 0) { showToast('اكتب مبلغ صحيح بالساتوشي', 'error'); return; }
    if (!checkRateLimit('sendZap', 1000, 15, 60 * 1000)) return;

    const btn = $('zap-send-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'جاري التجهيز...'; }

    try {
        const lud16 = await fetchLud16(recipientPubkey);
        if (!lud16 || !lud16.includes('@')) {
            showToast('المستخدم ده لسه مش مفعّل استقبال الزابس (Lightning Address)', 'error');
            return;
        }

        const [name, domain] = lud16.split('@');
        const lnurlRes = await fetch(`https://${domain}/.well-known/lnurlp/${name}`);
        if (!lnurlRes.ok) throw new Error('تعذر الوصول لخدمة الدفع بتاعة المستخدم');
        const lnurlData = await lnurlRes.json();
        if (!lnurlData.callback) throw new Error('رد غير صالح من خدمة الدفع');

        const amountMsats = sats * 1000;
        if (lnurlData.minSendable && amountMsats < lnurlData.minSendable) {
            showToast(`أقل مبلغ مسموح: ${Math.ceil(lnurlData.minSendable / 1000)} ساتوشي`, 'error');
            return;
        }
        if (lnurlData.maxSendable && amountMsats > lnurlData.maxSendable) {
            showToast(`أكبر مبلغ مسموح: ${Math.floor(lnurlData.maxSendable / 1000)} ساتوشي`, 'error');
            return;
        }

        // بناء zap request موقّع (NIP-57) — بيتبعت كبارامتر للـ LNURL callback
        // مش كحدث منشور على الـ relays مباشرة، عشان خدمة الدفع تقدر تربط
        // الفاتورة بصاحبها وتنشر "إيصال زاب" (kind 9735) بعد الدفع.
        const tags = [
            ['relays', ...RELAYS],
            ['amount', String(amountMsats)],
            ['p', recipientPubkey]
        ];
        if (postId) tags.push(['e', postId]);
        const zapRequest = await signEvent({
            kind: 9734,
            created_at: Math.floor(Date.now() / 1000),
            tags,
            content: ''
        });

        const callbackUrl = new URL(lnurlData.callback);
        callbackUrl.searchParams.set('amount', String(amountMsats));
        callbackUrl.searchParams.set('nostr', JSON.stringify(zapRequest));
        const invoiceRes = await fetch(callbackUrl.toString());
        const invoiceData = await invoiceRes.json();
        if (!invoiceData.pr) throw new Error('تعذر الحصول على فاتورة الدفع');

        await presentInvoiceForPayment(invoiceData.pr, sats);
    } catch (e) {
        showToast('فشل تجهيز الزاب: ' + getErrorMessage(e), 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '⚡ إرسال زاب'; }
    }
}

async function presentInvoiceForPayment(invoice, sats) {
    // 1) لو فيه امتداد WebLN (زي Alby) في المتصفح، ندفع بضغطة واحدة
    if (window.webln) {
        try {
            await window.webln.enable();
            await window.webln.sendPayment(invoice);
            showToast(`⚡ اتبعت ${sats} ساتوشي بنجاح!`, 'success');
            closeZapModal();
            return;
        } catch (e) {
            // المستخدم لغى من الامتداد أو فشل الدفع — ننتقل للطريقة اليدوية
        }
    }
    // 2) رجوع للدفع اليدوي: رابط lightning: (بيفتح أي محفظة متثبتة على
    // الموبايل تلقائيًا) + نسخ الفاتورة لأي محفظة تانية
    showManualInvoice(invoice);
}

function showManualInvoice(invoice) {
    const box = $('zap-invoice-box');
    const link = $('zap-invoice-link');
    const text = $('zap-invoice-text');
    if (box) box.classList.remove('hidden');
    if (link) link.href = 'lightning:' + invoice;
    if (text) text.value = invoice;
}

function copyZapInvoice() {
    const text = $('zap-invoice-text');
    if (!text?.value) return;
    navigator.clipboard.writeText(text.value);
    showToast('اتنسخت الفاتورة', 'success');
}

window.openZapModal = openZapModal;
window.closeZapModal = closeZapModal;
window.selectZapAmount = selectZapAmount;
window.sendZap = sendZap;
window.copyZapInvoice = copyZapInvoice;
window.startZapsSubscription = startZapsSubscription;
