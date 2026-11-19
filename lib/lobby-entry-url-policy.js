// lib/lobby-entry-url-policy.js — Node re-export for sim catalog routes
export {
    resolveLobbyEntryUrlAllowPatterns,
    isLobbyEntryOriginAllowed,
    isLobbyEntryUrlAllowed,
    lobbyEntryUrlPolicyHintJa,
} from '../metaverse-lobby/public/lobby-entry-url-policy.js';

/**
 * @param {string} entryUrl
 */
export function validateLobbyEntryUrlForSave(entryUrl) {
    if (!isLobbyEntryUrlAllowed(entryUrl, process.env)) {
        return {
            ok: false,
            error: 'entry_url_origin_not_allowed',
            message: lobbyEntryUrlPolicyHintJa(process.env),
        };
    }
    return { ok: true };
}