/* =========================================================
   Pulse — messages.js
   رسائل خاصة مشفرة (DM) + مكالمات صوتية فردية بين شخصين
   ========================================================= */

// ============================
// تخزين محلي للمحادثات
// ============================

function dmStorageKey() {
    return 'pulse_dms_' + (pk || 'anon');
}

function loadDmState() {
    try {
        const raw = localStorage.getItem(dmStorageKey());
        if (!raw) return;
        const data = JSON.parse(raw);
        if (!Array.isArray(data.conversations)) return;
        for (const [convPubkey, conv] of data.conversations) {
            conversations.set(convPubkey, conv);
            (conv.messages || []).forEach(m => seenDmIds.add(m.id));
        }
        totalUnreadDms = data.conversations.reduce((sum, [, c]) => sum + (c.unread || 0), 0);
    } catch (e) { /* لا يوجد شيء محفوظ */ }
}

function saveDmState() {
    try {
        // نحفظ آخر 200 رسالة لكل محادثة بس، عشان الحجم ميكبرش من غير داعي
        const serializable = Array.from(conversations.entries()).map(([convPubkey, conv]) => {
            return [convPubkey, { ...conv, messages: (conv.messages || []).slice(-200) }];
        });
        localStorage.setItem(dmStorageKey(), JSON.stringify({ conversations: serializable }));
    } catch (e) { /* مساحة ممتلئة — مش خطير، هيفضل شغال بالذاكرة */ }
}

function getConversation(pubkey) {
    if (!conversations.has(pubkey)) {
        conversations.set(pubkey, { messages: [], unread: 0, lastActivity: 0 });
    }
    return conversations.get(pubkey);
}

// ============================
// استقبال/إرسال الرسائل
// ============================

function startDmSubscription() {
    if (!pk) return;
    if (!conversations.size) loadDmState();
    updateDmBadge();

    if (dmSubscription) { try { dmSubscription.close(); } catch (e) {} }

    // أول مرة (مفيش محادثات محفوظة) بنجيب آخر شهر بس كبداية معقولة.
    let earliest = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
    for (const conv of conversations.values()) {
        if (conv.lastActivity) earliest = Math.max(earliest, conv.lastActivity - 3600);
    }

    dmSubscription = pool.subscribeMany(RELAYS, [
        { kinds: [DM_EVENT_KIND], '#p': [pk], since: earliest },
        { kinds: [DM_EVENT_KIND], authors: [pk], since: earliest }
    ], {
        onevent: (event) => handleDmEvent(event),
        oneose: () => { setTimeout(startDmSubscription, 60000); },
        onclose: () => { setTimeout(startDmSubscription, 15000); }
    });
}

async function handleDmEvent(event) {
    if (seenDmIds.has(event.id)) return;
    seenDmIds.add(event.id);
    limitSet(seenDmIds, MAX_SEEN_EVENTS);

    const isOutgoing = event.pubkey === pk;
    const otherPubkey = isOutgoing ? getTagValue(event.tags, 'p') : event.pubkey;
    if (!otherPubkey) return;
    if (bannedPubkeys.has(otherPubkey)) return;

    let text;
    try {
        text = await decryptFromPubkey(event.content, otherPubkey);
    } catch (e) {
        console.warn('[DM] تعذر فك تشفير رسالة:', e);
        return;
    }
    if (typeof text !== 'string' || !text.length) return;

    const conv = getConversation(otherPubkey);
    conv.messages.push({ id: event.id, from: isOutgoing ? pk : otherPubkey, text, createdAt: event.created_at });
    conv.messages.sort((a, b) => a.createdAt - b.createdAt);
    conv.lastActivity = Math.max(conv.lastActivity || 0, event.created_at);

    if (!isOutgoing && activeChatPubkey !== otherPubkey) {
        conv.unread = (conv.unread || 0) + 1;
        totalUnreadDms++;
        updateDmBadge();
    }

    fetchProfiles([otherPubkey]);
    saveDmState();

    if (activeChatPubkey === otherPubkey) {
        renderChatMessages();
    }
    const messagesView = $('view-messages');
    if (messagesView && !messagesView.classList.contains('hidden') && !activeChatPubkey) {
        renderMessagesList();
    }
}

