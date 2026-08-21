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

// ==============================================================
//  دوال صفحة الملف الشخصي (Profile Page)  (جديد)
// ==============================================================

let currentProfilePubkey = null;
let profilePostsSubscription = null;
let profilePostsLimit = 20;
let profileOldestTimestamp = null;

function openProfilePage(pubkey) {
    if (!pubkey) { showToast('لا يوجد مفتاح للمستخدم', 'error'); return; }
    // إخفاء جميع الـ views
    document.querySelectorAll('.view-section').forEach(s => s.classList.add('hidden'));
    const profileView = document.getElementById('view-profile');
    if (profileView) profileView.classList.remove('hidden');
    currentProfilePubkey = pubkey;
    // جلب البيانات
    loadProfileData(pubkey);
}

function closeProfilePage() {
    const profileView = document.getElementById('view-profile');
    if (profileView) profileView.classList.add('hidden');
    // العودة للفيد أو الغرفة حسب آخر view مخزن
    const savedView = localStorage.getItem('pulse_view') || 'timeline';
    switchView(savedView);
    // إلغاء اشتراك المنشورات
    if (profilePostsSubscription) {
        try { profilePostsSubscription.close(); } catch(e) {}
        profilePostsSubscription = null;
    }
    currentProfilePubkey = null;
    profilePosts = [];
    profileOldestTimestamp = null;
}

async function loadProfileData(pubkey) {
    // جلب الميتاداتا
    const sub = pool.subscribeMany(RELAYS, [{ kinds: [0], authors: [pubkey], limit: 1 }], {
        onevent: (event) => {
            try {
                const meta = JSON.parse(event.content || '{}');
                renderProfilePage(pubkey, meta);
            } catch(e) { showToast('خطأ في قراءة البيانات', 'error'); }
        },
        oneose: () => {
            // إذا لم يصل حدث، نعرض بيانات من الكاش إن وجدت
            const cached = profileCache.get(pubkey);
            if (cached) {
                renderProfilePage(pubkey, { name: cached.name || '', picture: cached.picture || '', about: cached.about || '' });
            } else {
                renderProfilePage(pubkey, {});
            }
            sub.close();
        }
    });
    // تحميل المنشورات
    loadProfilePosts(pubkey);
}

