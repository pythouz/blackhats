/* =========================================================
   Pulse — rooms.js
   الغرف الصوتية WebRTC (عبر PeerJS و Nostr)
   ========================================================= */

// ============================
// 16. الغرف الصوتية
// ============================

async function toggleRoom() {
    if (isJoiningRoom) return;
    const input = $('room-input');
    const btn = $('btn-join-room');
    if (!input || !btn) return;

    if (currentRoom) {
        await leaveRoom();
        return;
    }

    const roomName = safeRoomName(input.value.trim());
    if (!roomName) { showToast('أدخل اسم الغرفة', 'error'); return; }

    isJoiningRoom = true;
    btn.disabled = true;
    btn.textContent = 'جاري الاتصال...';

    try {
        await joinRoom(roomName);
    } catch (error) {
        showToast('فشل الدخول: ' + getErrorMessage(error), 'error');
        isJoiningRoom = false;
        btn.disabled = false;
        btn.textContent = 'دخول';
    }
}

async function joinRoom(roomName) {
    if (currentRoom) await leaveRoom();

    // طلب المايكروفون
    if (!localStream) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        } catch (e) {
            throw new Error('لا يمكن الوصول إلى المايكروفون: ' + e.message);
        }
    }

    currentRoom = roomName;
    localStorage.setItem('active_room', roomName);

    // إنشاء Peer
    if (!peer) {
        myPeerId = 'pulse-' + pk.slice(0, 12) + '-' + Date.now().toString(36);
        peer = new Peer(myPeerId, {
            config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
        });
        // ✅ لازم نسمع لحدث 'call' عشان نرد على مكالمات المشاركين
        // التانيين. من غيرها، الطرف اللي بيدخل الغرفة بيتصل بيه الناس
        // الموجودين بالفعل (عن طريق connectToPeer)، بس هو نفسه ما بيردش
        // على أي مكالمة واردة — يعني محدش كان بيسمع حد فعليًا.
        peer.on('call', handleIncomingCall);
        await new Promise((resolve, reject) => {
            peer.on('open', resolve);
            peer.on('error', reject);
            setTimeout(() => reject(new Error('انتهى وقت انتظار Peer')), 10000);
        });
    }

    // إعلان الحضور
    await announcePresence(roomName);

    // بدء الاستماع للمشاركين
    listenForPeers(roomName);

    // تحديث الواجهة
    const activeUI = $('active-room-ui');
    const roomNameEl = $('current-room-name');
    if (activeUI) activeUI.classList.remove('hidden');
    if (roomNameEl) roomNameEl.textContent = roomName;

    const btn = $('btn-join-room');
    if (btn) {
        btn.textContent = 'مغادرة';
        btn.disabled = false;
    }

    isJoiningRoom = false;
    showToast('دخلت الغرفة: ' + roomName, 'success');

    // بدء VAD
    startVAD();
}

async function leaveRoom() {
    if (!currentRoom) return;

    // إيقاف المكالمات
    for (const [peerId, call] of activeCalls) {
        try { call.close(); } catch(e) {}
    }
    activeCalls.clear();
    announcedPeers.clear();

    // إلغاء الاشتراك
    if (roomSubscription) {
        try { roomSubscription.close(); } catch(e) {}
        roomSubscription = null;
    }

    // إرسال حدث مغادرة (ephemeral)
    try {
        const event = await signEvent({
            kind: ROOM_EVENT_KIND,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['t', currentRoom], ['p', pk], ['status', 'leave']],
            content: ''
        });
        await publishToRelays(event);
    } catch(e) {}

    currentRoom = null;
    localStorage.removeItem('active_room');

    // تحديث الواجهة
    const activeUI = $('active-room-ui');
    if (activeUI) activeUI.classList.add('hidden');

    const btn = $('btn-join-room');
    if (btn) {
        btn.textContent = 'دخول';
        btn.disabled = false;
    }

    const input = $('room-input');
    if (input) input.value = '';

    showToast('غادرت الغرفة', 'info');
}

async function announcePresence(roomName) {
    const event = await signEvent({
        kind: ROOM_EVENT_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['t', roomName], ['p', pk], ['status', 'join'], ['peer', myPeerId]],
        content: ''
    });
    await publishToRelays(event);
}