async function sendDirectMessage() {
    const pubkey = activeChatPubkey;
    if (!pubkey) return;
    const input = $('chat-input');
    const text = (input?.value || '').trim();
    if (!text) return;
    if (!checkRateLimit('sendDirectMessage', 400, 30, 60 * 1000)) return;

    input.value = '';
    input.style.height = 'auto';

    // عرض تفاؤلي فوري — الرسالة بتظهر قبل ما ننتظر تأكيد النشر، وبنعلّمها
    // كـ pending لحد ما ننشر فعليًا (زي أي تطبيق شات حديث).
    const tempId = 'pending-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    const conv = getConversation(pubkey);
    const nowTs = Math.floor(Date.now() / 1000);
    conv.messages.push({ id: tempId, from: pk, text, createdAt: nowTs, pending: true });
    conv.lastActivity = nowTs;
    renderChatMessages();

    try {
        const ciphertext = await encryptToPubkey(text, pubkey);
        const event = await signEvent({
            kind: DM_EVENT_KIND,
            created_at: nowTs,
            tags: [['p', pubkey]],
            content: ciphertext
        });
        await publishToRelays(event);

        // استبدال الرسالة المؤقتة بالنهائية (نفس المعرّف اللي هيوصلنا من
        // اشتراكنا هو نفسه — بس منعتمدش على وصوله، نثبّت الحالة فورًا)
        const idx = conv.messages.findIndex(m => m.id === tempId);
        if (idx !== -1) {
            conv.messages[idx] = { id: event.id, from: pk, text, createdAt: nowTs };
            seenDmIds.add(event.id);
        }
        conv.lastActivity = nowTs;
        saveDmState();
        renderChatMessages();
    } catch (e) {
        showToast('فشل إرسال الرسالة: ' + getErrorMessage(e), 'error');
        conv.messages = conv.messages.filter(m => m.id !== tempId);
        renderChatMessages();
    }
}

// ============================
// واجهة قائمة المحادثات
// ============================

function updateDmBadge() {
    const badge = $('dm-badge');
    const navBadge = $('nav-dm-badge');
    [badge, navBadge].forEach(b => {
        if (!b) return;
        if (totalUnreadDms > 0) {
            b.textContent = totalUnreadDms > 99 ? '99+' : String(totalUnreadDms);
            b.classList.remove('hidden');
        } else {
            b.classList.add('hidden');
        }
    });
}

function renderMessagesList() {
    const container = $('conversations-list');
    if (!container) return;

    const sorted = Array.from(conversations.entries())
        .filter(([, conv]) => conv.messages && conv.messages.length)
        .sort((a, b) => (b[1].lastActivity || 0) - (a[1].lastActivity || 0));

    if (!sorted.length) {
        container.innerHTML = `
            <div class="text-center text-gray-400 text-sm py-16 px-6">
                <i class="fas fa-comments text-4xl mb-3 block"></i>
                مفيش محادثات لسه.<br>ابدأ محادثة جديدة بزرار "+" فوق.
            </div>`;
        return;
    }

    container.innerHTML = sorted.map(([convPubkey, conv]) => {
        const last = conv.messages[conv.messages.length - 1];
        const name = escapeHtml(getDisplayName(convPubkey));
        const preview = escapeHtml((last?.text || '').slice(0, 60));
        const unreadBadge = conv.unread > 0
            ? `<span class="bg-accent text-white text-[11px] font-bold rounded-full min-w-[20px] h-5 px-1.5 flex items-center justify-center">${conv.unread > 99 ? '99+' : conv.unread}</span>`
            : '';
        return `
            <button onclick="openChat('${convPubkey}')"
                    class="w-full flex items-center gap-3 p-3 rounded-2xl text-right transition hover:bg-gray-50 dark:hover:bg-gray-800/60">
                <div class="flex-shrink-0">${avatarHtml(convPubkey, 'w-12 h-12 text-base')}</div>
                <div class="flex-1 min-w-0">
                    <p class="font-bold text-sm dark:text-white truncate">${name}</p>
                    <p class="text-xs text-gray-400 truncate mt-0.5">${preview}</p>
                </div>
                ${unreadBadge}
            </button>
        `;
    }).join('');
}

function promptNewChat() {
    const input = prompt('اكتب npub أو المفتاح العام (hex) بتاع الشخص اللي عايز تراسله:');
    if (!input) return;
    const query = input.trim();
    let pubkey = query;
    if (query.startsWith('npub1')) {
        try {
            const decoded = NostrTools.nip19.decode(query);
            if (decoded.type === 'npub') pubkey = decoded.data;
        } catch (e) { showToast('npub غير صالح', 'error'); return; }
    } else if (!/^[0-9a-fA-F]{64}$/.test(query)) {
        showToast('يجب إدخال npub أو مفتاح hex صالح', 'error');
        return;
    }
    if (pubkey === pk) { showToast('متقدرش تراسل نفسك 🙂', 'info'); return; }
    fetchProfiles([pubkey]);
    openChat(pubkey);
}

