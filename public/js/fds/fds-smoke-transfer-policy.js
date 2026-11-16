// public/js/fds/fds-smoke-transfer-policy.js — FDS バイナリ転送レート（テスト可能）

export const FDS_SMOKE_FETCH_MAX_CONCURRENT = 1;
export const FDS_SMOKE_TARGET_PART_SECONDS = 15;
export const FDS_SMOKE_BYTES_PER_SECOND_MIN = 2_000_000;
export const FDS_SMOKE_BYTES_PER_SECOND_MAX = 12_000_000;
export const FDS_SMOKE_ATLAS_FRAMES_PER_CHUNK = 4;

/**
 * @param {number} bytesPerSecond
 * @returns {number}
 */
export function clampBytesPerSecond(bytesPerSecond) {
    const n = Number(bytesPerSecond);
    if (!Number.isFinite(n) || n <= 0) {
        return FDS_SMOKE_BYTES_PER_SECOND_MIN;
    }
    return Math.min(FDS_SMOKE_BYTES_PER_SECOND_MAX, Math.max(FDS_SMOKE_BYTES_PER_SECOND_MIN, Math.floor(n)));
}

/**
 * @param {number} partByteLength
 * @param {number} [targetSeconds]
 * @returns {number}
 */
export function bytesPerSecondForPartSize(partByteLength, targetSeconds = FDS_SMOKE_TARGET_PART_SECONDS) {
    const size = Number(partByteLength);
    const sec = Number(targetSeconds);
    if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(sec) || sec <= 0) {
        return FDS_SMOKE_BYTES_PER_SECOND_MIN;
    }
    return clampBytesPerSecond(Math.ceil(size / sec));
}

/**
 * @param {number[]} partSizes
 * @returns {{ defaultBytesPerSecond: number, perPart: Record<string, number> }}
 */
export function summarizePartTransferRates(partSizes) {
    const sizes = partSizes.filter((n) => Number.isFinite(n) && n > 0);
    const sorted = [...sizes].sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    const defaultBps = clampBytesPerSecond(
        median > 0 ? Math.ceil((median / FDS_SMOKE_TARGET_PART_SECONDS) * 1.25) : FDS_SMOKE_BYTES_PER_SECOND_MIN,
    );
    return {
        defaultBytesPerSecond: defaultBps,
        medianPartBytes: median,
        maxPartBytes: sorted.length ? sorted[sorted.length - 1] : 0,
    };
}