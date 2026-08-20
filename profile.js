/* =========================================================
   Pulse — profile.js
   الملف الشخصي: عرض، تعديل، رفع صورة/بانر، تحميل بيانات المستخدمين
   ========================================================= */

// ============================
// 6. الملف الشخصي (Profile)
// ============================

let myProfile = { name: '', picture: '', banner: '', about: '', location: '', website: '' };
let pendingAvatarFile = null, pendingBannerFile = null;
let pendingAvatarPreviewUrl = null, pendingBannerPreviewUrl = null;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

function revokePreview(url) {
    if (url?.startsWith('blob:')) { try { URL.revokeObjectURL(url); } catch(e) {} }
}

function validateImageFile(file) {
    if (!file) return 'لم يتم اختيار ملف';
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) return 'صيغة غير مدعومة';
    if (file.size > MAX_IMAGE_BYTES) return 'حجم الصورة كبير (الحد الأقصى 5MB)';
    return null;
}

async function compressImage(file, maxWidth, quality) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);
        img.onload = () => {
            try {
                const scale = Math.min(1, maxWidth / img.width);
                const w = Math.round(img.width * scale);
                const h = Math.round(img.height * scale);
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);
                canvas.toBlob(blob => {
                    URL.revokeObjectURL(objectUrl);
                    if (!blob) { reject(new Error('فشل الضغط')); return; }
                    resolve(new File([blob], file.name.replace(/\..+$/, '.jpg'), { type: 'image/jpeg' }));
                }, 'image/jpeg', quality);
            } catch(e) { URL.revokeObjectURL(objectUrl); reject(e); }
        };
        img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('تعذر قراءة الصورة')); };
        img.src = objectUrl;
    });
}

async function buildNip98AuthHeader(url, method) {
    const event = await signEvent({
        kind: 27235,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['u', url], ['method', method]],
        content: ''
    });
    return `Nostr ${btoa(unescape(encodeURIComponent(JSON.stringify(event))))}`;
}

async function uploadFileToNostrBuild(file) {
    const uploadUrl = 'https://nostr.build/api/v2/upload/files';
    const form = new FormData();
    form.append('file[]', file);
    let authHeader = null;
    try { authHeader = await buildNip98AuthHeader(uploadUrl, 'POST'); } catch(e) {}
    const res = await fetch(uploadUrl, {
        method: 'POST',
        headers: authHeader ? { Authorization: authHeader } : undefined,
        body: form
    });
    if (!res.ok) {
        if (res.status === 401) throw new Error('رفض السيرفر (401) — تأكد من هويتك');
        throw new Error('فشل رفع الملف (' + res.status + ')');
    }
    const data = await res.json();
    const item = Array.isArray(data) ? data[0] : (data?.data?.[0] || data?.[0] || data);
    const url = item?.url || item?.nip94_event?.tags?.find(t => t[0] === 'url')?.[1] || item?.data?.url || null;
    if (!url) throw new Error('لم يُرجع السيرفر رابطًا صالحًا');
    return url;
}

async function uploadFiles(files) {
    const results = [];
    for (const file of files) {
        try {
            const url = await uploadFileToNostrBuild(file);
            results.push({ url, type: file.type });
        } catch(e) {
            console.warn('[Upload] فشل رفع ملف:', e);
            showToast('فشل رفع أحد الملفات', 'error');
        }
    }
    return results;
}

// ===== واجهة الملف الشخصي =====

function renderProfileImages() {
    const avatarImg = $('profile-avatar-img');
    const avatarLetter = $('profile-avatar-letter');
    const bannerImg = $('profile-banner-img');
    const bannerEmpty = $('profile-banner-empty');
    const removeBannerBtn = $('btn-remove-banner');

    const avatarSrc = pendingAvatarPreviewUrl || myProfile.picture || '';
    if (avatarImg && avatarLetter) {
        if (avatarSrc) {
            avatarImg.src = avatarSrc;
            avatarImg.classList.remove('hidden');
            avatarLetter.classList.add('hidden');
        } else {
            avatarImg.classList.add('hidden');
            avatarLetter.classList.remove('hidden');
            avatarLetter.textContent = (myProfile.name || 'P').slice(0, 1).toUpperCase();
        }
    }

    const bannerSrc = pendingBannerPreviewUrl || myProfile.banner || '';
    if (bannerImg && bannerEmpty) {
        if (bannerSrc) {
            bannerImg.src = bannerSrc;
            bannerImg.classList.remove('hidden');
            bannerEmpty.classList.add('hidden');
            removeBannerBtn?.classList.remove('hidden');
            removeBannerBtn?.classList.add('flex');
        } else {
            bannerImg.classList.add('hidden');
            bannerEmpty.classList.remove('hidden');
            removeBannerBtn?.classList.add('hidden');
            removeBannerBtn?.classList.remove('flex');
        }
    }
}

