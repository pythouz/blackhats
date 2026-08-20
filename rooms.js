/* =========================================================
   Pulse — rooms.js
   الغرف الصوتية عبر WebRTC + اكتشاف الغرف الحية
   ========================================================= */

// ============================
// 15. غرف الصوت WebRTC (مختصرة)
// ============================

const WEBRTC_CONFIG = {
    iceServers: [
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302', 'stun:stun3.l.google.com:19302', 'stun:stun4.l.google.com:19302'] },
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelay', credential: 'openrelay' },
        { urls: 'turn:openrelay.metered.ca:443', username: 'openrelay', credential: 'openrelay' },
        { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelay', credential: 'openrelay' }
    ],
    iceTransportPolicy: 'all',
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require'
};

function createPeer() {
    return new Promise((resolve, reject) => {
        if (peer && !peer.destroyed) { resolve(peer); return; }
        const peerId = 'pulse-' + (pk || 'anon').slice(0, 8) + '-' + Math.random().toString(36).slice(2, 8);
        let settled = false;
        try {
            peer = new Peer(peerId, { host: '0.peerjs.com', port: 443, secure: true, path: '/', debug: 1, config: WEBRTC_CONFIG });
            peer.on('open', id => { myPeerId = id; if (!settled) { settled = true; resolve(peer); } });
            peer.on('call', call => handleIncomingCall(call));
            peer.on('error', error => { if (!settled) { settled = true; reject(error); } handlePeerError(error); });
            peer.on('disconnected', () => showToast('انقطع اتصال الإشارة الصوتية', 'error'));
        } catch (error) { reject(error); }
    });
}

function handlePeerError(error) {
    const type = error?.type || '';
    const msg = getErrorMessage(error);
    if (type === 'network' || type === 'server-error' || type === 'socket-error') showToast('مشكلة في الشبكة: ' + msg, 'error');
    else if (type === 'unavailable-id') showToast('المعرف مستخدم، حاول مرة أخرى', 'error');
    else if (type === 'browser-incompatible') showToast('المتصفح لا يدعم WebRTC', 'error');
    else showToast('خطأ WebRTC: ' + msg, 'error');
}

async function toggleRoom(forceLeave = false) {
    if (forceLeave) { await leaveRoom(); return; }
    if (isJoiningRoom) return;
    if (currentRoom) { await leaveRoom(); return; }
    const input = $('room-input');
    if (!input) return;
    const roomName = safeRoomName(input.value);
    if (!roomName) { showToast('اكتب اسم الغرفة أولاً', 'error'); return; }
    await joinRoom(roomName);
}

async function joinRoom(roomName) {
    if (isJoiningRoom) return;
    isJoiningRoom = true;
    try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('المتصفح لا يدعم getUserMedia');
        showToast('جاري تشغيل الميكروفون...', 'info');
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
        } catch (micError) {
            if (micError.name === 'NotAllowedError') throw new Error('تم رفض صلاحية الميكروفون');
            if (micError.name === 'NotFoundError') throw new Error('لم يتم العثور على ميكروفون');
            if (micError.name === 'NotReadableError') throw new Error('الميكروفون مستخدم');
            throw micError;
        }
        await createPeer();
        if (!peer || peer.destroyed) throw new Error('تعذر إنشاء PeerJS');
        currentRoom = roomName;
        localStorage.setItem('active_room', currentRoom);
        announcedPeers.clear();
        updateRoomUI(true);
        startBackgroundAudioEngine();
        requestSystemLock();
        setupVAD();
        await announcePresence();
        listenForPeers();
        if (window._presenceInterval) clearInterval(window._presenceInterval);
        window._presenceInterval = setInterval(() => { if (currentRoom) announcePresence(); }, 45000);
        showToast('دخلت غرفة "' + roomName + '" 🎙️', 'success');
    } catch (error) {
        console.error('[Room] فشل:', error);
        showToast('فشل دخول الغرفة: ' + getErrorMessage(error), 'error');
        cleanupRoomResources(false);
    } finally { isJoiningRoom = false; }
}

