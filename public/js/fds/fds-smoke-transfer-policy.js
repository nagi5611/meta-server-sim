// public/js/fds/fds-smoke-transfer-policy.js — FDS バイナリ転送レート（テスト可能）

export const FDS_SMOKE_FETCH_MAX_CONCURRENT = 1;
export const FDS_SMOKE_TARGET_PART_SECONDS = 15;
export const FDS_SMOKE_BYTES_PER_SECOND_MIN = 2_000_000;
export const FDS_SMOKE_BYTES_PER_SECOND_MAX = 12_000_000;
export const FDS_SMOKE_ATLAS_FRAMES_PER_CHUNK = 8;
/** 再生開始・パート切替時に同期的に載せるチャンク数 */
export const FDS_SMOKE_ATLAS_INITIAL_SYNC_CHUNKS = 3;
/** パート終端前に次パートの先頭アトラスを Worker で構築し始めるローカルフレーム数 */
export const FDS_SMOKE_PART_ATLAS_HEAD_LEAD_FRAMES =
    FDS_SMOKE_ATLAS_FRAMES_PER_CHUNK * FDS_SMOKE_ATLAS_INITIAL_SYNC_CHUNKS + 8;
/** FDS 再生ハーネス・MCP 検証で「フレーム未進行」とみなす既定時間（ms） */
export const FDS_SMOKE_PLAYBACK_STALL_MS = 180_000;

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