function onProfileNameInput() {
    const val = $('profile-name')?.value || '';
    const counter = $('name-count');
    if (counter) counter.textContent = String(val.length);
    const letter = $('profile-avatar-letter');
    if (letter && !myProfile.picture && !pendingAvatarPreviewUrl) {
        letter.textContent = (val.trim() || 'P').slice(0, 1).toUpperCase();
    }
}

function onProfileAboutInput() {
    const val = $('profile-about')?.value || '';
    const counter = $('about-count');
    if (counter) counter.textContent = String(val.length);
}

function openProfileModal() {
    const modal = $('profile-modal');
    if (!modal) return;

    pendingAvatarFile = null;
    pendingBannerFile = null;
    revokePreview(pendingAvatarPreviewUrl);
    revokePreview(pendingBannerPreviewUrl);
    pendingAvatarPreviewUrl = null;
    pendingBannerPreviewUrl = null;

    $('profile-name').value = myProfile.name || '';
    $('profile-about').value = myProfile.about || '';
    $('profile-location').value = myProfile.location || '';
    $('profile-website').value = myProfile.website || '';

    onProfileNameInput();
    onProfileAboutInput();
    renderProfileImages();
    $('profile-upload-status')?.classList.add('hidden');

    modal.classList.remove('hidden');
    $('settings-panel')?.classList.add('hidden');
}

function closeProfileModal() {
    $('profile-modal')?.classList.add('hidden');
    revokePreview(pendingAvatarPreviewUrl);
    revokePreview(pendingBannerPreviewUrl);
    pendingAvatarPreviewUrl = null;
    pendingBannerPreviewUrl = null;
    pendingAvatarFile = null;
    pendingBannerFile = null;
}

async function saveProfile() {
    if (!pk) { showToast('لا توجد هوية', 'error'); return; }

    const name = ($('profile-name')?.value || '').trim().slice(0, 50);
    const about = ($('profile-about')?.value || '').trim().slice(0, 160);
    const location = ($('profile-location')?.value || '').trim().slice(0, 30);
    const website = ($('profile-website')?.value || '').trim().slice(0, 100);

    if (!name) { showToast('الاسم مطلوب', 'error'); return; }
    if (website && !/^https?:\/\//i.test(website)) {
        showToast('الرابط يجب أن يبدأ بـ http:// أو https://', 'error');
        return;
    }

    const btn = $('btn-save-profile');
    if (btn) btn.disabled = true;

    try {
        let pictureUrl = myProfile.picture || '';
        let bannerUrl = myProfile.banner || '';

        if (pendingAvatarFile) {
            $('profile-upload-status').textContent = 'جاري رفع الصورة...';
            $('profile-upload-status').classList.remove('hidden');
            const compressed = await compressImage(pendingAvatarFile, 400, 0.85);
            pictureUrl = await uploadFileToNostrBuild(compressed);
        }
        if (pendingBannerFile) {
            $('profile-upload-status').textContent = 'جاري رفع الغلاف...';
            $('profile-upload-status').classList.remove('hidden');
            const compressed = await compressImage(pendingBannerFile, 1500, 0.82);
            bannerUrl = await uploadFileToNostrBuild(compressed);
        }

        $('profile-upload-status').textContent = 'جاري الحفظ...';
        $('profile-upload-status').classList.remove('hidden');

        const contentObj = { name, display_name: name, about: about || undefined, picture: pictureUrl || undefined, banner: bannerUrl || undefined, location: location || undefined, website: website || undefined };
        Object.keys(contentObj).forEach(k => { if (contentObj[k] === undefined || contentObj[k] === '') delete contentObj[k]; });

        const event = await signEvent({ kind: 0, created_at: Math.floor(Date.now() / 1000), tags: [], content: JSON.stringify(contentObj) });
        await pool.publish(RELAYS, event);

        myProfile = { name, about, picture: pictureUrl, banner: bannerUrl, location, website };
        profileCache.set(pk, { name, picture: pictureUrl || null, about: about || null });

        pendingAvatarFile = null;
        pendingBannerFile = null;
        revokePreview(pendingAvatarPreviewUrl);
        revokePreview(pendingBannerPreviewUrl);
        pendingAvatarPreviewUrl = null;
        pendingBannerPreviewUrl = null;

        updateHeaderAvatar();
        updateAvatarsInDom(pk);
        closeProfileModal();
        showToast('تم تحديث الملف الشخصي ✅', 'success');
    } catch (error) {
        console.error('[Profile] فشل:', error);
        showToast('فشل الحفظ: ' + getErrorMessage(error), 'error');
    } finally {
        if (btn) btn.disabled = false;
        $('profile-upload-status')?.classList.add('hidden');
    }
}