// ============================
// واجهة المحادثة المفتوحة
// ============================

function openChat(pubkey) {
    activeChatPubkey = pubkey;
    fetchProfiles([pubkey]);

    const conv = getConversation(pubkey);
    if (conv.unread) {
        totalUnreadDms = Math.max(0, totalUnreadDms - conv.unread);
        conv.unread = 0;
        saveDmState();
        updateDmBadge();
    }

    const listEl = $('conversations-list-view');
    const threadEl = $('chat-thread-view');
    if (listEl) listEl.classList.add('hidden');
    if (threadEl) threadEl.classList.remove('hidden');

    const nameEl = $('chat-thread-name');
    if (nameEl) nameEl.textContent = getDisplayName(pubkey);
    const avatarEl = $('chat-thread-avatar');
    if (avatarEl) avatarEl.innerHTML = avatarHtml(pubkey, 'w-9 h-9 text-sm');

    renderChatMessages();
    setTimeout(() => $('chat-input')?.focus(), 100);
}

function closeChat() {
    activeChatPubkey = null;
    const listEl = $('conversations-list-view');
    const threadEl = $('chat-thread-view');
    if (threadEl) threadEl.classList.add('hidden');
    if (listEl) listEl.classList.remove('hidden');
    renderMessagesList();
}

function renderChatMessages() {
    const container = $('chat-messages');
    if (!container || !activeChatPubkey) return;
    const conv = getConversation(activeChatPubkey);

    if (!conv.messages.length) {
        container.innerHTML = `<p class="text-center text-gray-400 text-sm py-10">ابدأ المحادثة بأول رسالة 👋</p>`;
        return;
    }

    container.innerHTML = conv.messages.map(m => {
        const isMine = m.from === pk;
        const time = new Date(m.createdAt * 1000).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
        return `
            <div class="flex ${isMine ? 'justify-start' : 'justify-end'} mb-2">
                <div class="max-w-[75%] ${isMine ? 'bg-accent text-white rounded-2xl rounded-bl-sm' : 'bg-gray-100 dark:bg-gray-800 dark:text-white rounded-2xl rounded-br-sm'} px-4 py-2 ${m.pending ? 'opacity-60' : ''}">
                    <p class="text-sm whitespace-pre-wrap break-words">${escapeHtml(m.text)}</p>
                    <p class="text-[10px] ${isMine ? 'text-white/70' : 'text-gray-400'} mt-1 text-left">${time}${m.pending ? ' · جاري الإرسال...' : ''}</p>
                </div>
            </div>
        `;
    }).join('');

    container.scrollTop = container.scrollHeight;
}

function openChatFromProfile(pubkey) {
    switchView('messages');
    openChat(pubkey);
}

// ============================
// مكالمات صوتية فردية (منفصلة تمامًا عن peer الغرف الجماعية في rooms.js
// عشان محدش يتعارض مع التاني)
// ============================

function startDmCallListener() {
    if (!pk) return;
    if (dmCallSubscription) { try { dmCallSubscription.close(); } catch (e) {} }
    const since = Math.floor(Date.now() / 1000) - 60;
    dmCallSubscription = pool.subscribeMany(RELAYS, [
        { kinds: [CALL_SIGNAL_KIND], '#p': [pk], since }
    ], {
        onevent: (event) => handleCallSignal(event),
        oneose: () => { setTimeout(startDmCallListener, 60000); },
        onclose: () => { setTimeout(startDmCallListener, 15000); }
    });
}

