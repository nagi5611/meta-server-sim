const MAX_PX = 128;

/**
 * Center-crop and resize an image file to a square WebP blob (max 128×128).
 * @param {File} file
 * @returns {Promise<Blob>}
 */
export async function cropProfileImageFile(file) {
    const bmp = await createImageBitmap(file);
    const side = Math.min(bmp.width, bmp.height);
    const sx = Math.floor((bmp.width - side) / 2);
    const sy = Math.floor((bmp.height - side) / 2);
    const canvas = document.createElement('canvas');
    canvas.width = MAX_PX;
    canvas.height = MAX_PX;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        bmp.close?.();
        throw new Error('canvas_unavailable');
    }
    ctx.drawImage(bmp, sx, sy, side, side, 0, 0, MAX_PX, MAX_PX);
    bmp.close?.();
    const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('encode_failed'))),
            'image/webp',
            0.88,
        );
    });
    return blob;
}