// Generated from prod survey (fugaku-prod01) — re-run scripts/survey-fds-part-sizes.mjs to refresh
// Median part ~167 MiB; target ~15s/part → throttled ~9–10 MiB/s (cap 12 MiB/s)

import {
    FDS_SMOKE_BYTES_PER_SECOND_MAX,
    FDS_SMOKE_BYTES_PER_SECOND_MIN,
    FDS_SMOKE_FETCH_MAX_CONCURRENT,
    clampBytesPerSecond,
} from './fds-smoke-transfer-policy.js';

/** @type {number} */
export const FDS_SMOKE_DEFAULT_BYTES_PER_SECOND = clampBytesPerSecond(9_500_000);

/** 本番 fugaku-prod01 パートサイズ（HEAD survey 2026-11-16） */
export const FUGAKU_PROD01_PART_BYTES = [
    175_291_392, 175_291_392, 175_291_392, 175_291_392, 175_291_392,
    175_291_392, 175_291_392, 175_291_392, 175_291_392, 164_626_432,
];

export function getConfiguredBytesPerSecond() {
    return FDS_SMOKE_DEFAULT_BYTES_PER_SECOND;
}

export function getMaxConcurrentPartFetches() {
    return FDS_SMOKE_FETCH_MAX_CONCURRENT;
}

export { FDS_SMOKE_BYTES_PER_SECOND_MIN, FDS_SMOKE_BYTES_PER_SECOND_MAX, FDS_SMOKE_FETCH_MAX_CONCURRENT };