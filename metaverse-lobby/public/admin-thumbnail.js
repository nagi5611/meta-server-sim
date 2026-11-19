/**
 * World-card thumbnails (.ph in lobby.css): aspect-ratio 16/9, object-fit: cover.
 * Max lobby display width ≈ (var(--container) 1200px − paddings − 2×gap) / 3 columns ≈ 355px.
 * Upload cap uses 2× that width for retina (same convention as profile-avatar.js 128px for ~56px).
 */
export const THUMBNAIL_LOBBY_CARD_MAX_DISPLAY_W = 355;
export const THUMBNAIL_RETINA_SCALE = 2;
export const THUMBNAIL_MAX_WIDTH_PX =
    THUMBNAIL_LOBBY_CARD_MAX_DISPLAY_W * THUMBNAIL_RETINA_SCALE;
export const THUMBNAIL_MAX_HEIGHT_PX = Math.round((THUMBNAIL_MAX_WIDTH_PX * 9) / 16);
export const THUMBNAIL_ASPECT = 16 / 9;
export const THUMBNAIL_MAX_BYTES = 10 * 1024 * 1024;
export const THUMBNAIL_WEBP_QUALITY = 0.85;

/**
 * Center-crop to 16:9, downscale to lobby max display pixels (2× retina), encode WebP.
 * @param {File} file
 * @returns {Promise<{ blob: Blob, fileName: string }>}
 */
export async function resizeThumbnailFile(file) {
    const bmp = await createImageBitmap(file);
    const srcW = bmp.width;
    const srcH = bmp.height;
    const srcAspect = srcW / srcH;

    let sx;
    let sy;
    let sw;
    let sh;
    if (srcAspect > THUMBNAIL_ASPECT) {
        sh = srcH;
        sw = Math.round(srcH * THUMBNAIL_ASPECT);
        sx = Math.floor((srcW - sw) / 2);
        sy = 0;
    } else {
        sw = srcW;
        sh = Math.round(srcW / THUMBNAIL_ASPECT);
        sx = 0;
        sy = Math.floor((srcH - sh) / 2);
    }

    let outW = THUMBNAIL_MAX_WIDTH_PX;
    let outH = THUMBNAIL_MAX_HEIGHT_PX;
    if (sw <= THUMBNAIL_MAX_WIDTH_PX && sh <= THUMBNAIL_MAX_HEIGHT_PX) {
        outW = sw;
        outH = sh;
    } else {
        const scale = Math.min(THUMBNAIL_MAX_WIDTH_PX / sw, THUMBNAIL_MAX_HEIGHT_PX / sh);
        outW = Math.max(1, Math.round(sw * scale));
        outH = Math.max(1, Math.round(sh * scale));
    }

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        bmp.close?.();
        throw new Error('canvas_unavailable');
    }
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, outW, outH);
    bmp.close?.();

    const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('encode_failed'))),
            'image/webp',
            THUMBNAIL_WEBP_QUALITY,
        );
    });
    if (blob.size > THUMBNAIL_MAX_BYTES) {
        throw new Error('file_too_large');
    }

    const base = String(file.name || 'thumbnail').replace(/\.[^.]+$/, '') || 'thumbnail';
    const safeBase = base.replace(/[^\w.-]+/g, '_').slice(0, 80);
    return { blob, fileName: `${safeBase}.webp` };
}

if (typeof window !== 'undefined') {
    window.resizeThumbnailFile = resizeThumbnailFile;
    window.AdminThumbnail = {
        resizeThumbnailFile,
        THUMBNAIL_MAX_WIDTH_PX,
        THUMBNAIL_MAX_HEIGHT_PX,
        THUMBNAIL_MAX_BYTES,
        THUMBNAIL_WEBP_QUALITY,
    };
}