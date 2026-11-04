// addons/time-machine/lib/cloudfront-admin.js — no-op on meta-server-sim (R2 delivery)
/**
 * @returns {Promise<{ ok: boolean, skipped?: boolean, error?: string }>}
 */
export async function invalidateAllAssetPrefixes() {
    return { ok: true, skipped: true, error: 'CloudFront invalidation not used on meta-server-sim (R2)' };
}