function listenForPeers(roomName) {
    if (roomSubscription) {
        try { roomSubscription.close(); } catch(e) {}
    }

    // (أداء) الاشتراك ده بيتكرر كل 5 ثواني طول ما إحنا في الغرفة. من غير
    // 'since'، كل مرة كان بيطلب من الـ relays *كل* أحداث join/leave اللي
    // اتنشرت تحت التاج ده من الأول — رغم إن حضور الغرفة نفسه صلاحيته
    // ROOM_PRESENCE_TTL_MS (90 ثانية) بس ومبيتفلترش محليًا إلا لو أحدث من
    // كده. بنحط since بهامش أمان (ضعف مدة الصلاحية) عشان نضمن مفيش فجوة
    // ونقلل حجم البيانات المطلوبة في كل دورة بشكل كبير.
    const since = Math.floor(Date.now() / 1000) - Math.ceil((ROOM_PRESENCE_TTL_MS / 1000) * 2);

    roomSubscription = pool.subscribeMany(RELAYS, [
        { kinds: [ROOM_EVENT_KIND], '#t': [roomName], since }
    ], {
        onevent: (event) => {
            if (event.pubkey === pk) return;
            const status = getTagValue(event.tags, 'status');
            const peerId = getTagValue(event.tags, 'peer');
            if (!peerId) return;

            if (status === 'join') {
                if (!announcedPeers.has(peerId)) {
                    announcedPeers.add(peerId);
                    connectToPeer(peerId, event.pubkey);
                    updatePeersList();
                }
            } else if (status === 'leave') {
                announcedPeers.delete(peerId);
                const call = activeCalls.get(peerId);
                if (call) {
                    try { call.close(); } catch(e) {}
                    activeCalls.delete(peerId);
                }
                updatePeersList();
            }
        },
        oneose: () => {
            setTimeout(() => listenForPeers(roomName), 5000);
        }
    });
}

function connectToPeer(peerId, pubkey) {
    if (activeCalls.has(peerId)) return;
    if (peerId === myPeerId) return;

    try {
        const call = peer.call(peerId, localStream);
        activeCalls.set(peerId, call);
        call.on('stream', (remoteStream) => {
            // إضافة الصوت البعيد
            const audio = new Audio();
            audio.srcObject = remoteStream;
            audio.autoplay = true;
            // تخزين مرجع للصوت
            call._audioElement = audio;
        });
        call.on('close', () => {
            activeCalls.delete(peerId);
            announcedPeers.delete(peerId);
            updatePeersList();
        });
        call.on('error', () => {
            activeCalls.delete(peerId);
            announcedPeers.delete(peerId);
            updatePeersList();
        });
        updatePeersList();
    } catch(e) {
        console.warn('[Rooms] فشل الاتصال بـ', peerId, e);
    }
}

function handleIncomingCall(call) {
    const peerId = call.peer;
    if (activeCalls.has(peerId)) {
        call.close();
        return;
    }
    call.answer(localStream);
    activeCalls.set(peerId, call);
    announcedPeers.add(peerId);

    call.on('stream', (remoteStream) => {
        const audio = new Audio();
        audio.srcObject = remoteStream;
        audio.autoplay = true;
        call._audioElement = audio;
    });
    call.on('close', () => {
        activeCalls.delete(peerId);
        announcedPeers.delete(peerId);
        updatePeersList();
    });
    updatePeersList();
}

function updatePeersList() {
    const list = $('peers-list');
    const count = $('peer-count');
    if (!list) return;

    const peers = Array.from(announcedPeers);
    if (count) count.textContent = `الأشخاص: ${peers.length + 1}`;

    if (peers.length === 0) {
        list.innerHTML = '<p class="text-xs text-gray-400">لا يوجد مشاركون آخرون</p>';
        return;
    }

    list.innerHTML = peers.map(peerId => `
        <div class="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-800 rounded-xl">
            <i class="fas fa-user-circle text-lg text-gray-400"></i>
            <span class="text-sm truncate">${peerId.slice(0, 16)}...</span>
        </div>
    `).join('');
}

function toggleMute() {
    if (!localStream) return;
    isMuted = !isMuted;
    localStream.getAudioTracks().forEach(track => track.enabled = !isMuted);
    const btn = $('btn-mute');
    if (btn) {
        btn.innerHTML = isMuted ? '<i class="fas fa-microphone-slash"></i>' : '<i class="fas fa-microphone"></i>';
        btn.classList.toggle('bg-red-500/20', isMuted);
        btn.classList.toggle('text-red-500', isMuted);
    }
    showToast(isMuted ? 'كتم المايكروفون 🔇' : 'تفعيل المايكروفون 🎤', 'info');
}