function updateRoomUI(joined) {
    const btn = $('btn-join-room');
    const input = $('room-input');
    const activeUi = $('active-room-ui');
    const directoryUi = $('live-rooms-section');
    if (joined) {
        activeUi?.classList.remove('hidden');
        directoryUi?.classList.add('hidden');
        if (btn) { btn.textContent = 'مغادرة'; btn.classList.remove('bg-white', 'text-accent'); btn.classList.add('bg-red-500', 'text-white'); }
        if (input) input.disabled = true;
        if ($('current-room-name')) $('current-room-name').textContent = `غرفة: ${currentRoom}`;
    } else {
        activeUi?.classList.add('hidden');
        directoryUi?.classList.remove('hidden');
        if (btn) { btn.textContent = 'دخول'; btn.classList.remove('bg-red-500', 'text-white'); btn.classList.add('bg-white', 'text-accent'); }
        if (input) input.disabled = false;
    }
}

function roomTag() { return `${APP_TAG}:voice:${safeRoomName(currentRoom)}`; }

async function announcePresence() {
    if (!currentRoom || !myPeerId) return;
    const event = await signEvent({
        kind: ROOM_EVENT_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['t', roomTag()], ['t', DISCOVERY_TAG], ['room', safeRoomName(currentRoom)]],
        content: JSON.stringify({ peerId: myPeerId, room: safeRoomName(currentRoom), npub, timestamp: Date.now() })
    });
    await pool.publish(RELAYS, event).catch(e => console.error('[Nostr Room] فشل presence:', e));
}

function listenForPeers() {
    if (!currentRoom) return;
    if (roomSubscription) try { roomSubscription.close(); } catch(e) {}
    try {
        roomSubscription = pool.subscribeMany(RELAYS, [{ kinds: [ROOM_EVENT_KIND], '#t': [roomTag()], limit: 100 }], {
            onevent: event => handleRoomPresence(event),
            oneose: () => {},
            onclose: () => {}
        });
    } catch(e) { showToast('فشل اكتشاف المشاركين: ' + getErrorMessage(e), 'error'); }
}

function handleRoomPresence(event) {
    if (!currentRoom || !event?.content || event.pubkey === pk) return;
    let data;
    try { data = JSON.parse(event.content); } catch(e) { return; }
    if (!data.peerId) return;
    if (data.room && safeRoomName(data.room) !== safeRoomName(currentRoom)) return;
    if (announcedPeers.has(data.peerId)) return;
    if (activeCalls.size >= 5) return;
    announcedPeers.add(data.peerId);
    if (myPeerId && myPeerId < data.peerId) connectToPeer(data.peerId, data.npub || data.peerId);
}

function connectToPeer(targetPeerId, displayName) {
    if (!peer || peer.destroyed || !localStream || !currentRoom) return;
    if (targetPeerId === myPeerId) return;
    if (activeCalls.has(targetPeerId)) return;
    try {
        const call = peer.call(targetPeerId, localStream, { metadata: { room: currentRoom, caller: myPeerId } });
        if (!call) return;
        handleCallEvents(call, displayName);
    } catch(e) { showToast('تعذر بدء الاتصال مع مشارك', 'error'); }
}

function handleIncomingCall(call) {
    if (!currentRoom || !localStream) { try { call.close(); } catch(e) {} return; }
    if (activeCalls.has(call.peer)) { try { call.close(); } catch(e) {} return; }
    try {
        call.answer(localStream);
        handleCallEvents(call, call.peer);
    } catch(e) { try { call.close(); } catch(e) {} }
}

function handleCallEvents(call, displayName) {
    if (!call) return;
    const peerId = call.peer;
    activeCalls.set(peerId, call);
    call.on('stream', stream => addPeerAudio(stream, peerId, displayName));
    call.on('close', () => removePeerCall(peerId));
    call.on('error', () => { showToast('انقطع اتصال مشارك', 'error'); removePeerCall(peerId); });
}

function addPeerAudio(stream, peerId, displayName) {
    if (!stream) return;
    let audio = document.getElementById(`audio-${peerId}`);
    if (!audio) {
        audio = document.createElement('audio');
        audio.id = `audio-${peerId}`;
        audio.autoplay = true;
        audio.playsInline = true;
        audio.setAttribute('playsinline', '');
        audio.controls = false;
        audio.volume = 1;
        const container = $('audio-container');
        if (container) container.appendChild(audio);
        else document.body.appendChild(audio);
    }
    audio.srcObject = stream;
    audio.play().catch(() => {
        showToast('المتصفح منع تشغيل الصوت', 'error');
        document.addEventListener('click', () => audio.play().catch(() => {}), { once: true });
    });
    addPeerToUI(peerId, displayName);
    updatePeerCount();
}

