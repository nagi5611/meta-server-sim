// metaverse-lobby/public/lobby-entry-url-policy.js — entryUrl origin allowlist (browser + canonical)

const DEFAULT_PATTERNS = ['https://*.mmh-virtual.jp'];

/**
 * @param {Record<string, unknown> | undefined} env
 */
export function resolveLobbyEntryUrlAllowPatterns(env) {
    const fromEnv = String(
        env?.LOBBY_ENTRY_URL_ALLOWED_ORIGINS ?? (typeof process !== 'undefined' ? process.env?.LOBBY_ENTRY_URL_ALLOWED_ORIGINS : '') ?? '',
    ).trim();
    if (!fromEnv) return DEFAULT_PATTERNS.slice();
    return fromEnv
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
}

/**
 * @param {string} pattern
 */
function parseAllowPattern(pattern) {
    const raw = String(pattern || '').trim();
    const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)\/?$/i.exec(raw);
    if (!m) return null;
    const protocol = `${m[1].toLowerCase()}:`;
    const hostPattern = m[2].toLowerCase();
    return { protocol, hostPattern };
}

/**
 * @param {string} hostname
 * @param {string} hostPattern
 */
function hostnameMatchesPattern(hostname, hostPattern) {
    const h = String(hostname || '').toLowerCase();
    const p = String(hostPattern || '').toLowerCase();
    if (p.startsWith('*.')) {
        const suffix = p.slice(2);
        if (!suffix) return false;
        return h === suffix || h.endsWith(`.${suffix}`);
    }
    return h === p;
}

/**
 * @param {string} origin
 * @param {string[]} patterns
 */
export function isLobbyEntryOriginAllowed(origin, patterns = DEFAULT_PATTERNS) {
    let url;
    try {
        url = new URL(String(origin || '').trim());
    } catch {
        return false;
    }
    const parsed = patterns.map(parseAllowPattern).filter(Boolean);
    if (!parsed.length) return false;
    for (const rule of parsed) {
        if (url.protocol !== rule.protocol) continue;
        if (hostnameMatchesPattern(url.hostname, rule.hostPattern)) return true;
    }
    return false;
}

/**
 * @param {string} entryUrl
 * @param {Record<string, unknown> | undefined} env
 */
export function isLobbyEntryUrlAllowed(entryUrl, env) {
    const value = String(entryUrl || '').trim();
    if (!value) return false;
    let origin;
    try {
        origin = new URL(value).origin;
    } catch {
        return false;
    }
    return isLobbyEntryOriginAllowed(origin, resolveLobbyEntryUrlAllowPatterns(env));
}

/**
 * @param {Record<string, unknown> | undefined} env
 */
export function lobbyEntryUrlPolicyHintJa(env) {
    const patterns = resolveLobbyEntryUrlAllowPatterns(env);
    return `許可された origin のみ (${patterns.join(', ')})`;
}