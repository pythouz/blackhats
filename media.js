/* =========================================================
   Pulse — media.js
   عرض الوسائط المرفقة بالمنشورات (صور/فيديو)
   ========================================================= */

// ============================
// 8. عرض الوسائط (الصور والفيديو)
// ============================

const MEDIA_ONLY_LINE_RE = /^(https?:\/\/[^\s<>"']+\.(jpe?g|png|gif|webp|svg|bmp|ico|mp4|webm|mov|avi|mkv|ogg)(\?[^\s<>"']*)?)$/i;

function extractMediaFromContent(content) {
    if (!content) return { text: '', mediaUrls: [] };
    const mediaUrls = [];
    const keptLines = [];
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && MEDIA_ONLY_LINE_RE.test(trimmed)) {
            mediaUrls.push(trimmed);
        } else {
            keptLines.push(line);
        }
    }
    const text = keptLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return { text, mediaUrls };
}

function renderMediaContent(content) {
    if (!content) return '';

    let html = content;
    const placeholders = [];
    const stash = (tagHtml) => {
        const token = `\u0000MEDIA${placeholders.length}\u0000`;
        placeholders.push(tagHtml);
        return token;
    };

    html = html.replace(
        /(https?:\/\/[^\s<>"']+\.(jpe?g|png|gif|webp|svg|bmp|ico)(\?[^\s<>"']*)?)/gi,
        (match) => {
            const safeUrl = match.replace(/&/g, '&amp;');
            return stash(`<img src="${safeUrl}" alt="صورة" class="max-w-full rounded-xl my-2 max-h-[500px] object-contain border border-gray-200 dark:border-gray-700 shadow-sm cursor-pointer" loading="lazy" onclick="window.open('${safeUrl}', '_blank')" onerror="this.style.display='none'" />`);
        }
    );

    html = html.replace(
        /(https?:\/\/[^\s<>"']+\.(mp4|webm|mov|avi|mkv|ogg)(\?[^\s<>"']*)?)/gi,
        (match) => {
            const safeUrl = match.replace(/&/g, '&amp;');
            return stash(`<video src="${safeUrl}" controls class="max-w-full rounded-xl my-2 max-h-[500px] w-full border border-gray-200 dark:border-gray-700 shadow-sm" preload="metadata" playsinline></video>`);
        }
    );

    html = html.replace(
        /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/gi,
        (_, vid) => stash(`<iframe class="w-full rounded-xl my-2 aspect-video border border-gray-200 dark:border-gray-700 shadow-sm" src="https://www.youtube.com/embed/${vid}" frameborder="0" allowfullscreen loading="lazy"></iframe>`)
    );

    html = html.replace(
        /(?:https?:\/\/)?(?:www\.)?vimeo\.com\/(\d+)/gi,
        (_, id) => stash(`<iframe class="w-full rounded-xl my-2 aspect-video border border-gray-200 dark:border-gray-700 shadow-sm" src="https://player.vimeo.com/video/${id}" frameborder="0" allowfullscreen loading="lazy"></iframe>`)
    );

    html = html.replace(
        /(https?:\/\/[^\s<>"']+)/gi,
        (match) => `<a href="${match}" target="_blank" rel="noopener noreferrer" class="text-accent hover:underline">${match}</a>`
    );

    html = html.replace(/\u0000MEDIA(\d+)\u0000/g, (_, i) => placeholders[Number(i)]);

    if (typeof DOMPurify !== 'undefined') {
        html = DOMPurify.sanitize(html, {
            ALLOWED_TAGS: ['img', 'video', 'iframe', 'a', 'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'span', 'div'],
            ALLOWED_ATTR: ['src', 'alt', 'class', 'onclick', 'controls', 'preload', 'playsinline', 'href', 'target', 'rel', 'frameborder', 'allowfullscreen', 'loading', 'width', 'height', 'style']
        });
    }

    return html;
}