function renderProfilePage(pubkey, meta) {
    const name = meta.display_name || meta.name || 'مجهول';
    const picture = meta.picture || '';
    const banner = meta.banner || '';
    const about = meta.about || '';
    const location = meta.location || '';
    const website = meta.website || '';

    const nameEl = document.getElementById('profile-page-name');
    if (nameEl) nameEl.textContent = name;

    const npubEl = document.getElementById('profile-page-npub');
    if (npubEl) {
        try {
            const npubFormatted = NostrTools.nip19.npubEncode(pubkey);
            npubEl.textContent = npubFormatted;
        } catch(e) { npubEl.textContent = pubkey.slice(0,16)+'...'; }
    }

    const avatarImg = document.getElementById('profile-page-avatar');
    const avatarLetter = document.getElementById('profile-page-avatar-letter');
    if (picture) {
        avatarImg.src = picture;
        avatarImg.classList.remove('hidden');
        avatarLetter.classList.add('hidden');
    } else {
        avatarImg.classList.add('hidden');
        avatarLetter.classList.remove('hidden');
        avatarLetter.textContent = (name || 'P').slice(0,1).toUpperCase();
    }

    const coverImg = document.getElementById('profile-cover-img');
    const coverEmpty = document.getElementById('profile-cover-empty');
    if (banner) {
        coverImg.src = banner;
        coverImg.classList.remove('hidden');
        coverEmpty.classList.add('hidden');
    } else {
        coverImg.classList.add('hidden');
        coverEmpty.classList.remove('hidden');
    }

    const aboutEl = document.getElementById('profile-page-about');
    if (aboutEl) aboutEl.textContent = about || '';

    const locationEl = document.getElementById('profile-page-location');
    if (location) {
        locationEl.classList.remove('hidden');
        locationEl.querySelector('span').textContent = location;
    } else {
        locationEl.classList.add('hidden');
    }

    const websiteEl = document.getElementById('profile-page-website');
    if (website) {
        websiteEl.classList.remove('hidden');
        const link = websiteEl.querySelector('a');
        link.href = website.startsWith('http') ? website : 'https://'+website;
        link.textContent = website.replace(/^https?:\/\//, '');
    } else {
        websiteEl.classList.add('hidden');
    }

    // تاريخ الانضمام (تقريبي)
    const joinedEl = document.getElementById('profile-page-joined');
    if (joinedEl) joinedEl.textContent = 'تاريخ غير معروف';

    // تخزين في الكاش
    profileCache.set(pubkey, { name, picture, about });
}

function loadProfilePosts(pubkey, until) {
    if (profilePostsSubscription) {
        try { profilePostsSubscription.close(); } catch(e) {}
    }
    const loading = document.getElementById('profile-loading-posts');
    if (loading) loading.classList.remove('hidden');

    const filters = {
        kinds: [1],
        authors: [pubkey],
        limit: profilePostsLimit
    };
    if (until) filters.until = until;

    profilePostsSubscription = pool.subscribeMany(RELAYS, [filters], {
        onevent: (event) => {
            if (event.kind === 5) return; // حذف
            if (bannedPubkeys.has(event.pubkey)) return;
            renderProfilePost(event);
        },
        oneose: () => {
            if (loading) loading.classList.add('hidden');
            const moreContainer = document.getElementById('profile-load-more-container');
            if (moreContainer) {
                const postsCount = document.querySelectorAll('#profile-posts-container .post-card').length;
                if (postsCount >= profilePostsLimit) {
                    moreContainer.classList.remove('hidden');
                } else {
                    moreContainer.classList.add('hidden');
                }
            }
        }
    });
}

function renderProfilePost(event) {
    const container = document.getElementById('profile-posts-container');
    if (!container) return;

    const time = new Date(event.created_at * 1000).toLocaleString('ar-EG', { hour:'2-digit', minute:'2-digit', day:'numeric', month:'short' });
    const displayName = getDisplayName(event.pubkey);
    const contentHtml = renderMediaContent(event.content);
    const div = document.createElement('div');
    div.className = 'post-card bg-white dark:bg-cardDark rounded-3xl p-5 shadow-soft border border-gray-100 dark:border-gray-800 fade-in transition-all duration-200';
    div.dataset.postId = event.id;
    div.dataset.pubkey = event.pubkey;
    div.dataset.createdAt = event.created_at;

    div.innerHTML = `
        <div class="flex justify-between items-start mb-4">
            <div class="flex items-center gap-3 min-w-0">
                <div class="avatar-slot flex-shrink-0 cursor-pointer" onclick="openProfilePage('${event.pubkey}')">${avatarHtml(event.pubkey, 'w-11 h-11 text-base')}</div>
                <div class="min-w-0 flex-1">
                    <div class="author-name font-bold text-sm dark:text-white truncate">${escapeHtml(displayName)}</div>
                    <div class="text-xs text-gray-400">${escapeHtml(time)}</div>
                </div>
            </div>
            ${event.pubkey === pk ? `
            <div class="flex gap-1 flex-shrink-0">
                <button onclick="editPost('${event.id}')" class="text-xs text-blue-500 hover:text-blue-700 transition p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-500/10" title="تعديل"><i class="fas fa-edit"></i></button>
                <button onclick="deletePost('${event.id}')" class="text-xs text-red-500 hover:text-red-700 transition p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10" title="حذف"><i class="fas fa-trash"></i></button>
            </div>
            ` : ''}
        </div>
        <div class="post-content text-gray-800 dark:text-gray-200 leading-relaxed mb-4 whitespace-pre-wrap text-sm md:text-base break-words">${contentHtml}</div>
        <div class="post-actions flex items-center gap-4 text-gray-400 text-sm border-t border-gray-100 dark:border-gray-800 pt-3">
            <button class="like-button flex items-center gap-1 hover:text-red-500 transition" onclick="likePost('${event.id}', '${event.pubkey}')" data-liked="false" data-postid="${event.id}">
                <i class="far fa-heart"></i> <span>إعجاب</span> <span class="like-count" data-count="0">0</span>
            </button>
            <button class="reply-button flex items-center gap-1 hover:text-accent transition" onclick="replyToPost('${event.id}', '${event.pubkey}')" title="اكتب تعليقًا">
                <i class="far fa-comment"></i> <span>تعليق</span>
            </button>
            <button class="reply-toggle-button flex items-center gap-1 hover:text-accent hover:underline transition" onclick="toggleReplies('${event.id}')" title="عرض التعليقات">
                <span class="reply-count" data-count="0">0</span> <span>تعليق</span>
                <i class="fas fa-chevron-down text-[10px] reply-toggle-icon transition-transform duration-200"></i>
            </button>
        </div>
        <div class="replies-container hidden mt-3 space-y-2" data-replies="${event.id}"></div>
    `;
    container.appendChild(div);
    fetchProfiles([event.pubkey]);
    addBanButtonToPost(div, event.pubkey);
    processPendingReplies(event.id);
}

function loadMoreProfilePosts() {
    const container = document.getElementById('profile-posts-container');
    if (!container) return;
    const cards = container.querySelectorAll('.post-card');
    if (!cards.length) return;
    let oldest = Infinity;
    for (const card of cards) {
        const created = parseInt(card.dataset.createdAt);
        if (!isNaN(created) && created < oldest) oldest = created;
    }
    if (oldest === Infinity) return;
    profileOldestTimestamp = oldest;
    loadProfilePosts(currentProfilePubkey, oldest);
}
