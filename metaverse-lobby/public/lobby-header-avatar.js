/**
 * @param {string | undefined} name
 */
export function avatarInitialFromName(name) {
    return String(name || '').trim().slice(0, 1).toUpperCase() || '?';
}

/**
 * Show either the photo or letter fallback in a single .av-slot (never both once settled).
 * @param {{ url?: string, name?: string, initialEl?: HTMLElement | null, imgEl?: HTMLImageElement | null }} opts
 */
export function applyAvatarSlot(opts) {
    const url = String(opts.url || '').trim();
    const initial = avatarInitialFromName(opts.name);
    const initialEl = opts.initialEl;
    const imgEl = opts.imgEl;
    if (initialEl) {
        initialEl.textContent = initial;
    }
    if (!imgEl) return;

    imgEl.referrerPolicy = 'no-referrer';

    const showInitialOnly = () => {
        imgEl.hidden = true;
        imgEl.removeAttribute('src');
        imgEl.onload = null;
        imgEl.onerror = null;
        if (initialEl) initialEl.hidden = false;
    };

    const showPhotoLoaded = () => {
        imgEl.hidden = false;
        if (initialEl) initialEl.hidden = true;
    };

    imgEl.onerror = () => showInitialOnly();

    if (url) {
        if (initialEl) initialEl.hidden = false;
        imgEl.hidden = false;
        imgEl.onload = () => showPhotoLoaded();
        const alreadySame = imgEl.src === url || imgEl.getAttribute('src') === url;
        if (!alreadySame) {
            imgEl.src = url;
        } else if (imgEl.complete && imgEl.naturalWidth > 0) {
            showPhotoLoaded();
        }
    } else {
        showInitialOnly();
    }
}