function addPeerToUI(peerId, displayName) {
    const list = $('peers-list');
    if (!list) return;
    const id = `participant-${peerId}`;
    if (document.getElementById(id)) return;
    const div = document.createElement('div');
    div.id = id;
    div.className = 'flex items-center gap-2 bg-gray-50 dark:bg-gray-800/50 p-2 rounded-lg';
    div.innerHTML = `<div class="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div><span class="text-sm">${escapeHtml(String(displayName || peerId).slice(0, 16))}</span>`;
    list.appendChild(div);
}

function removePeerCall(peerId) {
    const audio = document.getElementById(`audio-${peerId}`);
    if (audio) { try { audio.pause(); } catch(e) {} audio.srcObject = null; audio.remove(); }
    const participant = document.getElementById(`participant-${peerId}`);
    if (participant) participant.remove();
    activeCalls.delete(peerId);
    updatePeerCount();
}

function updatePeerCount() {
    const count = $('peers-list')?.children.length || activeCalls.size;
    const countElement = $('peer-count');
    if (countElement) countElement.textContent = `الأشخاص: ${count}`;
}

function toggleMute() {
    if (!localStream) { showToast('لا يوجد ميكروفون نشط', 'error'); return; }
    const tracks = localStream.getAudioTracks();
    if (!tracks.length) { showToast('لم يتم العثور على مسار صوتي', 'error'); return; }
    isMuted = !isMuted;
    tracks.forEach(track => { track.enabled = !isMuted; });
    const btn = $('btn-mute');
    if (btn) {
        btn.innerHTML = isMuted ? '<i class="fas fa-microphone-slash text-red-500"></i>' : '<i class="fas fa-microphone"></i>';
        btn.classList.toggle('bg-red-100', isMuted);
        btn.classList.toggle('text-red-500', isMuted);
    }
    showToast(isMuted ? 'تم كتم الميكروفون' : 'تم تشغيل الميكروفون', 'success');
}

// دوال مساعدة للغرف
function startBackgroundAudioEngine() {
    try {
        if (!bgAudioContext) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;
            bgAudioContext = new AudioContext();
            if (bgAudioContext.state === 'suspended') bgAudioContext.resume().catch(() => {});
            const osc = bgAudioContext.createOscillator();
            const gain = bgAudioContext.createGain();
            gain.gain.value = 0.00001;
            osc.connect(gain);
            gain.connect(bgAudioContext.destination);
            osc.start();
            silentAudioElement = document.createElement('audio');
            silentAudioElement.id = 'voice-keepalive';
            silentAudioElement.autoplay = true;
            silentAudioElement.playsInline = true;
            silentAudioElement.muted = true;
            document.body.appendChild(silentAudioElement);
            silentAudioElement.play().catch(() => {});
        } else if (bgAudioContext.state === 'suspended') {
            bgAudioContext.resume().catch(() => {});
        }
    } catch(e) { console.error('[Audio] KeepAlive Error:', e); }
}

async function requestSystemLock() {
    try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch(e) {}
}

function setupVAD() {
    if (!localStream) return;
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(localStream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const interval = setInterval(() => {
            if (!currentRoom) { clearInterval(interval); try { ctx.close(); } catch(e) {} return; }
            if (isMuted) return;
            analyser.getByteFrequencyData(data);
            const vol = data.reduce((s, v) => s + v, 0) / data.length;
            const status = $('vad-status');
            if (status) status.textContent = vol > 12 ? 'الحالة: تتحدث الآن 🎙️' : 'الحالة: متصل (صامت)';
        }, 200);
    } catch(e) {}
}

async function leaveRoom() {
    const prev = currentRoom;
    currentRoom = null;
    localStorage.removeItem('active_room');
    if (window._presenceInterval) { clearInterval(window._presenceInterval); window._presenceInterval = null; }
    cleanupRoomResources(true);
    updateRoomUI(false);
    showToast(prev ? 'تمت مغادرة الغرفة' : 'تم الخروج', 'success');
}

