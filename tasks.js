/* =========================================================
   Pulse — tasks.js
   المهام والخدمات — تحميل الفيديو (وخدمات مستقبلية)
   ========================================================= */

let dlSelectedType = 'video';

function openVideoDownloader() {
    dlSelectedType = 'video';
    const modal = $('video-downloader-modal');
    if (!modal) return;
    $('dl-url-input').value = '';
    selectDownloadType('video');
    $('dl-loading')?.classList.add('hidden');
    $('dl-result')?.classList.add('hidden');
    $('dl-error')?.classList.add('hidden');
    const btn = $('dl-submit-btn');
    if (btn) { btn.disabled = false; btn.classList.remove('hidden'); }
    modal.classList.remove('hidden');
}

function closeVideoDownloader() {
    $('video-downloader-modal')?.classList.add('hidden');
}

function selectDownloadType(type) {
    dlSelectedType = type;
    const videoBtn = $('dl-type-video');
    const audioBtn = $('dl-type-audio');
    if (videoBtn && audioBtn) {
        videoBtn.className = 'flex-1 py-2.5 rounded-xl text-sm font-bold transition ' + (type === 'video' ? 'bg-accent text-white' : 'bg-gray-100 dark:bg-gray-800 dark:text-white');
        audioBtn.className = 'flex-1 py-2.5 rounded-xl text-sm font-bold transition ' + (type === 'audio' ? 'bg-accent text-white' : 'bg-gray-100 dark:bg-gray-800 dark:text-white');
    }
}

async function submitVideoDownload() {
    const urlInput = $('dl-url-input');
    const url = (urlInput?.value || '').trim();
    if (!url || !/^https?:\/\//i.test(url)) {
        showToast('الصق رابط صحيح الأول', 'error');
        return;
    }
    if (!ANOVA_API_URL || ANOVA_API_URL.includes('CHANGE-ME')) {
        showToast('الخدمة دي لسه مش متفعّلة (السيرفر مش متظبط)', 'error');
        return;
    }
    if (!checkRateLimit('videoDownload', 3000, 6, 5 * 60 * 1000)) return;

    const btn = $('dl-submit-btn');
    const loading = $('dl-loading');
    const result = $('dl-result');
    const errorBox = $('dl-error');

    if (btn) btn.classList.add('hidden');
    loading?.classList.remove('hidden');
    result?.classList.add('hidden');
    errorBox?.classList.add('hidden');

    try {
        const res = await fetch(ANOVA_API_URL + '/api/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, media_type: dlSelectedType })
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok || data.error) {
            throw new Error(data.error || 'حصل خطأ غير متوقع');
        }

        const titleEl = $('dl-result-title');
        const sizeEl = $('dl-result-size');
        const linkEl = $('dl-result-link');
        if (titleEl) titleEl.textContent = data.title || 'تم التحميل';
        if (sizeEl) sizeEl.textContent = data.size_mb ? `${data.size_mb} ميجابايت` : '';
        if (linkEl) linkEl.href = ANOVA_API_URL + data.download_url;
        result?.classList.remove('hidden');
    } catch (e) {
        if (errorBox) {
            errorBox.textContent = getErrorMessage(e);
            errorBox.classList.remove('hidden');
        }
        if (btn) btn.classList.remove('hidden');
    } finally {
        loading?.classList.add('hidden');
    }
}

window.openVideoDownloader = openVideoDownloader;
window.closeVideoDownloader = closeVideoDownloader;
window.selectDownloadType = selectDownloadType;
window.submitVideoDownload = submitVideoDownload;
