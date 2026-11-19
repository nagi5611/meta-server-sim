import { getLobbyDisplayNameModerationConfig } from './display-name-moderation-config.js';
import { scoreJevDisplayNameReject, shouldRejectFromJevNoul } from './display-name-moderation-jev.js';

/**
 * @typedef {{
 *   allowed: boolean,
 *   inappropriate?: boolean,
 *   skipped?: boolean,
 *   moderationError?: boolean,
 *   reason_ja?: string,
 *   jev_noul?: number,
 *   moderation_stage?: string,
 * }} DisplayNameModerationResult
 */

/**
 * @param {{
 *   env: Record<string, unknown>,
 *   displayName: string,
 *   fetchImpl?: typeof fetch,
 * }} params
 * @returns {Promise<DisplayNameModerationResult>}
 */
export async function moderateLobbyDisplayName(params) {
    const { env, displayName, fetchImpl = fetch } = params;
    const trimmed = String(displayName || '').trim();
    if (!trimmed) return { allowed: true, skipped: true };

    const cfg = getLobbyDisplayNameModerationConfig(env);
    if (!cfg.enabled) {
        return { allowed: true, skipped: true, moderation_stage: 'jev_disabled' };
    }

    try {
        const { noul } = await scoreJevDisplayNameReject({
            displayName: trimmed,
            cfg,
            fetchImpl,
        });
        if (!shouldRejectFromJevNoul(noul, cfg.rejectThreshold)) {
            return {
                allowed: true,
                inappropriate: false,
                jev_noul: noul,
                moderation_stage: 'jev_pass',
            };
        }
        return {
            allowed: false,
            inappropriate: true,
            reason_ja: '表示名がポリシーに適合しません。別の名前をお試しください。',
            jev_noul: noul,
            moderation_stage: 'jev_reject',
        };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[NAME_MOD] Jev moderation failed:', msg);
        return { allowed: true, skipped: true, moderationError: true, moderation_stage: 'jev_error' };
    }
}