function cleanupRoomResources(destroyPeer = true) {
    if (roomSubscription) { try { roomSubscription.close(); } catch(e) {} roomSubscription = null; }
    announcedPeers.clear();
    activeCalls.forEach(call => { try { call.close(); } catch(e) {} });
    activeCalls.clear();
    document.querySelectorAll('#audio-container audio, body > audio[id^="audio-"]').forEach(a => { try { a.pause(); } catch(e) {} a.srcObject = null; a.remove(); });
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    if (destroyPeer && peer) { try { peer.destroy(); } catch(e) {} peer = null; myPeerId = null; }
    if (bgAudioContext) { try { bgAudioContext.close(); } catch(e) {} bgAudioContext = null; }
    if (silentAudioElement) { try { silentAudioElement.pause(); } catch(e) {} silentAudioElement.remove(); silentAudioElement = null; }
    if (wakeLock) { try { wakeLock.release(); } catch(e) {} wakeLock = null; }
    isMuted = false;
    const list = $('peers-list');
    if (list) list.innerHTML = '';
    const muteBtn = $('btn-mute');
    if (muteBtn) { muteBtn.innerHTML = '<i class="fas fa-microphone"></i>'; muteBtn.classList.remove('bg-red-100', 'text-red-500'); }
}

async function restoreRoomAfterRefresh() {
    const saved = localStorage.getItem('active_room');
    if (!saved) return;
    const input = $('room-input');
    if (input) input.value = saved;
    currentRoom = null;
    await sleep(800);
    try { await joinRoom(safeRoomName(saved)); } catch(e) { showToast('كانت لديك غرفة مفتوحة. اضغط "دخول" لإعادة الاتصال.', 'info'); }
}

// ============================
// 16. اكتشاف الغرف الحية (Room Directory)
// ============================

function startRoomDirectory() {
    if (directorySubscription) return;
    try {
        directorySubscription = pool.subscribeMany(RELAYS, [{ kinds: [ROOM_EVENT_KIND], '#t': [DISCOVERY_TAG], limit: 300 }], {
            onevent: event => handleDirectoryPresence(event),
            oneose: () => renderRoomDirectory(),
            onclose: () => {}
        });
    } catch(e) { console.warn('[Room Directory] فشل:', e); }
    if (!directoryCleanupInterval) {
        directoryCleanupInterval = setInterval(() => { pruneRoomDirectory(); renderRoomDirectory(); }, 15000);
    }
}

function handleDirectoryPresence(event) {
    if (!event?.content) return;
    let data;
    try { data = JSON.parse(event.content); } catch(e) { return; }
    const roomTag = event.tags.find(t => t[0] === 'room')?.[1];
    const roomName = safeRoomName(roomTag || data.room || '');
    if (!roomName || !data.peerId) return;
    if (!discoveredRooms.has(roomName)) discoveredRooms.set(roomName, new Map());
    discoveredRooms.get(roomName).set(event.pubkey, { peerId: data.peerId, lastSeen: Date.now() });
    if (discoveredRooms.size > MAX_DISCOVERED_ROOMS) {
        const oldest = Array.from(discoveredRooms.keys()).slice(0, discoveredRooms.size - MAX_DISCOVERED_ROOMS);
        oldest.forEach(key => discoveredRooms.delete(key));
    }
    renderRoomDirectory();
}

function pruneRoomDirectory() {
    const now = Date.now();
    discoveredRooms.forEach((members, roomName) => {
        members.forEach((info, pubkey) => {
            if (now - info.lastSeen > ROOM_PRESENCE_TTL_MS) members.delete(pubkey);
        });
        if (members.size === 0) discoveredRooms.delete(roomName);
    });
}

function renderRoomDirectory() {
    const container = $('live-rooms-list');
    const emptyState = $('live-rooms-empty');
    if (!container) return;
    pruneRoomDirectory();
    const rooms = Array.from(discoveredRooms.entries())
        .map(([name, members]) => ({ name, count: members.size }))
        .filter(r => r.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 12);
    if (rooms.length === 0) {
        container.innerHTML = '';
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    }
    if (emptyState) emptyState.classList.add('hidden');
    container.innerHTML = rooms.map(room => `
        <button onclick="joinDiscoveredRoom('${room.name.replace(/'/g, "\\'")}')"
                class="w-full flex items-center justify-between gap-3 bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition rounded-xl px-4 py-3 text-right">
            <span class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-100">
                <i class="fas fa-circle text-[8px] text-green-500 animate-pulse"></i> ${escapeHtml(room.name)}
            </span>
            <span class="text-xs text-gray-400 shrink-0"><i class="fas fa-user-friends ml-1"></i>${room.count}</span>
        </button>
    `).join('');
}

function joinDiscoveredRoom(roomName) {
    if (currentRoom) return;
    const input = $('room-input');
    if (input) input.value = roomName;
    joinRoom(safeRoomName(roomName));
}