// ===== تحميل الملف الشخصي =====

function loadMyProfile() {
    if (!pk) return;
    let sub = null;
    try {
        sub = pool.subscribeMany(RELAYS, [{ kinds: [0], authors: [pk], limit: 1 }], {
            onevent: event => {
                try {
                    const meta = JSON.parse(event.content || '{}');
                    myProfile = {
                        name: meta.display_name || meta.name || '',
                        picture: meta.picture || '',
                        banner: meta.banner || '',
                        about: meta.about || '',
                        location: meta.location || '',
                        website: meta.website || meta.url || ''
                    };
                    profileCache.set(pk, { name: myProfile.name || null, picture: myProfile.picture || null, about: myProfile.about || null });
                    updateHeaderAvatar();
                    updateAvatarsInDom(pk);
                } catch(e) {}
            },
            oneose: () => { if (sub) try { sub.close(); } catch(e) {} }
        });
    } catch(e) { console.warn('[Profile] فشل تحميل الملف:', e); }
}

// ===== عرض الصورة الرمزية =====

function avatarHtml(pubkey, sizeClass) {
    const profile = profileCache.get(pubkey);
    const fallback = (pubkey || '؟').slice(0, 2).toUpperCase();
    if (profile?.picture) {
        return `<div class="avatar ${sizeClass} bg-gradient-to-br from-accent to-accent2 overflow-hidden p-0">
            <img src="${escapeHtml(profile.picture)}" alt="" class="w-full h-full object-cover"
                 onerror="this.parentElement.textContent='${escapeHtml(fallback)}'">
        </div>`;
    }
    return `<div class="avatar ${sizeClass} bg-gradient-to-br from-accent to-accent2">${escapeHtml(fallback)}</div>`;
}

function updateAvatarsInDom(pubkey) {
    const profile = profileCache.get(pubkey);
    const displayName = getDisplayName(pubkey);

    document.querySelectorAll(`.post-card[data-author="${pubkey}"]`).forEach(card => {
        const nameEl = card.querySelector('.author-name');
        if (nameEl && profile?.name) nameEl.textContent = displayName;
        const slot = card.querySelector('.avatar-slot');
        if (slot) slot.innerHTML = avatarHtml(pubkey, 'w-10 h-10 text-sm');
    });

    document.querySelectorAll(`.participant-avatar[data-pubkey="${pubkey}"]`).forEach(slot => {
        slot.innerHTML = avatarHtml(pubkey, 'w-12 h-12 text-sm');
    });

    if (pubkey === pk) updateHeaderAvatar();
}

function updateHeaderAvatar() {
    const img = $('header-avatar-img');
    const fb = $('header-avatar-fallback');
    if (!img || !fb) return;
    if (myProfile.picture) {
        img.src = myProfile.picture;
        img.classList.remove('hidden');
        fb.classList.add('hidden');
    } else {
        img.classList.add('hidden');
        fb.classList.remove('hidden');
        fb.textContent = (myProfile.name || pk || 'P').slice(0, 1).toUpperCase();
    }
}

// ===== جلب الملفات الشخصية (debounced) =====

let profileFetchQueue = [];
let profileFetchTimer = null;

function fetchProfiles(pubkeys) {
    const needed = pubkeys.filter(p => p && !profileCache.has(p));
    if (!needed.length) return;
    profileFetchQueue.push(...needed);
    clearTimeout(profileFetchTimer);
    profileFetchTimer = setTimeout(() => {
        const batch = profileFetchQueue.slice(0, 60);
        profileFetchQueue = [];
        if (!batch.length) return;
        try {
            const sub = pool.subscribeMany(RELAYS, [{ kinds: [0], authors: batch, limit: 60 }], {
                onevent: event => {
                    try {
                        const meta = JSON.parse(event.content || '{}');
                        profileCache.set(event.pubkey, {
                            name: meta.display_name || meta.name || null,
                            picture: meta.picture || null,
                            about: meta.about || null
                        });
                        updateAvatarsInDom(event.pubkey);
                    } catch(e) {}
                },
                oneose: () => { if (sub) try { sub.close(); } catch(e) {} }
            });
        } catch(e) { console.warn('[Profile] فشل جلب:', e); }
    }, 300);
}