async function handleCallSignal(event) {
    if (event.pubkey === pk) return;
    const type = getTagValue(event.tags, 'type');
    const fromPubkey = event.pubkey;

    if (type === 'invite') {
        if (dmCallState !== 'idle') {
            sendCallSignal(fromPubkey, 'busy'); // مشغول بمكالمة تانية — رد سريع بدل ما نسيبه يرن للأبد
            return;
        }
        let payload;
        try { payload = JSON.parse(await decryptFromPubkey(event.content, fromPubkey)); }
        catch (e) { return; }
        if (!payload?.peerId) return;

        dmCallState = 'ringing';
        dmCallPeerPubkey = fromPubkey;
        dmCallPeerId = payload.peerId;
        fetchProfiles([fromPubkey]);
        showIncomingCallUI(fromPubkey);

        dmCallTimeoutId = setTimeout(() => {
            if (dmCallState === 'ringing') endDmCall(true);
        }, 45000);
        return;
    }

    // أي إشارة تانية لازم تكون من نفس الطرف اللي إحنا بنتصل بيه حاليًا
    if (fromPubkey !== dmCallPeerPubkey) return;

    if (type === 'accept') {
        if (dmCallState !== 'calling') return;
        clearTimeout(dmCallTimeoutId);
        dmCallState = 'in-call';
        updateDmCallUI();
        startDmCallTimer();
    } else if (type === 'reject') {
        showToast('تم رفض المكالمة', 'info');
        endDmCall(true);
    } else if (type === 'busy') {
        showToast(getDisplayName(fromPubkey) + ' مشغول حاليًا', 'info');
        endDmCall(true);
    } else if (type === 'hangup') {
        showToast('أنهى الطرف الآخر المكالمة', 'info');
        endDmCall(true);
    }
}

async function sendCallSignal(toPubkey, type, payload) {
    try {
        const content = await encryptToPubkey(JSON.stringify(payload || {}), toPubkey);
        const event = await signEvent({
            kind: CALL_SIGNAL_KIND,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['p', toPubkey], ['type', type]],
            content
        });
        await publishToRelays(event);
    } catch (e) {
        console.warn('[Call] فشل إرسال إشارة', type, e);
    }
}

function ensureDmPeer() {
    return new Promise((resolve, reject) => {
        if (dmPeer && !dmPeer.destroyed) { resolve(dmPeer); return; }
        const id = 'pulse-dm-' + pk.slice(0, 12) + '-' + Date.now().toString(36);
        dmPeer = new Peer(id, { config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] } });
        dmPeer.on('call', handleIncomingDmCall);
        dmPeer.on('open', () => resolve(dmPeer));
        dmPeer.on('error', reject);
        setTimeout(() => reject(new Error('انتهى وقت انتظار الاتصال')), 10000);
    });
}

function attachDmRemoteStream(call) {
    call.on('stream', (remoteStream) => {
        const audio = $('dm-call-audio');
        if (audio) { audio.srcObject = remoteStream; audio.play().catch(() => {}); }
    });
    call.on('close', () => endDmCall(true));
    call.on('error', () => endDmCall(true));
}

// بيتسجل مرة واحدة بس عند إنشاء dmPeer، ويتفعّل تلقائيًا لما الطرف
// التاني يرد على مكالمتنا (بعد ما يقبلها من عنده).
function handleIncomingDmCall(call) {
    dmActiveCall = call;
    attachDmRemoteStream(call);
    if (dmLocalStream) call.answer(dmLocalStream);
}

