// public/js/tenant-fds-smoke-playback.js — FDS 煙再生タイミング（テスト可能な小ヘルパー）

/**
 * @param {{ framesPerSecond?: number, secondsPerFrame?: number }} pb
 * @returns {number}
 */
export function resolveFdsPlaybackIntervalSeconds(pb) {
    const raw = pb.secondsPerFrame ?? 1 / Math.max(pb.framesPerSecond || 1, 1e-6);
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 1;
    return Math.max(n, 1 / 120);
}