function startVAD() {
    // VAD بسيط - تغيير لون المؤشر عند الكلام
    if (!localStream) return;
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(localStream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const dataArray = new Uint8Array(analyser.fftSize);

    function checkAudio() {
        if (!currentRoom) return;
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        const status = $('vad-status');
        if (status) {
            if (avg > 20) {
                status.textContent = '🔊 تتحدث الآن';
                status.className = 'text-xs text-green-500';
            } else {
                status.textContent = '🔇 ساكن';
                status.className = 'text-xs text-gray-400';
            }
        }
        requestAnimationFrame(checkAudio);
    }
    checkAudio();
}

// ============================
// 17. اكتشاف الغرف المباشرة
// ============================

function startRoomDirectory() {
    if (directorySubscription) {
        try { directorySubscription.close(); } catch(e) {}
    }

    // (أداء) زي listenForPeers بالظبط — الاشتراك ده بيتكرر كل 10 ثواين
    // (شوف oneose تحت)، وأحداث الحضور صلاحيتها ROOM_PRESENCE_TTL_MS بس.
    // من غير since كان بيجيب أقدم 100 حدث من كل تاريخ الشبكة في كل دورة،
    // وأغلبها بيترفض فورًا محليًا في فحص age تحت لأنه أصلاً قديم.
    const since = Math.floor(Date.now() / 1000) - Math.ceil((ROOM_PRESENCE_TTL_MS / 1000) * 2);

    directorySubscription = pool.subscribeMany(RELAYS, [
        { kinds: [ROOM_EVENT_KIND], limit: 100, since }
    ], {
        onevent: (event) => {
            const roomName = getTagValue(event.tags, 't');
            if (!roomName) return;
            const status = getTagValue(event.tags, 'status');
            if (status !== 'join') return;

            const now = Date.now();
            const age = now - event.created_at * 1000;
            if (age > ROOM_PRESENCE_TTL_MS) return;

            if (!discoveredRooms.has(roomName)) {
                discoveredRooms.set(roomName, { participants: new Set(), lastSeen: now });
            }
            const room = discoveredRooms.get(roomName);
            room.participants.add(event.pubkey);
            room.lastSeen = now;
            renderRoomDirectory();
        },
        oneose: () => {
            setTimeout(startRoomDirectory, 10000);
        }
    });

    // تنظيف الغرف القديمة كل 30 ثانية
    if (directoryCleanupInterval) clearInterval(directoryCleanupInterval);
    directoryCleanupInterval = setInterval(() => {
        const now = Date.now();
        for (const [name, room] of discoveredRooms) {
            if (now - room.lastSeen > ROOM_PRESENCE_TTL_MS) {
                discoveredRooms.delete(name);
            }
        }
        renderRoomDirectory();
    }, 30000);
}

function renderRoomDirectory() {
    const list = $('live-rooms-list');
    const empty = $('live-rooms-empty');
    if (!list || !empty) return;

    const rooms = Array.from(discoveredRooms.entries())
        .filter(([_, room]) => room.participants.size > 0)
        .sort((a, b) => b[1].participants.size - a[1].participants.size);

    if (rooms.length === 0) {
        list.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');

    list.innerHTML = rooms.map(([name, room]) => `
        <div class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 transition">
            <div class="flex items-center gap-3">
                <i class="fas fa-microphone text-accent"></i>
                <span class="font-medium dark:text-white">${escapeHtml(name)}</span>
                <span class="text-xs text-gray-400">(${room.participants.size} مشارك)</span>
            </div>
            <button onclick="joinDiscoveredRoom('${escapeHtml(name)}')" 
                    class="bg-accent text-white px-4 py-1.5 rounded-full text-xs font-bold hover:opacity-90 transition">
                دخول
            </button>
        </div>
    `).join('');
}

async function joinDiscoveredRoom(roomName) {
    const input = $('room-input');
    if (input) input.value = roomName;
    await toggleRoom();
}

function restoreRoomAfterRefresh() {
    const savedRoom = localStorage.getItem('active_room');
    if (savedRoom && !currentRoom) {
        joinRoom(savedRoom).catch(e => {
            console.warn('[Rooms] فشل استعادة الغرفة:', e);
            localStorage.removeItem('active_room');
        });
    }
}

// ============================
// 18. Wake Lock (منع النوم)
// ============================

async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log('[WakeLock] نشط');
        }
    } catch(e) { console.warn('[WakeLock] غير مدعوم'); }
}

function releaseWakeLock() {
    if (wakeLock) {
        try { wakeLock.release(); } catch(e) {}
        wakeLock = null;
        console.log('[WakeLock] محرر');
    }
}

// ربط WakeLock بحالة الغرفة
const origJoinRoom = joinRoom;
joinRoom = async function(roomName) {
    await origJoinRoom(roomName);
    await requestWakeLock();
};

const origLeaveRoom = leaveRoom;
leaveRoom = async function() {
    releaseWakeLock();
    await origLeaveRoom();
};