async function startDmCall(pubkey) {
    if (!pubkey) return;
    if (dmCallState !== 'idle') { showToast('في مكالمة شغالة أصلاً', 'error'); return; }
    if (!navigator.mediaDevices?.getUserMedia) { showToast('المتصفح ده مش بيدعم المكالمات الصوتية', 'error'); return; }

    try {
        dmLocalStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (e) {
        showToast('محتاجين إذن الميكروفون عشان تتصل', 'error');
        return;
    }

    let peer;
    try { peer = await ensureDmPeer(); }
    catch (e) {
        showToast('فشل تجهيز الاتصال، حاول تاني', 'error');
        dmLocalStream?.getTracks().forEach(t => t.stop());
        dmLocalStream = null;
        return;
    }

    dmCallState = 'calling';
    dmCallPeerPubkey = pubkey;
    fetchProfiles([pubkey]);
    updateDmCallUI();

    await sendCallSignal(pubkey, 'invite', { peerId: peer.id });

    dmCallTimeoutId = setTimeout(() => {
        if (dmCallState === 'calling') {
            showToast('محدش ردّ على المكالمة', 'info');
            endDmCall(true);
        }
    }, 45000);
}

async function acceptDmCall() {
    clearTimeout(dmCallTimeoutId);
    const pubkey = dmCallPeerPubkey;
    const callerPeerId = dmCallPeerId;
    hideIncomingCallUI();

    try {
        dmLocalStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (e) {
        showToast('محتاجين إذن الميكروفون عشان تقبل المكالمة', 'error');
        endDmCall(true);
        return;
    }

    let peer;
    try { peer = await ensureDmPeer(); }
    catch (e) {
        showToast('فشل تجهيز الاتصال', 'error');
        endDmCall(true);
        return;
    }

    dmCallState = 'in-call';
    updateDmCallUI();
    startDmCallTimer();

    const call = peer.call(callerPeerId, dmLocalStream);
    dmActiveCall = call;
    attachDmRemoteStream(call);

    await sendCallSignal(pubkey, 'accept');
}

function rejectDmCall() {
    clearTimeout(dmCallTimeoutId);
    if (dmCallPeerPubkey) sendCallSignal(dmCallPeerPubkey, 'reject');
    hideIncomingCallUI();
    resetDmCallState();
}

function hangupDmCall() {
    if (dmCallPeerPubkey) sendCallSignal(dmCallPeerPubkey, 'hangup');
    endDmCall(false);
}

function endDmCall() {
    clearTimeout(dmCallTimeoutId);
    if (dmCallTimerInterval) { clearInterval(dmCallTimerInterval); dmCallTimerInterval = null; }
    if (dmActiveCall) { try { dmActiveCall.close(); } catch (e) {} dmActiveCall = null; }
    if (dmLocalStream) { try { dmLocalStream.getTracks().forEach(t => t.stop()); } catch (e) {} dmLocalStream = null; }
    if (dmPeer) { try { dmPeer.destroy(); } catch (e) {} dmPeer = null; }
    hideIncomingCallUI();
    resetDmCallState();
}

function resetDmCallState() {
    dmCallState = 'idle';
    dmCallPeerPubkey = null;
    dmCallPeerId = null;
    dmCallStartTime = null;
    dmIsMuted = false;
    updateDmCallUI();
}

function startDmCallTimer() {
    dmCallStartTime = Date.now();
    if (dmCallTimerInterval) clearInterval(dmCallTimerInterval);
    dmCallTimerInterval = setInterval(updateDmCallTimerUI, 1000);
    updateDmCallTimerUI();
}

function updateDmCallTimerUI() {
    const el = $('dm-call-timer');
    if (!el || !dmCallStartTime) return;
    const secs = Math.floor((Date.now() - dmCallStartTime) / 1000);
    el.textContent = String(Math.floor(secs / 60)).padStart(2, '0') + ':' + String(secs % 60).padStart(2, '0');
}

function toggleDmMute() {
    if (!dmLocalStream) return;
    dmIsMuted = !dmIsMuted;
    dmLocalStream.getAudioTracks().forEach(t => t.enabled = !dmIsMuted);
    const btn = $('dm-call-mute-btn');
    if (btn) btn.classList.toggle('bg-white/40', dmIsMuted);
}

function showIncomingCallUI(pubkey) {
    const overlay = $('incoming-call-overlay');
    if (!overlay) return;
    const nameEl = $('incoming-call-name');
    if (nameEl) nameEl.textContent = getDisplayName(pubkey);
    const avatarEl = $('incoming-call-avatar');
    if (avatarEl) avatarEl.innerHTML = avatarHtml(pubkey, 'w-24 h-24 text-3xl');
    overlay.classList.remove('hidden');
}

function hideIncomingCallUI() {
    $('incoming-call-overlay')?.classList.add('hidden');
}

function updateDmCallUI() {
    const overlay = $('dm-call-overlay');
    if (!overlay) return;
    if (dmCallState === 'idle') { overlay.classList.add('hidden'); return; }
    overlay.classList.remove('hidden');

    const pubkey = dmCallPeerPubkey;
    const nameEl = $('dm-call-name');
    if (nameEl && pubkey) nameEl.textContent = getDisplayName(pubkey);
    const avatarEl = $('dm-call-avatar');
    if (avatarEl && pubkey) avatarEl.innerHTML = avatarHtml(pubkey, 'w-28 h-28 text-4xl');

    const statusEl = $('dm-call-status');
    if (statusEl) statusEl.classList.toggle('hidden', dmCallState !== 'calling');
    const timerEl = $('dm-call-timer');
    if (timerEl) timerEl.classList.toggle('hidden', dmCallState !== 'in-call');
}

// ============================
// ربط الدوال عالمياً
// ============================

window.sendDirectMessage = sendDirectMessage;
window.openChat = openChat;
window.closeChat = closeChat;
window.promptNewChat = promptNewChat;
window.openChatFromProfile = openChatFromProfile;
window.startDmSubscription = startDmSubscription;
window.startDmCallListener = startDmCallListener;
window.startDmCall = startDmCall;
window.acceptDmCall = acceptDmCall;
window.rejectDmCall = rejectDmCall;
window.hangupDmCall = hangupDmCall;
window.toggleDmMute = toggleDmMute;
